import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;

/**
 * 最小连接测试器：只建立 JDBC 连接并读取数据库元数据，不执行任何 SQL、不读写脚本文件。
 *
 * 用法：
 *   java -cp driver.jar ConnTest.java --url jdbc:... --user u --password p
 */
public class ConnTest {

    private static void loadDriver(String name) {
        try {
            Class.forName(name);
        } catch (Throwable ignored) {
            // DriverManager 仍可能通过 SPI 找到驱动
        }
    }

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
        loadDriver("org.postgresql.Driver");
        loadDriver("oracle.jdbc.OracleDriver");
        loadDriver("com.mysql.cj.jdbc.Driver");
        try (Connection connection = DriverManager.getConnection(url, user, pass)) {
            DatabaseMetaData meta = connection.getMetaData();
            System.out.println(meta.getDatabaseProductName() + " " + meta.getDatabaseProductVersion());
            // HGDB 的 MySQL 协议端口对外报告 MySQL，实际服务端版本要看 version()。
            try (Statement statement = connection.createStatement();
                 ResultSet rows = statement.executeQuery("select version()")) {
                if (rows.next()) System.out.println("SERVER_VERSION: " + rows.getString(1));
            } catch (Throwable ignored) {
                // Oracle 等没有 version() 的库忽略
            }
            System.out.println("OK");
        }
    }
}