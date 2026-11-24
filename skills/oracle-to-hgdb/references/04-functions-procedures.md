# 04 函数与存储过程

## 1. 函数骨架

```sql
-- Oracle
CREATE OR REPLACE FUNCTION f_get_amt(
  p_id    IN  NUMBER,
  p_rate  IN  NUMBER DEFAULT 1
) RETURN NUMBER
  DETERMINISTIC
IS
  v_amt NUMBER(12,2);
BEGIN
  SELECT amount * p_rate INTO v_amt FROM t_order WHERE id = p_id;
  RETURN v_amt;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RETURN 0;
END f_get_amt;
/
```

```sql
-- PG14
CREATE OR REPLACE FUNCTION f_get_amt(
  p_id   numeric,
  p_rate numeric DEFAULT 1
) RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  v_amt numeric(12,2);
BEGIN
  SELECT amount * p_rate INTO STRICT v_amt FROM t_order WHERE id = p_id;
  RETURN v_amt;
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RETURN 0;
END;
$fn$;
```

| Oracle | PG14 |
|---|---|
| `RETURN type` | `RETURNS type` |
| `IS` / `AS` | `AS $fn$ ... $fn$`（`LANGUAGE plpgsql`） |
| 无参 `FUNCTION f RETURN ...` | `FUNCTION f() RETURNS ...`（必须带括号） |
| `DEFAULT` / `:=` 参数默认值 | `DEFAULT`（位置参数之后；中间参数要默认值就得给它后面的都加默认值或改重载） |
| `DETERMINISTIC` | `IMMUTABLE`（真正只依赖入参且无副作用）；只读表/序列用 `STABLE` |
| `RESULT_CACHE` | 无；用物化中间表或 `MATERIALIZED` CTE |
| `PARALLEL_ENABLE` | `PARALLEL SAFE` |
| `AUTHID CURRENT_USER` | 默认 `SECURITY INVOKER` |
| `AUTHID DEFINER` | `SECURITY DEFINER`（必须 `SET search_path = ...`，否则有提权风险） |
| `NOCOPY` | 忽略 |
| `ACCESSIBLE BY` / `PRAGMA UDF` | 无 |

默认参数注意：PG 要求「有默认值的参数不能出现在无默认值参数之前」。Oracle 允许 `f(a IN NUMBER DEFAULT 1, b IN NUMBER)` 并用命名调用；迁移时把默认值挪到末尾，或在报告标注调用点必须改写。

## 2. 表函数 / PIPELINED

Oracle：

```sql
CREATE OR REPLACE FUNCTION f_orders(p_status VARCHAR2)
RETURN t_order_tab PIPELINED IS
  r t_order_rec;
BEGIN
  FOR c IN (SELECT * FROM t_order WHERE status = p_status) LOOP
    r.id := c.id; r.amount := c.amount;
    PIPE ROW(r);
  END LOOP;
  RETURN;
END;
```

PG14：

```sql
CREATE OR REPLACE FUNCTION f_orders(p_status varchar)
RETURNS SETOF t_order
LANGUAGE plpgsql AS $fn$
DECLARE
  r t_order;
BEGIN
  FOR r IN SELECT * FROM t_order WHERE status = p_status LOOP
    RETURN NEXT r;
  END LOOP;
  RETURN;
END;
$fn$;
```

| Oracle | PG14 |
|---|---|
| `PIPELINED` | `RETURNS SETOF 类型`（或 `RETURNS TABLE(...)`） |
| `PIPE ROW(r)` | `RETURN NEXT r;` |
| `RETURN;` 结束 | `RETURN;` |
| `TABLE(f(...))` | `f(...)`（直接 `FROM f(...)`） |
| `RETURN t_tab`（非 PIPELINED） | `RETURNS SETOF` + `RETURN QUERY`；或 `RETURNS 数组` + `unnest` |

`RETURNS TABLE` 版本（省掉复合类型）：

