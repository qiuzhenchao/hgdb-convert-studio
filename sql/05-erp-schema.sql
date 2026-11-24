CREATE TABLE erp_departments (
  department_id NUMBER NOT NULL,
  department_name VARCHAR2(80) NOT NULL,
  parent_id NUMBER,
  cost_center VARCHAR2(20),
  created_at DATE DEFAULT SYSDATE,
  CONSTRAINT pk_erp_departments PRIMARY KEY (department_id),
  CONSTRAINT fk_erp_dept_parent FOREIGN KEY (parent_id) REFERENCES erp_departments (department_id)
)
/

CREATE TABLE erp_employees (
  employee_id NUMBER NOT NULL,
  employee_name VARCHAR2(80) NOT NULL,
  department_id NUMBER,
  hire_date DATE,
  salary NUMBER(12,2),
  status VARCHAR2(10) DEFAULT 'ACTIVE',
  CONSTRAINT pk_erp_employees PRIMARY KEY (employee_id),
  CONSTRAINT fk_erp_emp_dept FOREIGN KEY (department_id) REFERENCES erp_departments (department_id)
)
/

CREATE TABLE erp_customers (
  customer_id NUMBER NOT NULL,
  customer_name VARCHAR2(120) NOT NULL,
  credit_limit NUMBER(14,2) DEFAULT 0,
  status VARCHAR2(10) DEFAULT 'ACTIVE',
  created_at DATE DEFAULT SYSDATE,
  CONSTRAINT pk_erp_customers PRIMARY KEY (customer_id)
)
/

CREATE TABLE erp_customer_contacts (
  contact_id NUMBER NOT NULL,
  customer_id NUMBER NOT NULL,
  contact_name VARCHAR2(80),
  email VARCHAR2(120),
  CONSTRAINT pk_erp_cust_contacts PRIMARY KEY (contact_id),
  CONSTRAINT fk_erp_cc_cust FOREIGN KEY (customer_id) REFERENCES erp_customers (customer_id)
)
/

CREATE TABLE erp_suppliers (
  supplier_id NUMBER NOT NULL,
  supplier_name VARCHAR2(120) NOT NULL,
  lead_time_days NUMBER DEFAULT 7,
  status VARCHAR2(10) DEFAULT 'ACTIVE',
  CONSTRAINT pk_erp_suppliers PRIMARY KEY (supplier_id)
)
/

CREATE TABLE erp_supplier_contacts (
  contact_id NUMBER NOT NULL,
  supplier_id NUMBER NOT NULL,
  contact_name VARCHAR2(80),
  phone VARCHAR2(40),
  CONSTRAINT pk_erp_sup_contacts PRIMARY KEY (contact_id),
  CONSTRAINT fk_erp_sc_sup FOREIGN KEY (supplier_id) REFERENCES erp_suppliers (supplier_id)
)
/

CREATE TABLE erp_product_categories (
  category_id NUMBER NOT NULL,
  category_name VARCHAR2(80) NOT NULL,
  parent_id NUMBER,
  CONSTRAINT pk_erp_categories PRIMARY KEY (category_id),
  CONSTRAINT fk_erp_cat_parent FOREIGN KEY (parent_id) REFERENCES erp_product_categories (category_id)
)
/

CREATE TABLE erp_products (
  product_id NUMBER NOT NULL,
  sku VARCHAR2(32) NOT NULL,
  product_name VARCHAR2(120) NOT NULL,
  category_id NUMBER,
  unit_price NUMBER(14,2) NOT NULL,
  unit_cost NUMBER(14,2),
  status VARCHAR2(10) DEFAULT 'ACTIVE',
  CONSTRAINT pk_erp_products PRIMARY KEY (product_id),
  CONSTRAINT uk_erp_products_sku UNIQUE (sku),
  CONSTRAINT fk_erp_prod_cat FOREIGN KEY (category_id) REFERENCES erp_product_categories (category_id)
)
/

