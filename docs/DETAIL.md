# HGDB Convert Studio

HGDB Convert Studio 是一个多源（Oracle / MySQL / SQL Server）到瀚高 HGDB V9 的对象转换工作台：读取源库对象 → 本地规则或智能体转换 → 依赖/差异/规则分析 → 目标库批量执行 → 报告导出，界面支持中英文切换。

## 能转换什么

| 对象 | 说明 |
|---|---|
| 函数 | 标量函数、表函数、PIPELINED、确定性/并行属性、重载 |
| 存储过程 | IN/OUT/INOUT 参数、SYS_REFCURSOR 结果集、事务控制 |
| 包 | 规范与包体 → schema + 函数集 + 包级状态 + 初始化逻辑 |
| 视图/物化视图 | FORCE、WITH CHECK OPTION、刷新与并发刷新替代方案 |
| 触发器 | 行级/语句级、`:NEW`/`:OLD`、WHEN、INSTEAD OF、顺序、启停、DDL 审计；MySQL 触发器改为 PL/pgSQL 触发器函数 + `CREATE TRIGGER` |
| 其他 | 建表与约束、索引、序列、同义词、注释、权限、分区、临时表 |
| MySQL 专有 | 反引号标识符、`AUTO_INCREMENT`→IDENTITY、`TINYINT/INT UNSIGNED/ENUM（text + CHECK）/SET（text[] + CHECK，<@ 取值集合）/JSON/DATETIME` 等类型、`ENGINE`/`CHARSET`/`COLLATE` 表选项、表/列 `COMMENT`、`UNIQUE KEY`/普通索引/前缀索引、`ON UPDATE CURRENT_TIMESTAMP`、EVENT→pg_cron/pgAgent |

查询方言覆盖 DUAL、ROWNUM、CONNECT BY、DECODE/NVL/NVL2、`(+)`、MERGE、INSERT ALL、LISTAGG、KEEP、PIVOT/UNPIVOT、MODEL、提示（hint）、ROWID 等；MySQL 方言覆盖 IFNULL、NOW()/CURDATE()、LIMIT m,n、GROUP_CONCAT、DATE_FORMAT、ON DUPLICATE KEY、INSERT IGNORE、REPLACE INTO、REGEXP、用户变量等。

## 产品总览（首页）

打开 **HGDB Convert Studio** 先进入产品总览，而不是直接进入编辑器：首屏展示转换主视觉、Oracle / MySQL / SQL Server → HGDB 动态链路、转换任务数、连接数与累计对象、转换成功率、近 7/30 天趋势图与最近任务。顶栏标签包括「项目总览 / 任务中心 / 任务详情 / 连接管理」。首页主视觉只保留标题与说明（不放新建按钮），新建任务从「任务中心」的「新建任务」进入：先打开任务向导（名称与来源方式 → 对象类型 → 兼容确认），保存后进入编辑器；「进入工作台」或任意最近任务直接进入编辑器。首次使用且没有真实连接/文件时，页面展示带「演示数据」标记的示例，添加连接或完成转换后自动切换为本地真实数据。

- **任务中心**：新建任务分三步配置——任务名称与来源方式（源库读取 / 本地 SQL）、源库（Oracle / MySQL / SQL Server）与目标库（目标库可选）、目标 schema；勾选要读取的对象类型（Oracle：表、视图、物化视图、函数、过程、包、包体、触发器、类型、序列、同义词、定时任务 JOB；MySQL：表、视图、函数、过程、触发器、EVENT）；确认兼容模式后保存。本地 SQL 任务不在向导里提前填写 SQL，保存后生成空白 SQL 文件（按任务内序号命名：`SQL-01.sql`、`SQL-02.sql`…，不再与任务同名），进入工作台后再导入或粘贴。保存后进入工作台，源库任务按所选类型读取对象；任务列表显示状态、进度、类型与兼容配置，并用「获取 → 转换 → 执行」步骤条显示各阶段完成情况（源库任务才有「获取」，配了目标库才有「执行」）；重新「读取」源库会清空该任务的旧对象 SQL 并按源库对象重建，修改任务配置（源库、目标库、schema、兼容模式、读取类型）会清空该任务的转换与执行结果，步骤条回到未完成，支持读取、编辑与删除；MySQL 表按外键依赖排序读取，顺序执行时外键不会指向尚不存在的表；
- **数据库资源管理器**：连接根节点、按对象类型分组的可折叠树、对象类型图标与转换状态标记。
- **同义词与定时任务**：同义词通过 `DBMS_METADATA.GET_DDL('SYNONYM')` 读取，转换时把 `"TEST"."SYN_X"` 归一为小写 `test.syn_x`，目标端 `CREATE [OR REPLACE] SYNONYM` 可直接执行；定时任务从 `ALL_SCHEDULER_JOBS` 读取并还原成 `DBMS_SCHEDULER.CREATE_JOB` 脚本，但 HGDB V9 没有 DBMS_SCHEDULER，需要在目标端改写为 pgAgent / pg_cron（当前目标已安装 pgAgent，pg_cron 可作为扩展启用），转换结果会标记为需人工确认。

