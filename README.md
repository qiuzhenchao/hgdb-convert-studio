# PLSQL Studio

PLSQL Studio 是 Oracle / MySQL → HGDB V9 的转换智能体与整页工作台：把 Oracle 或 MySQL 数据库对象转换为瀚高 HGDB V9 语法。覆盖：

- 函数、存储过程、包（规范 + 包体）、匿名块
- 视图、物化视图
- 触发器（行级/语句级/INSTEAD OF/事件触发器转换）
- 建表、约束、索引、序列、同义词、注释、权限
- 同义词：目标端支持 `CREATE [OR REPLACE] SYNONYM`；转换时会把 Oracle 的 `"TEST"."SYN_X"` 归一成小写 `test.syn_x`
- 定时任务（DBMS_SCHEDULER JOB：读取时还原为 `CREATE_JOB` 脚本；目标端无 DBMS_SCHEDULER，需改写为 pgAgent / pg_cron）
- 查询与 DML 方言：DUAL、ROWNUM、CONNECT BY、DECODE/NVL、`(+)` 外连接、MERGE、LISTAGG、KEEP、PIVOT、分析函数等
- **MySQL 源**：表、视图、函数、存储过程、触发器、EVENT；本地规则改写反引号、数据类型、AUTO_INCREMENT→IDENTITY、ENGINE/CHARSET/COLLATE 表选项、表/列注释、UNIQUE KEY/普通索引、外键、ON UPDATE CURRENT_TIMESTAMP；查询方言覆盖 IFNULL、NOW()、LIMIT m,n、GROUP_CONCAT、ON DUPLICATE KEY、REPLACE INTO、REGEXP 等

## 安装

1. 克隆本仓库到任意目录：

   ```bash
   git clone https://github.com/qiuzhenchao/plsqlstudio.git
   ```

2. 在 DSH 的 **插件** 页选择该目录安装（`plsqlstudio/`，即含 `package.json` 的那一层）；
   或由 agent 调用 `plugin_manager` 的 `install_bundle`，target 指向该目录的绝对路径。
3. 重启 DSH（或刷新页面）后：
   - 新会话的智能体选择器里出现 **PLSQL Studio**；
   - 侧边栏出现 **PLSQL Studio** 入口，打开整页转换工作台；
   - **设置 → PLSQL Studio** 保留同一套表单的快捷入口。

本 bundle 链接安装（link），修改 `skills/` 下的规则文件后新会话立即生效，无需重装。

## 产品总览首页

打开侧边栏 **PLSQL Studio** 先进入产品总览，而不是直接落到 SQL 编辑器。首页铺满主区域宽度（超宽屏上限 1800px），不再使用固定窄栏：

- **主视觉**：深色渐变、转换轨道与实时转换控制台，展示 Oracle / MySQL → HGDB 的改写示例；
- **指标卡**：转换任务（本地 / 源库）、已连接数据库、累计转换对象、SQL 转换成功率；
- **趋势图**：近 7 天 / 近 30 天可切换，已完成与待复核双序列；
- **转换链路**：源端、转换引擎、目标端的连接与规则库状态；
- **最近转换**：直接点任务回到对应文件。

「任务中心」的「新建任务」先打开任务向导（名称 → 来源与目标 → 对象类型 → 兼容模式），保存后进入编辑器；「进入工作台」与「最近任务」直接回到编辑器。首页主视觉只保留标题与说明，不再放新建按钮。首次使用且没有连接/文件时展示带「演示数据」标记的示例数据，添加连接或完成转换后自动切换为真实数据。

顶部「项目总览 / 任务中心 / 任务详情 / 连接管理」是真正的标签切换：

