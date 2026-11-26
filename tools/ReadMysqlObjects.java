import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;


/**
 * 从 MySQL / MariaDB 源库读取对象清单与 DDL，输出一个 JSON 数组（name/type/ddl）。
 * 只读：仅查询 information_schema 并调用 SHOW CREATE ...，不修改任何对象。
 *
 * 用法：
 *   java -cp mysql.jar ReadMysqlObjects --url jdbc:mysql://host:port/db \
 *        --user u --password p [--schema db] [--types TABLE,VIEW,...] [--limit 200]
 *
 * MySQL 的 schema 概念等同于 database：--schema 省略时取 JDBC URL 里的库名。
 */
public class ReadMysqlObjects {

    private static final String DEFAULT_TYPES = "TABLE,VIEW,FUNCTION,PROCEDURE,TRIGGER,EVENT";

    private static final Set<String> SYSTEM_SCHEMAS = new HashSet<String>(java.util.Arrays.asList(
        "information_schema", "mysql", "performance_schema", "sys"));

    public static void main(String[] argv) throws Exception {
        String url = null, user = null, pass = null, schema = null, types = DEFAULT_TYPES;
        int limit = 200;
        for (int i = 0; i < argv.length; i++) {
            String key = argv[i];
            if ("--url".equals(key)) url = argv[++i];
            else if ("--user".equals(key)) user = argv[++i];
            else if ("--password".equals(key)) pass = argv[++i];
            else if ("--schema".equals(key)) schema = argv[++i];
            else if ("--types".equals(key)) types = argv[++i];
            else if ("--limit".equals(key)) limit = Integer.parseInt(argv[++i]);
            else throw new IllegalArgumentException("未知参数: " + key);
        }
        if (url == null || user == null) {
            System.err.println("需要 --url 与 --user");
            System.exit(2);
        }

        String database = schema == null || schema.trim().isEmpty() ? databaseOf(url) : schema.trim();
        if (database == null || database.isEmpty()) {
            System.err.println("无法确定 MySQL 数据库名：请传 --schema 或在 JDBC URL 里带上库名");
            System.exit(2);
        }
        if (SYSTEM_SCHEMAS.contains(database.toLowerCase())) {
            System.err.println("当前数据库 '" + database + "' 属于系统库，读取会返回系统对象；请在「连接管理」里把该连接的默认库设为业务库后再读取");
            System.exit(3);
        }

        List<String> typeList = new ArrayList<String>();
        for (String item : types.split(",")) {
            String value = item.trim().toUpperCase();
            if (!value.isEmpty()) typeList.add(value);
        }
        if (typeList.isEmpty()) typeList.add("TABLE");

        Class.forName("com.mysql.cj.jdbc.Driver");

        // 网络抖动时 MySQL 会断开长连接：整轮重试一次，避免用户看到裸的 CommunicationsException
        int attempt = 0;
        while (true) {
            try {
                runOnce(url, user, pass, database, typeList, limit);
                return;
            } catch (Exception error) {
                attempt++;
                if (attempt >= 2 || !isRetryable(error)) throw error;
                System.err.println("WARN: 与源库的连接中断，正在重试（" + attempt + "/1）");
                try {
                    Thread.sleep(800L);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw error;
                }
            }
        }
    }

    /** 连接中断、读超时一类错误值得重试；语法/权限错误不重试。 */
    private static boolean isRetryable(Throwable error) {
        Throwable current = error;
        while (current != null) {
            String message = current.getMessage();
            if (message != null) {
                String lower = message.toLowerCase();
                if (lower.contains("communications link failure")
                    || lower.contains("connection is closed")
                    || lower.contains("read timed out")
                    || lower.contains("could not create connection")
                    || lower.contains("broken pipe")) {
                    return true;
                }
            }
            current = current.getCause();
        }
        return false;
    }