CREATE TABLE erp_price_lists (
  price_list_id NUMBER NOT NULL,
  price_list_name VARCHAR2(80) NOT NULL,
  currency VARCHAR2(3) DEFAULT 'CNY',
  status VARCHAR2(10) DEFAULT 'ACTIVE',
  CONSTRAINT pk_erp_price_lists PRIMARY KEY (price_list_id)
)
/

CREATE TABLE erp_price_list_items (
  item_id NUMBER NOT NULL,
  price_list_id NUMBER NOT NULL,
  product_id NUMBER NOT NULL,
  price NUMBER(14,2) NOT NULL,
  CONSTRAINT pk_erp_pli PRIMARY KEY (item_id),
  CONSTRAINT fk_erp_pli_list FOREIGN KEY (price_list_id) REFERENCES erp_price_lists (price_list_id),
  CONSTRAINT fk_erp_pli_prod FOREIGN KEY (product_id) REFERENCES erp_products (product_id)
)
/

CREATE TABLE erp_warehouses (
  warehouse_id NUMBER NOT NULL,
  warehouse_name VARCHAR2(80) NOT NULL,
  city VARCHAR2(60),
  CONSTRAINT pk_erp_warehouses PRIMARY KEY (warehouse_id)
)
/

CREATE TABLE erp_inventory (
  warehouse_id NUMBER NOT NULL,
  product_id NUMBER NOT NULL,
  qty_on_hand NUMBER(14,2) DEFAULT 0,
  reorder_level NUMBER(14,2) DEFAULT 0,
  updated_at DATE DEFAULT SYSDATE,
  CONSTRAINT pk_erp_inventory PRIMARY KEY (warehouse_id, product_id),
  CONSTRAINT fk_erp_inv_wh FOREIGN KEY (warehouse_id) REFERENCES erp_warehouses (warehouse_id),
  CONSTRAINT fk_erp_inv_prod FOREIGN KEY (product_id) REFERENCES erp_products (product_id)
)
/

CREATE TABLE erp_stock_moves (
  move_id NUMBER NOT NULL,
  product_id NUMBER NOT NULL,
  warehouse_id NUMBER NOT NULL,
  move_type VARCHAR2(10) NOT NULL,
  qty NUMBER(14,2) NOT NULL,
  moved_at DATE DEFAULT SYSDATE,
  CONSTRAINT pk_erp_stock_moves PRIMARY KEY (move_id),
  CONSTRAINT fk_erp_sm_prod FOREIGN KEY (product_id) REFERENCES erp_products (product_id),
  CONSTRAINT fk_erp_sm_wh FOREIGN KEY (warehouse_id) REFERENCES erp_warehouses (warehouse_id)
)
/

CREATE TABLE erp_sales_orders (
  order_id NUMBER NOT NULL,
  customer_id NUMBER NOT NULL,
  order_date DATE DEFAULT SYSDATE,
  status VARCHAR2(10) DEFAULT 'NEW',
  total_amount NUMBER(14,2) DEFAULT 0,
  CONSTRAINT pk_erp_so PRIMARY KEY (order_id),
  CONSTRAINT fk_erp_so_cust FOREIGN KEY (customer_id) REFERENCES erp_customers (customer_id)
)
/

CREATE TABLE erp_sales_order_lines (
  line_id NUMBER NOT NULL,
  order_id NUMBER NOT NULL,
  product_id NUMBER NOT NULL,
  quantity NUMBER(14,2) NOT NULL,
  unit_price NUMBER(14,2) NOT NULL,
  line_amount NUMBER(14,2),
  CONSTRAINT pk_erp_sol PRIMARY KEY (line_id),
  CONSTRAINT fk_erp_sol_order FOREIGN KEY (order_id) REFERENCES erp_sales_orders (order_id),
  CONSTRAINT fk_erp_sol_prod FOREIGN KEY (product_id) REFERENCES erp_products (product_id)
)
/

