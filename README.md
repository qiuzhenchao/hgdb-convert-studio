# HGDB Convert Studio

HGDB Convert Studio —— Oracle / MySQL / SQL Server 到瀚高 HGDB V9 的转换工作台。把源库对象读取进来，按本地规则或智能体转换成目标可执行 SQL，并在同一界面完成依赖分析、差异比对、批量执行与报告导出。

- 函数、存储过程、包（规范 + 包体）、匿名块
- 视图、物化视图
- 触发器（行级/语句级/INSTEAD OF/事件触发器转换）
- 建表、约束、索引、序列、同义词、注释、权限
- 同义词：目标端支持 `CREATE [OR REPLACE] SYNONYM`；转换时会把 Oracle 的 `"TEST"."SYN_X"` 归一成小写 `test.syn_x`
- 标识符归一：`"TEST"."FN_X"` 一律输出为小写无引号的 `test.fn_x`。目标 schema 由执行器以 `CREATE SCHEMA IF NOT EXISTS test` 建为小写：Oracle 兼容实例（`ivorysql_ora`）会把带引号名折成大写再做大小写不敏感匹配（`"TEST"."FN_X"` 实际落到 `test.fn_x`，但 `"test"."FN_X"` 反而报 `schema "TEST" does not exist`），PG 形态实例则 `"TEST"."FN_X"` 直接报同样的错。小写无引号两种形态都能跑，本地转换与 AI 在线转换也统一走这套归一规则
- 定时任务（DBMS_SCHEDULER JOB：读取时还原为 `CREATE_JOB` 脚本；目标端无 DBMS_SCHEDULER，需改写为 pgAgent / pg_cron）
- 查询与 DML 方言：DUAL、ROWNUM、CONNECT BY、DECODE/NVL、`(+)` 外连接、MERGE、LISTAGG、KEEP、PIVOT、分析函数等
- **MySQL 源**：表、视图、函数、存储过程、触发器、EVENT；本地规则改写反引号、数据类型、AUTO_INCREMENT→IDENTITY、ENGINE/CHARSET/COLLATE 表选项、表/列注释、UNIQUE KEY/普通索引、外键、ON UPDATE CURRENT_TIMESTAMP；查询方言覆盖 IFNULL、NOW()、LIMIT m,n、GROUP_CONCAT、ON DUPLICATE KEY、REPLACE INTO、REGEXP 等

## 安装

**宿主版本要求**：DSH `>= 0.2.2-rc.5`（见 `package.json` 的 `engines.dsh`）。低于此版本的宿主会在安装时被拦下。

### 方式一：本地目录（离线可用，最稳）

1. 克隆本仓库到任意目录：

   ```bash
   git clone https://github.com/qiuzhenchao/hgdb-convert-studio.git
   ```

2. 在 DSH 的 **插件** 页选择该目录安装（`hgdb-convert-studio/`，即含 `package.json` 的那一层）；
   或由 agent 调用 `plugin_manager` 的 `install_bundle`，target 指向该目录的绝对路径。
3. 重启 DSH（或刷新页面）后：
   - 新会话的智能体选择器里出现 **HGDB Convert Studio**；
   - 侧边栏出现 **HGDB Convert Studio** 入口，打开整页转换工作台；
   - **设置 → HGDB Convert Studio** 保留同一套表单的快捷入口。

本 bundle 链接安装（link），修改 `skills/` 下的规则文件后新会话立即生效，无需重装。

### 方式二：Git 直装（锁定 commit）

适合能访问 `github.com` 的机器，不需要 npm：

```bash
dsh plugin --profile <profile> add "git+https://github.com/qiuzhenchao/hgdb-convert-studio.git#<40 位 commit SHA>"
```

`#` 后面必须是完整的 40 位 commit SHA，分支名和短 SHA 都不被接受。插件在仓库根目录，所以不需要 `&path:`。

### 方式三：插件市场

本插件正在提交至 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 精选列表；收录后可在 DSH 插件市场（dsh-market）或 **插件 → 发现** 里搜索「HGDB」「Oracle 转换」找到。收录生效前用方式一或方式二安装。

市场之外的机器也可以把这份目录当作索引源，在 **插件 → 发现 → 索引源** 添加：

```text
https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json
```

### 内网分发

内网机器访问不了 GitHub 时，把仓库打成 zip 传过去，解压后用**方式一**安装即可：`drivers/` 里的 JDBC 驱动已随仓库分发，不需要联网拉依赖。