    private static void runOnce(String url, String user, String pass, String database,
                                List<String> typeList, int limit) throws Exception {
        List<String[]> objects = new ArrayList<String[]>();
        String[] ddls;
        try (Connection connection = DriverManager.getConnection(url, user, pass)) {
            if (typeList.contains("TABLE")) {
                List<String[]> tables = new ArrayList<String[]>();
                collect(connection, tables, "TABLE",
                    "select table_name from information_schema.tables where table_schema = ? and table_type = 'BASE TABLE' order by table_name",
                    database, limit);
                objects.addAll(orderTablesByDependencies(connection, database, tables));
            }
            if (typeList.contains("VIEW")) {
                collect(connection, objects, "VIEW",
                    "select table_name from information_schema.tables where table_schema = ? and table_type = 'VIEW' order by table_name",
                    database, limit);
            }
            if (typeList.contains("PROCEDURE")) {
                collect(connection, objects, "PROCEDURE",
                    "select routine_name from information_schema.routines where routine_schema = ? and routine_type = 'PROCEDURE' order by routine_name",
                    database, limit);
            }
            if (typeList.contains("FUNCTION")) {
                collect(connection, objects, "FUNCTION",
                    "select routine_name from information_schema.routines where routine_schema = ? and routine_type = 'FUNCTION' order by routine_name",
                    database, limit);
            }
            if (typeList.contains("TRIGGER")) {
                collect(connection, objects, "TRIGGER",
                    "select trigger_name from information_schema.triggers where trigger_schema = ? order by trigger_name",
                    database, limit);
            }
            if (typeList.contains("EVENT")) {
                collect(connection, objects, "EVENT",
                    "select event_name from information_schema.events where event_schema = ? order by event_name",
                    database, limit);
            }

            ddls = readDdls(connection, url, user, pass, database, objects);
            boolean hasDdl = false;
            for (String ddl : ddls) {
                if (ddl != null) {
                    hasDdl = true;
                    break;
                }
            }
            if (!hasDdl && !objects.isEmpty()) {
                System.err.println("所有对象的 DDL 均读取失败（共 " + objects.size() + " 个）");
                System.exit(4);
            }
        }

        StringBuilder out = new StringBuilder("[");
        boolean first = true;
        for (int index = 0; index < objects.size(); index++) {
            String[] object = objects.get(index);
            String ddl = ddls[index];
            if (ddl == null) continue;
            if (!first) out.append(',');
            first = false;
            out.append("{\"name\":").append(quote(object[0]))
               .append(",\"type\":").append(quote(object[1]))
               .append(",\"ddl\":").append(quote(ddl)).append('}');
        }
        out.append(']');
        System.out.println(out.toString());
    }

    private static String[] readDdls(Connection connection, String url, String user, String pass,
                                     String database, List<String[]> objects) throws Exception {
        String[] ddls = new String[objects.size()];
        AtomicInteger cursor = new AtomicInteger();
        AtomicInteger progress = new AtomicInteger();
        System.err.println("PROGRESS 0/" + objects.size());
        // Small reads use the catalog connection alone. Larger reads overlap network round trips.
        int extraWorkers = Math.min(3, objects.size() / 8);
        if (extraWorkers == 0) {
            readDdlQueue(connection, database, objects, ddls, cursor, progress);
            return ddls;
        }

        ExecutorService pool = Executors.newFixedThreadPool(extraWorkers);
        List<Future<?>> workers = new ArrayList<Future<?>>();
        try {
            for (int worker = 0; worker < extraWorkers; worker++) {
                workers.add(pool.submit(() -> {
                    try (Connection workerConnection = DriverManager.getConnection(url, user, pass)) {
                        readDdlQueue(workerConnection, database, objects, ddls, cursor, progress);
                    } catch (java.sql.SQLException error) {
                        // The catalog connection still drains the queue when extra sessions are unavailable.
                        System.err.println("WARN: 无法使用额外读取连接: " + error.getMessage());
                    }
                }));
            }
            readDdlQueue(connection, database, objects, ddls, cursor, progress);
            for (Future<?> worker : workers) worker.get();
            return ddls;
        } finally {
            pool.shutdownNow();
        }
    }

    private static void readDdlQueue(Connection connection, String database, List<String[]> objects,
                                     String[] ddls, AtomicInteger cursor, AtomicInteger progress) {
        int index;
        while ((index = cursor.getAndIncrement()) < objects.size()) {
            String[] object = objects.get(index);
            try {
                String ddl = showCreate(connection, object[1], database, object[0]);
                if (ddl != null && !ddl.trim().isEmpty()) ddls[index] = ddl.trim();
            } catch (Exception error) {
                System.err.println("WARN: " + object[1] + " " + object[0] + " 读取失败: " + error.getMessage());
            }
            synchronized (progress) {
                int done = progress.incrementAndGet();
                System.err.println("PROGRESS " + done + "/" + objects.size());
            }
        }
    }

    private static void collect(Connection connection, List<String[]> objects, String type, String sql,
                                String database, int limit) throws Exception {
        int remaining = limit - objects.size();
        if (remaining <= 0) return;
        try (java.sql.PreparedStatement statement = connection.prepareStatement(sql + " limit ?")) {
            statement.setString(1, database);
            statement.setInt(2, remaining);
            try (ResultSet rows = statement.executeQuery()) {
                while (rows.next()) {
                    objects.add(new String[] { rows.getString(1), type });
                }
            }
        }
    }

