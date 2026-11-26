import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 从源库读取某个对象的依赖清单（连库，不走静态猜测）。
 *
 * Oracle：查 ALL_DEPENDENCIES（含包体、触发器、视图对表/函数/同义词的依赖）。
 * MySQL ：外键（KEY_COLUMN_USAGE）+ 视图引用（VIEW_TABLE_USAGE）+ 例程/触发器体里出现的库内对象名。
 *
 * 输出 JSON 数组：[{"name":"...","type":"TABLE","ddl":"..."}]，ddl 取不到时为空字符串。
 *
 * 用法：
 *   java ReadDependencies --url jdbc:mysql://host:port/db --user u --password p --schema db --name objName
 *   java ReadDependencies --url jdbc:postgresql://host:port/db --user u --password p --schema s --name objName
 */
public class ReadDependencies {

    private static final int MAX_ITEMS = 60;
    private static final int MAX_DDL = 20000;

    private static final Set<String> SYSTEM_SCHEMAS = new LinkedHashSet<String>(java.util.Arrays.asList(
        "sys", "information_schema", "performance_schema", "mysql", "pg_catalog", "pg_toast", "public"));

    public static void main(String[] argv) throws Exception {
        String url = null, user = null, pass = null, schema = null, name = null, names = null, ddlOf = null, typeHint = null;
        for (int i = 0; i < argv.length; i++) {
            String key = argv[i];
            if ("--url".equals(key)) url = argv[++i];
            else if ("--user".equals(key)) user = argv[++i];
            else if ("--password".equals(key)) pass = argv[++i];
            else if ("--schema".equals(key)) schema = argv[++i];
            else if ("--name".equals(key)) name = argv[++i];
            else if ("--names".equals(key)) names = argv[++i];
            else if ("--ddl-of".equals(key)) ddlOf = argv[++i];
            else if ("--type".equals(key)) typeHint = argv[++i];
            else throw new IllegalArgumentException("unknown arg: " + key);
        }
        boolean batch = names != null && !names.trim().isEmpty();
        boolean ddlOnly = ddlOf != null && !ddlOf.trim().isEmpty();
        if (url == null || user == null || ((name == null || name.trim().isEmpty()) && !batch && !ddlOnly)) {
            System.err.println("need --url, --user and one of --name / --names / --ddl-of");
            System.exit(2);
            return;
        }
        boolean mysql = url.startsWith("jdbc:mysql:");
        try {
            Class.forName(mysql ? "com.mysql.cj.jdbc.Driver" : "org.postgresql.Driver");
        } catch (Throwable ignored) {
            // 驱动缺失时由 DriverManager 抛出更明确的错误
        }
        try (Connection conn = DriverManager.getConnection(url, user, pass)) {
            String dbName = schema == null || schema.trim().isEmpty() ? conn.getCatalog() : schema.trim();
            if (ddlOnly) {
                // 单个对象的 DDL（供依赖行按需展开）
                String objectName = ddlOf.trim();
                String type = typeHint == null ? "" : typeHint.trim().toUpperCase(Locale.ROOT);
                String ddl = "";
                String resolvedType = type;
                if (mysql) {
                    if (resolvedType.isEmpty()) {
                        Map<String, String> known = mysqlObjects(conn, dbName);
                        resolvedType = known.getOrDefault(objectName.toLowerCase(Locale.ROOT), "TABLE");
                    }
                    ddl = mysqlDdl(conn, dbName, objectName.toLowerCase(Locale.ROOT), resolvedType);
                } else {
                    if (resolvedType.isEmpty()) resolvedType = "TABLE";
                    ddl = oracleDdl(conn, dbName, objectName, resolvedType);
                }
                System.out.println("[{\"name\":" + quote(objectName) + ",\"type\":" + quote(resolvedType)
                    + ",\"ddl\":" + quote(clip(ddl)) + "}]");
                return;
            }
            if (batch) {
                // 批量：一次连接读多个对象的依赖（不含 DDL，体积小、速度快）
                StringBuilder out = new StringBuilder("[");
                boolean firstObject = true;
                for (String raw : names.split(",")) {
                    String objectName = raw.trim();
                    if (objectName.isEmpty()) continue;
                    Map<String, String> found = mysql
                        ? mysqlDependencyTypes(conn, dbName, objectName)
                        : oracleDependencyTypes(conn, dbName, objectName);
                    if (!firstObject) out.append(',');
                    firstObject = false;
                    out.append("{\"object\":").append(quote(objectName)).append(",\"deps\":[");
                    boolean firstDep = true;
                    int count = 0;
                    for (Map.Entry<String, String> entry : found.entrySet()) {
                        if (count >= MAX_ITEMS) break;
                        if (!firstDep) out.append(',');
                        firstDep = false;
                        out.append("{\"name\":").append(quote(entry.getKey()))
                            .append(",\"type\":").append(quote(entry.getValue())).append('}');
                        count++;
                    }
                    out.append("]}");
                }
                out.append(']');
                System.out.println(out.toString());
                return;
            }
            List<String[]> deps = mysql
                ? mysqlDependencies(conn, dbName, name.trim())
                : oracleDependencies(conn, dbName, name.trim());
            StringBuilder json = new StringBuilder("[");
            int count = 0;
            for (String[] dep : deps) {
                if (count >= MAX_ITEMS) break;
                if (count > 0) json.append(',');
                json.append("{\"name\":").append(quote(dep[0]))
                    .append(",\"type\":").append(quote(dep[1]))
                    .append(",\"ddl\":").append(quote(dep[2]))
                    .append('}');
                count++;
            }
            json.append(']');
            System.out.println(json.toString());
        }
    }