## 产品总览首页

打开侧边栏 **HGDB Convert Studio** 先进入产品总览，而不是直接落到 SQL 编辑器。首页上方是主视觉，下方为左右分栏：

- **主视觉**：深色渐变、转换轨道与实时转换控制台，展示 Oracle / MySQL → HGDB 的改写示例；（SQL Server 走 AI 转换）
- **左侧趋势图**：近 7 天 / 近 30 天可切换，已完成与待复核双序列；
- **右侧运行概览**：转换任务（本地 / 源库）、已连接数据库、累计转换对象、SQL 转换成功率，2×2 紧凑排列；
- **右侧最近转换**：最近 10 条转换结果与相对时间，可直接进入任务中心；
- **右侧快捷入口**：任务中心、连接管理。

「任务中心」的「新建任务」先打开任务向导（名称 → 来源与目标 → 对象类型 → 兼容模式），保存后进入编辑器；「进入工作台」与「最近任务」直接回到编辑器。首页主视觉只保留标题与说明，不再放新建按钮。首次使用且没有连接/文件时展示带「演示数据」标记的示例数据，添加连接或完成转换后自动切换为真实数据。

顶部「项目总览 / 任务中心 / 任务详情 / 连接管理」是真正的标签切换：

- **任务中心**：右上角「新建任务」按三步配置转换任务——① 任务名称 + 来源方式（源库读取 / 本地 SQL）、源库与目标库（目标库可选）、目标 schema；② 勾选要读取的对象类型（表、视图、物化视图、函数、过程、包、包体、触发器、类型、序列、同义词、定时任务 JOB）；③ 兼容模式与摘要确认：兼容模式是单选（PostgreSQL / Oracle / MySQL / SQL Server，默认 PostgreSQL），未选目标库时可自由选择，选定目标库后自动锁定为目标库对应的模式。本地 SQL 任务无需在向导里提前填写 SQL，保存后会创建空白 SQL 文件（按任务内序号命名：`SQL-01.sql`、`SQL-02.sql`…，不再沿用任务名），进入工作台后再导入文件或直接粘贴（也可同时使用）。保存后任务立即进入工作台，源库任务会按所选类型读取对象；任务列表按状态、进度、对象类型与兼容模式跟踪，并用「获取 → 转换 → 执行」步骤条逐条显示每条任务各阶段是否完成（源库任务才有「获取」，配了目标库才有「执行」）；重新「读取」源库会清空该任务的旧对象 SQL 并按源库对象重建，修改任务配置（源库、目标库、schema、兼容模式、读取类型）会清空该任务的转换与执行结果，步骤条回到未完成，避免拿旧结果当新状态，支持读取、编辑、删除；
- **连接管理**：整页维护源端/目标端连接，不再占用弹窗。

顶栏右侧可切换**深色 / 浅色主题**（默认浅色，选择记忆在本机），两套主题覆盖首页、工作台与各标签页。

## 转换工作台（整页）

侧边栏 **HGDB Convert Studio**（`sidebar.panellist` + `main`）打开整页工作台，三栏布局：

