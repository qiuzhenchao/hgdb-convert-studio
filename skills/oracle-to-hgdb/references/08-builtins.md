# 08 内置函数与系统包

## 1. 空值 / 条件

| Oracle | PG14 | 备注 |
|---|---|---|
| `NVL(a, b)` | `COALESCE(a, b)` | |
| `NVL2(a, b, c)` | `CASE WHEN a IS NOT NULL THEN b ELSE c END` | |
| `DECODE(x, v, r, ..., def)` | `CASE WHEN x IS NOT DISTINCT FROM v THEN r ... ELSE def END` | 含 NULL 时用 `IS NOT DISTINCT FROM` |
| `LNNVL(cond)` | `cond IS NOT TRUE` | |
| `NULLIF(a, b)` | `NULLIF(a, b)` | |
| `COALESCE(a, b, ...)` | `COALESCE(a, b, ...)` | |
| `NANVL(x, y)` | `CASE WHEN x = 'NaN'::numeric THEN y ELSE x END` | `NaN` 仅 numeric/float |
| `GREATEST(a, b)` | `GREATEST(a, b)` | Oracle 忽略 NULL，PG 返回 NULL；见 02 §4 |
| `LEAST(a, b)` | `LEAST(a, b)` | 同上 |
| `CASE ... END` | 同 | |

## 2. 字符串

| Oracle | PG14 |
|---|---|
| `SUBSTR(s, p, l)` | `substr(s, p, l)`（负 p / p=0 需改写，见 02 §10） |
| `SUBSTRB` | `convert_from(substring(convert_to(s,'UTF8') from p for l),'UTF8')` |
| `INSTR(s, sub)` | `strpos(s, sub)` |
| `INSTR(s, sub, p, n)` | 辅助函数（02 §10） |
| `INSTRB` | `strpos(convert_to(s,'UTF8'), convert_to(sub,'UTF8'))` |
| `LENGTH(s)` / `LENGTHC(s)` | `length(s)` |
| `LENGTHB(s)` | `octet_length(s)` |
| `LPAD(s, n, pad)` / `RPAD` | 同名 |
| `LTRIM` / `RTRIM` / `TRIM` | 同名 |
| `REPLACE(s, a, b)` | 同名 |
| `TRANSLATE(s, from, to)` | 同名 |
| `INITCAP` / `UPPER` / `LOWER` | 同名 |
| `ASCII(c)` / `CHR(n)` | `ascii(c)` / `chr(n)` |
| `CONCAT(a, b)` | `a || b` |
| `REGEXP_LIKE(s, p)` | `s ~ p` |
| `REGEXP_SUBSTR(s, p, pos, n)` | `substring(s from p)`（首次）；多次用 `regexp_matches(s, p, 'g')` |
| `REGEXP_REPLACE(s, p, r)` | `regexp_replace(s, p, r, 'g')`（PG 默认只替换第一处，`'g'` 才替换全部；Oracle 默认全部） |
| `REGEXP_INSTR` | PG15+ `regexp_instr`；PG14 用辅助函数 |
| `REGEXP_COUNT` | 无内置；辅助函数 |
| `SOUNDEX` | `soundex`（`fuzzystrmatch` 扩展） |
| `NLSSORT` | `COLLATE "..."` |
| `WM_CONCAT(x)` | `string_agg(x, ',')` |
| `TO_SINGLE_BYTE` | 无 |
| `NLS_UPPER/LOWER` | `upper/lower`（`lc_ctype` 影响） |

正则注意：Oracle 与 PG 都支持 POSIX 字符类 `[[:alpha:]]`；但替换串的反向引用、`REGEXP_SUBSTR` 的 occurrence 参数、`MATCH_PARAMETER`（`'i'`/`'c'`）写法不同。PG 的 flags 用 `'i'`、`'g'`、`'n'` 等。

## 3. 数字

| Oracle | PG14 |
|---|---|
| `ABS` / `CEIL` / `FLOOR` / `MOD` / `POWER` / `SQRT` / `EXP` / `LN` | 同名 |
| `LOG(b, x)` | `log(b, x)` |
| `ROUND(n, d)` / `TRUNC(n, d)` | 同名（numeric） |
| `SIGN(n)` | `sign(n)` |
| `BITAND(a, b)` | `(a::bigint & b::bigint)` |
| `REMAINDER(a, b)` | `a - b * round(a / b)`（Oracle 语义） |
| `WIDTH_BUCKET` | `width_bucket` |
| `BIN_TO_NUM(...)` | 位运算手写 |
| `TO_BINARY_DOUBLE/FLOAT` | `::double precision` / `::real` |

