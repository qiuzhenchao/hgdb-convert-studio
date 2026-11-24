# 05 包（PACKAGE / PACKAGE BODY）

PG 没有包对象。Oracle 包迁移成「**一个 schema + 一组函数/过程 + 状态模拟 + 显式初始化**」。

## 1. 映射总表

| Oracle 包元素 | 目标端 |
|---|---|
| `PACKAGE pkg` 规范 | `CREATE SCHEMA pkg`（schema 名与包名一致） |
| 公共 `PROCEDURE p` / `FUNCTION f` | `pkg.p(...)` / `pkg.f(...)`，过程用 `CALL`，函数用 `SELECT` |
| 包体私有过程/函数 | `pkg._private_name(...)`；`REVOKE ALL ... FROM PUBLIC` |
| `g_var` 包级变量 | 会话 GUC（`set_config`/`current_setting`）或临时表，见 §3 |
| `c_const CONSTANT` | 内联字面量，或 `pkg.c_const()` 函数 |
| `TYPE t_rec IS RECORD` | `CREATE TYPE pkg.t_rec AS (...)` |
| `TYPE t_tab IS TABLE OF ...` | 数组类型 `pkg.t_rec[]` 或临时表 |
| `CURSOR c IS SELECT ...` | 函数返回 `SETOF`/`refcursor`，或视图 |
| `e_exception EXCEPTION; PRAGMA EXCEPTION_INIT` | 约定 SQLSTATE（如 `P0001`），`RAISE ... USING ERRCODE` |
| 包初始化 `BEGIN ... END;` | `pkg.ensure_init()`，公共函数入口惰性调用 |
| `PRAGMA SERIALLY_REUSABLE` | 忽略，写进报告 |
| 包重载 | schema 内同名不同参数类型的函数（OUT 参数不参与签名） |
| `GRANT EXECUTE ON pkg.p` | `GRANT EXECUTE ON FUNCTION pkg.p(参数类型)` 或 `ON ALL ROUTINES IN SCHEMA pkg` |

## 2. 迁移步骤

1. 建 schema：`CREATE SCHEMA IF NOT EXISTS pkg;`
2. 先建类型/常量函数（被后面引用）。
3. 建私有函数（包体里的 `_xxx`），再建公共函数/过程。
4. 建状态读写辅助函数与 `ensure_init()`。
5. 改写调用点：`pkg.f(...)`、`CALL pkg.p(...)`，权限与 `search_path` 一起调整。
6. 编译校验 + 冒烟用例（同一会话内连续调用，验证状态）。

## 3. 包级状态怎么模拟

Oracle 包变量是**会话级内存**，不参与事务回滚。PG 里没有完全等价物，三选一：

| 方案 | 写法 | 事务回滚 | 连接池 | 适用 |
|---|---|---|---|---|
| 会话 GUC | `set_config('pkg.g_var', v, false)` / `current_setting('pkg.g_var', true)` | 回滚会还原（与 Oracle 不同） | 会话级，`DISCARD ALL` 清零 | 简单开关、计数器、缓存 |
| 临时表 | `CREATE TEMP TABLE IF NOT EXISTS pkg_state(k text primary key, v text) ON COMMIT PRESERVE ROWS;` | 回滚会还原 | 会话级，连接结束自动清理 | 结构化状态、需要查询/调试 |
| 普通表 + `pg_backend_pid()` | `pkg_state(pid int, k text, v text, primary key(pid,k))` | 回滚会还原；进程结束需清理 | 会话级但跨连接可见 | 需要观测或跨函数共享 |

实践建议：优先 GUC；状态多、类型多时用临时表；**不要**把状态放进普通表当全局变量用（并发与清理都会出问题）。

GUC 名称必须带点号（如 `pkg_order.g_batch_no`）。未设置时 `current_setting(name, true)` 返回 NULL。

## 4. 完整示例

Oracle：

