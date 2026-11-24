-- =====================================================================
-- probe-hgdb.sql
-- 在 HGDB V9 / PostgreSQL 14 目标库探测 Oracle 兼容能力。
-- 只应在测试库执行：脚本会临时创建 schema/序列/过程，并在结束时清理。
-- 用法：
--   psql "host=... port=... dbname=testdb user=..." -v ON_ERROR_STOP=0 -f probe-hgdb.sql
-- 输出：feature | supported | detail 的能力表。
-- =====================================================================
\set ON_ERROR_STOP off
SET client_min_messages = warning;

DROP TABLE IF EXISTS hgdb_probe_result;
CREATE TEMP TABLE hgdb_probe_result (
  feature    text PRIMARY KEY,
  supported  boolean NOT NULL,
  detail     text
);

DROP SCHEMA IF EXISTS hgdb_probe CASCADE;

DO $probe$
DECLARE
  ok  boolean;
  err text;
  st  text;
BEGIN
  ------------------------------------------------------------------
  -- 准备探测 schema（后续 DDL 测试共用）
  ------------------------------------------------------------------
  BEGIN
    EXECUTE 'CREATE SCHEMA IF NOT EXISTS hgdb_probe';
  EXCEPTION WHEN OTHERS THEN
    NULL;  -- 无权限时后续 DDL 测试会各自报错
  END;

  ------------------------------------------------------------------
  -- 伪表 DUAL
  ------------------------------------------------------------------
  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT 1 FROM dual';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT, st = RETURNED_SQLSTATE;
  END;
  INSERT INTO hgdb_probe_result VALUES ('伪表 DUAL', ok, err);

  ------------------------------------------------------------------
  -- NVL / NVL2 / DECODE
  ------------------------------------------------------------------
  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT nvl(NULL::int, 1)';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('函数 NVL', ok, err);

  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT nvl2(1, ''a'', ''b'')';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('函数 NVL2', ok, err);

  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT decode(1, 1, ''a'', ''b'')';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('函数 DECODE', ok, err);

  ------------------------------------------------------------------
  -- 日期伪列与函数
  ------------------------------------------------------------------
  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT SYSDATE';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('伪列 SYSDATE', ok, err);

  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT SYSTIMESTAMP';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('伪列 SYSTIMESTAMP', ok, err);

  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT SYSDATE + 1';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('日期运算 SYSDATE + n', ok, err);

  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT add_months(CURRENT_DATE, 1)';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('函数 ADD_MONTHS', ok, err);

  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT last_day(CURRENT_DATE)';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('函数 LAST_DAY', ok, err);

  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT months_between(CURRENT_DATE, CURRENT_DATE - 30)';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('函数 MONTHS_BETWEEN', ok, err);

  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT to_date(''24-01-01'', ''RR-MM-DD'')';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('TO_DATE 格式 RR', ok, err);

  ------------------------------------------------------------------
  -- 伪列 ROWNUM / 层次查询 / (+)
  ------------------------------------------------------------------
  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT ROWNUM FROM (VALUES (1), (2)) v';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('伪列 ROWNUM', ok, err);

  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT LEVEL FROM (SELECT 1 AS id) t CONNECT BY LEVEL <= 1';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('层次查询 CONNECT BY / LEVEL', ok, err);

  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT * FROM (VALUES (1)) a(id), (VALUES (1)) b(id) WHERE a.id = b.id(+)';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('外连接 (+)', ok, err);

  ------------------------------------------------------------------
  -- Oracle 类型
  ------------------------------------------------------------------
  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT ''x''::varchar2(10)';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('类型 VARCHAR2', ok, err);

  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT 1::number';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('类型 NUMBER', ok, err);

  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT ''x''::clob';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('类型 CLOB', ok, err);

  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT ''x''::blob';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('类型 BLOB', ok, err);

  ------------------------------------------------------------------
  -- 序列 Oracle 写法
  ------------------------------------------------------------------
  ok := false; err := NULL;
  BEGIN
    EXECUTE 'CREATE SEQUENCE hgdb_probe.s START 1';
    EXECUTE 'SELECT hgdb_probe.s.NEXTVAL';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('序列 seq.NEXTVAL', ok, err);

  ------------------------------------------------------------------
  -- MERGE
  ------------------------------------------------------------------
  ok := false; err := NULL;
  BEGIN
    EXECUTE 'CREATE TEMP TABLE probe_m1 (id int PRIMARY KEY, v text)';
    EXECUTE 'CREATE TEMP TABLE probe_m2 (id int, v text)';
    EXECUTE 'INSERT INTO probe_m2 VALUES (1, ''a'')';
    EXECUTE $sql$MERGE INTO probe_m1 m USING probe_m2 s ON (m.id = s.id)
                  WHEN MATCHED THEN UPDATE SET v = s.v
                  WHEN NOT MATCHED THEN INSERT (id, v) VALUES (s.id, s.v)$sql$;
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('MERGE', ok, err);

  ------------------------------------------------------------------
  -- 函数：INSTR / LISTAGG / KEEP
  ------------------------------------------------------------------
  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT instr(''abc'', ''b'', 1, 1)';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('函数 INSTR', ok, err);

  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT listagg(column1, '','') WITHIN GROUP (ORDER BY column1) FROM (VALUES (''a''), (''b'')) v';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('函数 LISTAGG', ok, err);

  ok := false; err := NULL;
  BEGIN
    EXECUTE 'SELECT max(column1) KEEP (DENSE_RANK FIRST ORDER BY column1) FROM (VALUES (1), (2)) v';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('聚合 KEEP (DENSE_RANK)', ok, err);

  ------------------------------------------------------------------
  -- 包 PACKAGE
  ------------------------------------------------------------------
  ok := false; err := NULL;
  BEGIN
    EXECUTE $sql$CREATE PACKAGE hgdb_probe.p_test AS
                  PROCEDURE hello;
                END;$sql$;
    EXECUTE $sql$CREATE PACKAGE BODY hgdb_probe.p_test AS
                  PROCEDURE hello IS
                  BEGIN
                    NULL;
                  END;
                END;$sql$;
    EXECUTE 'CALL hgdb_probe.p_test.hello()';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('包 PACKAGE', ok, err);

  ------------------------------------------------------------------
  -- 自治事务
  ------------------------------------------------------------------
  ok := false; err := NULL;
  BEGIN
    EXECUTE $sql$CREATE OR REPLACE PROCEDURE hgdb_probe.p_auto()
                LANGUAGE plpgsql AS $body$
                BEGIN
                  PRAGMA AUTONOMOUS_TRANSACTION;
                  COMMIT;
                END;
                $body$
                $sql$;
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('自治事务 PRAGMA AUTONOMOUS_TRANSACTION', ok, err);

  ------------------------------------------------------------------
  -- 系统包 DBMS_OUTPUT / RAISE_APPLICATION_ERROR
  ------------------------------------------------------------------
  ok := false; err := NULL;
  BEGIN
    BEGIN
      EXECUTE 'SELECT dbms_output.put_line(''probe'')';
      ok := true;
    EXCEPTION WHEN undefined_function THEN
      EXECUTE 'CALL dbms_output.put_line(''probe'')';
      ok := true;
    END;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('系统包 DBMS_OUTPUT.PUT_LINE', ok, err);

  ok := false; err := NULL;
  BEGIN
    BEGIN
      EXECUTE 'CALL raise_application_error(-20001, ''probe'')';
      ok := false; err := '调用返回但未抛错';
    EXCEPTION
      WHEN undefined_function THEN
        BEGIN
          EXECUTE 'SELECT raise_application_error(-20001, ''probe'')';
          ok := false; err := '调用返回但未抛错';
        EXCEPTION
          WHEN undefined_function THEN
            ok := false; err := '未定义';
          WHEN OTHERS THEN
            GET STACKED DIAGNOSTICS err = MESSAGE_TEXT, st = RETURNED_SQLSTATE;
            ok := true;
        END;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS err = MESSAGE_TEXT, st = RETURNED_SQLSTATE;
        ok := true;
    END;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('RAISE_APPLICATION_ERROR', ok, err);

  ------------------------------------------------------------------
  -- 同义词
  ------------------------------------------------------------------
  ok := false; err := NULL;
  BEGIN
    EXECUTE 'CREATE SYNONYM hgdb_probe.syn_pg_class FOR pg_catalog.pg_class';
    ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
  END;
  INSERT INTO hgdb_probe_result VALUES ('同义词 SYNONYM', ok, err);
END
$probe$;

SELECT feature, supported, detail
FROM hgdb_probe_result
ORDER BY supported DESC, feature;

SELECT count(*) FILTER (WHERE supported) AS supported_features,
       count(*) FILTER (WHERE NOT supported) AS unsupported_features,
       count(*) AS total
FROM hgdb_probe_result;

-- 清理
DROP SCHEMA IF EXISTS hgdb_probe CASCADE;
DROP TABLE IF EXISTS probe_m1;
DROP TABLE IF EXISTS probe_m2;