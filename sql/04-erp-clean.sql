-- 04-erp-clean.sql：清空 test 用户下的测试对象（按依赖顺序）
-- 先删 DBMS_SCHEDULER 作业（不在 user_objects 里），再删普通对象与同义词
BEGIN
  FOR j IN (SELECT job_name FROM user_scheduler_jobs) LOOP
    BEGIN
      DBMS_SCHEDULER.DROP_JOB(j.job_name, TRUE);
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
  END LOOP;
END;
/

BEGIN
  FOR o IN (
    SELECT object_name, object_type FROM user_objects
     WHERE object_type IN ('MATERIALIZED VIEW','VIEW','TABLE','SEQUENCE','TRIGGER','PACKAGE','PACKAGE BODY','PROCEDURE','FUNCTION','TYPE','TYPE BODY','SYNONYM')
       AND object_name NOT LIKE 'SYS_%'
  ) LOOP
    BEGIN
      IF o.object_type = 'TYPE' THEN
        EXECUTE IMMEDIATE 'DROP TYPE "' || o.object_name || '" FORCE';
      ELSIF o.object_type = 'TABLE' THEN
        EXECUTE IMMEDIATE 'DROP TABLE "' || o.object_name || '" CASCADE CONSTRAINTS PURGE';
      ELSIF o.object_type IN ('VIEW','MATERIALIZED VIEW') THEN
        EXECUTE IMMEDIATE 'DROP ' || o.object_type || ' "' || o.object_name || '"';
      ELSIF o.object_type = 'SEQUENCE' THEN
        EXECUTE IMMEDIATE 'DROP SEQUENCE "' || o.object_name || '"';
      ELSIF o.object_type IN ('PACKAGE','PACKAGE BODY','PROCEDURE','FUNCTION') THEN
        EXECUTE IMMEDIATE 'DROP ' || o.object_type || ' "' || o.object_name || '"';
      ELSIF o.object_type = 'TRIGGER' THEN
        EXECUTE IMMEDIATE 'DROP TRIGGER "' || o.object_name || '"';
      ELSIF o.object_type = 'SYNONYM' THEN
        EXECUTE IMMEDIATE 'DROP SYNONYM "' || o.object_name || '"';
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
  END LOOP;
END;
/