```sql
CREATE OR REPLACE PACKAGE pkg_order AS
  c_status_new CONSTANT VARCHAR2(1) := 'N';
  g_batch_no   NUMBER;
  PROCEDURE close_order(p_id IN NUMBER);
  FUNCTION  get_status(p_id IN NUMBER) RETURN VARCHAR2;
END pkg_order;
/
CREATE OR REPLACE PACKAGE BODY pkg_order AS
  g_init_done BOOLEAN := FALSE;

  PROCEDURE ensure_init IS
  BEGIN
    IF NOT g_init_done THEN
      g_batch_no := 0;
      g_init_done := TRUE;
    END IF;
  END;

  PROCEDURE close_order(p_id IN NUMBER) IS
  BEGIN
    ensure_init;
    g_batch_no := g_batch_no + 1;
    UPDATE t_order SET status = 'C', batch_no = g_batch_no WHERE id = p_id;
    COMMIT;
  END;

  FUNCTION get_status(p_id IN NUMBER) RETURN VARCHAR2 IS
    v_status VARCHAR2(1);
  BEGIN
    SELECT status INTO v_status FROM t_order WHERE id = p_id;
    RETURN v_status;
  END;
BEGIN
  g_batch_no := 0;
END pkg_order;
/
```

PG14：

```sql
CREATE SCHEMA IF NOT EXISTS pkg_order;

-- 常量：用不变函数暴露，便于复用与权限控制
CREATE OR REPLACE FUNCTION pkg_order.c_status_new() RETURNS varchar
LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'N'::varchar $fn$;

-- 状态辅助：会话 GUC
CREATE OR REPLACE FUNCTION pkg_order.get_var(p_name text) RETURNS text
LANGUAGE plpgsql AS $fn$
BEGIN
  RETURN current_setting('pkg_order.' || p_name, true);
END;
$fn$;

CREATE OR REPLACE FUNCTION pkg_order.set_var(p_name text, p_value text) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('pkg_order.' || p_name, p_value, false);
END;
$fn$;

-- 初始化：惰性调用，可重复
CREATE OR REPLACE FUNCTION pkg_order.ensure_init() RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  IF coalesce(current_setting('pkg_order.init_done', true), 'false') <> 'true' THEN
    PERFORM set_config('pkg_order.g_batch_no', '0', false);
    PERFORM set_config('pkg_order.init_done', 'true', false);
  END IF;
END;
$fn$;

-- 公共过程
CREATE OR REPLACE PROCEDURE pkg_order.close_order(p_id numeric)
LANGUAGE plpgsql AS $proc$
DECLARE
  v_batch numeric;
BEGIN
  PERFORM pkg_order.ensure_init();
  v_batch := coalesce(pkg_order.get_var('g_batch_no'), '0')::numeric + 1;
  PERFORM pkg_order.set_var('g_batch_no', v_batch::text);

  UPDATE t_order SET status = 'C', batch_no = v_batch WHERE id = p_id;
  COMMIT;   -- 仅在调用方无显式事务块时可行
END;
$proc$;

-- 公共函数
CREATE OR REPLACE FUNCTION pkg_order.get_status(p_id numeric) RETURNS varchar
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_status varchar(1);
BEGIN
  SELECT status INTO STRICT v_status FROM t_order WHERE id = p_id;
  RETURN v_status;
END;
$fn$;

-- 权限
GRANT USAGE ON SCHEMA pkg_order TO app_role;
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA pkg_order TO app_role;
REVOKE ALL ON ALL ROUTINES IN SCHEMA pkg_order FROM PUBLIC;
```

调用：

```sql
SELECT pkg_order.get_status(1);
CALL pkg_order.close_order(1);
```

## 5. 初始化块

Oracle 包体末尾的 `BEGIN ... END;` 在会话首次引用包时执行一次。PG 没有这个机制：

