# 03 PL/SQL → PL/pgSQL

## 1. 块结构

```sql
-- Oracle 匿名块
DECLARE
  v_cnt NUMBER := 0;
BEGIN
  SELECT COUNT(*) INTO v_cnt FROM t;
  DBMS_OUTPUT.PUT_LINE(v_cnt);
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE(SQLERRM);
END;
/
```

```sql
-- PG14 匿名块
DO $blk$
DECLARE
  v_cnt numeric := 0;
BEGIN
  SELECT COUNT(*) INTO STRICT v_cnt FROM t;
  RAISE NOTICE '%', v_cnt;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE '%', SQLERRM;
END;
$blk$;
```

要点：
- `DECLARE` 段在 `BEGIN` 之前，位置与 Oracle 相同；`IS`/`AS` 都可。
- 每条语句以 `;` 结尾，`END` 后也要 `;`。
- 块结束用 `$tag$`（推荐 `$blk$`、`$fn$`），对象体里出现 `$$` 时**必须**换 tag。
- `DBMS_OUTPUT.PUT_LINE` → `RAISE NOTICE '%', ...`（PG 立即输出，没有 Oracle 的会话缓冲区）。

## 2. 声明

| Oracle | PL/pgSQL |
|---|---|
| `v NUMBER(10,2) := 0;` | `v numeric(10,2) := 0;` |
| `c CONSTANT NUMBER := 1;` | `c CONSTANT numeric := 1;` |
| `v t.col%TYPE;` | `v t.col%TYPE;` |
| `r t%ROWTYPE;` | `r t%ROWTYPE;` |
| `r c%ROWTYPE;`（游标） | `r c%ROWTYPE;` |
| `TYPE rec IS RECORD (a NUMBER, b VARCHAR2(10));` | `rec record;` 动态结构，或 `CREATE TYPE ... AS (a numeric, b varchar(10));` |
| `TYPE t_tab IS TABLE OF t.col%TYPE INDEX BY PLS_INTEGER;` | `arr numeric[];` 或临时表 |
| `v BOOLEAN := TRUE;` | `v boolean := true;` |
| 变量名与列名冲突 | PL/pgSQL 的 `#variable_conflict` 可配置；优先加前缀 `v_`/`p_` |

注意：`record` 变量没有编译期字段校验；需要固定结构时用 `CREATE TYPE` + `%ROWTYPE`。

## 3. 赋值与 SELECT INTO

```sql
v := expr;                 -- 一致
v := (SELECT x FROM t WHERE id = p_id);   -- 无行时为 NULL，不报错
SELECT x, y INTO v_x, v_y FROM t WHERE id = p_id;   -- 多行取第一行、零行不报错
SELECT x, y INTO STRICT v_x, v_y FROM t WHERE id = p_id;  -- 等价 Oracle 严格语义
```

**关键**：Oracle 的 `SELECT INTO` 零行抛 `NO_DATA_FOUND`、多行抛 `TOO_MANY_ROWS`；PL/pgSQL 默认不抛。只要原代码依赖异常分支，就在 `INTO` 后加 `STRICT`（PG 9.5+），异常名同为 `NO_DATA_FOUND` / `TOO_MANY_ROWS`。

## 4. 异常

| Oracle | PL/pgSQL |
|---|---|
| `WHEN NO_DATA_FOUND THEN` | `WHEN NO_DATA_FOUND THEN`（需 `STRICT` 才触发） |
| `WHEN TOO_MANY_ROWS THEN` | `WHEN TOO_MANY_ROWS THEN`（需 `STRICT`） |
| `WHEN ZERO_DIVIDE THEN` | `WHEN division_by_zero THEN` |
| `WHEN DUP_VAL_ON_INDEX THEN` | `WHEN unique_violation THEN` |
| `WHEN INVALID_NUMBER THEN` | `WHEN invalid_text_representation THEN` |
| `WHEN VALUE_ERROR THEN` | 按具体 SQLSTATE 判断，或 `WHEN OTHERS` |
| `WHEN OTHERS THEN ... RAISE;` | 同 |
| `PRAGMA EXCEPTION_INIT(e, -20001)` | 无；抛出处用 `ERRCODE`，捕获处用 `WHEN SQLSTATE 'P0001'` |
| `RAISE_APPLICATION_ERROR(-20001, 'msg')` | `RAISE EXCEPTION 'msg' USING ERRCODE = 'P0001';` |
| `SQLCODE` | `SQLSTATE`（5 位字符串，不是数字） |
| `SQLERRM` | `SQLERRM`（异常处理中有效） |
| `DBMS_UTILITY.FORMAT_ERROR_STACK` | `SQLERRM` + `GET STACKED DIAGNOSTICS` |