- **任务中心**：右上角「新建任务」按三步配置转换任务——① 任务名称 + 来源方式（源库读取 / 本地 SQL）、源库与目标库（目标库可选）、目标 schema；② 勾选要读取的对象类型（表、视图、物化视图、函数、过程、包、包体、触发器、类型、序列、同义词、定时任务 JOB）；③ 兼容模式与摘要确认：兼容模式是单选（PostgreSQL / Oracle / MySQL / SQL Server，默认 PostgreSQL），未选目标库时可自由选择，选定目标库后自动锁定为目标库对应的模式。本地 SQL 任务无需在向导里提前填写 SQL，保存后会创建空白 SQL 文件（按任务内序号命名：`SQL-01.sql`、`SQL-02.sql`…，不再沿用任务名），进入工作台后再导入文件或直接粘贴（也可同时使用）。保存后任务立即进入工作台，源库任务会按所选类型读取对象；任务列表按状态、进度、对象类型与兼容模式跟踪，并用「获取 → 转换 → 执行」步骤条逐条显示每条任务各阶段是否完成（源库任务才有「获取」，配了目标库才有「执行」）；重新「读取」源库会清空该任务的旧对象 SQL 并按源库对象重建，修改任务配置（源库、目标库、schema、兼容模式、读取类型）会清空该任务的转换与执行结果，步骤条回到未完成，避免拿旧结果当新状态，支持读取、编辑、删除；
- **连接管理**：整页维护源端/目标端连接，不再占用弹窗。

顶栏右侧可切换**深色 / 浅色主题**（默认浅色，选择记忆在本机），两套主题覆盖首页、工作台与各标签页。

## 转换工作台（整页）

侧边栏 **PLSQL Studio**（`sidebar.panellist` + `main`）打开整页工作台，三栏布局：

- **顶部操作**：右侧「转换 / 执行 / 导出」作用于当前任务下的全部 SQL（多个结果一起导出时打包成一个 zip，只弹一次保存框；单个文件仍是 `.converted.sql`）；顶部标签页（总览 / 任务中心 / 任务详情 / 连接管理）会记住上次停留的页面；
- **左列 SQL 列表**：**任务选择**（来自「任务中心」的转换任务，选中后自动带出源库、目标库、目标 schema、对象类型与兼容模式）、转换状态与对象类型过滤；源库任务可「读取」对象 DDL（对象清单一条查询取回，DDL 用 6 路并行抓取；系统 schema 与 `DBMS_`/`ORA_`/`UTL_` 等系统对象会被排除），并按对象类型分组；删除任务会同时删除任务下的 SQL；
- **中列 源 SQL**：行号编辑器，可重命名/删除/导入/复制，点「本地转换」按本地规则转换当前文件；
- **右列 转换结果**：行号只读结果，可「执行」到目标库（未指定目标库时执行禁用）、复制或导出当前结果，或用「AI在线转换（智能体）」做语义级改写；
- **底部状态条**：状态消息与目标连接名。编辑源 SQL 会自动清空状态，避免展示过期结果。

「连接管理」是顶栏标签页，页面按**左右两栏**组织：左栏源库（Oracle / MySQL）、右栏目标库（HGDB-V9-PostgreSQL / Oracle / MySQL），各自带新增按钮，新增时只显示该侧可选类型。可新增/编辑/删除连接并测试：所有类型都走 Host 侧的 JDBC 真实登录；驱动（`drivers/postgresql.jar`、`drivers/oracle.jar`、`drivers/mysql.jar`）和预编译的 `tools/classes/*.class` 都随插件打包，Host 相对插件目录解析，不依赖本机安装路径。目标机器只需 **Java 8+ 运行时**（不需要 JDK）。密码用 **AES-GCM** 加密后保存在本机 localStorage，密钥是 IndexedDB 里的不可导出 CryptoKey（旧版本的明文密码首次加载时自动加密迁移）；密码不会上传到转换会话。

源端连接类型可选 Oracle 或 MySQL。MySQL 的「数据库/服务名」填库名，读取时按 `information_schema` + `SHOW CREATE ...` 抽取表、视图、函数、过程、触发器与事件，并按外键依赖排序表；「默认 schema」留空时用库名。任务向导会按源库类型列出可读对象（MySQL 没有包、类型、序列、同义词），并固定按 HGDB 标准写法转换（MySQL 源没有 Oracle 兼容模式）。

目标端拆成三种 HGDB V9 形态：

