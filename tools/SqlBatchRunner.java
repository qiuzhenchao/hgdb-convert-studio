import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.sql.*;
import java.util.*;

/**
 * 批量执行器：一次 JVM 启动、一次 JDBC 连接执行多个脚本文件。
 *
 * 与逐个文件单独起进程相比，避免了几百次 JVM 启动与重复登录，
 * 把「执行到目标库」的耗时从 N ×(启动+登录+执行) 降到 启动+登录+N×执行。
 *
 * 用法：
 *   java SqlBatchRunner --url jdbc:... --user u --password p --dir <临时目录> [--schema s]
 * 目录内约定：<id>.sql（id 不能含路径分隔符），按文件名排序执行。
 * 输出：每个文件一行 JSON：{"id":"...","ok":true,"error":"","statements":3}
 * 最后一行：{"summary":true,"files":N,"ok":N,"failed":N}
 */
public class SqlBatchRunner {

    public static void main(String[] argv) throws Exception {
        String url = null, user = null, pass = null, dir = null, schema = "";
        for (int i = 0; i < argv.length; i++) {
            String key = argv[i];
            if ("--url".equals(key)) url = argv[++i];
            else if ("--user".equals(key)) user = argv[++i];
            else if ("--password".equals(key)) pass = argv[++i];
            else if ("--dir".equals(key)) dir = argv[++i];
            else if ("--schema".equals(key)) schema = argv[++i];
            else throw new IllegalArgumentException("unknown arg: " + key);
        }
        if (url == null || dir == null) {
            System.err.println("need --url and --dir");
            System.exit(2);
            return;
        }
        PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
        Path root = Paths.get(dir);
        List<Path> files = new ArrayList<Path>();
        DirectoryStream<Path> stream = Files.newDirectoryStream(root, "*.sql");
        try {
            for (Path path : stream) files.add(path);
        } finally {
            stream.close();
        }
        Collections.sort(files, new Comparator<Path>() {
            public int compare(Path a, Path b) {
                return a.getFileName().toString().compareTo(b.getFileName().toString());
            }
        });

        int okFiles = 0, failedFiles = 0;
        try {
            Class.forName("org.postgresql.Driver");
        } catch (Throwable ignored) {
            // MySQL 目标用 mysql 驱动，PG 驱动缺失不影响。
        }
        try {
            Class.forName("com.mysql.cj.jdbc.Driver");
        } catch (Throwable ignored) {
            // PG 目标不需要 mysql 驱动。
        }

        Connection conn;
        try {
            conn = DriverManager.getConnection(url, user, pass);
        } catch (Throwable error) {
            String message = error.getMessage() == null ? error.toString() : error.getMessage();
            for (Path path : files) {
                out.println(resultLine(stripExt(path.getFileName().toString()), false, "连接失败：" + oneLine(message), 0));
            }
            out.println("{\"summary\":true,\"files\":" + files.size() + ",\"ok\":0,\"failed\":" + files.size() + "}");
            System.exit(1);
            return;
        }

        try {
            conn.setAutoCommit(true);
            if (schema != null && !schema.trim().isEmpty()) {
                String target = schema.trim();
                // 目标 schema 不存在时先创建，避免每条 DDL 都报 "no schema has been selected to create in"。
                try (Statement st = conn.createStatement()) {
                    st.execute("CREATE SCHEMA IF NOT EXISTS " + quoteIdent(target));
                } catch (SQLException ignored) {
                    // 没有建 schema 权限或目标不支持时忽略：后面的 search_path 会给出真实错误。
                }
                try (Statement st = conn.createStatement()) {
                    st.execute("SET search_path TO " + quoteIdent(target));
                } catch (SQLException ignored) {
                    // MySQL 协议目标没有 search_path，schema 即数据库，忽略即可。
                }
            }

            Statement statement = null;
            for (Path path : files) {
                String id = stripExt(path.getFileName().toString());
                String text = new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
                List<String> statements = splitStatements(text);
                String firstError = "";
                int executed = 0;
                for (String sql : statements) {
                    if (sql.trim().isEmpty()) continue;
                    try {
                        if (statement == null) statement = conn.createStatement();
                        statement.execute(sql);
                        executed++;
                    } catch (SQLException error) {
                        if (statement != null) {
                            try {
                                statement.close();
                            } catch (SQLException ignored) {
                                // ignore
                            }
                            statement = null;
                        }
                        if (firstError.isEmpty()) {
                            String message = error.getMessage() == null ? error.toString() : error.getMessage();
                            firstError = "ERROR: " + oneLine(message);
                        }
                        break;
                    }
                }
                boolean ok = firstError.isEmpty();
                if (ok) okFiles++;
                else failedFiles++;
                out.println(resultLine(id, ok, firstError, executed));
            }
            if (statement != null) {
                try {
                    statement.close();
                } catch (SQLException ignored) {
                    // ignore
                }
            }
        } finally {
            try {
                conn.close();
            } catch (SQLException ignored) {
                // ignore
            }
        }
        out.println("{\"summary\":true,\"files\":" + files.size() + ",\"ok\":" + okFiles + ",\"failed\":" + failedFiles + "}");
        System.exit(0);
    }

