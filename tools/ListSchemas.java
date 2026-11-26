import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.List;

/**
 * 列出目标库可用的 schema（模式），输出 JSON 数组。
 *
 * 支持两类目标：
 *   PostgreSQL 协议（HGDB-V9-PostgreSQL / Oracle）：
 *     java -cp postgresql.jar ListSchemas --url jdbc:postgresql://host:port/db --user u --password p
 *   MySQL 协议（HGDB-V9-MySQL，schema 即数据库）：
 *     java -cp mysql.jar ListSchemas --url jdbc:mysql://host:port/db --user u --password p
 */
public class ListSchemas {

    public static void main(String[] argv) throws Exception {
        String url = null, user = null, pass = null;
        for (int i = 0; i < argv.length; i++) {
            String key = argv[i];
            if ("--url".equals(key)) url = argv[++i];
            else if ("--user".equals(key)) user = argv[++i];
            else if ("--password".equals(key)) pass = argv[++i];
            else throw new IllegalArgumentException("未知参数: " + key);
        }
        if (url == null || user == null) {
            System.err.println("需要 --url 与 --user");
            System.exit(2);
        }
        try {
            Class.forName("org.postgresql.Driver");
        } catch (Throwable ignored) {
            // 兼容只用 MySQL 驱动连接 HGDB 的 MySQL 协议端口
        }
        // HGDB 的 MySQL 协议端口用 MySQL 驱动连接，这里允许按驱动存在性加载。
        try {
            Class.forName("com.mysql.cj.jdbc.Driver");
        } catch (Throwable ignored) {
            // DriverManager 仍可能通过 SPI 找到驱动
        }
        List<String> names = new ArrayList<String>();
        try (Connection connection = DriverManager.getConnection(url, user, pass);
             PreparedStatement statement = connection.prepareStatement(
                 "select schema_name from information_schema.schemata"
                     + " where schema_name not in ('pg_catalog', 'information_schema', 'sys', 'wmsys', 'hg_misc', 'hg_security', 'pgagent')"
                     + " and schema_name not like 'pg%'"
                     + " order by schema_name");
             ResultSet rows = statement.executeQuery()) {
            while (rows.next()) names.add(rows.getString(1));
        }
        StringBuilder out = new StringBuilder("[");
        for (int i = 0; i < names.size(); i++) {
            if (i > 0) out.append(',');
            out.append(quote(names.get(i)));
        }
        out.append(']');
        System.out.println(out.toString());
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
                default: builder.append(ch);
            }
        }
        return builder.append('"').toString();
    }
}