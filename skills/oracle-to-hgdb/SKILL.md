---
name: oracle-to-hgdb
description: Oracle 到瀚高 HGDB V9（PostgreSQL 14 内核）的对象转换规则库与工作流，覆盖数据类型、查询方言、PL/SQL、函数、存储过程、包、视图、物化视图、触发器、权限、兼容模式探测与验证。
whenToUse: 当任务需要把 Oracle SQL/PLSQL（函数、存储过程、包、视图、触发器、匿名块、建表脚本、查询语句）改写为 HGDB V9 / PostgreSQL 14 语法，或需要评估转换风险、设计验证方案时加载。
---

# Oracle → HGDB V9 转换

HGDB V9 内核是 PostgreSQL 14。目标端已启用 Oracle 兼容模式，但兼容能力因版本、参数、部署方式而异——**任何 Oracle 写法是否可保留，以目标库实测为准**，不要凭印象假设。

## 开始前先做三件事

1. **确认目标**：目标库连接（`dsh-sql` 若是 HGDB/PG 连接可直接验证）、目标 schema、是否保留 Oracle 风格命名。
2. **探测能力**：连库时执行 `scripts/probe-hgdb.sql`，把结果记成能力矩阵；不连库时，先按 PostgreSQL 14 标准写法转换，并在报告里标注「未连库验证 / 兼容写法待确认」。
3. **盘点对象**：列出对象类型、依赖关系（视图依赖表与视图、函数依赖类型与包、触发器依赖表与函数）、调用链（谁调用这个包/函数）。

没有探测结果时，默认走 PostgreSQL 14 标准写法；不要为了「少改」而保留未经证实的 Oracle 语法。

## 按任务选参考文件

| 任务 | 先读 | 再读 |
|---|---|---|
| 全流程、批量目录、报告 | `references/00-workflow.md` | `references/10-validation.md` |
| 建表、类型、约束、索引、序列、同义词、分区 | `references/01-datatypes-ddl.md` | `references/08-builtins.md` |
| 查询/DML 方言（DUAL、ROWNUM、CONNECT BY、MERGE…） | `references/02-sql-dml.md` | `references/11-examples.md` |
| 匿名块、游标、异常、动态 SQL、事务 | `references/03-plsql.md` | `references/04-functions-procedures.md` |
| 函数、存储过程、结果集 | `references/04-functions-procedures.md` | `references/03-plsql.md` |
| 包（PACKAGE / PACKAGE BODY） | `references/05-packages.md` | `references/03-plsql.md` |
| 视图、物化视图 | `references/06-views.md` | `references/02-sql-dml.md` |
| 触发器 | `references/07-triggers.md` | `references/03-plsql.md` |
| 内置函数、DBMS_*/UTL_* | `references/08-builtins.md` | `references/09-compat-probe.md` |
| 兼容模式判断 | `references/09-compat-probe.md` | `scripts/probe-hgdb.sql` |
| 验证、上线前检查 | `references/10-validation.md` | `scripts/validate-hgdb.sql` |
| 典型前后对照 | `references/11-examples.md` | — |

## 通用转换骨架

**函数**

```sql
-- Oracle
CREATE OR REPLACE FUNCTION f_get_amt(p_id IN NUMBER) RETURN NUMBER IS
  v_amt NUMBER(12,2);
BEGIN
  SELECT amount INTO v_amt FROM t_order WHERE id = p_id;
  RETURN v_amt;
EXCEPTION WHEN NO_DATA_FOUND THEN RETURN 0;
END;
```

```sql
-- HGDB / PostgreSQL 14（保留 Oracle 兼容写法前先探测；此为标准写法）
CREATE OR REPLACE FUNCTION f_get_amt(p_id numeric) RETURNS numeric
LANGUAGE plpgsql AS $func$
DECLARE
  v_amt numeric(12,2);
BEGIN
  SELECT amount INTO STRICT v_amt FROM t_order WHERE id = p_id;
  RETURN v_amt;
EXCEPTION WHEN NO_DATA_FOUND THEN RETURN 0;
END;
$func$;
```

**过程**：`CREATE OR REPLACE PROCEDURE p(...) LANGUAGE plpgsql AS $proc$ ... $proc$;`，调用由 `BEGIN p(...); END;` / `EXEC p;` 改为 `CALL p(...);`。

**包**：规范/包体 → 独立 schema（`CREATE SCHEMA pkg_name`）+ 公共子程序改为 `pkg_name.fn()` + 包级状态用会话 GUC 或临时表模拟 + 初始化块改为显式/惰性 `pkg.__init()`。详见 `references/05-packages.md`。

