import java.sql.CallableStatement;
import java.sql.Clob;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 从 Oracle 源库读取对象清单与 DDL，输出一个 JSON 数组（name/type/ddl）。
 * 只读：仅查询数据字典并调用 DBMS_METADATA.GET_DDL，不修改任何对象。
 *
 * 提速做法：先用一条查询拿到对象清单，再用多个连接并行取 DDL（默认 6 路），
 * 避免 200 次串行往返。
 *
 * 用法：
 *   java -cp ojdbc.jar ReadObjects --url jdbc:oracle:thin:@//host:port/service \
 *        --user u --password p [--schema OWNER] [--types ...] [--limit 200] [--workers 6]
 */
public class ReadObjects {

    private static final String DEFAULT_TYPES =
        "FUNCTION,PROCEDURE,PACKAGE,PACKAGE BODY,TRIGGER,VIEW,MATERIALIZED VIEW,TABLE,TYPE,SEQUENCE,SYNONYM,JOB";

    private static final java.util.Set<String> SYSTEM_SCHEMAS = new java.util.HashSet<String>(java.util.Arrays.asList(
        "SYS", "SYSTEM", "SYSMAN", "DBSNMP", "OUTLN", "XDB", "WMSYS", "CTXSYS", "MDSYS", "ORDSYS",
        "OLAPSYS", "LBACSYS", "DVSYS", "AUDSYS", "GSMADMIN_INTERNAL", "APPQOSSYS", "ANONYMOUS", "PUBLIC"));

