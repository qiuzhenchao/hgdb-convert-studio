-- =====================================================================
-- validate-hgdb.sql
-- 转换后在 HGDB / PostgreSQL 14 目标库做结构与可编译性检查（只读为主）。
-- 用法：
--   psql "..." -v schema=app -f validate-hgdb.sql
-- =====================================================================
\set ON_ERROR_STOP off

\echo '== 版本 =='
SELECT version() AS version;

\echo '== 对象统计 =='
SELECT n.nspname AS schema,
       count(*) FILTER (WHERE c.relkind = 'r') AS tables,
       count(*) FILTER (WHERE c.relkind = 'p') AS partitioned_tables,
       count(*) FILTER (WHERE c.relkind = 'v') AS views,
       count(*) FILTER (WHERE c.relkind = 'm') AS matviews,
       count(*) FILTER (WHERE c.relkind = 'S') AS sequences,
       count(*) FILTER (WHERE c.relkind = 'i') AS indexes
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
GROUP BY n.nspname
ORDER BY n.nspname;

\echo '== 函数 / 过程 =='
SELECT n.nspname AS schema,
       count(*) FILTER (WHERE p.prokind = 'f') AS functions,
       count(*) FILTER (WHERE p.prokind = 'p') AS procedures,
       count(*) FILTER (WHERE p.prokind = 'a') AS aggregates
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
GROUP BY n.nspname
ORDER BY n.nspname;

\echo '== 触发器 =='
SELECT n.nspname AS schema, c.relname AS table_name, t.tgname AS trigger_name,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY 1, 2, 3;

\echo '== 无效索引 =='
SELECT n.nspname AS schema, c.relname AS index_name
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT i.indisvalid
  AND n.nspname NOT IN ('pg_catalog', 'information_schema');

\echo '== 未填充的物化视图 =='
SELECT n.nspname AS schema, c.relname AS matview
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'm' AND NOT c.relispopulated
ORDER BY 1, 2;

\echo '== plpgsql_check（若已安装） =='
DO $chk$
DECLARE
  v_ext boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'plpgsql_check') INTO v_ext;
  IF NOT v_ext THEN
    RAISE NOTICE 'plpgsql_check 未安装；跳过逐函数检查（可 CREATE EXTENSION plpgsql_check 后重跑）。';
  ELSE
    RAISE NOTICE 'plpgsql_check 已安装。请用下面的查询逐函数检查：';
    RAISE NOTICE '%', $q$SELECT p.oid::regprocedure, c.*
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL plpgsql_check_function(p.oid) c
WHERE n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY 1$q$;
  END IF;
END;
$chk$;

\echo '== 会话/兼容相关参数 =='
SELECT name, setting
FROM pg_settings
WHERE name ILIKE '%oracle%' OR name ILIKE '%compat%' OR name ILIKE '%highgo%'
ORDER BY name;

\echo '== 序列当前值（人工核对主键冲突） =='
SELECT schemaname AS schema, sequencename AS sequence_name, last_value, is_called
FROM pg_sequences
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY 1, 2;

-- 冒烟测试模板（按需修改后执行；默认注释）
-- SELECT app.f_get_amt(1);
-- CALL app.p_close_order(1, NULL);
-- SELECT * FROM app.v_order_summary LIMIT 10;
-- INSERT INTO app.t_order (id, amount, status) VALUES (9999, 1, NULL) RETURNING *;
-- DELETE FROM app.t_order WHERE id = 9999;