## 转换工作台（整页）

点「任务详情」标签进入三栏工作台。工作台按任务工作：先在左列选择「任务中心」中的转换任务，源库、目标库、schema、对象类型与兼容模式都由任务带出，不再直接选择库连接：

- **顶部操作**：「转换 / 执行 / 导出」作用于当前任务下的全部 SQL（多个结果一起导出打成单个 zip，只弹一次保存框；单个文件仍是 `.converted.sql`）；顶部标签页会记住上次停留的页面；
- **左列 SQL 列表**：搜索、新建/导入 SQL；顶部从「任务中心」选择转换任务，自动带出源库、目标库、schema、对象类型与兼容模式；源库任务可「读取」并按类型分组；删除任务会同时删除任务下的 SQL；
- **中列 源 SQL**：带行号的编辑器，可重命名/删除/导入/复制，点「本地转换」用本地规则转换当前文件；
- **中列 源 SQL（常驻「依赖对象」页签）**：源列固定为「源 SQL / 依赖对象」两个页签；打开页签或在该页签切换文件时会自动连库读取（有防重复请求保护，结果按文件缓存）；设置里的「获取对象时自动读取依赖」开启后，「读取对象」完成会批量预取**全部对象**的依赖（`--names` 批量模式，每 40 个一批，只回名字与类型）；某个依赖对象的 DDL 在展开时用 `--ddl-of` 按需单读并缓存，避免一次性传输大量 DDL。头部「获取依赖」（layers 图标，位于「AI 在线转换」之前）可随时为当前对象拉取依赖。依赖数据有两层：
  - **连库（权威）**：`/api/hgdb-convert-studio/dependencies` → `tools/ReadDependencies.java`。Oracle 用 `ALL_DEPENDENCIES`（表/视图/物化视图/函数/过程/包/类型/触发器/序列/同义词）；MySQL 用 `KEY_COLUMN_USAGE`（外键）、`VIEW_TABLE_USAGE`（视图引用）以及 `ROUTINES` / `TRIGGERS` / `EVENTS` 正文里命中的库内对象名。返回 `{name,type,ddl}`，DDL 由 `SHOW CREATE ...` / `DBMS_METADATA` 取，单项上限 20KB、最多 60 项。
  - **静态（兜底）**：`dependencyRefsOf` 剥离注释与字符串后，按 `FROM / JOIN / REFERENCES`、`INSERT|REPLACE|MERGE INTO`、`TABLE`、`CALL`、语句级 `UPDATE` 取标识符（归一化 schema 前缀与大小写），并匹配任务内已有对象名；`DUAL`、`CURRENT_TIMESTAMP` 等伪表/函数在停止词里排除，避免 `ON UPDATE CURRENT_TIMESTAMP`、`SELECT ... INTO 变量` 误判。
  两条路径都按「工作台已有 / 仅源库」标注；展开行可看 DDL，点「工作台已有」跳到该对象文件。打开页签且是源库任务时自动连库拉一次。关闭设置时页签与面板都不渲染。