CREATE TABLE erp_sales_returns (
  return_id NUMBER NOT NULL,
  order_id NUMBER NOT NULL,
  return_date DATE DEFAULT SYSDATE,
  status VARCHAR2(10) DEFAULT 'DRAFT',
  CONSTRAINT pk_erp_sales_returns PRIMARY KEY (return_id),
  CONSTRAINT fk_erp_sr_order FOREIGN KEY (order_id) REFERENCES erp_sales_orders (order_id)
)
/

CREATE TABLE erp_sales_return_lines (
  line_id NUMBER NOT NULL,
  return_id NUMBER NOT NULL,
  product_id NUMBER NOT NULL,
  quantity NUMBER(14,2) NOT NULL,
  unit_price NUMBER(14,2) NOT NULL,
  CONSTRAINT pk_erp_srl PRIMARY KEY (line_id),
  CONSTRAINT fk_erp_srl_ret FOREIGN KEY (return_id) REFERENCES erp_sales_returns (return_id),
  CONSTRAINT fk_erp_srl_prod FOREIGN KEY (product_id) REFERENCES erp_products (product_id)
)
/

CREATE TABLE erp_purchase_orders (
  po_id NUMBER NOT NULL,
  supplier_id NUMBER NOT NULL,
  order_date DATE DEFAULT SYSDATE,
  status VARCHAR2(10) DEFAULT 'NEW',
  CONSTRAINT pk_erp_po PRIMARY KEY (po_id),
  CONSTRAINT fk_erp_po_sup FOREIGN KEY (supplier_id) REFERENCES erp_suppliers (supplier_id)
)
/

CREATE TABLE erp_purchase_order_lines (
  po_line_id NUMBER NOT NULL,
  po_id NUMBER NOT NULL,
  product_id NUMBER NOT NULL,
  quantity NUMBER(14,2) NOT NULL,
  unit_cost NUMBER(14,2) NOT NULL,
  CONSTRAINT pk_erp_pol PRIMARY KEY (po_line_id),
  CONSTRAINT fk_erp_pol_po FOREIGN KEY (po_id) REFERENCES erp_purchase_orders (po_id),
  CONSTRAINT fk_erp_pol_prod FOREIGN KEY (product_id) REFERENCES erp_products (product_id)
)
/

CREATE TABLE erp_shipments (
  shipment_id NUMBER NOT NULL,
  order_id NUMBER NOT NULL,
  shipped_at DATE DEFAULT SYSDATE,
  carrier VARCHAR2(60),
  status VARCHAR2(10) DEFAULT 'SHIPPED',
  CONSTRAINT pk_erp_shipments PRIMARY KEY (shipment_id),
  CONSTRAINT fk_erp_ship_order FOREIGN KEY (order_id) REFERENCES erp_sales_orders (order_id)
)
/

CREATE TABLE erp_invoices (
  invoice_id NUMBER NOT NULL,
  order_id NUMBER NOT NULL,
  invoice_date DATE DEFAULT SYSDATE,
  due_date DATE,
  amount NUMBER(14,2) NOT NULL,
  status VARCHAR2(10) DEFAULT 'OPEN',
  CONSTRAINT pk_erp_invoices PRIMARY KEY (invoice_id),
  CONSTRAINT fk_erp_inv_order FOREIGN KEY (order_id) REFERENCES erp_sales_orders (order_id)
)
/

CREATE TABLE erp_payments (
  payment_id NUMBER NOT NULL,
  invoice_id NUMBER NOT NULL,
  paid_at DATE DEFAULT SYSDATE,
  amount NUMBER(14,2) NOT NULL,
  method VARCHAR2(20) DEFAULT 'BANK',
  CONSTRAINT pk_erp_payments PRIMARY KEY (payment_id),
  CONSTRAINT fk_erp_pay_inv FOREIGN KEY (invoice_id) REFERENCES erp_invoices (invoice_id)
)
/

