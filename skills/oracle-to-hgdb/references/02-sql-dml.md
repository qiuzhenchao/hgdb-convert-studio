# 02 查询与 DML 方言

## 1. SELECT 基础

| Oracle | PG14 |
|---|---|
| `SELECT 1 FROM dual` | `SELECT 1`（兼容模式下 DUAL 可能可用，探测后再保留） |
| `SELECT SYSDATE FROM dual` | `SELECT LOCALTIMESTAMP(0)` |
| 子查询无别名 | PG 要求 `FROM (SELECT ...) AS t`；补别名 |
| `GROUP BY` 用 SELECT 别名 | PG 不支持；把别名换成表达式或外层子查询 |
| 隐式字符串↔数字 | 显式 `::numeric` / `::text` |
| `MINUS` | `EXCEPT` |
| `INTERSECT` / `UNION [ALL]` | 同名 |
| `NULLS LAST/FIRST` | 同名；默认排序空值位置在升/降序下与 Oracle 一致 |

## 2. ROWNUM

Oracle 的 `ROWNUM` 在行进入结果集前赋值，`ORDER BY` 之后不改变它。

| Oracle | PG14 |
|---|---|
| `WHERE ROWNUM <= 10` | `LIMIT 10` |
| `WHERE ROWNUM = 1` | `LIMIT 1` |
| `WHERE ROWNUM < 10` | `LIMIT 9` |
| `SELECT * FROM t WHERE ROWNUM <= 10 ORDER BY x` | `SELECT * FROM (SELECT * FROM t LIMIT 10) q ORDER BY x` |
| `SELECT * FROM (SELECT * FROM t ORDER BY x) WHERE ROWNUM <= 10` | `SELECT * FROM t ORDER BY x LIMIT 10` |
| `ROWNUM` 出现在 SELECT 列表 | `row_number() OVER ()` |
| `ROWNUM` 作分页（`> n AND <= m`） | `LIMIT m-n OFFSET n`（注意 Oracle 写法必须子查询，语义才等价） |
| 每组 Top-N | `row_number() OVER (PARTITION BY g ORDER BY x)` + 外层过滤 |

`ROWNUM > 1` 在 Oracle 永假；迁移时确认原代码不是「靠它不返回行」的写法。

## 3. 层次查询 CONNECT BY → WITH RECURSIVE

Oracle：

```sql
SELECT employee_id, manager_id, LEVEL AS lvl,
       SYS_CONNECT_BY_PATH(last_name, '/') AS path,
       CONNECT_BY_ROOT last_name AS root_name,
       CONNECT_BY_ISLEAF AS is_leaf
FROM employees
START WITH manager_id IS NULL
CONNECT BY PRIOR employee_id = manager_id
ORDER SIBLINGS BY last_name;
```

PG14：

```sql
WITH RECURSIVE emp_tree AS (
  SELECT e.employee_id, e.manager_id, e.last_name,
         1 AS lvl,
         '/' || e.last_name AS path,
         e.last_name AS sort_path,
         e.last_name AS root_name
  FROM employees e
  WHERE e.manager_id IS NULL
  UNION ALL
  SELECT e.employee_id, e.manager_id, e.last_name,
         t.lvl + 1,
         t.path || '/' || e.last_name,
         t.sort_path || '/' || e.last_name,
         t.root_name
  FROM employees e
  JOIN emp_tree t ON e.manager_id = t.employee_id
)
SELECT employee_id, manager_id, lvl, path AS "PATH", root_name, sort_path
FROM emp_tree
ORDER BY sort_path;
```

对应关系：