    private static String stripExt(String name) {
        int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) : name;
    }

    /** 简单标识符直接使用，含特殊字符时加双引号。 */
    private static String quoteIdent(String raw) {
        String name = raw.trim();
        if (name.matches("[A-Za-z_][A-Za-z0-9_$]*")) return name;
        return "\"" + name.replace("\"", "\"\"") + "\"";
    }

    private static String oneLine(String text) {
        String value = text.replaceAll("\\s+", " ").trim();
        return value.length() > 300 ? value.substring(0, 300) + " ..." : value;
    }

    private static String resultLine(String id, boolean ok, String error, int statements) {
        return "{\"id\":" + json(id) + ",\"ok\":" + ok + ",\"error\":" + json(error)
            + ",\"statements\":" + statements + "}";
    }

    private static String json(String value) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
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

    /** 按顶层分号切分语句：跳过注释、字符串、$tag$ 引用与 BEGIN/END 复合块。 */
    static List<String> splitStatements(String source) {
        List<String> statements = new ArrayList<String>();
        StringBuilder current = new StringBuilder();
        int depth = 0;
        int i = 0;
        int length = source.length();
        while (i < length) {
            char c = source.charAt(i);
            // 行注释
            if (c == '-' && i + 1 < length && source.charAt(i + 1) == '-') {
                int end = source.indexOf('\n', i);
                if (end < 0) end = length;
                current.append(source, i, end);
                i = end;
                continue;
            }
            // 块注释
            if (c == '/' && i + 1 < length && source.charAt(i + 1) == '*') {
                int end = source.indexOf("*/", i + 2);
                end = end < 0 ? length : end + 2;
                current.append(source, i, end);
                i = end;
                continue;
            }
            // 单引号字符串（'' 转义）
            if (c == '\'') {
                current.append(c);
                i++;
                while (i < length) {
                    char d = source.charAt(i);
                    current.append(d);
                    if (d == '\'') {
                        if (i + 1 < length && source.charAt(i + 1) == '\'') {
                            current.append('\'');
                            i += 2;
                            continue;
                        }
                        i++;
                        break;
                    }
                    i++;
                }
                continue;
            }
            // 双引号标识符
            if (c == '"') {
                current.append(c);
                i++;
                while (i < length) {
                    char d = source.charAt(i);
                    current.append(d);
                    if (d == '"') {
                        if (i + 1 < length && source.charAt(i + 1) == '"') {
                            current.append('"');
                            i += 2;
                            continue;
                        }
                        i++;
                        break;
                    }
                    i++;
                }
                continue;
            }
            // $tag$ ... $tag$ 引用
            if (c == '$') {
                int tagEnd = i + 1;
                while (tagEnd < length && (Character.isLetterOrDigit(source.charAt(tagEnd)) || source.charAt(tagEnd) == '_')) {
                    tagEnd++;
                }
                if (tagEnd < length && source.charAt(tagEnd) == '$') {
                    String tag = source.substring(i, tagEnd + 1);
                    int close = source.indexOf(tag, tagEnd + 1);
                    int end = close < 0 ? length : close + tag.length();
                    current.append(source, i, end);
                    i = end;
                    continue;
                }
            }
            // 复合块深度：只统计 BEGIN / CASE，END 需排除 END IF / END CASE / END LOOP
            if (Character.isLetter(c)) {
                int wordEnd = i;
                while (wordEnd < length && (Character.isLetter(source.charAt(wordEnd)) || source.charAt(wordEnd) == '_')) wordEnd++;
                String word = source.substring(i, wordEnd).toUpperCase();
                current.append(source, i, wordEnd);
                if (isBlockStart(word)) {
                    depth++;
                } else if ("END".equals(word) && depth > 0) {
                    int next = wordEnd;
                    while (next < length && Character.isWhitespace(source.charAt(next))) next++;
                    int nextEnd = next;
                    while (nextEnd < length && Character.isLetter(source.charAt(nextEnd))) nextEnd++;
                    String follower = nextEnd > next ? source.substring(next, nextEnd).toUpperCase() : "";
                    // END IF / END CASE / END LOOP 只是结束控制结构，真正的块结束才减少深度
                    if (!"IF".equals(follower) && !"CASE".equals(follower) && !"LOOP".equals(follower)) {
                        depth--;
                    }
                }
                i = wordEnd;
                continue;
            }
            if (c == ';' && depth == 0) {
                statements.add(current.toString().trim());
                current.setLength(0);
                i++;
                continue;
            }
            current.append(c);
            i++;
        }
        if (current.toString().trim().length() > 0) statements.add(current.toString().trim());
        List<String> cleaned = new ArrayList<String>();
        for (String statement : statements) {
            String trimmed = statement.trim();
            if (trimmed.isEmpty()) continue;
            if ("/".equals(trimmed)) continue;
            cleaned.add(trimmed);
        }
        return cleaned;
    }

    private static boolean isBlockStart(String word) {
        // IF / LOOP / DECLARE 不作为独立块计数：它们总以 END IF / END LOOP 结束，
        // 由 END 的后一个单词判断；只有 BEGIN 与 CASE 会真正抬高分号切分深度。
        return "BEGIN".equals(word) || "CASE".equals(word);
    }
}