    private static Map<String, String> mysqlDependencyTypes(Connection conn, String db, String name) {
        Map<String, String> found = new LinkedHashMap<String, String>();
        collectMysqlDependencies(conn, db, name, found);
        return found;
    }

    private static List<String[]> mysqlDependencies(Connection conn, String db, String name) {
        Map<String, String> found = mysqlDependencyTypes(conn, db, name);
        return mysqlWithDdl(conn, db, found);
    }

    private static Map<String, String> oracleDependencyTypes(Connection conn, String owner, String name) {
        Map<String, String> found = new LinkedHashMap<String, String>();
        collectOracleDependencies(conn, owner, name, found);
        return found;
    }

    /** Oracle 单个对象的 DDL（依赖行按需展开用）。 */
    private static String oracleDdl(Connection conn, String owner, String name, String type) {
        String schema = owner == null || owner.isEmpty() ? null : owner.toUpperCase(Locale.ROOT);
        String ddlType = type == null || type.isEmpty() ? "TABLE" : type.toUpperCase(Locale.ROOT);
        String sql = schema == null
            ? "SELECT DBMS_METADATA.GET_DDL(?, ?) FROM dual"
            : "SELECT DBMS_METADATA.GET_DDL(?, ?, ?) FROM dual";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, ddlType);
            ps.setString(2, name.toUpperCase(Locale.ROOT));
            if (schema != null) ps.setString(3, schema);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    String value = rs.getString(1);
                    return value == null ? "" : clip(value);
                }
            }
        } catch (Exception ignored) {
            // 无权限或类型不支持时返回空串
        }
        return "";
    }

    private static void collectMysqlDependencies(Connection conn, String db, String name, Map<String, String> found) {
        String lower = name.toLowerCase(Locale.ROOT);
        // 1) 外键引用
        try (PreparedStatement ps = conn.prepareStatement(
            "SELECT DISTINCT referenced_table_schema, referenced_table_name FROM information_schema.KEY_COLUMN_USAGE "
                + "WHERE table_schema = ? AND LOWER(table_name) = ? AND referenced_table_name IS NOT NULL")) {
            ps.setString(1, db);
            ps.setString(2, lower);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    String schema = rs.getString(1);
                    String table = rs.getString(2);
                    if (table != null && !SYSTEM_SCHEMAS.contains(String.valueOf(schema).toLowerCase(Locale.ROOT))) {
                        found.put(table.toLowerCase(Locale.ROOT), "TABLE");
                    }
                }
            }
        } catch (Exception ignored) {
            // 老版本 MySQL 没有该列组合时忽略
        }
        // 2) 视图引用
        try (PreparedStatement ps = conn.prepareStatement(
            "SELECT DISTINCT table_schema, table_name FROM information_schema.VIEW_TABLE_USAGE "
                + "WHERE view_schema = ? AND LOWER(view_name) = ?")) {
            ps.setString(1, db);
            ps.setString(2, lower);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    String schema = rs.getString(1);
                    String table = rs.getString(2);
                    if (table != null && !SYSTEM_SCHEMAS.contains(String.valueOf(schema).toLowerCase(Locale.ROOT))) {
                        found.put(table.toLowerCase(Locale.ROOT), "TABLE");
                    }
                }
            }
        } catch (Exception ignored) {
            // MySQL 5.x 没有 VIEW_TABLE_USAGE
        }
        // 3) 例程 / 触发器 / 事件体里出现的库内对象名
        StringBuilder body = new StringBuilder();
        appendBody(body, conn, "SELECT ROUTINE_DEFINITION FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND LOWER(ROUTINE_NAME) = ?", db, lower);
        appendBody(body, conn, "SELECT ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? AND LOWER(TRIGGER_NAME) = ?", db, lower);
        appendBody(body, conn, "SELECT EVENT_DEFINITION FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ? AND LOWER(EVENT_NAME) = ?", db, lower);
        if (body.length() > 0) {
            String text = body.toString().toLowerCase(Locale.ROOT);
            Map<String, String> known = mysqlObjects(conn, db);
            for (Map.Entry<String, String> entry : known.entrySet()) {
                if (entry.getKey().equals(lower)) continue;
                if (containsWord(text, entry.getKey())) found.putIfAbsent(entry.getKey(), entry.getValue());
            }
        }
    }

    private static void appendBody(StringBuilder body, Connection conn, String sql, String db, String name) {
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, db);
            ps.setString(2, name);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    String text = rs.getString(1);
                    if (text != null) body.append(text).append('\n');
                }
            }
        } catch (Exception ignored) {
            // 某些对象类型不存在对应视图时忽略
        }
    }

    /** 库内对象名 → 类型。 */
    private static Map<String, String> mysqlObjects(Connection conn, String db) {
        Map<String, String> known = new LinkedHashMap<String, String>();
        try (PreparedStatement ps = conn.prepareStatement(
            "SELECT table_name, table_type FROM information_schema.TABLES WHERE table_schema = ?")) {
            ps.setString(1, db);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    String table = rs.getString(1);
                    String type = rs.getString(2);
                    if (table == null) continue;
                    known.put(table.toLowerCase(Locale.ROOT), "VIEW".equalsIgnoreCase(type) ? "VIEW" : "TABLE");
                }
            }
        } catch (Exception ignored) {
            // ignore
        }
        try (PreparedStatement ps = conn.prepareStatement(
            "SELECT routine_name, routine_type FROM information_schema.ROUTINES WHERE routine_schema = ?")) {
            ps.setString(1, db);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    String routine = rs.getString(1);
                    String type = rs.getString(2);
                    if (routine == null) continue;
                    known.put(routine.toLowerCase(Locale.ROOT), type == null ? "FUNCTION" : type.toUpperCase(Locale.ROOT));
                }
            }
        } catch (Exception ignored) {
            // ignore
        }
        return known;
    }

    private static boolean containsWord(String text, String word) {
        int from = 0;
        while (true) {
            int at = text.indexOf(word, from);
            if (at < 0) return false;
            int before = at - 1;
            int after = at + word.length();
            boolean leftOk = before < 0 || !isIdentChar(text.charAt(before));
            boolean rightOk = after >= text.length() || !isIdentChar(text.charAt(after));
            if (leftOk && rightOk) return true;
            from = at + 1;
        }
    }

    private static boolean isIdentChar(char c) {
        return Character.isLetterOrDigit(c) || c == '_' || c == '$';
    }

    private static List<String[]> mysqlWithDdl(Connection conn, String db, Map<String, String> found) {
        List<String[]> out = new ArrayList<String[]>();
        for (Map.Entry<String, String> entry : found.entrySet()) {
            String name = entry.getKey();
            String type = entry.getValue();
            if (SYSTEM_SCHEMAS.contains(name)) continue;
            out.add(new String[] {name, type, mysqlDdl(conn, db, name, type)});
        }
        return out;
    }

    private static String mysqlDdl(Connection conn, String db, String name, String type) {
        String keyword;
        if ("VIEW".equals(type)) keyword = "VIEW";
        else if ("PROCEDURE".equals(type)) keyword = "PROCEDURE";
        else if ("FUNCTION".equals(type)) keyword = "FUNCTION";
        else if ("TRIGGER".equals(type)) keyword = "TRIGGER";
        else keyword = "TABLE";
        try (java.sql.Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery("SHOW CREATE " + keyword + " `" + db + "`.`" + name + "`")) {
            if (rs.next()) {
                // 只取名为 “Create .../Create Table” 的那一列，避免取到 collation 之类的尾巴列
                java.sql.ResultSetMetaData md = rs.getMetaData();
                int columns = md.getColumnCount();
                for (int i = 1; i <= columns; i++) {
                    String label = md.getColumnLabel(i);
                    if (label != null && label.toLowerCase(Locale.ROOT).startsWith("create")) {
                        String value = rs.getString(i);
                        if (value != null && value.trim().length() > 0) return clip(value);
                    }
                }
                for (int i = 2; i <= columns; i++) {
                    String value = rs.getString(i);
                    if (value != null && value.trim().length() > 20) return clip(value);
                }
            }
        } catch (Exception ignored) {
            // 取不到 DDL 就返回空串，客户端仍能显示依赖名
        }
        return "";
    }

    private static List<String[]> oracleDependencies(Connection conn, String owner, String name) {
        Map<String, String> found = oracleDependencyTypes(conn, owner, name);
        List<String[]> out = new ArrayList<String[]>();
        for (Map.Entry<String, String> entry : found.entrySet()) {
            out.add(new String[] {entry.getKey(), entry.getValue(), ""});
        }
        return out;
    }

    private static void collectOracleDependencies(Connection conn, String owner, String name, Map<String, String> found) {
        String schema = owner == null || owner.isEmpty() ? null : owner.toUpperCase(Locale.ROOT);
        String sql = "SELECT referenced_owner, referenced_name, referenced_type FROM all_dependencies WHERE name = ?"
            + (schema == null ? "" : " AND owner = ?")
            + " AND referenced_type IN ('TABLE','VIEW','MATERIALIZED VIEW','FUNCTION','PROCEDURE','PACKAGE','TYPE','TRIGGER','SEQUENCE','SYNONYM')";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setString(1, name.toUpperCase(Locale.ROOT));
            if (schema != null) ps.setString(2, schema);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    String refOwner = rs.getString(1);
                    String refName = rs.getString(2);
                    String refType = rs.getString(3);
                    if (refName == null) continue;
                    if (refOwner != null && SYSTEM_SCHEMAS.contains(refOwner.toLowerCase(Locale.ROOT))) continue;
                    if (refName.equalsIgnoreCase(name) && (schema == null || refOwner == null || refOwner.equalsIgnoreCase(schema))) continue;
                    found.put(refName.toLowerCase(Locale.ROOT), refType == null ? "TABLE" : refType.toUpperCase(Locale.ROOT));
                }
            }
        } catch (Exception ignored) {
            // 权限不足时返回空列表
        }
    }

    private static String clip(String value) {
        String text = value == null ? "" : value;
        return text.length() > MAX_DDL ? text.substring(0, MAX_DDL) : text;
    }

    private static String quote(String value) {
        StringBuilder sb = new StringBuilder("\"");
        String text = value == null ? "" : value;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }
}