- **顶部操作**：右侧「转换 / 执行 / 导出」作用于当前任务下的全部 SQL（多个结果一起导出时打包成一个 zip，只弹一次保存框；单个文件仍是 `.converted.sql`）；顶部标签页（总览 / 任务中心 / 任务详情 / 连接管理）会记住上次停留的页面；
- **左列 SQL 列表**：**任务选择**（来自「任务中心」的转换任务，选中后自动带出源库、目标库、目标 schema、对象类型与兼容模式）、转换状态与对象类型过滤；每个文件右侧有两个标记：绿色对号＝已转换，圆形播放标＝执行状态（灰色空圈未执行、绿色已执行、红色失败、蓝色执行中，配置了目标库时才显示）；源库任务可「读取」对象 DDL（对象清单一条查询取回，DDL 用 6 路并行抓取；系统 schema 与 `DBMS_`/`ORA_`/`UTL_` 等系统对象会被排除），并按对象类型分组；删除任务会同时删除任务下的 SQL；
- **中列 源 SQL**：行号编辑器，可重命名/删除/导入/复制，点「本地转换」按本地规则转换当前文件；源列固定有「源 SQL / 依赖对象」两个页签（「依赖对象」始终显示）：点页签里的「重新获取」或头部的「获取依赖」按钮，走 Host 的 `/api/hgdb-convert-studio/dependencies`（Java `ReadDependencies`）**连库读真实依赖**——Oracle 查 `ALL_DEPENDENCIES`，MySQL 查外键 `KEY_COLUMN_USAGE`、视图 `VIEW_TABLE_USAGE` 与例程/触发器体里出现的库内对象；每项带 DDL，可展开查看；同时标注该对象是否已在工作台（「工作台已有」可点击跳转、「仅源库」只能看 DDL）；未获取时先给静态识别结果兜底。依赖**默认就连库读**：打开「依赖对象」页签（或在该页签切换文件）时会自动从源库拉一次，命中缓存则直接显示；「系统设置 → 转换选项」里的**获取对象时自动读取依赖**开启后，**「读取对象」完成会批量预取全部对象的依赖**（每 40 个一批、一次 JVM 读回，结果按文件缓存），关闭时只能手动点「获取依赖」；页签始终显示；依赖对象的 DDL 在展开时按需从源库单对象读取并缓存；
- **删除语句**：开启「生成删除语句」后，本地转换会在 CREATE 前补 `DROP ... IF EXISTS`，覆盖表 / 视图 / 物化视图 / 函数 / 过程 / 触发器（`DROP TRIGGER IF EXISTS 名称 ON 表名`）/ 包 / 序列 / 类型 / 同义词 / 索引；函数与过程按 CREATE 的参数表自动带上输入参数类型（`DROP FUNCTION IF EXISTS test.fn_x(number)`，无参数为 `fn_x()`），目标库存在同名重载时不会报 `42725 not unique`（参数类型含 `%TYPE` 等无法静态确定时退回不带参数）；批量执行时若已有依赖信息，会**先按依赖倒序批量删除（依赖方 → 被依赖方）、再按依赖正序批量创建**，因此不会触发「other objects depend on them」，也不会因为 CASCADE 误删刚建好的对象；只有在拿不到依赖信息时才需要临时勾选**级联删除（DROP ... CASCADE）**（MySQL 兼容目标不支持 CASCADE 与 DROP TRIGGER，会自动跳过并给出规则提示）。
- **右列 转换结果 + 分析面板**：结果列顶部有四个页签——**结果 / 差异 / 规则 / 执行**：
  - **结果**：行号只读的转换后 SQL；
  - **差异**：源 SQL 与结果逐行 diff（LCS），显示 `+新增 / -删除` 统计、可切换「仅差异」，改动行内还有词级高亮（不用装依赖，纯前端计算）；
  - **规则**：把 `applied`/`warnings` 映射成「改了什么」——按「类型映射 / 函数改写 / 语法与 DDL / PL-SQL 与例程 / 风险提示」分组，显示命中次数、风险等级，并对正则型规则展示 `L12  NUMBER(12,2) → NUMERIC(12,2)` 示例，点示例可定位到源 SQL 对应行；AI 在线转换的文件会说明「按语义改写、未逐条记规则」；
  - **执行**：成功/失败状态、执行时间、目标库；失败时给出友好结论（schema 缺失、对象已存在、语法不支持、权限不足…）+ 常见处理建议 + 「重试此文件」；
  - 底部摘要芯片常驻显示 `规则 N / 风险 N / 已执行`，点击跳对应页签。
- **任务报告**：顶部「报告 / CSV」按任务导出转换报告——Markdown 含概览、对象明细、规则汇总、风险项与执行失败详情；CSV 为对象明细（带 UTF-8 BOM，Excel 直接打开不乱码）。
- **执行**：可「执行」到目标库（未指定目标库时执行禁用）、复制或导出当前结果，或用「AI在线转换（智能体）」做语义级改写；执行前会先 `CREATE SCHEMA IF NOT EXISTS` 建好任务的目标 schema 再切 `search_path`，所以目标库缺 schema 也能直接跑；批量「执行」走 `/api/hgdb-convert-studio/execute-batch`：**一次 JVM、一次 JDBC 连接执行整批脚本**（每 80 个对象一个请求），失败对象再自动批量重跑一次，实测 120 个建表对象约 17s（逐个执行约 2 分钟）。
- **底部状态条**：状态消息与目标连接名。编辑源 SQL 会自动清空状态，避免展示过期结果。