CREATE TABLE erp_gl_accounts (
  account_id NUMBER NOT NULL,
  account_code VARCHAR2(20) NOT NULL,
  account_name VARCHAR2(120) NOT NULL,
  account_type VARCHAR2(20) NOT NULL,
  CONSTRAINT pk_erp_gl PRIMARY KEY (account_id),
  CONSTRAINT uk_erp_gl_code UNIQUE (account_code)
)
/

CREATE TABLE erp_journal_entries (
  entry_id NUMBER NOT NULL,
  entry_date DATE DEFAULT SYSDATE,
  description VARCHAR2(200),
  status VARCHAR2(10) DEFAULT 'DRAFT',
  CONSTRAINT pk_erp_je PRIMARY KEY (entry_id)
)
/

CREATE TABLE erp_journal_lines (
  line_id NUMBER NOT NULL,
  entry_id NUMBER NOT NULL,
  account_id NUMBER NOT NULL,
  debit NUMBER(14,2) DEFAULT 0,
  credit NUMBER(14,2) DEFAULT 0,
  CONSTRAINT pk_erp_jl PRIMARY KEY (line_id),
  CONSTRAINT fk_erp_jl_entry FOREIGN KEY (entry_id) REFERENCES erp_journal_entries (entry_id),
  CONSTRAINT fk_erp_jl_account FOREIGN KEY (account_id) REFERENCES erp_gl_accounts (account_id)
)
/

CREATE TABLE erp_product_audit (
  audit_id NUMBER NOT NULL,
  product_id NUMBER NOT NULL,
  old_price NUMBER(14,2),
  new_price NUMBER(14,2),
  changed_at DATE DEFAULT SYSDATE,
  CONSTRAINT pk_erp_pa PRIMARY KEY (audit_id)
)
/

CREATE SEQUENCE seq_erp_dept START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_emp START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_cust START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_cct START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_sup START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_sct START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_pcat START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_prod START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_pl START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_pli START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_wh START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_inv START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_sm START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_so START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_sol START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_sret START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_srl START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_po START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_pol START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_ship START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_invoice START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_pay START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_gl START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_je START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE SEQUENCE seq_erp_jl START WITH 1 INCREMENT BY 1 NOCACHE
/

CREATE OR REPLACE VIEW v_erp_dept_overview AS
SELECT COUNT(*) AS row_count FROM erp_departments
/

CREATE OR REPLACE VIEW v_erp_emp_overview AS
SELECT COUNT(*) AS row_count FROM erp_employees
/

CREATE OR REPLACE VIEW v_erp_cust_overview AS
SELECT COUNT(*) AS row_count FROM erp_customers
/

CREATE OR REPLACE VIEW v_erp_cct_overview AS
SELECT COUNT(*) AS row_count FROM erp_customer_contacts
/

CREATE OR REPLACE VIEW v_erp_sup_overview AS
SELECT COUNT(*) AS row_count FROM erp_suppliers
/

CREATE OR REPLACE VIEW v_erp_sct_overview AS
SELECT COUNT(*) AS row_count FROM erp_supplier_contacts
/

CREATE OR REPLACE VIEW v_erp_pcat_overview AS
SELECT COUNT(*) AS row_count FROM erp_product_categories
/

CREATE OR REPLACE VIEW v_erp_prod_overview AS
SELECT COUNT(*) AS row_count FROM erp_products
/

CREATE OR REPLACE VIEW v_erp_pl_overview AS
SELECT COUNT(*) AS row_count FROM erp_price_lists
/

CREATE OR REPLACE VIEW v_erp_pli_overview AS
SELECT COUNT(*) AS row_count FROM erp_price_list_items
/

CREATE OR REPLACE VIEW v_erp_wh_overview AS
SELECT COUNT(*) AS row_count FROM erp_warehouses
/

