# 11 典型对象前后对照

> 以下示例默认目标端**未验证兼容能力**，因此全部使用 PostgreSQL 14 标准写法；探测确认支持后，可在报告标注哪些 Oracle 写法可以保留。

## 1. 函数

Oracle：

```sql
CREATE OR REPLACE FUNCTION f_customer_level(p_cust_id IN NUMBER)
RETURN VARCHAR2
IS
  v_amt NUMBER(14,2);
BEGIN
  SELECT NVL(SUM(amount), 0) INTO v_amt
  FROM t_order WHERE customer_id = p_cust_id AND status = 'C';

  IF v_amt >= 100000 THEN
    RETURN 'A';
  ELSIF v_amt >= 10000 THEN
    RETURN 'B';
  ELSE
    RETURN 'C';
  END IF;
END;
/
```

PG14：

```sql
CREATE OR REPLACE FUNCTION f_customer_level(p_cust_id numeric)
RETURNS varchar
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_amt numeric(14,2);
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO STRICT v_amt
  FROM t_order WHERE customer_id = p_cust_id AND status = 'C';

  IF v_amt >= 100000 THEN
    RETURN 'A';
  ELSIF v_amt >= 10000 THEN
    RETURN 'B';
  ELSE
    RETURN 'C';
  END IF;
END;
$fn$;
```

## 2. 过程（OUT 参数 + 提交）

Oracle：

```sql
CREATE OR REPLACE PROCEDURE p_close_order(
  p_id   IN NUMBER,
  p_rows OUT NUMBER
) IS
BEGIN
  UPDATE t_order SET status = 'C', closed_at = SYSDATE WHERE id = p_id;
  p_rows := SQL%ROWCOUNT;
  COMMIT;
END;
/
```

PG14：

```sql
CREATE OR REPLACE PROCEDURE p_close_order(p_id numeric, INOUT p_rows integer)
LANGUAGE plpgsql AS $proc$
BEGIN
  UPDATE t_order SET status = 'C', closed_at = LOCALTIMESTAMP(0) WHERE id = p_id;
  GET DIAGNOSTICS p_rows = ROW_COUNT;
  COMMIT;  -- 调用方不能在显式事务块中
END;
$proc$;
```

调用：`CALL p_close_order(1, NULL);`

## 3. 包

Oracle：

```sql
CREATE OR REPLACE PACKAGE pkg_order AS
  c_new CONSTANT CHAR(1) := 'N';
  PROCEDURE close_order(p_id IN NUMBER);
  FUNCTION  get_status(p_id IN NUMBER) RETURN CHAR;
END pkg_order;
/
```

PG14：

```sql
CREATE SCHEMA IF NOT EXISTS pkg_order;

CREATE OR REPLACE FUNCTION pkg_order.c_new() RETURNS char
LANGUAGE sql IMMUTABLE AS $fn$ SELECT 'N'::char $fn$;

CREATE OR REPLACE PROCEDURE pkg_order.close_order(p_id numeric)
LANGUAGE plpgsql AS $proc$
BEGIN
  UPDATE t_order SET status = pkg_order.c_new(), closed_at = LOCALTIMESTAMP(0)
  WHERE id = p_id;
END;
$proc$;

CREATE OR REPLACE FUNCTION pkg_order.get_status(p_id numeric) RETURNS char
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v char(1);
BEGIN
  SELECT status INTO STRICT v FROM t_order WHERE id = p_id;
  RETURN v;
END;
$fn$;
```

调用：`CALL pkg_order.close_order(1);`、`SELECT pkg_order.get_status(1);`

（状态与初始化的完整写法见 05。）

## 4. 视图

Oracle：

```sql
CREATE OR REPLACE FORCE VIEW v_order_customer AS
SELECT o.id, o.amount, c.name customer_name, NVL(c.level, 'C') level
FROM t_order o, t_customer c
WHERE o.customer_id = c.id(+);
```

PG14：