「连接管理」是顶栏标签页，页面按**左右两栏**组织：左栏源库（Oracle / MySQL / SQL Server）、右栏目标库（HGDB-V9-PostgreSQL / Oracle / MySQL），各自带新增按钮，新增时只显示该侧可选类型。可新增/编辑/删除连接并测试：所有类型都走 Host 侧的 JDBC 真实登录；驱动（`drivers/postgresql.jar`、`drivers/oracle.jar`、`drivers/mysql.jar`）和预编译的 `tools/classes/*.class` 都随插件打包，Host 相对插件目录解析，不依赖本机安装路径。目标机器只需 **Java 8+ 运行时**（不需要 JDK）。密码用 **AES-GCM** 加密后保存在本机 localStorage，密钥是 IndexedDB 里的不可导出 CryptoKey（旧版本的明文密码首次加载时自动加密迁移）；密码不会上传到转换会话。

源端连接类型可选 Oracle 或 MySQL。MySQL 的「数据库/服务名」填库名，读取时按 `information_schema` + `SHOW CREATE ...` 抽取表、视图、函数、过程、触发器与事件，并按外键依赖排序表；「默认 schema」留空时用库名。任务向导会按源库类型列出可读对象（MySQL 没有包、类型、序列、同义词），并固定按 HGDB 标准写法转换（MySQL 源没有 Oracle 兼容模式）。

目标端拆成三种 HGDB V9 形态：

- **HGDB-V9-PostgreSQL**：标准 PostgreSQL 协议实例（例如 `5432`，用户 `postgres`）。转换默认关闭兼容模式，按 HGDB 标准写法输出。
- **HGDB-V9-Oracle**：启用了 Oracle 兼容模式（`ivorysql_ora` 等扩展）的 HGDB 实例（例如 `1521`，库 `highgo`，用户 `highgo`）。仍用 **PostgreSQL 协议**连接；任务默认开启兼容模式，保留 NVL/DECODE/ROWNUM/PACKAGE 等 Oracle 写法。
- **HGDB-V9-MySQL**：用 MySQL 驱动连接 HGDB 的 **MySQL 协议**端口（例如 `33069`，用户 `mysql`，数据库即默认 schema，如 `mysql`）。该端口走 MySQL 方言：反引号、`AUTO_INCREMENT`、`ENGINE`/`CHARSET`、`ENUM`、`ON DUPLICATE KEY` 等 MySQL 写法可直接执行，例程另有内置 `plmysql` 过程语言；执行器按 MySQL 驱动 + MySQL 语法运行，与 PostgreSQL 协议目标不同。

三种目标的连接测试都会显示真实内核版本（如 `连接成功（PostgreSQL 14.23）`）。注意 HGDB-V9-MySQL 与「MySQL」源是两回事：MySQL 源是真正的 MySQL，HGDB-V9-MySQL 是 HGDB 目标端。

**设置 → HGDB Convert Studio**（settings.section）仍保留一个精简表单，可把请求直接交给会话执行；它和新页面共用同一份提示词与同一个智能体。

## 使用

- **目录批量**：把 `exp`/`DBMS_METADATA` 导出的 `.sql` 放进一个目录，告诉它目录路径与目标 schema；它按依赖顺序转换，输出 `converted/` 与 `CONVERSION_REPORT.md`。
- **单文件/粘贴**：直接把 SQL 贴进对话，要求转换即可；确认后再落盘。
- **Oracle 源库抽取**：本机装有 SQL*Plus 时，可用 `skills/oracle-to-hgdb/scripts/extract-oracle.ps1` 抽取 DDL/PLSQL，再交给智能体转换。DSH 的 `dsh-sql` 没有 Oracle 驱动，不能直连 Oracle。
- **MySQL 源库抽取**：在工作台「连接管理」新增 MySQL 连接后，任务里直接「读取」即可（Host 侧 JDBC 读取 `SHOW CREATE ...`）。目标为 HGDB-V9-MySQL 时走最小改写；其他目标走完整的 PG 化改写。
- **MySQL 本地转换识别**：源文件绑定 MySQL 连接时按 MySQL 规则转换；没有绑定连接时，含反引号、`ENGINE=`、`AUTO_INCREMENT` 或 MySQL 专有类型的 SQL 也会自动识别为 MySQL 源。
- **HGDB-V9-MySQL 目标**：目标选该类型（例如 `198.51.100.10:33069`）时采用**最小改写**：实测支持的 MySQL 写法（反引号、`AUTO_INCREMENT`、`ENGINE`/`CHARSET`、`ENUM`、`UNSIGNED`、`ON UPDATE CURRENT_TIMESTAMP`、`FULLTEXT`、`ON DUPLICATE KEY`、`LIMIT n,m` 等）原样保留；只改写实测不支持的部分（`SET` 类型、空间类型/`SPATIAL`、`PARTITION BY`、视图 `ALGORITHM`/`SQL SECURITY`、`utf8mb4_0900_*`、`JSON_EXTRACT`、`FOUND_ROWS`、EVENT）。AI 在线转换提示词与本地规则使用同一份支持/不支持清单。目标自带 **plmysql** 过程语言：单条 `RETURN` 表达式的函数原样保留；带 `BEGIN...END` 的函数、存储过程、触发器用 `LANGUAGE plmysql` 外壳，过程体保留 MySQL 写法（`SET`、`ELSEIF`、`DATE_FORMAT` 等），只修正循环、标签、`SIGNAL`、游标 handler 等差异。连接测试显示 `PostgreSQL 14.23`；执行仍走 MySQL 协议端口。
- **HGDB-V9-Oracle 目标**：连接 Oracle 兼容模式实例（例如 `198.51.100.10:1521`，库 `highgo`，用户 `highgo`），任务里兼容模式默认打开；执行走 PostgreSQL 协议，与 HGDB-V9-PostgreSQL 相同的执行器。若实例只开放了 MySQL 协议端口，请改用 HGDB-V9-MySQL 连接。