- **右列 转换结果（四个页签）**：带行号的只读结果，可「执行」到目标库（未指定目标库时禁用）、复制/导出，或用「AI在线转换（智能体）」在后台会话里做语义改写；结果列顶部有 **结果 / 差异 / 规则 / 执行** 四个页签：
  - **差异**：源 SQL 与结果做 LCS 逐行 diff，显示 `+N / -M` 统计、可切「仅差异」，改动行做词级高亮，点行号可跳回源 SQL；
  - **规则**：把 `applied` / `warnings` 映射为可读文案（`RULE_CATALOG`），按“类型映射 / 函数改写 / 语法与 DDL / PL-SQL 与例程 / 风险提示”分组，显示命中次数与风险级别（高/中/低），正则型规则给出 `L1  NUMBER(10) → NUMERIC(10)` 示例并可点击定位；AI 转换的文件标注“按语义改写、未逐条记规则”；
  - **执行**：成功/失败、时间、目标库；失败时给友好结论（schema 缺失、对象已存在、语法不支持、权限不足）、处理建议与「重试此文件」；
  - 面板底部常驻摘要芯片 `规则 N / 风险 N / 已执行`，点击跳到对应页签；
- **任务报告**：顶部「报告」导出 Markdown（概览、对象明细、规则汇总、风险项、执行失败详情），「CSV」导出对象明细（UTF-8 BOM，Excel 直接打开）；
- **右上角（顶栏）「连接管理」**：整页维护连接档案（类型 / 主机 / 端口 / 库 / 用户 / 密码 / 默认 schema）。类型包括源端（Oracle、MySQL / SQL Server）与目标端三种 HGDB V9 形态：**HGDB-V9-PostgreSQL**（标准 PostgreSQL 协议实例，转换默认关闭兼容模式）、**HGDB-V9-Oracle**（已启用 `ivorysql_ora` 等扩展的 Oracle 兼容实例，仍用 PostgreSQL 协议连接，任务默认开启兼容模式）、**HGDB-V9-MySQL**（用 MySQL 驱动连接 HGDB 的 MySQL 协议端口，「数据库」字段是默认 schema）。三种目标的连接测试都会显示真实内核版本。密码以 AES-GCM 密文保存在浏览器 localStorage，密钥放在 IndexedDB 的不可导出 CryptoKey 中；旧版本的明文密码会在首次加载时自动迁移，解密失败时提示重新输入。该方案不等同于系统钥匙串：同一页面上下文中的脚本仍可调用密钥，但 localStorage 备份/截图不再直接暴露明文。

**设置 → HGDB Convert Studio** 仍保留同一套表单，作为不想切换页面时的快捷入口。两种入口共用同一份提示词与同一个智能体，不复制转换规则：转换始终由该智能体的技能库执行。

工作台只负责结构化输入与启动会话；转换过程、追问和落盘都在会话里完成。

## 工作方式

1. **盘点**：识别对象类型、依赖与调用链。
2. **探测**：对目标 HGDB V9 执行兼容能力探测（`scripts/probe-hgdb.sql`），得到「可保留 Oracle 写法 / 必须改写」的能力矩阵。
3. **转换**：按 `类型 → 序列 → 表 → 函数 → 过程 → 包 → 视图 → 触发器 → 权限` 顺序逐对象改写。
4. **自检**：静态配对检查、可编译性检查（连库时 `check_function_bodies` / `plpgsql_check`）、语义风险清单。
5. **交付**：`converted/` 镜像目录 + `CONVERSION_REPORT.md`（状态、改动、风险、未验证项）。

## 兼容模式

目标端启用 Oracle 兼容模式时，智能体优先保留 Oracle 写法（DUAL、NVL、ROWNUM、CONNECT BY、`(+)`、PACKAGE、DBMS_OUTPUT 等），但只有在探测脚本证明可用时才保留；否则给出 HGDB V9 标准写法。兼容能力随 HGDB 版本与参数变化，不要把某一环境的结论套到另一环境。

兼容模式只保留**语法**写法，不保留 Oracle 标识符的大小写。目标 schema 由执行器用小写创建，两种目标形态对带引号名的处理还不一样：Oracle 兼容实例（`ivorysql_ora`）把引号内折成大写再大小写不敏感匹配，`"TEST"."FN_X"` 实际落到 `test.fn_x`（同一对象），而 `"test"."FN_X"` 反而报 `schema "TEST" does not exist`；PG 形态实例（无 `ivorysql_ora`）则 `"TEST"."FN_X"` 直接报 `schema "TEST" does not exist`。小写无引号在两种形态下都可用，因此本地转换与 AI 在线转换都把带引号标识符归一成小写无引号（`test.fn_x`），两条路径输出一致。