```sql
CREATE OR REPLACE FUNCTION f_orders(p_status varchar)
RETURNS TABLE (id numeric, amount numeric)
LANGUAGE plpgsql AS $fn$
BEGIN
  RETURN QUERY SELECT o.id, o.amount FROM t_order o WHERE o.status = p_status;
END;
$fn$;
```

调用：`SELECT * FROM f_orders('N');`。

## 3. 存储过程

```sql
-- Oracle
CREATE OR REPLACE PROCEDURE p_close_order(p_id IN NUMBER, p_rows OUT NUMBER) IS
BEGIN
  UPDATE t_order SET status = 'C', closed_at = SYSDATE WHERE id = p_id;
  p_rows := SQL%ROWCOUNT;
  COMMIT;
END;
```

```sql
-- PG14
CREATE OR REPLACE PROCEDURE p_close_order(p_id numeric, INOUT p_rows integer)
LANGUAGE plpgsql AS $proc$
BEGIN
  UPDATE t_order SET status = 'C', closed_at = LOCALTIMESTAMP(0) WHERE id = p_id;
  GET DIAGNOSTICS p_rows = ROW_COUNT;
  COMMIT;
END;
$proc$;
```

调用：

```sql
CALL p_close_order(1, NULL);
```

要点：
- 过程用 `CALL`，不再用 `BEGIN p_xxx; END;` / `EXEC p_xxx;`。Oracle 的 `EXEC` 是 SQL*Plus 命令，不是 SQL。
- **OUT 参数**：过程输出参数在 PG 里通过 `CALL ...` 返回一行，捕获不便。若原过程大量使用 OUT 参数，建议改成函数（`RETURNS TABLE` 或 `RETURNS record`），除非必须保留过程以使用事务控制。
- `SQL%ROWCOUNT` → `GET DIAGNOSTICS v_rows = ROW_COUNT;`（要在目标语句后立即取）。
- `COMMIT`：过程内允许，但调用方不能在显式事务块中；否则报 `invalid transaction termination`。函数内绝对不允许。
- 过程不能出现在 `FROM`、`SELECT` 中。

## 4. SYS_REFCURSOR 结果集

```sql
-- Oracle
CREATE OR REPLACE PROCEDURE p_list_orders(p_status IN VARCHAR2, p_cur OUT SYS_REFCURSOR) IS
BEGIN
  OPEN p_cur FOR SELECT id, amount FROM t_order WHERE status = p_status;
END;
```

```sql
-- PG14 A：过程 + refcursor 输出参数
CREATE OR REPLACE PROCEDURE p_list_orders(p_status varchar, INOUT p_cur refcursor)
LANGUAGE plpgsql AS $proc$
BEGIN
  OPEN p_cur FOR SELECT id, amount FROM t_order WHERE status = p_status;
END;
$proc$;

-- 调用：必须在同一事务/会话内 FETCH
BEGIN;
CALL p_list_orders('N', NULL);
FETCH ALL FROM "<unnamed portal 1>";
COMMIT;
```

更推荐 B：函数返回 `refcursor` 或 `SETOF`：

```sql
CREATE OR REPLACE FUNCTION f_list_orders(p_status varchar)
RETURNS TABLE (id numeric, amount numeric)
LANGUAGE sql STABLE AS $fn$
  SELECT id, amount FROM t_order WHERE status = p_status;
$fn$;
```

```sql
SELECT * FROM f_list_orders('N');
```

`refcursor` 的注意事项：portal 名在事务结束即失效；连接池/ORM 支持度不一。优先改成 `SETOF`/`RETURNS TABLE`。

## 5. 函数属性

| 属性 | 何时用 |
|---|---|
| `IMMUTABLE` | 只依赖入参、无数据库读取、无副作用；可用于表达式索引 |
| `STABLE` | 同一语句内读库结果稳定（如读表、`CURRENT_TIMESTAMP`） |
| `VOLATILE`（默认） | 有写入、序列、`random()`、`clock_timestamp()` |
| `STRICT` | 任入参为 NULL 就返回 NULL（不要与 `INTO STRICT` 混淆） |
| `SECURITY DEFINER` | 需要以定义者权限执行；必须 `SET search_path = pg_catalog, public` 防注入 |
| `PARALLEL SAFE` | 可在并行 worker 中执行；有写入/序列的函数不能标 |
| `COST` / `ROWS` | 优化器代价提示；表函数给 `ROWS` |

