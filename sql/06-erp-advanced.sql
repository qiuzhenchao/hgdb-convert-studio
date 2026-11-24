-- 06-erp-advanced.sql：在现有 ERP 测试对象上补充高级 Oracle 语法
-- 包含：游标、%ROWTYPE、集合、BULK COLLECT/FORALL、MERGE、自治事务、
--       动态 SQL、SYS_REFCURSOR、分析函数、LISTAGG、管道函数、对象类型方法、触发器逻辑
-- 以 test 用户执行

CREATE TABLE erp_sync_log (
  sync_id     NUMBER NOT NULL,
  run_at      DATE DEFAULT SYSDATE,
  order_count NUMBER DEFAULT 0,
  note        VARCHAR2(4000),
  CONSTRAINT pk_erp_sync_log PRIMARY KEY (sync_id)
);
/

CREATE TABLE erp_order_audit (
  audit_id   NUMBER NOT NULL,
  order_id   NUMBER NOT NULL,
  old_status VARCHAR2(10),
  new_status VARCHAR2(10),
  changed_at DATE DEFAULT SYSDATE,
  changed_by VARCHAR2(30),
  CONSTRAINT pk_erp_order_audit PRIMARY KEY (audit_id)
);
/

CREATE OR REPLACE TYPE t_erp_money AS OBJECT (
  amount   NUMBER,
  currency VARCHAR2(3),
  MEMBER FUNCTION to_text RETURN VARCHAR2
);
/

CREATE OR REPLACE TYPE BODY t_erp_money AS
  MEMBER FUNCTION to_text RETURN VARCHAR2 IS
  BEGIN
    RETURN TO_CHAR(amount, 'FM999G999G999D00') || ' ' || currency;
  END;
END;
/

CREATE OR REPLACE TYPE t_erp_product_row AS OBJECT (
  product_id NUMBER,
  sku        VARCHAR2(32),
  qty        NUMBER
);
/

CREATE OR REPLACE TYPE t_erp_product_tab AS TABLE OF t_erp_product_row;
/

CREATE OR REPLACE PROCEDURE sp_erp_write_log(p_sync_id IN NUMBER, p_note IN VARCHAR2)
IS
  PRAGMA AUTONOMOUS_TRANSACTION;
BEGIN
  MERGE INTO erp_sync_log t
  USING (SELECT p_sync_id AS sync_id, p_note AS note FROM dual) s
  ON (t.sync_id = s.sync_id)
  WHEN MATCHED THEN
    UPDATE SET t.run_at = SYSDATE, t.note = s.note
  WHEN NOT MATCHED THEN
    INSERT (sync_id, run_at, note) VALUES (s.sync_id, SYSDATE, s.note);
  COMMIT;
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    RAISE_APPLICATION_ERROR(-20020, 'log failed: ' || SQLERRM);
END;
/

CREATE OR REPLACE FUNCTION fn_erp_so_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count  NUMBER := 0;
  v_rc     SYS_REFCURSOR;
  v_row    erp_sales_orders%ROWTYPE;
  v_status VARCHAR2(10);
  TYPE t_status_tab IS TABLE OF VARCHAR2(10);
  v_statuses t_status_tab := t_status_tab('NEW', 'CONFIRMED', 'SHIPPED', 'CLOSED', 'CANCELLED');
BEGIN
  FOR i IN 1 .. v_statuses.COUNT LOOP
    v_status := v_statuses(i);
    OPEN v_rc FOR
      SELECT * FROM erp_sales_orders
       WHERE status = v_status
         AND (p_filter IS NULL OR customer_id = p_filter);
    LOOP
      FETCH v_rc INTO v_row;
      EXIT WHEN v_rc%NOTFOUND;
      v_count := v_count + 1;
    END LOOP;
    CLOSE v_rc;
  END LOOP;
  RETURN v_count;
EXCEPTION
  WHEN OTHERS THEN
    RAISE_APPLICATION_ERROR(-20021, 'count failed: ' || SQLERRM);
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_so_sync(p_limit IN NUMBER DEFAULT 100)
IS
  PRAGMA AUTONOMOUS_TRANSACTION;
  TYPE t_line_tab IS TABLE OF erp_sales_order_lines%ROWTYPE;
  TYPE t_total_tab IS TABLE OF NUMBER INDEX BY PLS_INTEGER;
  v_lines  t_line_tab;
  v_ids    t_total_tab;
  v_totals t_total_tab;
  v_count  NUMBER := 0;
  CURSOR c_orders IS
    SELECT order_id FROM erp_sales_orders
     WHERE status IN ('NEW', 'CONFIRMED', 'SHIPPED')
     ORDER BY order_id;