MySQL 源固定按 HGDB V9 标准写法转换，自增列改写为 `GENERATED BY DEFAULT AS IDENTITY`；未选目标库时向导不显示兼容模式单选，选定目标库后按目标库锁定。

兼容模式在向导第 3 步为单选：**PostgreSQL / Oracle / MySQL / SQL Server**，默认 PostgreSQL。未选择目标库时可自由选择；选定目标库后锁定为目标库对应的模式（HGDB-V9-PostgreSQL→PostgreSQL、HGDB-V9-Oracle→Oracle、HGDB-V9-MySQL→MySQL），不能单独修改。任务的兼容模式写入任务配置：Oracle 模式保留 NVL/DECODE/ROWNUM/PACKAGE 等写法；MySQL 模式（对应 HGDB-V9-MySQL 目标）走最小改写，保留 MySQL 方言并用 `plmysql` 承载例程；PostgreSQL 与 SQL Server 模式按 HGDB V9 标准写法转换。

## 边界与限制

- 不直连 Oracle：`dsh-sql` 没有 Oracle 驱动。需要源库对象时用 SQL*Plus 抽取脚本、`expdp` 或既有导出文件。
- MySQL 直连由 Host 侧 JDBC 完成（`drivers/mysql.jar`）；只读 `information_schema` 与 `SHOW CREATE ...`，不执行任何 DDL/DML。MySQL 的库名等同于 schema，连接里的「数据库/服务名」填库名。
- HGDB-V9-Oracle 与 HGDB-V9-PostgreSQL 都走 PostgreSQL 协议（`drivers/postgresql.jar`），区别是前者实例启用了 Oracle 兼容模式、任务默认保留 Oracle 写法；如果实例只开放 MySQL 协议端口，请用 HGDB-V9-MySQL 连接。
- HGDB-V9-MySQL 不是独立的 MySQL 服务：它用 MySQL 驱动与协议连到 HGDB（服务端内核仍是 PostgreSQL 14，`version()` 返回 `PostgreSQL 14.23`），但该端口按 **MySQL 方言**解析与执行——反引号、`AUTO_INCREMENT`、`ENGINE`/`CHARSET`、`ENUM`、`UNSIGNED`、`ON DUPLICATE KEY`、`LIMIT n,m` 等 MySQL 写法可直接运行，例程通过内置 `plmysql` 过程语言执行。该类型的「数据库」字段是默认 schema；源端读取（`SHOW CREATE` / `information_schema`）不适用该协议端口，所以它只作为目标连接。
- 自治事务、`COMMIT` 语义、包级会话状态、`SELECT INTO` 严格性、空串与 NULL 差异，属于需要人工复核的语义点，报告中会单列。
- MySQL 的 `ON UPDATE CURRENT_TIMESTAMP`、`ENUM`/`SET`、`FULLTEXT`/`SPATIAL` 索引、分区、存储过程/函数/触发器/EVENT 过程体、`BIGINT UNSIGNED` 范围，本地规则只做提示或部分改写，需 AI/人工复核。
- 物化视图的 FAST REFRESH ON COMMIT、MODEL 子句、`DBMS_SCHEDULER` 等没有等价物，只能给替代方案。
- 智能体不在生产库执行任何 DDL/DML。

## 界面语言

- 语言状态由 `useLangToggle` 管理（`readLang` / `saveLang`，键 `hgdb-convert-studio.lang.v1`，默认中文）。
- `HomeView` / `StudioPage` 外层包装把 `t` 替换为 `makeTranslator(lang, props.t)`：**先查本地 `zh`/`en` 字典，找不到再回退宿主 `t`**，因此新增文案只要补进字典就能双向生效。
- 切换入口：`StudioTopNav` 右上角地球图标（显示 `中` / `EN`）；系统设置「外观 → 语言」分段按钮（`settingsLanguage`）。
- 规则名称单独维护 `RULE_LABELS_EN`（仅含中文的 39 条），`ruleInfo(id, lang)` / `groupRules(applied, warnings, lang)` 按语言取标签；转换报告（Markdown/CSV）的表头与状态词也走字典。
- AI 提示词不参与本地化（模型指令）。