| Oracle | 递归 CTE 写法 |
|---|---|
| `START WITH cond` | 递归项的锚点 `WHERE cond` |
| `CONNECT BY PRIOR c = p` | 递归项 `JOIN ... ON e.c = t.p`（父子方向按 PRIOR 位置决定） |
| `LEVEL` | 自增列 `lvl`（锚点 1） |
| `CONNECT_BY_ROOT col` | 锚点携带 `col`，递归项原样传递 |
| `SYS_CONNECT_BY_PATH(col, sep)` | 锚点 `sep||col`，递归项 `path||sep||col` |
| `CONNECT_BY_ISLEAF` | 外层 `NOT EXISTS (SELECT 1 FROM t c WHERE c.parent_id = x.id)` |
| `ORDER SIBLINGS BY col` | 构造 `sort_path` 后按它排序 |
| `CONNECT BY NOCYCLE` | 递归项加 `AND NOT (e.id = ANY(t.visited))`，并携带 `visited` 数组 |
| `WHERE LEVEL <= n` | 在外层过滤，或在递归项加 `WHERE t.lvl < n` 剪枝 |
| `PRIOR` 出现在 SELECT 表达式 | 在锚点/递归项各自计算并携带 |

注意：`LEVEL` 参与 `WHERE` 剪枝时，Oracle 剪枝后不再向下遍历；要等价，把条件放进递归项而不是只在外层过滤。

## 4. DECODE / NVL / NULL 相关

| Oracle | PG14 |
|---|---|
| `NVL(a, b)` | `COALESCE(a, b)` |
| `NVL2(a, b, c)` | `CASE WHEN a IS NOT NULL THEN b ELSE c END` |
| `COALESCE(a, b)` | 同名 |
| `NULLIF(a, b)` | 同名 |
| `DECODE(x, v1, r1, v2, r2, def)` | `CASE WHEN x IS NOT DISTINCT FROM v1 THEN r1 WHEN x IS NOT DISTINCT FROM v2 THEN r2 ELSE def END` |
| `LNNVL(cond)` | `cond IS NOT TRUE` |
| `GREATEST(a, b)` | `GREATEST(a, b)`，但两者 NULL 语义不同，见下 |
| `LEAST(a, b)` | 同上 |

`DECODE` 与 `CASE x WHEN ...` 的关键差异：`DECODE(x, NULL, ...)` 能匹配 NULL，`CASE x WHEN NULL` 永远不匹配。涉及 NULL 时用 `IS NOT DISTINCT FROM`。

`GREATEST`/`LEAST`：Oracle 忽略 NULL，PG 只要有 NULL 就返回 NULL。要保留 Oracle 语义：

```sql
-- 两列时
GREATEST(a, b)  -- 需保证非 NULL
-- 通用写法
(SELECT max(v) FROM (VALUES (a), (b)) AS x(v))
```

## 5. 外连接 (+)

```sql
-- Oracle
SELECT a.id, b.name
FROM a, b
WHERE a.b_id = b.id(+)
  AND b.status(+) = 'A';
```

```sql
-- PG14
SELECT a.id, b.name
FROM a
LEFT JOIN b ON b.id = a.b_id AND b.status = 'A';
```

规则：
- `(+)` 在要「补空」的一侧，转换成对应的 `LEFT`/`RIGHT JOIN`。
- 原本写在 `WHERE` 里针对被补空表的过滤条件，必须移到 `ON`，否则会把外连接退化成内连接。
- 两侧都有 `(+)` 的写法 Oracle 不支持，PG 也不允许；拆成两个外连接或用 `FULL JOIN`。
- `(+)` 不能和 `IN`、`OR` 混用的限制同样存在，改写时优先显式 `JOIN`。

## 6. MERGE

PG14 没有 `MERGE`（PG15 才有）；HGDB 兼容模式可能提供，探测后再决定。

```sql
-- Oracle
MERGE INTO tgt t
USING src s ON (t.id = s.id)
WHEN MATCHED THEN UPDATE SET t.v = s.v, t.updated_at = SYSDATE
WHEN NOT MATCHED THEN INSERT (id, v) VALUES (s.id, s.v);
```

```sql
-- PG14：目标表 id 上必须有主键/唯一索引
INSERT INTO tgt (id, v, updated_at)
SELECT s.id, s.v, LOCALTIMESTAMP(0)
FROM src s
ON CONFLICT (id) DO UPDATE
   SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
```

