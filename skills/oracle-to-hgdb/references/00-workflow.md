# 00 工作流：盘点、排序、交付

## 1. 输入形态

| 输入 | 处理 |
|---|---|
| 目录（批量） | 递归读取 `*.sql`、`*.prc`、`*.fnc`、`*.pkb`、`*.pks`、`*.trg`；先产出清单，再按依赖排序；输出镜像 `converted/`。 |
| 单文件 | 拆分为对象块（见下），逐对象转换；输出同名文件或询问落盘位置。 |
| 粘贴文本 | 先判断是单对象还是多对象；多对象时按对象分别给结果。 |
| Oracle 源库 | 先用 `scripts/extract-oracle.ps1` / `scripts/oracle-extract.sql` 导出为文件，再走目录批量；DSH 不能直连 Oracle。 |

## 2. 对象盘点

对每个文件识别对象类型（忽略注释与字符串字面量中的关键字）：

| 类型 | 识别关键字 |
|---|---|
| PACKAGE / PACKAGE BODY | `CREATE [OR REPLACE] PACKAGE [BODY]` |
| FUNCTION | `CREATE [OR REPLACE] FUNCTION` |
| PROCEDURE | `CREATE [OR REPLACE] PROCEDURE` |
| TRIGGER | `CREATE [OR REPLACE] TRIGGER` |
| VIEW / MATERIALIZED VIEW | `CREATE [OR REPLACE] [FORCE] VIEW`、`CREATE MATERIALIZED VIEW` |
| TYPE / TYPE BODY | `CREATE [OR REPLACE] TYPE` |
| TABLE | `CREATE [GLOBAL TEMPORARY] TABLE` |
| INDEX | `CREATE [UNIQUE] INDEX`、`ALTER TABLE ... ADD CONSTRAINT ... UNIQUE/PRIMARY KEY` |
| SEQUENCE | `CREATE SEQUENCE` |
| SYNONYM | `CREATE [PUBLIC] SYNONYM` |
| 匿名块 | `DECLARE` / `BEGIN ... END;` 且无 `CREATE` |
| 权限/注释 | `GRANT`、`REVOKE`、`COMMENT ON` |

盘点结果写成表：`源对象 | 类型 | 依赖 | 被谁调用 | 状态`。

## 3. 依赖排序

固定顺序：

```
自定义类型 → 序列 → 表/约束/索引 → 函数（无依赖者优先） → 存储过程 → 包（schema 先建） → 视图 → 物化视图 → 触发器 → 权限/注释
```

- 视图依赖视图时，按引用深度排序；`FORCE` 视图先建占位再 `CREATE OR REPLACE`。
- 包函数互相调用时先建 schema，再按「叶子函数 → 上层函数」顺序建，最后建依赖它们的视图/触发器。
- 触发器依赖触发器函数，函数依赖表与类型；先建函数再建触发器。
- 无法确定依赖时，先转换被引用对象，或在报告标注「建库顺序待确认」。

## 4. 拆分与命名

- 一个对象一个文件；文件名用 `对象类型_对象名.sql`（全小写），例如 `function_f_get_amt.sql`、`package_pkg_order.sql`。
- 源文件内有多个对象时，按对象拆开，保留原文件路径映射在报告里。
- 对象名：默认小写、不加引号；保留字或必须区分大小写时才加双引号，并全链路一致（定义、调用、权限、视图、触发器、应用 SQL）。
- 包转 schema 后，原 `pkg.proc` 调用改为 `pkg.proc`（同名 schema 限定）；schema 名不要与现有表/视图重名。
- 同义词：优先改调用点；不能改调用方时用视图或 `search_path` 兜底（见 01）。

## 5. 单对象转换五步

1. **读全文**：对象完整源文本 + 相关表结构 + 被调用对象签名。
2. **标注差异**：列出必须改写的构造（类型、伪列、函数、异常、事务、包状态）。
3. **改写**：保持业务逻辑与注释；不删除分支；错误处理保留并映射 SQLSTATE。
4. **自检**：配对、关键字、签名、调用点、权限；能连库就编译。
5. **记录**：变更说明 + 风险等级 + 未验证项，写入报告。

## 6. 批量与并行

- 小于 20 个对象：顺序转换，保持依赖顺序。
- 大于 20 个对象：先完成类型、表、基础函数；剩余对象可按「文件」分给子代理并行转换，但：
  - 每个子代理必须加载本 skill；
  - 共享对象（包、公共函数、视图）由主代理统一转换；
  - 合并后统一做一次全量依赖排序与编译校验。

## 7. 输出版式

```sql
-- converted-from-oracle: SCHEMA.OBJECT (TYPE)
-- source-file: src/xxx.sql
-- risk: low | medium | high
-- notes: 关键语义差异、待确认项、兼容写法是否已探测
```

目录：

```
converted/
  tables/  sequences/  functions/  procedures/  packages/  views/  triggers/  grants/
CONVERSION_REPORT.md
MAPPING.md            # 可选：对象名、schema、调用点对照
```

## 8. 报告字段（逐对象）

| 字段 | 说明 |
|---|---|
| 源对象 | `OWNER.OBJECT (TYPE)` |
| 目标对象 | `schema.object (kind)` |
| 状态 | `auto` 自动完成 / `semi` 已转换但需人工确认 / `manual` 只给方案未落地 / `unsupported` 无等价物 |
| 关键改动 | 类型、伪列、函数、异常、事务、包状态等 |
| 风险 | `low` / `medium` / `high` + 一句话原因 |
| 验证 | 编译通过、冒烟用例、数据对比、未验证 |
| 备注 | 依赖、上线顺序、性能注意 |

## 9. 交付检查

- [ ] 对象清单与源目录一致，无遗漏、无重复。
- [ ] 依赖顺序可执行，`converted/` 能按文件名顺序建库（或在报告给出顺序脚本）。
- [ ] 所有 Oracle 专有构造要么已改写，要么已在报告标注「依赖兼容模式，待探测」。
- [ ] 高风险项（自治事务、提交、包状态、空串语义、动态 SQL）逐条列出。
- [ ] 未连库时明确写「未编译验证」，不要写成「已验证」。