```sql
CREATE OR REPLACE VIEW v_order_customer AS
SELECT o.id, o.amount, c.name AS customer_name, COALESCE(c.level, 'C') AS level
FROM t_order o
LEFT JOIN t_customer c ON c.id = o.customer_id;
```

## 5. 物化视图

Oracle：

```sql
CREATE MATERIALIZED VIEW mv_sales_daily
REFRESH COMPLETE ON DEMAND
AS SELECT TRUNC(sale_date) d, SUM(amount) amt FROM t_sale GROUP BY TRUNC(sale_date);
```

PG14：

```sql
CREATE MATERIALIZED VIEW mv_sales_daily AS
SELECT date_trunc('day', sale_date)::date AS d, SUM(amount) AS amt
FROM t_sale
GROUP BY date_trunc('day', sale_date)::date
WITH DATA;

CREATE UNIQUE INDEX ux_mv_sales_daily_d ON mv_sales_daily (d);

-- 定时刷新
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_sales_daily;
```

## 6. 行级触发器

Oracle：

```sql
CREATE OR REPLACE TRIGGER trg_order_biu
BEFORE INSERT OR UPDATE ON t_order
FOR EACH ROW
BEGIN
  IF INSERTING THEN
    :NEW.created_at := SYSDATE;
    :NEW.status := NVL(:NEW.status, 'N');
  END IF;
  :NEW.updated_at := SYSDATE;
END;
/
```

PG14：

```sql
CREATE OR REPLACE FUNCTION trg_order_biu() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := LOCALTIMESTAMP(0);
    NEW.status := COALESCE(NEW.status, 'N');
  END IF;
  NEW.updated_at := LOCALTIMESTAMP(0);
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_order_biu
BEFORE INSERT OR UPDATE ON t_order
FOR EACH ROW EXECUTE FUNCTION trg_order_biu();
```

## 7. 语句级 + 过渡表

Oracle：

```sql
CREATE OR REPLACE TRIGGER trg_order_audit
AFTER UPDATE ON t_order
DECLARE
BEGIN
  INSERT INTO t_order_audit (id, changed_at)
  SELECT id, SYSDATE FROM t_order WHERE ROWID IN (SELECT ROWID FROM t_order);
END;
/
```

PG14：

```sql
CREATE OR REPLACE FUNCTION trg_order_audit() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO t_order_audit (id, changed_at)
  SELECT n.id, LOCALTIMESTAMP(0) FROM new_rows n;
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER trg_order_audit
AFTER UPDATE ON t_order
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION trg_order_audit();
```

## 8. 匿名块

Oracle：

```sql
DECLARE
  v_cnt NUMBER;
BEGIN
  FOR r IN (SELECT id FROM t_order WHERE status = 'N') LOOP
    UPDATE t_order SET status = 'P' WHERE id = r.id;
    v_cnt := v_cnt + 1;
  END LOOP;
  DBMS_OUTPUT.PUT_LINE('processed: ' || v_cnt);
EXCEPTION
  WHEN OTHERS THEN
    DBMS_OUTPUT.PUT_LINE(SQLERRM);
    RAISE;
END;
/
```

PG14：

```sql
DO $blk$
DECLARE
  v_cnt integer := 0;
BEGIN
  FOR r IN SELECT id FROM t_order WHERE status = 'N' LOOP
    UPDATE t_order SET status = 'P' WHERE id = r.id;
    v_cnt := v_cnt + 1;
  END LOOP;
  RAISE NOTICE 'processed: %', v_cnt;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '%', SQLERRM;
  RAISE;
END;
$blk$;
```

## 9. 层次查询

Oracle：

```sql
SELECT LEVEL lvl, employee_id, manager_id, last_name,
       SYS_CONNECT_BY_PATH(last_name, '/') path
FROM employees
START WITH manager_id IS NULL
CONNECT BY PRIOR employee_id = manager_id
ORDER SIBLINGS BY last_name;
```

PG14：

