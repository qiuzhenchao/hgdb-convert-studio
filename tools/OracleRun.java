import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 极简 Oracle 脚本执行器（JDBC）：按单独一行的 "/" 切分，块语句（函数/过程/触发器/包）整体执行，
 * 其余语句按分号切分。用于在没有 sqlplus 的情况下建用户/建测试对象。
 *
 * 用法：
 *   java -cp ojdbc.jar OracleRun --url jdbc:oracle:thin:@//host:port/service --user u --password p --file x.sql
 */
public class OracleRun {

    public static void main(String[] args) throws Exception {
        String url = null, user = null, pass = null, file = null;
        for (int i = 0; i < args.length; i++) {
            String key = args[i];
            if ("--url".equals(key)) url = args[++i];
            else if ("--user".equals(key)) user = args[++i];
            else if ("--password".equals(key)) pass = args[++i];
            else if ("--file".equals(key)) file = args[++i];
            else throw new IllegalArgumentException("未知参数: " + key);
        }
        if (url == null || user == null || file == null) {
            System.err.println("需要 --url / --user / --file");
            System.exit(2);
        }
        String text = new String(Files.readAllBytes(Paths.get(file)), StandardCharsets.UTF_8);
        text = text.replace("\r\n", "\n").replace('\r', '\n');
        if (text.startsWith("\uFEFF")) text = text.substring(1);
        String[] chunks = text.split("(?m)^[ \\t]*/[ \\t]*$");
        List<String> units = new java.util.ArrayList<String>();
        for (String chunk : chunks) {
            for (String unit : chunk.split("(?m)(?=^\\s*CREATE\\s+OR\\s+REPLACE\\s+)")) {
                if (!unit.trim().isEmpty()) units.add(unit);
            }
        }
        try { Class.forName("oracle.jdbc.OracleDriver"); } catch (Throwable ignored) { }
        int ok = 0, failed = 0;
        try (Connection connection = DriverManager.getConnection(url, user, pass)) {
            for (String unit : units) {
                String body = unit.trim();
                if (body.isEmpty()) continue;
                List<String> statements = isBlock(body) ? Arrays.asList(body) : splitPlain(body);
                for (String raw : statements) {
                    String sql = raw.trim();
                    if (sql.isEmpty()) continue;
                    if (!isBlock(sql)) sql = sql.replaceAll(";\\s*$", "").trim();
                    if (sql.isEmpty()) continue;
                    try (Statement statement = connection.createStatement()) {
                        statement.execute(sql);
                        ok++;
                    } catch (SQLException error) {
                        failed++;
                        String head = sql.replaceAll("\\s+", " ");
                        if (head.length() > 90) head = head.substring(0, 90) + " ...";
                        System.out.println("FAILED: " + head + " => " + error.getMessage());
                    }
                }
            }
        }
        System.out.println("ok=" + ok + " failed=" + failed);
        if (failed > 0) System.exit(1);
    }

    private static boolean isBlock(String sql) {
        String body = sql.replaceAll("(?m)^\\s*--.*$", "").trim().toUpperCase();
        return body.startsWith("CREATE OR REPLACE FUNCTION")
            || body.startsWith("CREATE OR REPLACE PROCEDURE")
            || body.startsWith("CREATE OR REPLACE TRIGGER")
            || body.startsWith("CREATE OR REPLACE PACKAGE")
            || body.startsWith("CREATE OR REPLACE TYPE")
            || body.startsWith("BEGIN")
            || body.startsWith("DECLARE");
    }

    private static List<String> splitPlain(String text) {
        List<String> out = new ArrayList<String>();
        StringBuilder current = new StringBuilder();
        boolean single = false, quoted = false, lineComment = false, blockComment = false;
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            char next = i + 1 < text.length() ? text.charAt(i + 1) : '\0';
            if (lineComment) {
                current.append(ch);
                if (ch == '\n') lineComment = false;
                continue;
            }
            if (blockComment) {
                current.append(ch);
                if (ch == '*' && next == '/') { current.append(next); i++; blockComment = false; }
                continue;
            }
            if (single) {
                current.append(ch);
                if (ch == '\'') {
                    if (next == '\'') { current.append(next); i++; }
                    else single = false;
                }
                continue;
            }
            if (quoted) {
                current.append(ch);
                if (ch == '"') quoted = false;
                continue;
            }
            if (ch == '-' && next == '-') { current.append("--"); i++; lineComment = true; continue; }
            if (ch == '/' && next == '*') { current.append("/*"); i++; blockComment = true; continue; }
            if (ch == '\'') { current.append(ch); single = true; continue; }
            if (ch == '"') { current.append(ch); quoted = true; continue; }
            if (ch == ';') { out.add(current.toString()); current.setLength(0); continue; }
            current.append(ch);
        }
        if (current.toString().trim().length() > 0) out.add(current.toString());
        return out;
    }
}