CREATE OR REPLACE VIEW v_erp_inv_overview AS
SELECT COUNT(*) AS row_count FROM erp_inventory
/

CREATE OR REPLACE VIEW v_erp_sm_overview AS
SELECT COUNT(*) AS row_count FROM erp_stock_moves
/

CREATE OR REPLACE VIEW v_erp_so_overview AS
SELECT COUNT(*) AS row_count FROM erp_sales_orders
/

CREATE OR REPLACE VIEW v_erp_sol_overview AS
SELECT COUNT(*) AS row_count FROM erp_sales_order_lines
/

CREATE OR REPLACE VIEW v_erp_sret_overview AS
SELECT COUNT(*) AS row_count FROM erp_sales_returns
/

CREATE OR REPLACE VIEW v_erp_srl_overview AS
SELECT COUNT(*) AS row_count FROM erp_sales_return_lines
/

CREATE OR REPLACE VIEW v_erp_po_overview AS
SELECT COUNT(*) AS row_count FROM erp_purchase_orders
/

CREATE OR REPLACE VIEW v_erp_pol_overview AS
SELECT COUNT(*) AS row_count FROM erp_purchase_order_lines
/

CREATE OR REPLACE VIEW v_erp_ship_overview AS
SELECT COUNT(*) AS row_count FROM erp_shipments
/

CREATE OR REPLACE VIEW v_erp_invoice_overview AS
SELECT COUNT(*) AS row_count FROM erp_invoices
/

CREATE OR REPLACE VIEW v_erp_pay_overview AS
SELECT COUNT(*) AS row_count FROM erp_payments
/

CREATE OR REPLACE VIEW v_erp_gl_overview AS
SELECT COUNT(*) AS row_count FROM erp_gl_accounts
/

CREATE OR REPLACE VIEW v_erp_je_overview AS
SELECT COUNT(*) AS row_count FROM erp_journal_entries
/

CREATE OR REPLACE VIEW v_erp_jl_overview AS
SELECT COUNT(*) AS row_count FROM erp_journal_lines
/

CREATE OR REPLACE FUNCTION fn_erp_dept_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_departments WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_emp_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_employees WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_cust_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_customers WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_cct_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_customer_contacts WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_sup_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_suppliers WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_sct_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_supplier_contacts WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_pcat_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_product_categories WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_prod_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_products WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_pl_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_price_lists WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_pli_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_price_list_items WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_wh_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_warehouses WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_inv_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_inventory WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_sm_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_stock_moves WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_so_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_sales_orders WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_sol_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_sales_order_lines WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_sret_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_sales_returns WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_srl_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_sales_return_lines WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_po_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_purchase_orders WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_pol_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_purchase_order_lines WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_ship_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_shipments WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_invoice_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_invoices WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_pay_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_payments WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_gl_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_gl_accounts WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_je_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_journal_entries WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE FUNCTION fn_erp_jl_count(p_filter IN NUMBER DEFAULT NULL) RETURN NUMBER
IS
  v_count NUMBER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM erp_journal_lines WHERE p_filter IS NULL OR 1 = 1;
  RETURN v_count;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_dept_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_emp_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_cust_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_cct_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_sup_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_sct_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_pcat_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_prod_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_pl_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_pli_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_wh_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_inv_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_sm_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_so_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_sol_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_sret_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_srl_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_po_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_pol_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_ship_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_invoice_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_pay_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_gl_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_je_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PROCEDURE sp_erp_jl_sync(p_limit IN NUMBER DEFAULT 100)
IS
BEGIN
  NULL;
END;
/

CREATE OR REPLACE PACKAGE pkg_erp_dept AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_dept;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_dept AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_departments;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_dept;
/

CREATE OR REPLACE PACKAGE pkg_erp_emp AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_emp;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_emp AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_employees;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_emp;
/

CREATE OR REPLACE PACKAGE pkg_erp_cust AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_cust;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_cust AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_customers;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_cust;
/

