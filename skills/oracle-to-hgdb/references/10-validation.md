# 10 验证与上线检查

## 1. 静态检查（无需数据库）

| 检查 | 方法 |
|---|---|
| 括号/引号配对 | 目视或用编辑器括号匹配；`$$` 与 `$tag$` 成对 |
| 块结构 | 每个 `BEGIN` 有 `END;`，`IF` 有 `END IF;`，`LOOP` 有 `END LOOP;` |
| 对象名一致 | 定义、调用、权限、注释里的 schema/对象名一致；大小写一致 |
| 类型一致 | 变量、参数、`RETURN`/`RETURNS` 类型匹配；`numeric` vs `integer` 调用点显式转换 |
| 残留 Oracle 构造 | 全文搜索：`dual`、`rownum`、`nvl(`、`decode(`、`sysdate`、`connect by`、`(+)`、`:NEW`、`:OLD`、`PACKAGE`、`DBMS_`、`UTL_`、`PRAGMA`、`EXECUTE IMMEDIATE`、`%TYPE`（保留则确认） |
| 事务 | 函数体内无 `COMMIT`/`ROLLBACK`；过程内 `COMMIT` 已评估调用上下文 |
| 动态 SQL | `EXECUTE` 的字符串是一条语句；标识符/字面量用 `format('%I'/'%L')` |
| 安全 | `SECURITY DEFINER` 已固定 `search_path`；`PUBLIC` 权限已收紧 |
| 依赖顺序 | 文件命名/报告顺序可按 `类型→序列→表→函数→过程→包→视图→触发器` 执行 |

## 2. 连库编译

```sql
-- 打开函数体语法检查（建函数时生效）
SET check_function_bodies = on;

-- 重建对象后，检查是否有编译错误
-- psql 下逐文件执行并保留错误
\i converted/01_types.sql
\i converted/02_tables.sql
...
```

排查函数：

```sql
SELECT n.nspname AS schema, p.proname, p.provolatile, p.prosecdef,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY 1, 2;
```

`plpgsql_check`（若可安装）：

```sql
CREATE EXTENSION IF NOT EXISTS plpgsql_check;
SELECT p.oid::regprocedure AS fn, c.*
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL plpgsql_check_function(p.oid) c
WHERE n.nspname = 'app';
```

注意：`check_function_bodies` 只检查语法，不检查运行时才解析的动态 SQL；`plpgsql_check` 能发现部分类型/变量问题，但不是完整证明。

## 3. 冒烟测试

每个对象至少一个最小用例：

```sql
-- 函数
SELECT app.f_get_amt(1);

-- 过程
CALL app.p_close_order(1, NULL);

-- 视图
SELECT * FROM app.v_order_summary LIMIT 10;

-- 触发器
INSERT INTO app.t_order (id, amount, status) VALUES (999, 10, NULL) RETURNING id, status;
UPDATE app.t_order SET amount = 20 WHERE id = 999;
DELETE FROM app.t_order WHERE id = 999;

-- 包（同一会话连续调用，验证状态）
SELECT app.pkg_order.get_status(1);
CALL app.pkg_order.close_order(1);
SELECT app.pkg_order.get_status(1);
```

异常路径也要测：零行、多行、约束冲突、除零、自定义错误。

## 4. 数据对比

迁移是「结构 + 逻辑」，必须验证结果一致：

1. **行数**：`SELECT count(*) FROM t`（源/目标）。
2. **聚合校验**：`SUM`、`MIN`、`MAX`、`COUNT(DISTINCT)` 对比。
3. **抽样比对**：按主键取 N 行，逐列对比（`EXCEPT`/`UNION ALL`）。
4. **全量 checksum**（可排序主键）：

```sql
SELECT count(*), sum(hashtext(t::text)) FROM t;
```

5. **分组对比**：按业务维度分组聚合，对比每组结果。

差异处理：先确认是「转换 bug」还是「源数据本身在变」；记录差异样本与结论。

## 5. 性能验证

- 关键查询跑 `EXPLAIN (ANALYZE, BUFFERS)`，确认走索引、无意外全表扫描。
- 检查统计信息：`ANALYZE 表;`，必要时调 `default_statistics_target`。
- 触发器/函数逐行处理在大批量下会放大，压测后再决定是否改为集合操作。
- 物化视图刷新、包初始化、审计表写入都要算进基准。
- 对比源库执行计划时，注意 Oracle 与 PG 的优化器差异，不要强求计划一致。

## 6. 上线顺序

```text
1. 建角色/schema
2. 建类型、序列
3. 建表、约束、索引
4. 建函数、过程（按依赖）
5. 建包 schema 与函数
6. 建视图、物化视图
7. 建触发器函数与触发器
8. 授权、注释
9. 初始化数据/序列起点
10. 冒烟 + 数据对比 + 回归
```

## 7. 验收清单

- [ ] 对象数量与源库一致（表/视图/函数/过程/包/触发器/序列）。
- [ ] 全部对象可编译（无语法错误）。
- [ ] 冒烟用例通过（含异常路径）。
- [ ] 关键业务 SQL 结果与源库一致（行数、聚合、抽样）。
- [ ] 高风险项已逐条确认：自治事务、提交语义、包状态、空串/NULL、ROWNUM、日期精度。
- [ ] 权限与 `search_path` 正确；`PUBLIC` 权限已收紧。
- [ ] 备份/回滚方案就绪。
- [ ] 报告中「未验证项」已列出，并指定复测环境。

## 8. 报告模板

见 `templates/CONVERSION_REPORT.md`；至少包含：概览（对象数、状态分布）、逐对象表、风险清单、兼容能力矩阵、验证记录、未验证项与后续动作。