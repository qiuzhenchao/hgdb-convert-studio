-- 07-job-synonym.sql：同义词 + DBMS_SCHEDULER 定时任务（JOB）测试对象
-- 以 test 用户执行；需要 CREATE SYNONYM / CREATE JOB 权限（见 01-create-test-user.sql）

CREATE TABLE t_syn_probe (
  id   NUMBER PRIMARY KEY,
  note VARCHAR2(200)
);
/

INSERT INTO t_syn_probe VALUES (1, 'synonym probe');
/
COMMIT;
/

-- 私有同义词：读取时会以 SYNONYM 对象出现在对象清单里
CREATE OR REPLACE SYNONYM syn_syn_probe FOR t_syn_probe;
/

-- 可重复执行：先删后建；默认不启用，便于只做转换与目标端语法验证
BEGIN
  BEGIN
    DBMS_SCHEDULER.DROP_JOB('JOB_SYN_PROBE', TRUE);
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END;
  DBMS_SCHEDULER.CREATE_JOB(
    job_name        => 'JOB_SYN_PROBE',
    job_type        => 'PLSQL_BLOCK',
    job_action      => 'BEGIN INSERT INTO t_syn_probe VALUES (2, ''job tick''); COMMIT; END;',
    start_date      => SYSTIMESTAMP,
    repeat_interval => 'FREQ=DAILY;BYHOUR=2;BYMINUTE=0',
    enabled         => FALSE,
    comments        => 'HGDB Convert Studio JOB test object');
END;
/