| Oracle MERGE 子句 | PG14 |
|---|---|
| `WHEN MATCHED THEN UPDATE` | `ON CONFLICT ... DO UPDATE` |
| `WHEN MATCHED AND cond THEN UPDATE` | `DO UPDATE SET ... WHERE cond` |
| `WHEN NOT MATCHED THEN INSERT` | 默认的插入分支 |
| `WHEN MATCHED THEN DELETE` | 无；单独 `DELETE ... USING` |
| 源表同一 key 多行 | 先 `DISTINCT ON (key)` 去重，否则报 `ON CONFLICT DO UPDATE command cannot affect row a second time` |
| 只更新部分列 | `DO UPDATE SET col = EXCLUDED.col` |

复杂条件（匹配就删、匹配才更新、源多表）建议改写为「先 UPDATE ... FROM，再 INSERT ... WHERE NOT EXISTS」的过程式实现，或用临时表。

## 7. INSERT ALL / INSERT FIRST

```sql
-- Oracle
INSERT ALL
  INTO t1 (id, v) VALUES (id, v)
  INTO t2 (id, v) VALUES (id, v)
SELECT id, v FROM src WHERE flag = 'Y';
```

```sql
-- PG14：拆成多条
INSERT INTO t1 (id, v) SELECT id, v FROM src WHERE flag = 'Y';
INSERT INTO t2 (id, v) SELECT id, v FROM src WHERE flag = 'Y';
```

带 `WHEN cond THEN` 的 `INSERT FIRST`：把条件放进各条 `SELECT ... WHERE`，注意「第一个满足的分支」语义需要 `CASE`/`UNION ALL` 或过程式实现。

## 8. DML 中的序列

| Oracle | PG14 |
|---|---|
| `INSERT INTO t (id) VALUES (seq.NEXTVAL)` | `INSERT INTO t (id) VALUES (nextval('seq'))` |
| `SELECT seq.NEXTVAL FROM dual` | `SELECT nextval('seq')` |
| `v := seq.CURRVAL` | `v := currval('seq')` |
| `UPDATE t SET id = seq.NEXTVAL` | 同 `nextval`（逐行取号） |
| 触发器里取号 | `NEW.id := nextval('seq'); RETURN NEW;` |

## 9. 日期与时间

| Oracle | PG14 |
|---|---|
| `SYSDATE` | `LOCALTIMESTAMP(0)`（类型 `timestamp(0)`） |
| `SYSTIMESTAMP` | `CURRENT_TIMESTAMP` / `clock_timestamp()` |
| `CURRENT_DATE` | `CURRENT_DATE` |
| `SYSDATE + 1` | `LOCALTIMESTAMP(0) + interval '1 day'` |
| `SYSDATE + 1/24` | `+ interval '1 hour'` |
| `SYSDATE + 30/86400` | `+ interval '30 seconds'` |
| `d1 - d2`（天数） | `EXTRACT(EPOCH FROM (d1 - d2)) / 86400` |
| `TRUNC(SYSDATE)` | `CURRENT_DATE` |
| `TRUNC(d, 'MM')` | `date_trunc('month', d)` |
| `TRUNC(d, 'Q')` | `date_trunc('quarter', d)` |
| `TRUNC(d, 'IW')` | `date_trunc('week', d)`（ISO 周，周一起） |
| `TRUNC(d, 'HH24')` | `date_trunc('hour', d)` |
| `ADD_MONTHS(d, n)` | `d + make_interval(months => n)` |
| `LAST_DAY(d)` | `(date_trunc('month', d) + interval '1 month - 1 day')::date` |
| `NEXT_DAY(d, 'MON')` | 见下方模板 |
| `MONTHS_BETWEEN(a, b)` | 见下方模板 |
| `ROUND(d)` / `ROUND(d,'MM')` | 无直接等价；按「四舍五入到天/月」手写 |
| `EXTRACT(YEAR FROM d)` | `EXTRACT(YEAR FROM d)` |
| `INTERVAL '1' MONTH` | `interval '1 month'` |