函数内做 DDL 可以（`EXECUTE 'CREATE TABLE ...'`），但不能 `COMMIT`；临时表创建在函数内要谨慎（连接池复用、`ON COMMIT` 行为）。

## 6. 重载与解析

Oracle 包内重载很常见；PG 按参数类型解析，`OUT` 参数不参与签名。

```sql
-- Oracle 包内
PROCEDURE p(x IN NUMBER);
PROCEDURE p(x IN VARCHAR2);
```

```sql
-- PG：两个函数同名不同参数类型
CREATE FUNCTION pkg.p(x numeric) RETURNS void ...
CREATE FUNCTION pkg.p(x varchar) RETURNS void ...
```

- 调用点如果传 `unknown` 字面量（`pkg.p('1')`）会歧义，需显式 `'1'::varchar` 或 `1`。
- Oracle 只按 OUT 参数或返回类型区分、按参数名区分的情况，PG 不支持，必须合并或改名。
- `DROP FUNCTION` 必须带参数类型：`DROP FUNCTION pkg.p(numeric);`

## 7. 调用点改写

| Oracle | PG14 |
|---|---|
| `SELECT f(x) FROM dual;` | `SELECT f(x);` |
| `v := f(x);` | 同 |
| `BEGIN p(a, b); END;` | `CALL p(a, b);` |
| `EXEC p(a);` | `CALL p(a);` |
| `pkg.proc(a);`（匿名块内） | `CALL pkg.proc(a);` |
| `SELECT * FROM TABLE(f(x));` | `SELECT * FROM f(x);` |
| `SELECT pkg.f(x) FROM dual;` | `SELECT pkg.f(x);` |
| 函数用于 `WHERE`/索引 | 同上，注意 volatility 与索引可用性 |

## 8. 权限与部署

```sql
GRANT EXECUTE ON FUNCTION f_get_amt(numeric, numeric) TO app_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pkg TO app_role;
REVOKE ALL ON FUNCTION f_get_amt(numeric, numeric) FROM PUBLIC;
```

- 默认 `PUBLIC` 对函数有 `EXECUTE` 权限；敏感函数要显式 `REVOKE`。
- `SECURITY DEFINER` 函数必须固定 `search_path`，否则可能被同名对象劫持。
- 函数/过程脚本放在依赖对象之后执行；`CREATE OR REPLACE` 不能改返回类型，改签名要先 `DROP`。

## 9. 编译校验

```sql
SET check_function_bodies = on;   -- 建函数时做语法检查（默认开）
-- 重新执行 CREATE OR REPLACE 后检查
SELECT p.oid::regprocedure AS fn, p.provolatile, p.prosecdef
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'app';
```

有 `plpgsql_check` 扩展时：

```sql
CREATE EXTENSION IF NOT EXISTS plpgsql_check;
SELECT * FROM plpgsql_check_function('app.f_get_amt(numeric,numeric)'::regprocedure);
```

它会报未声明变量、类型不匹配、不可达分支等；没有该扩展就靠 `check_function_bodies` + 冒烟调用。

## 10. 常见问题

| 现象 | 处理 |
|---|---|
| `function ... does not exist` | 参数类型/个数不匹配；显式转换或补重载 |
| `cannot change return type of existing function` | 先 `DROP FUNCTION` 再建 |
| `RETURN QUERY` 报错 | 函数必须 `RETURNS SETOF`/`TABLE` |
| `query returned more than one row` | `INTO STRICT` 遇到多行；加 `LIMIT 1` 或改逻辑 |
| 函数里 `COMMIT` 报错 | 改为过程，或去掉事务控制 |
| `permission denied for function` | 补 `GRANT EXECUTE`，注意参数签名 |
| `SECURITY DEFINER` 警告 | 加 `SET search_path` |