`ROUND`/`TRUNC` 只对 `numeric` 稳定；`double precision` 有二进制误差，金额不要用浮点。

## 4. 日期时间

| Oracle | PG14 | 备注 |
|---|---|---|
| `SYSDATE` | `LOCALTIMESTAMP(0)` | 事务开始时间；实时用 `clock_timestamp()` |
| `SYSTIMESTAMP` | `CURRENT_TIMESTAMP` | |
| `CURRENT_DATE` | `CURRENT_DATE` | |
| `CURRENT_TIMESTAMP` | `CURRENT_TIMESTAMP` | 事务开始时间 |
| `LOCALTIMESTAMP` | `LOCALTIMESTAMP` | |
| `ADD_MONTHS(d, n)` | `d + make_interval(months => n)` | 月末自动截断 |
| `MONTHS_BETWEEN(a, b)` | 辅助函数（02 §9） | 精确整月；小数按 31 天 |
| `LAST_DAY(d)` | `(date_trunc('month', d) + interval '1 month - 1 day')::date` | |
| `NEXT_DAY(d, 'MON')` | 模板（02 §9） | |
| `TRUNC(d[, fmt])` | `date_trunc(...)` / `CURRENT_DATE` | `fmt` 见 02 §9 |
| `ROUND(d[, fmt])` | 手写 | 无直接等价 |
| `EXTRACT(part FROM x)` | 同名 | `DOW` 编号不同，见下 |
| `SYS_EXTRACT_UTC(ts)` | `ts AT TIME ZONE 'UTC'` | |
| `FROM_TZ(ts, tz)` | `ts AT TIME ZONE tz` | |
| `TO_TIMESTAMP(s, fmt)` | `to_timestamp(s, fmt)` | |
| `TO_DSINTERVAL` / `TO_YMINTERVAL` | `::interval` / `make_interval` | |
| `NUMTODSINTERVAL(n, unit)` | `n * ('1 ' \|\| unit)::interval` | |
| `NUMTOYMINTERVAL(n, 'MONTH')` | `make_interval(months => n)` | |
| `DBTIMEZONE` / `SESSIONTIMEZONE` | `current_setting('TimeZone')` | |
| `TZ_OFFSET` | 无 | |

`EXTRACT(DOW)` 与 `TO_CHAR(d,'D')`：Oracle `D` 是 1（周日）到 7（周六）；PG `extract(dow)` 是 0（周日）到 6（周六）。`extract(isodow)` 是 1（周一）到 7（周日），与 Oracle 的 `IW` 周一致。

## 5. 转换与编码

| Oracle | PG14 |
|---|---|
| `TO_CHAR(x[, fmt])` | `to_char(x[, fmt])`（数字格式串见 02 §9） |
| `TO_DATE(s[, fmt])` | `to_date(s[, fmt])` |
| `TO_NUMBER(s[, fmt])` | `s::numeric` 或 `to_number(s, fmt)` |
| `TO_CLOB(s)` / `TO_NCLOB(s)` | `s::text` |
| `TO_BLOB(raw)` / `TO_RAW(blob)` | `::bytea` |
| `CAST(x AS type)` | 同 |
| `RAWTOHEX(r)` / `HEXTORAW(s)` | `encode(r,'hex')` / `decode(s,'hex')` |
| `UTL_ENCODE.BASE64_ENCODE` | `encode(x,'base64')` |
| `UTL_ENCODE.BASE64_DECODE` | `decode(x,'base64')` |
| `STANDARD_HASH(x, 'SHA256')` | `digest(x, 'sha256')`（`pgcrypto`） |
| `SYS_GUID()` | `gen_random_uuid()`（PG13+ 内置） |
| `DBMS_UTILITY.COMMA_TO_TABLE` | `string_to_array(s, ',')` |
| `DBMS_UTILITY.TABLE_TO_COMMA` | `array_to_string(arr, ',')` |

## 6. 聚合 / 分析