`NEXT_DAY`：

```sql
-- target_dow: 1=周一 ... 7=周日
d + (((target_dow - EXTRACT(ISODOW FROM d)::int + 6) % 7) + 1) * interval '1 day'
```

`MONTHS_BETWEEN`（近似实现，整月与同一天精确，其余按 31 天折算；Oracle 也会因月末规则产生差异）：

```sql
CREATE OR REPLACE FUNCTION months_between(d1 timestamp, d2 timestamp)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $fn$
  SELECT (EXTRACT(YEAR FROM age(d1, d2)) * 12 + EXTRACT(MONTH FROM age(d1, d2)))
       + CASE
           WHEN EXTRACT(DAY FROM d1) = EXTRACT(DAY FROM d2) THEN 0
           WHEN EXTRACT(DAY FROM d1) = EXTRACT(DAY FROM (date_trunc('month', d1) + interval '1 month - 1 day'))
            AND EXTRACT(DAY FROM d2) = EXTRACT(DAY FROM (date_trunc('month', d2) + interval '1 month - 1 day')) THEN 0
           ELSE (EXTRACT(DAY FROM d1) - EXTRACT(DAY FROM d2)) / 31.0
         END;
$fn$;
```

格式模型（`TO_DATE` / `TO_CHAR`）：

| Oracle | PG14 |
|---|---|
| `YYYY` `MM` `DD` `HH24` `MI` `SS` | 同名 |
| `HH` / `HH12` | `HH12`（PG 的 `HH` 也是 12 小时制） |
| `MON` / `MONTH` / `DY` / `DAY` | 同名（受 `lc_time` 影响） |
| `AM` / `PM` | 同名 |
| `FF3` / `FF6` | `MS` / `US` |
| `RR` | `YY`（世纪推断规则不同，跨世纪数据要人工确认） |
| `SSSSS`（当日秒数） | 无；用 `EXTRACT(EPOCH FROM ts::time)` |
| `J`（儒略日） | 无 |
| `NLS_DATE_FORMAT` | `DateStyle` + 显式格式；不要依赖隐式格式 |

`TO_CHAR(number)`：PG 的数字格式串同样支持 `9`、`0`、`.`、`,`、`FM`、`S`，但 `L`/`C`/`U` 等货币与双币种格式不同；`'999,999.00'` 一般可直接用，遇到 `RN`、`EEEE`、`V` 时手工改写。

## 10. 字符串函数

| Oracle | PG14 |
|---|---|
| `SUBSTR(s, pos, len)` | `substr(s, pos, len)`；负 pos / pos=0 语义不同，见下 |
| `INSTR(s, sub)` | `strpos(s, sub)`（1-based，找不到返回 0） |
| `INSTR(s, sub, pos, n)` | 无内置；写辅助函数（见 11 示例） |
| `LENGTH(s)` | `length(s)`；按字符 |
| `LENGTHB(s)` | `octet_length(s)` |
| `LPAD` / `RPAD` | 同名 |
| `LTRIM` / `RTRIM(s, set)` | 同名（第二参数是字符集合） |
| `TRIM([BOTH|LEADING|TRAILING] ...)` | 同名 |
| `REPLACE(s, a, b)` | 同名 |
| `TRANSLATE(s, from, to)` | 同名（PG 也有，删除/映射语义一致） |
| `INITCAP` / `UPPER` / `LOWER` | 同名 |
| `ASCII(c)` / `CHR(n)` | `ascii(c)` / `chr(n)`（UTF-8 下 `chr` 是码点） |
| `CONCAT(a, b)` | `a || b` 或 `concat(a, b)` |
| `REGEXP_LIKE(s, p)` | `s ~ p` |
| `REGEXP_SUBSTR(s, p, pos, n)` | `substring(s from p)`（取第一次匹配；多次匹配用 `regexp_matches`） |
| `REGEXP_REPLACE(s, p, r, pos, n)` | `regexp_replace(s, p, r, 'g')`（PG 用 flags 控制全局） |
| `REGEXP_INSTR` | `regexp_instr`（PG15+）；PG14 用 `strpos` 或辅助函数 |
| `REGEXP_COUNT` | 无内置；辅助函数 |
| `INSTRB` | `octet_length(substr(...))` 组合 |
| `SOUNDEX` | `fuzzystrmatch` 扩展的 `soundex` |
| `NLSSORT` | `COLLATE` |
| `WM_CONCAT` | `string_agg(x, ',')` |
| `TO_SINGLE_BYTE` | 无 |