    /**
     * 按外键依赖排序表：被引用的表先读，这样顺序执行各表 DDL 时外键不会指向尚不存在的表。
     * 有环（互相引用）或自引用时保留原顺序，并把这个限制打印到 stderr。
     */
    private static List<String[]> orderTablesByDependencies(Connection connection, String database, List<String[]> tables)
            throws Exception {
        if (tables.size() < 2) return tables;
        Map<String, java.util.Set<String>> references = new LinkedHashMap<String, java.util.Set<String>>();
        for (String[] table : tables) references.put(table[0], new java.util.LinkedHashSet<String>());
        try (java.sql.PreparedStatement statement = connection.prepareStatement(
                "select table_name, referenced_table_name from information_schema.key_column_usage"
                    + " where table_schema = ? and referenced_table_name is not null")) {
            statement.setString(1, database);
            try (ResultSet rows = statement.executeQuery()) {
                while (rows.next()) {
                    String table = rows.getString(1);
                    String referenced = rows.getString(2);
                    if (table == null || referenced == null || table.equals(referenced)) continue;
                    if (references.containsKey(table) && references.containsKey(referenced)) {
                        references.get(table).add(referenced);
                    }
                }
            }
        } catch (Exception error) {
            System.err.println("WARN: 无法读取外键依赖，按名称顺序输出表: " + error.getMessage());
            return tables;
        }
        List<String[]> ordered = new ArrayList<String[]>();
        java.util.Set<String> done = new java.util.HashSet<String>();
        List<String[]> remaining = new ArrayList<String[]>(tables);
        while (!remaining.isEmpty()) {
            List<String[]> deferred = new ArrayList<String[]>();
            boolean progressed = false;
            for (String[] table : remaining) {
                boolean ready = true;
                for (String dependency : references.get(table[0])) {
                    if (!done.contains(dependency)) {
                        ready = false;
                        break;
                    }
                }
                if (ready) {
                    ordered.add(table);
                    done.add(table[0]);
                    progressed = true;
                } else {
                    deferred.add(table);
                }
            }
            if (!progressed) {
                System.err.println("WARN: 检测到循环外键依赖，以下表保持名称顺序输出，需人工调整执行顺序: " + deferred.size() + " 个");
                ordered.addAll(deferred);
                break;
            }
            remaining = deferred;
        }
        return ordered;
    }

    /** SHOW CREATE <type> 的 DDL 列位置随对象类型变化，按列名找出含 CREATE 的那一列。 */
    private static String showCreate(Connection connection, String type, String database, String name) throws Exception {
        String keyword = "EVENT".equals(type) ? "EVENT"
            : "TRIGGER".equals(type) ? "TRIGGER"
            : "VIEW".equals(type) ? "VIEW"
            : type; // PROCEDURE / FUNCTION / TABLE
        String sql = "SHOW CREATE " + keyword + " " + quoteIdent(database) + "." + quoteIdent(name);
        try (Statement statement = connection.createStatement();
             ResultSet rows = statement.executeQuery(sql)) {
            if (!rows.next()) return null;
            ResultSetMetaData meta = rows.getMetaData();
            String fallback = null;
            for (int column = 1; column <= meta.getColumnCount(); column++) {
                String label = meta.getColumnLabel(column);
                if (label == null) continue;
                String lower = label.toLowerCase();
                String value = rows.getString(column);
                if (value == null) continue;
                if (lower.startsWith("create") || lower.contains("original statement")) return value;
                if (value.toUpperCase().startsWith("CREATE ")) fallback = value;
            }
            return fallback;
        }
    }

    private static String quoteIdent(String value) {
        return "`" + value.replace("`", "``") + "`";
    }

    private static String databaseOf(String url) {
        int query = url.indexOf('?');
        String base = query < 0 ? url : url.substring(0, query);
        int slash = base.lastIndexOf('/');
        if (slash < 0 || slash == base.length() - 1) return null;
        String raw = base.substring(slash + 1);
        try {
            return java.net.URLDecoder.decode(raw, "UTF-8");
        } catch (Exception error) {
            return raw;
        }
    }

    private static String quote(String value) {
        StringBuilder builder = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char ch = value.charAt(i);
            switch (ch) {
                case '\\': builder.append("\\\\"); break;
                case '"': builder.append("\\\""); break;
                case '\n': builder.append("\\n"); break;
                case '\r': builder.append("\\r"); break;
                case '\t': builder.append("\\t"); break;
                default:
                    if (ch < 0x20) builder.append(String.format("\\u%04x", (int) ch));
                    else builder.append(ch);
            }
        }
        return builder.append('"').toString();
    }
}
