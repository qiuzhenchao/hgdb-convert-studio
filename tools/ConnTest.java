import java.sql.Connection;
import java.sql.DriverManager;

/**
 * 最小连接测试器：只验证 JDBC 登录，不执行 SQL 或读取数据库元数据。
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
        String url = null, user = null, pass = null, drivers = null;
        for (int i = 0; i < argv.length; i++) {
            String key = argv[i];
            if ("--url".equals(key)) url = argv[++i];
            else if ("--user".equals(key)) user = argv[++i];
            else if ("--password".equals(key)) pass = argv[++i];
            else if ("--driver".equals(key)) drivers = argv[++i];
            else throw new IllegalArgumentException("未知参数: " + key);
        }
        if (url == null || user == null) {
            System.err.println("需要 --url 与 --user");
            System.exit(2);
        }
        // 显式指定驱动类时优先按给定顺序加载；否则加载内置三种常见驱动
        if (drivers != null && !drivers.trim().isEmpty()) {
            for (String name : drivers.split(",")) {
                String value = name.trim();
                if (!value.isEmpty()) loadDriver(value);
            }
        }
        loadDriver("org.postgresql.Driver");
        loadDriver("oracle.jdbc.OracleDriver");
        loadDriver("com.mysql.cj.jdbc.Driver");
        try (Connection connection = DriverManager.getConnection(url, user, pass)) {
            System.out.println("OK");
        }
    }
}