BEGIN
  FOR r IN c_orders LOOP
    EXIT WHEN v_count >= p_limit;
    SELECT * BULK COLLECT INTO v_lines
      FROM erp_sales_order_lines
     WHERE order_id = r.order_id;
    v_ids(v_ids.COUNT + 1) := r.order_id;
    v_totals(v_ids.COUNT) := 0;
    FOR i IN 1 .. v_lines.COUNT LOOP
      v_totals(v_ids.COUNT) := v_totals(v_ids.COUNT) + NVL(v_lines(i).line_amount, 0);
    END LOOP;
    v_count := v_count + 1;
  END LOOP;

  FORALL j IN 1 .. v_ids.COUNT
    UPDATE erp_sales_orders
       SET total_amount = v_totals(j)
     WHERE order_id = v_ids(j);

  MERGE INTO erp_sync_log t
  USING (SELECT 1 AS sync_id FROM dual) s
  ON (t.sync_id = s.sync_id)
  WHEN MATCHED THEN
    UPDATE SET t.run_at = SYSDATE, t.order_count = v_count, t.note = 'sync ok'
  WHEN NOT MATCHED THEN
    INSERT (sync_id, run_at, order_count, note)
    VALUES (s.sync_id, SYSDATE, v_count, 'sync ok');

  COMMIT;
EXCEPTION
  WHEN OTHERS THEN
    ROLLBACK;
    RAISE_APPLICATION_ERROR(-20022, 'sync failed: ' || SQLERRM);
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_rebuild_stats(p_table IN VARCHAR2, p_result OUT VARCHAR2)
IS
  v_sql   VARCHAR2(4000);
  v_count NUMBER;
BEGIN
  v_sql := 'SELECT COUNT(*) FROM ' || DBMS_ASSERT.SIMPLE_SQL_NAME(p_table);
  EXECUTE IMMEDIATE v_sql INTO v_count;
  p_result := p_table || ' rows=' || v_count;
EXCEPTION
  WHEN OTHERS THEN
    p_result := 'failed: ' || SQLERRM;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_top_products(p_limit IN NUMBER DEFAULT 5)
RETURN t_erp_product_tab
PIPELINED
IS
  CURSOR c_products IS
    SELECT l.product_id, p.sku, SUM(l.quantity) AS qty
      FROM erp_sales_order_lines l
      JOIN erp_products p ON p.product_id = l.product_id
     GROUP BY l.product_id, p.sku
     ORDER BY SUM(l.quantity) DESC;
  v_row c_products%ROWTYPE;
BEGIN
  OPEN c_products;
  LOOP
    FETCH c_products INTO v_row;
    EXIT WHEN c_products%NOTFOUND OR c_products%ROWCOUNT > p_limit;
    PIPE ROW (t_erp_product_row(v_row.product_id, v_row.sku, v_row.qty));
  END LOOP;
  CLOSE c_products;
  RETURN;
END;
/

CREATE OR REPLACE PACKAGE pkg_erp_so AS
  FUNCTION order_total(p_order_id IN NUMBER) RETURN NUMBER;
  FUNCTION customer_credit(p_customer_id IN NUMBER) RETURN NUMBER;
  FUNCTION top_customers(p_limit IN NUMBER DEFAULT 5) RETURN SYS_REFCURSOR;
  PROCEDURE close_order(p_order_id IN NUMBER);
  PROCEDURE add_line(p_order_id IN NUMBER, p_product_id IN NUMBER, p_qty IN NUMBER, p_price IN NUMBER);
  PROCEDURE sync_totals(p_limit IN NUMBER DEFAULT 100);