- **HGDB-V9-PostgreSQL**：标准 PostgreSQL 协议实例（例如 `5432`，用户 `postgres`）。转换默认关闭兼容模式，按 HGDB 标准写法输出。
- **HGDB-V9-Oracle**：启用了 Oracle 兼容模式（`ivorysql_ora` 等扩展）的 HGDB 实例（例如 `1521`，库 `highgo`，用户 `highgo`）。仍用 **PostgreSQL 协议**连接；任务默认开启兼容模式，保留 NVL/DECODE/ROWNUM/PACKAGE 等 Oracle 写法。
- **HGDB-V9-MySQL**：用 MySQL 驱动连接 HGDB 的 **MySQL 协议**端口（例如 `33069`，用户 `mysql`，数据库即默认 schema，如 `mysql`）。SQL 仍由 HGDB 按 PostgreSQL 语法解析，执行路径与普通 HGDB 目标等价。

三种目标的连接测试都会显示真实内核版本（如 `连接成功（PostgreSQL 14.23）`）。注意 HGDB-V9-MySQL 与「MySQL」源是两回事：MySQL 源是真正的 MySQL，HGDB-V9-MySQL 是 HGDB 目标端。

**设置 → PLSQL Studio**（settings.section）仍保留一个精简表单，可把请求直接交给会话执行；它和新页面共用同一份提示词与同一个智能体。

## 使用

- **目录批量**：把 `exp`/`DBMS_METADATA` 导出的 `.sql` 放进一个目录，告诉它目录路径与目标 schema；它按依赖顺序转换，输出 `converted/` 与 `CONVERSION_REPORT.md`。
- **单文件/粘贴**：直接把 SQL 贴进对话，要求转换即可；确认后再落盘。
- **Oracle 源库抽取**：本机装有 SQL*Plus 时，可用 `skills/oracle-to-hgdb/scripts/extract-oracle.ps1` 抽取 DDL/PLSQL，再交给智能体转换。DSH 的 `dsh-sql` 没有 Oracle 驱动，不能直连 Oracle。
- **MySQL 源库抽取**：在工作台「连接管理」新增 MySQL 连接后，任务里直接「读取」即可（Host 侧 JDBC 读取 `SHOW CREATE ...`）。目标为 HGDB-V9-MySQL 时走最小改写；其他目标走完整的 PG 化改写。
- **MySQL 本地转换识别**：源文件绑定 MySQL 连接时按 MySQL 规则转换；没有绑定连接时，含反引号、`ENGINE=`、`AUTO_INCREMENT` 或 MySQL 专有类型的 SQL 也会自动识别为 MySQL 源。
- **HGDB-V9-MySQL 目标**：目标选该类型（例如 `198.51.100.10:33069`）时采用**最小改写**：实测支持的 MySQL 写法（反引号、`AUTO_INCREMENT`、`ENGINE`/`CHARSET`、`ENUM`、`UNSIGNED`、`ON UPDATE CURRENT_TIMESTAMP`、`FULLTEXT`、`ON DUPLICATE KEY`、`LIMIT n,m` 等）原样保留；只改写实测不支持的部分（`SET` 类型、空间类型/`SPATIAL`、`PARTITION BY`、视图 `ALGORITHM`/`SQL SECURITY`、`utf8mb4_0900_*`、`JSON_EXTRACT`、`FOUND_ROWS`、复合过程/触发器/EVENT）。AI 在线转换提示词与本地规则使用同一份支持/不支持清单。连接测试显示 `PostgreSQL 14.23`；执行仍走 MySQL 协议端口。
- **HGDB-V9-Oracle 目标**：连接 Oracle 兼容模式实例（例如 `198.51.100.10:1521`，库 `highgo`，用户 `highgo`），任务里兼容模式默认打开；执行走 PostgreSQL 协议，与 HGDB-V9-PostgreSQL 相同的执行器。若实例只开放了 MySQL 协议端口，请改用 HGDB-V9-MySQL 连接。

## 目录

```
plsqlstudio/
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