```sql
WITH RECURSIVE emp_tree AS (
  SELECT employee_id, manager_id, last_name, 1 AS lvl,
         '/' || last_name AS path, last_name AS sort_path
  FROM employees WHERE manager_id IS NULL
  UNION ALL
  SELECT e.employee_id, e.manager_id, e.last_name, t.lvl + 1,
         t.path || '/' || e.last_name, t.sort_path || '/' || e.last_name
  FROM employees e JOIN emp_tree t ON e.manager_id = t.employee_id
)
SELECT lvl, employee_id, manager_id, last_name, path
FROM emp_tree ORDER BY sort_path;
```

## 10. Top-N 与分页

Oracle：

```sql
-- 工资最高的 10 人
SELECT * FROM (SELECT * FROM emp ORDER BY sal DESC) WHERE ROWNUM <= 10;

-- 第 11-20 行
SELECT * FROM (
  SELECT a.*, ROWNUM rn FROM (SELECT * FROM emp ORDER BY emp_id) a
  WHERE ROWNUM <= 20
) WHERE rn > 10;
```

PG14：

```sql
SELECT * FROM emp ORDER BY sal DESC LIMIT 10;
SELECT * FROM emp ORDER BY emp_id LIMIT 10 OFFSET 10;
```

## 11. MERGE → upsert

Oracle：

```sql
MERGE INTO t_stock t
USING (SELECT sku, qty FROM t_incoming WHERE batch_no = 1) s
ON (t.sku = s.sku)
WHEN MATCHED THEN UPDATE SET t.qty = t.qty + s.qty, t.updated_at = SYSDATE
WHEN NOT MATCHED THEN INSERT (sku, qty) VALUES (s.sku, s.qty);
```

PG14：

```sql
INSERT INTO t_stock (sku, qty, updated_at)
SELECT s.sku, s.qty, LOCALTIMESTAMP(0)
FROM (SELECT sku, SUM(qty) AS qty FROM t_incoming WHERE batch_no = 1 GROUP BY sku) s
ON CONFLICT (sku) DO UPDATE
SET qty = t_stock.qty + EXCLUDED.qty,
    updated_at = EXCLUDED.updated_at;
```

（`t_stock.sku` 必须有主键/唯一索引；源数据先按 key 聚合，避免同 key 多行。）

## 12. PIVOT

Oracle：

```sql
SELECT * FROM (SELECT dept, job, sal FROM emp)
PIVOT (SUM(sal) FOR job IN ('CLERK' AS clerk, 'SALES' AS sales));
```

PG14：

```sql
SELECT dept,
       sum(sal) FILTER (WHERE job = 'CLERK') AS clerk,
       sum(sal) FILTER (WHERE job = 'SALES') AS sales
FROM emp
GROUP BY dept;
```

## 13. 序列 + 主键

Oracle：

```sql
CREATE SEQUENCE seq_order_id START WITH 1 INCREMENT BY 1 NOCACHE;
CREATE OR REPLACE TRIGGER trg_order_id
BEFORE INSERT ON t_order FOR EACH ROW
BEGIN
  IF :NEW.id IS NULL THEN
    SELECT seq_order_id.NEXTVAL INTO :NEW.id FROM dual;
  END IF;
END;
/
```

PG14（优先用 identity）：

```sql
ALTER TABLE t_order
  ALTER COLUMN id SET DEFAULT nextval('seq_order_id');
```

或建表时：

```sql
id numeric GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY
```

（存量数据迁移后，记得把序列 `RESTART WITH` 设为 `max(id)+1`。）

## 14. 数据校验

```sql
-- 行数对比
SELECT 'src' src, count(*) FROM src_t UNION ALL SELECT 'tgt', count(*) FROM tgt_t;

-- 聚合对比
SELECT sum(amount), min(created_at), max(created_at), count(DISTINCT customer_id)
FROM t_order;

-- 抽样差异（按主键）
SELECT * FROM (
  SELECT id, amount, status FROM src_t
  EXCEPT
  SELECT id, amount, status FROM tgt_t
) d LIMIT 100;
```