END pkg_erp_so;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_so AS
  g_sync_count PLS_INTEGER := 0;

  FUNCTION order_total(p_order_id IN NUMBER) RETURN NUMBER
  IS
    v_total NUMBER(14,2);
  BEGIN
    SELECT NVL(SUM(line_amount), 0)
      INTO v_total
      FROM erp_sales_order_lines
     WHERE order_id = p_order_id;
    RETURN v_total;
  END;

  FUNCTION customer_credit(p_customer_id IN NUMBER) RETURN NUMBER
  IS
    v_credit NUMBER(14,2);
    v_used   NUMBER(14,2);
  BEGIN
    SELECT NVL(credit_limit, 0) INTO v_credit
      FROM erp_customers WHERE customer_id = p_customer_id;
    SELECT NVL(SUM(i.amount), 0) INTO v_used
      FROM erp_invoices i
      JOIN erp_sales_orders o ON o.order_id = i.order_id
     WHERE o.customer_id = p_customer_id
       AND i.status IN ('OPEN', 'PARTIAL');
    RETURN v_credit - v_used;
  END;

  FUNCTION top_customers(p_limit IN NUMBER DEFAULT 5) RETURN SYS_REFCURSOR
  IS
    v_rc SYS_REFCURSOR;
  BEGIN
    OPEN v_rc FOR
      SELECT * FROM (
        SELECT c.customer_id,
               c.customer_name,
               COUNT(o.order_id) AS order_count,
               NVL(SUM(o.total_amount), 0) AS total_amount,
               RANK() OVER (ORDER BY NVL(SUM(o.total_amount), 0) DESC) AS rnk
          FROM erp_customers c
          LEFT JOIN erp_sales_orders o ON o.customer_id = c.customer_id
         GROUP BY c.customer_id, c.customer_name
      )
      WHERE rnk <= p_limit
      ORDER BY rnk;
    RETURN v_rc;
  END;

  PROCEDURE close_order(p_order_id IN NUMBER)
  IS
    v_status VARCHAR2(10);
  BEGIN
    SELECT status INTO v_status FROM erp_sales_orders WHERE order_id = p_order_id;
    IF v_status NOT IN ('SHIPPED', 'CONFIRMED') THEN
      RAISE_APPLICATION_ERROR(-20023, 'order status not closable: ' || v_status);
    END IF;
    UPDATE erp_sales_orders SET status = 'CLOSED' WHERE order_id = p_order_id;
    sp_erp_write_log(p_order_id, 'order closed');
    COMMIT;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE_APPLICATION_ERROR(-20024, 'order not found: ' || p_order_id);
  END;

  PROCEDURE add_line(p_order_id IN NUMBER, p_product_id IN NUMBER, p_qty IN NUMBER, p_price IN NUMBER)
  IS
    v_line_id NUMBER;
  BEGIN
    SELECT NVL(MAX(line_id), 0) + 1 INTO v_line_id FROM erp_sales_order_lines;
    INSERT INTO erp_sales_order_lines (line_id, order_id, product_id, quantity, unit_price)
    VALUES (v_line_id, p_order_id, p_product_id, p_qty, p_price);
    UPDATE erp_sales_orders
       SET total_amount = order_total(p_order_id)
     WHERE order_id = p_order_id;
    g_sync_count := g_sync_count + 1;
  EXCEPTION
    WHEN DUP_VAL_ON_INDEX THEN
      RAISE_APPLICATION_ERROR(-20025, 'duplicate line for order ' || p_order_id);
  END;

  PROCEDURE sync_totals(p_limit IN NUMBER DEFAULT 100)
  IS
    v_order_id NUMBER;
    CURSOR c_orders IS
      SELECT order_id FROM erp_sales_orders
       WHERE status IN ('NEW', 'CONFIRMED', 'SHIPPED')
       ORDER BY order_id;
  BEGIN
    FOR r IN c_orders LOOP
      EXIT WHEN g_sync_count >= p_limit;
      v_order_id := r.order_id;
      UPDATE erp_sales_orders
         SET total_amount = order_total(v_order_id)
       WHERE order_id = v_order_id;
      g_sync_count := g_sync_count + 1;
    END LOOP;
    COMMIT;
  END;
BEGIN
  g_sync_count := 0;
END pkg_erp_so;
/

CREATE OR REPLACE TRIGGER trg_erp_so_audit
BEFORE INSERT OR UPDATE ON erp_sales_orders
FOR EACH ROW
DECLARE
  v_audit_id NUMBER;
BEGIN
  IF INSERTING THEN
    :NEW.order_date := NVL(:NEW.order_date, SYSDATE);
    :NEW.status := NVL(:NEW.status, 'NEW');
  END IF;

  IF UPDATING AND :NEW.status <> :OLD.status THEN
    SELECT NVL(MAX(audit_id), 0) + 1 INTO v_audit_id FROM erp_order_audit;
    INSERT INTO erp_order_audit (audit_id, order_id, old_status, new_status, changed_by)
    VALUES (v_audit_id, :NEW.order_id, :OLD.status, :NEW.status, USER);
  END IF;
END;
/

CREATE OR REPLACE VIEW v_erp_so_overview AS
SELECT order_id,
       customer_id,
       customer_name,
       order_date,
       status,
       total_amount,
       RANK() OVER (PARTITION BY customer_id ORDER BY total_amount DESC) AS amount_rank,
       SUM(total_amount) OVER (PARTITION BY customer_id) AS customer_total,
       LAG(total_amount, 1) OVER (PARTITION BY customer_id ORDER BY order_date) AS prev_amount,
       product_list
  FROM (
    SELECT o.order_id,
           o.customer_id,
           c.customer_name,
           o.order_date,
           o.status,
           o.total_amount,
           LISTAGG(l.product_id, ',') WITHIN GROUP (ORDER BY l.line_id) AS product_list
      FROM erp_sales_orders o
      JOIN erp_customers c ON c.customer_id = o.customer_id
      LEFT JOIN erp_sales_order_lines l ON l.order_id = o.order_id
     GROUP BY o.order_id, o.customer_id, c.customer_name, o.order_date, o.status, o.total_amount
  );
/

COMMIT;