`SUBSTR` 差异：

```sql
-- Oracle: SUBSTR('abcdef', -3, 2) => 'de'；SUBSTR(s, 0, 2) 按 1 处理
-- PG:     substr('abcdef', -3, 2) => ''（负下标先按字符位置截断，长度不够返回空）
--         substr('abc', 0, 2) => 'a'
-- 等价写法
substr(s, CASE WHEN pos < 0 THEN length(s) + pos + 1
               WHEN pos = 0 THEN 1
               ELSE pos END, len)
```

`INSTR(s, sub, pos, n)` 辅助函数：

```sql
CREATE OR REPLACE FUNCTION instr(p_src text, p_sub text, p_pos int DEFAULT 1, p_nth int DEFAULT 1)
RETURNS int LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  v_idx int := 0;
  v_start int;
BEGIN
  IF p_src IS NULL OR p_sub IS NULL OR p_nth < 1 THEN RETURN 0; END IF;
  v_start := CASE WHEN p_pos < 0 THEN greatest(length(p_src) + p_pos + 1, 1) ELSE greatest(p_pos, 1) END;
  FOR i IN 1..p_nth LOOP
    v_idx := strpos(substr(p_src, v_start), p_sub);
    IF v_idx = 0 THEN RETURN 0; END IF;
    v_idx := v_start + v_idx - 1;
    v_start := v_idx + 1;
  END LOOP;
  RETURN v_idx;
END;
$fn$;
```

## 11. 聚合与 LISTAGG

| Oracle | PG14 |
|---|---|
| `LISTAGG(x, ',') WITHIN GROUP (ORDER BY y)` | `string_agg(x, ',' ORDER BY y)` |
| `LISTAGG(DISTINCT x, ',') WITHIN GROUP (...)` | `string_agg(DISTINCT x, ',' ORDER BY x)` |
| `LISTAGG ... ON OVERFLOW TRUNCATE` | 无；`left(string_agg(...), n)` 或 `substr` |
| `MEDIAN(x)` | `percentile_cont(0.5) WITHIN GROUP (ORDER BY x)` |
| `STATS_MODE(x)` | `mode() WITHIN GROUP (ORDER BY x)` |
| `COLLECT(x)` | `array_agg(x)` |
| `KEEP (DENSE_RANK FIRST/LAST ORDER BY y)` | `DISTINCT ON` 或窗口函数 + 外层过滤 |
| `GROUPING(x)` / `GROUPING_ID` | `GROUPING(x)`（PG14 支持 `GROUPING`，`GROUPING_ID` 无） |
| `ROLLUP` / `CUBE` / `GROUPING SETS` | 同名 |

`KEEP` 改写：

```sql
-- Oracle: 取每个部门工资最高者的姓名
SELECT dept, MAX(name) KEEP (DENSE_RANK LAST ORDER BY sal) FROM emp GROUP BY dept;

-- PG14
SELECT DISTINCT ON (dept) dept, name
FROM emp ORDER BY dept, sal DESC, name;
```

（`DISTINCT ON` 的 `ORDER BY` 前缀必须与 DISTINCT ON 列一致。）

