-- 02-create-test-objects.sql（JDBC 版：语句/块之间用 / 分隔）
-- 以 test 用户执行，密码 Test#1234。

CREATE TABLE customers (
  customer_id   NUMBER NOT NULL,
  customer_name VARCHAR2(100),
  status        VARCHAR2(10) DEFAULT 'ACTIVE',
  created_at    DATE DEFAULT SYSDATE,
  CONSTRAINT pk_customers PRIMARY KEY (customer_id)
);
/

CREATE TABLE orders (
  order_id    NUMBER NOT NULL,
  customer_id NUMBER NOT NULL,
  amount      NUMBER(14,2) NOT NULL,
  status      VARCHAR2(10) DEFAULT 'NEW',
  created_at  DATE DEFAULT SYSDATE,
  CONSTRAINT pk_orders PRIMARY KEY (order_id),
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
);
/

CREATE TABLE audit_log (
  log_id      NUMBER,
  table_name  VARCHAR2(64),
  action_type VARCHAR2(20),
  pk_value    VARCHAR2(64),
  old_val     VARCHAR2(4000),
  new_val     VARCHAR2(4000),
  changed_at  DATE DEFAULT SYSDATE
);
/

CREATE SEQUENCE seq_order_id START WITH 1000 INCREMENT BY 1 NOCACHE;
/

CREATE OR REPLACE FUNCTION f_customer_level(p_cust_id IN NUMBER)
RETURN VARCHAR2
IS
  v_amt NUMBER(14,2);
BEGIN
  SELECT NVL(SUM(amount), 0)
    INTO v_amt
    FROM orders
   WHERE customer_id = p_cust_id
     AND status = 'PAID'
     AND created_at >= SYSDATE - 365;

  IF v_amt >= 100000 THEN
    RETURN 'A';
  ELSIF v_amt >= 10000 THEN
    RETURN 'B';
  ELSE
    RETURN 'C';
  END IF;
END;
/

CREATE OR REPLACE PROCEDURE p_touch_order(p_order_id IN NUMBER)
IS
  v_status orders.status%TYPE;
BEGIN
  SELECT status INTO v_status FROM orders WHERE order_id = p_order_id;
  UPDATE orders SET status = 'PAID' WHERE order_id = p_order_id;
  INSERT INTO audit_log (log_id, table_name, action_type, pk_value, old_val, new_val)
  VALUES (seq_order_id.NEXTVAL, 'ORDERS', 'UPDATE', TO_CHAR(p_order_id), v_status, 'PAID');
  COMMIT;
END;
/

CREATE OR REPLACE TRIGGER trg_order_audit
AFTER INSERT OR UPDATE ON orders
FOR EACH ROW
BEGIN
  IF INSERTING THEN
    INSERT INTO audit_log (log_id, table_name, action_type, pk_value, old_val, new_val)
    VALUES (seq_order_id.NEXTVAL, 'ORDERS', 'INSERT', TO_CHAR(:NEW.order_id), NULL, TO_CHAR(:NEW.status));
  ELSE
    INSERT INTO audit_log (log_id, table_name, action_type, pk_value, old_val, new_val)
    VALUES (seq_order_id.NEXTVAL, 'ORDERS', 'UPDATE', TO_CHAR(:NEW.order_id), TO_CHAR(:OLD.status), TO_CHAR(:NEW.status));
  END IF;
END;
/

CREATE OR REPLACE VIEW v_customer_level AS
SELECT c.customer_id,
       c.customer_name,
       f_customer_level(c.customer_id) AS customer_level
  FROM customers c;
/

CREATE OR REPLACE VIEW v_order_summary AS
SELECT o.customer_id,
       COUNT(*) AS order_count,
       SUM(o.amount) AS total_amount,
       MAX(o.created_at) AS last_order_at
  FROM orders o
 GROUP BY o.customer_id;
/

CREATE OR REPLACE PACKAGE pkg_order_stats AS
  FUNCTION total_amount(p_cust_id IN NUMBER) RETURN NUMBER;
  PROCEDURE close_customer(p_cust_id IN NUMBER);
END pkg_order_stats;
/

CREATE OR REPLACE PACKAGE BODY pkg_order_stats AS
  FUNCTION total_amount(p_cust_id IN NUMBER) RETURN NUMBER
  IS
    v_total NUMBER(14,2);
  BEGIN
    SELECT NVL(SUM(amount), 0) INTO v_total FROM orders WHERE customer_id = p_cust_id;
    RETURN v_total;
  END;

  PROCEDURE close_customer(p_cust_id IN NUMBER)
  IS
  BEGIN
    UPDATE customers SET status = 'CLOSED' WHERE customer_id = p_cust_id;
  END;
END pkg_order_stats;
/

INSERT INTO customers (customer_id, customer_name) VALUES (1, 'Alice');
INSERT INTO customers (customer_id, customer_name) VALUES (2, 'Bob');
INSERT INTO customers (customer_id, customer_name) VALUES (3, 'Carol');
INSERT INTO orders (order_id, customer_id, amount, status, created_at) VALUES (seq_order_id.NEXTVAL, 1, 120000, 'PAID', SYSDATE - 10);
INSERT INTO orders (order_id, customer_id, amount, status, created_at) VALUES (seq_order_id.NEXTVAL, 1, 30000, 'PAID', SYSDATE - 30);
INSERT INTO orders (order_id, customer_id, amount, status, created_at) VALUES (seq_order_id.NEXTVAL, 2, 5000, 'NEW', SYSDATE - 5);
INSERT INTO orders (order_id, customer_id, amount, status, created_at) VALUES (seq_order_id.NEXTVAL, 3, 15000, 'PAID', SYSDATE - 60);
COMMIT;
/