## 目录

```
hgdb-convert-studio/
  cordis.patch.yml          预设声明（智能体 + 工具 + 技能目录）
  locale/{en,zh}.json       显示名称与说明
  docs/DETAIL.md            插件详情页
  drivers/                  postgresql.jar / oracle.jar / mysql.jar
  tools/                    ConnTest / ReadObjects / ReadMysqlObjects / SqlRunner 等
  skills/oracle-to-hgdb/    Oracle 转换规则库（SKILL.md + references + scripts + templates）
  skills/mysql-to-hgdb/     MySQL 转换规则库（SKILL.md）
```

## 能力边界

- 兼容模式按「实测为准」：目标端已启用 Oracle 兼容模式时优先保留 Oracle 写法，但每条都需用 `scripts/probe-hgdb.sql` 验证；未验证的能力走 HGDB V9 标准写法。
- 转换是「语义等价改写」，不是机械替换：自治事务、提交语义、空串与 NULL、ROWNUM 求值时机、包级状态等都需要人工复核。
- MySQL 本地规则只做机械改写：`ON UPDATE CURRENT_TIMESTAMP`、`ENUM`/`SET`、`FULLTEXT`/`SPATIAL` 索引、分区、存储过程/函数/触发器/EVENT 的过程体会给出 TODO 与风险提示，需要用「AI在线转换」或人工改写；`BIGINT UNSIGNED` 会缩到有符号范围，需确认取值。
- 智能体不会在生产库执行 DDL/DML；连库验证只在用户确认的测试库进行。

## 第三方组件

`drivers/` 下的 JDBC 驱动用于在 Host 侧直连数据库，版权归各自厂商所有：

| 文件 | 组件 | 许可证 |
| --- | --- | --- |
| `drivers/postgresql.jar` | PostgreSQL JDBC Driver | BSD-2-Clause |
| `drivers/mysql.jar` | MySQL Connector/J | GPL-2.0 + FOSS Exception |
| `drivers/oracle.jar` | Oracle JDBC Driver (ojdbc) | Oracle Free Use Terms and Conditions，以 jar 内随附条款为准 |

本项目的 MIT 许可证只覆盖仓库自身代码，不改变上述组件各自的许可条款。若要再分发或用于商业产品，请自行确认对应驱动的授权是否适用。

## 许可证

[MIT](LICENSE) © 2026 qiuzhenchao

## 语言 / Language

界面支持**中文与英文**切换，覆盖工作台、任务中心、连接管理、系统设置与转换报告的**全部文案**（含规则名称、执行状态、导出报告表头）。

- **右上角地球图标**：一键切换中/英，图标旁显示当前语言（`中` / `EN`）；
- **系统设置 → 外观 → 语言**：中文 / English 分段按钮；
- 选择保存在本机（`localStorage` 的 `hgdb-convert-studio.lang.v1`），刷新与重开都保持；
- 未在字典中的文案会回退到宿主语言，不会出现空白。

AI 转换提示词保持中文（属于模型指令，不影响界面语言）。