## 12. PIVOT / UNPIVOT / MODEL

`PIVOT` → 条件聚合：

```sql
-- Oracle
SELECT * FROM (SELECT dept, job, sal FROM emp)
PIVOT (SUM(sal) FOR job IN ('CLERK' AS clerk, 'SALES' AS sales));
```

```sql
-- PG14
SELECT dept,
       sum(sal) FILTER (WHERE job = 'CLERK') AS clerk,
       sum(sal) FILTER (WHERE job = 'SALES') AS sales
FROM emp GROUP BY dept;
```

`UNPIVOT` → `LATERAL (VALUES ...)`：

```sql
SELECT dept, k, v
FROM t
CROSS JOIN LATERAL (VALUES ('q1', q1), ('q2', q2)) AS u(k, v)
WHERE v IS NOT NULL;
```

`MODEL` 子句无等价物：改为窗口函数 + 过程式循环，或一次性拉取到应用层计算；在报告里标为 `manual`。

## 13. 分析函数

`ROW_NUMBER` / `RANK` / `DENSE_RANK` / `NTILE` / `LAG` / `LEAD` / `FIRST_VALUE` / `LAST_VALUE` / `NTH_VALUE` / `SUM|AVG|COUNT|MIN|MAX OVER` / `PERCENT_RANK` / `CUME_DIST` / `NTILE` 语法一致。

| Oracle | PG14 |
|---|---|
| `RATIO_TO_REPORT(x) OVER (...)` | `x / sum(x) OVER (...)` |
| `LISTAGG(...) OVER (...)` | 无窗口版；用 `array_agg` + 子查询 |
| `KEEP` 分析版 | 窗口 + 外层过滤 |

注意：`LAST_VALUE` 默认窗口是 `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`，要整组结果需显式 `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`（两种库一致，但常被忽略）。

## 14. 其他

| Oracle | PG14 |
|---|---|
| `FOR UPDATE NOWAIT` | `FOR UPDATE NOWAIT` |
| `FOR UPDATE SKIP LOCKED` | `FOR UPDATE SKIP LOCKED` |
| `RETURNING x INTO v` | `RETURNING x INTO v` |
| `INSERT ... RETURNING ... INTO` | 同 |
| `COMMIT` 在 DML 后 | 同；注意函数/过程限制（见 03、04） |
| 优化器提示 `/*+ INDEX(t idx) */` | 删除；必要时用 CTE `MATERIALIZED`、`SET enable_*` 或改写查询 |
| `ROWID` 条件 | 改用主键/唯一键；`ctid` 不稳定 |
| `SAMPLE(n)` | `TABLESAMPLE SYSTEM(n)`（按块采样，近似） |
| `SELECT ... FROM t, TABLE(f())` | `FROM t CROSS JOIN LATERAL f() AS x` |
| `SYS_CONTEXT('USERENV','...')` | `current_user`、`current_database()`、`current_setting()` |
| `USER` / `UID` | `current_user` / `session_user`（UID 无对应） |
| `DUMP(x)` | 无；用 `to_hex`、`pg_typeof` 辅助 |
| `VSIZE(x)` | `pg_column_size(x)` |
| `ORA_HASH(x)` | `hashtext(x)` |
| `STANDARD_HASH(x,'SHA256')` | `digest(x,'sha256')`（`pgcrypto`） |
| `SYS_GUID()` | `gen_random_uuid()`（`pgcrypto`） |
| `RAWTOHEX` / `HEXTORAW` | `encode(...,'hex')` / `decode(...,'hex')` |

## 15. 示例：分页 + Top-N

```sql
-- Oracle：第 11-20 行
SELECT * FROM (
  SELECT a.*, ROWNUM rn FROM (
    SELECT id, name FROM t ORDER BY id
  ) a WHERE ROWNUM <= 20
) WHERE rn > 10;
```

```sql
-- PG14
SELECT id, name FROM t ORDER BY id LIMIT 10 OFFSET 10;
```