自定义错误号约定：Oracle `-20001..-20999` 没有一一对应；建议统一用 `P0001`，把原错误号写进 `MESSAGE`（如 `'[ORA-20001] ...'`），或在报告里维护 `SQLSTATE ↔ ORA 错误号` 对照表。需要区分多个业务异常时，分配 `P0001`、`P0002`…（合法 5 位 SQLSTATE）。

捕获并记录堆栈：

```sql
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
  RAISE NOTICE 'sqlstate=% msg=%', v_state, v_msg;
  RAISE;
```

## 5. 游标

```sql
-- Oracle
CURSOR c_emp(p_dept NUMBER) IS SELECT id, name FROM emp WHERE dept_id = p_dept;
r c_emp%ROWTYPE;
BEGIN
  OPEN c_emp(10);
  LOOP
    FETCH c_emp INTO r;
    EXIT WHEN c_emp%NOTFOUND;
    ...
  END LOOP;
  CLOSE c_emp;
END;
```

```sql
-- PG14：语法几乎一致
DECLARE
  c_emp CURSOR (p_dept numeric) FOR SELECT id, name FROM emp WHERE dept_id = p_dept;
  r c_emp%ROWTYPE;
BEGIN
  OPEN c_emp(10);
  LOOP
    FETCH c_emp INTO r;
    EXIT WHEN c_emp%NOTFOUND;
    ...
  END LOOP;
  CLOSE c_emp;
END;
```

| 用法 | 说明 |
|---|---|
| `FOR r IN c_emp(10) LOOP` | 支持；自动开关游标 |
| `FOR r IN (SELECT ...) LOOP` | 支持 |
| `c%FOUND` / `%NOTFOUND` / `%ROWCOUNT` / `%ISOPEN` | 支持 |
| `WHERE CURRENT OF c` | 支持，但游标查询必须带 `FOR UPDATE` |
| `SYS_REFCURSOR` | 改为 `refcursor` 变量；`OPEN rc FOR SELECT ...`；作为函数返回值 `RETURNS refcursor` |
| 游标变量作为 OUT 参数 | 函数/过程参数类型写 `refcursor`，调用方 `FETCH` |
| 游标里更新同一表 | PG 行级触发器看到语句快照，Oracle 可能报 mutating table；语义不同，需测试 |

## 6. 动态 SQL

| Oracle | PL/pgSQL |
|---|---|
| `EXECUTE IMMEDIATE sql;` | `EXECUTE sql;` |
| `EXECUTE IMMEDIATE sql INTO v;` | `EXECUTE sql INTO v;` |
| `EXECUTE IMMEDIATE sql USING a, b;` | `EXECUTE sql USING a, b;` |
| `EXECUTE IMMEDIATE sql INTO v USING a;` | `EXECUTE sql INTO v USING a;` |
| 占位符 `:1` / `:name` | `$1` / `$2`（按位置） |
| `OPEN c FOR sql USING a;` | `OPEN c FOR EXECUTE sql USING a;` |
| `DBMS_SQL.PARSE/EXECUTE` | 改为 `EXECUTE`；需要列元数据时只能查 `information_schema` 或改写调用方 |

注意：
- `EXECUTE` 的字符串里不能有多个语句（PG 扩展协议限制）；DDL 一条一条执行。
- 动态 SQL 拼接表名/列名时用 `format('%I', name)` 转义标识符、`format('%L', value)` 转义字面量，**不要**用字符串拼接拼值。
- 动态 SQL 的 `INTO` 在 `USING` 之前。

## 7. 批量处理