- 方案 A（推荐）：每个公共函数/过程入口调用 `ensure_init()`，用 GUC 标记防重复。
- 方案 B：部署/连接建立脚本显式 `SELECT pkg.ensure_init();`；连接池场景要在「取到连接后」执行（很多池不支持，风险高）。
- 方案 C：把初始化逻辑做成 idempotent 的 SQL（`INSERT ... ON CONFLICT DO NOTHING`），在应用启动时执行一次。

报告里必须写清楚：初始化不再自动，依赖方案 A/B/C。

## 6. 常量与类型

- 常量：少量热路径直接内联字面量；需要被多对象引用时用 `pkg.c_xxx()` 函数（`IMMUTABLE`）。
- `TYPE t_rec IS RECORD` → `CREATE TYPE pkg.t_rec AS (a numeric, b varchar(10));`
- `TYPE t_tab IS TABLE OF t_rec INDEX BY PLS_INTEGER` → `pkg.t_rec[]` 数组；或临时表（需要 DML/关联查询时）。
- `TYPE t_varray IS VARRAY(n) OF ...` → 数组（PG 不强制长度，要长度约束就加 `CHECK (array_length(arr,1) <= n)`）。
- 包级游标：改成返回 `SETOF`/`refcursor` 的函数，或建视图；不要把游标声明成 schema 对象（PG 没有）。
- 包级异常：`RAISE EXCEPTION '...' USING ERRCODE = 'P0001'`；捕获方 `WHEN SQLSTATE 'P0001'`。

## 7. 重载、私有成员、依赖

- 重载：schema 内同名函数按参数类型区分；`OUT` 不参与签名。Oracle 只按 `OUT`/返回类型区分的重载必须合并或改名。
- 私有成员：命名加 `_` 前缀并 `REVOKE`；PG 没有真正的「包内可见」。
- 包间依赖：`pkg_a` 调用 `pkg_b` 时，先建 `pkg_b` 的 schema 与函数；循环依赖用「先建函数声明 + `CREATE OR REPLACE` 补实现」不可行（PG 没有前向声明），只能拆出公共函数或调整依赖。
- `search_path`：调用点建议始终写全 `pkg.fn`；不要依赖 `search_path` 隐式解析。

## 8. 事务与提交

- 包过程里的 `COMMIT` 迁移成 `PROCEDURE` + `CALL`；若调用方在事务块中，`COMMIT` 会失败。
- 包函数里的 `COMMIT` 必须去掉（PG 函数禁止事务控制），由调用方提交。
- 自治事务（`PRAGMA AUTONOMOUS_TRANSACTION`）见 03 §9；包内自治事务通常用于日志，建议改成队列表 + 独立消费者。

## 9. 限制与风险

| 风险 | 说明 |
|---|---|
| 状态语义 | GUC/临时表会随事务回滚还原；Oracle 包变量不会。依赖「回滚后状态仍在」的逻辑必须改。 |
| 初始化时机 | 不再自动执行；漏调 `ensure_init()` 会导致空状态。 |
| 连接池 | 会话状态可能被复用/清理（`DISCARD ALL`、重启）；不要存跨请求关键数据。 |
| 循环依赖 | PG 无前向声明，包间循环依赖要重构。 |
| 私有性 | schema 级函数对拥有 `USAGE` 的角色可见/可调用；靠 `REVOKE` 约束。 |
| 权限 | 函数默认对 `PUBLIC` 可执行；生产环境必须收紧。 |

## 10. 自检清单

- [ ] `CREATE SCHEMA` 在函数之前，schema 名不与表/视图冲突。
- [ ] 所有公共子程序都有对应函数/过程，签名（参数类型、默认值）一致。
- [ ] 包级变量都有读写路径，且说明事务/会话行为。
- [ ] 初始化逻辑有显式入口，并在每个公共入口调用（方案 A）或部署脚本执行（方案 B）。
- [ ] 调用点全部改为 `schema.fn(...)` / `CALL schema.proc(...)`。
- [ ] 权限：`USAGE` on schema + `EXECUTE` on routines，`PUBLIC` 已收回。
- [ ] 同一会话内连续调用两次，状态符合预期；事务回滚后的行为已记录。