| Oracle | PG14 |
|---|---|
| `SUM/AVG/COUNT/MIN/MAX` | 同名 |
| `STDDEV` / `STDDEV_POP` / `STDDEV_SAMP` | `stddev` / `stddev_pop` / `stddev_samp` |
| `VARIANCE` / `VAR_POP` / `VAR_SAMP` | `variance` / `var_pop` / `var_samp` |
| `CORR` / `COVAR_POP` / `COVAR_SAMP` | 同名 |
| `REGR_*` | 同名（`regr_slope`、`regr_intercept`、`regr_r2` 等） |
| `MEDIAN(x)` | `percentile_cont(0.5) WITHIN GROUP (ORDER BY x)` |
| `STATS_MODE(x)` | `mode() WITHIN GROUP (ORDER BY x)` |
| `LISTAGG` | `string_agg`（02 §11） |
| `COLLECT(x)` | `array_agg(x)` |
| `GROUPING(x)` | `GROUPING(x)` |
| `GROUPING_ID(...)` | 无；用多个 `GROUPING()` 组合 |
| `GROUP_ID()` | 无 |
| `RATIO_TO_REPORT` | `x / sum(x) OVER (...)` |
| `ROW_NUMBER/RANK/DENSE_RANK/NTILE/LAG/LEAD/FIRST_VALUE/LAST_VALUE/NTH_VALUE` | 同名 |
| `PERCENT_RANK` / `CUME_DIST` | 同名 |

`AVG` 类型：Oracle `AVG(NUMBER)` 返回 NUMBER；PG `avg(numeric)` 返回 numeric，`avg(int)` 返回 numeric；`COUNT` 返回 bigint（Oracle 是 NUMBER）。ORM 映射要确认。

## 7. 系统、会话、信息

| Oracle | PG14 |
|---|---|
| `USER` | `current_user` |
| `UID` | 无；用角色名/`pg_roles.oid` |
| `SYS_CONTEXT('USERENV','SESSION_USER')` | `session_user` |
| `SYS_CONTEXT('USERENV','CURRENT_SCHEMA')` | `current_schema()` |
| `SYS_CONTEXT('USERENV','DB_NAME')` | `current_database()` |
| `SYS_CONTEXT('USERENV','IP_ADDRESS')` | `inet_client_addr()` |
| `SYS_CONTEXT('USERENV','HOST')` | `inet_client_addr()` / 客户端自报 |
| `USERENV('LANG')` | `current_setting('lc_messages')` |
| `VSIZE(x)` | `pg_column_size(x)` |
| `DUMP(x)` | `to_hex` + `pg_typeof`（近似） |
| `ORA_HASH(x)` | `hashtext(x)` |
| `DBMS_APPLICATION_INFO.SET_MODULE` | `set_config('application_name', ..., false)` |
| `DBMS_SESSION.SET_CONTEXT` | `set_config('ns.key', v, false)` |
| `DBMS_SESSION.SLEEP(n)` | `pg_sleep(n)` |
| `DBMS_LOCK.SLEEP(n)` | `pg_sleep(n)` |
| `DBMS_LOCK.REQUEST` | `pg_advisory_lock` / `pg_try_advisory_lock` |
| `DBMS_PIPE` / `DBMS_ALERT` | `LISTEN` / `NOTIFY` |
| `DBMS_RANDOM.VALUE` | `random()` |
| `DBMS_RANDOM.SEED(n)` | `setseed(n)` |
| `DBMS_RANDOM.STRING` | 手写生成（`chr(65 + floor(random()*26)::int)`） |
| `DBMS_UTILITY.GET_TIME` | `(extract(epoch from clock_timestamp()) * 100)::bigint` |
| `DBMS_UTILITY.FORMAT_ERROR_STACK` | `SQLERRM` |
| `DBMS_METADATA.GET_DDL` | `pg_get_functiondef` / `pg_get_viewdef` / `pg_get_indexdef` / `pg_get_triggerdef` / `pg_get_constraintdef` |
| `DBMS_STATS.GATHER_TABLE_STATS` | `ANALYZE 表` |
| `DBMS_XPLAN.DISPLAY` | `EXPLAIN (ANALYZE, BUFFERS)` |
| `DBMS_ASSERT.ENQUOTE_LITERAL` | `quote_literal` |
| `DBMS_ASSERT.ENQUOTE_NAME` | `quote_ident` |
| `DBMS_RLS.ADD_POLICY` | `CREATE POLICY` + `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` |
| `DBMS_OUTPUT.PUT_LINE` | `RAISE NOTICE '%', msg` |
| `DBMS_OUTPUT.ENABLE/DISABLE` | `SET client_min_messages = notice/warning` |
| `DBMS_SCHEDULER` / `DBMS_JOB` | `pg_cron` 或外部调度 |
| `DBMS_SQL` | `EXECUTE`（见 03 §6） |
| `DBMS_FLASHBACK` | 无 |
| `DBMS_SESSION.RESET_PACKAGE` | `RESET ALL` / `DISCARD ALL`（不精确） |