    public static void main(String[] argv) throws Exception {
        String url = null, user = null, pass = null, schema = null, types = DEFAULT_TYPES;
        int limit = 200, workers = 6;
        for (int i = 0; i < argv.length; i++) {
            String key = argv[i];
            if ("--url".equals(key)) url = argv[++i];
            else if ("--user".equals(key)) user = argv[++i];
            else if ("--password".equals(key)) pass = argv[++i];
            else if ("--schema".equals(key)) schema = argv[++i];
            else if ("--types".equals(key)) types = argv[++i];
            else if ("--limit".equals(key)) limit = Integer.parseInt(argv[++i]);
            else if ("--workers".equals(key)) workers = Math.max(1, Math.min(12, Integer.parseInt(argv[++i])));
            else throw new IllegalArgumentException("未知参数: " + key);
        }
        if (url == null || user == null) {
            System.err.println("需要 --url 与 --user");
            System.exit(2);
        }
        if (schema == null || schema.trim().isEmpty()) schema = user;
        final String owner = schema.trim().toUpperCase();
        if (SYSTEM_SCHEMAS.contains(owner)) {
            System.err.println("当前 schema '" + owner + "' 属于系统模式，读取会返回系统对象；请在「管理连接」里把该连接的默认 schema 设为业务用户后再读取");
            System.exit(3);
        }

        List<String> typeList = new ArrayList<String>();
        for (String item : types.split(",")) {
            String value = item.trim();
            if (!value.isEmpty()) typeList.add(value.toUpperCase());
        }
        if (typeList.isEmpty()) typeList.add("FUNCTION");
        // JOB 不在 ALL_OBJECTS 里，单独从 ALL_SCHEDULER_JOBS 读取并还原成 DDL。
        final boolean wantJobs = typeList.remove("JOB");
        if (typeList.isEmpty() && !wantJobs) typeList.add("FUNCTION");

        Class.forName("oracle.jdbc.OracleDriver");

        final List<String[]> objects = new ArrayList<String[]>();
        final Map<String, String> jobDdls = new LinkedHashMap<String, String>();
        try (Connection connection = DriverManager.getConnection(url, user, pass)) {
            java.util.Set<String> mviewNames = new java.util.HashSet<String>();
            try (PreparedStatement mviews = connection.prepareStatement(
                    "select mview_name from all_mviews where owner = ?")) {
                mviews.setString(1, owner);
                try (ResultSet rows = mviews.executeQuery()) {
                    while (rows.next()) mviewNames.add(rows.getString(1));
                }
            }
            StringBuilder marks = new StringBuilder();
            for (int i = 0; i < typeList.size(); i++) {
                if (i > 0) marks.append(',');
                marks.append('?');
            }
            if (!typeList.isEmpty()) {
                String sql = "select object_name, object_type from all_objects where owner = ?"
                    + " and object_type in (" + marks + ")"
                    + " and object_name not like 'BIN$%'"
                    + " and object_name not like 'DBMS%'"
                    + " and object_name not like 'ORA%'"
                    + " and object_name not like 'UTL%'"
                    + " and object_name not like 'LOGMNR%'"
                    + " and object_name not like 'MVIEW%'"
                    + " and object_name not like 'REPCAT%'"
                    + " and object_name not like 'DEF$%'"
                    + " and object_name not like 'KUP%'"
                    + " and object_name not like 'SYS%'"
                    + " and object_name not like 'AQ$%'"
                    + " and object_name not like '%$%'"
                    + " order by object_type, object_name";
                try (PreparedStatement statement = connection.prepareStatement(sql)) {
                    int index = 1;
                    statement.setString(index++, owner);
                    for (String type : typeList) statement.setString(index++, type);
                    try (ResultSet rows = statement.executeQuery()) {
                        while (rows.next() && objects.size() < limit) {
                            String objectName = rows.getString(1);
                            String objectType = rows.getString(2);
                            if ("TABLE".equals(objectType) && mviewNames.contains(objectName)) continue;
                            objects.add(new String[] { objectName, objectType });
                        }
                    }
                }
            }
            if (wantJobs) {
                String jobSql = "select job_name, enabled, job_type, job_action, repeat_interval,"
                    + " to_char(start_date, 'YYYY-MM-DD HH24:MI:SS'), comments, program_name, schedule_name"
                    + " from all_scheduler_jobs where owner = ? order by job_name";
                try (PreparedStatement jobs = connection.prepareStatement(jobSql)) {
                    jobs.setString(1, owner);
                    try (ResultSet rows = jobs.executeQuery()) {
                        while (rows.next() && objects.size() < limit) {
                            String jobName = rows.getString(1);
                            objects.add(new String[] { jobName, "JOB" });
                            jobDdls.put(jobName, jobDdl(owner, jobName, rows.getString(2), rows.getString(3),
                                rows.getString(4), rows.getString(5), rows.getString(6), rows.getString(7),
                                rows.getString(8), rows.getString(9)));
                        }
                    }
                }
            }
        }

        final String[] ddls = new String[objects.size()];
        final AtomicInteger cursor = new AtomicInteger(0);
        final int workerCount = Math.min(workers, Math.max(1, objects.size()));
        final CountDownLatch latch = new CountDownLatch(workerCount);
        ExecutorService pool = Executors.newFixedThreadPool(workerCount);
        final String jdbcUrl = url, jdbcUser = user, jdbcPass = pass;
        for (int w = 0; w < workerCount; w++) {
            pool.submit(new Runnable() {
                @Override
                public void run() {
                    try (Connection connection = DriverManager.getConnection(jdbcUrl, jdbcUser, jdbcPass)) {
                        int index;
                        while ((index = cursor.getAndIncrement()) < objects.size()) {
                            String[] object = objects.get(index);
                            if ("JOB".equals(object[1])) {
                                ddls[index] = jobDdls.get(object[0]);
                            } else {
                                ddls[index] = ddlOf(connection, object[1], object[0], owner);
                            }
                        }
                    } catch (Throwable ignored) {
                        // 单个连接失败不影响其他分片
                    } finally {
                        latch.countDown();
                    }
                }
            });
        }
        latch.await();
        pool.shutdown();

        StringBuilder out = new StringBuilder("[");
        boolean first = true;
        for (int i = 0; i < objects.size(); i++) {
            if (ddls[i] == null || ddls[i].trim().isEmpty()) continue;
            String[] object = objects.get(i);
            if (!first) out.append(',');
            first = false;
            out.append("{\"name\":").append(quote(object[0]))
               .append(",\"type\":").append(quote(object[1]))
               .append(",\"ddl\":").append(quote(ddls[i])).append('}');
        }
        out.append(']');
        System.out.println(out.toString());
    }