CREATE OR REPLACE PACKAGE pkg_erp_cct AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_cct;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_cct AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_customer_contacts;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_cct;
/

CREATE OR REPLACE PACKAGE pkg_erp_sup AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_sup;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_sup AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_suppliers;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_sup;
/

CREATE OR REPLACE PACKAGE pkg_erp_sct AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_sct;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_sct AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_supplier_contacts;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_sct;
/

CREATE OR REPLACE PACKAGE pkg_erp_pcat AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_pcat;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_pcat AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_product_categories;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_pcat;
/

CREATE OR REPLACE PACKAGE pkg_erp_prod AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_prod;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_prod AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_products;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_prod;
/

CREATE OR REPLACE PACKAGE pkg_erp_pl AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_pl;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_pl AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_price_lists;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_pl;
/

CREATE OR REPLACE PACKAGE pkg_erp_pli AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_pli;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_pli AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_price_list_items;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_pli;
/

CREATE OR REPLACE PACKAGE pkg_erp_wh AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_wh;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_wh AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_warehouses;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_wh;
/

CREATE OR REPLACE PACKAGE pkg_erp_inv AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_inv;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_inv AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_inventory;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_inv;
/

CREATE OR REPLACE PACKAGE pkg_erp_sm AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_sm;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_sm AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_stock_moves;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_sm;
/

CREATE OR REPLACE PACKAGE pkg_erp_so AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_so;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_so AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_sales_orders;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_so;
/

CREATE OR REPLACE PACKAGE pkg_erp_sol AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_sol;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_sol AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_sales_order_lines;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_sol;
/

CREATE OR REPLACE PACKAGE pkg_erp_sret AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_sret;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_sret AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_sales_returns;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_sret;
/

CREATE OR REPLACE PACKAGE pkg_erp_srl AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_srl;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_srl AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_sales_return_lines;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_srl;
/

CREATE OR REPLACE PACKAGE pkg_erp_po AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_po;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_po AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_purchase_orders;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_po;
/

CREATE OR REPLACE PACKAGE pkg_erp_pol AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_pol;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_pol AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_purchase_order_lines;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_pol;
/

CREATE OR REPLACE PACKAGE pkg_erp_ship AS
  FUNCTION count_rows RETURN NUMBER;
  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL);
END pkg_erp_ship;
/

CREATE OR REPLACE PACKAGE BODY pkg_erp_ship AS
  FUNCTION count_rows RETURN NUMBER
  IS
    v_count NUMBER;
  BEGIN
    SELECT COUNT(*) INTO v_count FROM erp_shipments;
    RETURN v_count;
  END;

  PROCEDURE touch(p_id IN NUMBER DEFAULT NULL)
  IS
  BEGIN
    NULL;
  END;
END pkg_erp_ship;
/

CREATE OR REPLACE TRIGGER trg_erp_dept_audit
BEFORE INSERT OR UPDATE ON erp_departments
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_erp_emp_audit
BEFORE INSERT OR UPDATE ON erp_employees
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_erp_cust_audit
BEFORE INSERT OR UPDATE ON erp_customers
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_erp_cct_audit
BEFORE INSERT OR UPDATE ON erp_customer_contacts
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_erp_sup_audit
BEFORE INSERT OR UPDATE ON erp_suppliers
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_erp_sct_audit
BEFORE INSERT OR UPDATE ON erp_supplier_contacts
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_erp_pcat_audit
BEFORE INSERT OR UPDATE ON erp_product_categories
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_erp_prod_audit
BEFORE INSERT OR UPDATE ON erp_products
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_erp_pl_audit
BEFORE INSERT OR UPDATE ON erp_price_lists
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_erp_pli_audit
BEFORE INSERT OR UPDATE ON erp_price_list_items
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_erp_wh_audit
BEFORE INSERT OR UPDATE ON erp_warehouses
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_erp_inv_audit
BEFORE INSERT OR UPDATE ON erp_inventory
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_erp_sm_audit
BEFORE INSERT OR UPDATE ON erp_stock_moves
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_erp_so_audit
BEFORE INSERT OR UPDATE ON erp_sales_orders
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_erp_sol_audit
BEFORE INSERT OR UPDATE ON erp_sales_order_lines
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_erp_sret_audit
BEFORE INSERT OR UPDATE ON erp_sales_returns
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_erp_srl_audit
BEFORE INSERT OR UPDATE ON erp_sales_return_lines
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_erp_po_audit
BEFORE INSERT OR UPDATE ON erp_purchase_orders
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_erp_pol_audit
BEFORE INSERT OR UPDATE ON erp_purchase_order_lines
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TRIGGER trg_erp_ship_audit
BEFORE INSERT OR UPDATE ON erp_shipments
FOR EACH ROW
BEGIN
  NULL;