## 8. 大对象（LOB）

| Oracle | PG14 |
|---|---|
| `DBMS_LOB.GETLENGTH(l)` | `length(t)` / `octet_length(b)` |
| `DBMS_LOB.SUBSTR(l, n, p)` | `substr(t, p, n)` |
| `DBMS_LOB.INSTR(l, sub)` | `strpos(t, sub)` |
| `DBMS_LOB.APPEND(a, b)` | `a := a || b` |
| `DBMS_LOB.WRITE(l, n, p, data)` | `overlay(a placing data from p for n)` |
| `DBMS_LOB.READ(l, n, p, buf)` | `substring(a from p for n)` |
| `DBMS_LOB.TRIM(l, n)` | `left(a, n)` |
| `DBMS_LOB.CREATETEMPORARY` | 直接声明变量 |
| `DBMS_LOB.FREETEMPORARY` | 无 |
| `DBMS_LOB.FILEOPEN` | `lo_import` / `COPY` |
| `DBMS_LOB.LOADFROMFILE` | `lo_import`（服务端文件） |

`text`/`bytea` 上限约 1GB；超过时用 `lo` 大对象或外部存储。

## 9. JSON / XML

| Oracle | PG14 |
|---|---|
| `JSON_VALUE(j, '$.a')` | `j ->> 'a'` 或 `jsonb_path_query_first(j, '$.a') #>> '{}'` |
| `JSON_QUERY(j, '$.a')` | `j -> 'a'` |
| `JSON_EXISTS(j, '$.a')` | `j ? 'a'` |
| `JSON_TABLE(...)` | `jsonb_to_recordset` / `jsonb_path_query` |
| `JSON_ARRAYAGG` / `JSON_OBJECTAGG` | `jsonb_agg` / `jsonb_object_agg` |
| `XMLTYPE` | `xml` |
| `EXTRACTVALUE(x, p)` | `(xpath(p, x))[1]::text` |
| `XMLQUERY` | `xpath` |
| `XMLTABLE` | `xmltable` |
| `XMLELEMENT` / `XMLFOREST` / `XMLAGG` | `xmlelement` / `xmlforest` / `xmlagg` |

## 10. 需要扩展或外部能力

| 能力 | 方案 |
|---|---|
| 哈希/加密（`DBMS_CRYPTO`） | `pgcrypto`：`digest`、`hmac`、`encrypt`、`decrypt` |
| UUID | 内置 `gen_random_uuid()` |
| 模糊匹配（`UTL_MATCH`） | `fuzzystrmatch`（`levenshtein`、`soundex`） |
| 相似度（`UTL_MATCH.JARO_WINKLER`） | `fuzzystrmatch` + 自写 |
| 正则高级函数 | PG15+；PG14 手写或应用层 |
| HTTP（`UTL_HTTP`） | `http`/`pg_net` 扩展或外部服务 |
| 邮件（`UTL_MAIL`/`UTL_SMTP`） | 外部服务 |
| 文件（`UTL_FILE`） | `COPY ... TO/FROM`（服务端路径，需超级用户）、`pg_read_file`（超级用户）、客户端 `\copy` |
| 定时任务（`DBMS_SCHEDULER`） | `pg_cron` / 外部调度 |
| 闪回（`DBMS_FLASHBACK`） | 备份、归档表、时间戳列 |

## 11. 常用参数与设置

| Oracle | PG14 |
|---|---|
| `ALTER SESSION SET NLS_DATE_FORMAT = 'YYYY-MM-DD'` | `SET DateStyle = 'ISO, YMD'`；输出格式用 `to_char` 显式控制 |
| `ALTER SESSION SET NLS_NUMERIC_CHARACTERS` | `lc_numeric`（不建议依赖） |
| `ALTER SESSION SET CURRENT_SCHEMA = s` | `SET search_path = s, public` |
| `ALTER SESSION SET TIME_ZONE = tz` | `SET TimeZone = 'tz'` |
| `ALTER SESSION SET OPTIMIZER_MODE` | `SET enable_*`、`SET plan_cache_mode` |

## 12. 注意

- 不要为了「看起来像」而保留 Oracle 内置函数；目标端没有同名函数时会直接报错。
- 同名不同义最危险：`GREATEST/LEAST`（NULL）、`SUBSTR`（负下标）、`EXTRACT(DOW)`、`TO_CHAR` 数字格式、`REGEXP_REPLACE` 参数。
- 任何依赖会话参数（日期格式、时区、数字格式）的代码，都要改成显式格式/显式时区。