    /** 用 ALL_SCHEDULER_JOBS 的字段还原可重放的 DBMS_SCHEDULER.CREATE_JOB 脚本。 */
    private static String jobDdl(String owner, String name, String enabled, String jobType, String action,
                                 String repeat, String startDate, String comments, String program, String schedule) {
        StringBuilder ddl = new StringBuilder();
        ddl.append("BEGIN\n  DBMS_SCHEDULER.CREATE_JOB(\n");
        ddl.append("    job_name => '").append(owner).append('.').append(name).append("',\n");
        if (program != null && !program.isEmpty()) {
            ddl.append("    program_name => '").append(owner).append('.').append(program).append("',\n");
            if (schedule != null && !schedule.isEmpty()) {
                ddl.append("    schedule_name => '").append(owner).append('.').append(schedule).append("',\n");
            } else if (repeat != null && !repeat.isEmpty()) {
                ddl.append("    repeat_interval => '").append(escapeSql(repeat)).append("',\n");
            }
        } else {
            ddl.append("    job_type => '").append(escapeSql(jobType == null ? "PLSQL_BLOCK" : jobType)).append("',\n");
            ddl.append("    job_action => '").append(escapeSql(action == null ? "" : action)).append("',\n");
            if (repeat != null && !repeat.isEmpty()) {
                ddl.append("    repeat_interval => '").append(escapeSql(repeat)).append("',\n");
            }
        }
        if (startDate != null && !startDate.isEmpty()) {
            ddl.append("    start_date => TO_TIMESTAMP('").append(startDate).append("', 'YYYY-MM-DD HH24:MI:SS'),\n");
        }
        ddl.append("    enabled => ").append("TRUE".equalsIgnoreCase(enabled) ? "TRUE" : "FALSE").append(",\n");
        if (comments != null && !comments.isEmpty()) {
            ddl.append("    comments => '").append(escapeSql(comments)).append("',\n");
        }
        ddl.append("    auto_drop => FALSE);\nEND;\n/");
        return ddl.toString();
    }

    private static String escapeSql(String value) {
        return value == null ? "" : value.replace("'", "''");
    }

    private static String ddlOf(Connection connection, String type, String name, String owner) {
        String metadataType = type.replace(' ', '_');
        try (CallableStatement call = connection.prepareCall("{ ? = call dbms_metadata.get_ddl(?,?,?) }")) {
            call.registerOutParameter(1, Types.CLOB);
            call.setString(2, metadataType);
            call.setString(3, name);
            call.setString(4, owner);
            call.execute();
            Clob clob = call.getClob(1);
            if (clob == null) return null;
            long length = clob.length();
            String value = clob.getSubString(1, (int) Math.min(length, 800000));
            if (value == null) return null;
            value = value.trim();
            if ("PACKAGE".equals(type)) {
                int bodyAt = value.toUpperCase().indexOf("CREATE OR REPLACE PACKAGE BODY");
                if (bodyAt > 0) value = value.substring(0, bodyAt).trim();
                if (!value.endsWith(";")) value = value + ";";
            }
            if ("TYPE".equals(type)) {
                int bodyAt = value.toUpperCase().indexOf("CREATE OR REPLACE TYPE BODY");
                if (bodyAt > 0) value = value.substring(0, bodyAt).trim();
                if (!value.endsWith(";")) value = value + ";";
            }
            return value;
        } catch (SQLException error) {
            return null;
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