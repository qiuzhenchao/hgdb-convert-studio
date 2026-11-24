# 09 兼容模式探测与判断

## 1. 为什么要探测

HGDB V9 的 Oracle 兼容能力取决于：发行版/补丁版本、兼容参数开关、扩展是否安装、以及具体对象（函数、包、触发器）的实现。同一个写法在 A 环境可用、在 B 环境报错是常见情况。**不要根据文档或经验直接保留 Oracle 写法**；先探测，再决定。

## 2. 运行探测

```powershell
# 用 psql（HGDB 自带或 PostgreSQL 客户端）
psql "host=10.0.0.10 port=5866 dbname=testdb user=app password=***" `
     -v ON_ERROR_STOP=0 `
     -f skills/oracle-to-hgdb/scripts/probe-hgdb.sql
```

也可以把脚本内容粘进 DSH 的 `sql_query`（只读工具只允许单条只读语句，探测脚本含 DDL，需用 `sql_exec` 或 psql）。探测脚本会：
- 建临时表/临时 schema 做能力测试；
- 结束时清理自己创建的 schema；
- 输出一张 `feature | supported | detail` 能力表。

**只在不重要的测试库运行**：脚本会临时创建对象；不要在业务高峰或生产库执行。

## 3. 探测项

| 类别 | 探测点 |
|---|---|
| 伪表 | `DUAL` |
| 兼容函数 | `NVL`、`NVL2`、`DECODE`、`SYS_GUID`、`ADD_MONTHS`、`MONTHS_BETWEEN`、`LAST_DAY`、`NEXT_DAY`、`INSTR`、`LISTAGG`、`KEEP (DENSE_RANK ...)` |
| 伪列/语法 | `ROWNUM`、`LEVEL` + `CONNECT BY`、`(+)` 外连接、`SYSDATE`、`SYSTIMESTAMP`、`ROWID` |
| 类型 | `VARCHAR2`、`NUMBER`、`CLOB`、`BLOB`、`DATE` 的 Oracle 语义 |
| 序列 | `seq.NEXTVAL` / `seq.CURRVAL` 写法 |
| 包 | `CREATE PACKAGE` / `CREATE PACKAGE BODY`、包过程调用 |
| 触发器 | `PRAGMA AUTONOMOUS_TRANSACTION`（包/过程/触发器） |
| 系统包 | `DBMS_OUTPUT.PUT_LINE`、`RAISE_APPLICATION_ERROR` |
| 其他 | 同义词（`CREATE SYNONYM`）、`MERGE`、`TO_DATE` 的 `RR` 格式 |

## 4. 结果记录模板

把探测结果填成表，放进 `CONVERSION_REPORT.md` 或独立 `COMPATIBILITY.md`：

```markdown
| 能力 | 可用 | 证据 | 转换策略 |
|---|---|---|---|
| DUAL | 是 | probe: dual | 可保留 `FROM dual` |
| ROWNUM | 否 | probe: rownum 报错 | 改 `LIMIT` / `row_number()` |
| DECODE | 是 | probe: decode | 可保留；NULL 场景仍用 CASE 更稳 |
| PACKAGE | 是 | probe: package | 包可保留；包级状态仍需处理 |
| 自治事务 | 否 | probe: autonomous | 改队列表 / dblink 方案 |
```

## 5. 决策规则

1. **可用**：可以保留 Oracle 写法，但要确认语义一致（NULL、空串、日期精度、排序）。保留时在文件头写 `-- compat: verified (DUAL, NVL)`。
2. **不可用**：改成 PostgreSQL 14 标准写法（本 skill 各章给出）。
3. **部分可用**（如 `LISTAGG` 有但不支持 `ON OVERFLOW`）：用兼容写法 + 局部标准写法，报告写明混用点。
4. **行为不同**（如 `GREATEST` 的 NULL 语义、`(+)` 过滤位置）：即使可用也按语义改写，并在报告标注。
5. **无法验证**：按标准写法转换，报告标 `未验证`，上线前在目标环境复测。

## 6. 补充检查（SQL）

```sql
-- 版本
SELECT version();

-- 兼容相关参数
SELECT name, setting, short_desc
FROM pg_settings
WHERE name ILIKE '%oracle%' OR name ILIKE '%compat%' OR name ILIKE '%highgo%'
ORDER BY name;

-- 已安装扩展
SELECT extname, extversion FROM pg_extension ORDER BY 1;

-- 是否存在某函数（按名字模糊）
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname ILIKE '%nvl%' OR p.proname ILIKE '%decode%' OR p.proname ILIKE '%rownum%'
ORDER BY 1, 2;

-- 是否存在某类型
SELECT n.nspname, t.typname
FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE t.typname IN ('varchar2','number','clob','blob','rowid')
ORDER BY 2;

-- 数据库编码/排序/时区
SELECT current_database(), current_setting('server_encoding'),
       current_setting('lc_collate'), current_setting('TimeZone');
```

函数存在性也可以直接试：

```sql
SELECT nvl(NULL::int, 1);          -- 成功即支持
SELECT 1 FROM dual;                -- 成功即支持
```

## 7. 常见坑

- **兼容函数存在但语义不同**：`GREATEST`、`SUBSTR`、`TO_CHAR`、`REGEXP_*` 都可能「有函数但结果不同」；不要只看「不报错」。
- **参数开关**：某些兼容特性要在 `postgresql.conf` / `ALTER SYSTEM` 打开，或者建库时指定；连接池的不同库可能配置不同。
- **schema 隔离**：兼容函数可能装在 `public` 或专用 schema，`search_path` 不含它时不可见。
- **版本差异**：小版本补丁可能新增/修改兼容函数；升级后要重跑探测。
- **包/自治事务**：即使语法可用，也要看是否支持包级状态、`COMMIT`、触发器内自治事务等语义。

## 8. 不连库时

- 明确写「未连库验证」；
- 全部按 PostgreSQL 14 标准写法转换；
- 把「若兼容模式支持，可保留的写法」列在报告的可选优化里，供上线前决定；
- 不要用「HGDB 应该支持」这类措辞冒充结论。