**触发器**：触发器体改为返回 `trigger` 的函数，再 `CREATE TRIGGER ... EXECUTE FUNCTION fn()`；`:NEW`/`:OLD` → `NEW`/`OLD`；行级触发器函数必须 `RETURN NEW`（BEFORE 可改 NEW）或 `RETURN OLD`（DELETE），语句级返回 `NULL`。

**视图**：`CREATE OR REPLACE VIEW`；`FORCE` 无等价物，先建依赖再建视图或先建占位视图。物化视图无 `ON COMMIT` 自动刷新，用唯一索引 + `REFRESH MATERIALIZED VIEW CONCURRENTLY` 加调度替代。

## 十类高频语义坑（必须逐条确认）

1. **空串 vs NULL**：Oracle `''` 就是 NULL；PG `''` 不是 NULL。所有 `= ''`、`NVL(col,'')`、`CHECK (col <> '')`、`NOT NULL` 语义都要复核。
2. **CHAR 补空格**：Oracle `CHAR(n)` 按空格补齐并做补齐比较；PG `char(n)` 也补齐，但 `varchar` 不补。跨库比对、`=` 比较、`LENGTH` 结果会变。
3. **DATE 含时分秒**：Oracle `DATE` 到秒；PG `date` 只有日期。用 `timestamp(0)` 承接，别直接映射成 `date`。
4. **ROWNUM 求值时机**：Oracle 在 `ORDER BY` 之前赋值。`WHERE ROWNUM <= n ORDER BY x` ≠ `ORDER BY x LIMIT n`，需要子查询。
5. **SELECT INTO 严格性**：PG 默认 `SELECT INTO` 零行不报错、多行取第一行；Oracle 抛 `NO_DATA_FOUND`/`TOO_MANY_ROWS`。依赖异常的代码要加 `STRICT`。
6. **函数里不能 COMMIT**：PG 函数禁止事务控制；过程（`CALL`）可以，但在显式事务块内 `COMMIT` 会报错。Oracle 过程里的提交要重新设计。
7. **自治事务**：PG 无 `PRAGMA AUTONOMOUS_TRANSACTION`；用 dblink/`postgres_fdw` 回环、`pg_background`、或「写入队列表 + 独立消费者」替代；HGDB 兼容模式是否支持必须探测。
8. **标识符大小写**：Oracle 未加引号折叠为大写，PG 折叠为小写。统一小写；保留字（`user`、`order`、`type`、`desc`、`limit`、`level`、`comment` 等）才加双引号，并保持所有引用一致。
9. **NUMBER 精度与隐式转换**：`NUMBER(38)` 映射成 `bigint` 可能溢出，应 `numeric`；Oracle 隐式 `'123'→123` 在 PG 里可能直接报错，调用点要显式 `::numeric`。
10. **包级状态与会话**：包变量是会话级；PG 用 GUC/临时表模拟后，连接池复用、事务回滚、`DISCARD ALL` 都会影响它，必须写进报告。

## 输出契约

- 目录批量：`converted/` 镜像源结构；一个对象一个 `.sql`；`CONVERSION_REPORT.md`；必要时 `MAPPING.md`（对象名对照）。
- 单文件/粘贴：先代码块 + 变更说明表，确认后再落盘。
- 每个转换文件头部建议写：

```sql
-- converted-from-oracle: SCHEMA.OBJECT (TYPE)
-- source-file: path/to/source.sql
-- risk: low|medium|high
-- notes: 关键语义差异与待确认项
```

- 报告字段：源对象、目标对象、状态（auto/semi/manual/unsupported）、关键改动、风险等级、验证方式、未验证项。

## 自检（交付前必做）

- 括号、`BEGIN/END`、`$$`（或 `$tag$`）配对；对象名、参数名、变量名前后一致。
- 语法关键字拼写：`RETURNS`、`LANGUAGE plpgsql`、`EXECUTE FUNCTION`、`ON CONFLICT`、`WITH RECURSIVE`、`RETURNING`。
- 依赖顺序：类型 → 序列 → 表 → 函数 → 过程 → 包 → 视图 → 触发器。
- 能连库时：`SET check_function_bodies = on;` 重建对象；有 `plpgsql_check` 就逐函数检查；跑冒烟用例。
- 把不能验证的部分写清楚，不要用「已验证」描述未执行的检查。