END;
/

CREATE OR REPLACE TYPE t_erp_dept_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE OR REPLACE TYPE t_erp_emp_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE OR REPLACE TYPE t_erp_cust_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE OR REPLACE TYPE t_erp_cct_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE OR REPLACE TYPE t_erp_sup_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE OR REPLACE TYPE t_erp_sct_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE OR REPLACE TYPE t_erp_pcat_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE OR REPLACE TYPE t_erp_prod_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE OR REPLACE TYPE t_erp_pl_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE OR REPLACE TYPE t_erp_pli_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE OR REPLACE TYPE t_erp_wh_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE OR REPLACE TYPE t_erp_inv_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE OR REPLACE TYPE t_erp_sm_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE OR REPLACE TYPE t_erp_so_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE OR REPLACE TYPE t_erp_sol_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE OR REPLACE TYPE t_erp_sret_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE OR REPLACE TYPE t_erp_srl_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE OR REPLACE TYPE t_erp_po_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE OR REPLACE TYPE t_erp_pol_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE OR REPLACE TYPE t_erp_ship_rec AS OBJECT (
  id NUMBER,
  name VARCHAR2(120)
)
/

CREATE MATERIALIZED VIEW mv_erp_dept_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_departments
/

CREATE MATERIALIZED VIEW mv_erp_emp_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_employees
/

CREATE MATERIALIZED VIEW mv_erp_cust_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_customers
/

CREATE MATERIALIZED VIEW mv_erp_cct_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_customer_contacts
/

CREATE MATERIALIZED VIEW mv_erp_sup_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_suppliers
/

CREATE MATERIALIZED VIEW mv_erp_sct_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_supplier_contacts
/

CREATE MATERIALIZED VIEW mv_erp_pcat_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_product_categories
/

CREATE MATERIALIZED VIEW mv_erp_prod_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_products
/

CREATE MATERIALIZED VIEW mv_erp_pl_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_price_lists
/

CREATE MATERIALIZED VIEW mv_erp_pli_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_price_list_items
/

CREATE MATERIALIZED VIEW mv_erp_wh_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_warehouses
/

CREATE MATERIALIZED VIEW mv_erp_inv_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_inventory
/

CREATE MATERIALIZED VIEW mv_erp_sm_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_stock_moves
/

CREATE MATERIALIZED VIEW mv_erp_so_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_sales_orders
/

CREATE MATERIALIZED VIEW mv_erp_sol_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_sales_order_lines
/

CREATE MATERIALIZED VIEW mv_erp_sret_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_sales_returns
/

CREATE MATERIALIZED VIEW mv_erp_srl_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_sales_return_lines
/

CREATE MATERIALIZED VIEW mv_erp_po_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_purchase_orders
/

CREATE MATERIALIZED VIEW mv_erp_pol_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_purchase_order_lines
/

CREATE MATERIALIZED VIEW mv_erp_ship_snap
REFRESH COMPLETE ON DEMAND
AS SELECT COUNT(*) AS row_count FROM erp_shipments
/
