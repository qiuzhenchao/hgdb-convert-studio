-- =====================================================================
-- oracle-extract.sql  (SQL*Plus)
-- 用 DBMS_METADATA 从 Oracle 源库抽取 DDL / PLSQL，按对象类型分文件。
-- 用法：
--   sqlplus -S -L user/pass@host:port/service @oracle-extract.sql OWNER OUTDIR
-- OWNER  : 源 schema，例如 SCOTT（不区分大小写）
-- OUTDIR : 输出目录，例如 D:\migration\src
-- 注意：需要 SELECT_CATALOG_ROLE / DBA 之类的元数据读取权限。
-- =====================================================================
SET LONG 100000000
SET LONGCHUNKSIZE 1000000
SET PAGESIZE 0
SET LINESIZE 32767
SET TRIMSPOOL ON
SET FEEDBACK OFF
SET HEADING OFF
SET ECHO OFF
SET VERIFY OFF
SET TIMING OFF
SET SQLBLANKLINES ON
SET DEFINE ON

DEFINE src_owner = '&1'
DEFINE out_dir   = '&2'

BEGIN
  DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'PRETTY', TRUE);
  DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SQLTERMINATOR', TRUE);
  DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'SEGMENT_ATTRIBUTES', FALSE);
  DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'STORAGE', FALSE);
  DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'TABLESPACE', FALSE);
  DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'CONSTRAINTS', TRUE);
  DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'REF_CONSTRAINTS', TRUE);
  DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, 'FORCE', TRUE);
END;
/

-- 0. 对象清单
SPOOL &out_dir./00_inventory.txt
PROMPT == object inventory for &src_owner ==
SELECT object_type || ' : ' || COUNT(*)
FROM all_objects
WHERE owner = UPPER('&src_owner')
  AND object_type IN ('TABLE','INDEX','VIEW','MATERIALIZED VIEW','SEQUENCE','SYNONYM',
                      'FUNCTION','PROCEDURE','PACKAGE','PACKAGE BODY','TRIGGER','TYPE','TYPE BODY')
GROUP BY object_type
ORDER BY object_type;
SPOOL OFF

-- 1. 表（含约束；索引单独导出）
SPOOL &out_dir./01_tables.sql
SELECT DBMS_METADATA.GET_DDL('TABLE', object_name, owner)
FROM all_objects
WHERE owner = UPPER('&src_owner') AND object_type = 'TABLE'
  AND object_name NOT LIKE 'BIN$%'
  AND object_name NOT IN (
    SELECT mview_name FROM all_mviews WHERE owner = UPPER('&src_owner')
  )
ORDER BY object_name;
SPOOL OFF

-- 2. 索引
SPOOL &out_dir./02_indexes.sql
SELECT DBMS_METADATA.GET_DDL('INDEX', object_name, owner)
FROM all_objects
WHERE owner = UPPER('&src_owner') AND object_type = 'INDEX'
  AND object_name NOT LIKE 'BIN$%'
ORDER BY object_name;
SPOOL OFF

-- 3. 视图
SPOOL &out_dir./03_views.sql
SELECT DBMS_METADATA.GET_DDL('VIEW', object_name, owner)
FROM all_objects
WHERE owner = UPPER('&src_owner') AND object_type = 'VIEW'
ORDER BY object_name;
SPOOL OFF

-- 4. 物化视图
SPOOL &out_dir./04_matviews.sql
SELECT DBMS_METADATA.GET_DDL('MATERIALIZED_VIEW', object_name, owner)
FROM all_objects
WHERE owner = UPPER('&src_owner') AND object_type = 'MATERIALIZED VIEW'
ORDER BY object_name;
SPOOL OFF

-- 5. 序列
SPOOL &out_dir./05_sequences.sql
SELECT DBMS_METADATA.GET_DDL('SEQUENCE', object_name, owner)
FROM all_objects
WHERE owner = UPPER('&src_owner') AND object_type = 'SEQUENCE'
ORDER BY object_name;
SPOOL OFF

-- 6. 同义词
SPOOL &out_dir./06_synonyms.sql
SELECT DBMS_METADATA.GET_DDL('SYNONYM', object_name, owner)
FROM all_objects
WHERE owner = UPPER('&src_owner') AND object_type = 'SYNONYM'
ORDER BY object_name;
SPOOL OFF

-- 7. 函数
SPOOL &out_dir./07_functions.sql
SELECT DBMS_METADATA.GET_DDL('FUNCTION', object_name, owner)
FROM all_objects
WHERE owner = UPPER('&src_owner') AND object_type = 'FUNCTION'
  AND object_name NOT LIKE 'BIN$%'
ORDER BY object_name;
SPOOL OFF

-- 8. 存储过程
SPOOL &out_dir./08_procedures.sql
SELECT DBMS_METADATA.GET_DDL('PROCEDURE', object_name, owner)
FROM all_objects
WHERE owner = UPPER('&src_owner') AND object_type = 'PROCEDURE'
  AND object_name NOT LIKE 'BIN$%'
ORDER BY object_name;
SPOOL OFF

-- 9. 包规范
SPOOL &out_dir./09_packages.sql
SELECT DBMS_METADATA.GET_DDL('PACKAGE', object_name, owner)
FROM all_objects
WHERE owner = UPPER('&src_owner') AND object_type = 'PACKAGE'
ORDER BY object_name;
SPOOL OFF

-- 10. 包体
SPOOL &out_dir./10_package_bodies.sql
SELECT DBMS_METADATA.GET_DDL('PACKAGE_BODY', object_name, owner)
FROM all_objects
WHERE owner = UPPER('&src_owner') AND object_type = 'PACKAGE BODY'
ORDER BY object_name;
SPOOL OFF

-- 11. 触发器
SPOOL &out_dir./11_triggers.sql
SELECT DBMS_METADATA.GET_DDL('TRIGGER', object_name, owner)
FROM all_objects
WHERE owner = UPPER('&src_owner') AND object_type = 'TRIGGER'
ORDER BY object_name;
SPOOL OFF

-- 12. 类型
SPOOL &out_dir./12_types.sql
SELECT DBMS_METADATA.GET_DDL('TYPE', object_name, owner)
FROM all_objects
WHERE owner = UPPER('&src_owner') AND object_type = 'TYPE'
ORDER BY object_name;
SPOOL OFF

-- 13. 注释
SPOOL &out_dir./13_comments.sql
SELECT 'COMMENT ON TABLE ' || owner || '.' || table_name || ' IS ' ||
       DBMS_ASSERT.ENQUOTE_LITERAL(comments) || ';'
FROM all_tab_comments
WHERE owner = UPPER('&src_owner') AND comments IS NOT NULL
ORDER BY table_name;

SELECT 'COMMENT ON COLUMN ' || owner || '.' || table_name || '.' || column_name || ' IS ' ||
       DBMS_ASSERT.ENQUOTE_LITERAL(comments) || ';'
FROM all_col_comments
WHERE owner = UPPER('&src_owner') AND comments IS NOT NULL
ORDER BY table_name, column_name;
SPOOL OFF

-- 14. 表/视图权限（简化版；列级权限请另行导出）
SPOOL &out_dir./14_grants.sql
SELECT 'GRANT ' || privilege || ' ON ' || owner || '.' || table_name || ' TO ' || grantee || ';'
FROM all_tab_privs
WHERE owner = UPPER('&src_owner')
  AND privilege IN ('SELECT','INSERT','UPDATE','DELETE','REFERENCES')
ORDER BY table_name, grantee, privilege;
SPOOL OFF

PROMPT Extraction finished. Check files under &out_dir.
EXIT