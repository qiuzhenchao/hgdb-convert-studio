# 06 视图与物化视图

## 1. 普通视图

```sql
-- Oracle
CREATE OR REPLACE FORCE VIEW v_order_summary AS
SELECT o.id, o.amount, c.name AS customer_name
FROM t_order o, t_customer c
WHERE o.customer_id = c.id(+);
```

```sql
-- PG14
CREATE OR REPLACE VIEW v_order_summary AS
SELECT o.id, o.amount, c.name AS customer_name
FROM t_order o
LEFT JOIN t_customer c ON c.id = o.customer_id;
```

| Oracle | PG14 |
|---|---|
| `CREATE OR REPLACE VIEW` | 同 |
| `FORCE` / `NOFORCE` | 无；先建依赖，或先建占位视图再 `CREATE OR REPLACE` |
| 列别名列表 `VIEW v (a, b) AS` | 同 |
| `WITH CHECK OPTION` | 同（仅自动可更新视图） |
| `WITH READ ONLY` | 无；`REVOKE INSERT, UPDATE, DELETE ON v FROM role` |
| `BEQUEATH DEFINER/CURRENT_USER` | 视图默认以所有者权限执行；PG14 无 `security_invoker`（PG15+ 才有） |
| `ALTER VIEW ... COMPILE` | `CREATE OR REPLACE VIEW` 重建 |
| 视图依赖视图 | 同；`DROP ... CASCADE` 会连带删除 |

### FORCE 视图的迁移顺序

1. 先建被依赖的表/视图；
2. 建视图；
3. 若必须保留「先建视图后建表」的部署顺序，先建占位视图：

```sql
CREATE OR REPLACE VIEW v_x AS SELECT NULL::numeric AS id, NULL::text AS name WHERE false;
-- 依赖对象建好后
CREATE OR REPLACE VIEW v_x AS SELECT id, name FROM t_x;
```

`CREATE OR REPLACE VIEW` 不能改列名/列类型/列顺序；改了就先 `DROP VIEW` 再建，并检查依赖（`DROP ... CASCADE` 会删掉下游视图，慎用）。

### 只读与安全

- 只读：撤销 DML 权限；或让视图带聚合/`DISTINCT`/`UNION`（PG 不会自动可更新）。
- 行级安全：Oracle VPD（`DBMS_RLS`）→ PG `ROW LEVEL SECURITY` + policy；视图会以所有者身份访问基表，注意 RLS 只对基表所有者之外的角色生效。
- `security_barrier`：视图用于过滤敏感行时加 `WITH (security_barrier = true)`，防止函数泄漏。

### 可更新视图

PG 自动可更新视图要求：单表、无聚合/`DISTINCT`/`GROUP BY`/`UNION`/窗口函数、列直接来自基表。否则用 `INSTEAD OF` 触发器（见 07）。

## 2. 物化视图

```sql
-- Oracle
CREATE MATERIALIZED VIEW mv_order_daily
REFRESH FAST ON COMMIT
ENABLE QUERY REWRITE
AS SELECT TRUNC(created_at) d, COUNT(*) cnt, SUM(amount) amt
   FROM t_order GROUP BY TRUNC(created_at);
```

```sql
-- PG14
CREATE MATERIALIZED VIEW mv_order_daily AS
SELECT date_trunc('day', created_at)::date AS d, COUNT(*) AS cnt, SUM(amount) AS amt
FROM t_order GROUP BY date_trunc('day', created_at)::date
WITH DATA;

CREATE UNIQUE INDEX ux_mv_order_daily_d ON mv_order_daily (d);
```

| Oracle | PG14 |
|---|---|
| `BUILD IMMEDIATE` | 默认 `WITH DATA` |
| `BUILD DEFERRED` | `WITH NO DATA`，之后 `REFRESH MATERIALIZED VIEW` |
| `REFRESH COMPLETE ON DEMAND` | `REFRESH MATERIALIZED VIEW mv;` |
| `REFRESH FAST ON COMMIT` | 无；用触发器/日志表增量维护，或定时全量刷新 |
| `REFRESH FAST ON DEMAND` | 无内置增量；`REFRESH ... CONCURRENTLY` 仍是全量重算，只是不阻塞读 |
| `ENABLE QUERY REWRITE` | 无自动改写；查询必须显式引用物化视图 |
| `ON PREBUILT TABLE` | 无 |
| `MV LOG` | 无；用触发器或 CDC |
| 物化视图上的索引 | 同（先建唯一索引才能 `CONCURRENTLY` 刷新） |

刷新：

```sql
REFRESH MATERIALIZED VIEW mv_order_daily;                  -- 阻塞读，可空库刷新
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_order_daily;     -- 需唯一索引，且视图已填充
```

`CONCURRENTLY` 需要物化视图上有唯一索引，且不能用于未填充的视图；刷新期间产生额外扫描开销。

定时刷新：`pg_cron`：

```sql
SELECT cron.schedule('mv_order_daily', '*/10 * * * *',
                     'REFRESH MATERIALIZED VIEW CONCURRENTLY mv_order_daily');
```

没有 `pg_cron` 时用外部调度（Windows 计划任务 + `psql -c`）。

## 3. 依赖与上线顺序

- 视图按引用顺序建：基表 → 视图 1 → 视图 2。
- 物化视图依赖的表/视图必须先存在；`WITH DATA` 会立刻执行查询，数据量大时先 `WITH NO DATA` 再择机刷新。
- 视图列类型由表达式决定（如 `SUM(numeric)` 仍是 numeric，`COUNT(*)` 是 bigint）；Oracle 客户端若按 `NUMBER` 读取，注意 bigint 映射。
- `DROP VIEW` 前查依赖：

```sql
SELECT dependent_ns.nspname, dependent_view.relname
FROM pg_depend d
JOIN pg_rewrite r ON r.oid = d.objid
JOIN pg_class dependent_view ON dependent_view.oid = r.ev_class
JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent_view.relnamespace
WHERE d.refobjid = 'v_order_summary'::regclass;
```

## 4. 示例：带检查选项的可更新视图

```sql
-- Oracle
CREATE OR REPLACE VIEW v_active_order AS
SELECT id, amount, status FROM t_order WHERE status = 'N'
WITH CHECK OPTION;
```

```sql
-- PG14
CREATE OR REPLACE VIEW v_active_order AS
SELECT id, amount, status FROM t_order WHERE status = 'N'
WITH CHECK OPTION;
```

（简单视图在 PG 中自动可更新，`WITH CHECK OPTION` 行为一致。）

## 5. 自检

- [ ] 视图引用的表/视图都已存在，`(+)` 已改为显式 JOIN。
- [ ] `DUAL`、`ROWNUM`、`DECODE`、`NVL` 等已在视图定义内改写。
- [ ] 列名/类型与下游（报表、ORM、其他视图）一致；`COUNT(*)` 等类型变化已确认。
- [ ] 物化视图的刷新策略、唯一索引、调度方式已写入报告。
- [ ] 只读/权限：`REVOKE` 或 `GRANT SELECT` 已配置。