| Oracle | PG14 |
|---|---|
| `SELECT x BULK COLLECT INTO arr FROM t;` | `SELECT array_agg(x) INTO arr FROM t;` 或 `arr := ARRAY(SELECT x FROM t);` |
| `FORALL i IN 1..arr.COUNT INSERT INTO ... VALUES (arr(i));` | `INSERT INTO ... SELECT unnest(arr);` |
| `FORALL ... UPDATE ...` | `UPDATE ... FROM unnest(arr) AS u(...) WHERE ...` |
| `FORALL ... %BULK_ROWCOUNT` | `GET DIAGNOSTICS v_rows = ROW_COUNT;` |
| `INSERT ... RETURNING ... BULK COLLECT INTO` | `WITH ins AS (INSERT ... RETURNING x) SELECT array_agg(x) INTO arr FROM ins;` |
| `LIMIT n` 分批 `BULK COLLECT` | `SELECT array_agg(x) INTO arr FROM (SELECT x FROM t LIMIT n) q;` |

数组元素遍历：`FOREACH v IN ARRAY arr LOOP ... END LOOP;`；下标从 1 开始（与 Oracle 一致），但稀疏数组要注意 `array_lower/array_upper`。

## 8. 事务

- **函数内禁止** `COMMIT` / `ROLLBACK`；`SAVEPOINT` / `ROLLBACK TO SAVEPOINT` 可用（异常块本身就是子事务）。
- **过程**（`CALL`）内允许 `COMMIT`/`ROLLBACK`，但仅当调用方不在显式事务块中；在 `BEGIN ... COMMIT` 块里调用会报 `invalid transaction termination`。
- Oracle 过程常「每 N 行提交一次」：迁移方案：
  1. 若调用方是自动提交的客户端，改为 `PROCEDURE` + `CALL`；
  2. 去掉中间提交，由调用方一次性提交（锁与回滚段行为不同，需评估）；
  3. 真的需要分批提交时，用客户端循环分页调用。
- `SAVEPOINT sp; ... ROLLBACK TO SAVEPOINT sp;` 支持；异常块本身就是子事务，捕获异常不会回滚整个事务。
- `SET TRANSACTION READ ONLY`、`SET CONSTRAINTS` 支持。

## 9. 自治事务

PG 无 `PRAGMA AUTONOMOUS_TRANSACTION`。方案：

1. **dblink / postgres_fdw 回环**：用独立连接执行写入，能真正独立提交；需要扩展与连接配置，性能差。
2. **pg_background**（扩展）：后台 worker 执行。
3. **队列表 + 独立消费者**：主事务写队列表，消费者事务独立提交；复杂但可控。
4. **HGDB 兼容模式**：若探测显示支持 `PRAGMA AUTONOMOUS_TRANSACTION`，可保留；否则不要生成伪实现。

写日志/审计这类「失败也要留下记录」的场景，优先方案 3；报告里必须标高风险。

## 10. 其他语句

| Oracle | PL/pgSQL |
|---|---|
| `GOTO label;` | 不支持；重构为 `IF`/`LOOP`/`RETURN` |
| `<<outer>> ... EXIT outer;` | 支持标签与 `EXIT label` |
| `CONTINUE [WHEN cond];` | 支持（PG11+） |
| `WHILE cond LOOP` | 支持 |
| `FOR i IN REVERSE 1..10` | 支持 |
| `CASE ... WHEN ... THEN ... END CASE;` | 支持 |
| `NULL;` | 支持 |
| 嵌套子程序 `FUNCTION f ... END;`（DECLARE 段） | 支持嵌套函数；嵌套过程不支持 |
| `RETURN;`（过程） | 支持 |

## 11. 常见错误对照

| 现象 | 原因 | 处理 |
|---|---|---|
| `query returned no rows` 没触发异常 | `SELECT INTO` 未加 `STRICT` | 加 `STRICT` |
| 多行只取了第一行 | 未加 `STRICT` | 加 `STRICT` 或显式 `LIMIT 1` |
| `invalid transaction termination` | 在显式事务块/函数里 `COMMIT` | 改为过程 + 客户端控制事务 |
| `cannot use RETURN QUERY in a non-SETOF function` | 函数未声明 `RETURNS SETOF`/`TABLE` | 见 04 |
| `column reference "x" is ambiguous` | 变量与列同名 | 变量加前缀，或 `#variable_conflict use_variable` |
| `syntax error at or near ";"` | `END IF`/`END LOOP` 后漏分号 | 补 `;` |
| `function does not exist` | 参数类型不匹配（numeric vs int） | 显式转换或改签名 |