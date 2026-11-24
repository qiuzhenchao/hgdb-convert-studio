window.__ModuleLoader__.load({
  id: '@local/dsh-plsqlstudio-preset',
  factory(require) {
    const React = require('react')
    const ReactDOM = (() => {
      try {
        return require('react-dom')
      } catch {
        return null
      }
    })()
    const h = React.createElement

    /**
     * 弹窗挂到应用根节点：DSH 的插槽容器可能带 transform/contain，
     * 直接 fixed 会以它为包含块导致偏左/偏高；portal 后按窗口正中显示。
     */
    function renderOverlay(node, theme) {
      if (node === null || node === undefined) return null
      if (typeof document === 'undefined') return node
      if (ReactDOM !== null && typeof ReactDOM.createPortal === 'function') {
        // 挂到 body 上，并带一层主题容器：既逃出插槽的 transform/contain，又保留主题变量。
        return ReactDOM.createPortal(
          h('div', {
            className: 'o2p-app',
            'data-theme': theme === 'dark' ? 'dark' : 'light',
          }, node),
          document.body,
        )
      }
      return node
    }

    const NS = 'plsqlstudio'
    const STORAGE_KEY = 'plsql-studio.state.v1'
    const THEME_KEY = 'plsql-studio.theme.v1'
    const DROP_STATEMENTS_KEY = 'plsql-studio.drop-statements.v1'

    function readDropStatements() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return false
        return window.localStorage.getItem(DROP_STATEMENTS_KEY) === '1'
      } catch {
        return false
      }
    }

    function saveDropStatements(value) {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return
        window.localStorage.setItem(DROP_STATEMENTS_KEY, value === true ? '1' : '0')
      } catch {
        /* best effort */
      }
    }

    function readTheme() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return 'light'
        return window.localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
      } catch {
        return 'light'
      }
    }

    function saveTheme(theme) {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return
        window.localStorage.setItem(THEME_KEY, theme)
      } catch {
        /* best effort */
      }
    }

    function readStoredState() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return {}
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (typeof raw !== 'string' || raw === '') return {}
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    function writeStoredState(patch) {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return false
        const next = { ...readStoredState(), ...patch }
        const raw = JSON.stringify(next)
        window.localStorage.setItem(STORAGE_KEY, raw)
        return raw
      } catch {
        return false
      }
    }

    function patchStoredFile(fileId, patch) {
      const stored = readStoredState()
      const list = Array.isArray(stored.files) ? stored.files : []
      if (list.length === 0) return
      let changed = false
      const next = list.map(file => {
        if (file === null || typeof file !== 'object' || file.id !== fileId) return file
        changed = true
        return { ...file, ...patch, updatedAt: Date.now() }
      })
      if (changed) writeStoredState({ files: next })
    }

    function pendingSessions() {
      const stored = readStoredState()
      return Array.isArray(stored.pendingSessions) ? stored.pendingSessions : []
    }

    function rememberSession(sessionId) {
      const list = pendingSessions()
      if (!list.includes(sessionId)) writeStoredState({ pendingSessions: [...list, sessionId] })
    }

    function forgetSession(sessionId) {
      writeStoredState({ pendingSessions: pendingSessions().filter(id => id !== sessionId) })
    }

    function markInflight(sessionId, fileId) {
      writeStoredState({
        inflight: {
          sessionId,
          ...(typeof fileId === 'string' ? { fileId } : {}),
          at: Date.now(),
        },
      })
    }

    function clearInflight() {
      writeStoredState({ inflight: null })
    }

    function inflightState() {
      const stored = readStoredState()
      const value = stored.inflight
      if (value === null || typeof value !== 'object') return undefined
      if (typeof value.sessionId !== 'string' || typeof value.at !== 'number') return undefined
      if (Date.now() - value.at > 30 * 60 * 1000) return undefined
      return {
        sessionId: value.sessionId,
        fileId: typeof value.fileId === 'string' ? value.fileId : undefined,
      }
    }

    // ==== 进行中的作业（读取 / 转换 / 执行）：落盘以便切换界面或重挂载后还能继续显示 ====
    // 单独一个 key：便于低成本轮询，不用反复解析整份 files 快照。
    const JOB_KEY = 'plsql-studio.job.v1'
    const JOB_CANCEL_KEY = 'plsql-studio.job-cancel.v1'
    const PAGE_SESSION_KEY = 'plsql-studio.page-session.v1'

    /** 当前页面会话 id：区分“切换视图后恢复”和“DSH 重启后不应复活”。 */
    function readPageSession() {
      try {
        if (typeof window === 'undefined' || !window.sessionStorage) return ''
        let id = window.sessionStorage.getItem(PAGE_SESSION_KEY)
        if (typeof id !== 'string' || id === '') {
          id = `page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          window.sessionStorage.setItem(PAGE_SESSION_KEY, id)
        }
        return id
      } catch {
        return ''
      }
    }
    const PAGE_SESSION = readPageSession()

    /** 终止标记（跨标签页/实例共享）：执行循环每次迭代都会检查。 */
    function readJobCancelStamp() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return 0
        return Number(window.localStorage.getItem(JOB_CANCEL_KEY) ?? 0) || 0
      } catch {
        return 0
      }
    }

    function requestJobCancel() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return
        window.localStorage.setItem(JOB_CANCEL_KEY, String(Date.now()))
      } catch {
        /* best effort */
      }
    }
    const JOB_STALE_MS = { read: 5 * 60 * 1000, convert: 2 * 60 * 1000, execute: 2 * 60 * 1000 }
    const JOB_KINDS = ['read', 'convert', 'execute']

    function readJobState() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return null
        const raw = window.localStorage.getItem(JOB_KEY)
        if (typeof raw !== 'string' || raw === '') return null
        const value = JSON.parse(raw)
        if (value === null || typeof value !== 'object') return null
        if (!JOB_KINDS.includes(value.kind)) return null
        if (typeof value.startedAt !== 'number') return null
        return {
          kind: value.kind,
          startedAt: value.startedAt,
          heartbeat: typeof value.heartbeat === 'number' ? value.heartbeat : value.startedAt,
          done: typeof value.done === 'number' ? value.done : 0,
          total: typeof value.total === 'number' ? value.total : 0,
          taskId: typeof value.taskId === 'string' ? value.taskId : '',
          label: typeof value.label === 'string' ? value.label : '',
        }
      } catch {
        return null
      }
    }

    function writeJobState(job) {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return
        if (job === null || job === undefined) window.localStorage.removeItem(JOB_KEY)
        else window.localStorage.setItem(JOB_KEY, JSON.stringify(job))
      } catch {
        /* best effort */
      }
    }

    function jobIsStale(job) {
      if (job === null) return true
      const limit = JOB_STALE_MS[job.kind] ?? 2 * 60 * 1000
      return Date.now() - (job.heartbeat ?? job.startedAt) > limit
    }

    const CONNECTIONS_KEY = 'plsql-studio.connections.v1'

    function loadConnections() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return []
        const raw = window.localStorage.getItem(CONNECTIONS_KEY)
        if (typeof raw !== 'string' || raw === '') return []
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed.filter(item => item !== null && typeof item === 'object'
          && typeof item.id === 'string' && typeof item.name === 'string')
      } catch {
        return []
      }
    }

    /* ===== 连接密码的本地加密存储 =========================================
     * localStorage 只保存 AES-GCM 密文；密钥是 IndexedDB 里的不可导出 CryptoKey。
     * 这不是系统钥匙串，但可避免明文密码随 localStorage 备份、截图或同步泄露。
     */
    const CONNECTION_KEY_DB = 'plsql-studio.crypto'
    const CONNECTION_KEY_STORE = 'keys'
    const CONNECTION_KEY_ID = 'connections'
    let connectionKeyPromise

    function openConnectionKeyDb() {
      return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
          reject(new Error('IndexedDB unavailable'))
          return
        }
        const request = indexedDB.open(CONNECTION_KEY_DB, 1)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(CONNECTION_KEY_STORE)) db.createObjectStore(CONNECTION_KEY_STORE)
        }
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
      })
    }

    function idbGet(db, key) {
      return new Promise((resolve, reject) => {
        const request = db.transaction(CONNECTION_KEY_STORE, 'readonly').objectStore(CONNECTION_KEY_STORE).get(key)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'))
      })
    }

    function idbPut(db, key, value) {
      return new Promise((resolve, reject) => {
        const request = db.transaction(CONNECTION_KEY_STORE, 'readwrite').objectStore(CONNECTION_KEY_STORE).put(value, key)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error ?? new Error('IndexedDB write failed'))
      })
    }

    function connectionCrypto() {
      const webCrypto = typeof crypto === 'undefined' ? undefined : crypto
      return webCrypto !== undefined && webCrypto.subtle !== undefined ? webCrypto : undefined
    }

    /** 取（或创建）连接密码密钥；CryptoKey 不可导出，页面脚本只能使用、不能读出字节。 */
    function connectionKey() {
      if (connectionKeyPromise !== undefined) return connectionKeyPromise
      connectionKeyPromise = (async () => {
        const webCrypto = connectionCrypto()
        if (webCrypto === undefined) throw new Error('Web Crypto unavailable')
        const db = await openConnectionKeyDb()
        const existing = await idbGet(db, CONNECTION_KEY_ID)
        if (existing !== undefined && existing !== null) return existing
        const key = await webCrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
        await idbPut(db, CONNECTION_KEY_ID, key)
        return key
      })()
      connectionKeyPromise.catch(() => { connectionKeyPromise = undefined })
      return connectionKeyPromise
    }

    function bytesToBase64(bytes) {
      let binary = ''
      for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index])
      return btoa(binary)
    }

    function base64ToBytes(text) {
      const binary = atob(text)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      return bytes
    }

    async function encryptWithKey(text, key) {
      const webCrypto = connectionCrypto()
      const iv = webCrypto.getRandomValues(new Uint8Array(12))
      const cipher = await webCrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text))
      return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(cipher)) }
    }

    async function decryptWithKey(payload, key) {
      const webCrypto = connectionCrypto()
      const plain = await webCrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
        key,
        base64ToBytes(payload.data),
      )
      return new TextDecoder().decode(plain)
    }

    /** 持久化连接：密码加密后再写入 localStorage；失败返回 false，绝不回退明文。 */
    async function persistConnections(list) {
      if (typeof window === 'undefined' || !window.localStorage) return false
      const key = await connectionKey().catch(() => undefined)
      if (key === undefined) return false
      const stored = []
      for (const item of list) {
        const { password, passwordUnreadable, passwordSaved, ...meta } = item
        if (typeof password === 'string' && password !== '') {
          stored.push({ ...meta, passwordEnc: await encryptWithKey(password, key) })
        } else {
          stored.push(meta)
        }
      }
      try {
        window.localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(stored))
        return true
      } catch {
        return false
      }
    }

    /** 读出连接并在内存里解密；旧版本的明文密码顺手加密迁移。 */
    async function hydrateConnections(raw) {
      if (raw.length === 0) return raw
      const key = await connectionKey().catch(() => undefined)
      const next = []
      let migrate = false
      for (const item of raw) {
        const { passwordEnc, password, ...meta } = item
        if (passwordEnc !== undefined) {
          if (key === undefined) {
            next.push({ ...meta, password: '', passwordSaved: false, passwordUnreadable: true })
            continue
          }
          try {
            next.push({ ...meta, password: await decryptWithKey(passwordEnc, key), passwordSaved: true })
          } catch {
            next.push({ ...meta, password: '', passwordSaved: false, passwordUnreadable: true })
          }
        } else if (typeof password === 'string' && password !== '') {
          next.push({ ...item, passwordSaved: true })
          migrate = true
        } else {
          next.push({ ...meta, password: '', passwordSaved: false })
        }
      }
      if (migrate) await persistConnections(next)
      return next
    }

    const TASKS_KEY = 'plsql-studio.tasks.v1'
    const TASK_ORIGINS = ['source', 'local', 'sql']

    function loadTasks() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return []
        const raw = window.localStorage.getItem(TASKS_KEY)
        if (typeof raw !== 'string' || raw === '') return []
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed.filter(item => item !== null && typeof item === 'object'
          && typeof item.id === 'string' && typeof item.name === 'string'
          && TASK_ORIGINS.includes(item.origin))
          .map(item => ({ ...item, status: item.status === 'reading' ? 'new' : item.status }))
      } catch {
        return []
      }
    }

    function saveTaskList(list) {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return
        window.localStorage.setItem(TASKS_KEY, JSON.stringify(list))
      } catch {
        /* persistence is best effort */
      }
    }

    const zh = {
      nav: 'PLSQL Studio',
      title: 'PLSQL Studio',
      subtitle: '把 Oracle 函数、存储过程、包、视图、触发器、匿名块交给 plsqlstudio 智能体转换。',
      intro: '填好下面的输入，点击「在新会话中转换」。智能体会在新会话里按同一套转换规则处理，转换过程和结果都在会话中，可以继续追问、让它落盘。',
      mode: '输入方式',
      single: '单个对象',
      batch: '批量目录',
      objectType: '对象类型',
      auto: '自动识别',
      fn: '函数 FUNCTION',
      proc: '存储过程 PROCEDURE',
      pkg: '包 PACKAGE',
      view: '视图 VIEW',
      mview: '物化视图',
      trigger: '触发器 TRIGGER',
      table: '建表/DDL 脚本',
      block: '匿名块 / PLSQL 片段',
      schema: '目标 schema',
      schemaEmpty: '没有可用的模式',
      schemaHint: '留空表示沿用源 schema',
      compat: '目标端已启用兼容模式',
      compatHint: '启用后优先保留源端语法；未确认的写法仍按 HGDB V9 标准处理。',
      sourceSql: '源',
      sqlPlaceholder: '粘贴 Oracle 函数、过程、包、视图或触发器的完整定义……',
      srcDir: '源目录',
      srcDirHint: '例如 D:\\migration\\src（由 SQL*Plus 抽取或已有的 .sql 目录）',
      outDir: '输出目录',
      outDirHint: '默认 converted',
      preview: '提示词预览',
      previewHint: '这是将要发送给智能体的完整请求，可展开检查或复制。',
      convert: '开始转换',
      copy: '复制提示词',
      sample: '填入示例',
      clear: '清空',
      chars: '字符',
      needInput: '请先填写源内容。',
      startFailed: '启动新会话失败：',
      copied: '提示词已复制。',
      copyFailed: '复制失败，请手动选中提示词复制。',
      storageWriteFailed: '本地存储写入失败（可能已满），刚才的改动没有保存；请先导出内容再清理旧任务。',
      sampleLoaded: '已填入示例函数。',
      flowHint: '会话会自动选中「PLSQL Studio」智能体，并把这段请求填进输入框；按回车开始。',
      preset: '智能体：plsqlstudio',
      pageTitle: 'PLSQL Studio',
      welcomeTitle: '开始 Oracle → HGDB 转换',
      welcomeSub: '读取源库对象，或直接粘贴/载入示例 SQL 开始',
      welcomeRead: '读取源库',
      welcomeSample: '载入示例',
      welcomeNew: '新建 SQL',
      introText: '多源（Oracle / MySQL / SQL Server）SQL 转换到 HGDB V9 的工作台；按任务组织，选择任务即可带出连接与配置',
      introChipRead: '源库读取',
      introChipConvert: '本地 / AI在线转换',
      introChipExec: '目标库执行',
      statusReady: '就绪',
      linesUnit: '行',
      paneInput: '输入',
      paneRequest: '转换摘要',

      batchEmptyHint: '批量模式按目录处理：智能体会读取源目录下的 .sql 文件，按依赖顺序转换并写入输出目录。',
      summaryMode: '输入方式',
      summaryObject: '对象类型',
      summarySchema: '目标 schema',
      summaryCompat: '兼容模式',
      summaryInput: '输入',
      summaryOutput: '预期产出',
      summaryAgent: '执行智能体',
      compatOn: '已启用',
      compatOff: '未启用',
      schemaInherit: '沿用源 schema',
      outputSingle: '转换后的 SQL、变更说明表与人工复核点',
      outputBatch: 'converted/ 目录与 CONVERSION_REPORT.md',
      converting: '转换中',
      convertDone: '转换成功',
      convertFailed: '转换失败',
      resultTitle: '转换结果',
      quickConvertLocal: '快速转换（本地）',
      deepConvert: 'AI在线转换',
      localWarnings: '需人工复核',
      'warn.package': 'PACKAGE 需拆分为函数/过程',
      'warn.trigger': 'TRIGGER 需改写',
      'warn.connectBy': 'CONNECT BY 需改为递归 CTE',
      'warn.outerJoin': '(+) 外连接需改为 JOIN',
      'warn.rownum': 'ROWNUM 需改为 LIMIT/窗口函数',
      'warn.decode': 'DECODE 需改为 CASE',
      'warn.listagg': 'LISTAGG 需改为 STRING_AGG',
      'warn.pivot': 'PIVOT 需改为条件聚合',
      'warn.merge': 'MERGE 需按目标版本改写',
      'warn.autonomous': '自治事务无等价物',
      'warn.bulk': 'BULK COLLECT 需改写',
      'warn.commit': '过程内 COMMIT 需调整事务边界',
      'warn.needsAgent': '该对象超出本地规则范围',
      'warn.job': 'JOB 目标端无 DBMS_SCHEDULER，需改写为 pgAgent / pg_cron',
      'warn.unsigned': 'UNSIGNED 已提升为更大的有符号类型，需确认取值范围',
      'warn.onUpdate': 'ON UPDATE CURRENT_TIMESTAMP 需用 BEFORE UPDATE 触发器实现',
      'warn.enum': 'ENUM 已转为 text + CHECK，需确认取值',
      'warn.set': 'SET 类型没有等价物，已转为 text',
      'warn.fulltext': 'FULLTEXT / SPATIAL 索引未转换',
      'warn.partition': 'MySQL 分区定义未转换',
      'warn.prefixIndex': '前缀索引的前缀长度已去掉',
      'warn.zeroDate': '零日期默认值需替换为合法时间或 NULL',
      'warn.routine': 'MySQL 例程过程体需 AI / 人工改写',
      'warn.event': 'EVENT 需改写为 pgAgent / pg_cron',
      'warn.groupConcat': 'GROUP_CONCAT 需改为 STRING_AGG',
      'warn.dateFormat': 'DATE_FORMAT 需改为 TO_CHAR',
      'warn.strToDate': 'STR_TO_DATE 需改为 TO_TIMESTAMP',
      'warn.onDuplicate': 'ON DUPLICATE KEY 需改为 ON CONFLICT',
      'warn.insertIgnore': 'INSERT IGNORE 需改为 ON CONFLICT DO NOTHING',
      'warn.replaceInto': 'REPLACE INTO 需改为 ON CONFLICT',
      'warn.regexp': 'REGEXP 需改为 ~',
      'warn.div': 'DIV 需改为 / 或 div()',
      'warn.userVariable': 'MySQL 用户变量 @x 无等价物',
      'warn.backslashEscape': '反斜杠转义字符串需逐条核对',
      'warn.delimiter': 'DELIMITER 指令已忽略',
      'warn.useDatabase': 'USE 语句已注释，目标 schema 由任务配置决定',
      'warn.session': '会话级语句已注释',
      'warn.unknownType': '存在未识别的 MySQL 数据类型',
      'warn.createSchema': 'CREATE DATABASE 已改写为 CREATE SCHEMA',
      manage: '管理连接',
      connectionsTitle: '连接管理',
      connName: '名称',
      connKind: '类型',
      connHost: '主机',
      connPort: '端口',
      connDatabase: '数据库/服务名',
      connUser: '用户名',
      connPassword: '密码',
      showPassword: '显示密码',
      hidePassword: '隐藏密码',
      connTest: '测试连接',
      connTesting: '测试中…',
      connSchema: '默认 schema',
      connSchemaPlaceholder: '留空使用连接用户 / public',
      connSchemaOwnerPlaceholder: '留空使用登录用户（对象 owner）',
      connAdd: '新增连接',
      connSourceTitle: '源库',
      connTargetTitle: '目标库',
      connSourceHint: 'Oracle / MySQL，用于读取对象',
      connTargetHint: 'HGDB-V9-PostgreSQL / Oracle / MySQL，用于执行转换结果',
      connEmptySource: '还没有源库连接，点右上角新增',
      connEmptyTarget: '还没有目标库连接，点右上角新增',
      connEditTitle: '编辑连接',
      connDialogSub: '填写连接信息，测试通过后保存',
      connEdit: '编辑',
      connDelete: '删除',
      connSave: '保存',
      connSaved: '已保存连接',
      connSavedMemoryOnly: '连接已保存在内存，但密码无法加密持久化（浏览器缺少 Web Crypto / IndexedDB）；刷新后会要求重新输入密码',
      passwordUnreadable: '原保存的密码无法解密（浏览器密钥可能已丢失），请重新输入密码。',
      passwordSavedHint: '已保存密码',
      connCancel: '取消',
      confirm: '确定',
      cancel: '取消',
      confirmOk: '确定',
      connBack: '返回',
      connEmpty: '还没有连接',
      connKindOracle: 'Oracle',
      connKindHgdb: 'HGDB V9',
      connKindMysql: 'MySQL',
      connKindHgdbMysql: 'HGDB-V9-MySQL',
      connKindHgdbPostgresql: 'HGDB-V9-PostgreSQL',
      connKindHgdbOracle: 'HGDB-V9-Oracle',
      connSchemaForMysql: '默认 schema（库名）',
      copyResult: '复制',
      searchFiles: '搜索 SQL…',
      newSql: '新建',
      importSql: '导入',
      copySql: '复制',
      convertSyntax: '本地转换',
      onlineCompatKept: '兼容模式：已保留源端 Oracle 语法',
      rename: '重命名',
      convert: '转换',
      refetch: '重新获取',
      delete: '删除',
      exportResult: '导出',
      resultEmpty: '还没有转换结果，点「转换语法」生成。',
      sourceNotReadTitle: '还没有读取源对象',
      sourceNotReadHint: '源库读取模式下不支持手工粘贴 SQL：点上方「读取」从源库拉取对象后，这里才会出现对象列表。',
      sourceNotReadList: '尚未读取对象',
      searchNoMatch: '没有匹配的 SQL 文件',
      readConnUnreachable: '连不上源库：请检查主机/端口、防火墙或 VPN，并确认 Oracle 监听已启动、service_name/SID 正确。原始错误：{detail}',
      readAuthFailed: '源库用户名或密码不正确。原始错误：{detail}',
      readServiceMissing: '源库上的 service_name/SID 或数据库不存在。原始错误：{detail}',
      readMysqlPublicKey: 'MySQL 拒绝授权（需要 allowPublicKeyRetrieval）：请确认连接串使用 useSSL=false&allowPublicKeyRetrieval=true，或改用 caching_sha2_password 兼容账号。原始错误：{detail}',
      jobReadTitle: '正在读取源库对象',
      jobConvertTitle: '正在转换语法',
      jobExecuteTitle: '正在执行到目标库',
      jobStop: '终止执行',
      jobStopped: '已终止执行',
      jobProgress: '{done} / {total} 个对象',
      jobRestoredHint: '后台仍在进行，完成后会自动刷新',
      convertChecked: '转换',
      convertAll: '转换全部',
      exportChecked: '导出',
      exportAll: '导出全部',
      exportZipDone: '已导出 {count} 个文件，打包为 {name}',
      executeCurrent: '执行',
      execCurrentHint: '把当前文件的转换结果执行到目标库',
      execNoTarget: '未指定目标库，无法执行',
      executeChecked: '执行选中',
      executeAll: '执行全部',
      executing: '执行中…',
      execMissing: '请先在「管理连接」选择目标库连接',
      execNoSql: '没有可执行的转换结果',
      execDone: '执行完成：成功 / 失败',
      needsReview: '需人工复核',
      connNone: '不使用连接',
      sourceDb: '源端',
      sourceNone: '不使用源库',
      readTypes: '类别',
      selectAll: '全选',
      clearAll: '清空',
      read: '读取',
      reading: '正在读取源对象…',
      readObjects: '已读取 {count} 个对象',
      readSourceMissing: '请先选择源端',
      targetEnd: '目标端',
      readUnsupported: '暂不支持从 {engine} 读取对象',
      sourceConnMissing: '请先在「管理连接」中添加 {engine} 连接',
      filterConv: '转换',
      filterAll: '全部',
      filterDone: '已转换',
      filterPending: '未转换',
      filterWarn: '需复核',
      typeAll: '全部类型',
      typeUnspecified: '未指定',
      targetDb: '目标数据库',

      modeSql: 'SQL 文本',
      modeDir: '目录',
      pageSqlPlaceholder: '粘贴 Oracle SQL；或粘贴源目录（第二行可写输出目录）',

      homeNav: '项目总览',
      homeSettings: '系统设置',
      settingsTitle: '系统设置',
      settingsDesc: '主题、本地数据与版本信息',
      settingsAppearance: '外观',
      settingsTheme: '主题',
      settingsThemeHint: '浅色或深色，选择会保存在本机',
      settingsThemeLight: '浅色',
      settingsThemeDark: '深色',
      settingsConvertOptions: '转换选项',
      settingsDropTitle: '生成删除语句',
      settingsDropHint: '转换时在 CREATE 前生成 DROP ... IF EXISTS，便于目标库重复执行',
      settingsOn: '已开启',
      settingsOff: '已关闭',
      settingsData: '本地数据',
      settingsClearFetched: '清理获取的 SQL',
      settingsClearFetchedHint: '移除从源库读取的对象 SQL；任务、任务连接和本地导入/粘贴的 SQL 都会保留。',
      settingsClearFetchedConfirm: '确定清理所有从源库获取的对象 SQL？任务、连接与本地 SQL 会保留。',
      settingsClearedFetched: '已清理获取的 SQL',
      settingsClearConverted: '清理转换结果',
      settingsClearConvertedHint: '清空所有文件的转换与执行结果，保留 SQL 文本、任务与任务连接。',
      settingsClearConvertedConfirm: '确定清理所有转换与执行结果？SQL 文本、任务与连接会保留。',
      settingsClearedConverted: '已清理转换结果',
      settingsCleanupAction: '清理',
      settingsAbout: '关于',
      settingsVersion: '版本',
      homeStudio: '任务详情',
      homeConnections: '连接管理',
      navTasks: '任务中心',
      navHistory: '历史记录',
      explorerTitle: '任务资源管理器',
      explorerSelected: '已选择',
      explorerNoSource: '未选择源库',
      explorerRefresh: '刷新对象',
      tasksEyebrow: 'CONVERSION TASKS',
      tasksTitle: '任务中心',
      tasksDesc: '新建任务时选择源库、目标库、对象类型与兼容模式；任务详情直接选择任务，统一跟踪读取与转换进度',
      tasksTotal: '任务总数',
      tasksRunning: '进行中',
      tasksDone: '已完成',
      tasksPending: '待处理',
      tasksNew: '新建任务',
      tasksEmpty: '还没有转换任务，点击右上角「新建任务」开始。',
      tasksDemo: '演示任务',
      tasksOpen: '打开',
      taskWizardTitle: '新建转换任务',
      taskWizardEditTitle: '编辑转换任务',
      taskWizardSub: '取个名字，选择来源方式与目标库（可选），勾选要读取的对象类型，确认兼容模式后保存',
      taskStepBasic: '基本信息',
      taskStepTypes: '读取类型',
      taskStepCompat: '兼容与确认',
      taskName: '任务名称',
      taskNamePlaceholder: '例如：ERP 核心库 → HGDB V9',
      taskOrigin: '来源方式',
      taskSqlDialect: '源 SQL 类型',
      taskOriginSource: '源库读取',
      taskOriginSourceHint: '从源库读取对象 DDL',
      taskOriginLocal: '本地 SQL',
      taskOriginLocalHint: '保存后导入 .sql 或直接粘贴 SQL',
      taskOriginSql: 'SQL 文本',
      taskOriginSqlHint: '直接粘贴 SQL',
      taskSource: '源库',
      taskTarget: '目标库',
      taskTargetOptional: '目标库（可选）',
      taskSourcePlaceholder: '选择源库连接',
      taskTargetPlaceholder: '选择目标库（可不选）',
      taskTargetUnset: '未指定目标库',
      taskMissingConn: '连接已删除',
      taskSchema: '目标 schema（可选）',
      taskNoSourceConn: '还没有 Oracle 源库连接。',
      taskNoTargetConn: '还没有目标库连接，请先到「连接管理」添加。',
      taskGoConnections: '去添加连接',
      taskPickFiles: '选择 SQL 文件',
      taskPickedFiles: '已选择 {count} 个文件',
      taskNoFilePicked: '还没有选择文件',
      taskKeepFiles: '不重新选择文件时，任务下已有的 SQL 会保留；新选择的文件会追加。',
      taskSqlLabel: 'SQL 内容',
      taskSqlPlaceholder: '粘贴要转换的 Oracle SQL……',
      taskTypesTitle: '要读取的对象类型',
      taskTypesHint: '仅「源库读取」需要：读取时只拉取勾选的类型。本地文件与 SQL 文本会直接进入工作台。',
      taskTypesHintMysql: 'MySQL 源可读取表、视图、函数、过程、触发器与事件；没有包、类型、序列、同义词。',
      taskCompatMysqlNote: 'MySQL 源没有 Oracle 兼容模式：转换固定按 HGDB V9 标准写法处理，自增列改写为 GENERATED BY DEFAULT AS IDENTITY。',
      taskCompatOracleTargetNote: '目标 HGDB-V9-Oracle 默认开启 Oracle 兼容模式：保留 NVL/DECODE/ROWNUM/PACKAGE 等写法，只有实测不支持的语法才做最小改写并标注。',
      taskCompatNotApplicable: '不适用（MySQL 源）',
      taskTypesCount: '{count} 类',
      taskCompatTitle: '目标端已启用 Oracle 兼容模式',
      taskCompatDesc: '启用后优先保留 Oracle 写法；未验证的语法仍按 HGDB V9 标准改写。',
      taskCompatModeTitle: '目标兼容模式',
      taskCompatLocked: '已选择目标库，兼容模式与目标库一致，不能单独修改。',
      taskCompatUnlockedHint: '未选择目标库时可单独指定兼容模式；选择目标库后会锁定为目标库对应的模式。',
      compatModePostgresql: 'PostgreSQL 兼容模式',
      compatModeOracle: 'Oracle 兼容模式',
      compatModeMysql: 'MySQL 兼容模式',
      compatModeSqlserver: 'SQL Server 兼容模式',
      compatModePostgresqlHint: '按 HGDB / PostgreSQL 标准写法转换',
      compatModeOracleHint: '目标按 Oracle 兼容模式执行',
      compatModeMysqlHint: '目标按 MySQL 兼容模式执行',
      compatModeSqlserverHint: '目标按 SQL Server 兼容模式执行',
      taskSummary: '任务摘要',
      taskSummaryOrigin: '来源',
      taskSummaryTarget: '目标库',
      taskSummarySchema: '目标 schema',
      taskSummaryTypes: '对象类型',
      taskSummaryCompat: '兼容模式',
      taskCompatOn: '兼容已开启',
      taskCompatOff: '兼容未开启',
      taskObjects: '{count} 个对象',
      taskObjectsOne: '1 个对象',
      taskTypesOne: '1 类',
      taskSchemaInherit: '沿用源 schema',
      taskTypesNotNeeded: '无需读取',
      taskBack: '上一步',
      taskNext: '下一步',
      taskSave: '保存任务',
      taskSaveEdit: '保存修改',
      taskDelete: '删除任务',
      taskDeleteConfirm: '删除任务「{name}」及其下的全部 SQL？该操作不可撤销。',
      taskSelectLabel: '任务',
      taskSelectPlaceholder: '选择任务',
      explorerNoTask: '未选择任务',
      execNeedsTask: '请先选择或创建转换任务，再执行到目标库',
      welcomeTaskTitle: '从一次转换任务开始',
      welcomeTaskSub: '任务详情按任务工作：选择任务后会自动带出源库、目标库、对象类型与兼容模式',
      taskRead: '读取对象',
      taskEdit: '编辑任务',
      taskStepFetch: '获取',
      taskStepConvert: '转换',
      taskStepExecute: '执行',
      taskStepFetchHint: '从源库读取对象 DDL',
      taskStepConvertHint: '把源 SQL 转换为目标端语法',
      taskStepExecuteHint: '在目标库执行转换结果',
      taskOpen: '打开任务',
      taskSaved: '任务已保存',
      taskReadStarted: '正在读取「{name}」…',
      sqlserverNeedsAi: 'SQL Server 本地规则暂未支持，请对该文件使用「AI 在线转换」',
      mysqlRoutineNeedsAi: '存储过程/触发器/事件在 MySQL 兼容目标需要「AI 在线转换」（本地仅做最小改写）',
      taskReadDone: '已读取 {count} 个对象',
      taskNeedName: '请填写任务名称。',
      taskNeedSource: '请选择源库连接。',
      taskNeedTarget: '请选择目标库连接。',
      taskNeedFiles: '请至少选择一个 SQL 文件。',
      taskNeedSql: '请粘贴 SQL 内容。',
      taskNeedLocal: '请选择 SQL 文件，或粘贴 SQL 内容。',
      taskNeedTypes: '请至少勾选一种对象类型。',
      objTable: '表',
      objView: '视图',
      objMatView: '物化视图',
      objFunction: '函数',
      objProcedure: '存储过程',
      objPackage: '包',
      objPackageBody: '包体',
      objTrigger: '触发器',
      objType: '类型',
      objSequence: '序列',
      objSynonym: '同义词',
      objJob: '定时任务',
      objEvent: '事件',
      historyEyebrow: 'ACTIVITY HISTORY',
      historyTitle: '历史记录',
      historyDesc: '按任务汇总转换与执行记录',
      historyTime: '最后活动',
      historyActionConvert: '转换',
      historyActionExecute: '执行',
      historyActionBoth: '转换 + 执行',
      historyObject: '任务',
      historyTarget: '目标',
      historyResult: '结果',
      historyDuration: '累计耗时',
      historyStatusDone: '已完成',
      historyStatusPartial: '有失败',
      historyStatusRunning: '进行中',
      historyEmpty: '还没有任务活动记录。',
      historyDemo: '演示记录',
      historyDemoMeta1: 'Oracle ERP → HGDB V9 · 1,248 个对象',
      historyDemoMeta2: '财务库 → HGDB V9 · 356 个对象',
      historyDemoMeta3: '库存库 → HGDB V9 · 84 个对象',
      historyConverted: '转换成功',
      historyFailed: '转换失败',
      historyExecOk: '执行成功',
      historyExecFailed: '执行失败',
      homePro: 'PRO',
      homeTagline: '跨异构数据库智能转换工作台',
      homeEngineReady: '转换引擎已就绪',
      homeEyebrow: 'DATABASE CONVERSION WORKSPACE',
      homeTitleA: '让数据库转换',
      homeTitleB: '更简单',
      homeDesc: '统一连接 · SQL 转换 · 转换执行 · 结果验证',
      homeNewTask: '新建转换任务',
      homeManageConn: '管理数据库连接',
      homeConsoleTitle: 'CONVERSION CONSOLE',
      homeConsoleRunning: 'RUNNING',
      homeConsoleBefore: 'BEFORE',
      homeConsoleAfter: 'AFTER',
      homeConsoleFoot: '已转换对象',
      homeConsoleNote: '本地规则校验通过',
      homeConsolePending: '{count} 项待复核',
      homeSource: '源数据库',
      homeTarget: '目标数据库',
      homeSourceValue: 'Oracle 11g',
      homeTargetValue: 'HGDB V9',
      homeDemoChip: '演示数据',
      homeDemoHint: '还没有真实连接或转换记录，当前展示示例数据；添加连接或完成转换后会自动切换为真实数据。',
      homeStatConnections: '已连接数据库',
      homeStatConnectionsFoot: '{sources} 个源端 · {targets} 个目标端',
      homeStatTasks: '转换任务',
      homeStatTasksFoot: '本地 {local} 个 · 源库 {source} 个',
      homeStatTasksNone: '还没有转换任务',
      homeStatObjects: '累计转换对象',
      homeStatObjectsFoot: '覆盖 {types} 种对象类型',
      homeStatSuccess: 'SQL 转换成功率',
      homeStatSuccessFoot: '基于历史转换记录',
      homeStatSuccessNone: '还没有转换记录',
      homeStatLive: '实时',
      homeTrendTitle: 'SQL 转换趋势',
      homeTrendSub: '近 7 天完成与待复核的转换量',
      homeTrendSub30d: '近 30 天完成与待复核的转换量',
      homeTrend7d: '近 7 天',
      homeTrend30d: '近 30 天',
      homeTrendDone: '已完成',
      homeTrendReview: '待复核',
      homeTrendEmpty: '还没有转换记录，打开工作台转换第一个 SQL。',
      homeTrendNoTimestamps: '已有历史转换，但旧记录没有时间戳；完成一次新转换后即可生成趋势。',
      homeTrendGo: '去转换',
      homeTrendPeak: '峰值',
      homeSideTitle: '本周概况',
      homeSideRecentTitle: '最近转换',
      homeSideRecentEmpty: '暂无转换记录',
      homeSideRecentMore: '查看全部',
      homeSideTotal: '转换总量',
      homeSidePeak: '单日峰值',
      homeSidePending: '待处理',
      homeQuickTitle: '快捷入口',
      homePipelineTitle: '数据库转换链路',
      homePipelineSub: '源端读取 · 规则转换 · 目标端执行',
      homePipelineSource: '源数据库',
      homePipelineTarget: '目标数据库',
      homePipelineEngine: '转换引擎',
      homePipelineEngineTitle: 'SQL 转换引擎',
      homePipelineLocal: '本地规则',
      homePipelineAgent: '智能体',
      homePipelineRules: '规则库 v{version}',
      homePipelineSourceReady: '{count} 个源端连接',
      homePipelineTargetReady: '{count} 个目标端连接',
      homePipelineNoConn: '尚未配置连接',
      homePipelineCompat: '兼容模式',
      homePipelineEnabled: '已启用',
      homePipelineDisabled: '未启用',
      homePipelineOpen: '进入工作台',
      homeRecentTitle: '最近转换',
      homeRecentSub: '继续处理最近的 SQL 对象与转换任务',
      homeRecentAll: '查看全部',
      homeRecentEmpty: '还没有任务，创建第一个转换任务。',
      homeRecentNew: '新建任务',
      homeStatusDone: '已完成',
      homeStatusRunning: '转换中',
      homeStatusPending: '待处理',
      homeStatusError: '需处理',
      homeDemoTask1: 'ERP 业务系统转换',
      homeDemoTask2: '财务系统 SQL 转换',
      homeDemoTask3: '库存管理兼容性检测',
      homeDemoMeta1: '1,248 个对象 · 预计 6 分钟',
      homeDemoMeta2: '356 个对象 · 正在校验',
      homeDemoMeta3: '84 个对象 · 等待排期',
      homeLocalFile: '本地 SQL',
      homeObjectUnit: '个对象',
      homeFooterLeft: 'PLSQL Studio · 本地优先 · 数据不离开工作区',
      homeFooterRight: 'v{version} · 规则库已加载',
      homeTimeJustNow: '刚刚',
      homeTimeMinutes: '{count} 分钟前',
      homeTimeHours: '{count} 小时前',
      homeTimeDays: '{count} 天前',
      themeDark: '切换到深色模式',
      themeLight: '切换到浅色模式',
      connectionsPageEyebrow: 'CONNECTION REGISTRY',
      connectionsPageDesc: '左侧维护源库、右侧维护目标库；连接信息仅保存在本机浏览器，密码加密保存、不会上传到转换会话',
      workspaceTitle: '任务详情',
      workspaceEyebrow: 'CONVERSION WORKSPACE',
      currentTask: '当前任务',
      currentTaskLeave: '退出任务',
      currentTaskLeaveHint: '退出任务上下文；任务下的 SQL 仍保留在工作台。',
      workbarSource: '源端',
      workbarTarget: '目标端',
      workbarLocal: '本地 SQL',
      workbarConvert: '转换',
      workbarConvertAllHint: '转换当前任务下的全部 SQL',
      workbarExecuteAllHint: '把当前任务下已转换的 SQL 全部执行到目标库',
      workbarExportAllHint: '导出当前任务下全部转换结果（多个文件打包为 zip）',
      workbarExecute: '执行',
      workbarExport: '导出',
      insightAnalysis: '转换分析',
      insightDiff: '差异对比',
      insightLog: '执行日志',
      insightRisk: '风险提示',
      insightStatus: '转换状态',
      insightRules: '规则命中',
      insightRisks: '风险项',
      insightDuration: '转换耗时',
      insightApplied: '已应用规则',
      insightNoApplied: '本次转换没有命中本地规则。',
      insightNoResult: '还没有转换结果，先点击「本地转换」生成目标 SQL。',
      insightRiskEmpty: '未发现需要人工复核的结构。',
      insightLogEmpty: '还没有执行记录；转换后点「执行」可在目标库运行。',
      insightExecOk: '执行成功',
      insightExecError: '执行失败',
      insightExecAt: '执行时间',
      insightDiffEmpty: '转换后在这里查看源 SQL 与目标 SQL 的逐行差异。',
      insightNoDiff: '源 SQL 与目标 SQL 完全一致。',
      insightDiffTruncated: '差异过大，仅展示前 {count} 行。',
      insightAppliedCount: '已应用 {count} 条规则',
      insightRuleHits: '{count} 次',
      insightNoTest: '尚未测试',
      homeWeekMon: '周一',
      homeWeekTue: '周二',
      homeWeekWed: '周三',
      homeWeekThu: '周四',
      homeWeekFri: '周五',
      homeWeekSat: '周六',
      homeWeekSun: '周日',
    }

    const en = {
      nav: 'PLSQL Studio',
      title: 'PLSQL Studio',
      subtitle: 'Hand Oracle functions, procedures, packages, views, triggers, and anonymous blocks to the plsqlstudio agent.',
      intro: 'Fill in the form and choose "Convert in a new session". The agent works with the same conversion rules in a new session; the process and result stay there, so you can follow up or ask it to write files.',
      mode: 'Input',
      single: 'Single object',
      batch: 'Directory',
      objectType: 'Object type',
      auto: 'Detect automatically',
      fn: 'Function',
      proc: 'Procedure',
      pkg: 'Package',
      view: 'View',
      mview: 'Materialized view',
      trigger: 'Trigger',
      table: 'Table / DDL script',
      block: 'Anonymous block / PLSQL',
      schema: 'Target schema',
      schemaEmpty: 'No schemas available',
      schemaHint: 'Empty keeps the source schema',
      compat: 'Target compatibility mode enabled',
      compatHint: 'Prefer the source dialect when the target supports it; unverified constructs follow HGDB V9 standard.',
      sourceSql: 'Source',
      sqlPlaceholder: 'Paste the complete Oracle function, procedure, package, view, or trigger definition...',
      srcDir: 'Source directory',
      srcDirHint: 'For example D:\\migration\\src',
      outDir: 'Output directory',
      outDirHint: 'Defaults to converted',
      preview: 'Prompt preview',
      previewHint: 'This is the exact request sent to the agent; expand to inspect or copy it.',
      convert: 'Start conversion',
      copy: 'Copy prompt',
      sample: 'Insert sample',
      clear: 'Clear',
      chars: 'characters',
      needInput: 'Enter the source content first.',
      startFailed: 'Could not start the session: ',
      copied: 'Prompt copied.',
      copyFailed: 'Copy failed; select the prompt and copy manually.',
      storageWriteFailed: 'Could not write local storage (it may be full); the last change was not saved. Export your work, then remove old tasks.',
      sampleLoaded: 'Sample inserted.',
      flowHint: 'The session selects the "PLSQL Studio" agent and fills this request into the composer; press Enter to start.',
      preset: 'Agent: plsqlstudio',
      pageTitle: 'PLSQL Studio',
      welcomeTitle: 'Start Oracle → HGDB conversion',
      welcomeSub: 'Read objects from a source connection, or paste/load sample SQL',
      welcomeRead: 'Read source',
      welcomeSample: 'Load sample',
      welcomeNew: 'New SQL',
      introText: 'A workbench for Oracle / MySQL / SQL Server to HGDB V9; organized by task, so picking a task brings its connections and settings',
      introChipRead: 'Read source',
      introChipConvert: 'Local / AI online convert',
      introChipExec: 'Execute on target',
      statusReady: 'Ready',
      linesUnit: 'lines',
      paneInput: 'Input',
      paneRequest: 'Summary',

      batchEmptyHint: 'Directory mode: the agent reads the .sql files under the source directory, converts them in dependency order, and writes the output directory.',
      summaryMode: 'Mode',
      summaryObject: 'Object type',
      summarySchema: 'Target schema',
      summaryCompat: 'Compat mode',
      summaryInput: 'Input',
      summaryOutput: 'Expected output',
      summaryAgent: 'Agent',
      compatOn: 'Enabled',
      compatOff: 'Disabled',
      schemaInherit: 'Keep source schema',
      outputSingle: 'Converted SQL, a change table, and review points',
      outputBatch: 'converted/ directory and CONVERSION_REPORT.md',
      converting: 'Converting',
      convertDone: 'Conversion succeeded',
      convertFailed: 'Conversion failed',
      resultTitle: 'Result',
      quickConvertLocal: 'Quick convert (local)',
      deepConvert: 'AI online convert',
      localWarnings: 'Needs review',
      'warn.package': 'PACKAGE needs splitting into routines',
      'warn.trigger': 'TRIGGER needs a rewrite',
      'warn.connectBy': 'CONNECT BY needs a recursive CTE',
      'warn.outerJoin': '(+) outer join needs a JOIN',
      'warn.rownum': 'ROWNUM needs LIMIT or a window function',
      'warn.decode': 'DECODE needs CASE',
      'warn.listagg': 'LISTAGG needs STRING_AGG',
      'warn.pivot': 'PIVOT needs conditional aggregation',
      'warn.merge': 'MERGE needs a version-specific rewrite',
      'warn.autonomous': 'No autonomous-transaction equivalent',
      'warn.bulk': 'BULK COLLECT needs a rewrite',
      'warn.commit': 'COMMIT inside a routine needs transaction boundaries',
      'warn.needsAgent': 'This object exceeds the local rule set',
      'warn.job': 'No DBMS_SCHEDULER on the target; rewrite as pgAgent / pg_cron',
      'warn.unsigned': 'UNSIGNED was widened to a larger signed type; confirm the value range',
      'warn.onUpdate': 'ON UPDATE CURRENT_TIMESTAMP needs a BEFORE UPDATE trigger',
      'warn.enum': 'ENUM became text + CHECK; confirm the allowed values',
      'warn.set': 'SET has no equivalent and became text',
      'warn.fulltext': 'FULLTEXT / SPATIAL indexes were not converted',
      'warn.partition': 'MySQL partitioning was not converted',
      'warn.prefixIndex': 'Prefix lengths were removed from the index',
      'warn.zeroDate': 'Zero dates must become a valid time or NULL',
      'warn.routine': 'MySQL routine body needs AI or manual rewriting',
      'warn.event': 'EVENT must become a pgAgent / pg_cron job',
      'warn.groupConcat': 'GROUP_CONCAT needs STRING_AGG',
      'warn.dateFormat': 'DATE_FORMAT needs TO_CHAR',
      'warn.strToDate': 'STR_TO_DATE needs TO_TIMESTAMP',
      'warn.onDuplicate': 'ON DUPLICATE KEY needs ON CONFLICT',
      'warn.insertIgnore': 'INSERT IGNORE needs ON CONFLICT DO NOTHING',
      'warn.replaceInto': 'REPLACE INTO needs ON CONFLICT',
      'warn.regexp': 'REGEXP needs ~',
      'warn.div': 'DIV needs / or div()',
      'warn.userVariable': 'MySQL user variables (@x) have no equivalent',
      'warn.backslashEscape': 'Backslash-escaped strings need a manual check',
      'warn.delimiter': 'DELIMITER was ignored',
      'warn.useDatabase': 'USE was commented out; the task schema applies',
      'warn.session': 'Session-level statement was commented out',
      'warn.unknownType': 'An unrecognised MySQL data type was skipped',
      'warn.createSchema': 'CREATE DATABASE became CREATE SCHEMA',
      manage: 'Connections',
      connectionsTitle: 'Connections',
      connName: 'Name',
      connKind: 'Type',
      connHost: 'Host',
      connPort: 'Port',
      connDatabase: 'Database/service',
      connUser: 'User',
      connPassword: 'Password',
      showPassword: 'Show password',
      hidePassword: 'Hide password',
      connTest: 'Test connection',
      connTesting: 'Testing\u2026',
      connSchema: 'Default schema',
      connSchemaPlaceholder: 'Blank: connection user / public',
      connSchemaOwnerPlaceholder: 'Blank: login user (object owner)',
      connAdd: 'Add connection',
      connSourceTitle: 'Source databases',
      connTargetTitle: 'Target databases',
      connSourceHint: 'Oracle / MySQL, used to read objects',
      connTargetHint: 'HGDB-V9-PostgreSQL / Oracle / MySQL, used to run conversions',
      connEmptySource: 'No source connection yet; add one above',
      connEmptyTarget: 'No target connection yet; add one above',
      connEditTitle: 'Edit connection',
      connDialogSub: 'Fill in the connection details, test it, then save',
      connEdit: 'Edit',
      connDelete: 'Delete',
      connSave: 'Save',
      connSaved: 'Connection saved',
      connSavedMemoryOnly: 'Connection kept in memory only: the browser cannot encrypt the password (Web Crypto / IndexedDB unavailable), so it will have to be entered again after a reload.',
      passwordUnreadable: 'The saved password could not be decrypted (the browser key may be gone). Enter it again.',
      passwordSavedHint: 'Password saved',
      connCancel: 'Cancel',
      confirm: 'OK',
      cancel: 'Cancel',
      confirmOk: 'OK',
      connBack: 'Back',
      connEmpty: 'No connections yet',
      connKindOracle: 'Oracle',
      connKindHgdb: 'HGDB V9',
      connKindMysql: 'MySQL',
      connKindHgdbMysql: 'HGDB-V9-MySQL',
      connKindHgdbPostgresql: 'HGDB-V9-PostgreSQL',
      connKindHgdbOracle: 'HGDB-V9-Oracle',
      connSchemaForMysql: 'Default schema (database)',
      copyResult: 'Copy',
      searchFiles: 'Search SQL\u2026',
      newSql: 'New',
      importSql: 'Import',
      copySql: 'Copy',
      convertSyntax: 'Local convert',
      onlineCompatKept: 'Compat mode: kept source Oracle syntax',
      rename: 'Rename',
      convert: 'Convert',
      refetch: 'Refetch',
      delete: 'Delete',
      exportResult: 'Export',
      resultEmpty: 'No result yet \u2014 use Convert to generate one.',
      sourceNotReadTitle: 'No source objects yet',
      sourceNotReadHint: 'Source mode does not accept pasted SQL \u2014 click \u201cRead\u201d above to pull objects from the source database.',
      sourceNotReadList: 'No objects read yet',
      searchNoMatch: 'No matching SQL files',
      readConnUnreachable: 'Cannot reach the source database \u2014 check host/port, firewall or VPN, and confirm the Oracle listener is up with the right service_name/SID. Raw error: {detail}',
      readAuthFailed: 'The source database rejected the username/password. Raw error: {detail}',
      readServiceMissing: 'The service_name/SID or database does not exist on the source. Raw error: {detail}',
      readMysqlPublicKey: 'MySQL rejected the login (public key retrieval). Use useSSL=false&allowPublicKeyRetrieval=true or a caching_sha2_password compatible account. Raw error: {detail}',
      jobReadTitle: 'Reading source objects',
      jobConvertTitle: 'Converting SQL',
      jobExecuteTitle: 'Executing on target',
      jobStop: 'Stop execution',
      jobStopped: 'Execution stopped',
      jobProgress: '{done} / {total} objects',
      jobRestoredHint: 'Still running in the background; this view refreshes when it finishes',
      convertChecked: 'Convert',
      convertAll: 'Convert all',
      exportChecked: 'Export',
      exportAll: 'Export all',
      exportZipDone: 'Exported {count} files as {name}',
      executeCurrent: 'Execute',
      execCurrentHint: 'Run the converted SQL of this file on the target database',
      execNoTarget: 'No target database selected; execution is disabled',
      executeChecked: 'Execute selected',
      executeAll: 'Execute all',
      executing: 'Executing\u2026',
      execMissing: 'Choose a target connection first',
      execNoSql: 'No converted SQL to execute',
      execDone: 'Execute done: ok / failed',
      needsReview: 'Needs review',
      connNone: 'No connection',
      sourceDb: 'Source',
      sourceNone: 'No source',
      readTypes: 'Types',
      selectAll: 'Select all',
      clearAll: 'Clear',
      read: 'Read',
      reading: 'Reading source objects\u2026',
      readObjects: 'Read {count} objects',
      readSourceMissing: 'Select a source first',
      targetEnd: 'Target',
      readUnsupported: 'Reading objects from {engine} is not supported yet',
      sourceConnMissing: 'Add an {engine} connection in Connections first',
      filterConv: 'Convert',
      filterAll: 'All',
      filterDone: 'Converted',
      filterPending: 'Pending',
      filterWarn: 'Needs review',
      typeAll: 'All types',
      typeUnspecified: 'Unspecified',
      targetDb: 'Target database',

      modeSql: 'SQL text',
      modeDir: 'Directory',
      pageSqlPlaceholder: 'Paste Oracle SQL, or paste a source directory (a second line optionally names the output directory)',

      homeNav: 'Project overview',
      homeSettings: 'System settings',
      settingsTitle: 'System settings',
      settingsDesc: 'Theme, local data and version information',
      settingsAppearance: 'Appearance',
      settingsTheme: 'Theme',
      settingsThemeHint: 'Light or dark; remembered on this machine',
      settingsThemeLight: 'Light',
      settingsThemeDark: 'Dark',
      settingsConvertOptions: 'Conversion options',
      settingsDropTitle: 'Generate drop statements',
      settingsDropHint: 'Emit DROP ... IF EXISTS before CREATE so the target can be re-run',
      settingsOn: 'On',
      settingsOff: 'Off',
      settingsData: 'Local data',
      settingsClearFetched: 'Clear fetched SQL',
      settingsClearFetchedHint: 'Removes object SQL read from source databases; tasks, their connections and local SQL stay.',
      settingsClearFetchedConfirm: 'Clear all object SQL fetched from source databases? Tasks, connections and local SQL stay.',
      settingsClearedFetched: 'Fetched SQL cleared',
      settingsClearConverted: 'Clear conversion results',
      settingsClearConvertedHint: 'Clears conversion and execution results; SQL text, tasks and connections stay.',
      settingsClearConvertedConfirm: 'Clear all conversion and execution results? SQL text, tasks and connections stay.',
      settingsClearedConverted: 'Conversion results cleared',
      settingsCleanupAction: 'Clear',
      settingsAbout: 'About',
      settingsVersion: 'Version',
      homeStudio: 'Task detail',
      homeConnections: 'Connections',
      navTasks: 'Task center',
      navHistory: 'History',
      explorerTitle: 'Task explorer',
      explorerSelected: 'Selected',
      explorerNoSource: 'No source selected',
      explorerRefresh: 'Refresh objects',
      tasksEyebrow: 'CONVERSION TASKS',
      tasksTitle: 'Task center',
      tasksDesc: 'Create a task with its source, target, object types, and compatibility mode; the task detail view picks tasks and tracks reads and conversions in one place',
      tasksTotal: 'Total tasks',
      tasksRunning: 'Running',
      tasksDone: 'Completed',
      tasksPending: 'Pending',
      tasksNew: 'New task',
      tasksEmpty: 'No conversion tasks yet. Use “New task” in the top-right corner to start.',
      tasksDemo: 'Demo tasks',
      tasksOpen: 'Open',
      taskWizardTitle: 'New conversion task',
      taskWizardEditTitle: 'Edit conversion task',
      taskWizardSub: 'Name the task, pick the source mode and an optional target, tick the object types to read, confirm compatibility, then save',
      taskStepBasic: 'Basics',
      taskStepTypes: 'Object types',
      taskStepCompat: 'Compatibility',
      taskName: 'Task name',
      taskNamePlaceholder: 'e.g. ERP core → HGDB V9',
      taskOrigin: 'Source mode',
      taskSqlDialect: 'Source SQL dialect',
      taskOriginSource: 'Read from source',
      taskOriginSourceHint: 'Fetch object DDL from a source database',
      taskOriginLocal: 'Local SQL',
      taskOriginLocalHint: 'Import .sql or paste SQL after saving',
      taskOriginSql: 'SQL text',
      taskOriginSqlHint: 'Paste SQL directly',
      taskSource: 'Source database',
      taskTarget: 'Target database',
      taskTargetOptional: 'Target database (optional)',
      taskSourcePlaceholder: 'Choose a source connection',
      taskTargetPlaceholder: 'Choose a target database (optional)',
      taskTargetUnset: 'No target selected',
      taskMissingConn: 'Connection removed',
      taskSchema: 'Target schema (optional)',
      taskNoSourceConn: 'No Oracle source connection yet.',
      taskNoTargetConn: 'No target connection yet. Add one in Connections first.',
      taskGoConnections: 'Add a connection',
      taskPickFiles: 'Choose SQL files',
      taskPickedFiles: '{count} files selected',
      taskNoFilePicked: 'No files selected yet',
      taskKeepFiles: 'Without new files, the SQL already in this task is kept; newly chosen files are appended.',
      taskSqlLabel: 'SQL content',
      taskSqlPlaceholder: 'Paste the Oracle SQL to convert…',
      taskTypesTitle: 'Object types to read',
      taskTypesHint: 'Only for “Read from source”: just the ticked types are fetched. Local files and SQL text go straight to the workspace.',
      taskTypesHintMysql: 'MySQL sources support tables, views, functions, procedures, triggers and events; no packages, types, sequences or synonyms.',
      taskCompatMysqlNote: 'MySQL sources have no Oracle compatibility mode: conversion always follows HGDB V9 standard syntax, and AUTO_INCREMENT becomes GENERATED BY DEFAULT AS IDENTITY.',
      taskCompatOracleTargetNote: 'Target HGDB-V9-Oracle defaults to Oracle compatibility mode: NVL/DECODE/ROWNUM/PACKAGE and similar syntax are preserved; only constructs proven unsupported are rewritten, with a note.',
      taskCompatNotApplicable: 'Not applicable (MySQL source)',
      taskTypesCount: '{count} types',
      taskCompatTitle: 'Target has Oracle compatibility mode enabled',
      taskCompatDesc: 'Keeps Oracle syntax first; unverified constructs are still rewritten to HGDB V9.',
      taskCompatModeTitle: 'Target compatibility mode',
      taskCompatLocked: 'A target is selected, so the compatibility mode follows the target and cannot be changed here.',
      taskCompatUnlockedHint: 'Without a target you can pick the mode; selecting a target locks it to that target\'s mode.',
      compatModePostgresql: 'PostgreSQL compatibility',
      compatModeOracle: 'Oracle compatibility',
      compatModeMysql: 'MySQL compatibility',
      compatModeSqlserver: 'SQL Server compatibility',
      compatModePostgresqlHint: 'Convert to HGDB / PostgreSQL standard syntax',
      compatModeOracleHint: 'The target executes in Oracle compatibility mode',
      compatModeMysqlHint: 'The target executes in MySQL compatibility mode',
      compatModeSqlserverHint: 'The target executes in SQL Server compatibility mode',
      taskSummary: 'Task summary',
      taskSummaryOrigin: 'Source',
      taskSummaryTarget: 'Target',
      taskSummarySchema: 'Target schema',
      taskSummaryTypes: 'Object types',
      taskSummaryCompat: 'Compatibility',
      taskCompatOn: 'Compatibility on',
      taskCompatOff: 'Compatibility off',
      taskObjects: '{count} objects',
      taskObjectsOne: '1 object',
      taskTypesOne: '1 type',
      taskSchemaInherit: 'Inherit from source',
      taskTypesNotNeeded: 'Not required',
      taskBack: 'Back',
      taskNext: 'Next',
      taskSave: 'Save task',
      taskSaveEdit: 'Save changes',
      taskDelete: 'Delete task',
      taskDeleteConfirm: 'Delete task “{name}” and all SQL under it? This cannot be undone.',
      taskSelectLabel: 'Task',
      taskSelectPlaceholder: 'Choose a task',
      explorerNoTask: 'No task selected',
      execNeedsTask: 'Choose or create a conversion task before executing on the target database.',
      welcomeTaskTitle: 'Start with a conversion task',
      welcomeTaskSub: 'Task detail works by task: picking one brings its source, target, object types, and compatibility mode along',
      taskRead: 'Read objects',
      taskEdit: 'Edit task',
      taskStepFetch: 'Fetch',
      taskStepConvert: 'Convert',
      taskStepExecute: 'Run',
      taskStepFetchHint: 'Read object DDL from the source database',
      taskStepConvertHint: 'Rewrite source SQL for the target dialect',
      taskStepExecuteHint: 'Execute the converted SQL on the target database',
      taskOpen: 'Open task',
      taskSaved: 'Task saved',
      taskReadStarted: 'Reading “{name}”…',
      sqlserverNeedsAi: 'Local SQL Server rules are not supported yet; use AI conversion for this file',
      mysqlRoutineNeedsAi: 'Procedures/triggers/events need AI conversion for MySQL-compatible targets (local pass is minimal)',
      taskReadDone: '{count} objects read',
      taskNeedName: 'Enter a task name.',
      taskNeedSource: 'Choose a source connection.',
      taskNeedTarget: 'Choose a target connection.',
      taskNeedFiles: 'Choose at least one SQL file.',
      taskNeedSql: 'Paste some SQL first.',
      taskNeedLocal: 'Choose a SQL file or paste SQL content.',
      taskNeedTypes: 'Tick at least one object type.',
      objTable: 'Table',
      objView: 'View',
      objMatView: 'Materialized view',
      objFunction: 'Function',
      objProcedure: 'Procedure',
      objPackage: 'Package',
      objPackageBody: 'Package body',
      objTrigger: 'Trigger',
      objType: 'Type',
      objSequence: 'Sequence',
      objSynonym: 'Synonym',
      objJob: 'Scheduled job',
      objEvent: 'Event',
      historyEyebrow: 'ACTIVITY HISTORY',
      historyTitle: 'History',
      historyDesc: 'Conversion and execution history, aggregated by task',
      historyTime: 'Last activity',
      historyActionConvert: 'Convert',
      historyActionExecute: 'Execute',
      historyActionBoth: 'Convert + execute',
      historyObject: 'Task',
      historyTarget: 'Target',
      historyResult: 'Result',
      historyDuration: 'Total time',
      historyStatusDone: 'Completed',
      historyStatusPartial: 'Has failures',
      historyStatusRunning: 'In progress',
      historyEmpty: 'No task activity yet.',
      historyDemo: 'Demo records',
      historyDemoMeta1: 'Oracle ERP → HGDB V9 · 1,248 objects',
      historyDemoMeta2: 'Finance DB → HGDB V9 · 356 objects',
      historyDemoMeta3: 'Stock DB → HGDB V9 · 84 objects',
      historyConverted: 'Conversion succeeded',
      historyFailed: 'Conversion failed',
      historyExecOk: 'Execution succeeded',
      historyExecFailed: 'Execution failed',
      homePro: 'PRO',
      homeTagline: 'Cross-database intelligent conversion studio',
      homeEngineReady: 'Conversion engine ready',
      homeEyebrow: 'DATABASE CONVERSION WORKSPACE',
      homeTitleA: 'Make database conversion',
      homeTitleB: 'effortless',
      homeDesc: 'Unified connections · SQL conversion · Conversion execution · Result validation',
      homeNewTask: 'New conversion task',
      homeManageConn: 'Manage connections',
      homeConsoleTitle: 'CONVERSION CONSOLE',
      homeConsoleRunning: 'RUNNING',
      homeConsoleBefore: 'BEFORE',
      homeConsoleAfter: 'AFTER',
      homeConsoleFoot: 'objects converted',
      homeConsoleNote: 'local rule check passed',
      homeConsolePending: '{count} need review',
      homeSource: 'SOURCE',
      homeTarget: 'TARGET',
      homeSourceValue: 'Oracle 11g',
      homeTargetValue: 'HGDB V9',
      homeDemoChip: 'Demo data',
      homeDemoHint: 'No real connections or conversions yet. Sample data is shown and switches to live data once you add a connection or convert SQL.',
      homeStatConnections: 'Connected databases',
      homeStatConnectionsFoot: '{sources} sources · {targets} targets',
      homeStatTasks: 'Conversion tasks',
      homeStatTasksFoot: '{local} local · {source} from source',
      homeStatTasksNone: 'No conversion tasks yet',
      homeStatObjects: 'Objects converted',
      homeStatObjectsFoot: 'Across {types} object types',
      homeStatSuccess: 'SQL conversion success',
      homeStatSuccessFoot: 'Based on conversion history',
      homeStatSuccessNone: 'No conversions yet',
      homeStatLive: 'LIVE',
      homeTrendTitle: 'SQL conversion trend',
      homeTrendSub: 'Completed and review-needed conversions over the last 7 days',
      homeTrendSub30d: 'Completed and review-needed conversions over the last 30 days',
      homeTrend7d: '7 days',
      homeTrend30d: '30 days',
      homeTrendDone: 'Completed',
      homeTrendReview: 'Needs review',
      homeTrendEmpty: 'No conversions yet. Open the workspace and convert your first SQL.',
      homeTrendNoTimestamps: 'History exists, but old records have no timestamps. Run one new conversion to start the trend.',
      homeTrendGo: 'Start converting',
      homeTrendPeak: 'Peak',
      homeSideTitle: 'This week',
      homeSideRecentTitle: 'Recent conversions',
      homeSideRecentEmpty: 'No conversions yet',
      homeSideRecentMore: 'View all',
      homeSideTotal: 'Conversions',
      homeSidePeak: 'Peak day',
      homeSidePending: 'Pending',
      homeQuickTitle: 'Quick access',
      homePipelineTitle: 'Conversion pipeline',
      homePipelineSub: 'Read source · apply rules · execute target',
      homePipelineSource: 'Source',
      homePipelineTarget: 'Target',
      homePipelineEngine: 'Conversion engine',
      homePipelineEngineTitle: 'SQL conversion engine',
      homePipelineLocal: 'Local rules',
      homePipelineAgent: 'Agent',
      homePipelineRules: 'Rules v{version}',
      homePipelineSourceReady: '{count} linked',
      homePipelineTargetReady: '{count} linked',
      homePipelineNoConn: 'No connection configured',
      homePipelineCompat: 'Compat mode',
      homePipelineEnabled: 'Enabled',
      homePipelineDisabled: 'Disabled',
      homePipelineOpen: 'Open workspace',
      homeRecentTitle: 'Recent conversions',
      homeRecentSub: 'Pick up the latest SQL objects and conversion tasks',
      homeRecentAll: 'View all',
      homeRecentEmpty: 'No tasks yet. Create your first conversion task.',
      homeRecentNew: 'New task',
      homeStatusDone: 'Completed',
      homeStatusRunning: 'Converting',
      homeStatusPending: 'Pending',
      homeStatusError: 'Needs attention',
      homeDemoTask1: 'ERP platform conversion',
      homeDemoTask2: 'Finance SQL conversion',
      homeDemoTask3: 'Inventory compatibility scan',
      homeDemoMeta1: '1,248 objects · about 6 min',
      homeDemoMeta2: '356 objects · validating',
      homeDemoMeta3: '84 objects · queued',
      homeLocalFile: 'Local SQL',
      homeObjectUnit: 'objects',
      homeFooterLeft: 'PLSQL Studio · local-first · data never leaves the workspace',
      homeFooterRight: 'v{version} · rule library loaded',
      homeTimeJustNow: 'just now',
      homeTimeMinutes: '{count} min ago',
      homeTimeHours: '{count} h ago',
      homeTimeDays: '{count} d ago',
      themeDark: 'Switch to dark mode',
      themeLight: 'Switch to light mode',
      connectionsPageEyebrow: 'CONNECTION REGISTRY',
      connectionsPageDesc: 'Source connections on the left, targets on the right; profiles stay in this browser, passwords encrypted and never uploaded',
      workspaceTitle: 'Task detail',
      workspaceEyebrow: 'CONVERSION WORKSPACE',
      currentTask: 'Current task',
      currentTaskLeave: 'Leave',
      currentTaskLeaveHint: 'Leave this task context; its SQL files stay in the workspace.',
      workbarSource: 'Source',
      workbarTarget: 'Target',
      workbarLocal: 'Local SQL',
      workbarConvert: 'Convert',
      workbarConvertAllHint: 'Convert every SQL in the current task',
      workbarExecuteAllHint: 'Execute every converted SQL of the task on the target database',
      workbarExportAllHint: 'Export all conversion results of the task as one zip',
      workbarExecute: 'Execute',
      workbarExport: 'Export',
      insightAnalysis: 'Analysis',
      insightDiff: 'Diff',
      insightLog: 'Execution log',
      insightRisk: 'Risks',
      insightStatus: 'Status',
      insightRules: 'Rules hit',
      insightRisks: 'Risks',
      insightDuration: 'Duration',
      insightApplied: 'Applied rules',
      insightNoApplied: 'No local rules matched this conversion.',
      insightNoResult: 'No conversion result yet. Run Convert to generate target SQL.',
      insightRiskEmpty: 'No constructs requiring manual review were found.',
      insightLogEmpty: 'No execution yet. Run Execute after converting to run it on the target.',
      insightExecOk: 'Execution succeeded',
      insightExecError: 'Execution failed',
      insightExecAt: 'Executed at',
      insightDiffEmpty: 'After conversion, review the line-by-line source and target diff here.',
      insightNoDiff: 'Source and target SQL are identical.',
      insightDiffTruncated: 'Diff is large; showing the first {count} lines.',
      insightAppliedCount: '{count} rules applied',
      insightRuleHits: '{count} hits',
      insightNoTest: 'Not tested',
      homeWeekMon: 'Mon',
      homeWeekTue: 'Tue',
      homeWeekWed: 'Wed',
      homeWeekThu: 'Thu',
      homeWeekFri: 'Fri',
      homeWeekSat: 'Sat',
      homeWeekSun: 'Sun',
    }

    const SAMPLE = [
      'CREATE OR REPLACE FUNCTION f_customer_level(p_cust_id IN NUMBER)',
      'RETURN VARCHAR2',
      'IS',
      '  v_amt NUMBER(14,2);',
      'BEGIN',
      "  SELECT NVL(SUM(amount), 0) INTO v_amt",
      "  FROM t_order WHERE customer_id = p_cust_id AND status = 'C';",
      '',
      "  IF v_amt >= 100000 THEN",
      "    RETURN 'A';",
      "  ELSIF v_amt >= 10000 THEN",
      "    RETURN 'B';",
      '  ELSE',
      "    RETURN 'C';",
      '  END IF;',
      'END;',
      '/',
    ].join('\n')

    function buildSinglePrompt({ sql, objectType, schema, compat, engine, drop, target }) {
      if (engine === 'sqlserver') return buildSqlServerPrompt({ sql, schema, drop })
      if (engine === 'mysql') return buildMysqlPrompt({ sql, schema, drop, target })
      const typeNames = {
        auto: '自动识别（先判断对象类型）',
        fn: '函数 FUNCTION',
        proc: '存储过程 PROCEDURE',
        pkg: '包 PACKAGE（规范与包体）',
        view: '视图 VIEW',
        mview: '物化视图',
        trigger: '触发器 TRIGGER',
        table: '建表/DDL 脚本',
        block: '匿名块 / PLSQL 片段',
      }
      const typeText = typeNames[objectType] ?? objectType
      return [
        '你是 Oracle→HGDB V9 转换智能体。请把下面的 Oracle 对象转换为瀚高 HGDB V9 可编译的语法。',
        '',
        '## 转换约束',
        `1. 对象类型：${typeText}`,
        `2. 目标 schema：${schema.trim() || '沿用源 schema（未指定）'}`,
        `3. 目标端 Oracle 兼容模式：${compat ? '已启用。本次输出必须保持源端 Oracle 语法与写法：不要添加 $$ / LANGUAGE plpgsql，不要强制小写标识符或 schema，不要改写 NVL、DECODE、ROWNUM、SYSDATE、序列、包、%TYPE 等；仅做空白与格式整理。只有确认兼容模式下无法编译的写法才做最小改写并标注原因。此要求优先于任何默认的 HGDB V9 改写规则' : '未启用。全部改写为 HGDB V9 标准语法，不依赖兼容模式'}`,
        '4. 语义等价优先：空串/NULL、CHAR 补空格、DATE 精度、ROWNUM 求值时机、提交语义、包级状态、自治事务，都必须显式处理。',
        ...(drop === true
          ? ['5. 生成删除语句：在 CREATE 之前输出对应的 DROP ... IF EXISTS（表/视图/函数/过程/序列/类型），便于在目标库重复执行。']
          : []),
        '5. 标识符大小写：兼容模式启用时保持源端写法（不要强制小写）；未启用时统一小写。只有保留字或必须区分大小写时才加双引号。',
        '6. 输出完整可执行 SQL，不要用省略号或伪代码。',
        '7. 这是单对象转换：直接给出结果，不要调用任何工具、不要读取技能文件、不要创建待办或中间文件。',
        ...(compat ? [
          '',
          '## 目标库实测兼容能力（HGDB 14.23，已实测通过；兼容模式下请直接沿用）',
          '查询/语法：DUAL、NVL/NVL2/DECODE、SYSDATE/SYSTIMESTAMP、TO_CHAR/TO_DATE/TO_TIMESTAMP 的 Oracle 格式、ADD_MONTHS/MONTHS_BETWEEN/LAST_DAY/NEXT_DAY/TRUNC(date)、NUMTODSINTERVAL/NUMTOYMINTERVAL、ROWNUM（含 WHERE ROWNUM<=n 及 DML）、LEVEL/START WITH/CONNECT BY [PRIOR]/NOCYCLE/SYS_CONNECT_BY_PATH/CONNECT_BY_ROOT/CONNECT_BY_ISLEAF/CONNECT_BY_ISCYCLE/ORDER SIBLINGS BY、(+) 外连接、MINUS、INSERT ALL/INSERT FIRST（含 WHEN 条件）、MERGE（含 DELETE 子句）、REGEXP_SUBSTR/REGEXP_INSTR/REGEXP_COUNT/REGEXP_REPLACE、EMPTY_CLOB/EMPTY_BLOB、序列 NEXTVAL/CURRVAL、SYS_GUID、FOR UPDATE OF ... NOWAIT/SKIP LOCKED、事务块内 LOCK TABLE、空串等同 NULL、CHAR 补空格、DECODE 的 NULL 相等语义。',
          '数据类型：NUMBER(p,s)、VARCHAR2、NVARCHAR2、CLOB、BLOB、RAW、ROWID、XMLTYPE、DATE（含时分秒）。',
          'PL/SQL：匿名块；FUNCTION/PROCEDURE（RETURN、IS/AS、OUT、NOCOPY）；PACKAGE 与 PACKAGE BODY；%TYPE/%ROWTYPE；显式游标、游标 FOR 循环、%FOUND/%NOTFOUND/%ROWCOUNT；TABLE OF ... INDEX BY、BULK COLLECT（含 LIMIT）、FORALL（含 SAVE EXCEPTIONS）；EXECUTE IMMEDIATE（含 INTO/USING）；OPEN ... FOR ... USING；PRAGMA AUTONOMOUS_TRANSACTION（实测可独立提交）、PRAGMA EXCEPTION_INIT；RAISE_APPLICATION_ERROR（实测带自定义错误码）；PIPELINED；DETERMINISTIC/AUTHID/RESULT_CACHE；SYS_REFCURSOR 参数；BOOLEAN；触发器 :NEW/:OLD。',
          '对象/工具：CREATE SYNONYM、COMMENT ON、ALTER TABLE MODIFY/ADD/RENAME COLUMN、ALTER SESSION SET NLS_DATE_FORMAT、CREATE GLOBAL TEMPORARY TABLE ... ON COMMIT、CREATE TABLE ... PARTITION BY RANGE、CREATE VIEW ... WITH READ ONLY、GENERATED AS IDENTITY、DBMS_OUTPUT/DBMS_RANDOM/DBMS_UTILITY（部分）/DBMS_METADATA。',
          '不支持，需改写或标注：CREATE TYPE ... AS OBJECT/AS TABLE OF；PIVOT/UNPIVOT；WM_CONCAT；MATERIALIZED VIEW ... REFRESH FAST/ON COMMIT；BITMAP INDEX；CREATE DIRECTORY；WITH FUNCTION；KEEP (DENSE_RANK FIRST/LAST)；DEFAULT ON NULL；XMLAGG/XMLELEMENT（Oracle 语法）；JSON_VALUE/JSON_QUERY；EXPLAIN PLAN FOR；ANALYZE TABLE ... COMPUTE STATISTICS；SAMPLE；XMLTABLE（XMLTYPE 需转换）；DBMS_LOB、DBMS_APPLICATION_INFO、UTL_FILE、UTL_HTTP、DBMS_SQL.OPEN_CURSOR、DBMS_STATS、DBMS_SCHEDULER、UTL_RAW、DBMS_PIPE、DBMS_ALERT、UTL_ENCODE；SQL*Plus 指令（SET/PROMPT/SPOOL/WHENEVER/&变量）；SYS_REFCURSOR 作为列类型；CREATE DATABASE LINK（可建但连接不可用）。',
        ] : []),
        ...(compat ? [] : [
          '',
          '## 兼容模式未启用：必须改写为 HGDB V9 标准写法',
          '查询：DUAL（去掉 FROM DUAL）、NVL→COALESCE、NVL2→CASE、DECODE→CASE、SYSDATE/SYSTIMESTAMP→CURRENT_TIMESTAMP、ROWNUM→LIMIT/ROW_NUMBER、LEVEL/START WITH/CONNECT BY→WITH RECURSIVE、(+)→LEFT JOIN、MINUS→EXCEPT、INSERT ALL→多条 INSERT/CTE、MERGE→INSERT ... ON CONFLICT、LISTAGG→STRING_AGG、PIVOT→条件聚合、TO_CHAR/TO_DATE 转 HGDB V9 格式、ADD_MONTHS/LAST_DAY 等用 interval/date_trunc 实现。',
          '类型：VARCHAR2/NVARCHAR2→VARCHAR/TEXT、NUMBER→NUMERIC、DATE→TIMESTAMP、CLOB→TEXT、BLOB/RAW→BYTEA、ROWID→ctid、XMLTYPE→xml、SYS_REFCURSOR→refcursor；BOOLEAN 只用于 PL/pgSQL。',
          'PL/SQL：匿名块→DO ；FUNCTION/PROCEDURE→CREATE FUNCTION ... LANGUAGE plpgsql；PACKAGE→schema 内函数集合；%TYPE/%ROWTYPE→具体类型；游标属性→FOUND/ROW_COUNT；BULK COLLECT/FORALL→数组/FOREACH；EXECUTE IMMEDIATE→EXECUTE；PRAGMA AUTONOMOUS_TRANSACTION 无直接等价（标注风险，必要时 dblink/后台任务）；NOCOPY/AUTHID/RESULT_CACHE 去除；DETERMINISTIC→IMMUTABLE；PIPELINED→RETURNS SETOF；触发器 :NEW/:OLD→NEW/OLD；COMMIT/ROLLBACK 不能出现在函数内。',
          '其他：FORCE/NOFORCE VIEW 去掉 FORCE/NOFORCE；USER/SYS_CONTEXT→CURRENT_USER；RAISE_APPLICATION_ERROR→RAISE EXCEPTION；SYS_GUID→gen_random_uuid()；WM_CONCAT→STRING_AGG；KEEP (DENSE_RANK)→窗口函数；BITMAP INDEX→普通索引；MATERIALIZED VIEW REFRESH→REFRESH MATERIALIZED VIEW；XMLAGG/XMLELEMENT→HGDB V9 XML 语法；JSON_VALUE/JSON_QUERY→->>/->；EXPLAIN PLAN FOR→EXPLAIN；ANALYZE TABLE ... COMPUTE STATISTICS→ANALYZE；WITH FUNCTION→独立函数/CTE；DEFAULT ON NULL→COALESCE 默认值；CREATE DATABASE LINK 标注不可用；SQL*Plus 指令（SET/PROMPT/SPOOL/WHENEVER/&变量）删除；DBMS_LOB/UTL_FILE/UTL_HTTP/DBMS_APPLICATION_INFO/DBMS_STATS/DBMS_SCHEDULER/UTL_RAW 不可用，需替换或标注；DBMS_OUTPUT/DBMS_RANDOM 可用；序列 NEXTVAL/CURRVAL→nextval()/currval()。',
        ]),
        '',
        '## 输出格式',
        '1. 转换后的完整 SQL（用 ```sql 代码块）',
        '2. 关键改动与风险（不超过 6 行）',
        '3. 不要附加「未连库验证」「需实测确认」之类的免责声明、结语或验证说明；输出完第 2 部分即结束。',
        '',
        '## 源 SQL',
        '```sql',
        sql.trim(),
        '```',
      ].join('\n')
    }

    /** Prompt for one MySQL object → HGDB V9 conversion (no Oracle compatibility path). */
    function buildSqlServerPrompt({ sql, schema, drop }) {
      return [
        '你是 SQL Server(T-SQL)→瀚高 HGDB V9 转换智能体。把下面的 SQL Server 对象转换为 HGDB V9（PostgreSQL 兼容）可执行语法。',
        '',
        '## 转换约束',
        `1. 目标 schema：${(schema ?? '').trim() || '沿用源 schema（未指定）'}`,
        '2. 语义等价优先：NULL/空串、排序规则、DATETIME 精度、IDENTITY、事务与锁语义必须显式处理。',
        '3. 标识符：去掉 [ ] 与 dbo. 前缀，普通标识符转小写；必须区分大小写时用双引号。',
        '4. 类型：NVARCHAR/NCHAR→VARCHAR/TEXT，DATETIME/DATETIME2/SMALLDATETIME→TIMESTAMP，BIT→BOOLEAN，MONEY/SMALLMONEY→NUMERIC，UNIQUEIDENTIFIER→UUID，VARBINARY/IMAGE→BYTEA，IDENTITY→GENERATED BY DEFAULT AS IDENTITY。',
        '5. 函数与查询：GETDATE()/GETUTCDATE()→CURRENT_TIMESTAMP，ISNULL→COALESCE，LEN→LENGTH，CHARINDEX→POSITION，DATEADD/DATEDIFF→interval 运算，TOP n→LIMIT n，OFFSET…FETCH→LIMIT/OFFSET，IIF→CASE，FOR XML PATH→STRING_AGG。',
        '6. 批处理与控制流：删除 GO 分隔符；@变量 改为 v_变量；BEGIN TRY/CATCH→BEGIN … EXCEPTION；存储过程与触发器改为 PL/pgSQL。',
        '7. 输出完整可执行 SQL，不要用省略号或伪代码。',
        ...(drop === true ? ['8. 在 CREATE 之前输出对应的 DROP ... IF EXISTS。'] : []),
        '',
        '## 输出格式',
        '1. 转换后的完整 SQL（用 ```sql 代码块）',
        '2. 关键改动与风险（不超过 6 行）',
        '3. 不要附加免责声明或结语。',
        '',
        '## 源 SQL',
        '```sql',
        sql.trim(),
        '```',
      ].join('\n')
    }

    function buildMysqlCompatPrompt({ sql, schema, drop }) {
      return [
        '你是 MySQL→瀚高 HGDB V9（MySQL 兼容模式）转换智能体。目标库已实测支持大部分 MySQL 语法，请遵循“最小改写”：能原样执行的语法保持不动，只改写不支持的部分。',
        '',
        '## 已实测支持（保持原样，不要改写）',
        '反引号标识符、AUTO_INCREMENT、ENGINE/CHARSET/COLLATE（utf8mb4_unicode_ci）、ENUM、UNSIGNED/ZEROFILL、ON UPDATE CURRENT_TIMESTAMP、FULLTEXT 索引、生成列（GENERATED ... STORED）、CHECK 约束、CREATE TABLE ... AS SELECT、TEMPORARY TABLE、JSON 列、INSERT IGNORE、REPLACE INTO、ON DUPLICATE KEY UPDATE、UPDATE/DELETE ... LIMIT、GROUP_CONCAT、DATE_FORMAT/STR_TO_DATE、IF、FIND_IN_SET、@变量、PREPARE/EXECUTE、LIMIT n,m、REGEXP、DATE_ADD/INTERVAL。',
        '',
        '## 已实测不支持（需要改写）',
        '1. SET(\'a\',\'b\') 类型 → VARCHAR(255) 或 TEXT（保留逗号分隔值语义）。',
        '2. 空间类型（GEOMETRY/POINT/LINESTRING/POLYGON 等）→ BYTEA/TEXT；SPATIAL KEY → 删除并说明。',
        '3. PARTITION BY ... → 删除分区子句。',
        '4. 视图上的 ALGORITHM=... / SQL SECURITY ... / DEFINER=... → 删除，保留 CREATE VIEW。',
        '5. utf8mb4_0900_* 排序规则 → utf8mb4_unicode_ci。',
        '6. JSON_EXTRACT(json, \'$.a.b\') → json ->> \'a\' 或 json #>> \'{a,b}\'。',
        '7. FOUND_ROWS() 不存在 → 用 COUNT(*) 或改写查询。',
        '8. 事件 EVENT、带 BEGIN...END 复合体的存储过程/函数/触发器 → 改写为 PG 风格函数/触发器函数（目标同样接受 PG 语法）。',
        '9. DROP TRIGGER IF EXISTS 不支持 IF EXISTS → 改为 DROP TRIGGER。',
        '',
        '## 约束',
        `1. 目标 schema：${(schema ?? '').trim() || '沿用源 schema（未指定）'}`,
        '2. 不要为了“看起来像 PostgreSQL”而改写已支持的 MySQL 写法；保持列类型、索引、默认值、注释与语义不变。',
        '3. 改写不支持项时优先保证语义等价，并在输出后列出关键改动。',
        '4. 输出完整可执行 SQL，不要用省略号或伪代码。',
        ...(drop === true ? ['5. 在 CREATE 之前输出对应的 DROP ... IF EXISTS。'] : []),
        '',
        '## 输出格式',
        '1. 转换后的完整 SQL（用 ```sql 代码块）',
        '2. 关键改动与风险（不超过 6 行）',
        '3. 不要附加免责声明或结语。',
        '',
        '## 源 SQL',
        '```sql',
        sql.trim(),
        '```',
      ].join('\n')
    }

    function buildMysqlPrompt({ sql, schema, drop, target }) {
      if (target === 'mysql') return buildMysqlCompatPrompt({ sql, schema, drop })
      return [
        '你是 MySQL→瀚高 HGDB V9 转换智能体。请把下面的 MySQL 对象转换为 HGDB V9（PostgreSQL 兼容）可执行语法。',
        '',
        '## 转换约束',
        `1. 目标 schema：${schema.trim() || '沿用源 schema（未指定）'}`,
        '2. 不使用 Oracle 兼容模式：全部按 HGDB V9 标准写法输出。',
        '3. 标识符：反引号改为小写无引号；保留字或必须区分大小写时才加双引号。',
        '4. 语义等价优先：自增、ON UPDATE CURRENT_TIMESTAMP、无符号整数范围、零日期、ENUM/SET、字符集与排序规则、索引前缀、外键动作都必须显式处理。',
        '5. 输出完整可执行 SQL，不要用省略号或伪代码。',
        ...(drop === true
          ? ['6. 生成删除语句：在 CREATE 之前输出对应的 DROP ... IF EXISTS，便于在目标库重复执行。']
          : []),
        '6. 这是单对象转换：直接给出结果，不要调用任何工具、不要读取技能文件、不要创建待办或中间文件。',
        '',
        '## 必做映射',
        '表选项：删除 ENGINE / DEFAULT CHARSET / COLLATE / AUTO_INCREMENT=... / ROW_FORMAT / PARTITION；表与列 COMMENT 改写为 COMMENT ON TABLE / COMMENT ON COLUMN。',
        '类型：TINYINT→SMALLINT（TINYINT(1)→BOOLEAN）、INT→INTEGER、BIGINT→BIGINT、DECIMAL→NUMERIC、DOUBLE→DOUBLE PRECISION、FLOAT→REAL、DATETIME/TIMESTAMP→TIMESTAMP、YEAR→INTEGER、TEXT 系列→TEXT、BLOB/BINARY/VARBINARY→BYTEA、JSON→JSONB、ENUM→TEXT+CHECK、SET→TEXT+约束；UNSIGNED 提升为更大的有符号类型（BIGINT UNSIGNED 用 NUMERIC(20) 或在报告中说明范围限制）。',
        '自增：AUTO_INCREMENT → GENERATED BY DEFAULT AS IDENTITY（仅单列、整数类型）。',
        '索引与约束：列内 PRIMARY KEY 保留；UNIQUE KEY → CONSTRAINT ... UNIQUE；普通 KEY/INDEX → 建表后单独 CREATE INDEX；FULLTEXT/SPATIAL 需改写或标注；前缀索引去掉前缀长度；外键保留，注意被引用表需先创建。',
        '默认值与时间：DEFAULT CURRENT_TIMESTAMP 保留；ON UPDATE CURRENT_TIMESTAMP 需输出 BEFORE UPDATE 触发器（函数 + CREATE TRIGGER）；零日期改为 NULL 或合法时间。',
        '过程/函数/触发器/事件：改写为 PL/pgSQL（CREATE FUNCTION/PROCEDURE、$$ 包体、DECLARE→DECLARE、SIGNAL SQLSTATE→RAISE EXCEPTION），EVENT 改写为 pg_cron/pgAgent 作业并标注。',
        '查询方言：IFNULL→COALESCE、NOW()/CURDATE()→CURRENT_TIMESTAMP/CURRENT_DATE、LIMIT a,b→LIMIT b OFFSET a、GROUP_CONCAT→STRING_AGG、DATE_FORMAT→TO_CHAR、STR_TO_DATE→TO_TIMESTAMP、ON DUPLICATE KEY UPDATE→INSERT ... ON CONFLICT DO UPDATE、INSERT IGNORE→ON CONFLICT DO NOTHING、REPLACE INTO→INSERT ... ON CONFLICT、REGEXP→~、DIV→div()、用户变量 @x 需改写为 CTE 或参数。',
        '字符串：反斜杠转义改为标准字符串（用 \'\' 转义），b\'0\'/b\'1\' 改为布尔值，x\'..\' 改为 bytea。',
        '',
        '## 输出格式',
        '1. 转换后的完整 SQL（用 ```sql 代码块）',
        '2. 关键改动与风险（不超过 6 行）',
        '3. 不要附加「未连库验证」「需实测确认」之类的免责声明、结语或验证说明。',
        '',
        '## 源 SQL',
        '```sql',
        sql.trim(),
        '```',
      ].join('\n')
    }

    /** Keep only the SQL body from an online-conversion reply and mark its origin. */
    function onlineSqlResult(text) {
      const fence = /```[ \t]*([a-zA-Z]*)[ \t]*\r?\n([\s\S]*?)```/g
      let fallback = ''
      let match
      while ((match = fence.exec(text)) !== null) {
        const body = (match[2] || '').trim()
        if (body === '') continue
        if ((match[1] || '').toLowerCase() === 'sql') return `--在线转换\n${body}`
        if (fallback === '') fallback = body
      }
      const sql = (fallback !== '' ? fallback : text.trim()).replace(/^```[a-zA-Z]*\s*|\s*```$/g, '').trim()
      return `--在线转换\n${sql}`
    }

    /**
     * In compat mode the source Oracle routine must stay Oracle-shaped. If the
     * online agent still wraps it into an HGDB V9 routine, keep the source.
     */
    function onlineConversionResult(text, options = {}) {
      const sql = onlineSqlResult(text)
      const source = typeof options.sourceSql === 'string' ? options.sourceSql.trim() : ''
      const compat = options.compat === true
      const routine = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE|PACKAGE|TRIGGER|TYPE)\b/i
      const wrapper = /\$\$|\$[A-Za-z_][A-Za-z0-9_]*\$|LANGUAGE\s+plpgsql/i
      if (compat && routine.test(source) && wrapper.test(sql) && !wrapper.test(source)) {
        return { text: `--在线转换（兼容模式：保留源端语法）\n${source}`, keptSource: true }
      }
      return { text: sql, keptSource: false }
    }

    function buildBatchPrompt({ srcDir, outDir, schema, compat }) {
      const out = outDir.trim() || 'converted'
      return [
        '你是 Oracle→HGDB V9 转换智能体。请批量转换目录下的 Oracle 脚本。',
        '',
        '## 输入',
        `- 源目录：${srcDir.trim()}`,
        `- 输出目录：${out}`,
        `- 目标 schema：${schema.trim() || '沿用源 schema'}`,
        `- 目标端 Oracle 兼容模式：${compat ? '已启用。保持源端 Oracle 语法与写法，不添加 $$ / LANGUAGE plpgsql，不强制小写标识符/schema，不改写 NVL、DECODE、ROWNUM 等；仅做格式整理，必要改写需标注原因。此要求优先于默认 HGDB V9 改写规则' : '未启用。全部使用 HGDB V9 标准写法，不依赖兼容模式'}`,
        '',
        '## 要求',
        '1. 先输出对象清单与依赖顺序（类型 → 序列 → 表 → 函数 → 过程 → 包 → 视图 → 触发器）。',
        `2. 按依赖顺序逐个转换，结果写入 ${out}/（保持源目录相对结构，一个对象一个 .sql）。`,
        `3. 生成 ${out}/CONVERSION_REPORT.md：对象清单、状态（自动/需人工/未支持）、关键改动、风险、未验证项。`,
        '4. 不删除源文件，不覆盖用户未确认的既有转换结果。',
        '5. 直接开始转换，不要逐条征求意见，也不要创建待办。',
        ...(compat ? [
          '',
          '## 目标库实测兼容能力（HGDB 14.23）',
          '已通过：DUAL、NVL/NVL2/DECODE、SYSDATE、TO_CHAR/TO_DATE/TO_TIMESTAMP、ADD_MONTHS/LAST_DAY/TRUNC/NUMTODSINTERVAL、ROWNUM、LEVEL/START WITH/CONNECT BY（含 NOCYCLE、CONNECT_BY_ROOT、CONNECT_BY_ISLEAF/CONNECT_BY_ISCYCLE、ORDER SIBLINGS BY）、(+) 外连接、MINUS、INSERT ALL/INSERT FIRST、MERGE、REGEXP_SUBSTR/INSTR/COUNT/REPLACE、EMPTY_CLOB/EMPTY_BLOB、序列 NEXTVAL/CURRVAL、FOR UPDATE OF/SKIP LOCKED、Oracle 数据类型（NUMBER/VARCHAR2/NVARCHAR2/CLOB/BLOB/RAW/ROWID/XMLTYPE/DATE）、PL/SQL 例程与包、%TYPE/%ROWTYPE、游标、集合与 BULK COLLECT/FORALL、EXECUTE IMMEDIATE、自治事务、PIPELINED、触发器、SYNONYM、COMMENT ON、ALTER TABLE MODIFY/ADD/RENAME、GTT ON COMMIT、PARTITION BY RANGE、VIEW WITH READ ONLY、GENERATED AS IDENTITY、DBMS_OUTPUT/DBMS_RANDOM。',
          '不支持：CREATE TYPE AS OBJECT/TABLE OF、PIVOT/UNPIVOT、WM_CONCAT、MV REFRESH、BITMAP INDEX、CREATE DIRECTORY、WITH FUNCTION、KEEP DENSE_RANK、DEFAULT ON NULL、XMLAGG/XMLELEMENT、JSON_VALUE/JSON_QUERY、EXPLAIN PLAN FOR、ANALYZE TABLE、SAMPLE、XMLTABLE、DBMS_LOB、DBMS_APPLICATION_INFO、UTL_FILE、UTL_HTTP、DBMS_STATS、DBMS_SCHEDULER、UTL_RAW、DBMS_PIPE、DBMS_ALERT、UTL_ENCODE、SQL*Plus 指令（SET/PROMPT/SPOOL/WHENEVER/&）；DATABASE LINK 可建但不可用。',
        ] : []),
        ...(compat ? [] : [
          '',
          '## 兼容模式未启用：按 HGDB V9 标准改写',
          'ROWNUM→LIMIT/ROW_NUMBER、DECODE/NVL2→CASE、NVL→COALESCE、(+)→LEFT JOIN、CONNECT BY→WITH RECURSIVE、MINUS→EXCEPT、PACKAGE→函数集合、MERGE→INSERT ... ON CONFLICT、INSERT ALL/FIRST→多条 INSERT/CTE、LISTAGG/WM_CONCAT→STRING_AGG、KEEP→窗口函数、BITMAP→普通索引、MV REFRESH→REFRESH MATERIALIZED VIEW、XML/JSON 函数改写、EXPLAIN PLAN FOR→EXPLAIN、ANALYZE TABLE→ANALYZE、WITH FUNCTION→独立函数、DEFAULT ON NULL→COALESCE、序列→nextval()/currval()；VARCHAR2/NUMBER/DATE/CLOB/BLOB/RAW 等类型改写；%TYPE/%ROWTYPE 展开；EXECUTE IMMEDIATE→EXECUTE；自治事务、DBMS_*、PIPELINED 等无法等价时标注风险。',
        ]),
        '',
        '完成后给我摘要：对象总数、自动/需人工数量、高风险项。',
      ].join('\n')
    }

    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text)
      }
      return Promise.reject(new Error('clipboard unavailable'))
    }

    const CSS = `
      .o2h-settings { display: flex; flex-direction: column; gap: 16px; max-width: 1040px; padding: 4px 2px 28px; color: var(--dsw-alias-label-primary); }
      .o2h-settings h2 { margin: 0; font-size: 16px; font-weight: 600; }
      .o2h-settings .o2h-sub { margin: 6px 0 0; font-size: 12.5px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
      .o2h-settings .o2h-note { padding: 10px 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); font-size: 12.5px; line-height: 1.65; color: var(--dsw-alias-label-secondary); }
      .o2h-settings .o2h-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
      .o2h-settings .o2h-chip { padding: 2px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
      .o2h-settings .o2h-card { display: flex; flex-direction: column; gap: 14px; padding: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
      .o2h-settings .o2h-seg { display: inline-flex; padding: 3px; gap: 3px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); align-self: flex-start; }
      .o2h-settings .o2h-seg button { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); padding: 5px 12px; border-radius: 6px; font-size: 12.5px; cursor: pointer; }
      .o2h-settings .o2h-seg button[aria-pressed="true"] { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
      .o2h-settings .o2h-row { display: flex; flex-wrap: wrap; gap: 12px; }
      .o2h-settings .o2h-field { display: flex; flex-direction: column; gap: 6px; flex: 1 1 240px; min-width: 0; }
      .o2h-settings .o2h-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .o2h-settings .o2h-hint { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
      .o2h-settings input[type="text"], .o2h-settings select, .o2h-settings textarea { width: 100%; box-sizing: border-box; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; padding: 7px 10px; font-size: 12.5px; line-height: 1.5; outline: none; }
      .o2h-settings input[type="text"]:focus-visible, .o2h-settings select:focus-visible, .o2h-settings textarea:focus-visible { border-color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 24%, transparent); }
      .o2h-settings textarea { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; resize: vertical; }
      .o2h-settings textarea.o2h-sql { min-height: 260px; tab-size: 2; }
      .o2h-settings .o2h-check { display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px; line-height: 1.55; }
      .o2h-settings .o2h-check input { margin-top: 3px; }
      .o2h-settings details { border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 8px 12px; background: var(--dsw-alias-bg-layer-2); }
      .o2h-settings summary { cursor: pointer; font-size: 12.5px; color: var(--dsw-alias-label-primary); }
      .o2h-settings details textarea { margin-top: 10px; min-height: 220px; background: var(--dsw-alias-bg-layer-1); }
      .o2h-settings .o2h-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
      .o2h-settings button.o2h-primary, .o2h-settings button.o2h-secondary { border: 1px solid transparent; border-radius: 7px; font-size: 12.5px; padding: 7px 14px; cursor: pointer; }
      .o2h-settings button.o2h-primary { background: var(--dsw-alias-brand-primary); color: #fff; font-weight: 600; }
      .o2h-settings button.o2h-primary:disabled { opacity: .45; cursor: not-allowed; }
      .o2h-settings button.o2h-secondary { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l1); }
      .o2h-settings .o2h-status { font-size: 12px; color: var(--dsw-alias-label-secondary); min-height: 18px; }
      .o2h-settings .o2h-status[data-kind="error"] { color: var(--dsw-alias-state-error-primary); }
      .o2h-settings .o2h-status[data-kind="ok"] { color: var(--dsw-alias-state-success-primary); }
      .o2h-settings .o2h-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
    `

    function Workbench(props) {
      const t = props.t || ((key) => key)
      const close = props.close
      const start = props.start

      const [mode, setMode] = React.useState('single')
      const [objectType, setObjectType] = React.useState('auto')
      const [schema, setSchema] = React.useState('')
      const [compat, setCompat] = React.useState(true)
      const [sql, setSql] = React.useState('')
      const [srcDir, setSrcDir] = React.useState('')
      const [outDir, setOutDir] = React.useState('converted')
      const [status, setStatus] = React.useState({ text: '', kind: '' })

      const prompt = React.useMemo(
        () =>
          mode === 'single'
            ? buildSinglePrompt({ sql, objectType, schema, compat, engine: looksLikeMysql(sql) ? 'mysql' : 'oracle', drop: readDropStatements() })
            : buildBatchPrompt({ srcDir, outDir, schema, compat }),
        [mode, sql, objectType, schema, compat, srcDir, outDir],
      )

      const valid = mode === 'single' ? sql.trim().length > 0 : srcDir.trim().length > 0

      const onConvert = React.useCallback(() => {
        if (!valid) {
          setStatus({ text: t('needInput'), kind: 'error' })
          return
        }
        try {
          start(prompt)
          if (typeof close === 'function') close()
        } catch (error) {
          setStatus({ text: t('startFailed') + (error && error.message ? error.message : String(error)), kind: 'error' })
        }
      }, [valid, prompt, start, close, t])

      const onCopy = React.useCallback(() => {
        copyText(prompt).then(
          () => setStatus({ text: t('copied'), kind: 'ok' }),
          () => setStatus({ text: t('copyFailed'), kind: 'error' }),
        )
      }, [prompt, t])

      const onSample = React.useCallback(() => {
        setMode('single')
        setObjectType('fn')
        setSql(SAMPLE)
        setStatus({ text: t('sampleLoaded'), kind: 'ok' })
      }, [t])

      const onClear = React.useCallback(() => {
        setSql('')
        setStatus({ text: '', kind: '' })
      }, [])

      const typeOptions = [
        ['auto', t('auto')],
        ['fn', t('fn')],
        ['proc', t('proc')],
        ['pkg', t('pkg')],
        ['view', t('view')],
        ['mview', t('mview')],
        ['trigger', t('trigger')],
        ['table', t('table')],
        ['block', t('block')],
      ]

      return h(
        'div',
        { className: 'o2h o2h-settings' },
        h('style', null, CSS),
        h(
          'header',
          null,
          h('h2', null, t('title')),
          h('p', { className: 'o2h-sub' }, t('subtitle')),
          h(
            'div',
            { className: 'o2h-chips' },
            h('span', { className: 'o2h-chip' }, 'FUNCTION'),
            h('span', { className: 'o2h-chip' }, 'PROCEDURE'),
            h('span', { className: 'o2h-chip' }, 'PACKAGE'),
            h('span', { className: 'o2h-chip' }, 'VIEW'),
            h('span', { className: 'o2h-chip' }, 'TRIGGER'),
            h('span', { className: 'o2h-chip' }, 'PL/SQL'),
          ),
        ),
        h('div', { className: 'o2h-note' }, t('intro')),
        h(
          'section',
          { className: 'o2h-card' },
          h(
            'div',
            { className: 'o2h-seg', role: 'group', 'aria-label': t('mode') },
            h(
              'button',
              { type: 'button', 'aria-pressed': mode === 'single', onClick: () => setMode('single') },
              t('single'),
            ),
            h(
              'button',
              { type: 'button', 'aria-pressed': mode === 'batch', onClick: () => setMode('batch') },
              t('batch'),
            ),
          ),
          mode === 'single'
            ? h(
                React.Fragment,
                null,
                h(
                  'div',
                  { className: 'o2h-row' },
                  h(
                    'div',
                    { className: 'o2h-field' },
                    h('label', { className: 'o2h-label', htmlFor: 'o2h-type' }, t('objectType')),
                    h(
                      'select',
                      {
                        id: 'o2h-type',
                        value: objectType,
                        onChange: (event) => setObjectType(event.target.value),
                      },
                      typeOptions.map(([value, label]) => h('option', { key: value, value }, label)),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'o2h-field' },
                    h('label', { className: 'o2h-label', htmlFor: 'o2h-schema' }, t('schema')),
                    h('input', {
                      id: 'o2h-schema',
                      type: 'text',
                      value: schema,
                      placeholder: 'app',
                      onChange: (event) => setSchema(event.target.value),
                    }),
                    h('span', { className: 'o2h-hint' }, t('schemaHint')),
                  ),
                ),
                h(
                  'div',
                  { className: 'o2h-field' },
                  h('label', { className: 'o2h-label', htmlFor: 'o2h-sql' }, t('sourceSql')),
                  h('textarea', {
                    id: 'o2h-sql',
                    className: 'o2h-sql',
                    spellCheck: false,
                    value: sql,
                    placeholder: t('sqlPlaceholder'),
                    onChange: (event) => setSql(event.target.value),
                  }),
                  h(
                    'div',
                    { className: 'o2h-meta' },
                    h('span', null, sql.length + ' ' + t('chars')),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'o2h-secondary',
                        style: { padding: '2px 8px', fontSize: '11.5px' },
                        onClick: onSample,
                      },
                      t('sample'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'o2h-secondary',
                        style: { padding: '2px 8px', fontSize: '11.5px' },
                        onClick: onClear,
                      },
                      t('clear'),
                    ),
                  ),
                ),
              )
            : h(
                'div',
                { className: 'o2h-row' },
                h(
                  'div',
                  { className: 'o2h-field' },
                  h('label', { className: 'o2h-label', htmlFor: 'o2h-src' }, t('srcDir')),
                  h('input', {
                    id: 'o2h-src',
                    type: 'text',
                    value: srcDir,
                    placeholder: 'D:\\\\migration\\\\src',
                    onChange: (event) => setSrcDir(event.target.value),
                  }),
                  h('span', { className: 'o2h-hint' }, t('srcDirHint')),
                ),
                h(
                  'div',
                  { className: 'o2h-field' },
                  h('label', { className: 'o2h-label', htmlFor: 'o2h-out' }, t('outDir')),
                  h('input', {
                    id: 'o2h-out',
                    type: 'text',
                    value: outDir,
                    placeholder: 'converted',
                    onChange: (event) => setOutDir(event.target.value),
                  }),
                  h('span', { className: 'o2h-hint' }, t('outDirHint')),
                ),
              ),
          h(
            'label',
            { className: 'o2h-check' },
            h('input', {
              type: 'checkbox',
              checked: compat,
              onChange: (event) => setCompat(event.target.checked),
            }),
            h('span', null, h('strong', null, t('compat')), h('br'), h('span', { className: 'o2h-hint' }, t('compatHint'))),
          ),
          h(
            'details',
            null,
            h('summary', null, t('preview') + ' · ' + t('previewHint')),
            h('textarea', { readOnly: true, value: prompt, spellCheck: false, 'aria-label': t('preview') }),
          ),
          h(
            'div',
            { className: 'o2h-actions' },
            h('button', { type: 'button', className: 'o2h-primary', disabled: !valid, onClick: onConvert }, t('convert')),
            h('button', { type: 'button', className: 'o2h-secondary', onClick: onCopy }, t('copy')),
            h('span', { className: 'o2h-hint' }, t('preset')),
          ),
          h('div', { className: 'o2h-status', 'data-kind': status.kind, role: 'status' }, status.text),
          h('div', { className: 'o2h-hint' }, t('flowHint')),
        ),
      )
    }

    const PAGE_CSS = `
.o2p { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 1.5; }
.o2p-shell { box-sizing: border-box; display: flex; flex: 1; flex-direction: column; gap: 10px; width: 100%; max-width: none; min-height: 0; margin: 0 auto; padding: 14px 24px 0; }
[data-platform='darwin'] .o2p-shell { padding-top: calc(12px + var(--dsh-frame-top-clearance, 0px)); }
.o2p-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.o2p-titleRow { display: flex; align-items: center; gap: 8px; min-width: 0; }
.o2p-badge { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 30px; height: 30px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.o2p-title { margin: 0; font-size: 16px; line-height: 22px; font-weight: 600; letter-spacing: -0.01em; }
.o2p-topActions { display: flex; align-items: center; gap: 6px; }
.o2p-manage { height: 26px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11.5px; cursor: pointer; }
.o2p-manage:hover { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); color: var(--dsw-alias-label-primary); }
.o2p-body { display: grid; flex: 1; grid-template-columns: 252px minmax(0, 1fr) minmax(0, 1fr); gap: 10px; min-height: 0; }
.o2p-list { display: flex; flex-direction: column; min-height: 0; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.o2p-explorerHead { display: flex; flex: none; align-items: center; gap: 8px; padding: 9px 10px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.o2p-explorerTitle { display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; color: var(--dsw-alias-label-primary); font-size: 11px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.o2p-explorerTitle svg { flex: none; color: #2563eb; }
.o2p-explorerBtn { display: grid; flex: none; place-items: center; width: 24px; height: 24px; margin-left: auto; padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.o2p-explorerBtn:hover:not(:disabled) { border-color: color-mix(in srgb, #2563eb 35%, var(--dsw-alias-border-l2)); color: #2563eb; background: color-mix(in srgb, #2563eb 7%, transparent); }
.o2p-explorerBtn:disabled { opacity: .4; cursor: not-allowed; }
.o2p-treeIcon { display: grid; flex: none; place-items: center; width: 16px; height: 16px; color: #2563eb; }
.o2p-fileStatus { display: grid; flex: none; place-items: center; width: 15px; height: 15px; color: var(--dsw-alias-label-secondary); }
.o2p-fileStatus[data-status='ok'] { color: #10b981; }
.o2p-fileStatus[data-status='error'] { color: #dc2626; }
.o2p-fileStatus[data-status='warn'] { color: #d97706; }
.o2p-fileStatus i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.o2p-groupHeadLeft svg { flex: none; color: #2563eb; }
.o2p-listHead { display: flex; gap: 6px; padding: 10px 8px 4px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.o2p-search { box-sizing: border-box; flex: 1; min-width: 0; height: 26px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; outline: none; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 11.5px; }
.o2p-search:focus { border-color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
.o2p-fileList { display: flex; flex: 1; flex-direction: column; gap: 2px; min-height: 0; overflow: auto; padding: 6px; }
.o2p-file { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.o2p-file:hover { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
.o2p-fileActive { background: var(--dsw-alias-bg-layer-2); }
.o2p-file input { margin: 0; }
.o2p-fileName { flex: 1; min-width: 0; overflow: hidden; color: var(--dsw-alias-label-primary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.o2p-fileNameInput { flex: 1; min-width: 0; height: 22px; padding: 0 6px; border: 1px solid #2563eb; border-radius: 5px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, #2563eb 16%, transparent); }
.o2p-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
.o2p-menu { position: fixed; z-index: 60; display: flex; flex-direction: column; min-width: 116px; padding: 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); box-shadow: 0 10px 28px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent); }
.o2p-menuItem { width: 100%; padding: 6px 10px; border: 0; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.o2p-menuItem:hover { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
.o2p-menuItem:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }
.o2p-dot[data-status='ok'] { background: var(--dsw-alias-state-success-primary); }
.o2p-dot[data-status='warn'] { background: var(--dsw-alias-state-warn-primary); }
.o2p-dot[data-status='error'] { background: var(--dsw-alias-state-error-primary); }
.o2p-listCount { flex: none; align-self: center; color: #2563eb; font-size: 11px; font-weight: 600; white-space: nowrap; }
.o2p-countOnly { padding: 0; border-top: 0; }
.o2p-groupHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 6px 2px 2px; padding: 2px 6px; border-radius: 4px; background: color-mix(in srgb, #2563eb 6%, transparent); color: #1d4ed8; font-size: 10px; font-weight: 700; letter-spacing: .04em; cursor: pointer; user-select: none; }
.o2p-groupHead:hover { background: color-mix(in srgb, #2563eb 12%, transparent); }
.o2p-groupHeadLeft { display: flex; align-items: center; gap: 4px; }
.o2p-groupChevron { display: inline-block; width: 8px; font-size: 9px; text-align: center; }
.o2p-groupCount { color: var(--dsw-alias-label-secondary); font-weight: 600; }
.o2p-typeWrap { position: relative; flex: none; }
.o2p-typePop { position: fixed; z-index: 40; display: flex; flex-direction: column; gap: 8px; width: 220px; max-height: 320px; padding: 10px; overflow: auto; border: 1px solid color-mix(in srgb, #2563eb 20%, var(--dsw-alias-border-l2)); border-radius: 10px; background: var(--dsw-alias-bg-base); box-shadow: 0 12px 30px rgba(15, 23, 42, .16); }
.o2p-typePopHead { color: #1e3a8a; font-size: 11px; font-weight: 700; }
.o2p-typePopList { display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow: auto; }
.o2p-typePopFoot { display: flex; gap: 8px; }
.o2p-typePopFoot > button { flex: 1; height: 26px; }
.o2p-typeMenuActions .o2p-ghost { height: 24px; padding: 0 9px; border: 1px solid color-mix(in srgb, #2563eb 25%, var(--dsw-alias-border-l2)); border-radius: 6px; background: color-mix(in srgb, #2563eb 6%, transparent); color: #1d4ed8; font-size: 11px; }
.o2p-typeMenuActions .o2p-ghost:hover { background: color-mix(in srgb, #2563eb 14%, transparent); color: #1d4ed8; }
.o2p-typePopFoot > .o2p-primary { background: #2563eb; color: #fff; }
.o2p-typePopFoot > .o2p-primary:hover { background: #1d4ed8; }
.o2p-typePopFoot > .o2p-secondary { border-color: color-mix(in srgb, #2563eb 25%, var(--dsw-alias-border-l2)); }
.o2p-typeMenuActions { display: flex; gap: 6px; }
.o2p-typeOption { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-primary); font-size: 11px; }
.o2p-typeOption input { margin: 0; }
.o2p-listFoot { padding: 6px 10px; border-top: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); font-size: 11px; }
.o2p-sourceRows { display: flex; flex-direction: column; gap: 8px; padding: 10px 8px 10px; }
.o2p-sourceRow { display: flex; gap: 6px; }
.o2p-sourceSelect { box-sizing: border-box; flex: 1 1 0; min-width: 0; height: 26px; padding: 0 4px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; outline: none; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.o2p-sourceSelect:focus { border-color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
.o2p-target { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-top: 1px solid var(--dsw-alias-border-l2); }
.o2p-targetLabel { color: var(--dsw-alias-label-secondary); font-size: 11px; }
.o2p-target .o2p-select, .o2p-target .o2p-input { width: 100%; }
.o2p-schemaRow { display: flex; align-items: center; gap: 6px; }
.o2p-schemaWrap { position: relative; display: flex; flex: 1; min-width: 0; }
.o2p-schemaWrap .o2p-input { width: 100%; padding-right: 28px; }
.o2p-schemaToggle { position: absolute; top: 1px; right: 1px; bottom: 1px; width: 26px; border: 0; border-radius: 0 6px 6px 0; background-color: transparent; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%2364748b' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/></svg>"); background-repeat: no-repeat; background-position: center; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11px; cursor: pointer; }
.o2p-schemaToggle:hover { background-color: color-mix(in srgb, #2563eb 10%, transparent); }
.o2p-select, .o2p-sourceSelect { appearance: none; -webkit-appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%2364748b' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/></svg>"); background-repeat: no-repeat; background-position: right 8px center; padding-right: 22px; }
.o2p-schemaPop { position: fixed; z-index: 40; display: flex; flex-direction: column; gap: 2px; width: 220px; max-height: 280px; overflow: auto; padding: 6px; border: 1px solid color-mix(in srgb, #2563eb 20%, var(--dsw-alias-border-l2)); border-radius: 10px; background: var(--dsw-alias-bg-base); box-shadow: 0 12px 30px rgba(15, 23, 42, .16); }
.o2p-schemaItem { padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 11.5px; text-align: left; cursor: pointer; }
.o2p-schemaItem:hover { background: color-mix(in srgb, #2563eb 10%, transparent); }
.o2p-schemaEmpty { padding: 8px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.o2p-pane { display: flex; flex-direction: column; min-height: 0; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.o2p-paneHead { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 36px; padding: 4px 8px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.o2p-paneTitle { margin: 0; font-size: 12px; font-weight: 600; }
.o2p-tools { display: flex; flex-wrap: nowrap; gap: 5px; margin-left: auto; }
.o2p-btn { height: 26px; padding: 0 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 11px; white-space: nowrap; cursor: pointer; }
.o2p-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
.o2p-btn:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
.o2p-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.o2p-btnPrimary { border-color: transparent; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); font-weight: 600; }
.o2p-btnIcon { width: 24px; padding: 0; font-size: 14px; line-height: 22px; text-align: center; }
.o2p-btnPrimary:hover:not(:disabled) { background: var(--dsw-alias-label-primary); opacity: 0.9; }
.o2p-editor { display: flex; flex: 1; min-height: 0; background: var(--dsw-alias-bg-base); }
.o2p-editorPane { position: relative; display: flex; flex: 1; min-width: 0; min-height: 0; }
.o2p-highlight { position: absolute; inset: 0; box-sizing: border-box; margin: 0; padding: 9px 12px; overflow: hidden; color: var(--dsw-alias-label-primary); font-family: Consolas, "Cascadia Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 20px; white-space: pre; tab-size: 2; pointer-events: none; }
.o2p-highlight .sql-kw { color: #1d4ed8; font-weight: 600; }
.o2p-highlight .sql-str { color: #15803d; }
.o2p-highlight .sql-num { color: #c2410c; }
.o2p-highlight .sql-com { color: #8b949e; font-style: italic; }
.o2p-highlight .sql-ident { color: #7c3aed; }
.o2p-textarea.o2p-textareaOverlay { position: relative; z-index: 1; background: transparent; color: transparent; caret-color: var(--dsw-alias-label-primary); }
.o2p-textarea.o2p-textareaOverlay::selection { background: color-mix(in srgb, #2563eb 28%, transparent); color: transparent; }
.o2p-textarea.o2p-textareaOverlay::placeholder { color: var(--dsw-alias-label-secondary); }
.o2p-gutter { flex: none; box-sizing: border-box; width: 44px; padding: 9px 8px; overflow: hidden; border-right: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-family: Consolas, "Cascadia Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 20px; text-align: right; white-space: pre; user-select: none; }
.o2p-textarea { box-sizing: border-box; flex: 1; min-width: 0; padding: 9px 12px; border: 0; outline: none; resize: none; background: transparent; color: var(--dsw-alias-label-primary); font-family: Consolas, "Cascadia Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 20px; tab-size: 2; }
.o2p-codeScroll { display: flex; flex: 1; min-height: 0; overflow: auto; background: var(--dsw-alias-bg-base); }
.o2p-code { margin: 0; padding: 9px 12px; color: var(--dsw-alias-label-primary); font-family: Consolas, "Cascadia Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 20px; white-space: pre; }
.o2p-code .sql-kw { color: #1d4ed8; font-weight: 600; }
.o2p-code .sql-str { color: #15803d; }
.o2p-code .sql-num { color: #c2410c; }
.o2p-code .sql-com { color: #8b949e; font-style: italic; }
.o2p-code .sql-ident { color: #7c3aed; }
.o2p-code .sql-type { color: #0f766e; }
.o2p-highlight .sql-type { color: #0f766e; }
.o2p-emptyResult { margin: 0; padding: 24px 16px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.o2p-listEmpty { margin: 0; padding: 18px 10px; color: var(--dsw-alias-label-secondary); font-size: 11.5px; line-height: 1.6; text-align: center; }
.o2p-emptyState { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 10px; min-height: 0; padding: 24px; text-align: center; }
.o2p-emptyIcon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; background: color-mix(in srgb, #2563eb 10%, transparent); color: #2563eb; }
.o2p-emptyTitle { margin: 0; font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.o2p-emptyHint { max-width: 420px; margin: 0; color: var(--dsw-alias-label-secondary); font-size: 11.5px; line-height: 1.7; }
/* ==== 读取 / 转换 / 执行 动效 ==== */
@keyframes o2p-barSlide { 0% { transform: translateX(-110%); } 100% { transform: translateX(340%); } }
@keyframes o2p-sheen { 0% { left: -60%; } 100% { left: 130%; } }
@keyframes o2p-spinRing { to { transform: rotate(360deg); } }
@keyframes o2p-scanDown { 0% { top: -12%; opacity: 0; } 10% { opacity: .9; } 90% { opacity: .9; } 100% { top: 104%; opacity: 0; } }
@keyframes o2p-skelPulse { 0%, 100% { opacity: .4; } 50% { opacity: .85; } }
@keyframes o2p-execFlow { 0% { left: 0; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { left: calc(100% - 6px); opacity: 0; } }
.o2p-loadBar { position: relative; flex: none; height: 2px; overflow: hidden; background: color-mix(in srgb, #2563eb 12%, transparent); }
.o2p-loadBar > span { position: absolute; top: 0; bottom: 0; left: 0; width: 32%; border-radius: 2px; background: linear-gradient(90deg, transparent, #2563eb, #60a5fa, transparent); animation: o2p-barSlide 1.15s cubic-bezier(.4, 0, .2, 1) infinite; }
.o2p-loadBar[data-tone='exec'] > span { background: linear-gradient(90deg, transparent, #059669, #34d399, transparent); }
.o2p-loadBar[data-tone='read'] { height: 3px; background: color-mix(in srgb, #2563eb 16%, transparent); }
.o2p-scan { display: flex; flex: 1; flex-direction: column; gap: 7px; padding: 10px 8px; min-height: 0; }
.o2p-scanHead { display: flex; align-items: center; gap: 7px; margin-bottom: 2px; color: #1d4ed8; font-size: 11.5px; font-weight: 600; letter-spacing: .01em; }
.o2p-scanHead > i { width: 7px; height: 7px; border-radius: 50%; background: #2563eb; animation: o2p-pulse 1.35s ease-out infinite; }
.o2p-skel { position: relative; flex: none; height: 23px; overflow: hidden; border-radius: 6px; background: color-mix(in srgb, #2563eb 7%, transparent); animation: o2p-skelPulse 1.7s ease-in-out infinite; }
.o2p-skel::after { content: ''; position: absolute; top: 0; bottom: 0; left: -60%; width: 46%; background: linear-gradient(90deg, transparent, color-mix(in srgb, #60a5fa 55%, transparent), transparent); animation: o2p-sheen 1.35s ease-in-out infinite; }
.o2p-fileBusy { position: relative; overflow: hidden; background: color-mix(in srgb, #2563eb 10%, transparent) !important; }
.o2p-fileBusy::after { content: ''; position: absolute; top: 0; bottom: 0; left: -60%; width: 42%; background: linear-gradient(90deg, transparent, color-mix(in srgb, #60a5fa 45%, transparent), transparent); animation: o2p-sheen 1.1s linear infinite; pointer-events: none; }
.o2p-fileStatus[data-busy='true'] i { width: 11px; height: 11px; border-radius: 50%; background: none; border: 1.6px solid color-mix(in srgb, #2563eb 28%, transparent); border-top-color: #2563eb; animation: o2p-spinRing .75s linear infinite; }
.o2p-fileStatus[data-busy='true'][data-tone='exec'] i { border-color: color-mix(in srgb, #10b981 26%, transparent); border-top-color: #10b981; }
.o2p-file[data-tone='exec'].o2p-fileBusy { background: color-mix(in srgb, #10b981 12%, transparent) !important; }
.o2p-file[data-tone='exec'].o2p-fileBusy::after { background: linear-gradient(90deg, transparent, color-mix(in srgb, #34d399 48%, transparent), transparent); }
.o2p-pane { position: relative; }
.o2p-paneExec::after { background: linear-gradient(90deg, #059669, #34d399, #6ee7b7, #059669) !important; background-size: 200% 100% !important; }
.o2p-scanline { position: absolute; left: 0; right: 0; height: 38%; z-index: 4; pointer-events: none; background: linear-gradient(180deg, transparent, color-mix(in srgb, #38bdf8 16%, transparent), transparent); animation: o2p-scanDown 1.9s ease-in-out infinite; }
.o2p-btnBusy::before { content: ''; display: inline-block; width: 11px; height: 11px; margin-right: 6px; vertical-align: -1px; border-radius: 50%; border: 1.6px solid color-mix(in srgb, currentColor 28%, transparent); border-top-color: currentColor; animation: o2p-spinRing .75s linear infinite; }
.o2p-execFlow { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; z-index: 4; pointer-events: none; background: color-mix(in srgb, #10b981 16%, transparent); }
.o2p-execFlow::after { content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 6px; border-radius: 3px; background: #10b981; box-shadow: 0 0 8px #34d399; animation: o2p-execFlow 1.25s ease-in-out infinite; }
/* ==== 悬浮作业 HUD（读取 / 转换 / 执行） ==== */
@keyframes o2p-hudIn { from { opacity: 0; transform: translate(-50%, -14px) scale(.94); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
@keyframes o2p-hudFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes o2p-hudSpin { to { transform: rotate(360deg); } }
.o2p-hudLayer { position: absolute; top: 74px; left: 50%; z-index: 90; transform: translateX(-50%); pointer-events: none; animation: o2p-hudIn .28s cubic-bezier(.2, .9, .3, 1) both; }
.o2p-hud { position: relative; display: flex; align-items: center; gap: 10px; min-width: 340px; max-width: min(640px, 92vw); padding: 9px 14px 9px 12px; overflow: hidden; border-radius: 14px; border: 1px solid color-mix(in srgb, #2563eb 26%, transparent); background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #fff) 86%, transparent); backdrop-filter: blur(14px) saturate(150%); box-shadow: 0 20px 48px rgba(15, 23, 42, .22), 0 2px 8px rgba(15, 23, 42, .08); pointer-events: auto; animation: o2p-hudFloat 3.4s ease-in-out infinite; }
.o2p-hud::after { content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px; background: linear-gradient(90deg, #2563eb, #60a5fa, #a78bfa, #2563eb); background-size: 300% 100%; animation: o2p-flow 2.6s linear infinite; -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; }
.o2p-hudAura { position: absolute; top: 50%; left: -18px; width: 96px; height: 96px; margin-top: -48px; border-radius: 50%; background: conic-gradient(from 0deg, transparent 0deg, rgba(37, 99, 235, .55) 90deg, transparent 190deg); filter: blur(12px); opacity: .75; animation: o2p-hudSpin 2.8s linear infinite; pointer-events: none; }
.o2p-hudOrb { position: relative; z-index: 1; display: grid; flex: none; place-items: center; width: 38px; height: 38px; border-radius: 50%; color: #1d4ed8; background: radial-gradient(circle at 50% 45%, color-mix(in srgb, #2563eb 26%, transparent), transparent 74%); box-shadow: 0 6px 16px rgba(37, 99, 235, .26); }
.o2p-hudRing { position: absolute; inset: 3px; border-radius: 50%; border: 2px solid color-mix(in srgb, #2563eb 24%, transparent); border-top-color: #2563eb; animation: o2p-spinRing .95s linear infinite; }
.o2p-hudRingB { inset: -2px; border-width: 1.6px; border-color: color-mix(in srgb, #60a5fa 20%, transparent); border-bottom-color: #60a5fa; animation: o2p-spinRing 1.7s linear infinite reverse; }
.o2p-hudText { display: flex; flex: 1; flex-direction: column; gap: 1px; min-width: 0; }
.o2p-hudText b { color: var(--dsw-alias-label-primary); font-size: 12.5px; font-weight: 700; white-space: nowrap; }
.o2p-hudText small { overflow: hidden; color: var(--dsw-alias-label-secondary); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.o2p-hudBar { position: relative; flex: none; width: 96px; height: 5px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, #2563eb 14%, transparent); }
.o2p-hudBar i { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 999px; background: linear-gradient(90deg, #2563eb, #60a5fa); box-shadow: 0 0 10px rgba(37, 99, 235, .45); transition: width .4s ease; }
.o2p-hudBar.isIndeterminate i { width: 38%; background: linear-gradient(90deg, transparent, #2563eb, #60a5fa, transparent); animation: o2p-barSlide 1.25s cubic-bezier(.4, 0, .2, 1) infinite; }
.o2p-hudTimer { flex: none; min-width: 30px; color: #1d4ed8; font-size: 11.5px; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }
.o2p-hud[data-kind='execute'] { border-color: color-mix(in srgb, #10b981 30%, transparent); }
.o2p-hud[data-kind='execute']::after { background: linear-gradient(90deg, #059669, #34d399, #6ee7b7, #059669); background-size: 300% 100%; }
.o2p-hud[data-kind='execute'] .o2p-hudOrb { color: #059669; }
.o2p-hud[data-kind='execute'] .o2p-hudRing { border-color: color-mix(in srgb, #10b981 20%, transparent); border-top-color: #10b981; }
.o2p-hud[data-kind='execute'] .o2p-hudRingB { border-color: color-mix(in srgb, #34d399 16%, transparent); border-bottom-color: #34d399; }
.o2p-hud[data-kind='execute'] .o2p-hudBar i { background: linear-gradient(90deg, #059669, #34d399); }
.o2p-hud[data-kind='execute'] .o2p-hudTimer { color: #047857; }
.o2p-hudStop { flex: none; width: 16px; height: 16px; padding: 0; border: 0; border-radius: 3px; background: #ef4444; cursor: pointer; transition: background .15s ease, transform .15s ease; }
.o2p-hudStop:hover { background: #dc2626; }
.o2p-hudStop:active { transform: scale(.94); }
.o2p-hud[data-kind='execute'] .o2p-hudAura { background: conic-gradient(from 0deg, transparent 0deg, rgba(16, 185, 129, .5) 90deg, transparent 190deg); }
.o2p-hud[data-restored='true'] { box-shadow: 0 22px 52px rgba(15, 23, 42, .26), 0 0 0 1px rgba(37, 99, 235, .18) inset; }
/* 作业进行中：内容区整体锁定（顶部导航不受影响，仍可切换 tab） */
.o2p-lockWrap { position: relative; display: flex; flex: 1; flex-direction: column; min-height: 0; }
.o2p-lockVeil { display: none; position: absolute; inset: 0; z-index: 80; cursor: progress; background: color-mix(in srgb, var(--dsw-alias-bg-base, #f4f7fd) 28%, transparent); backdrop-filter: blur(1.2px) saturate(.92); }
.o2p-lockWrap[data-locked='true'] > .o2p-lockVeil { display: block; }
.o2p-lockWrap[data-locked='true'] { cursor: progress; }
@media (prefers-reduced-motion: reduce) {
  .o2p-loadBar > span, .o2p-skel, .o2p-skel::after, .o2p-fileBusy::after, .o2p-scanline, .o2p-btnBusy::before,
  .o2p-fileStatus[data-busy='true'] i, .o2p-scanHead > i, .o2p-execFlow::after,
  .o2p-hudLayer, .o2p-hud, .o2p-hud::after, .o2p-hudAura, .o2p-hudRing, .o2p-hudRingB, .o2p-hudBar.isIndeterminate i { animation: none; }
}
.o2p-paneFoot { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 8px; height: 26px; padding: 0 10px; border-top: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); font-size: 11px; }
.o2p-actionbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 0 10px; }
.o2p-actionRight { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.o2p-select, .o2p-input { box-sizing: border-box; height: 26px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; outline: none; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 11.5px; }
.o2p-input { width: 120px; }
.o2p-select:focus, .o2p-input:focus { border-color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
.o2p-toggle { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-primary); font-size: 11.5px; white-space: nowrap; }
.o2p-toggle input { margin: 0; }
.o2p-statusbar { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 10px; height: 24px; padding: 0 2px 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.o2p-statusLeft { display: flex; align-items: center; gap: 6px; min-width: 0; }
.o2p-statusDot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
.o2p-statusDot[data-kind='ok'] { background: var(--dsw-alias-state-success-primary); }
.o2p-statusDot[data-kind='warn'] { background: var(--dsw-alias-state-warn-primary); }
.o2p-statusDot[data-kind='error'] { background: var(--dsw-alias-state-error-primary); }
.o2p-statusText { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.o2p-statusText[data-kind='error'] { color: var(--dsw-alias-state-error-primary); }
.o2p-modalOverlay { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; padding: 24px; background: color-mix(in srgb, var(--dsw-alias-label-primary) 18%, transparent); }
.o2p-modal { display: flex; flex-direction: column; width: min(560px, 100%); max-height: min(72vh, 640px); overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-base); box-shadow: 0 16px 48px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent); }
.o2p-modalHead { display: flex; align-items: center; justify-content: space-between; gap: 10px; height: 38px; padding: 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.o2p-modalTitle { margin: 0; font-size: 12px; font-weight: 600; }
.o2p-modalStatus { flex: 0 1 auto; max-width: 240px; overflow: hidden; color: var(--dsw-alias-label-secondary); font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.o2p-modalStatus[data-kind='ok'] { color: var(--dsw-alias-state-success-primary); }
.o2p-modalStatus[data-kind='error'] { color: var(--dsw-alias-state-error-primary); }
.o2p-connView { box-sizing: border-box; display: flex; flex: 1; flex-direction: column; gap: 10px; min-height: 0; overflow: auto; padding: 12px 14px; }
.o2p-conn { display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; }
.o2p-connMain { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
.o2p-connName { font-size: 13px; font-weight: 600; }
.o2p-connMeta { color: var(--dsw-alias-label-secondary); font-size: 11.5px; overflow-wrap: anywhere; }
.o2p-connActions { display: flex; flex: none; gap: 2px; }
.o2p-connForm { display: flex; flex-direction: column; gap: 10px; }
.o2h-wizard.o2p-connDialog { position: relative; width: min(620px, 100%); }
.o2h-wizardBody.o2p-connDialogBody { display: flex; flex-direction: column; gap: 12px; padding: 16px 22px; }
.o2p-connDialogBody .o2p-connRow { gap: 12px; }
.o2h-connToast { position: absolute; top: 14px; left: 50%; z-index: 6; display: flex; align-items: center; gap: 8px; max-width: min(340px, 60%); padding: 8px 13px; border: 1px solid rgba(16, 185, 129, .4); border-radius: 10px; background: rgba(5, 18, 15, .95); color: #bbf7d0; font-size: 11.5px; line-height: 1.4; box-shadow: 0 12px 30px rgba(0, 0, 0, .35); transform: translateX(-50%); animation: o2h-toastIn .18s ease; pointer-events: none; }
.o2h-connToast[data-kind='error'] { border-color: rgba(239, 68, 68, .45); background: rgba(24, 8, 10, .96); color: #fecaca; }
.o2h-connToast svg { flex: none; }
.o2h-connToastText { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.o2p-passwordWrap { position: relative; width: 100%; }
.o2p-passwordWrap .o2p-passwordInput { width: 100%; padding-right: 34px; }
.o2p-eyeBtn { position: absolute; top: 50%; right: 5px; transform: translateY(-50%); display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #94a3b8); cursor: pointer; }
.o2p-eyeBtn:hover { background: rgba(148, 163, 184, .18); color: var(--dsw-alias-label-primary, #475569); }
.o2p-connNote { margin: 5px 0 0; font-size: 11px; line-height: 1.45; color: #b45309; }
.o2p-connRow { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.o2p-connRow.o2p-connRowSingle { grid-template-columns: minmax(0, 1fr); }
.o2p-connField { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.o2p-connField .o2p-input, .o2p-connField .o2p-select { width: 100%; height: 30px; }
.o2p-connEmpty { margin: 0; padding: 24px 12px; text-align: center; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.o2p-connFoot { display: flex; gap: 8px; }
.o2p-connFoot > .o2p-primary, .o2p-connFoot > .o2p-secondary { flex: 1; }
.o2p-connFoot > .o2p-ghost { flex: none; }
.o2p-label { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 14px; }
.o2p-primary { display: inline-flex; align-items: center; justify-content: center; height: 30px; padding: 0 12px; border: 0; border-radius: 7px; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.o2p-primary:hover:not(:disabled) { opacity: 0.9; }
.o2p-primary:disabled { opacity: 0.45; cursor: not-allowed; }
.o2p-secondary { display: inline-flex; align-items: center; justify-content: center; height: 30px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; }
.o2p-secondary:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
.o2p-ghost { height: 24px; padding: 0 8px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11px; cursor: pointer; }
.o2p-ghost:hover { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); color: var(--dsw-alias-label-primary); }
.o2p-ghost:focus-visible, .o2p-primary:focus-visible, .o2p-secondary:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
@media (max-width: 1100px) {
  .o2p-body { grid-template-columns: 232px minmax(0, 1fr) minmax(0, 1fr); }
}
@media (max-width: 860px) {
  .o2p-shell { padding: 12px 18px 0; }
  .o2p-body { grid-template-columns: minmax(0, 1fr); }
  .o2p-list { max-height: 180px; }
  .o2p-pane { min-height: 320px; }
}
@media (max-width: 560px) {
  .o2p-shell { padding: 10px 12px 0; }
}
.o2p-badge { border-color: transparent; background: linear-gradient(135deg, #2563eb, #60a5fa); color: #fff; box-shadow: 0 2px 8px rgba(37, 99, 235, 0.28); }
.o2p-pane { border-color: color-mix(in srgb, #2563eb 14%, var(--dsw-alias-border-l2)); box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
.o2p-paneHead { background: linear-gradient(180deg, color-mix(in srgb, #2563eb 7%, var(--dsw-alias-bg-layer-1)), var(--dsw-alias-bg-layer-1)); border-bottom-color: color-mix(in srgb, #2563eb 12%, var(--dsw-alias-border-l2)); }
.o2p-paneTitle { position: relative; padding-left: 10px; color: #1e3a8a; }
.o2p-paneTitle::before { content: ''; position: absolute; left: 0; top: 50%; width: 3px; height: 12px; margin-top: -6px; border-radius: 2px; background: linear-gradient(180deg, #2563eb, #60a5fa); }
.o2p-btnPrimary { background: #2563eb; border-color: #2563eb; color: #fff; }
.o2p-btnPrimary:hover:not(:disabled) { background: #1d4ed8; border-color: #1d4ed8; opacity: 1; }
.o2p-btn:hover:not(:disabled) { background: color-mix(in srgb, #2563eb 9%, transparent); border-color: color-mix(in srgb, #2563eb 35%, var(--dsw-alias-border-l2)); }
.o2p-fileActive { background: color-mix(in srgb, #2563eb 9%, var(--dsw-alias-bg-layer-1)); box-shadow: inset 2px 0 0 #2563eb; }
.o2p-file:hover { background: color-mix(in srgb, #2563eb 6%, transparent); }
.o2p-list { border-color: color-mix(in srgb, #2563eb 14%, var(--dsw-alias-border-l2)); }
.o2p-listHead { background: color-mix(in srgb, #2563eb 5%, var(--dsw-alias-bg-layer-1)); }
.o2p-target { background: color-mix(in srgb, #2563eb 3%, var(--dsw-alias-bg-layer-1)); }
.o2p-gutter { background: color-mix(in srgb, #2563eb 4%, var(--dsw-alias-bg-layer-2)); }
.o2p-countOnly { color: #2563eb; font-weight: 600; }
.o2p-manage { color: #2563eb; border-color: color-mix(in srgb, #2563eb 35%, var(--dsw-alias-border-l2)); background: color-mix(in srgb, #2563eb 6%, transparent); }
.o2p-manage:hover { background: #2563eb; color: #fff; border-color: #2563eb; }
.o2p-statusText[data-kind='ok'] { color: #15803d; }
.o2p-modal { border-color: color-mix(in srgb, #2563eb 16%, var(--dsw-alias-border-l2)); }
.o2p-modalHead { background: linear-gradient(180deg, color-mix(in srgb, #2563eb 7%, var(--dsw-alias-bg-base)), var(--dsw-alias-bg-base)); }
.o2p-introText { flex: 1 1 260px; min-width: 0; color: var(--dsw-alias-label-secondary); font-size: 11.5px; }
.o2p-introChips { display: flex; flex-wrap: wrap; gap: 6px; }
.o2p-introChip { padding: 2px 8px; border-radius: 999px; background: color-mix(in srgb, #2563eb 10%, transparent); color: #1d4ed8; font-size: 10.5px; font-weight: 600; }
@keyframes o2p-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes o2p-pulse { 0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, .5); } 100% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); } }
@keyframes o2p-flow { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
.o2p { background-image: radial-gradient(color-mix(in srgb, #2563eb 7%, transparent) 1px, transparent 1px); background-size: 24px 24px; }
.o2p-head { padding: 8px 12px; border-radius: 10px; background: color-mix(in srgb, #2563eb 5%, transparent); backdrop-filter: blur(10px); }
.o2p-headInfo { display: flex; flex: 1 1 320px; align-items: center; flex-wrap: wrap; gap: 8px 10px; min-width: 0; }
.o2p-titleText { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.o2p-titleLine { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; min-width: 0; }
.o2p-subRow { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
.o2p-list, .o2p-pane { animation: o2p-rise .4s ease both; }
.o2p-body > .o2p-list { animation-delay: .02s; }
.o2p-body > .o2p-pane:nth-of-type(1) { animation-delay: .08s; }
.o2p-body > .o2p-pane:nth-of-type(2) { animation-delay: .14s; }
.o2p-file { transition: background .15s ease, transform .15s ease; }
.o2p-file:hover { transform: translateX(2px); }
.o2p-btn, .o2p-manage, .o2p-primary, .o2p-secondary { transition: background .15s ease, border-color .15s ease, color .15s ease, transform .1s ease; }
.o2p-btn:active:not(:disabled), .o2p-manage:active, .o2p-primary:active, .o2p-secondary:active { transform: translateY(1px); }
.o2p-statusDot[data-kind='ok'] { animation: o2p-pulse .6s ease-out; }
.o2p-paneBusy { position: relative; }
.o2p-paneBusy::after { content: ''; position: absolute; inset: 0; border-radius: 8px; padding: 1px; background: linear-gradient(90deg, #2563eb, #60a5fa, #a78bfa, #2563eb); background-size: 200% 100%; animation: o2p-flow 1.2s linear infinite; -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; }
.o2p-typeBadge { flex: none; padding: 1px 5px; border-radius: 4px; font-size: 9px; font-weight: 700; letter-spacing: .02em; line-height: 14px; }
.o2p-typeBadge-table { color: #1d4ed8; background: color-mix(in srgb, #2563eb 12%, transparent); }
.o2p-typeBadge-view { color: #0e7490; background: color-mix(in srgb, #06b6d4 12%, transparent); }
.o2p-typeBadge-fn { color: #6d28d9; background: color-mix(in srgb, #8b5cf6 12%, transparent); }
.o2p-typeBadge-proc { color: #4338ca; background: color-mix(in srgb, #6366f1 12%, transparent); }
.o2p-typeBadge-pkg { color: #7e22ce; background: color-mix(in srgb, #a855f7 12%, transparent); }
.o2p-typeBadge-trg { color: #c2410c; background: color-mix(in srgb, #f97316 12%, transparent); }
.o2p-typeBadge-type { color: #0f766e; background: color-mix(in srgb, #14b8a6 12%, transparent); }
.o2p-typeBadge-seq { color: #475569; background: color-mix(in srgb, #64748b 12%, transparent); }
.o2p-typeBadge-mv { color: #15803d; background: color-mix(in srgb, #22c55e 12%, transparent); }
.o2p-typeBadge-obj, .o2p-typeBadge-sql { color: #475569; background: color-mix(in srgb, #64748b 10%, transparent); }
.o2p-welcome { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 24px; border: 1px solid color-mix(in srgb, #2563eb 16%, var(--dsw-alias-border-l2)); border-radius: 12px; background: radial-gradient(circle at 50% 0%, color-mix(in srgb, #2563eb 10%, transparent), transparent 60%), var(--dsw-alias-bg-layer-1); animation: o2p-rise .35s ease both; }
.o2p-welcomeIcon { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, #2563eb, #60a5fa); color: #fff; box-shadow: 0 10px 28px rgba(37, 99, 235, .3); }
.o2p-welcomeTitle { margin: 0; font-size: 20px; font-weight: 700; }
.o2p-welcomeSub { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.o2p-welcomeActions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.o2p-welcomeRecent { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; max-width: 520px; }
.o2p-welcomeChip { height: 26px; padding: 0 10px; border: 1px solid color-mix(in srgb, #2563eb 25%, var(--dsw-alias-border-l2)); border-radius: 999px; background: color-mix(in srgb, #2563eb 6%, transparent); color: #1d4ed8; font: inherit; font-size: 11px; cursor: pointer; }
.o2p-welcomeChip:hover { background: color-mix(in srgb, #2563eb 14%, transparent); }
.o2p-workspaceEyebrow { color: #2563eb; font-size: 9px; font-weight: 700; letter-spacing: .12em; }
.o2p-workspaceEyebrow { color: #2563eb; font-size: 8px; font-weight: 700; letter-spacing: .14em; }
.o2p-workspaceHead { display: flex; flex: none; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 10px; padding: 2px 2px 0; }
.o2p-workspaceHeading { min-width: 0; }
.o2p-workspaceTitle { margin: 3px 0 1px; color: var(--dsw-alias-label-primary); font-size: 18px; line-height: 22px; font-weight: 700; letter-spacing: -.015em; }
.o2p-workspaceDesc { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 10.5px; line-height: 1.5; }
.o2p-workbar { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 10px; padding: 6px 9px; border: 1px solid color-mix(in srgb, #2563eb 14%, var(--dsw-alias-border-l2)); border-radius: 8px; background: linear-gradient(180deg, color-mix(in srgb, #2563eb 5%, var(--dsw-alias-bg-layer-1)), var(--dsw-alias-bg-layer-1)); }
.o2p-route { display: flex; flex: 1 1 360px; align-items: center; gap: 7px; min-width: 0; }
.o2p-routeLabel { color: var(--dsw-alias-label-secondary); font-size: 9.5px; }
.o2p-routeChip { display: inline-flex; align-items: center; gap: 5px; max-width: 180px; padding: 5px 8px; overflow: hidden; border: 1px solid color-mix(in srgb, #2563eb 18%, var(--dsw-alias-border-l2)); border-radius: 7px; background: color-mix(in srgb, #2563eb 7%, transparent); color: var(--dsw-alias-label-primary); font-size: 10.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.o2p-routeChip.isSource { color: #dc2626; }
.o2p-routeChip.isTarget { color: #0d9488; }
.o2p-routeArrow { display: grid; flex: none; place-items: center; color: #2563eb; }
.o2p-routeSchema { max-width: 150px; padding: 3px 7px; overflow: hidden; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-family: Consolas, "Cascadia Mono", ui-monospace, monospace; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.o2p-workActions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.o2p-workBtn { display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 11px; white-space: nowrap; cursor: pointer; }
.o2p-workBtn:hover:not(:disabled) { border-color: color-mix(in srgb, #2563eb 38%, var(--dsw-alias-border-l2)); background: color-mix(in srgb, #2563eb 8%, transparent); }
.o2p-workBtn:disabled { opacity: .45; cursor: not-allowed; }
.o2p-workBtnPrimary { border-color: transparent; background: linear-gradient(135deg, #2563eb, #0ea5e9); color: #fff; box-shadow: 0 5px 14px rgba(37, 99, 235, .24); }
.o2p-workBtnPrimary:hover:not(:disabled) { border-color: transparent; background: linear-gradient(135deg, #1d4ed8, #0284c7); }
.o2p-insights { display: flex; flex: none; flex-direction: column; height: 196px; min-height: 164px; overflow: hidden; border: 1px solid color-mix(in srgb, #2563eb 14%, var(--dsw-alias-border-l2)); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.o2p-insightTabs { display: flex; flex: none; gap: 2px; padding: 4px 8px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.o2p-insightTab { display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 10px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 10.5px; cursor: pointer; }
.o2p-insightTab:hover { color: var(--dsw-alias-label-primary); }
.o2p-insightTab[data-active='true'] { border-bottom-color: #2563eb; color: #2563eb; font-weight: 600; }
.o2p-insightBody { flex: 1; min-height: 0; overflow: hidden; }
.o2p-insightScroll { box-sizing: border-box; height: 100%; overflow: auto; padding: 9px 12px; }
.o2p-insightCards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 7px; }
.o2p-insightCard { min-width: 0; padding: 7px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: var(--dsw-alias-bg-layer-2); }
.o2p-insightLabel { display: block; color: var(--dsw-alias-label-secondary); font-size: 8.5px; }
.o2p-insightValue { display: block; margin-top: 3px; overflow: hidden; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 17px; text-overflow: ellipsis; white-space: nowrap; }
.o2p-insightCard[data-kind='ok'] .o2p-insightValue { color: #15803d; }
.o2p-insightCard[data-kind='warn'] .o2p-insightValue { color: #b45309; }
.o2p-insightCard[data-kind='error'] .o2p-insightValue { color: #b91c1c; }
.o2p-insightMeta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 9px; margin-top: 8px; }
.o2p-insightMetaLabel { color: var(--dsw-alias-label-secondary); font-size: 9px; }
.o2p-ruleChips { display: flex; flex-wrap: wrap; gap: 4px; }
.o2p-ruleChip { padding: 2px 6px; border: 1px solid color-mix(in srgb, #2563eb 18%, var(--dsw-alias-border-l2)); border-radius: 999px; background: color-mix(in srgb, #2563eb 6%, transparent); color: #1d4ed8; font-family: Consolas, "Cascadia Mono", ui-monospace, monospace; font-size: 8.5px; }
.o2p-ruleChip b { font-weight: 700; }
.o2p-insightEmpty { color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.55; }
.o2p-insightEmptyCenter { display: flex; align-items: center; justify-content: center; height: 100%; padding: 16px; text-align: center; }
.o2p-diffWrap { display: flex; flex-direction: column; height: 100%; }
.o2p-diffList { flex: 1; min-height: 0; overflow: auto; padding: 5px 0; font-family: Consolas, "Cascadia Mono", ui-monospace, monospace; font-size: 10.5px; line-height: 17px; }
.o2p-diffRow { display: grid; grid-template-columns: 34px 34px 14px minmax(0, 1fr); gap: 4px; padding: 0 10px; }
.o2p-diffNo { color: var(--dsw-alias-label-secondary); text-align: right; opacity: .68; user-select: none; }
.o2p-diffSign { font-weight: 700; text-align: center; }
.o2p-diffText { margin: 0; overflow: hidden; color: var(--dsw-alias-label-primary); text-overflow: ellipsis; white-space: pre; }
.o2p-diffRow.is-add { background: color-mix(in srgb, #22c55e 10%, transparent); }
.o2p-diffRow.is-add .o2p-diffSign { color: #15803d; }
.o2p-diffRow.is-del { background: color-mix(in srgb, #ef4444 9%, transparent); }
.o2p-diffRow.is-del .o2p-diffSign { color: #dc2626; }
.o2p-diffRow.is-del .o2p-diffText { opacity: .74; text-decoration: line-through; }
.o2p-diffNote { flex: none; padding: 4px 10px; border-top: 1px solid var(--dsw-alias-border-l2); color: #b45309; font-size: 8.5px; }
.o2p-execLog { box-sizing: border-box; height: 100%; overflow: auto; padding: 10px 13px; }
.o2p-execState { display: flex; align-items: center; gap: 6px; font-size: 10.5px; font-weight: 600; }
.o2p-execState.is-ok { color: #15803d; }
.o2p-execState.is-error { color: #b91c1c; }
.o2p-execNote { max-height: 76px; margin: 7px 0 0; padding: 7px 9px; overflow: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font-family: Consolas, "Cascadia Mono", ui-monospace, monospace; font-size: 9.5px; line-height: 15px; white-space: pre-wrap; }
.o2p-execTime { display: block; margin-top: 7px; color: var(--dsw-alias-label-secondary); font-size: 8.5px; }
.o2p-riskList { box-sizing: border-box; display: flex; flex-direction: column; gap: 4px; height: 100%; overflow: auto; padding: 8px 10px; }
.o2p-riskRow { display: flex; align-items: flex-start; gap: 7px; padding: 6px 8px; border: 1px solid color-mix(in srgb, #f59e0b 22%, var(--dsw-alias-border-l2)); border-radius: 6px; background: color-mix(in srgb, #f59e0b 7%, transparent); color: var(--dsw-alias-label-primary); font-size: 10px; line-height: 1.45; }
.o2p-riskRow svg { flex: none; margin-top: 1px; color: #d97706; }
.o2p-riskRow.is-error { border-color: color-mix(in srgb, #ef4444 24%, var(--dsw-alias-border-l2)); background: color-mix(in srgb, #ef4444 7%, transparent); }
.o2p-riskRow.is-error svg { color: #dc2626; }
@media (max-width: 1100px) {
  .o2p-insightCards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 860px) {
  .o2p-shell { overflow: auto; }
  .o2p-workbar { align-items: flex-start; }
  .o2p-workActions { width: 100%; margin-left: 0; }
  .o2p-workActions .o2p-workBtn { flex: 1; justify-content: center; }
  .o2p-insights { height: 214px; }
  .o2p-insightCards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
`

    const HOME_CSS = `
.o2p-home { background: #060b16; background-image: none; }
.o2p-app[data-theme='dark'] { background: #060b16; background-image: none; }
.o2p-app[data-theme='light'] { background: #f4f7fd; background-image: none; }
.o2p-app > .o2h-top { flex: none; box-sizing: border-box; color: #eaf2ff; font-family: "Inter", "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif; font-size: 12px; line-height: 1.45; }
.o2p-app > .o2h-top *, .o2p-app > .o2h-top *::before, .o2p-app > .o2h-top *::after { box-sizing: border-box; }
.o2p-app .o2h { flex: 1; height: auto; min-height: 0; }
.o2p-app[data-theme='dark'] {
  --dsw-alias-bg-base: #080e1b;
  --dsw-alias-bg-layer-1: #0d1526;
  --dsw-alias-bg-layer-2: #141f35;
  --dsw-alias-label-primary: #e7efff;
  --dsw-alias-label-secondary: #8fa3c4;
  --dsw-alias-border-l1: #1b2942;
  --dsw-alias-border-l2: #22314e;
  --dsw-alias-interactive-bg-hover: #16233b;
  --dsw-alias-brand-primary: #2563eb;
  --dsw-alias-state-business-primary: #38bdf8;
  --dsw-alias-state-success-primary: #34d399;
  --dsw-alias-state-warn-primary: #fbbf24;
  --dsw-alias-state-error-primary: #f87171;
  --dsw-alias-state-idle-primary: #64748b;
  --dsw-focus-ring-color: #38bdf8;
}
.o2p-app[data-theme='light'] {
  --dsw-alias-bg-base: #f4f7fd;
  --dsw-alias-bg-layer-1: #ffffff;
  --dsw-alias-bg-layer-2: #eef3fa;
  --dsw-alias-label-primary: #0f172a;
  --dsw-alias-label-secondary: #5b6b85;
  --dsw-alias-border-l1: #e2e8f2;
  --dsw-alias-border-l2: #d6dfec;
  --dsw-alias-interactive-bg-hover: #e8eff9;
  --dsw-alias-brand-primary: #2563eb;
  --dsw-alias-state-business-primary: #2563eb;
  --dsw-alias-state-success-primary: #059669;
  --dsw-alias-state-warn-primary: #d97706;
  --dsw-alias-state-error-primary: #dc2626;
  --dsw-alias-state-idle-primary: #94a3b8;
  --dsw-focus-ring-color: #2563eb;
}
.o2p-app[data-theme='dark'] .o2p-paneTitle { color: #93c5fd; }
.o2p-app[data-theme='dark'] .o2p-explorerTitle svg,
.o2p-app[data-theme='dark'] .o2p-groupHeadLeft svg,
.o2p-app[data-theme='dark'] .o2p-treeIcon { color: #60a5fa; }
.o2p-app[data-theme='dark'] .o2p-groupHead { background: rgba(59, 130, 246, .12); color: #93c5fd; }
.o2p-app[data-theme='dark'] .o2p-listCount,
.o2p-app[data-theme='dark'] .o2p-countOnly { color: #60a5fa; }
.o2p-app[data-theme='dark'] .o2p-highlight .sql-kw,
.o2p-app[data-theme='dark'] .o2p-code .sql-kw { color: #7dd3fc; }
.o2p-app[data-theme='dark'] .o2p-highlight .sql-str,
.o2p-app[data-theme='dark'] .o2p-code .sql-str { color: #86efac; }
.o2p-app[data-theme='dark'] .o2p-highlight .sql-num,
.o2p-app[data-theme='dark'] .o2p-code .sql-num { color: #fdba74; }
.o2p-app[data-theme='dark'] .o2p-highlight .sql-ident,
.o2p-app[data-theme='dark'] .o2p-code .sql-ident { color: #c4b5fd; }
.o2p-app[data-theme='dark'] .o2p-highlight .sql-type,
.o2p-app[data-theme='dark'] .o2p-code .sql-type { color: #5eead4; }
.o2h, .o2h *, .o2h *::before, .o2h *::after { box-sizing: border-box; }
.o2h { --o2h-line: rgba(121, 157, 224, .15); --o2h-muted: #7b90b3; position: relative; isolation: isolate; display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; overflow: hidden; background:
  radial-gradient(960px 480px at 8% -12%, rgba(37, 99, 235, .24), transparent 60%),
  radial-gradient(760px 440px at 96% -4%, rgba(34, 211, 238, .13), transparent 62%),
  linear-gradient(180deg, #060b16 0%, #070d1c 52%, #060b16 100%); color: #eaf2ff; font-family: "Inter", "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif; font-size: 12px; line-height: 1.45; }
.o2h::after { content: ''; position: absolute; inset: 0; z-index: 0; pointer-events: none; background-image: linear-gradient(rgba(126, 164, 255, .035) 1px, transparent 1px), linear-gradient(90deg, rgba(126, 164, 255, .035) 1px, transparent 1px); background-size: 52px 52px; -webkit-mask-image: linear-gradient(180deg, rgba(0, 0, 0, .7), transparent 72%); mask-image: linear-gradient(180deg, rgba(0, 0, 0, .7), transparent 72%); }
.o2h-top, .o2h-scroll { position: relative; z-index: 1; }
.o2h-top { display: flex; flex: none; align-items: center; gap: 16px; min-height: 60px; padding: 0 24px; border-bottom: 1px solid rgba(121, 157, 224, .13); background: rgba(6, 11, 22, .74); backdrop-filter: blur(20px) saturate(140%); }
.o2h-brand { display: flex; flex: 1 1 0; align-items: center; gap: 11px; min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; }
.o2h-mark { position: relative; display: grid; flex: none; place-items: center; width: 44px; height: 44px; overflow: visible; border-radius: 12px; background: transparent; color: #fff; filter: drop-shadow(0 8px 18px rgba(37, 99, 235, .42)); }
.o2h-mark::after { content: none; }
.o2h-brandIcon { display: block; }
.o2h-brandText { display: flex; flex-direction: column; min-width: 0; }
.o2h-brandLine { display: flex; align-items: center; gap: 7px; color: #f1f7ff; font-size: 15px; font-weight: 700; letter-spacing: -.015em; line-height: 18px; }
.o2h-brandLine strong { font-weight: 750; }
.o2h-brandLine em { padding: 1px 5px; border-radius: 4px; background: linear-gradient(135deg, #60a5fa, #22d3ee); color: #06101f; font-size: 8px; font-style: normal; font-weight: 800; letter-spacing: .1em; line-height: 14px; }
.o2h-brandText small { margin-top: 2px; color: #7085a8; font-size: 9.5px; letter-spacing: .02em; }
.o2h-nav { display: flex; flex: 0 1 auto; align-items: center; gap: 4px; min-width: 0; padding: 4px; overflow-x: auto; border: 1px solid rgba(121, 157, 224, .16); border-radius: 999px; background: rgba(255, 255, 255, .028); box-shadow: 0 6px 22px rgba(15, 23, 42, .1), inset 0 1px 0 rgba(255, 255, 255, .04); scrollbar-width: none; }
.o2h-nav::-webkit-scrollbar { display: none; }
.o2h-navSide { display: flex; flex: 1 1 0; align-items: center; gap: 2px; }
.o2h-navSideLeft { justify-content: flex-end; }
.o2h-navSideRight { justify-content: flex-start; }
.o2h-navItem { flex: none; height: 34px; padding: 0 17px; border: 0; border-radius: 999px; background: transparent; color: #8296b9; font: inherit; font-size: 12.5px; white-space: nowrap; cursor: pointer; transition: background .16s ease, color .16s ease; }
.o2h-navItemHome { height: 38px; padding: 0 25px; color: #cfe4ff; font-size: 13.5px; font-weight: 700; }
.o2h-navItemHome:hover { background: rgba(59, 130, 246, .2); color: #fff; }
.o2h-navItem:hover { background: rgba(255, 255, 255, .05); color: #dbe7ff; }
.o2h-navItem[data-active='true'] { background: linear-gradient(135deg, rgba(59, 130, 246, .92), rgba(34, 211, 238, .64)); color: #fff; box-shadow: 0 4px 16px rgba(37, 99, 235, .3); }
.o2h-topRight { display: flex; flex: 1 1 0; align-items: center; justify-content: flex-end; gap: 12px; min-width: 0; }
.o2h-engine { display: flex; align-items: center; gap: 6px; color: #8ba2c6; font-size: 10px; white-space: nowrap; }
.o2h-engine i { width: 6px; height: 6px; border-radius: 50%; background: #34d399; box-shadow: 0 0 0 3px rgba(52, 211, 153, .1), 0 0 10px #34d399; animation: o2h-live 2.4s ease-in-out infinite; }
.o2h-topBtn { height: 30px; padding: 0 12px; border: 1px solid rgba(96, 165, 250, .25); border-radius: 8px; background: rgba(59, 130, 246, .08); color: #b9d4ff; font: inherit; font-size: 10px; cursor: pointer; transition: background .16s ease, border-color .16s ease; }
.o2h-topBtn:hover { border-color: rgba(96, 165, 250, .48); background: rgba(59, 130, 246, .16); }
.o2h-iconBtn { display: grid; flex: none; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid rgba(121, 157, 224, .18); border-radius: 8px; background: rgba(255, 255, 255, .03); color: #b9d4ff; cursor: pointer; transition: background .16s ease, border-color .16s ease, color .16s ease; }
.o2h-iconBtn:hover { border-color: rgba(96, 165, 250, .46); background: rgba(59, 130, 246, .12); color: #fff; }
.o2h-scroll { flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; scrollbar-color: rgba(96, 165, 250, .28) transparent; scrollbar-width: thin; }
.o2h-scroll::-webkit-scrollbar { width: 10px; }
.o2h-scroll::-webkit-scrollbar-track { background: transparent; }
.o2h-scroll::-webkit-scrollbar-thumb { border: 3px solid transparent; border-radius: 999px; background: rgba(96, 165, 250, .26); background-clip: padding-box; }
.o2h-scroll::-webkit-scrollbar-thumb:hover { background: rgba(96, 165, 250, .42); background-clip: padding-box; }
.o2h-inner { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: none; margin: 0 auto; padding: 14px 24px 16px; }
.o2h-home .o2h-scroll { display: flex; flex-direction: column; }
.o2h-home .o2h-inner { flex: 1; min-height: 0; justify-content: flex-start; }
.o2h-home .o2h-main { flex: 1 1 auto; min-height: 0; }
.o2h-home .o2h-trendCard { flex: 1 1 auto; min-height: 240px; }
.o2h-hero { position: relative; display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(500px, .95fr); gap: 18px; min-height: 0; padding: 28px 32px; overflow: hidden; border: 1px solid rgba(96, 165, 250, .22); border-radius: 20px; background: radial-gradient(90% 130% at 0% 0%, rgba(37, 99, 235, .28), transparent 58%), radial-gradient(70% 90% at 96% 100%, rgba(34, 211, 238, .1), transparent 60%), linear-gradient(135deg, rgba(14, 26, 50, .96), rgba(7, 13, 26, .96)); box-shadow: 0 28px 80px rgba(0, 0, 0, .36), inset 0 1px 0 rgba(255, 255, 255, .06); animation: o2h-rise .55s ease backwards; }
.o2h-hero::before { content: ''; position: absolute; inset: 0; z-index: 0; background-image: linear-gradient(rgba(126, 164, 255, .055) 1px, transparent 1px), linear-gradient(90deg, rgba(126, 164, 255, .055) 1px, transparent 1px); background-size: 34px 34px; -webkit-mask-image: radial-gradient(120% 120% at 28% 18%, #000 0%, transparent 70%); mask-image: radial-gradient(120% 120% at 28% 18%, #000 0%, transparent 70%); pointer-events: none; }
.o2h-hero::after { content: ''; position: absolute; top: -190px; right: -150px; z-index: 0; width: 500px; height: 500px; border-radius: 50%; background: radial-gradient(circle, rgba(34, 211, 238, .24), rgba(37, 99, 235, .08) 44%, transparent 68%); filter: blur(8px); pointer-events: none; }
.o2h-heroCopy, .o2h-visual { position: relative; z-index: 1; }
.o2h-heroCopy { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.o2h-eyebrow { display: inline-flex; align-items: center; gap: 8px; width: fit-content; max-width: 100%; padding: 6px 12px; border: 1px solid rgba(96, 165, 250, .24); border-radius: 999px; background: rgba(59, 130, 246, .09); color: #8ec6ff; font-size: 10.5px; font-weight: 700; letter-spacing: .14em; line-height: 1; white-space: nowrap; }
.o2h-eyebrowDot { width: 5px; height: 5px; border-radius: 50%; background: #22d3ee; box-shadow: 0 0 9px #22d3ee; animation: o2h-live 2.2s ease-in-out infinite; }
.o2h-demoChip { margin-left: 2px; padding: 2px 5px; border: 1px solid rgba(251, 191, 36, .24); border-radius: 4px; background: rgba(251, 191, 36, .1); color: #fcd34d; font-size: 8px; font-weight: 700; letter-spacing: .04em; }
.o2h-heroTitle { display: flex; flex-direction: row; flex-wrap: wrap; align-items: baseline; gap: 0; margin: 14px 0 12px; color: #f4f8ff; font-size: clamp(34px, 3.6vw, 54px); font-weight: 850; letter-spacing: -.045em; line-height: 1.06; text-wrap: balance; }
.o2h-grad { background: linear-gradient(100deg, #7dd3fc 0%, #22d3ee 36%, #818cf8 78%, #c084fc 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.o2h-heroDesc { display: flex; flex-direction: column; gap: 5px; max-width: 680px; margin: 0; color: #9db1d2; font-size: 14px; line-height: 1.7; }
.o2h-heroDescLine { position: relative; display: block; padding-left: 14px; }
.o2h-heroDescLine::before { content: ''; position: absolute; top: .72em; left: 0; width: 5px; height: 5px; border-radius: 50%; background: linear-gradient(135deg, #22d3ee, #60a5fa); box-shadow: 0 0 6px rgba(34, 211, 238, .55); }
.o2h-ctaPrimary { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 36px; padding: 0 16px; overflow: hidden; border: 0; border-radius: 10px; background: linear-gradient(135deg, #2563eb 0%, #0ea5e9 100%); color: #fff; font: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; box-shadow: 0 12px 30px rgba(37, 99, 235, .38), inset 0 1px 0 rgba(255, 255, 255, .2); transition: transform .16s ease, box-shadow .16s ease; }
.o2h-ctaPrimary::after { content: ''; position: absolute; top: -25%; bottom: -25%; left: -42%; width: 34%; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .38), transparent); transform: skewX(-18deg); animation: o2h-shine 3.8s ease-in-out infinite; }
.o2h-ctaPrimary svg, .o2h-ctaSecondary svg { position: relative; z-index: 1; }
.o2h-ctaPrimary:hover { transform: translateY(-1px); box-shadow: 0 16px 38px rgba(37, 99, 235, .5), inset 0 1px 0 rgba(255, 255, 255, .24); }
.o2h-ctaSecondary { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 36px; padding: 0 14px; border: 1px solid rgba(147, 177, 233, .24); border-radius: 10px; background: rgba(255, 255, 255, .035); color: #c5d8f6; font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; backdrop-filter: blur(8px); transition: background .16s ease, border-color .16s ease, transform .16s ease; }
.o2h-ctaSecondary:hover { transform: translateY(-1px); border-color: rgba(147, 197, 253, .48); background: rgba(59, 130, 246, .12); }
.o2h-ctaPrimary:disabled, .o2h-ctaSecondary:disabled { opacity: .42; cursor: not-allowed; box-shadow: none; transform: none; }
.o2h-visual { display: flex; align-items: center; justify-content: center; min-height: 200px; }
.o2h-flow { display: flex; align-items: flex-start; justify-content: space-between; width: 100%; max-width: none; }
.o2h-flowNode { display: flex; flex: none; flex-direction: column; align-items: center; gap: 5px; width: 92px; }
.o2h-dbIcon { width: 64px; height: 80px; overflow: visible; }
.o2h-dbIcon ellipse, .o2h-dbIcon path { fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.o2h-dbIcon.isSource { color: #f87171; filter: drop-shadow(0 0 10px rgba(248, 113, 113, .28)); }
.o2h-dbIcon.isTarget { color: #34d399; filter: drop-shadow(0 0 10px rgba(52, 211, 153, .28)); }
.o2h-flowNode small { color: #8a9bb8; font-size: 9px; font-weight: 600; letter-spacing: .14em; }
.o2h-flowLine { position: relative; flex: 1; height: 2px; margin-top: 40px; border-radius: 2px; background: linear-gradient(90deg, rgba(148, 163, 184, .18), rgba(148, 163, 184, .62), rgba(148, 163, 184, .18)); }
.o2h-flowDot { position: absolute; top: 50%; left: 0; width: 8px; height: 8px; border-radius: 50%; background: #cbd5e1; box-shadow: 0 0 9px rgba(203, 213, 225, .85); transform: translate(-50%, -50%); animation: o2h-flowMove 1.9s linear infinite; }
.o2h-flowDotDelay { animation-delay: -.95s; }
.o2h-flowEngine { position: relative; display: flex; flex: none; flex-direction: column; align-items: center; gap: 3px; width: 150px; }
.o2h-engineOrbitSvg { position: absolute; top: -24px; left: 50%; width: 132px; height: 132px; margin-left: -66px; overflow: visible; }
.o2h-engineOrbitCircle { fill: none; stroke: rgba(96, 165, 250, .5); stroke-width: 1.5; stroke-dasharray: 3 7; }
.o2h-engineArcSvg { position: absolute; top: -24px; left: 50%; width: 132px; height: 132px; margin-left: -66px; overflow: visible; animation: o2h-ringSpin 2.2s linear infinite; }
.o2h-engineArc { fill: none; stroke: #60a5fa; stroke-width: 3; stroke-linecap: round; stroke-dasharray: 100 258; filter: drop-shadow(0 0 4px rgba(96, 165, 250, .9)); }
.o2h-engineBox { position: relative; z-index: 2; display: grid; place-items: center; width: 84px; height: 84px; border: 1.5px solid rgba(96, 165, 250, .85); border-radius: 28px; background: linear-gradient(150deg, rgba(59, 130, 246, .3), rgba(7, 13, 26, .06)); color: #bfdbfe; box-shadow: 0 0 36px rgba(37, 99, 235, .3), inset 0 0 24px rgba(59, 130, 246, .14), inset 0 1px 0 rgba(255, 255, 255, .14); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
.o2h-flowEngine b { margin-top: 24px; color: #eaf2ff; font-size: 14px; font-weight: 700; letter-spacing: -.01em; }
.o2h-flowEngine small { color: #7186a9; font-size: 7.5px; letter-spacing: .13em; }
@keyframes o2h-flowMove { 0% { left: 0; opacity: 0; } 12% { opacity: 1; } 88% { opacity: 1; } 100% { left: 100%; opacity: 0; } }
@keyframes o2h-ringSpin { to { transform: rotate(360deg); } }
@media (max-width: 620px) {
  .o2h-flowNode { width: 84px; }
  .o2h-dbIcon { width: 58px; height: 74px; }
  .o2h-flowEngine { width: 136px; }
  .o2h-flowEngine b { font-size: 13px; }
  .o2h-flowEngine small { font-size: 7px; }
  .o2h-flowLine { margin-top: 39px; }
  .o2h-engineBox { width: 78px; height: 78px; border-radius: 26px; }
  .o2h-engineOrbitSvg, .o2h-engineArcSvg { top: -22px; width: 122px; height: 122px; margin-left: -61px; }
}
.o2h-visualHalo { position: absolute; top: 50%; left: 50%; width: 340px; height: 340px; border-radius: 50%; background: radial-gradient(circle, rgba(37, 99, 235, .3), transparent 66%); filter: blur(14px); transform: translate(-50%, -50%); }
.o2h-orbit { position: absolute; top: 50%; left: 50%; border: 1px dashed rgba(96, 165, 250, .18); border-radius: 50%; transform: translate(-50%, -50%); }
.o2h-orbitA { width: 282px; height: 282px; animation: o2h-orbitSpin 34s linear infinite; }
.o2h-orbitB { width: 218px; height: 218px; border-color: rgba(34, 211, 238, .14); animation: o2h-orbitSpin 24s linear infinite reverse; }
.o2h-nodeChip { position: absolute; z-index: 4; display: flex; align-items: center; gap: 8px; min-width: 128px; max-width: 166px; padding: 8px 10px; border: 1px solid rgba(96, 165, 250, .24); border-radius: 11px; background: linear-gradient(150deg, rgba(15, 28, 51, .98), rgba(8, 15, 30, .98)); box-shadow: 0 14px 34px rgba(0, 0, 0, .44), inset 0 1px 0 rgba(255, 255, 255, .05); backdrop-filter: blur(12px); }
.o2h-nodeSource { top: 0; left: 2px; }
.o2h-nodeTarget { right: 2px; bottom: 0; }
.o2h-nodeIcon { display: grid; flex: none; place-items: center; width: 28px; height: 28px; border-radius: 8px; }
.o2h-nodeIcon.isOracle { background: rgba(248, 113, 113, .12); color: #f87171; }
.o2h-nodeIcon.isHgdb { background: rgba(52, 211, 153, .12); color: #34d399; }
.o2h-nodeText { display: flex; flex-direction: column; min-width: 0; }
.o2h-nodeText b { overflow: hidden; color: #e6f0ff; font-size: 9.5px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.o2h-nodeText small { color: #6f86a9; font-size: 6.5px; letter-spacing: .1em; text-transform: uppercase; }
.o2h-liveDot { width: 5px; height: 5px; margin-left: auto; border-radius: 50%; background: #34d399; box-shadow: 0 0 8px #34d399; animation: o2h-live 2s ease-in-out infinite; }
.o2h-connectors { position: absolute; inset: 0; z-index: 2; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.o2h-connector { fill: none; stroke: rgba(96, 165, 250, .55); stroke-width: 1.4; stroke-dasharray: 3 5; vector-effect: non-scaling-stroke; animation: o2h-dashFlow 2.2s linear infinite; }
.o2h-connectorDot { fill: #22d3ee; filter: drop-shadow(0 0 3px rgba(34, 211, 238, .9)); }
.o2h-console { position: absolute; top: 50%; left: 50%; z-index: 3; width: min(280px, 82%); padding: 10px 12px 9px; border: 1px solid rgba(96, 165, 250, .28); border-radius: 14px; background: linear-gradient(160deg, rgba(16, 29, 54, .97), rgba(7, 13, 26, .98)); box-shadow: 0 24px 64px rgba(0, 0, 0, .52), 0 0 0 1px rgba(255, 255, 255, .04) inset, 0 0 42px rgba(37, 99, 235, .13); backdrop-filter: blur(14px); transform: translate(-50%, -50%); }
.o2h-consoleHead { display: flex; align-items: center; gap: 7px; padding-bottom: 9px; border-bottom: 1px solid rgba(121, 157, 224, .12); }
.o2h-windowDots { display: flex; gap: 3px; }
.o2h-windowDots i { width: 4px; height: 4px; border-radius: 50%; background: #334b6e; }
.o2h-windowDots i:first-child { background: #f87171; }
.o2h-windowDots i:nth-child(2) { background: #fbbf24; }
.o2h-consoleTitle { margin-left: 2px; color: #7e94b9; font-size: 6.5px; font-weight: 700; letter-spacing: .13em; }
.o2h-running { display: flex; align-items: center; gap: 4px; margin-left: auto; color: #34d399; font-size: 6.5px; font-weight: 700; letter-spacing: .1em; }
.o2h-running i { width: 4px; height: 4px; border-radius: 50%; background: #34d399; box-shadow: 0 0 7px #34d399; animation: o2h-live 1.6s ease-in-out infinite; }
.o2h-consoleCode { padding: 10px 0 8px; }
.o2h-codeRow { display: flex; align-items: center; gap: 6px; min-width: 0; }
.o2h-codeTag { flex: none; padding: 1px 4px; border-radius: 3px; background: rgba(248, 113, 113, .12); color: #fca5a5; font-size: 5.5px; font-weight: 700; letter-spacing: .08em; }
.o2h-codeTag.isGood { background: rgba(52, 211, 153, .12); color: #6ee7b7; }
.o2h-codeOld, .o2h-codeNew { overflow: hidden; font-family: Consolas, "Cascadia Mono", ui-monospace, monospace; font-size: 9px; line-height: 1.6; text-overflow: ellipsis; white-space: nowrap; }
.o2h-codeOld { color: #fca5a5; text-decoration: line-through; text-decoration-color: rgba(252, 165, 165, .5); }
.o2h-codeNew { color: #67e8f9; }
.o2h-codeDivider { display: flex; align-items: center; padding: 2px 0 2px 43px; color: #4b658c; }
.o2h-meter { display: flex; flex-direction: column; gap: 5px; }
.o2h-meterHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #8ca3c7; font-size: 7.5px; }
.o2h-meterHead b { color: #c7f9ff; font-size: 8.5px; }
.o2h-meterTrack { height: 4px; overflow: hidden; border-radius: 999px; background: rgba(255, 255, 255, .07); }
.o2h-meterTrack i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #2563eb, #22d3ee); box-shadow: 0 0 12px rgba(34, 211, 238, .65); transform-origin: left center; animation: o2h-meter 1.6s .25s cubic-bezier(.2, .8, .2, 1) backwards; }
.o2h-consoleNote { display: flex; align-items: center; gap: 4px; color: #4f9f83; font-size: 7px; }
.o2h-consoleNote.isWarn { color: #fbbf24; }
.o2h-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.o2h-stat { --tone: #60a5fa; --tone-soft: rgba(96, 165, 250, .13); position: relative; padding: 11px 14px 9px; overflow: hidden; border: 1px solid rgba(121, 157, 224, .14); border-radius: 14px; background: linear-gradient(155deg, rgba(15, 26, 48, .88), rgba(8, 15, 29, .92)); box-shadow: 0 10px 28px rgba(0, 0, 0, .16); transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease; animation: o2h-rise .55s ease backwards; }
.o2h-stat:nth-child(2) { animation-delay: .04s; }
.o2h-stat:nth-child(3) { animation-delay: .08s; }
.o2h-stat:nth-child(4) { animation-delay: .12s; }
.o2h-stat::before { content: ''; position: absolute; top: 0; right: 16px; left: 16px; height: 1px; background: linear-gradient(90deg, transparent, var(--tone), transparent); opacity: .8; }
.o2h-stat::after { content: ''; position: absolute; top: -46px; right: -36px; width: 120px; height: 120px; border-radius: 50%; background: radial-gradient(circle, var(--tone-soft), transparent 68%); pointer-events: none; }
.o2h-stat[data-tone='violet'] { --tone: #a78bfa; --tone-soft: rgba(167, 139, 250, .16); }
.o2h-stat[data-tone='green'] { --tone: #34d399; --tone-soft: rgba(52, 211, 153, .14); }
.o2h-stat[data-tone='cyan'] { --tone: #22d3ee; --tone-soft: rgba(34, 211, 238, .14); }
.o2h-stat[data-tone='amber'] { --tone: #fbbf24; --tone-soft: rgba(251, 191, 36, .14); }
.o2h-stat:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--tone) 38%, transparent); box-shadow: 0 18px 38px rgba(0, 0, 0, .3); }
.o2h-statTop { position: relative; z-index: 1; display: flex; align-items: center; gap: 8px; }
.o2h-statIcon { display: grid; flex: none; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: var(--tone-soft); color: var(--tone); }
.o2h-statLabel { overflow: hidden; color: #9aafd0; font-size: 10px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.o2h-statLive { margin-left: auto; color: #566d91; font-size: 7px; letter-spacing: .12em; }
.o2h-statValue { position: relative; z-index: 1; margin: 8px 0 2px; color: #f2f7ff; font-size: 25px; font-weight: 800; letter-spacing: -.04em; line-height: 1; }
.o2h-statFoot { position: relative; z-index: 1; display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; min-height: 24px; }
.o2h-statFootText { color: #7186a9; font-size: 9px; line-height: 1.5; }
.o2h-spark { flex: none; width: 66px; height: 22px; color: var(--tone); opacity: .8; }
.o2h-main { display: grid; flex: 1; grid-template-columns: minmax(0, 1fr); gap: 14px; align-items: stretch; min-height: 0; }
.o2h-card { position: relative; overflow: hidden; border: 1px solid rgba(121, 157, 224, .14); border-radius: 18px; background: linear-gradient(160deg, rgba(14, 25, 46, .9), rgba(7, 14, 27, .93)); box-shadow: 0 12px 34px rgba(0, 0, 0, .2), inset 0 1px 0 rgba(255, 255, 255, .035); animation: o2h-rise .55s .08s ease backwards; }
.o2h-cardHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 18px 0; }
.o2h-cardHeading { min-width: 0; }
.o2h-cardTitle { display: flex; align-items: center; gap: 7px; margin: 0; color: #e7f0ff; font-size: 12.5px; font-weight: 700; }
.o2h-cardTitle svg { flex: none; color: #5ea3ff; }
.o2h-cardSub { margin: 5px 0 0; color: #6f84a8; font-size: 9.5px; line-height: 1.45; }
.o2h-tabs { display: flex; flex: none; gap: 2px; padding: 3px; border: 1px solid rgba(121, 157, 224, .14); border-radius: 9px; background: rgba(255, 255, 255, .022); }
.o2h-tab { height: 23px; padding: 0 9px; border: 0; border-radius: 6px; background: transparent; color: #7f93b6; font: inherit; font-size: 9px; white-space: nowrap; cursor: pointer; }
.o2h-tab:hover { color: #c9dcff; }
.o2h-tab[data-active='true'] { background: rgba(59, 130, 246, .18); color: #bcd8ff; box-shadow: inset 0 0 0 1px rgba(96, 165, 250, .2); }
.o2h-trendCard { display: flex; flex-direction: column; min-height: clamp(320px, 46vh, 440px); max-height: none; }
.o2h-trendBody { display: grid; flex: 1; grid-template-columns: minmax(0, 1fr) 300px; min-height: 0; }
.o2h-chartCol { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.o2h-trendSide { display: flex; flex-direction: column; gap: 12px; min-height: 0; padding: 12px 14px; border-left: 1px solid rgba(121, 157, 224, .12); background: linear-gradient(180deg, rgba(37, 99, 235, .04), transparent 55%); overflow-y: auto; }
.o2h-sideEyebrow { color: #7f93b5; font-size: 8px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
.o2h-sideBlock { display: flex; flex-direction: column; gap: 7px; }
.o2h-sideTiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.o2h-sideTile { min-width: 0; padding: 8px 9px; border: 1px solid rgba(121, 157, 224, .12); border-radius: 9px; background: rgba(255, 255, 255, .022); }
.o2h-sideTile span { display: block; overflow: hidden; color: #8ba2c6; font-size: 9px; white-space: nowrap; text-overflow: ellipsis; }
.o2h-sideTile b { display: block; margin-top: 5px; color: #f4f8ff; font-size: 17px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
.o2h-sideRecent { display: flex; flex: 1; flex-direction: column; gap: 4px; min-height: 0; }
.o2h-sideRecentHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.o2h-sideRecentCount { color: #6f84a8; font-size: 9px; font-variant-numeric: tabular-nums; }
.o2h-sideRecentList { display: flex; flex-direction: column; min-height: 0; }
.o2h-sideRecentRow { display: flex; align-items: center; gap: 7px; padding: 6px 0; border-bottom: 1px solid rgba(121, 157, 224, .08); }
.o2h-sideRecentRow:last-child { border-bottom: 0; }
.o2h-sideDot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: #34d399; box-shadow: 0 0 6px rgba(52, 211, 153, .5); }
.o2h-sideDot[data-status='error'] { background: #f87171; box-shadow: 0 0 6px rgba(248, 113, 113, .5); }
.o2h-sideRecentName { flex: 1; min-width: 0; overflow: hidden; color: #c6d6ee; font-size: 10.5px; white-space: nowrap; text-overflow: ellipsis; }
.o2h-sideRecentTime { flex: none; color: #6f84a8; font-size: 9px; }
.o2h-sideEmpty { margin: 4px 0 0; color: #7085a8; font-size: 10px; line-height: 1.5; }
.o2h-sideMore { display: flex; align-items: center; justify-content: center; gap: 5px; height: 26px; border: 1px dashed rgba(121, 157, 224, .2); border-radius: 8px; background: transparent; color: #8ea6c9; font: inherit; font-size: 10px; cursor: pointer; }
.o2h-sideMore:hover { border-color: rgba(96, 165, 250, .4); background: rgba(59, 130, 246, .06); color: #cfe0f8; }
.o2h-sideActions { display: flex; flex-direction: column; gap: 6px; margin-top: auto; }
.o2h-sideAction { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 10px; border: 1px solid rgba(121, 157, 224, .12); border-radius: 8px; background: rgba(255, 255, 255, .02); color: #b9cbe7; font: inherit; font-size: 10.5px; text-align: left; cursor: pointer; transition: background .15s ease, border-color .15s ease, color .15s ease; }
.o2h-sideAction:hover { border-color: rgba(96, 165, 250, .3); background: rgba(59, 130, 246, .1); color: #fff; }
.o2h-trendSide { scrollbar-width: thin; }
.o2h-trendSide::-webkit-scrollbar { width: 6px; }
.o2h-trendSide::-webkit-scrollbar-thumb { border-radius: 999px; background: rgba(96, 165, 250, .28); }
.o2h-chartWrap { position: relative; flex: 1; min-height: 160px; padding: 4px 8px 0; }
.o2h-chart { position: absolute; top: 4px; right: 8px; bottom: 0; left: 8px; display: block; width: auto; height: auto; }
.o2h-chartLine { stroke-dasharray: 1; stroke-dashoffset: 1; animation: o2h-draw 1.3s cubic-bezier(.2, .8, .2, 1) forwards; }
.o2h-chartLineReview { stroke-dasharray: 4 5; stroke-dashoffset: 0; animation: o2h-fade .7s .45s ease both; }
.o2h-chartPointLast { animation: o2h-point 2.4s ease-in-out infinite; }
.o2h-chartEmpty { position: absolute; inset: 22px 12px 32px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; border-radius: 12px; background: rgba(7, 14, 27, .74); text-align: center; backdrop-filter: blur(4px); }
.o2h-chartEmptyIcon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: rgba(59, 130, 246, .12); color: #60a5fa; }
.o2h-chartEmpty p { margin: 0; color: #8196b9; font-size: 10px; }
.o2h-chartEmpty button { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 11px; border: 1px solid rgba(96, 165, 250, .3); border-radius: 7px; background: rgba(59, 130, 246, .12); color: #c6dcff; font: inherit; font-size: 9.5px; cursor: pointer; }
.o2h-chartEmpty button:hover { background: rgba(59, 130, 246, .2); }
.o2h-chartFoot { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 10px; padding: 0 18px 12px; }
.o2h-legend { display: flex; align-items: center; gap: 6px; color: #7e93b6; font-size: 9px; }
.o2h-legend i { width: 7px; height: 7px; border-radius: 50%; }
.o2h-legend i.isDone { background: #38bdf8; box-shadow: 0 0 7px rgba(56, 189, 248, .7); }
.o2h-legend i.isReview { margin-left: 8px; background: #fbbf24; box-shadow: 0 0 6px rgba(251, 191, 36, .55); }
.o2h-chartPeak { color: #60769a; font-size: 9px; }
.o2h-livePill { display: flex; flex: none; align-items: center; gap: 5px; padding: 4px 8px; border: 1px solid rgba(52, 211, 153, .2); border-radius: 999px; background: rgba(52, 211, 153, .07); color: #5eead4; font-size: 7px; font-weight: 700; letter-spacing: .1em; }
.o2h-livePill i { width: 5px; height: 5px; border-radius: 50%; background: #34d399; box-shadow: 0 0 7px #34d399; animation: o2h-live 1.8s ease-in-out infinite; }
.o2h-pipeFlow { display: flex; align-items: center; gap: 4px; padding: 21px 16px 12px; }
.o2h-pipeNode { display: flex; flex: 1; flex-direction: column; align-items: center; gap: 4px; min-width: 0; padding: 11px 7px; border: 1px solid rgba(121, 157, 224, .13); border-radius: 12px; background: rgba(255, 255, 255, .02); text-align: center; }
.o2h-pipeIcon { display: grid; place-items: center; width: 32px; height: 32px; margin-bottom: 2px; border-radius: 10px; }
.o2h-pipeIcon.isOracle { background: rgba(248, 113, 113, .12); color: #f87171; }
.o2h-pipeIcon.isHgdb { background: rgba(52, 211, 153, .12); color: #34d399; }
.o2h-pipeNode b { max-width: 100%; overflow: hidden; color: #dbe8ff; font-size: 9.5px; text-overflow: ellipsis; white-space: nowrap; }
.o2h-pipeNode small { color: #687fa3; font-size: 7px; line-height: 1.35; }
.o2h-pipeLink { position: relative; flex: none; width: 26px; height: 1px; background: linear-gradient(90deg, rgba(96, 165, 250, .16), rgba(34, 211, 238, .55)); }
.o2h-pipeLink i { position: absolute; top: -2px; left: 0; width: 5px; height: 5px; border-radius: 50%; background: #22d3ee; box-shadow: 0 0 7px #22d3ee; animation: o2h-flowDot 2s linear infinite; }
.o2h-pipeCore { position: relative; display: flex; flex: none; flex-direction: column; align-items: center; gap: 3px; width: 58px; color: #9bd7ff; }
.o2h-pipeCorePulse { position: absolute; top: -6px; width: 28px; height: 28px; border-radius: 50%; background: radial-gradient(circle, rgba(34, 211, 238, .32), transparent 68%); animation: o2h-breathe 2.4s ease-in-out infinite; }
.o2h-pipeCore small { color: #5f769b; font-size: 6px; line-height: 1.2; text-align: center; }
.o2h-checks { display: flex; flex-direction: column; gap: 6px; padding: 4px 16px 12px; }
.o2h-check { display: flex; align-items: center; gap: 7px; padding: 7px 9px; border: 1px solid rgba(121, 157, 224, .1); border-radius: 8px; background: rgba(255, 255, 255, .018); }
.o2h-checkIcon { display: grid; flex: none; place-items: center; width: 16px; height: 16px; border-radius: 5px; }
.o2h-checkIcon.isOk { background: rgba(52, 211, 153, .1); color: #34d399; }
.o2h-checkIcon.isWarn { background: rgba(251, 191, 36, .1); color: #fbbf24; }
.o2h-checkLabel { color: #8da2c3; font-size: 8px; }
.o2h-checkValue { max-width: 62%; margin-left: auto; overflow: hidden; color: #d7e5fb; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.o2h-pipeCta { display: flex; align-items: center; justify-content: center; gap: 6px; width: calc(100% - 32px); height: 32px; margin: 0 16px 16px; border: 1px solid rgba(96, 165, 250, .26); border-radius: 9px; background: linear-gradient(135deg, rgba(37, 99, 235, .26), rgba(34, 211, 238, .13)); color: #cfe5ff; font: inherit; font-size: 9.5px; font-weight: 600; cursor: pointer; transition: background .16s ease, border-color .16s ease; }
.o2h-pipeCta:hover { border-color: rgba(96, 165, 250, .5); background: linear-gradient(135deg, rgba(37, 99, 235, .38), rgba(34, 211, 238, .2)); }
.o2h-recent { padding-bottom: 6px; }
.o2h-cardActions { display: flex; flex: none; align-items: center; gap: 6px; }
.o2h-linkBtn { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 9px; border: 1px solid rgba(96, 165, 250, .2); border-radius: 7px; background: rgba(59, 130, 246, .07); color: #a9c9ff; font: inherit; font-size: 9px; cursor: pointer; transition: background .15s ease, border-color .15s ease; }
.o2h-linkBtn:hover { border-color: rgba(96, 165, 250, .4); background: rgba(59, 130, 246, .15); }
.o2h-taskList { display: flex; flex-direction: column; padding: 10px 8px 8px; }
.o2h-task { display: grid; grid-template-columns: 32px minmax(0, 1fr) 170px 92px 22px; align-items: center; gap: 12px; padding: 11px 10px; border-radius: 10px; cursor: pointer; transition: background .15s ease; }
.o2h-task + .o2h-task { border-top: 1px solid rgba(121, 157, 224, .07); }
.o2h-task:hover { background: rgba(59, 130, 246, .06); }
.o2h-task:focus-visible { outline: 2px solid #38bdf8; outline-offset: -2px; }
.o2h-taskIcon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; }
.o2h-taskIcon.is-done { background: rgba(52, 211, 153, .1); color: #34d399; }
.o2h-taskIcon.is-running { background: rgba(34, 211, 238, .1); color: #22d3ee; }
.o2h-taskIcon.is-running svg { animation: o2h-rotate 1.5s linear infinite; }
.o2h-taskIcon.is-pending { background: rgba(251, 191, 36, .1); color: #fbbf24; }
.o2h-taskIcon.is-error { background: rgba(248, 113, 113, .1); color: #f87171; }
.o2h-taskMain { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.o2h-taskName { overflow: hidden; color: #e2ecff; font-size: 10.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.o2h-taskMeta { overflow: hidden; color: #6d82a6; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.o2h-taskProgress { display: flex; flex-direction: column; gap: 5px; }
.o2h-taskTrack { height: 3px; overflow: hidden; border-radius: 999px; background: rgba(255, 255, 255, .06); }
.o2h-taskTrack i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #3b82f6, #22d3ee); }
.o2h-taskTrack i.is-done { background: linear-gradient(90deg, #10b981, #34d399); }
.o2h-taskTrack i.is-error { background: linear-gradient(90deg, #ef4444, #fb7185); }
.o2h-taskTrack i.is-running { background: linear-gradient(90deg, #2563eb, #22d3ee, #2563eb); background-size: 200% 100%; animation: o2h-flow 1.6s linear infinite; }
.o2h-taskTrack i.is-pending { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
.o2h-taskTime { color: #5f7497; font-size: 7.5px; }
.o2h-pill { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 21px; padding: 0 8px; border: 1px solid transparent; border-radius: 999px; font-size: 8px; font-weight: 600; white-space: nowrap; }
.o2h-pill i { width: 4px; height: 4px; border-radius: 50%; background: currentColor; }
.o2h-pill.is-done { border-color: rgba(52, 211, 153, .18); background: rgba(52, 211, 153, .08); color: #6ee7b7; }
.o2h-pill.is-running { border-color: rgba(34, 211, 238, .18); background: rgba(34, 211, 238, .08); color: #67e8f9; }
.o2h-pill.is-pending { border-color: rgba(251, 191, 36, .18); background: rgba(251, 191, 36, .08); color: #fcd34d; }
.o2h-pill.is-error { border-color: rgba(248, 113, 113, .2); background: rgba(248, 113, 113, .09); color: #fca5a5; }
.o2h-taskArrow { display: grid; place-items: center; color: #53698c; transition: color .15s ease, transform .15s ease; }
.o2h-task:hover .o2h-taskArrow { color: #7dd3fc; transform: translate(1px, -1px); }
.o2h-recentEmpty { padding: 34px 16px; color: #7186a9; font-size: 10px; text-align: center; }
.o2h-foot { display: flex; justify-content: space-between; gap: 12px; padding: 2px 4px 0; color: #50658a; font-size: 8px; }
.o2h-connInner { max-width: none; }
.o2h-connHero { display: flex; flex-direction: column; gap: 9px; padding: 4px 2px 2px; }
.o2h-connHeroRow { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; position: relative; }
.o2h-connHeroText { min-width: 0; }
.o2h-connTitle { margin: 13px 0 7px; color: #f4f8ff; font-size: 30px; font-weight: 800; letter-spacing: -.035em; line-height: 1.1; }
.o2h-connDesc { max-width: 680px; margin: 0; color: #7b90b3; font-size: 11.5px; line-height: 1.7; }
.o2h-connTest { max-width: 760px; padding: 7px 10px; overflow: hidden; border: 1px solid rgba(121, 157, 224, .16); border-radius: 8px; background: rgba(255, 255, 255, .025); color: #8da2c3; font-size: 9.5px; text-overflow: ellipsis; white-space: nowrap; }
.o2h-connTest[data-kind='ok'] { border-color: rgba(52, 211, 153, .24); background: rgba(52, 211, 153, .07); color: #6ee7b7; }
.o2h-connTest[data-kind='error'] { border-color: rgba(248, 113, 113, .24); background: rgba(248, 113, 113, .07); color: #fca5a5; }
.o2h-toast { position: absolute; top: 50%; left: 50%; z-index: 5; display: flex; align-items: flex-start; gap: 8px; max-width: min(420px, calc(100vw - 40px)); padding: 10px 13px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 1.5; box-shadow: 0 14px 38px rgba(15, 23, 42, .26); transform: translate(-50%, -50%); pointer-events: auto; animation: o2h-toastDrop .2s ease both; }
.o2h-toast[data-kind='ok'] { border-color: rgba(52, 211, 153, .35); background: color-mix(in srgb, #10b981 6%, var(--dsw-alias-bg-layer-1)); }
.o2h-toast[data-kind='error'] { border-color: rgba(248, 113, 113, .4); background: color-mix(in srgb, #ef4444 6%, var(--dsw-alias-bg-layer-1)); }
.o2h-toast svg { flex: none; margin-top: 1px; }
.o2h-toast[data-kind='ok'] svg { color: #10b981; }
.o2h-toast[data-kind='error'] svg { color: #ef4444; }
.o2h-toastText { min-width: 0; overflow-wrap: anywhere; }
.o2p-app[data-theme='light'] .o2h-toast { box-shadow: 0 18px 42px rgba(15, 23, 42, .16); }
@keyframes o2h-toastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes o2h-toastDrop { from { opacity: 0; transform: translate(-50%, calc(-50% - 8px)); } to { opacity: 1; transform: translate(-50%, -50%); } }
.o2h-connCard { padding: 5px 6px 8px; }
.o2h-connGrid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; }
.o2h-connColumn { padding: 0 0 10px; border-top: 2px solid rgba(96, 165, 250, .45); }
.o2h-connColumn[data-side='target'] { border-top-color: rgba(52, 211, 153, .45); }
.o2h-connColumnHead { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 16px 0; }
.o2h-connColumnTitle { display: flex; align-items: center; gap: 8px; color: #eaf2ff; font-size: 13px; font-weight: 700; }
.o2h-connColumnTitle svg { color: #60a5fa; }
.o2h-connColumn[data-side='target'] .o2h-connColumnTitle svg { color: #34d399; }
.o2h-connCount { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 18px; padding: 0 7px; border-radius: 999px; background: rgba(96, 165, 250, .14); color: #9cc4ff; font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums; }
.o2h-connColumn[data-side='target'] .o2h-connCount { background: rgba(52, 211, 153, .14); color: #6ee7b7; }
.o2h-connAddBtn { height: 28px; padding: 0 10px; font-size: 10.5px; }
.o2h-connColumnHint { margin: 6px 16px 10px; color: #7085a8; font-size: 10px; line-height: 1.4; }
.o2h-connColumnBody { display: flex; flex-direction: column; gap: 8px; padding: 0 12px 4px; min-height: 96px; }
.o2h-connColumn .o2p-conn { border-color: rgba(121, 157, 224, .14); background: rgba(255, 255, 255, .022); padding: 11px 12px; }
.o2h-connColumn .o2p-connName { color: #e7f0ff; }
.o2h-connColumn .o2p-connMeta { color: #7b90b3; }
.o2h-connColumn .o2p-label { color: #8da2c3; }
.o2h-connEmptyCol { margin: 0; padding: 20px 12px; border: 1px dashed rgba(121, 157, 224, .2); border-radius: 10px; color: #7b90b3; font-size: 11px; text-align: center; }
@media (max-width: 1100px) {
  .o2h-connGrid { grid-template-columns: minmax(0, 1fr); }
}
.o2h-settingsInner { gap: 12px; max-width: 980px; }
.o2h-settingsHead { padding: 0 2px; }
.o2h-settingsCard { padding-bottom: 6px; }
.o2h-settingsBody { display: flex; flex-direction: column; padding: 4px 18px 2px; }
.o2h-settingsRow { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 12px 0; border-bottom: 1px solid rgba(121, 157, 224, .1); }
.o2h-settingsRow:last-child { border-bottom: 0; }
.o2h-settingsLabel { min-width: 0; }
.o2h-settingsLabel b { display: block; color: #e7f0ff; font-size: 12px; font-weight: 650; }
.o2h-settingsLabel small { display: block; margin-top: 3px; color: #7b90b3; font-size: 10px; line-height: 1.45; }
.o2h-settingsValue { flex: none; color: #eaf2ff; font-size: 13px; font-variant-numeric: tabular-nums; }
.o2h-settingsText { max-width: 62%; color: #9db1d2; font-size: 11px; font-weight: 500; text-align: right; }
.o2h-themeSwitch { display: flex; flex: none; gap: 3px; padding: 3px; border: 1px solid rgba(121, 157, 224, .16); border-radius: 9px; background: rgba(255, 255, 255, .022); }
.o2h-themeSwitch button { height: 26px; padding: 0 14px; border: 0; border-radius: 6px; background: transparent; color: #8da2c3; font: inherit; font-size: 11px; cursor: pointer; }
.o2h-themeSwitch button[data-active='true'] { background: rgba(59, 130, 246, .2); color: #dbeafe; box-shadow: inset 0 0 0 1px rgba(96, 165, 250, .22); }
.o2h-settingsBtn { height: 30px; padding: 0 12px; font-size: 11px; }
.o2h-toggle { position: relative; display: inline-flex; flex: none; align-items: center; gap: 8px; cursor: pointer; }
.o2h-toggle input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.o2h-toggleTrack { position: relative; flex: none; width: 34px; height: 18px; border-radius: 999px; background: rgba(148, 163, 184, .35); transition: background .16s ease; }
.o2h-toggleTrack i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(15, 23, 42, .28); transition: transform .16s ease; }
.o2h-toggle input:checked + .o2h-toggleTrack { background: linear-gradient(135deg, #2563eb, #0ea5e9); }
.o2h-toggle input:checked + .o2h-toggleTrack i { transform: translateX(16px); }
.o2h-toggle input:focus-visible + .o2h-toggleTrack { outline: 2px solid rgba(96, 165, 250, .55); outline-offset: 2px; }
.o2h-toggleText { color: #9db1d2; font-size: 11px; }
.o2h-wizardOverlay.o2h-confirmOverlay { z-index: 160; }
.o2h-confirm { width: min(420px, 100%); padding: 20px 22px 16px; border: 1px solid rgba(121, 157, 224, .22); border-radius: 16px; background: linear-gradient(160deg, rgba(14, 25, 46, .98), rgba(7, 14, 27, .99)); box-shadow: 0 28px 70px rgba(0, 0, 0, .55); }
.o2h-confirmTitle { margin: 0; color: #f1f7ff; font-size: 15px; font-weight: 700; line-height: 1.45; word-break: break-word; }
.o2h-confirmText { margin: 8px 0 0; color: #9db1d2; font-size: 12px; line-height: 1.65; }
.o2h-confirmActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
.o2h-confirmDanger { background: linear-gradient(135deg, #dc2626, #ef4444); box-shadow: 0 10px 26px rgba(220, 38, 38, .32); }
.o2h-confirmDanger:hover { background: linear-gradient(135deg, #b91c1c, #dc2626); }
.o2h-connCard .o2p-connView { padding: 10px 12px; overflow: visible; }
.o2h-connCard .o2p-conn { border-color: rgba(121, 157, 224, .14); background: rgba(255, 255, 255, .022); }
.o2h-connCard .o2p-connName { color: #e7f0ff; }
.o2h-connCard .o2p-connMeta { color: #7b90b3; }
.o2h-connCard .o2p-connEmpty { color: #7b90b3; }
.o2h-connCard .o2p-label { color: #8da2c3; }
.o2h-connCard .o2p-input,
.o2h-connCard .o2p-select { border-color: rgba(121, 157, 224, .18); background: rgba(7, 14, 27, .7); color: #e7f0ff; }
.o2h-connCard .o2p-connFoot { padding-top: 2px; }
.o2h button:focus-visible { outline: 2px solid rgba(56, 189, 248, .8); outline-offset: 2px; }
.o2p-app[data-theme='light'] .o2h { background:
  radial-gradient(900px 430px at 8% -12%, rgba(37, 99, 235, .11), transparent 60%),
  radial-gradient(720px 400px at 96% -4%, rgba(34, 211, 238, .1), transparent 62%),
  linear-gradient(180deg, #f6f9ff 0%, #eef4ff 52%, #f6f9ff 100%); color: #0f172a; }
.o2p-app[data-theme='light'] .o2h::after { background-image: linear-gradient(rgba(37, 99, 235, .055) 1px, transparent 1px), linear-gradient(90deg, rgba(37, 99, 235, .055) 1px, transparent 1px); }
.o2p-app[data-theme='light'] .o2h-top { border-bottom-color: #e0e8f4; background: rgba(255, 255, 255, .82); color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-brandLine { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-brandText small,
.o2p-app[data-theme='light'] .o2h-engine,
.o2p-app[data-theme='light'] .o2h-heroDesc,
.o2p-app[data-theme='light'] .o2h-statLabel,
.o2p-app[data-theme='light'] .o2h-statFootText,
.o2p-app[data-theme='light'] .o2h-cardSub,
.o2p-app[data-theme='light'] .o2h-legend,
.o2p-app[data-theme='light'] .o2h-chartPeak,
.o2p-app[data-theme='light'] .o2h-pipeNode small,
.o2p-app[data-theme='light'] .o2h-checkLabel,
.o2p-app[data-theme='light'] .o2h-taskMeta,
.o2p-app[data-theme='light'] .o2h-taskTime,
.o2p-app[data-theme='light'] .o2h-foot,
.o2p-app[data-theme='light'] .o2h-connDesc,
.o2p-app[data-theme='light'] .o2h-connTest { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-heroDescLine::before { background: #0891b2; box-shadow: 0 0 5px rgba(8, 145, 178, .45); }
.o2p-app[data-theme='light'] .o2h-heroTitle,
.o2p-app[data-theme='light'] .o2h-statValue,.o2p-app[data-theme='light'] .o2h-cardTitle,
.o2p-app[data-theme='light'] .o2h-pipeNode b,
.o2p-app[data-theme='light'] .o2h-taskName,
.o2p-app[data-theme='light'] .o2h-connTitle,
.o2p-app[data-theme='light'] .o2h-nodeText b { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-nav { border-color: #dbe5f2; background: rgba(15, 23, 42, .025); }
.o2p-app[data-theme='light'] .o2h-navItem { color: #5b6b85; }
.o2p-app[data-theme='light'] .o2h-navItem:hover { background: #eef4fc; color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-topBtn { border-color: #cfe0f8; background: #eff6ff; color: #1d4ed8; }
.o2p-app[data-theme='light'] .o2h-topBtn:hover { border-color: #93c5fd; background: #dbeafe; }
.o2p-app[data-theme='light'] .o2h-iconBtn { border-color: #d7e3f4; background: #fff; color: #1d4ed8; }
.o2p-app[data-theme='light'] .o2h-iconBtn:hover { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; }
.o2p-app[data-theme='light'] .o2h-hero { border-color: #d8e4f5; background: radial-gradient(90% 130% at 0% 0%, rgba(37, 99, 235, .12), transparent 58%), radial-gradient(70% 90% at 96% 100%, rgba(34, 211, 238, .08), transparent 60%), linear-gradient(135deg, #ffffff, #f2f7ff); box-shadow: 0 24px 70px rgba(37, 99, 235, .12), inset 0 1px 0 #fff; }
.o2p-app[data-theme='light'] .o2h-hero::before { background-image: linear-gradient(rgba(37, 99, 235, .055) 1px, transparent 1px), linear-gradient(90deg, rgba(37, 99, 235, .055) 1px, transparent 1px); }
.o2p-app[data-theme='light'] .o2h-hero::after { background: radial-gradient(circle, rgba(34, 211, 238, .15), rgba(37, 99, 235, .05) 44%, transparent 68%); }
.o2p-app[data-theme='light'] .o2h-eyebrow { border-color: #cfe0ff; background: #edf5ff; color: #2563eb; }
.o2p-app[data-theme='light'] .o2h-ctaSecondary { border-color: #d3e1f4; background: #fff; color: #1e3a8a; }
.o2p-app[data-theme='light'] .o2h-ctaSecondary:hover { border-color: #93c5fd; background: #eff6ff; }
.o2p-app[data-theme='light'] .o2h-visualHalo { background: radial-gradient(circle, rgba(37, 99, 235, .14), transparent 66%); }
.o2p-app[data-theme='light'] .o2h-orbit { border-color: rgba(37, 99, 235, .15); }
.o2p-app[data-theme='light'] .o2h-orbitB { border-color: rgba(13, 148, 136, .12); }
.o2p-app[data-theme='light'] .o2h-connector { stroke: rgba(37, 99, 235, .34); }
.o2p-app[data-theme='light'] .o2h-connectorDot { fill: #0891b2; filter: drop-shadow(0 0 2px rgba(8, 145, 178, .6)); }
.o2p-app[data-theme='light'] .o2h-flowNode small,
.o2p-app[data-theme='light'] .o2h-flowEngine small { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-flowEngine b { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-flowLine { background: linear-gradient(90deg, rgba(37, 99, 235, .12), rgba(37, 99, 235, .4), rgba(37, 99, 235, .12)); }
.o2p-app[data-theme='light'] .o2h-flowDot { background: #0891b2; box-shadow: 0 0 9px rgba(8, 145, 178, .6); }
.o2p-app[data-theme='light'] .o2h-engineBox { border-color: #60a5fa; background: linear-gradient(150deg, rgba(37, 99, 235, .2), rgba(14, 165, 233, .06)); color: #1d4ed8; box-shadow: 0 10px 28px rgba(37, 99, 235, .12), 0 0 24px rgba(37, 99, 235, .12), inset 0 1px 0 rgba(255, 255, 255, .5); }
.o2p-app[data-theme='light'] .o2h-engineOrbitCircle { stroke: rgba(37, 99, 235, .35); }
.o2p-app[data-theme='light'] .o2h-engineArc { stroke: #2563eb; filter: drop-shadow(0 0 4px rgba(37, 99, 235, .55)); }
.o2p-app[data-theme='light'] .o2h-console { border-color: #d4e2f5; background: linear-gradient(160deg, #ffffff, #f2f7ff); box-shadow: 0 20px 50px rgba(37, 99, 235, .16), inset 0 1px 0 #fff; }
.o2p-app[data-theme='light'] .o2h-consoleHead { border-bottom-color: #e3ebf6; }
.o2p-app[data-theme='light'] .o2h-consoleTitle { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-windowDots i { background: #cbd5e1; }
.o2p-app[data-theme='light'] .o2h-nodeChip { border-color: #d6e3f5; background: #fff; box-shadow: 0 14px 32px rgba(37, 99, 235, .12), inset 0 1px 0 #fff; }
.o2p-app[data-theme='light'] .o2h-nodeText small { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-stat,
.o2p-app[data-theme='light'] .o2h-card { border-color: #e0e8f3; background: linear-gradient(155deg, #ffffff, #f8fbff); box-shadow: 0 10px 28px rgba(15, 23, 42, .05), inset 0 1px 0 #fff; }
.o2p-app[data-theme='light'] .o2h-trendSide { border-left-color: #e6edf7; background: linear-gradient(180deg, rgba(37, 99, 235, .025), transparent 55%); }
.o2p-app[data-theme='light'] .o2h-sideEyebrow { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-sideTile { border-color: #e2eaf5; background: #fff; }
.o2p-app[data-theme='light'] .o2h-sideTile span { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-sideTile b { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-sideRecentRow { border-bottom-color: #eef3fa; }
.o2p-app[data-theme='light'] .o2h-sideRecentName { color: #334155; }
.o2p-app[data-theme='light'] .o2h-sideRecentTime,
.o2p-app[data-theme='light'] .o2h-sideRecentCount,
.o2p-app[data-theme='light'] .o2h-sideEmpty { color: #94a3b8; }
.o2p-app[data-theme='light'] .o2h-sideMore { border-color: #dbe5f2; color: #64748b; }
.o2p-app[data-theme='light'] .o2h-sideMore:hover { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; }
.o2p-app[data-theme='light'] .o2h-sideAction { border-color: #dbe5f2; background: #fff; color: #334155; }
.o2p-app[data-theme='light'] .o2h-sideAction:hover { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; }
.o2p-app[data-theme='light'] .o2h-stat:hover { box-shadow: 0 18px 38px rgba(15, 23, 42, .08); }
.o2p-app[data-theme='light'] .o2h-statLive { color: #94a3b8; }
.o2p-app[data-theme='light'] .o2h-tabs { border-color: #dde7f4; background: #f2f7fd; }
.o2p-app[data-theme='light'] .o2h-tab { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-tab:hover { color: #1e3a8a; }
.o2p-app[data-theme='light'] .o2h-tab[data-active='true'] { background: #dbeafe; color: #1d4ed8; box-shadow: none; }
.o2p-app[data-theme='light'] .o2h-chart text { fill: #64748b; }
.o2p-app[data-theme='light'] .o2h-chart line { stroke: #e3eaf4; }
.o2p-app[data-theme='light'] .o2h-chartEmpty { background: rgba(255, 255, 255, .82); }
.o2p-app[data-theme='light'] .o2h-chartEmpty p { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-chartEmpty button { border-color: #cfe0ff; background: #eff6ff; color: #1d4ed8; }
.o2p-app[data-theme='light'] .o2h-checkValue { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-meterHead { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-meterHead b { color: #0e7490; }
.o2p-app[data-theme='light'] .o2h-meterTrack { background: #e2e8f2; }
.o2p-app[data-theme='light'] .o2h-codeOld { color: #b91c1c; text-decoration-color: rgba(185, 28, 28, .45); }
.o2p-app[data-theme='light'] .o2h-codeNew { color: #0e7490; }
.o2p-app[data-theme='light'] .o2h-running,
.o2p-app[data-theme='light'] .o2h-consoleNote { color: #047857; }
.o2p-app[data-theme='light'] .o2h-consoleNote.isWarn { color: #b45309; }
.o2p-app[data-theme='light'] .o2h-pipeNode,
.o2p-app[data-theme='light'] .o2h-check { border-color: #e2eaf5; background: #f8fbff; }
.o2p-app[data-theme='light'] .o2h-pipeCta { border-color: #cfe0ff; background: #eff6ff; color: #1d4ed8; }
.o2p-app[data-theme='light'] .o2h-linkBtn { border-color: #cfe0ff; background: #eff6ff; color: #1d4ed8; }
.o2p-app[data-theme='light'] .o2h-task:hover { background: #f1f7ff; }
.o2p-app[data-theme='light'] .o2h-task + .o2h-task { border-top-color: #edf2f9; }
.o2p-app[data-theme='light'] .o2h-taskTrack { background: #e6edf7; }
.o2p-app[data-theme='light'] .o2h-connColumn .o2p-conn { border-color: #e2eaf5; background: #fff; }
.o2p-app[data-theme='light'] .o2h-connColumn .o2p-connName { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-connColumn .o2p-connMeta { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-connColumnTitle { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-connColumnTitle svg { color: #2563eb; }
.o2p-app[data-theme='light'] .o2h-connColumn[data-side='target'] .o2h-connColumnTitle svg { color: #059669; }
.o2p-app[data-theme='light'] .o2h-connCount { background: #eff6ff; color: #1d4ed8; }
.o2p-app[data-theme='light'] .o2h-connColumn[data-side='target'] .o2h-connCount { background: #ecfdf5; color: #047857; }
.o2p-app[data-theme='light'] .o2h-connColumnHint { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-connEmptyCol { border-color: #dbe5f2; color: #64748b; }
.o2p-app[data-theme='light'] .o2h-settingsRow { border-bottom-color: #eef3fa; }
.o2p-app[data-theme='light'] .o2h-settingsLabel b { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-settingsLabel small { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-settingsValue { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-settingsText { color: #475569; }
.o2p-app[data-theme='light'] .o2h-themeSwitch { border-color: #e0e8f3; background: #fff; }
.o2p-app[data-theme='light'] .o2h-themeSwitch button { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-themeSwitch button[data-active='true'] { background: #eff6ff; color: #1d4ed8; }
.o2p-app[data-theme='light'] .o2h-toggleTrack { background: #cbd5e1; }
.o2p-app[data-theme='light'] .o2h-toggleText { color: #475569; }
.o2p-app[data-theme='light'] .o2h-confirm { border-color: #e0e8f3; background: #fff; box-shadow: 0 28px 70px rgba(15, 23, 42, .22); }
.o2p-app[data-theme='light'] .o2h-confirmTitle { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-confirmText { color: #475569; }
.o2p-app[data-theme='light'] .o2h-connToast { border-color: #a7f3d0; background: #f0fdf4; color: #047857; box-shadow: 0 16px 40px rgba(15, 23, 42, .18); }
.o2p-app[data-theme='light'] .o2h-connToast[data-kind='error'] { border-color: #fecaca; background: #fef2f2; color: #b91c1c; }
.o2p-app[data-theme='light'] .o2h-connCard .o2p-connName { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-connCard .o2p-connMeta,
.o2p-app[data-theme='light'] .o2h-connCard .o2p-connEmpty,
.o2p-app[data-theme='light'] .o2h-connCard .o2p-label { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-connCard .o2p-input,
.o2p-app[data-theme='light'] .o2h-connCard .o2p-select { border-color: #dbe5f2; background: #f8fbff; color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-connTest[data-kind='ok'] { border-color: #a7f3d0; color: #047857; }
.o2p-app[data-theme='light'] .o2h-connTest[data-kind='error'] { border-color: #fecaca; color: #b91c1c; }
/* Overview pages: migration tasks, assessment, history */
.o2h-pageInner { max-width: none; }
.o2h-pageHead { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 4px 2px 2px; }
.o2h-pageHeading { min-width: 0; }
.o2h-pageTitle { margin: 13px 0 7px; color: #f4f8ff; font-size: 30px; font-weight: 800; letter-spacing: -.035em; line-height: 1.1; }
.o2h-pageDesc { max-width: 720px; margin: 0; color: #7b90b3; font-size: 11.5px; line-height: 1.7; }
.o2h-pageActions { display: flex; flex: none; align-items: center; gap: 10px; padding-top: 10px; }
.o2h-pageStats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.o2h-pageStat { padding-bottom: 16px; }
.o2h-pageStat .o2h-statTop { justify-content: space-between; }
.o2h-pageCard { padding-bottom: 6px; }
.o2h-pageTable { display: flex; flex-direction: column; padding: 8px; }
.o2h-pageRow { display: grid; align-items: center; gap: 12px; padding: 11px 10px; border-radius: 10px; cursor: pointer; transition: background .15s ease; }
.o2h-pageRow:hover { background: rgba(59, 130, 246, .06); }
.o2h-pageRow:focus-visible { outline: 2px solid #38bdf8; outline-offset: -2px; }
.o2h-taskPageRow { grid-template-columns: 32px minmax(0, 1fr) 240px 112px; }
.o2h-pageRowMain { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.o2h-pageRowTitle { overflow: hidden; color: #e2ecff; font-size: 10.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.o2h-pageRowMeta { overflow: hidden; color: #6d82a6; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.o2h-pageRowProgress { display: flex; flex-direction: column; gap: 5px; }
.o2h-steps { display: flex; align-items: center; min-width: 0; }
.o2h-step { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
.o2h-stepDot { position: relative; display: grid; flex: none; place-items: center; width: 18px; height: 18px; border: 1px dashed rgba(148, 163, 184, .42); border-radius: 50%; background: rgba(148, 163, 184, .05); color: #64748b; transition: background .2s ease, color .2s ease, box-shadow .2s ease; }
.o2h-stepLabel { overflow: hidden; color: #64748b; font-size: 9.5px; line-height: 1; white-space: nowrap; text-overflow: ellipsis; }
.o2h-step.is-done .o2h-stepDot { border: 0; background: linear-gradient(135deg, #10b981, #34d399); color: #04231f; box-shadow: 0 0 0 3px rgba(52, 211, 153, .12), 0 4px 12px rgba(16, 185, 129, .26); }
.o2h-step.is-done .o2h-stepLabel { color: #6ee7b7; }
.o2h-step.is-active .o2h-stepDot { border: 0; background: linear-gradient(135deg, #2563eb, #22d3ee); color: #eaf6ff; box-shadow: 0 0 0 3px rgba(34, 211, 238, .12), 0 6px 16px rgba(37, 99, 235, .32); animation: o2h-stepPulse 1.8s ease-in-out infinite; }
.o2h-step.is-active .o2h-stepLabel { color: #bae6fd; font-weight: 600; }
.o2h-step.is-error .o2h-stepDot { border: 0; background: linear-gradient(135deg, #ef4444, #fb7185); color: #fff1f2; box-shadow: 0 0 0 3px rgba(248, 113, 113, .14), 0 4px 12px rgba(239, 68, 68, .26); }
.o2h-step.is-error .o2h-stepLabel { color: #fca5a5; }
.o2h-stepLink { display: block; flex: none; width: 16px; height: 2px; margin: 0 5px; border-radius: 2px; background: repeating-linear-gradient(90deg, rgba(148, 163, 184, .34) 0 4px, transparent 4px 8px); }
.o2h-stepLink.is-done { background: linear-gradient(90deg, #10b981, #34d399); }
.o2h-stepLink.is-active { background: linear-gradient(90deg, #22d3ee, #2563eb, #22d3ee); background-size: 200% 100%; animation: o2h-flow 1.6s linear infinite; }
.o2h-stepLink.is-error { background: linear-gradient(90deg, #ef4444, #fb7185); }
@keyframes o2h-stepPulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(34, 211, 238, .1), 0 6px 16px rgba(37, 99, 235, .28); }
  50% { box-shadow: 0 0 0 6px rgba(34, 211, 238, .16), 0 8px 22px rgba(37, 99, 235, .46); }
}
.o2h-pageEmpty { padding: 36px 16px; color: #7186a9; font-size: 10.5px; text-align: center; }
.o2h-cardAside { display: flex; flex: none; align-items: center; gap: 8px; }
.o2h-taskTypeChips { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
.o2h-taskTypeChip { padding: 1px 5px; border: 1px solid rgba(96, 165, 250, .18); border-radius: 4px; background: rgba(59, 130, 246, .07); color: #8fb8ee; font-size: 7px; font-weight: 600; line-height: 13px; }
.o2h-taskTypeChip.isMore { border-color: transparent; background: transparent; color: #6d82a6; }
.o2h-taskRowActions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
.o2h-taskAction { display: grid; place-items: center; width: 25px; height: 25px; padding: 0; border: 1px solid rgba(121, 157, 224, .16); border-radius: 7px; background: rgba(255, 255, 255, .025); color: #8da2c3; cursor: pointer; transition: background .15s ease, border-color .15s ease, color .15s ease; }
.o2h-taskAction:hover { border-color: rgba(96, 165, 250, .42); background: rgba(59, 130, 246, .13); color: #dbeafe; }
.o2h-taskAction.isDanger:hover { border-color: rgba(248, 113, 113, .42); background: rgba(248, 113, 113, .12); color: #fca5a5; }
.o2h-pageRow .o2h-taskAction { opacity: .58; }
.o2h-pageRow:hover .o2h-taskAction,
.o2h-pageRow:focus-within .o2h-taskAction { opacity: 1; }
.o2h-wizardOverlay { position: fixed; inset: 0; z-index: 90; display: flex; align-items: center; justify-content: center; padding: 22px; background: rgba(3, 8, 18, .64); backdrop-filter: blur(7px); animation: o2h-fade .18s ease both; }
.o2h-wizard { display: flex; flex-direction: column; width: min(720px, 100%); max-height: min(88vh, 820px); overflow: hidden; border: 1px solid rgba(96, 165, 250, .26); border-radius: 18px; background: radial-gradient(120% 110% at 0% 0%, rgba(37, 99, 235, .2), transparent 56%), linear-gradient(165deg, #0c1628, #070d1b); color: #eaf2ff; box-shadow: 0 34px 96px rgba(0, 0, 0, .62), inset 0 1px 0 rgba(255, 255, 255, .06); animation: o2h-wizardIn .22s cubic-bezier(.2, .8, .2, 1) both; }
.o2h-wizardHead { display: flex; flex: none; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 18px 22px 13px; border-bottom: 1px solid rgba(121, 157, 224, .12); }
.o2h-wizardHeading { min-width: 0; }
.o2h-wizardTitle { margin: 9px 0 5px; color: #f4f8ff; font-size: 21px; font-weight: 800; letter-spacing: -.03em; line-height: 1.15; }
.o2h-wizardSub { max-width: 560px; margin: 0; color: #7b90b3; font-size: 9.5px; line-height: 1.6; }
.o2h-wizardSteps { display: flex; flex: none; align-items: center; gap: 8px; padding: 13px 22px 0; }
.o2h-wizardStep { display: flex; align-items: center; gap: 7px; color: #66799b; font-size: 9px; font-weight: 600; white-space: nowrap; }
.o2h-wizardStepNo { display: grid; place-items: center; width: 21px; height: 21px; border: 1px solid rgba(121, 157, 224, .22); border-radius: 50%; background: rgba(255, 255, 255, .03); color: #8da2c3; font-size: 8.5px; font-weight: 700; }
.o2h-wizardStep[data-state='active'] { color: #dbeafe; }
.o2h-wizardStep[data-state='active'] .o2h-wizardStepNo { border-color: #3b82f6; background: linear-gradient(135deg, rgba(59, 130, 246, .9), rgba(14, 165, 233, .7)); color: #fff; box-shadow: 0 0 0 3px rgba(59, 130, 246, .12), 0 4px 14px rgba(37, 99, 235, .35); }
.o2h-wizardStep[data-state='done'] { color: #7dd3fc; }
.o2h-wizardStep[data-state='done'] .o2h-wizardStepNo { border-color: rgba(52, 211, 153, .4); background: rgba(52, 211, 153, .12); color: #6ee7b7; }
.o2h-wizardStepLine { width: 34px; height: 1px; background: rgba(121, 157, 224, .18); }
.o2h-wizardBody { display: flex; flex: 1; flex-direction: column; gap: 14px; min-height: 0; overflow: auto; padding: 18px 22px 20px; scrollbar-color: rgba(96, 165, 250, .28) transparent; scrollbar-width: thin; }
.o2h-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.o2h-fieldLabel { color: #8da2c3; font-size: 8.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
.o2h-input, .o2h-select, .o2h-textarea { box-sizing: border-box; width: 100%; padding: 0 11px; border: 1px solid rgba(121, 157, 224, .2); border-radius: 9px; outline: none; background: rgba(255, 255, 255, .035); color: #eaf2ff; font: inherit; font-size: 11.5px; }
.o2h-input, .o2h-select { height: 34px; }
.o2h-select { appearance: none; -webkit-appearance: none; padding-right: 28px; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%239db1d2' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/></svg>"); background-repeat: no-repeat; background-position: right 10px center; }
.o2h-select option { background: #0c1628; color: #eaf2ff; }
.o2h-selectWrap { position: relative; width: 100%; }
.o2h-selectBtn { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding-right: 10px; background-image: none; text-align: left; cursor: pointer; }
.o2h-selectValue { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.o2h-selectArrow { flex: none; width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid #9db1d2; }
.o2h-selectMenu { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 120; max-height: 260px; padding: 4px; border: 1px solid rgba(121, 157, 224, .3); border-radius: 10px; background: #0c1628; box-shadow: 0 18px 44px rgba(0, 0, 0, .55); overflow: auto; }
.o2h-selectMenu[data-up='true'] { top: auto; bottom: calc(100% + 4px); }
.o2h-selectOption { display: block; width: 100%; padding: 8px 9px; border: 0; border-radius: 7px; background: transparent; color: #dbe7fb; font: inherit; font-size: 11.5px; text-align: left; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.o2h-selectOption:hover, .o2h-selectOption[data-selected='true'] { background: rgba(59, 130, 246, .18); color: #ffffff; }
.o2h-selectMenu[data-theme='light'] { border-color: #d9e4f2; background: #ffffff; box-shadow: 0 18px 44px rgba(15, 23, 42, .16); }
.o2h-selectMenu[data-theme='light'] .o2h-selectOption { color: #0f172a; }
.o2h-selectMenu[data-theme='light'] .o2h-selectOption:hover,
.o2h-selectMenu[data-theme='light'] .o2h-selectOption[data-selected='true'] { background: #eff6ff; color: #1d4ed8; }
.o2h-textarea { min-height: 112px; padding: 9px 11px; resize: vertical; font-family: Consolas, "Cascadia Mono", ui-monospace, monospace; font-size: 11px; line-height: 17px; }
.o2h-input:focus, .o2h-select:focus, .o2h-textarea:focus { border-color: rgba(96, 165, 250, .72); background: rgba(59, 130, 246, .07); box-shadow: 0 0 0 3px rgba(37, 99, 235, .14); }
.o2h-input::placeholder, .o2h-textarea::placeholder { color: #5f7497; }
.o2h-modeGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.o2h-modeCard { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; padding: 10px 11px; border: 1px solid rgba(121, 157, 224, .17); border-radius: 11px; background: rgba(255, 255, 255, .022); color: #b9cbe8; font: inherit; text-align: left; cursor: pointer; transition: border-color .16s ease, background .16s ease, box-shadow .16s ease; }
.o2h-modeCard:hover { border-color: rgba(96, 165, 250, .42); background: rgba(59, 130, 246, .07); }
.o2h-modeCard b { font-size: 10.5px; font-weight: 650; }
.o2h-modeCard small { color: #7186a9; font-size: 7.5px; line-height: 1.45; }
.o2h-modeCardIcon { display: grid; place-items: center; width: 25px; height: 25px; margin-bottom: 4px; border-radius: 7px; background: rgba(96, 165, 250, .1); color: #7dd3fc; }
.o2h-modeCard[data-active='true'] { border-color: rgba(59, 130, 246, .75); background: linear-gradient(145deg, rgba(37, 99, 235, .24), rgba(14, 165, 233, .06)); color: #fff; box-shadow: 0 0 0 1px rgba(59, 130, 246, .28), 0 10px 26px rgba(37, 99, 235, .2); }
.o2h-modeCard[data-active='true'] small { color: #9db1d2; }
.o2h-modeCard[data-active='true'] .o2h-modeCardIcon { background: rgba(59, 130, 246, .32); color: #e0f2fe; }
.o2h-wizardInline { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 9px 11px; border: 1px dashed rgba(121, 157, 224, .24); border-radius: 9px; color: #8da2c3; font-size: 10px; }
.o2h-linkBtn { padding: 0; border: 0; background: transparent; color: #7dd3fc; font: inherit; font-size: 10px; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.o2h-linkBtn:hover { color: #bae6fd; }
.o2h-filePick { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.o2h-filePick .o2h-ctaSecondary { height: 32px; padding: 0 13px; font-size: 10.5px; }
.o2h-filePickHint { color: #7b90b3; font-size: 9.5px; }
.o2h-pickedFiles { display: flex; flex-wrap: wrap; gap: 5px; }
.o2h-pickedFile { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; padding: 3px 4px 3px 7px; border: 1px solid rgba(96, 165, 250, .2); border-radius: 7px; background: rgba(59, 130, 246, .08); color: #cfe0ff; font-size: 9px; }
.o2h-pickedFile svg { flex: none; color: #7dd3fc; }
.o2h-pickedName { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.o2h-pickedX { display: grid; place-items: center; width: 16px; height: 16px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: #8da2c3; font: inherit; font-size: 12px; line-height: 1; cursor: pointer; }
.o2h-pickedX:hover { background: rgba(248, 113, 113, .16); color: #fca5a5; }
.o2h-wizardHint { margin: 0; color: #7186a9; font-size: 9px; line-height: 1.55; }
.o2h-typeGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.o2h-typeTile { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 9px 10px; border: 1px solid rgba(121, 157, 224, .17); border-radius: 9px; background: rgba(255, 255, 255, .022); cursor: pointer; transition: border-color .15s ease, background .15s ease; }
.o2h-typeTile:hover { border-color: rgba(96, 165, 250, .4); background: rgba(59, 130, 246, .06); }
.o2h-typeTile[data-checked='true'] { border-color: rgba(59, 130, 246, .62); background: rgba(37, 99, 235, .14); }
.o2h-typeTile input { flex: none; margin: 0; accent-color: #3b82f6; }
.o2h-typeTileIcon { display: grid; flex: none; place-items: center; width: 22px; height: 22px; border-radius: 6px; background: rgba(96, 165, 250, .1); color: #7dd3fc; }
.o2h-typeTileText { display: flex; flex-direction: column; min-width: 0; }
.o2h-typeTileText b { color: #e6f0ff; font-size: 10px; font-weight: 600; }
.o2h-typeTileText small { color: #6d82a6; font-size: 7px; letter-spacing: .05em; }
.o2h-typeActions { display: flex; align-items: center; gap: 12px; }
.o2h-typeActionsCount { margin-left: auto; color: #7b90b3; font-size: 9px; }
.o2h-switchRow { display: flex; align-items: flex-start; gap: 10px; padding: 13px; border: 1px solid rgba(96, 165, 250, .22); border-radius: 11px; background: linear-gradient(145deg, rgba(37, 99, 235, .12), rgba(14, 165, 233, .04)); cursor: pointer; }
.o2h-switchRow input { flex: none; width: 16px; height: 16px; margin: 1px 0 0; accent-color: #3b82f6; }
.o2h-switchText { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.o2h-switchText b { color: #eaf2ff; font-size: 10.5px; font-weight: 650; }
.o2h-switchText small { color: #7b90b3; font-size: 8.5px; line-height: 1.55; }
.o2h-compatGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.o2h-compatOption { display: flex; align-items: flex-start; gap: 8px; min-width: 0; padding: 9px 10px; border: 1px solid rgba(121, 157, 224, .17); border-radius: 9px; background: rgba(255, 255, 255, .022); cursor: pointer; transition: border-color .15s ease, background .15s ease; }
.o2h-compatOption:hover { border-color: rgba(96, 165, 250, .4); background: rgba(59, 130, 246, .06); }
.o2h-compatOption[data-checked='true'] { border-color: rgba(59, 130, 246, .62); background: rgba(37, 99, 235, .14); }
.o2h-compatOption[data-disabled='true'] { cursor: default; opacity: .85; }
.o2h-compatOption input { flex: none; margin: 2px 0 0; accent-color: #3b82f6; }
.o2h-compatText { display: flex; flex-direction: column; min-width: 0; }
.o2h-compatText b { color: #e6f0ff; font-size: 10px; font-weight: 600; }
.o2h-compatText small { margin-top: 2px; color: #6d82a6; font-size: 8px; line-height: 1.45; }
.o2h-summary { display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(121, 157, 224, .15); border-radius: 11px; background: rgba(255, 255, 255, .02); }
.o2h-summaryRow { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 9px 12px; border-bottom: 1px solid rgba(121, 157, 224, .08); font-size: 9.5px; }
.o2h-summaryRow:last-child { border-bottom: 0; }
.o2h-summaryLabel { flex: none; color: #7186a9; }
.o2h-summaryValue { min-width: 0; overflow: hidden; color: #e2ecff; font-weight: 600; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
.o2h-wizardFoot { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 8px; padding: 13px 22px 17px; border-top: 1px solid rgba(121, 157, 224, .12); }
.o2h-wizardFootHint { flex: 1 1 160px; min-width: 0; }
.o2h-wizardError { flex: 1 1 200px; min-width: 0; color: #fca5a5; font-size: 9.5px; line-height: 1.45; }
.o2h-wizardFoot .o2h-ctaSecondary, .o2h-wizardFoot .o2h-ctaPrimary { height: 34px; padding: 0 15px; font-size: 10.5px; }
@keyframes o2h-wizardIn { from { opacity: 0; transform: translateY(14px) scale(.985); } to { opacity: 1; transform: none; } }
.o2p-app[data-theme='light'] .o2h-wizardOverlay { background: rgba(15, 23, 42, .34); }
.o2p-app[data-theme='light'] .o2h-wizard { border-color: #d9e4f2; background: radial-gradient(120% 110% at 0% 0%, rgba(37, 99, 235, .08), transparent 56%), linear-gradient(165deg, #ffffff, #f7faff); color: #0f172a; box-shadow: 0 28px 72px rgba(15, 23, 42, .24), inset 0 1px 0 #fff; }
.o2p-app[data-theme='light'] .o2h-wizardHead { border-bottom-color: #e6eef9; }
.o2p-app[data-theme='light'] .o2h-wizardTitle { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-wizardSub,
.o2p-app[data-theme='light'] .o2h-wizardHint,
.o2p-app[data-theme='light'] .o2h-wizardInline,
.o2p-app[data-theme='light'] .o2h-filePickHint,
.o2p-app[data-theme='light'] .o2h-typeActionsCount { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-wizardStep { color: #94a3b8; }
.o2p-app[data-theme='light'] .o2h-wizardStepNo { border-color: #d9e4f2; background: #fff; color: #64748b; }
.o2p-app[data-theme='light'] .o2h-wizardStep[data-state='active'] { color: #1d4ed8; }
.o2p-app[data-theme='light'] .o2h-wizardStep[data-state='done'] { color: #047857; }
.o2p-app[data-theme='light'] .o2h-fieldLabel { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-input,
.o2p-app[data-theme='light'] .o2h-select,
.o2p-app[data-theme='light'] .o2h-textarea { border-color: #d9e4f2; background: #ffffff; color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-input::placeholder,
.o2p-app[data-theme='light'] .o2h-textarea::placeholder { color: #94a3b8; }
.o2p-app[data-theme='light'] .o2h-select option { background: #ffffff; color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-selectArrow { border-top-color: #64748b; }
.o2p-app[data-theme='light'] .o2h-selectMenu { border-color: #d9e4f2; background: #ffffff; box-shadow: 0 18px 44px rgba(15, 23, 42, .16); }
.o2p-app[data-theme='light'] .o2h-selectOption { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-selectOption:hover, .o2p-app[data-theme='light'] .o2h-selectOption[data-selected='true'] { background: #eff6ff; color: #1d4ed8; }
.o2p-app[data-theme='light'] .o2h-modeCard { border-color: #e0e8f3; background: #fff; color: #475569; }
.o2p-app[data-theme='light'] .o2h-modeCard small { color: #94a3b8; }
.o2p-app[data-theme='light'] .o2h-modeCard[data-active='true'] { border-color: #7db3f6; background: linear-gradient(145deg, #eff6ff, #f5faff); color: #0f172a; box-shadow: 0 0 0 1px rgba(59, 130, 246, .2), 0 10px 24px rgba(37, 99, 235, .1); }
.o2p-app[data-theme='light'] .o2h-modeCard[data-active='true'] .o2h-modeCardIcon { background: #dbeafe; color: #1d4ed8; }
.o2p-app[data-theme='light'] .o2h-modeCardIcon { background: #eff6ff; color: #2563eb; }
.o2p-app[data-theme='light'] .o2h-typeTile { border-color: #e0e8f3; background: #fff; }
.o2p-app[data-theme='light'] .o2h-typeTile[data-checked='true'] { border-color: #8ab8f8; background: #eff6ff; }
.o2p-app[data-theme='light'] .o2h-typeTileIcon { background: #eff6ff; color: #2563eb; }
.o2p-app[data-theme='light'] .o2h-typeTileText b { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-typeTileText small { color: #94a3b8; }
.o2p-app[data-theme='light'] .o2h-switchRow { border-color: #d9e4f2; background: linear-gradient(145deg, #f3f8ff, #fbfdff); }
.o2p-app[data-theme='light'] .o2h-switchText b { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-switchText small { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-compatOption { border-color: #e0e8f3; background: #fff; }
.o2p-app[data-theme='light'] .o2h-compatOption[data-checked='true'] { border-color: #8ab8f8; background: #eff6ff; }
.o2p-app[data-theme='light'] .o2h-compatText b { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-compatText small { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-summary { border-color: #e0e8f3; background: #fff; }
.o2p-app[data-theme='light'] .o2h-summaryRow { border-bottom-color: #eef3fa; }
.o2p-app[data-theme='light'] .o2h-summaryValue { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-wizardFoot { border-top-color: #e6eef9; }
.o2p-app[data-theme='light'] .o2h-taskTypeChip { border-color: #dbeafe; background: #eff6ff; color: #2563eb; }
.o2p-app[data-theme='light'] .o2h-taskAction { border-color: #e0e8f3; background: #fff; color: #64748b; }
.o2p-app[data-theme='light'] .o2h-taskAction:hover { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; }
.o2p-app[data-theme='light'] .o2h-taskAction.isDanger:hover { border-color: #fecaca; background: #fef2f2; color: #b91c1c; }
@media (max-width: 640px) {
  .o2h-wizardOverlay { padding: 0; }
  .o2h-wizard { width: 100%; height: 100%; max-height: 100%; border: 0; border-radius: 0; }
  .o2h-wizardSteps { overflow-x: auto; scrollbar-width: none; }
  .o2h-wizardStepLine { width: 16px; }
  .o2h-modeGrid { grid-template-columns: minmax(0, 1fr); }
  .o2h-typeGrid { grid-template-columns: minmax(0, 1fr); }
  .o2h-taskTypeChips { display: none; }
  .o2h-taskRowActions { gap: 2px; }
  .o2h-taskAction { width: 24px; height: 24px; }
}

.o2h-assessChip { display: inline-flex; flex: none; align-items: center; gap: 6px; margin-top: 8px; padding: 7px 11px; border: 1px solid rgba(251, 191, 36, .24); border-radius: 999px; background: rgba(251, 191, 36, .08); color: #fbbf24; font-size: 9.5px; font-weight: 600; }
.o2h-assessChip.isGood { border-color: rgba(52, 211, 153, .24); background: rgba(52, 211, 153, .08); color: #34d399; }
.o2h-assessChip i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.o2h-assessTop { display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 20px 26px; padding: 18px 22px 16px; align-items: center; }
.o2h-assessHead { display: flex; grid-column: 1 / -1; order: -1; align-items: flex-start; justify-content: space-between; gap: 14px; padding-bottom: 12px; border-bottom: 1px solid rgba(121, 157, 224, .12); }
.o2h-assessHead .o2h-cardTitle { margin: 0 0 4px; }
.o2h-assessDonutWrap { position: relative; width: 170px; height: 170px; margin: 0 auto; }
.o2h-donut { display: block; width: 170px; height: 170px; transform: rotate(0deg); }
.o2h-donutValue { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; text-align: center; }
.o2h-donutValue b { color: #f2f7ff; font-size: 30px; font-weight: 800; letter-spacing: -.04em; line-height: 1; }
.o2h-donutValue span { max-width: 100px; color: #7b90b3; font-size: 8px; line-height: 1.35; }
.o2h-assessLegend { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.o2h-assessLegendRow { display: flex; align-items: center; gap: 9px; color: #9aafd0; font-size: 11px; }
.o2h-assessLegendRow b { margin-left: auto; color: #f2f7ff; font-size: 16px; font-weight: 700; }
.o2h-assessDot { flex: none; width: 8px; height: 8px; border-radius: 50%; }
.o2h-assessDot.isGood { background: #34d399; box-shadow: 0 0 7px rgba(52, 211, 153, .55); }
.o2h-assessDot.isWarn { background: #fbbf24; box-shadow: 0 0 7px rgba(251, 191, 36, .5); }
.o2h-assessDot.isBad { background: #f87171; box-shadow: 0 0 7px rgba(248, 113, 113, .5); }
.o2h-assessLegendTotal { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 4px; padding-top: 12px; border-top: 1px solid rgba(121, 157, 224, .12); color: #8da2c3; font-size: 11px; }
.o2h-assessLegendTotal b { color: #f2f7ff; font-size: 20px; font-weight: 750; }
.o2h-assessBars { padding-bottom: 14px; }
.o2h-assessBarList { display: flex; flex-direction: column; gap: 9px; padding: 12px 18px 0; }
.o2h-assessBarRow { display: grid; grid-template-columns: 116px minmax(0, 1fr) 46px; align-items: center; gap: 12px; }
.o2h-assessBarLabel { color: #8da2c3; font-size: 9px; letter-spacing: .04em; }
.o2h-assessBarTrack { height: 6px; overflow: hidden; border-radius: 999px; background: rgba(255, 255, 255, .06); }
.o2h-assessBarTrack i { display: block; height: 100%; border-radius: inherit; transition: width .4s ease; }
.o2h-assessBarTrack i.isGood { background: linear-gradient(90deg, #10b981, #34d399); }
.o2h-assessBarTrack i.isWarn { background: linear-gradient(90deg, #d97706, #fbbf24); }
.o2h-assessBarTrack i.isBad { background: linear-gradient(90deg, #dc2626, #f87171); }
.o2h-assessBarValue { color: #c9d9f2; font-size: 9px; font-weight: 600; text-align: right; }
.o2h-assessNote { margin: 12px 18px 0; color: #6f84a8; font-size: 8.5px; line-height: 1.5; }
.o2h-historyCard { padding-bottom: 8px; }
.o2h-historyHead, .o2h-historyRow { display: grid; grid-template-columns: 90px 72px minmax(0, 1fr) 120px 130px 80px; align-items: center; gap: 12px; padding: 0 12px; }
.o2h-historyHead { min-height: 36px; border-bottom: 1px solid rgba(121, 157, 224, .1); color: #6f84a8; font-size: 8px; letter-spacing: .05em; text-transform: uppercase; }
.o2h-historyList { display: flex; flex-direction: column; padding: 4px 0; }
.o2h-historyRow { min-height: 40px; border-radius: 8px; color: #c9d9f2; font-size: 9.5px; }
.o2h-historyRow:hover { background: rgba(59, 130, 246, .06); }
.o2h-historyCol { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.o2h-historyActionTag { display: inline-flex; align-items: center; justify-content: center; height: 20px; padding: 0 7px; border-radius: 999px; font-size: 8px; font-weight: 600; }
.o2h-historyActionTag.isConvert { border: 1px solid rgba(96, 165, 250, .24); background: rgba(59, 130, 246, .1); color: #93c5fd; }
.o2h-historyActionTag.isExecute { border: 1px solid rgba(167, 139, 250, .24); background: rgba(139, 92, 246, .1); color: #c4b5fd; }
.o2h-historyActionTag.isBoth { padding: 0 5px; border: 1px solid rgba(45, 212, 191, .26); background: rgba(20, 184, 166, .1); color: #5eead4; font-size: 7px; }
.o2h-historyObjectText { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.o2h-historyObjectName { overflow: hidden; color: #e2ecff; font-size: 9.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.o2h-historyObjectMeta { overflow: hidden; color: #6f84a8; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.o2h-historyResult .o2h-pill { height: 20px; }
.o2p-app[data-theme='light'] .o2h-pageTitle { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-pageDesc,
.o2p-app[data-theme='light'] .o2h-pageRowMeta,
.o2p-app[data-theme='light'] .o2h-assessLegendRow,
.o2p-app[data-theme='light'] .o2h-assessBarLabel,
.o2p-app[data-theme='light'] .o2h-assessNote,
.o2p-app[data-theme='light'] .o2h-donutValue span,
.o2p-app[data-theme='light'] .o2h-historyHead { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-pageRowTitle,
.o2p-app[data-theme='light'] .o2h-donutValue b,
.o2p-app[data-theme='light'] .o2h-assessLegendRow b,
.o2p-app[data-theme='light'] .o2h-assessLegendTotal b,
.o2p-app[data-theme='light'] .o2h-assessBarValue { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-stepDot { border-color: #cbd5e1; background: #f1f5f9; color: #94a3b8; }
.o2p-app[data-theme='light'] .o2h-stepLabel { color: #94a3b8; }
.o2p-app[data-theme='light'] .o2h-step.is-done .o2h-stepDot { border: 0; background: linear-gradient(135deg, #10b981, #34d399); color: #04231f; }
.o2p-app[data-theme='light'] .o2h-step.is-done .o2h-stepLabel { color: #047857; }
.o2p-app[data-theme='light'] .o2h-step.is-active .o2h-stepDot { border: 0; background: linear-gradient(135deg, #2563eb, #22d3ee); color: #eff6ff; }
.o2p-app[data-theme='light'] .o2h-step.is-active .o2h-stepLabel { color: #1d4ed8; }
.o2p-app[data-theme='light'] .o2h-step.is-error .o2h-stepDot { border: 0; background: linear-gradient(135deg, #ef4444, #fb7185); color: #fff; }
.o2p-app[data-theme='light'] .o2h-step.is-error .o2h-stepLabel { color: #b91c1c; }
.o2p-app[data-theme='light'] .o2h-stepLink { background: repeating-linear-gradient(90deg, rgba(148, 163, 184, .42) 0 4px, transparent 4px 8px); }
.o2p-app[data-theme='light'] .o2h-assessBarTrack { background: #e6edf7; }
.o2p-app[data-theme='light'] .o2h-assessHead,
.o2p-app[data-theme='light'] .o2h-assessLegendTotal,
.o2p-app[data-theme='light'] .o2h-historyHead { border-color: #e2eaf5; }
.o2p-app[data-theme='light'] .o2h-historyRow { color: #334155; }
.o2p-app[data-theme='light'] .o2h-historyRow:hover { background: #f1f7ff; }
.o2p-app[data-theme='light'] .o2h-historyObjectName { color: #0f172a; }
.o2p-app[data-theme='light'] .o2h-historyObjectMeta { color: #64748b; }
.o2p-app[data-theme='light'] .o2h-historyActionTag.isBoth { border-color: #99f6e4; background: #f0fdfa; color: #0f766e; }
@media (max-width: 1100px) {
  .o2h-navItem { height: 32px; padding: 0 13px; font-size: 12px; }
  .o2h-navItemHome { height: 36px; padding: 0 18px; font-size: 13px; }
  .o2h-trendBody { grid-template-columns: minmax(0, 1fr); }
  .o2h-trendSide { display: none; }
}
@media (max-width: 1280px) {
  .o2h-top { gap: 10px; padding: 0 16px; }
  .o2h-navItem { height: 32px; padding: 0 13px; font-size: 12px; }
  .o2h-navItemHome { height: 36px; padding: 0 18px; font-size: 13px; }
}
@media (max-width: 1080px) {
  .o2h-brandText small { display: none; }
  .o2h-engine { display: none; }
  .o2h-navItem { padding: 0 11px; font-size: 11.5px; }
}
@media (max-width: 860px) {
  .o2h-top { flex-wrap: wrap; gap: 8px; padding: 8px 12px; }
  .o2h-brand { flex: 1 1 auto; }
  .o2h-topRight { flex: 0 0 auto; }
  .o2h-nav { order: 3; flex: 1 0 100%; width: 100%; justify-content: flex-start; }
  .o2h-navItem { flex: 0 0 auto; }
}
@media (max-width: 960px) {
  .o2h-navItem { padding: 0 10px; font-size: 11.5px; }
  .o2h-navItemHome { padding: 0 15px; font-size: 12.5px; }
}
@media (max-width: 860px) {
  .o2h-pageStats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .o2h-assessTop { grid-template-columns: minmax(0, 1fr); }
  .o2h-assessDonutWrap { width: 150px; height: 150px; }
  .o2h-donut { width: 150px; height: 150px; }
  .o2h-historyHead, .o2h-historyRow { grid-template-columns: 76px 64px minmax(0, 1fr) 96px; }
  .o2h-historyTarget, .o2h-historyDuration { display: none; }
  .o2h-taskPageRow { grid-template-columns: 30px minmax(0, 1fr) 118px; }
  .o2h-pageRowProgress { display: none; }
}
@media (max-width: 560px) {
  .o2h-pageTitle { font-size: 25px; }
  .o2h-pageStats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .o2h-historyHead, .o2h-historyRow { grid-template-columns: 64px 56px minmax(0, 1fr); }
  .o2h-historyResult { display: none; }
}
@keyframes o2h-toastIn { from { opacity: 0; transform: translate(-50%, -6px); } to { opacity: 1; transform: translate(-50%, 0); } }
@keyframes o2h-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes o2h-shine { 0%, 55% { left: -42%; } 86%, 100% { left: 118%; } }
@keyframes o2h-live { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .55; transform: scale(.82); } }
@keyframes o2h-orbitSpin { to { transform: translate(-50%, -50%) rotate(360deg); } }
@keyframes o2h-dashFlow { to { stroke-dashoffset: -16; } }
@keyframes o2h-flowDot { 0% { left: 0; opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { left: calc(100% - 5px); opacity: 0; } }
@keyframes o2h-breathe { 0%, 100% { opacity: .55; transform: scale(.9); } 50% { opacity: 1; transform: scale(1.12); } }
@keyframes o2h-draw { to { stroke-dashoffset: 0; } }
@keyframes o2h-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes o2h-point { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
@keyframes o2h-meter { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes o2h-rotate { to { transform: rotate(360deg); } }
@keyframes o2h-flow { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
@media (max-width: 1120px) {
  .o2h-hero { grid-template-columns: minmax(0, 1fr) minmax(360px, .9fr); padding: 28px; }
  .o2h-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .o2h-main { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 860px) {
  .o2h-top { flex-wrap: wrap; gap: 10px; padding: 12px 18px; }
  .o2h-nav { order: 3; width: 100%; justify-content: center; }
  .o2h-topRight { margin-left: auto; }
  .o2h-engine { display: none; }
  .o2h-inner { padding: 18px; }
  .o2h-hero { grid-template-columns: minmax(0, 1fr); gap: 18px; padding: 26px 22px; }
  .o2h-visual { width: 100%; max-width: 430px; min-height: 300px; margin: 0 auto; }
  .o2h-task { grid-template-columns: 30px minmax(0, 1fr) 92px 18px; }
  .o2h-taskProgress { display: none; }
}
@media (max-height: 1120px) {
  .o2h-home .o2h-inner { gap: 10px; padding-top: 12px; padding-bottom: 12px; }
  .o2h-home .o2h-hero { padding: 18px 26px; }
  .o2h-home .o2h-heroTitle { margin: 10px 0 8px; font-size: clamp(28px, 3vw, 44px); }
  .o2h-home .o2h-heroDesc { font-size: 12.5px; line-height: 1.55; }
  .o2h-home .o2h-stats { gap: 10px; }
  .o2h-home .o2h-trendCard .o2h-cardHead { padding: 14px 16px 0; }
}
@media (max-width: 560px) {
  .o2h-top { padding: 10px 14px; }
  .o2h-brandText small { display: none; }
  .o2h-topBtn { display: none; }
  .o2h-inner { gap: 12px; padding: 12px 12px 26px; }
  .o2h-hero { padding: 22px 18px 20px; border-radius: 18px; }
  .o2h-heroTitle { font-size: 30px; }
  .o2h-heroDesc { font-size: 13.5px; }
  .o2h-ctaPrimary, .o2h-ctaSecondary { width: 100%; }
  .o2h-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .o2h-stat { padding: 13px 13px 12px; }
  .o2h-statValue { font-size: 24px; }
  .o2h-statFootText { font-size: 8px; }
  .o2h-spark { display: none; }
  .o2h-cardHead { padding: 14px 14px 0; }
  .o2h-cardSub { font-size: 8.5px; }
  .o2h-chartWrap { padding: 2px 0 0; }
  .o2h-chartFoot { padding: 0 14px 12px; }
  .o2h-pipeFlow { gap: 2px; padding: 16px 10px 10px; }
  .o2h-pipeLink { width: 12px; }
  .o2h-pipeCore { width: 42px; }
  .o2h-checks { padding: 2px 12px 10px; }
  .o2h-pipeCta { width: calc(100% - 24px); margin: 0 12px 12px; }
  .o2h-task { grid-template-columns: 28px minmax(0, 1fr) 72px 16px; gap: 8px; padding: 10px 6px; }
  .o2h-pill { padding: 0 6px; font-size: 7.5px; }
  .o2h-foot { flex-direction: column; gap: 4px; }
}
@media (max-width: 700px) {
  .o2h-chart text { font-size: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .o2h *, .o2h *::before, .o2h *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
}
.o2p-homeLink { display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
.o2p-homeLink svg { flex: none; }
/* Readability pass: lift the smallest type while keeping the same layout language */
.o2p { font-size: 13px; }
.o2h { font-size: 13px; }
.o2p-explorerTitle { font-size: 12.5px; }
.o2p-search { height: 30px; font-size: 12.5px; }
.o2p-listCount { font-size: 12px; }
.o2p-groupHead { font-size: 11.5px; }
.o2p-groupChevron { font-size: 10px; }
.o2p-sourceSelect { height: 30px; font-size: 12px; }
.o2p-typePopHead { font-size: 12px; }
.o2p-typeOption, .o2p-typeMenuActions .o2p-ghost { font-size: 12px; }
.o2p-btn { height: 28px; font-size: 12px; }
.o2p-btnAi { display: inline-flex; align-items: center; gap: 5px; }
.o2p-btnAi svg { flex: none; color: #7c3aed; }
.o2p-btnLead { display: inline-flex; align-items: center; gap: 5px; }
.o2p-btnLead svg { flex: none; }
.o2p-ghost { height: 26px; font-size: 12px; }
.o2p-paneTitle { font-size: 13.5px; }
.o2p-paneFoot { height: 28px; font-size: 12px; }
.o2p-select, .o2p-input { height: 30px; font-size: 12.5px; }
.o2p-toggle { font-size: 12px; }
.o2p-statusbar { height: 26px; font-size: 12px; }
.o2p-label { font-size: 12px; line-height: 16px; }
.o2p-connName { font-size: 14px; }
.o2p-connMeta, .o2p-modalStatus, .o2p-schemaItem { font-size: 12.5px; }
.o2p-menuItem { font-size: 13px; }
.o2p-introText { font-size: 13px; }
.o2p-workspaceDesc { font-size: 12px; }
.o2p-fileName, .o2p-fileNameInput { font-size: 13px; }
.o2p-insightTab { height: 32px; font-size: 12px; }
.o2p-insightLabel { font-size: 10.5px; }
.o2p-insightValue { font-size: 15px; }
.o2p-insightMetaLabel { font-size: 10.5px; }
.o2p-ruleChip { font-size: 10px; }
.o2p-insightEmpty { font-size: 11.5px; }
.o2p-diffList { font-size: 11.5px; line-height: 18px; }
.o2p-diffNo { font-size: 10.5px; }
.o2p-diffNote { font-size: 10px; }
.o2p-execState { font-size: 12px; }
.o2p-execNote { font-size: 11px; line-height: 16px; }
.o2p-execTime { font-size: 10px; }
.o2p-riskRow { font-size: 11.5px; }
.o2p-typeBadge { font-size: 10px; line-height: 15px; }
.o2p-insights { height: 220px; min-height: 180px; }
.o2h-brandText small { font-size: 10.5px; }
.o2h-engine { font-size: 11px; }
.o2h-topBtn { height: 32px; font-size: 11.5px; }
.o2h-nav { gap: 6px; padding: 5px; }
.o2h-navItem { height: 38px; padding: 0 26px; font-size: 13.5px; }
.o2h-navItemHome { height: 38px; font-size: 14px; }
.o2h-demoChip { font-size: 9.5px; }
.o2h-eyebrow { font-size: 10px; }
.o2h-heroDesc { font-size: 15px; }
.o2h-ctaPrimary, .o2h-ctaSecondary { height: 38px; font-size: 12.5px; }
.o2h-statLabel { font-size: 11.5px; }
.o2h-statLive { font-size: 9px; }
.o2h-statFootText { font-size: 10.5px; }
.o2h-cardTitle { font-size: 14px; }
.o2h-cardSub { font-size: 11.5px; }
.o2h-tab { height: 26px; font-size: 11px; }
.o2h-sideEyebrow { font-size: 9.5px; }
.o2h-sideAction { height: 34px; font-size: 12px; }
.o2h-legend, .o2h-chartPeak { font-size: 10.5px; }
.o2h-taskName { font-size: 12px; }
.o2h-taskMeta { font-size: 10.5px; }
.o2h-taskTime { font-size: 9.5px; }
.o2h-pill { height: 23px; font-size: 10px; }
.o2h-recentEmpty { font-size: 12px; }
.o2h-foot { font-size: 10px; }
.o2h-pageDesc { font-size: 13px; max-width: 940px; }
.o2h-pageRowTitle { font-size: 12.5px; }
.o2h-pageRowMeta { font-size: 10.5px; }
.o2h-pageEmpty { font-size: 12px; }
.o2h-taskTypeChip { font-size: 9px; line-height: 15px; }
.o2h-wizardSub { font-size: 11.5px; }
.o2h-wizardStep { font-size: 10.5px; }
.o2h-wizardStepNo { font-size: 10px; }
.o2h-fieldLabel { font-size: 10.5px; }
.o2h-input, .o2h-select { height: 38px; font-size: 13px; }
.o2h-textarea { font-size: 12.5px; line-height: 19px; }
.o2h-modeCard b { font-size: 12px; }
.o2h-modeCard small { font-size: 10px; }
.o2h-wizardInline { font-size: 11.5px; }
.o2h-filePick .o2h-ctaSecondary { height: 34px; font-size: 12px; }
.o2h-filePickHint { font-size: 11px; }
.o2h-pickedFile { font-size: 10.5px; }
.o2h-wizardHint { font-size: 11px; }
.o2h-typeTileText b { font-size: 11.5px; }
.o2h-typeTileText small { font-size: 9px; }
.o2h-typeActionsCount { font-size: 10.5px; }
.o2h-linkBtn { font-size: 11.5px; }
.o2h-switchText b { font-size: 12px; }
.o2h-switchText small { font-size: 10.5px; }
.o2h-summaryRow { font-size: 11.5px; }
.o2h-wizardError { font-size: 11px; }
.o2h-wizardFoot .o2h-ctaSecondary, .o2h-wizardFoot .o2h-ctaPrimary { height: 36px; font-size: 12px; }
.o2h-assessChip { font-size: 11px; }
.o2h-donutValue span { font-size: 9.5px; }
.o2h-assessLegendRow, .o2h-assessLegendTotal { font-size: 12px; }
.o2h-assessBarLabel, .o2h-assessBarValue { font-size: 10.5px; }
.o2h-assessNote { font-size: 10.5px; }
.o2h-historyHead { min-height: 40px; font-size: 10px; }
.o2h-historyRow { min-height: 54px; font-size: 11.5px; }
.o2h-historyActionTag { height: 22px; font-size: 10px; }
.o2h-historyActionTag.isBoth { font-size: 9px; }
.o2h-historyObjectName { font-size: 12px; }
.o2h-historyObjectMeta { font-size: 10.5px; }
.o2h-connDesc { font-size: 13px; }
.o2h-connTest { font-size: 11px; }
.o2h-codeOld, .o2h-codeNew { font-size: 10px; }
.o2h-consoleNote { font-size: 9px; }
.o2h-meterHead { font-size: 9.5px; }
.o2h-meterHead b { font-size: 10.5px; }
.o2h-nodeText b { font-size: 10.5px; }
.o2h-flowNode small { font-size: 10px; }
.o2h-flowEngine small { font-size: 9px; }
.o2h-pipeNode b { font-size: 11px; }
.o2h-pipeNode small { font-size: 9px; }
.o2h-checkLabel, .o2h-checkValue { font-size: 10px; }
/* Readability pass 2: task/history rows carry the primary information, keep them at body size */
.o2h-pageRow { padding: 14px 12px; }
.o2h-pageRowTitle { font-size: 14px; }
.o2h-pageRowMeta { font-size: 12px; }
.o2h-pageEmpty { font-size: 13px; }
.o2h-taskPageRow { grid-template-columns: 34px minmax(0, 1fr) 240px 120px; }
.o2h-taskTypeChips { gap: 5px; margin-top: 6px; }
.o2h-taskTypeChip { padding: 2px 7px; font-size: 11px; line-height: 18px; }
.o2h-taskTime { font-size: 11px; }
.o2h-pill { height: 26px; padding: 0 10px; font-size: 12px; }
.o2h-pill i { width: 5px; height: 5px; }
.o2h-taskAction { width: 28px; height: 28px; }
.o2h-taskName { font-size: 13px; }
.o2h-taskMeta { font-size: 11.5px; }
.o2h-historyHead { min-height: 42px; font-size: 11px; }
.o2h-historyRow { min-height: 58px; font-size: 12px; }
.o2h-historyHead, .o2h-historyRow { grid-template-columns: 96px 88px minmax(0, 1fr) 130px 130px 90px; }
.o2h-historyActionTag { height: 24px; font-size: 11px; }
.o2h-historyActionTag.isBoth { font-size: 10px; }
.o2h-historyObjectName { font-size: 13px; }
.o2h-historyObjectMeta { font-size: 11.5px; }
.o2h-cardSub { font-size: 12.5px; }
.o2h-statLabel { font-size: 12px; }
.o2h-statFootText { font-size: 11.5px; }
.o2h-wizardSub { font-size: 12.5px; }
.o2h-fieldLabel { font-size: 11.5px; }
.o2h-wizardHint { font-size: 12px; }
.o2h-modeCard small { font-size: 11px; }
.o2h-typeTileText small { font-size: 10px; }
.o2h-summaryRow { font-size: 12.5px; }
.o2h-switchText small { font-size: 11.5px; }
.o2h-filePickHint { font-size: 12px; }
.o2h-typeActionsCount { font-size: 11.5px; }
.o2h-pickedFile { font-size: 11.5px; }
.o2p-taskTop, .o2p-filterTop { padding-bottom: 0; }
.o2h-pageRowTitle { font-size: 15px; }
.o2h-heroLead { width: 100%; max-width: 100%; }
.o2h-pageRowMeta { font-size: 13px; }
.o2h-taskTypeChip { font-size: 12px; line-height: 19px; }
.o2h-taskTime { font-size: 11.5px; }
.o2h-stepLabel { font-size: 11px; }
.o2h-taskPageRow { grid-template-columns: 34px minmax(0, 1fr) 250px 120px; }
.o2h-historyObjectName { font-size: 14px; }
.o2h-historyObjectMeta { font-size: 12px; }
.o2h-historyHead { font-size: 11.5px; }
@media (max-width: 860px) {
  .o2h-taskPageRow { grid-template-columns: 30px minmax(0, 1fr) 118px; }
  .o2h-historyHead, .o2h-historyRow { grid-template-columns: 80px 72px minmax(0, 1fr) 100px; }
}
@media (max-width: 560px) {
  .o2h-historyHead, .o2h-historyRow { grid-template-columns: 70px 62px minmax(0, 1fr); }
}
`

    function summaryRow(label, value) {
      return h('div', { className: 'o2p-summaryRow', role: 'listitem' },
        h('span', { className: 'o2p-summaryLabel' }, label),
        h('span', { className: 'o2p-summaryValue' }, value))
    }

    const LOCAL_RULES = [
      { id: 'ddl.synonym', pattern: /\bCREATE\s+OR\s+REPLACE\s+SYNONYM\b/gi, replace: 'CREATE SYNONYM' },
      { id: 'types.varchar', pattern: /\bNVARCHAR2\b/gi, replace: 'VARCHAR' },
      { id: 'types.varchar', pattern: /\bVARCHAR2\b/gi, replace: 'VARCHAR' },
      { id: 'types.number', pattern: /\bNUMBER\s*\(\s*([0-9]+)\s*,\s*([0-9]+)\s*\)/gi, replace: 'NUMERIC($1,$2)' },
      { id: 'types.number', pattern: /\bNUMBER\s*\(\s*([0-9]+)\s*\)/gi, replace: 'NUMERIC($1)' },
      { id: 'types.number', pattern: /\bNUMBER\b/gi, replace: 'NUMERIC' },
      { id: 'types.integer', pattern: /\b(?:BINARY_INTEGER|PLS_INTEGER)\b/gi, replace: 'INTEGER' },
      { id: 'types.lob', pattern: /\bN?CLOB\b/gi, replace: 'TEXT' },
      { id: 'types.lob', pattern: /\bBLOB\b/gi, replace: 'BYTEA' },
      { id: 'types.raw', pattern: /\bRAW\s*\(\s*[0-9]+\s*\)/gi, replace: 'BYTEA' },
      { id: 'types.date', pattern: /\bDATE\b(?!\s*')/gi, replace: 'TIMESTAMP' },
      { id: 'fn.nvl', pattern: /\bNVL\s*\(/gi, replace: 'COALESCE(' },
      { id: 'fn.sysdate', pattern: /\bSYSTIMESTAMP\b/gi, replace: 'CURRENT_TIMESTAMP' },
      { id: 'fn.sysdate', pattern: /\bSYSDATE\b/gi, replace: 'CURRENT_TIMESTAMP' },
      { id: 'sql.minus', pattern: /\bMINUS\b/gi, replace: 'EXCEPT' },
      { id: 'ddl.forceView', pattern: /\bFORCE\s+VIEW\b/gi, replace: 'VIEW' },
      { id: 'ddl.forceView', pattern: /\bNOFORCE\s+VIEW\b/gi, replace: 'VIEW' },
      { id: 'fn.raise', pattern: /\bRAISE_APPLICATION_ERROR\s*\(\s*-?\d+\s*,\s*([^;]*?)\)\s*;/gi, replace: "RAISE EXCEPTION '%', $1;" },
      { id: 'fn.sysGuid', pattern: /\bSYS_GUID\s*\(\s*\)/gi, replace: 'gen_random_uuid()' },
      { id: 'fn.sysContext', pattern: /\bSYS_CONTEXT\s*\(\s*'USERENV'\s*,\s*'SESSION_USER'\s*\)/gi, replace: 'CURRENT_USER' },
      { id: 'fn.currentUser', pattern: /\bUSER\b/g, replace: 'CURRENT_USER' },
      { id: 'plsql.executeImmediate', pattern: /\bEXECUTE\s+IMMEDIATE\b/gi, replace: 'EXECUTE' },
      { id: 'plsql.noCopy', pattern: /\bNOCOPY\b/gi, replace: '' },
      { id: 'plsql.authid', pattern: /\bAUTHID\s+(?:CURRENT_USER|DEFINER)\b/gi, replace: '' },
      { id: 'plsql.resultCache', pattern: /\bRESULT_CACHE\b/gi, replace: '' },
      { id: 'plsql.deterministic', pattern: /\bDETERMINISTIC\b/gi, replace: 'IMMUTABLE' },
      { id: 'types.refCursor', pattern: /\bSYS_REFCURSOR\b/gi, replace: 'refcursor' },
      { id: 'fn.xmlElement', pattern: /\bXMLELEMENT\s*\(\s*(?!NAME\b)([A-Za-z_][\w$]*)\s*,/gi, replace: 'XMLELEMENT(NAME $1,' },
      { id: 'fn.getClobVal', pattern: /\.getClobVal\s*\(\s*\)/gi, replace: '' },
      { id: 'sql.explain', pattern: /\bEXPLAIN\s+PLAN\s+FOR\b/gi, replace: 'EXPLAIN' },
      { id: 'sql.analyzeTable', pattern: /\bANALYZE\s+TABLE\s+([\w$."]+)\s+COMPUTE\s+STATISTICS\b/gi, replace: 'ANALYZE $1' },
      { id: 'sql.dual', pattern: /\s*\bFROM\s+DUAL\b/gi, replace: '' },
    ]

    const LOCAL_WARNINGS = [
      { id: 'job', pattern: /\bDBMS_(?:SCHEDULER|JOB)\b/i },
      { id: 'package', pattern: /\bCREATE\s+(?:OR\s+REPLACE\s+)?PACKAGE\b/i },
      { id: 'trigger', pattern: /\bCREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\b/i },
      { id: 'connectBy', pattern: /\bCONNECT\s+BY\b/i },
      { id: 'outerJoin', pattern: /\(\s*\+\s*\)/ },
      { id: 'rownum', pattern: /\bROWNUM\b/i },
      { id: 'decode', pattern: /\bDECODE\s*\(/i },
      { id: 'listagg', pattern: /\bLISTAGG\s*\(/i },
      { id: 'nvl2', pattern: /\bNVL2\s*\(/i },
      { id: 'pivot', pattern: /\bPIVOT\s*\(/i },
      { id: 'unpivot', pattern: /\bUNPIVOT\b/i },
      { id: 'sample', pattern: /\bSAMPLE\s*\(/i },
      { id: 'xmlTable', pattern: /\bXMLTABLE\s*\(/i },
      { id: 'insertAll', pattern: /\bINSERT\s+ALL\b/i },
      { id: 'pipelined', pattern: /\bPIPELINED\b/i },
      { id: 'sequence', pattern: /\.\s*(?:NEXTVAL|CURRVAL)\b/i },
      { id: 'rowid', pattern: /\bROWID\b/i },
      { id: 'xmlType', pattern: /\bXMLTYPE\b/i },
      { id: 'xmlAgg', pattern: /\bXMLAGG\s*\(/i },
      { id: 'wmConcat', pattern: /\bWM_CONCAT\s*\(/i },
      { id: 'keep', pattern: /\bKEEP\s*\(\s*DENSE_RANK/i },
      { id: 'withFunction', pattern: /\bWITH\s+FUNCTION\b/i },
      { id: 'bitmap', pattern: /\bBITMAP\s+INDEX\b/i },
      { id: 'mvRefresh', pattern: /\bREFRESH\s+(?:FAST|COMPLETE|FORCE)\b/i },
      { id: 'jsonValue', pattern: /\bJSON_(?:VALUE|QUERY|TABLE)\s*\(/i },
      { id: 'defaultOnNull', pattern: /\bDEFAULT\s+ON\s+NULL\b/i },
      { id: 'databaseLink', pattern: /@[A-Za-z_][\w$]*/ },
      { id: 'merge', pattern: /\bMERGE\s+INTO\b/i },
      { id: 'autonomous', pattern: /\bPRAGMA\s+AUTONOMOUS_TRANSACTION\b/i },
      { id: 'bulk', pattern: /\bBULK\s+COLLECT\b/i },
      { id: 'commit', pattern: /\bCOMMIT\b/i },
      { id: 'needsAgent', pattern: /\b(?:CONNECT\s+BY|PACKAGE|TRIGGER|DBMS_)\b/i },
    ]

    /** Split Oracle source into code, string literal, and comment runs. */
    function splitSql(source) {
      const parts = []
      let index = 0
      while (index < source.length) {
        const char = source[index]
        const next = source[index + 1]
        if (char === '-' && next === '-') {
          const end = source.indexOf('\n', index)
          const stop = end === -1 ? source.length : end
          parts.push({ kind: 'comment', text: source.slice(index, stop) })
          index = stop
          continue
        }
        if (char === '/' && next === '*') {
          const end = source.indexOf('*/', index + 2)
          const stop = end === -1 ? source.length : end + 2
          parts.push({ kind: 'comment', text: source.slice(index, stop) })
          index = stop
          continue
        }
        if (char === "'") {
          let cursor = index + 1
          while (cursor < source.length) {
            if (source[cursor] === "'") {
              if (source[cursor + 1] === "'") {
                cursor += 2
                continue
              }
              cursor += 1
              break
            }
            cursor += 1
          }
          parts.push({ kind: 'string', text: source.slice(index, cursor) })
          index = cursor
          continue
        }
        let cursor = index
        while (cursor < source.length
          && !(source[cursor] === '-' && source[cursor + 1] === '-')
          && !(source[cursor] === '/' && source[cursor + 1] === '*')
          && source[cursor] !== "'") cursor += 1
        parts.push({ kind: 'code', text: source.slice(index, cursor) })
        index = cursor
      }
      return parts
    }

    /** Wrap one CREATE FUNCTION/PROCEDURE in a PL/pgSQL dollar-quoted body. */
    function wrapRoutine(text) {
      const head = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\s+([\w$."]+)\s*\(/i.exec(text)
      if (head === null) return null
      const open = head.index + head[0].length - 1
      let depth = 0
      let close = -1
      let inString = false
      for (let index = open; index < text.length; index += 1) {
        const char = text[index]
        if (inString) {
          if (char === "'") {
            if (text[index + 1] === "'") index += 1
            else inString = false
          }
          continue
        }
        if (char === "'") {
          inString = true
          continue
        }
        if (char === '(') depth += 1
        else if (char === ')') {
          depth -= 1
          if (depth === 0) {
            close = index
            break
          }
        }
      }
      if (close < 0) return null
      const rest = text.slice(close + 1)
      let restDepth = 0
      let restString = false
      let marker = -1
      for (let index = 0; index < rest.length; index += 1) {
        const char = rest[index]
        if (restString) {
          if (char === "'") {
            if (rest[index + 1] === "'") index += 1
            else restString = false
          }
          continue
        }
        if (char === "'") {
          restString = true
          continue
        }
        if (char === '(') restDepth += 1
        else if (char === ')') restDepth -= 1
        else if (restDepth === 0 && (char === 'i' || char === 'I' || char === 'a' || char === 'A')) {
          const previous = index === 0 ? '' : rest[index - 1]
          if (/[\w$]/.test(previous)) continue
          const tail = rest.slice(index)
          if (/^(?:IS|AS)\b/i.test(tail)) {
            marker = index
            break
          }
        }
      }
      if (marker < 0) return null
      const isFunction = head[1].toUpperCase() === 'FUNCTION'
      const params = text.slice(open + 1, close)
        .replace(/\bIN\s+OUT\b/gi, 'INOUT')
        .replace(/\bIN\b/gi, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim()
      const returnText = isFunction
        ? rest.slice(0, marker).replace(/^\s*RETURN\s+/i, '').trim()
        : ''
      const bodyRaw = rest.slice(marker + 2).replace(/\s*\/\s*$/, '')
      let body = bodyRaw
      const beginAt = /\bBEGIN\b/i.exec(bodyRaw)
      if (beginAt !== null) {
        const declarations = bodyRaw.slice(0, beginAt.index).trim()
        if (declarations !== '') {
          body = `\nDECLARE\n${declarations}${bodyRaw.slice(beginAt.index)}`
        }
      }
      const keyword = isFunction ? 'FUNCTION' : 'PROCEDURE'
      const returns = isFunction ? ` RETURNS ${returnText}` : ''
      return {
        text: `CREATE OR REPLACE ${keyword} ${head[2]}(${params})${returns} AS $$` + body + '\n$$ LANGUAGE plpgsql;',
      }
    }

    /** Detect a directory request (one or two path lines) versus Oracle SQL text. */
    function detectInput(text) {
      const lines = text.split('\n').map(line => line.trim()).filter(line => line !== '')
      if (lines.length === 0) return { kind: 'text', srcDir: '', outDir: 'converted' }
      const first = lines[0]
      const looksPath = /^(?:[A-Za-z]:[\\/]|\\\\|\/|\.{1,2}[\\/])/.test(first)
      const looksSql = /[;()]|^\s*(?:select|insert|update|delete|create|alter|drop|begin|declare|with|merge)\b/i.test(first)
      if (looksPath && !looksSql && lines.length <= 2) {
        return { kind: 'dir', srcDir: first, outDir: lines[1] || 'converted' }
      }
      return { kind: 'text', srcDir: '', outDir: 'converted' }
    }

    /** Split a parenthesised body at top-level commas, respecting quotes and nested parens. */
    function splitTopLevel(text) {
      const items = []
      let current = ''
      let depth = 0
      let single = false
      let quoted = false
      for (let index = 0; index < text.length; index += 1) {
        const char = text[index]
        if (single) {
          current += char
          if (char === "'") {
            if (text[index + 1] === "'") { current += text[index + 1]; index += 1 }
            else single = false
          }
          continue
        }
        if (quoted) {
          current += char
          if (char === '"') quoted = false
          continue
        }
        if (char === "'") { single = true; current += char; continue }
        if (char === '"') { quoted = true; current += char; continue }
        if (char === '(') depth += 1
        if (char === ')') depth -= 1
        if (char === ',' && depth === 0) {
          items.push(current)
          current = ''
          continue
        }
        current += char
      }
      if (current.trim() !== '') items.push(current)
      return items
    }

    /** Drop MEMBER/STATIC/CONSTRUCTOR declarations from CREATE TYPE so it becomes a plain composite type. */
    function stripTypeMemberDeclarations(text) {
      const head = /\bCREATE\s+(?:OR\s+REPLACE\s+)?TYPE\s+([\w$."]+)\s+AS\s*\(/i.exec(text)
      if (head === null) return text
      const open = head.index + head[0].length - 1
      let depth = 0
      let single = false
      let quoted = false
      let close = -1
      for (let index = open; index < text.length; index += 1) {
        const char = text[index]
        if (single) {
          if (char === "'") {
            if (text[index + 1] === "'") index += 1
            else single = false
          }
          continue
        }
        if (quoted) {
          if (char === '"') quoted = false
          continue
        }
        if (char === "'") { single = true; continue }
        if (char === '"') { quoted = true; continue }
        if (char === '(') depth += 1
        else if (char === ')') {
          depth -= 1
          if (depth === 0) { close = index; break }
        }
      }
      if (close < 0) return text
      const items = splitTopLevel(text.slice(open + 1, close))
      const kept = items.filter(item => !/^\s*(?:MEMBER|STATIC|CONSTRUCTOR)\s+(?:FUNCTION|PROCEDURE)\b/i.test(item))
      if (kept.length === items.length) return text
      const rest = text.slice(close + 1).trim()
      return `CREATE TYPE ${head[1].trim()} AS (\n  ${kept.map(item => item.trim()).join(',\n  ')}\n)${rest === '' ? '' : ` ${rest}`}`
    }

    /** Strip Oracle physical/storage clauses so the DDL can run on HGDB V9. */
    function cleanOracleDdl(text) {
      let out = text
      out = out.replace(/\bUSING\s+INDEX\b/gi, '')
      out = out.replace(/\s+STORAGE\s*\([^)]*\)/gi, '')
      out = out.replace(/\s+(?:PCTFREE|PCTUSED|INITRANS|MAXTRANS)\s+\d+/gi, '')
      out = out.replace(/\s+(?:NOCOMPRESS|COMPRESS|LOGGING|NOLOGGING|ENABLE|DISABLE)\b/gi, '')
      out = out.replace(/\s+SEGMENT\s+CREATION\s+\w+/gi, '')
      out = out.replace(/\bORGANIZATION\s+(?:HEAP|INDEX|EXTERNAL)\b/gi, '')
      out = out.replace(/\bUSING\s+DEFAULT\s+(?:LOCAL|REMOTE)\s+ROLLBACK\s+SEGMENT\b/gi, '')
      out = out.replace(/\bUSING\s+(?:ENFORCED|TRUSTED)\s+CONSTRAINTS\b/gi, '')
      out = out.replace(/\bQUERY\s+REWRITE\b/gi, '')
      out = out.replace(/\bREFRESH\s+(?:COMPLETE|FAST|FORCE)\s+ON\s+(?:DEMAND|COMMIT)\b/gi, '')
      out = out.replace(/\bBUILD\s+(?:IMMEDIATE|DEFERRED)\b/gi, '')
      out = out.replace(/\bALTER\s+TRIGGER\s+[\w$."]+\s*(?:ENABLE|DISABLE)?\s*;?/gi, '')
      out = out.replace(/\bCREATE\s+(?:OR\s+REPLACE\s+)?TYPE\s+([\w$."]+)\s+AS\s+OBJECT\b/gi, 'CREATE TYPE $1 AS')
      out = stripTypeMemberDeclarations(out)
      out = out.replace(/\bENABLE\s+ROW\s+MOVEMENT\b/gi, '')
      out = out.replace(/\s+TABLESPACE\s+"?[\w$#]+"?/gi, '')
      out = out.replace(/\s+BUFFER_POOL\s+\w+/gi, '')
      out = out.replace(/\s+FLASH_CACHE\s+\w+/gi, '')
      out = out.replace(/\s+CELL_FLASH_CACHE\s+\w+/gi, '')
      out = out.replace(/"([A-Za-z_][A-Za-z0-9_$#]*)"/g, (match, identifier) => identifier.toLowerCase())
      return out
    }

    /** Add a trailing statement terminator when the text does not already end with one. */
    function ensureTerminator(text) {
      const trimmed = text.trim()
      if (trimmed === '') return trimmed
      if (trimmed.endsWith(';') || trimmed.endsWith('/')) return trimmed
      return `${trimmed};`
    }

    /** Store-only ZIP writer: 「导出全部」打成一个包，只弹一次保存框。 */
    const CRC_TABLE = (() => {
      const table = new Uint32Array(256)
      for (let i = 0; i < 256; i += 1) {
        let value = i
        for (let bit = 0; bit < 8; bit += 1) {
          value = (value & 1) === 1 ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1)
        }
        table[i] = value >>> 0
      }
      return table
    })()

    function crc32(bytes) {
      let crc = 0xFFFFFFFF
      for (let i = 0; i < bytes.length; i += 1) {
        crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xFF]
      }
      return (crc ^ 0xFFFFFFFF) >>> 0
    }

    function buildZipBlob(entries) {
      const encoder = new TextEncoder()
      const stamp = new Date()
      const dosTime = ((stamp.getHours() << 11) | (stamp.getMinutes() << 5) | (stamp.getSeconds() >> 1)) & 0xFFFF
      const dosDate = (((stamp.getFullYear() - 1980) << 9) | ((stamp.getMonth() + 1) << 5) | stamp.getDate()) & 0xFFFF
      const parts = []
      const directory = []
      let offset = 0
      for (const entry of entries) {
        const nameBytes = encoder.encode(entry.name)
        const data = encoder.encode(entry.text)
        const checksum = crc32(data)
        const local = new Uint8Array(30 + nameBytes.length)
        const lv = new DataView(local.buffer)
        lv.setUint32(0, 0x04034b50, true)
        lv.setUint16(4, 20, true)
        lv.setUint16(6, 0x0800, true)
        lv.setUint16(8, 0, true)
        lv.setUint16(10, dosTime, true)
        lv.setUint16(12, dosDate, true)
        lv.setUint32(14, checksum, true)
        lv.setUint32(18, data.length, true)
        lv.setUint32(22, data.length, true)
        lv.setUint16(26, nameBytes.length, true)
        lv.setUint16(28, 0, true)
        local.set(nameBytes, 30)
        parts.push(local, data)
        const record = new Uint8Array(46 + nameBytes.length)
        const rv = new DataView(record.buffer)
        rv.setUint32(0, 0x02014b50, true)
        rv.setUint16(4, 20, true)
        rv.setUint16(6, 20, true)
        rv.setUint16(8, 0x0800, true)
        rv.setUint16(10, 0, true)
        rv.setUint16(12, dosTime, true)
        rv.setUint16(14, dosDate, true)
        rv.setUint32(16, checksum, true)
        rv.setUint32(20, data.length, true)
        rv.setUint32(24, data.length, true)
        rv.setUint16(28, nameBytes.length, true)
        rv.setUint16(30, 0, true)
        rv.setUint16(32, 0, true)
        rv.setUint16(34, 0, true)
        rv.setUint16(36, 0, true)
        rv.setUint32(38, 0, true)
        rv.setUint32(42, offset, true)
        record.set(nameBytes, 46)
        directory.push(record)
        offset += local.length + data.length
      }
      const directorySize = directory.reduce((sum, part) => sum + part.length, 0)
      const end = new Uint8Array(22)
      const ev = new DataView(end.buffer)
      ev.setUint32(0, 0x06054b50, true)
      ev.setUint16(8, entries.length, true)
      ev.setUint16(10, entries.length, true)
      ev.setUint32(12, directorySize, true)
      ev.setUint32(16, offset, true)
      return new Blob([...parts, ...directory, end], { type: 'application/zip' })
    }

    /** Re-indent one CREATE TABLE statement: two spaces per column/constraint, closing paren at column 0. */
    function formatCreateTable(text) {
      const head = /\bCREATE\s+TABLE\s+([\w$."]+)\s*\(/i.exec(text)
      if (head === null) return text
      const open = head.index + head[0].length - 1
      let depth = 0
      let single = false
      let quoted = false
      let close = -1
      for (let index = open; index < text.length; index += 1) {
        const char = text[index]
        if (single) {
          if (char === "'") {
            if (text[index + 1] === "'") index += 1
            else single = false
          }
          continue
        }
        if (quoted) {
          if (char === '"') quoted = false
          continue
        }
        if (char === "'") { single = true; continue }
        if (char === '"') { quoted = true; continue }
        if (char === '(') depth += 1
        else if (char === ')') {
          depth -= 1
          if (depth === 0) { close = index; break }
        }
      }
      if (close < 0) return text
      const inner = text.slice(open + 1, close)
      const items = []
      let current = ''
      depth = 0
      single = false
      quoted = false
      for (let index = 0; index < inner.length; index += 1) {
        const char = inner[index]
        if (single) {
          current += char
          if (char === "'") {
            if (inner[index + 1] === "'") { current += inner[index + 1]; index += 1 }
            else single = false
          }
          continue
        }
        if (quoted) {
          current += char
          if (char === '"') quoted = false
          continue
        }
        if (char === "'") { single = true; current += char; continue }
        if (char === '"') { quoted = true; current += char; continue }
        if (char === '(') depth += 1
        if (char === ')') depth -= 1
        if (char === ',' && depth === 0) {
          items.push(current.replace(/\s+/g, ' ').trim())
          current = ''
          continue
        }
        current += char
      }
      if (current.trim() !== '') items.push(current.replace(/\s+/g, ' ').trim())
      const rest = text.slice(close + 1).replace(/^\s*;?\s*$/, '')
      if (items.length === 0 || rest.trim() !== '') return text
      return `CREATE TABLE ${head[1].trim()} (\n  ${items.join(',\n  ')}\n);`
    }

    /** Oracle object types this studio can list and convert. */
    const OBJECT_TYPES = ['TABLE', 'VIEW', 'MATERIALIZED VIEW', 'FUNCTION', 'PROCEDURE', 'PACKAGE', 'PACKAGE BODY', 'TRIGGER', 'TYPE', 'SEQUENCE', 'SYNONYM', 'JOB']

    /** MySQL source object types: no packages, types, sequences, synonyms or Oracle jobs. */
    const MYSQL_OBJECT_TYPES = ['TABLE', 'VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER', 'EVENT']

    /** Union kept for stored state and task filters; the wizard uses the per-engine list. */
    const ALL_OBJECT_TYPES = [...OBJECT_TYPES, ...MYSQL_OBJECT_TYPES.filter(type => !OBJECT_TYPES.includes(type))]

    /** Which object types one source engine can read. */
    function objectTypesFor(kind) {
      return kind === 'mysql' ? MYSQL_OBJECT_TYPES : OBJECT_TYPES
    }

    /** Localised display names for the object types above. */
    const OBJECT_TYPE_LABEL_KEYS = {
      TABLE: 'objTable',
      VIEW: 'objView',
      'MATERIALIZED VIEW': 'objMatView',
      FUNCTION: 'objFunction',
      PROCEDURE: 'objProcedure',
      PACKAGE: 'objPackage',
      'PACKAGE BODY': 'objPackageBody',
      TRIGGER: 'objTrigger',
      TYPE: 'objType',
      SEQUENCE: 'objSequence',
      SYNONYM: 'objSynonym',
      JOB: 'objJob',
      EVENT: 'objEvent',
    }

    /** Convert common Oracle dialect constructs locally; report what needs review. */
    /**
     * HGDB 的模式名是小写（test），而 Oracle GET_DDL 输出的是 "TEST"."SYN_X"。
     * 同义词语句里把全大写的带引号标识符改成小写无引号，避免目标端 schema 不存在。
     */
    function normalizeSynonymDdl(text) {
      return text.replace(/(\bCREATE\s+(?:OR\s+REPLACE\s+)?SYNONYM\b[^;]*)/gi, (statement) =>
        statement.replace(/"([A-Za-z_][\w$]*)"/g, (quoted, name) => (/[a-z]/.test(name) ? quoted : name.toLowerCase())))
    }

    function convertLocally(source, options = {}) {
      const engine = options.engine === 'mysql' || (options.engine === undefined && looksLikeMysql(source))
        ? 'mysql'
        : 'oracle'
      if (engine === 'mysql') return withDropStatement(convertMysqlLocally(source, options), options)
      const compat = options.compat !== false
      const counts = {}
      let text = splitSql(source).map((part) => {
        if (part.kind !== 'code') return part.text
        let code = part.text
        if (compat) return normalizeSynonymDdl(code)
        for (const rule of LOCAL_RULES) {
          const hits = code.match(rule.pattern)
          if (hits === null) continue
          counts[rule.id] = (counts[rule.id] ?? 0) + hits.length
          code = code.replace(rule.pattern, rule.replace)
        }
        return normalizeSynonymDdl(code)
      }).join('')

      const routine = wrapRoutine(text)
      if (!compat) {
        if (routine !== null) {
          text = routine.text
        } else if (/^\s*(?:DECLARE|BEGIN)\b/i.test(text)) {
          text = `DO $$ ${text.trim().replace(/\s*\/\s*$/, '').trim()} $$;`
        }
      }

      const warnings = []
      for (const warning of LOCAL_WARNINGS) {
        if (warning.pattern.test(text)) warnings.push(warning.id)
      }
      const applied = Object.keys(counts).map(id => ({ id, count: counts[id] }))
      return withDropStatement({ text: `${ensureTerminator(formatCreateTable(cleanOracleDdl(text)))}\n`, applied, warnings }, options)
    }

    /** 按转换后的 CREATE 语句识别对象，生成可选的 DROP ... IF EXISTS 前缀。 */
    function dropStatementFor(text) {
      const match = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(TABLE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|PROCEDURE|SEQUENCE|TYPE)\s+((?:"[^"]+"|[A-Za-z_][\w$]*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_][\w$]*))?)/i.exec(text)
      if (match === null) return ''
      const kind = match[1].toUpperCase().replace(/\s+/g, ' ')
      const name = match[2].replace(/\s+/g, '')
      return `DROP ${kind} IF EXISTS ${name};\n`
    }

    /** 开启「生成删除语句」时，在转换结果前加 DROP ... IF EXISTS。 */
    function withDropStatement(result, options) {
      if (options.drop !== true || result === null || typeof result.text !== 'string') return result
      const drop = dropStatementFor(result.text)
      if (drop === '') return result
      return { ...result, text: `${drop}${result.text}` }
    }

    /* ===== MySQL → HGDB V9 本地规则 ==========================================
     * 本地只做「机械等价」改写：标识符、数据类型、自增、索引/约束外置、表选项与注释。
     * 过程体、触发器、事件的语义改写留给「AI在线转换」。
     */
    /* @mysql-rules:start */

    /** 判断文本更像 MySQL 还是 Oracle：反引号 / ENGINE= / AUTO_INCREMENT 是 MySQL 特征。 */
    function looksLikeMysql(text) {
      if (typeof text !== 'string' || text.trim() === '') return false
      return /`[^`\r\n]+`/.test(text)
        || /\bENGINE\s*=\s*\w+/i.test(text)
        || /\bAUTO_INCREMENT\b/i.test(text)
        || /\b(?:TINYINT|MEDIUMTEXT|LONGTEXT|DATETIME)\b/i.test(text)
    }

    /** HGDB/PG 中只有加引号才能当标识符的保留字。 */
    const MYSQL_RESERVED = new Set((
      'all analyse analyze and any array as asc asymmetric authorization between bigint binary both case cast check collate '
      + 'column constraint create cross current_date current_time current_timestamp current_user default deferrable desc distinct do '
      + 'else end except false fetch for foreign freeze from full grant group having ilike in initially inner intersect into is '
      + 'isnull join lateral leading left like limit localtime localtimestamp natural not notnull null offset on only or order outer '
      + 'overlaps placing primary references returning right select session_user similar some symmetric table tablesample then to '
      + 'trailing true union unique user using variadic verbose when where window with'
    ).split(/\s+/).filter(Boolean))

    const MYSQL_TYPE_MAP = {
      tinyint: 'smallint', smallint: 'smallint', mediumint: 'integer', int: 'integer', integer: 'integer', bigint: 'bigint',
      decimal: 'numeric', numeric: 'numeric', dec: 'numeric', fixed: 'numeric',
      float: 'real', double: 'double precision', real: 'double precision',
      bit: 'bit', bool: 'boolean', boolean: 'boolean',
      date: 'date', datetime: 'timestamp', timestamp: 'timestamp', time: 'time', year: 'integer',
      char: 'char', varchar: 'varchar',
      tinytext: 'text', text: 'text', mediumtext: 'text', longtext: 'text',
      binary: 'bytea', varbinary: 'bytea', tinyblob: 'bytea', blob: 'bytea', mediumblob: 'bytea', longblob: 'bytea',
      json: 'jsonb', enum: 'text', set: 'text',
      geometry: 'bytea', point: 'bytea', linestring: 'bytea', polygon: 'bytea', multipoint: 'bytea',
      multilinestring: 'bytea', multipolygon: 'bytea', geometrycollection: 'bytea',
    }

    const MYSQL_NUMERIC_TYPES = new Set(['smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision'])

    const MYSQL_RULES = [
      { id: 'fn.ifnull', pattern: /\bIFNULL\s*\(/gi, replace: 'COALESCE(' },
      { id: 'fn.now', pattern: /\b(?:NOW|LOCALTIME|LOCALTIMESTAMP)\s*\(\s*\)/gi, replace: 'CURRENT_TIMESTAMP' },
      { id: 'fn.curdate', pattern: /\bCURDATE\s*\(\s*\)/gi, replace: 'CURRENT_DATE' },
      { id: 'fn.curtime', pattern: /\bCURTIME\s*\(\s*\)/gi, replace: 'CURRENT_TIME' },
      { id: 'sql.limitOffset', pattern: /\bLIMIT\s+(\d+)\s*,\s*(\d+)/gi, replace: 'LIMIT $2 OFFSET $1' },
    ]

    /** 只用于提示、不自动改写的 MySQL 特征。 */
    const MYSQL_WARNINGS = [
      { id: 'unsigned', pattern: /\bUNSIGNED\b/i },
      { id: 'onUpdate', pattern: /\bON\s+UPDATE\s+CURRENT_TIMESTAMP\b/i },
      { id: 'enum', pattern: /\bENUM\s*\(/i },
      { id: 'set', pattern: /\bSET\s*\(/i },
      { id: 'fulltext', pattern: /\b(?:FULLTEXT|SPATIAL)\s+(?:KEY|INDEX)\b/i },
      { id: 'partition', pattern: /\bPARTITION\s+BY\b/i },
      { id: 'prefixIndex', pattern: /(?:KEY|INDEX)[^(]*\([^)]*\(\s*\d+\s*\)/i },
      { id: 'zeroDate', pattern: /'0000-00-00(?: 00:00:00)?'/ },
      { id: 'routine', pattern: /^\s*CREATE\s+(?:DEFINER\s*=\s*\S+\s+)?(?:PROCEDURE|FUNCTION)\b/i },
      { id: 'trigger', pattern: /^\s*CREATE\s+(?:DEFINER\s*=\s*\S+\s+)?TRIGGER\b/i },
      { id: 'event', pattern: /^\s*CREATE\s+(?:DEFINER\s*=\s*\S+\s+)?EVENT\b/i },
      { id: 'groupConcat', pattern: /\bGROUP_CONCAT\s*\(/i },
      { id: 'dateFormat', pattern: /\bDATE_FORMAT\s*\(/i },
      { id: 'strToDate', pattern: /\bSTR_TO_DATE\s*\(/i },
      { id: 'onDuplicate', pattern: /\bON\s+DUPLICATE\s+KEY\b/i },
      { id: 'insertIgnore', pattern: /\bINSERT\s+IGNORE\b/i },
      { id: 'replaceInto', pattern: /\bREPLACE\s+INTO\b/i },
      { id: 'regexp', pattern: /\b(?:NOT\s+)?REGEXP\b/i },
      { id: 'div', pattern: /\bDIV\b/i },
      { id: 'userVariable', pattern: /@[A-Za-z_][\w$]*/ },
      { id: 'backslashEscape', pattern: /\\'/ },
      { id: 'delimiter', pattern: /^\s*DELIMITER\b/i },
      { id: 'useDatabase', pattern: /^\s*USE\b/i },
      { id: 'session', pattern: /^\s*(?:SET|LOCK\s+TABLES|UNLOCK\s+TABLES)\b/i },
    ]

    /** 把 MySQL 文本拆成代码 / 字符串 / 注释片段：字符串支持反斜杠转义。 */
    function mysqlParts(source) {
      const parts = []
      let index = 0
      let code = ''
      const flush = () => {
        if (code !== '') {
          parts.push({ kind: 'code', text: code })
          code = ''
        }
      }
      while (index < source.length) {
        const char = source[index]
        const next = source[index + 1]
        const lineStart = index === 0 || source[index - 1] === '\n'
        if (char === '-' && next === '-') {
          flush()
          const end = source.indexOf('\n', index)
          const stop = end === -1 ? source.length : end
          parts.push({ kind: 'comment', text: source.slice(index, stop) })
          index = stop
          continue
        }
        if (char === '#' && (lineStart || /\s/.test(source[index - 1]))) {
          flush()
          const end = source.indexOf('\n', index)
          const stop = end === -1 ? source.length : end
          parts.push({ kind: 'comment', text: source.slice(index, stop) })
          index = stop
          continue
        }
        if (char === '/' && next === '*') {
          flush()
          const end = source.indexOf('*/', index + 2)
          const stop = end === -1 ? source.length : end + 2
          parts.push({ kind: 'comment', text: source.slice(index, stop) })
          index = stop
          continue
        }
        if (char === "'" || char === '"') {
          flush()
          const quote = char
          let cursor = index + 1
          while (cursor < source.length) {
            const current = source[cursor]
            if (current === '\\') {
              cursor += 2
              continue
            }
            if (current === quote) {
              if (source[cursor + 1] === quote) {
                cursor += 2
                continue
              }
              cursor += 1
              break
            }
            cursor += 1
          }
          parts.push({ kind: 'string', text: source.slice(index, cursor) })
          index = cursor
          continue
        }
        code += char
        index += 1
      }
      flush()
      return parts
    }

    /** 双引号字符串（MySQL 默认按字符串解析）改成单引号字符串。 */
    function mysqlConvertStringLiteral(literal) {
      if (literal[0] !== '"') return literal
      const inner = literal.slice(1, -1)
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/''/g, "'")
      return `'${inner.replace(/'/g, "''")}'`
    }

    /** MySQL 反引号标识符 → HGDB 小写标识符（保留字或非常规名字加双引号）。 */
    function mysqlQuoteIdent(raw) {
      const name = raw.replace(/``/g, '`').toLowerCase()
      if (/^[a-z_][a-z0-9_$]*$/.test(name) && !MYSQL_RESERVED.has(name)) return name
      return `"${name.replace(/"/g, '""')}"`
    }

    function mysqlReplaceIdents(code) {
      return code.replace(/`([^`]*)`/g, (whole, name) => mysqlQuoteIdent(name))
    }

    /** 去掉反引号（若有）。 */
    function mysqlUnquote(name) {
      const text = String(name).trim()
      return text.startsWith('`') && text.endsWith('`') ? text.slice(1, -1).replace(/``/g, '`') : text
    }

    function mysqlSqlLiteral(value) {
      return `'${String(value).replace(/'/g, "''")}'`
    }

    /** 按 MySQL 词法切分语句：';' 只在代码片段内生效；例程体里的 BEGIN...END 不切分。 */
    function mysqlSplitStatements(source) {
      const statements = []
      let current = ''
      let routine = false
      let depth = 0
      let lastWord = ''
      const flush = () => {
        if (current.trim() !== '') statements.push(current.trim())
        current = ''
        routine = false
        depth = 0
        lastWord = ''
      }
      const startsCreate = (text) => {
        let index = 0
        while (index < text.length) {
          const char = text[index]
          if (/\s/.test(char)) {
            index += 1
            continue
          }
          if ((char === '-' && text[index + 1] === '-') || char === '#') {
            const end = text.indexOf('\n', index)
            index = end === -1 ? text.length : end + 1
            continue
          }
          if (char === '/' && text[index + 1] === '*') {
            const end = text.indexOf('*/', index + 2)
            index = end === -1 ? text.length : end + 2
            continue
          }
          break
        }
        return /^CREATE\b/i.test(text.slice(index))
      }
      for (const part of mysqlParts(source)) {
        if (part.kind !== 'code') {
          current += part.text
          continue
        }
        let index = 0
        while (index < part.text.length) {
          const char = part.text[index]
          if (char === ';' && !(routine && depth > 0)) {
            flush()
            index += 1
            continue
          }
          if (/[A-Za-z_]/.test(char)) {
            let end = index + 1
            while (end < part.text.length && /[A-Za-z0-9_$]/.test(part.text[end])) end += 1
            const word = part.text.slice(index, end)
            const upper = word.toUpperCase()
            if (!routine && startsCreate(current)
              && (upper === 'PROCEDURE' || upper === 'FUNCTION' || upper === 'TRIGGER' || upper === 'EVENT')) {
              routine = true
            } else if (routine) {
              if (upper === 'BEGIN') depth += 1
              else if (upper === 'END') depth = Math.max(0, depth - 1)
              else if (upper === 'IF') {
                let look = end
                while (look < part.text.length && /\s/.test(part.text[look])) look += 1
                if (part.text[look] !== '(') depth += 1
              } else if (upper === 'CASE' || upper === 'LOOP' || upper === 'WHILE' || upper === 'REPEAT') {
                if (lastWord !== 'END') depth += 1
              }
            }
            lastWord = upper
            current += word
            index = end
            continue
          }
          current += char
          index += 1
        }
      }
      flush()
      return statements
    }

    /** 分隔语句开头的注释与正文，注释原样保留。 */
    function mysqlSplitLeading(text) {
      let index = 0
      while (index < text.length) {
        const char = text[index]
        if (/\s/.test(char)) {
          index += 1
          continue
        }
        if ((char === '-' && text[index + 1] === '-') || char === '#') {
          const end = text.indexOf('\n', index)
          index = end === -1 ? text.length : end + 1
          continue
        }
        if (char === '/' && text[index + 1] === '*') {
          const end = text.indexOf('*/', index + 2)
          index = end === -1 ? text.length : end + 2
          continue
        }
        break
      }
      return { leading: text.slice(0, index), body: text.slice(index) }
    }

    /** 去掉 CREATE 与对象关键字之间的 MySQL 修饰（ALGORITHM / DEFINER / SQL SECURITY）。 */
    function mysqlNormalizeHeader(statement) {
      const match = /^(\s*)CREATE\s+(?:OR\s+REPLACE\s+)?([\s\S]*?)\b(TABLE|VIEW|PROCEDURE|FUNCTION|TRIGGER|EVENT)\b/i.exec(statement)
      if (match === null) return statement
      const modifiers = match[2]
        .replace(/\bALGORITHM\s*=\s*\w+/gi, ' ')
        .replace(/\bDEFINER\s*=\s*(?:`[^`]*`|'[^']*'|[^\s@]+)(?:\s*@\s*(?:`[^`]*`|'[^']*'|[^\s]+))?/gi, ' ')
        .replace(/\bSQL\s+SECURITY\s+(?:DEFINER|INVOKER)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      return `${match[1]}CREATE ${modifiers === '' ? '' : `${modifiers} `}${match[3]}${statement.slice(match[0].length)}`
    }

    /** 找与 open 位置括号配对的右括号，跳过字符串与反引号标识符。 */
    function mysqlFindParen(text, open) {
      let depth = 0
      let index = open
      while (index < text.length) {
        const char = text[index]
        if (char === "'" || char === '"' || char === '`') {
          const quote = char
          index += 1
          while (index < text.length) {
            if (quote !== '`' && text[index] === '\\') {
              index += 2
              continue
            }
            if (text[index] === quote) {
              if (quote !== '`' && text[index + 1] === quote) {
                index += 2
                continue
              }
              index += 1
              break
            }
            index += 1
          }
          continue
        }
        if (char === '(') depth += 1
        else if (char === ')') {
          depth -= 1
          if (depth === 0) return index
        }
        index += 1
      }
      return -1
    }

    /** 按顶层逗号切分 CREATE TABLE 的列/约束定义。 */
    function mysqlSplitTopLevel(text) {
      const items = []
      let current = ''
      let depth = 0
      let index = 0
      while (index < text.length) {
        const char = text[index]
        if (char === "'" || char === '"' || char === '`') {
          const quote = char
          current += char
          index += 1
          while (index < text.length) {
            if (quote !== '`' && text[index] === '\\' && index + 1 < text.length) {
              current += text[index] + text[index + 1]
              index += 2
              continue
            }
            current += text[index]
            if (text[index] === quote) {
              if (quote !== '`' && text[index + 1] === quote) {
                current += text[index + 1]
                index += 2
                continue
              }
              index += 1
              break
            }
            index += 1
          }
          continue
        }
        if (char === '(') depth += 1
        else if (char === ')') depth -= 1
        else if (char === ',' && depth === 0) {
          items.push(current)
          current = ''
          index += 1
          continue
        }
        current += char
        index += 1
      }
      if (current.trim() !== '') items.push(current)
      return items
    }

    /** MySQL 数据类型 → HGDB 类型；返回 null 表示本地不认识该类型。 */
    function mysqlColumnType(base, args, unsigned, ctx) {
      let lower = base.toLowerCase()
      let size = args ?? ''
      if (lower === 'tinyint' && !unsigned && /^\(\s*1\s*\)$/.test(size)) {
        return { type: 'boolean', numeric: false, bool: true }
      }
      if (lower === 'bit' && /^\(\s*1\s*\)$/.test(size)) {
        return { type: 'boolean', numeric: false, bool: true }
      }
      if (unsigned) {
        const promoted = { tinyint: 'smallint', smallint: 'integer', mediumint: 'integer', int: 'bigint', integer: 'bigint' }[lower]
        if (promoted !== undefined) {
          ctx.warn('unsigned')
          lower = promoted
        } else if (lower === 'bigint') {
          // bigint unsigned 的最大值超出 bigint 范围，保留 bigint 并提示人工确认。
          ctx.warn('unsigned')
        }
      }
      if (lower === 'enum') {
        ctx.warn('enum')
        return { type: 'text', enumValues: size }
      }
      if (lower === 'set') {
        ctx.warn('set')
        return { type: 'text' }
      }
      const target = MYSQL_TYPE_MAP[lower]
      if (target === undefined) return null
      if (['smallint', 'integer', 'bigint', 'real', 'double precision', 'boolean', 'bytea'].includes(target)) size = ''
      else if (target === 'bit') size = /^\(\s*\d+\s*\)$/.test(size) ? size : ''
      if (lower === 'double' || lower === 'float' || lower === 'real') size = ''
      return {
        type: `${target}${size}`,
        numeric: MYSQL_NUMERIC_TYPES.has(target),
        bool: target === 'boolean',
      }
    }

    /** 转换一个列定义；返回 { text, name, comment }。 */
    function mysqlConvertColumn(definition, tableName, ctx, notes) {
      const match = /^(`[^`]*`|[\w$]+)\s+([\s\S]+)$/.exec(definition.trim())
      if (match === null) return null
      const name = mysqlQuoteIdent(mysqlUnquote(match[1]))
      let rest = match[2]
      let comment = ''
      rest = rest.replace(/\bCOMMENT\s+'((?:[^']|'')*)'/gi, (whole, value) => {
        comment = value.replace(/''/g, "'")
        return ' '
      })
      if (/\bON\s+UPDATE\s+CURRENT_TIMESTAMP(?:\s*\(\s*\d*\s*\))?/i.test(rest)) {
        ctx.warn('onUpdate')
        notes.push(`${tableName}.${name}：MySQL 的 ON UPDATE CURRENT_TIMESTAMP 需改用 BEFORE UPDATE 触发器维护`)
        rest = rest.replace(/\bON\s+UPDATE\s+CURRENT_TIMESTAMP(?:\s*\(\s*\d*\s*\))?/gi, ' ')
      }
      const autoIncrement = /\bAUTO_INCREMENT\b/i.test(rest)
      rest = rest.replace(/\bAUTO_INCREMENT\b/gi, ' ')
      const unsigned = /\bUNSIGNED\b/i.test(rest)
      rest = rest.replace(/\bUNSIGNED\b/gi, ' ')
      rest = rest.replace(/\bZEROFILL\b/gi, ' ')
      rest = rest.replace(/\bCHARACTER\s+SET\s+\w+/gi, ' ')
      rest = rest.replace(/\bCOLLATE\s+\w+/gi, ' ')
      rest = rest.replace(/\s+/g, ' ').trim()
      const typeMatch = /^([A-Za-z]+)\s*(\([^)]*\))?/.exec(rest)
      if (typeMatch === null) return null
      const converted = mysqlColumnType(typeMatch[1], typeMatch[2] ?? '', unsigned, ctx)
      if (converted === null) {
        ctx.warn('unknownType')
        return null
      }
      let tail = rest.slice(typeMatch[0].length).trim()
      if (converted.bool) {
        tail = tail.replace(/\bDEFAULT\s+'0'/gi, 'DEFAULT false').replace(/\bDEFAULT\s+'1'/gi, 'DEFAULT true')
      } else if (converted.numeric) {
        tail = tail.replace(/\bDEFAULT\s+'(-?\d+(?:\.\d+)?)'/g, 'DEFAULT $1')
      }
      tail = tail.replace(/\bDEFAULT\s+b'([01])'/gi, (whole, bit) => `DEFAULT ${bit === '1' ? 'true' : 'false'}`)
      tail = tail.replace(/\bDEFAULT\s+CURRENT_TIMESTAMP(\s*\(\s*\d*\s*\))?/gi, 'DEFAULT CURRENT_TIMESTAMP')
      if (/'0000-00-00(?: 00:00:00)?'/.test(tail)) {
        ctx.warn('zeroDate')
        notes.push(`${tableName}.${name}：零日期默认值需改为合法时间或 NULL`)
      }
      let text = `${name} ${converted.type}`
      if (converted.enumValues !== undefined && converted.enumValues !== '') {
        text += ` CHECK (${name} IN ${converted.enumValues})`
      }
      if (autoIncrement) {
        text += ' GENERATED BY DEFAULT AS IDENTITY'
        tail = tail.replace(/\bNOT\s+NULL\b/gi, ' ')
        tail = tail.replace(/\bDEFAULT\s+\S+/gi, ' ')
        tail = tail.replace(/\s+/g, ' ').trim()
      }
      if (tail !== '') text += ` ${tail}`
      return { text, name, comment }
    }

    /** 解析 `[UNIQUE|FULLTEXT|SPATIAL] KEY|INDEX name (cols)` 形式的索引定义。 */
    function mysqlParseKey(item) {
      const match = /^(?:(UNIQUE|FULLTEXT|SPATIAL)\s+)?(?:KEY|INDEX)\s*(`[^`]*`|[\w$]+)?\s*(\([\s\S]*\))(?:\s+USING\s+(?:BTREE|HASH))?\s*$/i.exec(item.trim())
      if (match === null) return null
      return {
        kind: (match[1] ?? '').toUpperCase(),
        name: match[2] ?? '',
        columns: match[3],
      }
    }

    function mysqlIndexColumns(raw, ctx) {
      let columns = raw
      if (/\(\s*\d+\s*\)/.test(columns)) {
        ctx.warn('prefixIndex')
        columns = columns.replace(/\(\s*\d+\s*\)/g, '')
      }
      columns = mysqlReplaceIdents(columns)
      columns = columns.replace(/\bUSING\s+(?:BTREE|HASH)\b/gi, ' ')
      return columns.replace(/\s+/g, ' ').trim()
    }

    function mysqlNormalizeConstraint(item, ctx) {
      let text = mysqlReplaceIdents(item)
      text = text.replace(/\bUSING\s+(?:BTREE|HASH)\b/gi, ' ')
      text = text.replace(/\bREFERENCES\b/gi, 'REFERENCES')
      return text.replace(/\s+/g, ' ').trim()
    }

    /** 转换一个 MySQL CREATE TABLE 语句。 */
    function convertMysqlTable(statement, ctx) {
      const head = /^CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(`[^`]*`(?:\s*\.\s*`[^`]*`)?|[\w$]+(?:\s*\.\s*[\w$]+)?)/i.exec(statement)
      if (head === null) return null
      const tableName = mysqlReplaceIdents(head[1].replace(/\s+/g, ''))
      const open = statement.indexOf('(', head.index + head[0].length)
      if (open < 0) return null
      const close = mysqlFindParen(statement, open)
      if (close < 0) return null
      const items = mysqlSplitTopLevel(statement.slice(open + 1, close))
      const columns = []
      const constraints = []
      const indexes = []
      const columnComments = []
      const notes = []
      for (const rawItem of items) {
        const item = rawItem.trim()
        if (item === '') continue
        if (/^PRIMARY\s+KEY\b/i.test(item)) {
          constraints.push(mysqlNormalizeConstraint(item, ctx))
          continue
        }
        if (/^UNIQUE\s+(?:KEY|INDEX)\b/i.test(item)) {
          const key = mysqlParseKey(item)
          if (key !== null) {
            const name = key.name === '' ? '' : mysqlReplaceIdents(key.name)
            constraints.push(`${name === '' ? '' : `CONSTRAINT ${name} `}UNIQUE ${mysqlIndexColumns(key.columns, ctx)}`)
          } else {
            constraints.push(mysqlNormalizeConstraint(item, ctx))
          }
          continue
        }
        if (/^(?:FULLTEXT|SPATIAL)\s+(?:KEY|INDEX)\b/i.test(item)) {
          ctx.warn('fulltext')
          continue
        }
        if (/^(?:CONSTRAINT\s+(?:`[^`]*`|[\w$]+)\s+)?FOREIGN\s+KEY\b/i.test(item)
          || /^CONSTRAINT\s+(?:`[^`]*`|[\w$]+)\s+CHECK\b/i.test(item)
          || /^CHECK\s*\(/i.test(item)) {
          constraints.push(mysqlNormalizeConstraint(item, ctx))
          continue
        }
        const key = mysqlParseKey(item)
        if (key !== null) {
          indexes.push({ name: key.name, columns: mysqlIndexColumns(key.columns, ctx) })
          continue
        }
        const column = mysqlConvertColumn(item, tableName, ctx, notes)
        if (column === null) continue
        columns.push(column.text)
        if (column.comment !== '') {
          columnComments.push(`COMMENT ON COLUMN ${tableName}.${column.name} IS ${mysqlSqlLiteral(column.comment)};`)
        }
      }
      if (columns.length === 0) return null
      const tail = statement.slice(close + 1)
      let tableComment = ''
      const commentMatch = /\bCOMMENT\s*=\s*'((?:[^']|'')*)'/i.exec(tail)
      if (commentMatch !== null) tableComment = commentMatch[1].replace(/''/g, "'")
      if (/\bPARTITION\s+BY\b/i.test(tail)) {
        ctx.warn('partition')
        notes.push(`${tableName}：MySQL 分区定义未转换，需在 HGDB 上重建分区策略`)
      }
      const body = [...columns, ...constraints]
      const lines = [`CREATE TABLE ${tableName} (`]
      body.forEach((line, index) => {
        lines.push(`  ${line}${index === body.length - 1 ? '' : ','}`)
      })
      lines.push(');')
      const taken = new Set()
      indexes.forEach((index, position) => {
        const base = index.name === ''
          ? `idx_${tableName.replace(/"/g, '').replace(/\./g, '_')}_${position + 1}`
          : mysqlReplaceIdents(index.name)
        let name = base
        while (taken.has(name)) name = `${base}_${position + 1}`
        taken.add(name)
        lines.push(`CREATE INDEX ${name} ON ${tableName} ${index.columns};`)
      })
      if (tableComment !== '') lines.push(`COMMENT ON TABLE ${tableName} IS ${mysqlSqlLiteral(tableComment)};`)
      for (const comment of columnComments) lines.push(comment)
      if (notes.length === 0) return lines.join('\n')
      return `${notes.map(note => `-- TODO: ${note}`).join('\n')}\n${lines.join('\n')}`
    }

    /** 过程体不做本地改写：保留 MySQL 语法并显式标注需 AI/人工复核。 */
    function mysqlMarkRoutine(statement, kind, ctx) {
      ctx.warn('routine')
      if (kind === 'TRIGGER') ctx.warn('trigger')
      if (kind === 'EVENT') ctx.warn('event')
      let text = mysqlApplyRules(statement, ctx)
      text = text.replace(/\b(?:NOT\s+)?DETERMINISTIC\b/gi, ' ')
      text = text.replace(/\b(?:READS|MODIFIES)\s+SQL\s+DATA\b/gi, ' ')
      text = text.replace(/\b(?:NO\s+SQL|CONTAINS\s+SQL)\b/gi, ' ')
      text = text.replace(/\bLANGUAGE\s+SQL\b/gi, 'LANGUAGE plpgsql')
      const todo = kind === 'EVENT'
        ? '-- TODO: MySQL EVENT 在 HGDB 无直接等价物，需改写为 pgAgent / pg_cron 作业后再执行。'
        : `-- TODO: MySQL ${kind} 的声明与控制流语法（DECLARE / SIGNAL / IF / 游标）未做本地改写，请用「AI在线转换」或人工复核后再执行。`
      return `${todo}\n${ensureTerminator(text)}`
    }

    /** 代码片段套用 MySQL → HGDB 的机械改写，字符串/注释原样保留。 */
    function mysqlApplyRules(text, ctx) {
      return mysqlParts(text).map((part) => {
        if (part.kind === 'string') return mysqlConvertStringLiteral(part.text)
        if (part.kind !== 'code') return part.text
        let code = mysqlReplaceIdents(part.text)
        for (const rule of MYSQL_RULES) {
          const hits = code.match(rule.pattern)
          if (hits === null) continue
          ctx.count(rule.id, hits.length)
          code = code.replace(rule.pattern, rule.replace)
        }
        return code
      }).join('')
    }

    function convertMysqlStatement(statement, ctx) {
      const split = mysqlSplitLeading(statement)
      const body = mysqlNormalizeHeader(split.body)
      const leading = split.leading
      if (/^CREATE\s+(?:TEMPORARY\s+)?TABLE\b/i.test(body)) {
        const converted = convertMysqlTable(body, ctx)
        return converted === null ? null : `${leading}${converted}`
      }
      if (/^CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b/i.test(body)) {
        const text = mysqlApplyRules(body.replace(/^CREATE\s+VIEW\b/i, 'CREATE OR REPLACE VIEW'), ctx)
        return `${leading}${ensureTerminator(text)}`
      }
      if (/^CREATE\s+TRIGGER\b/i.test(body)) return `${leading}${mysqlMarkRoutine(body, 'TRIGGER', ctx)}`
      if (/^CREATE\s+(?:OR\s+REPLACE\s+)?PROCEDURE\b/i.test(body)) return `${leading}${mysqlMarkRoutine(body, 'PROCEDURE', ctx)}`
      if (/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i.test(body)) return `${leading}${mysqlMarkRoutine(body, 'FUNCTION', ctx)}`
      if (/^CREATE\s+EVENT\b/i.test(body)) return `${leading}${mysqlMarkRoutine(body, 'EVENT', ctx)}`
      if (/^CREATE\s+(?:DATABASE|SCHEMA)\b/i.test(body)) {
        const match = /^CREATE\s+(?:DATABASE|SCHEMA)\s+(?:IF\s+NOT\s+EXISTS\s+)?(`[^`]*`|[\w$]+)/i.exec(body)
        if (match === null) return null
        ctx.warn('createSchema')
        return `${leading}${ensureTerminator(`CREATE SCHEMA IF NOT EXISTS ${mysqlReplaceIdents(match[1])}`)}`
      }
      if (/^USE\b/i.test(body)) {
        ctx.warn('useDatabase')
        return `${leading}-- ${mysqlReplaceIdents(body.replace(/\s+/g, ' '))}（MySQL 库名已忽略，目标 schema 由任务配置决定）`
      }
      if (/^(?:SET|LOCK\s+TABLES|UNLOCK\s+TABLES|DELIMITER)\b/i.test(body)) {
        ctx.warn('session')
        return `${leading}-- ${mysqlReplaceIdents(body.replace(/\s+/g, ' ').slice(0, 240))}`
      }
      return `${leading}${ensureTerminator(mysqlApplyRules(body, ctx))}`
    }

    /** 本地转换入口：MySQL 源走独立规则，不套用 Oracle 兼容模式。 */
    function convertMysqlLocally(source, options = {}) {
      // 目标为 HGDB-V9-MySQL 时最小改写；其他目标仍走完整 PG 化改写。
      if (options.target === 'mysql') return convertMysqlMinimal(source)
      return convertMysqlFull(source)
    }

    function convertMysqlFull(source) {
      const counts = {}
      const warnings = new Set()
      const ctx = {
        count(id, value) { counts[id] = (counts[id] ?? 0) + value },
        warn(id) { warnings.add(id) },
      }
      const statements = mysqlSplitStatements(source)
      const converted = []
      for (const statement of statements) {
        for (const warning of MYSQL_WARNINGS) {
          if (warning.pattern.test(statement)) warnings.add(warning.id)
        }
        const text = convertMysqlStatement(statement, ctx)
        if (text !== null && text.trim() !== '') converted.push(text.trim())
      }
      return {
        text: converted.length === 0 ? '' : `${converted.join('\n\n')}\n`,
        applied: Object.keys(counts).map(id => ({ id, count: counts[id] })),
        warnings: [...warnings],
      }
    }

    /**
     * HGDB-V9-MySQL 最小改写：实测支持的 MySQL 语法原样保留，
     * 只处理实测不支持的部分（SET 类型、空间类型/索引、分区、视图选项、0900 排序规则、JSON_EXTRACT、FOUND_ROWS）。
     * 存储过程/触发器/事件等需要结构改写的对象退回完整转换（目标同样接受 PG 语法）。
     */
    function convertMysqlMinimal(source) {
      const warnings = new Set()
      const applied = []
      const count = (id, value = 1) => {
        const item = applied.find(entry => entry.id === id)
        if (item === undefined) applied.push({ id, count: value })
        else item.count += value
      }
      const routine = /^\s*CREATE\s+(?:DEFINER\s*=\s*\S+\s+)?(?:PROCEDURE|TRIGGER|EVENT)\b/i.test(source)
        || /^\s*CREATE\s+(?:DEFINER\s*=\s*\S+\s+)?FUNCTION\b[\s\S]*\bBEGIN\b/i.test(source)
      if (routine) {
        return {
          text: ensureTerminator(source),
          applied: [],
          warnings: ['mysql.routine'],
          unsupported: true,
        }
      }

      let text = source
      // 视图选项：ALGORITHM / DEFINER / SQL SECURITY 不支持。
      const view = /^(\s*CREATE\s+(?:OR\s+REPLACE\s+)?)([\s\S]*?)\bVIEW\b/i.exec(text)
      if (view !== null && /(?:ALGORITHM|DEFINER|SQL\s+SECURITY)/i.test(view[2])) {
        text = `${view[1]}VIEW${text.slice(view[0].length)}`
        warnings.add('mysql.viewOptions')
        count('mysql.viewOptions')
      }
      // utf8mb4_0900_* 排序规则不存在，退到 unicode_ci。
      if (/\butf8mb4_0900_\w+\b/i.test(text)) {
        text = text.replace(/\butf8mb4_0900_\w+\b/gi, 'utf8mb4_unicode_ci')
        warnings.add('mysql.collation0900')
        count('mysql.collation0900')
      }
      // SET('a','b') 类型不支持，退化为 varchar。
      if (/\bSET\s*\(\s*'/i.test(text)) {
        text = text.replace(/\bSET\s*\([^)]*\)/gi, 'varchar(255)')
        warnings.add('mysql.setType')
        count('mysql.setType')
      }
      // 空间类型与 SPATIAL 索引不支持。
      if (/\b(?:GEOMETRY|POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\b/i.test(text)) {
        text = text.replace(/\b(?:GEOMETRY|POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\b/gi, 'bytea')
        warnings.add('mysql.spatial')
        count('mysql.spatial')
      }
      if (/\bSPATIAL\s+(?:KEY|INDEX)\b/i.test(text)) {
        text = text.replace(/,\s*SPATIAL\s+(?:KEY|INDEX)\s+`?\w+`?\s*\([^)]*\)/gi, '')
        text = text.replace(/SPATIAL\s+(?:KEY|INDEX)\s+`?\w+`?\s*\([^)]*\),\s*/gi, '')
        warnings.add('mysql.spatialIndex')
        count('mysql.spatialIndex')
      }
      // PARTITION BY 不支持，去掉分区子句（保留表定义）。
      if (/^\s*CREATE\s+TABLE\b/i.test(text) && /\bPARTITION\s+BY\b/i.test(text)) {
        text = text.replace(/\s*PARTITION\s+BY\b[\s\S]*?(?=;\s*$)/i, '')
        warnings.add('mysql.partition')
        count('mysql.partition')
      }
      // JSON_EXTRACT 函数不存在，简单路径改写为 ->> / #>>。
      const jsonBefore = text
      text = text.replace(/JSON_EXTRACT\s*\(\s*([A-Za-z_][\w$.]*)\s*,\s*'\$\.([\w.]+)'\s*\)/gi, (match, expr, path) => {
        const parts = path.split('.')
        return parts.length > 1 ? `(${expr} #>> '{${parts.join(',')}}')` : `(${expr} ->> '${parts[0]}')`
      })
      if (jsonBefore !== text) {
        warnings.add('mysql.jsonExtract')
        count('mysql.jsonExtract')
      } else if (/JSON_EXTRACT\s*\(/i.test(text)) {
        warnings.add('mysql.jsonExtract')
      }
      if (/FOUND_ROWS\s*\(/i.test(text)) warnings.add('mysql.foundRows')
      // DROP TRIGGER IF EXISTS 不支持 IF EXISTS。
      if (/DROP\s+TRIGGER\s+IF\s+EXISTS/i.test(text)) {
        text = text.replace(/DROP\s+TRIGGER\s+IF\s+EXISTS/gi, 'DROP TRIGGER')
        warnings.add('mysql.dropTrigger')
        count('mysql.dropTrigger')
      }
      return { text: ensureTerminator(text), applied, warnings: [...warnings] }
    }
    /* @mysql-rules:end */

    /** Keywords highlighted in the converted SQL (HGDB V9 plus common Oracle words). */
    const SQL_KEYWORDS = new Set((
      'select from where insert into update delete create or replace function procedure package body trigger view materialized table type sequence '
      + 'returns return declare begin end if then else elsif elseif loop for while execute immediate using null is as and or not in exists like between '
      + 'primary key foreign references unique check default constraint index on values set group by order having union all distinct join left right inner outer '
      + 'case when end case commit rollback savepoint exception raise when others language plpgsql int integer numeric number varchar2 varchar char text boolean date timestamp '
      + 'nvl nvl2 sysdate systimestamp decode rownum rowid dual outer varchar2 length substr instr to_char to_date to_number trunc round mod nvl '
      + 'pragma autonomous_transaction bulk collect into limit offset fetch next only returning grant revoke public synonym cursor ref rowtype '
      + 'coalesce sum count max min avg current_timestamp nextval currval level connect start prior comment'
    ).split(/\s+/).filter(Boolean))

    /** Data types get their own dbx-like colour. */
    const SQL_TYPES = new Set((
      'number numeric varchar2 varchar nvarchar2 nchar char date timestamp interval boolean integer int smallint bigint '
      + 'decimal float real double precision clob blob bfile raw long rowid urowid pls_integer binary_integer natural'
    ).split(/\s+/).filter(Boolean))

    /** Wrap SQL tokens in coloured spans; used by the result pane. */
    function highlightSql(text) {
      if (text === '') return null
      const pattern = /(--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|\$\$[\s\S]*?\$\$|\b\d+(?:\.\d+)?\b|"[^"]*"|\b[A-Za-z_][A-Za-z0-9_$#]*\b)/g
      const nodes = []
      let last = 0
      let match
      let index = 0
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > last) nodes.push(text.slice(last, match.index))
        const token = match[0]
        let className = ''
        if (token.startsWith('--') || token.startsWith('/*')) className = 'sql-com'
        else if (token.startsWith("'") || token.startsWith('$$')) className = 'sql-str'
        else if (token.startsWith('"')) className = 'sql-ident'
        else if (/^\d/.test(token)) className = 'sql-num'
        else if (SQL_TYPES.has(token.toLowerCase())) className = 'sql-type'
        else if (SQL_KEYWORDS.has(token.toLowerCase())) className = 'sql-kw'
        nodes.push(className === '' ? token : h('span', { key: `sql${index++}`, className }, token))
        last = pattern.lastIndex
      }
      if (last < text.length) nodes.push(text.slice(last))
      return nodes
    }

    /** Two circular arrows: the conversion/sync mark for the workbench entry. */
    function BrandIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 36
      return h('svg', {
        width: size, height: size, viewBox: '0 0 36 36', fill: 'none', 'aria-hidden': 'true',
        className: 'o2h-brandIcon',
      },
      h('defs', null,
        h('linearGradient', { id: 'ps-db', x1: '0', y1: '0', x2: '0', y2: '1' },
          h('stop', { offset: '0', stopColor: '#38BDF8' }),
          h('stop', { offset: '.55', stopColor: '#2563EB' }),
          h('stop', { offset: '1', stopColor: '#1E40AF' })),
        h('marker', {
          id: 'ps-arrow', viewBox: '0 0 10 10', refX: '7', refY: '5',
          markerWidth: '4.6', markerHeight: '4.6', orient: 'auto-start-reverse',
        }, h('path', { d: 'M0 0L10 5L0 10Z', fill: '#FFFFFF' }))),
      h('g', { transform: 'translate(18 18) scale(1.15) translate(-18 -18)' },
      h('path', {
        d: 'M7 9c0 2.2 4.9 4 11 4s11-1.8 11-4v18c0 2.2-4.9 4-11 4S7 29.2 7 27V9Z',
        fill: 'url(#ps-db)',
      }),
      h('ellipse', { cx: 18, cy: 9, rx: 11, ry: 4, fill: '#7DD3FC' }),
      h('ellipse', { cx: 18, cy: 9, rx: 11, ry: 4, stroke: 'rgba(255,255,255,.45)', strokeWidth: '.8' }),
      h('path', {
        d: 'M12.6 18.6a5.4 5.4 0 0 1 10.8 0',
        stroke: '#FFFFFF', strokeWidth: 2.5, strokeLinecap: 'round', markerEnd: 'url(#ps-arrow)',
      }),
      h('path', {
        d: 'M23.4 18.6a5.4 5.4 0 0 1-10.8 0',
        stroke: '#FFFFFF', strokeWidth: 2.5, strokeLinecap: 'round', markerEnd: 'url(#ps-arrow)',
      })))
    }

    function PanelIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 16
      const stroke = { stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true',
      },
      h('ellipse', { cx: 12, cy: 5, rx: 7, ry: 2.6, ...stroke }),
      h('path', { d: 'M5 5v6c0 1.45 3.13 2.6 7 2.6s7-1.15 7-2.6V5', ...stroke }),
      h('path', { d: 'M5 11v6c0 1.45 3.13 2.6 7 2.6s7-1.15 7-2.6v-6', ...stroke }))
    }

    /** Full-page conversion workbench: input on the left, the exact request on the right. */
/** Files belong to the local workspace, one source connection, or an unknown legacy source. */
    function fileContext(file) {
      if (file.origin !== 'source') return ''
      return typeof file.sourceId === 'string' && file.sourceId !== '' ? file.sourceId : undefined
    }

    /** Display name of a database engine. */
    /** Source engines the workbench can read from, and target engines it can execute into. */
    const SOURCE_KINDS = ['oracle', 'mysql']
    const TARGET_KINDS = ['hgdb', 'postgresql', 'hgdb-oracle', 'hgdb-mysql']
    const SYSTEM_SCHEMAS = new Set(['mysql', 'information_schema', 'performance_schema', 'sys'])
    const isSystemSchema = (name) => typeof name === 'string' && SYSTEM_SCHEMAS.has(name.trim().toLowerCase())
    const isSourceKind = (kind) => SOURCE_KINDS.includes(kind)
    const isTargetKind = (kind) => TARGET_KINDS.includes(kind)
    /** Default listener port for a connection kind. */
    const defaultPortFor = (kind) => {
      if (kind === 'oracle' || kind === 'hgdb-oracle') return '1521'
      if (kind === 'mysql' || kind === 'hgdb-mysql') return '3306'
      return '5432'
    }
    /** 目标兼容模式：目标库决定；未选目标库时由用户在向导里单选，默认 PostgreSQL。 */
    const COMPAT_MODES = ['postgresql', 'oracle', 'mysql', 'sqlserver']
    const COMPAT_MODE_KEYS = {
      postgresql: 'compatModePostgresql',
      oracle: 'compatModeOracle',
      mysql: 'compatModeMysql',
      sqlserver: 'compatModeSqlserver',
    }
    const compatModeForKind = (kind) => {
      if (kind === 'hgdb-oracle') return 'oracle'
      if (kind === 'hgdb-mysql') return 'mysql'
      return 'postgresql'
    }
    /** 任务上的兼容模式：新任务读 compatMode，旧任务按 compat 布尔值回退。 */
    const taskCompatMode = (task) => {
      if (task !== null && typeof task === 'object' && COMPAT_MODES.includes(task.compatMode)) return task.compatMode
      return task !== null && typeof task === 'object' && task.compat === false ? 'postgresql' : 'oracle'
    }

    function engineLabel(engine) {
      if (engine === 'oracle') return 'Oracle'
      if (engine === 'mysql') return 'MySQL'
      if (engine === 'sqlserver') return 'SQL Server'
      if (engine === 'hgdb' || engine === 'postgresql') return 'HGDB-V9-PostgreSQL'
      if (engine === 'hgdb-oracle') return 'HGDB-V9-Oracle'
      if (engine === 'hgdb-mysql') return 'HGDB-V9-MySQL'
      return engine
    }

    const OBJECT_TYPE_ICONS = {
      TABLE: 'table',
      VIEW: 'eye',
      'MATERIALIZED VIEW': 'layers',
      FUNCTION: 'braces',
      PROCEDURE: 'terminal',
      PACKAGE: 'package',
      'PACKAGE BODY': 'package',
      TRIGGER: 'bolt',
      TYPE: 'braces',
      SEQUENCE: 'sequence',
      SYNONYM: 'link',
      JOB: 'clock',
      EVENT: 'clock',
    }

    function objectTypeIcon(type) {
      return OBJECT_TYPE_ICONS[type] ?? 'file'
    }

    /**
     * Only untouched auto-created blanks are treated as throwaway placeholders.
     * A renamed blank (or one with SQL in it) is a real file and must survive reloads.
     */
    function isPlaceholderFile(file) {
      if (typeof file.sql !== 'string' || file.sql.trim() !== '') return false
      const name = typeof file.name === 'string' ? file.name : ''
      if (file.autoBlank === true) return /^sql-\d{2,}\.sql$/i.test(name)
      return /^untitled(\.sql)?$/i.test(name)
    }

    function prunePlaceholders(list) {
      const groups = new Map()
      for (const file of list) {
        const key = `${file.taskId ?? ''}|${fileContext(file) ?? 'legacy'}`
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(file)
      }
      const keep = new Set()
      for (const group of groups.values()) {
        const substantive = group.filter(file => !isPlaceholderFile(file))
        if (substantive.length > 0) {
          for (const file of substantive) keep.add(file.id)
        } else {
          keep.add(group[0].id)
        }
      }
      return list.filter(file => keep.has(file.id))
    }

    const PLUGIN_VERSION = '2.57.0'

    const DEMO_HOME = {
      connections: 4,
      sources: 3,
      targets: 1,
      objects: 1286,
      success: 98.6,
      pending: 18,
      types: 8,
      tasks: 3,
      tasksLocal: 1,
      tasksSource: 2,
      done7d: [12, 34, 20, 56, 38, 68, 78],
      review7d: [5, 16, 9, 24, 18, 30, 24],
      done30d: [8, 16, 14, 28, 22, 40, 36, 54, 48, 68],
      review30d: [4, 9, 7, 14, 11, 18, 15, 21, 18, 24],
    }

    const HOME_WEEK_KEYS = ['homeWeekMon', 'homeWeekTue', 'homeWeekWed', 'homeWeekThu', 'homeWeekFri', 'homeWeekSat', 'homeWeekSun']
    const HOME_DAY_MS = 24 * 60 * 60 * 1000

    function formatCount(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '0'
      return String(Math.round(number)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }

    function formatRelative(ts, t) {
      if (typeof ts !== 'number' || !Number.isFinite(ts)) return ''
      const diff = Math.max(0, Date.now() - ts)
      if (diff < 60 * 1000) return t('homeTimeJustNow')
      if (diff < 60 * 60 * 1000) return t('homeTimeMinutes', { count: Math.floor(diff / (60 * 1000)) })
      if (diff < 24 * 60 * 60 * 1000) return t('homeTimeHours', { count: Math.floor(diff / (60 * 60 * 1000)) })
      return t('homeTimeDays', { count: Math.floor(diff / (24 * 60 * 60 * 1000)) })
    }

    /** Build the seven/thirty-day conversion series from local file timestamps. */
    function buildHomeTrend(range, files, demoMode, t) {
      const points = range === '30d' ? 10 : 7
      const span = range === '30d' ? 30 : 7
      const bucket = (span * HOME_DAY_MS) / points
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const end = today.getTime() + HOME_DAY_MS
      const labels = []
      for (let index = 0; index < points; index += 1) {
        const when = new Date(today.getTime() - (points - 1 - index) * bucket)
        labels.push(range === '30d'
          ? `${when.getMonth() + 1}/${when.getDate()}`
          : t(HOME_WEEK_KEYS[(when.getDay() + 6) % 7]))
      }
      if (demoMode) {
        const done = range === '30d' ? DEMO_HOME.done30d : DEMO_HOME.done7d
        const review = range === '30d' ? DEMO_HOME.review30d : DEMO_HOME.review7d
        return {
          labels,
          done,
          review,
          total: done.reduce((sum, value) => sum + value, 0),
          peak: Math.max(...done, ...review),
        }
      }
      const done = new Array(points).fill(0)
      const review = new Array(points).fill(0)
      for (const file of files) {
        const ts = file.convertedAt
        if (typeof ts !== 'number' || !Number.isFinite(ts)) continue
        const age = end - ts
        if (age < 0 || age > span * HOME_DAY_MS) continue
        const slot = Math.min(points - 1, Math.max(0, points - 1 - Math.floor(age / bucket)))
        if (file.status === 'error') review[slot] += 1
        else if (file.status === 'ok') done[slot] += 1
      }
      return {
        labels,
        done,
        review,
        total: done.reduce((sum, value) => sum + value, 0) + review.reduce((sum, value) => sum + value, 0),
        peak: Math.max(...done, ...review, 0),
      }
    }

    /** Minimal stroked icon set so the overview does not depend on external assets. */
    function StudioIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 16
      const paths = {
        home: ['M3.5 10.7 12 3l8.5 7.7V20a1 1 0 0 1-1 1h-5v-6.4h-5V21h-5a1 1 0 0 1-1-1z'],
        grid: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
        terminal: ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'm7 9 3 3-3 3', 'M13 15h4'],
        database: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'],
        sync: ['M20 11a8 8 0 0 0-14.6-4.4L3 9', 'M3 4v5h5', 'M4 13a8 8 0 0 0 14.6 4.4L21 15', 'M21 20v-5h-5'],
        convert: ['M4 9h14', 'm14 5 4 4-4 4', 'M20 15H6', 'm6 11-4 4 4 4'],
        chart: ['M4 20V9', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
        arrowRight: ['M4 12h15', 'm13 6 6 6-6 6'],
        arrowUpRight: ['M7 17 17 7', 'M8 7h9v9'],
        plus: ['M12 5v14', 'M5 12h14'],
        check: ['m5 12 4 4L19 6'],
        shield: ['M12 3 20 6v5c0 4.6-3.3 7.9-8 10-4.7-2.1-8-5.4-8-10V6z', 'm8.5 12 2.4 2.4 4.6-4.8'],
        alert: ['M12 3 2.8 20h18.4z', 'M12 9v4.5', 'M12 17.2h.01'],
        clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3.2 2'],
        bolt: ['M13 2 4 14h6l-1 8 9-12h-6z'],
        download: ['M12 3v11', 'm7 9 5 5 5-5', 'M5 20h14'],
        file: ['M6 3h8l4 4v14H6z', 'M14 3v5h5'],
        layers: ['m12 3 9 5-9 5-9-5z', 'm3 13 9 5 9-5', 'm3 17 9 5 9-5'],
        link: ['M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1', 'M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1'],
        play: ['M8 5v14l11-7z'],
        sparkles: ['m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z'],
        sun: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'],
        moon: ['M20.5 14.2A8.6 8.6 0 0 1 9.8 3.5 8.6 8.6 0 1 0 20.5 14.2z'],
        diff: ['M4 6h6M7 3v6', 'M14 6h6', 'M4 18h6', 'M14 18h6M17 15v6'],
        list: ['M8 6h13M8 12h13M8 18h13', 'M3 6h.01M3 12h.01M3 18h.01'],
        table: ['M3 4h18v16H3z', 'M3 10h18', 'M9 4v16', 'M15 4v16'],
        eye: ['M2.5 12s3.6-7 9.5-7 9.5 7 9.5 7-3.6 7-9.5 7S2.5 12 2.5 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
        eyeOff: ['M3 3l18 18', 'M10.6 10.6a2 2 0 0 0 2.8 2.8', 'M9.9 5.1A10.9 10.9 0 0 1 12 5c5.9 0 9.5 7 9.5 7a18 18 0 0 1-3.1 4.1', 'M6.2 6.2A18 18 0 0 0 2.5 12s3.6 7 9.5 7a10.9 10.9 0 0 0 4.3-.9'],
        braces: ['M8 3H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2', 'M16 3h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2'],
        package: ['m12 3 8 4.5v9L12 21l-8-4.5v-9z', 'M4 7.5 12 12l8-4.5', 'M12 12v9'],
        sequence: ['M4 6h3M4 12h3M4 18h3', 'M11 6h9M11 12h9M11 18h9'],
        close: ['M6 6l12 12', 'M18 6 6 18'],
        edit: ['M4 20h4L20 8l-4-4L4 16z', 'm14 6 4 4'],
        trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6M14 11v6'],
      }
      const shapes = paths[props.name] ?? paths.grid
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: typeof props.strokeWidth === 'number' ? props.strokeWidth : 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
      }, shapes.map((d, index) => h('path', { key: index, d })))
    }

    /**
     * 自定义下拉：原生 <select> 的弹出层由系统绘制，打开时会先闪一块灰色面板；
     * 这里用按钮 + 绝对定位菜单替代，菜单挂在字段自身下方，避免受弹窗 transform/filter 影响而错位。
     */
    function StudioSelect(props) {
      const { id, value, options, onChange, className = 'o2h-select', ariaLabel } = props
      const [open, setOpen] = React.useState(false)
      const [menuRect, setMenuRect] = React.useState(null)
      const buttonRef = React.useRef(null)
      const menuRef = React.useRef(null)
      const toggle = () => {
        const button = buttonRef.current
        if (button === null) {
          setOpen(current => !current)
          return
        }
        if (open) {
          setOpen(false)
          return
        }
        const rect = button.getBoundingClientRect()
        const estimated = Math.min(280, options.length * 36 + 10)
        const spaceBelow = window.innerHeight - rect.bottom - 8
        const spaceAbove = rect.top - 8
        const up = spaceBelow < Math.min(estimated, 160) && spaceAbove > spaceBelow
        const maxHeight = Math.max(140, Math.min(280, up ? spaceAbove : spaceBelow))
        setMenuRect({
          left: rect.left,
          width: rect.width,
          top: up ? 'auto' : rect.bottom + 4,
          bottom: up ? window.innerHeight - rect.top + 4 : 'auto',
          maxHeight,
        })
        setOpen(true)
      }
      React.useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          if (buttonRef.current !== null && buttonRef.current.contains(event.target)) return
          if (menuRef.current !== null && menuRef.current.contains(event.target)) return
          setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        const onViewportChange = () => setOpen(false)
        document.addEventListener('mousedown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        window.addEventListener('resize', onViewportChange)
        window.addEventListener('scroll', onViewportChange, true)
        return () => {
          document.removeEventListener('mousedown', onPointerDown)
          document.removeEventListener('keydown', onKeyDown)
          window.removeEventListener('resize', onViewportChange)
          window.removeEventListener('scroll', onViewportChange, true)
        }
      }, [open])
      const selected = options.find(option => option.value === value)
      const themeHost = buttonRef.current != null && typeof buttonRef.current.closest === 'function'
        ? buttonRef.current.closest('.o2p-app')
        : null
      const themeName = themeHost !== null && themeHost.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
      const menu = open && menuRect !== null
        ? h('div', {
          ref: menuRef,
          className: 'o2h-selectMenu',
          'data-theme': themeName,
          role: 'listbox',
          style: {
            position: 'fixed',
            left: menuRect.left,
            right: 'auto',
            top: menuRect.top,
            bottom: menuRect.bottom,
            width: menuRect.width,
            maxHeight: menuRect.maxHeight,
          },
        }, options.map(option => h('button', {
          key: option.value,
          type: 'button',
          role: 'option',
          'aria-selected': option.value === value ? 'true' : 'false',
          className: 'o2h-selectOption',
          'data-selected': option.value === value ? 'true' : undefined,
          onClick: () => {
            onChange(option.value)
            setOpen(false)
          },
        }, option.label)))
        : null
      return h('div', { className: 'o2h-selectWrap' },
        h('button', {
          ref: buttonRef,
          id,
          type: 'button',
          className: `${className} o2h-selectBtn`,
          'aria-haspopup': 'listbox',
          'aria-expanded': open ? 'true' : 'false',
          'aria-label': ariaLabel,
          onClick: toggle,
        },
        h('span', { className: 'o2h-selectValue' }, selected === undefined ? '\u2014' : selected.label),
        h('span', { className: 'o2h-selectArrow', 'aria-hidden': 'true' })),
        menu === null || typeof document === 'undefined'
          ? null
          : (ReactDOM !== null && typeof ReactDOM.createPortal === 'function'
            ? ReactDOM.createPortal(menu, document.body)
            : menu))
    }

    function Sparkline(props) {
      const values = props.values.length > 1 ? props.values : [0, 0]
      const width = 86
      const height = 28
      const pad = 2
      const max = Math.max(...values)
      const min = Math.min(...values)
      const range = max - min || 1
      const points = values.map((value, index) => [
        pad + (index * (width - pad * 2)) / (values.length - 1),
        height - pad - ((value - min) / range) * (height - pad * 2),
      ])
      const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(' ')
      const last = points[points.length - 1]
      return h('svg', {
        className: 'o2h-spark',
        viewBox: `0 0 ${width} ${height}`,
        'aria-hidden': 'true',
        focusable: 'false',
      },
      h('path', {
        d: `${line} L${last[0]},${height} L${points[0][0]},${height} Z`,
        fill: 'currentColor',
        opacity: 0.1,
        stroke: 'none',
      }),
      h('path', {
        d: line,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
      h('circle', { cx: last[0], cy: last[1], r: 1.9, fill: 'currentColor' }))
    }

    function smoothPath(points) {
      if (points.length === 0) return ''
      let d = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`
      for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1]
        const point = points[index]
        const middle = (previous[0] + point[0]) / 2
        d += ` C${middle.toFixed(1)},${previous[1].toFixed(1)} ${middle.toFixed(1)},${point[1].toFixed(1)} ${point[0].toFixed(1)},${point[1].toFixed(1)}`
      }
      return d
    }

    /** Line-level diff (LCS), capped so the analysis panel stays responsive. */
    function buildLineDiff(before, after, limit = 400) {
      const beforeLines = String(before ?? '').split('\n')
      const afterLines = String(after ?? '').split('\n')
      const truncated = beforeLines.length > limit || afterLines.length > limit
      const left = beforeLines.slice(0, limit)
      const right = afterLines.slice(0, limit)
      const rowsCount = left.length
      const colsCount = right.length
      const matrix = Array.from({ length: rowsCount + 1 }, () => new Uint16Array(colsCount + 1))
      for (let i = rowsCount - 1; i >= 0; i -= 1) {
        for (let j = colsCount - 1; j >= 0; j -= 1) {
          matrix[i][j] = left[i] === right[j]
            ? matrix[i + 1][j + 1] + 1
            : Math.max(matrix[i + 1][j], matrix[i][j + 1])
        }
      }
      const rows = []
      let i = 0
      let j = 0
      let beforeNo = 1
      let afterNo = 1
      while (i < rowsCount && j < colsCount) {
        if (left[i] === right[j]) {
          rows.push({ kind: 'same', text: left[i], beforeNo, afterNo })
          i += 1
          j += 1
          beforeNo += 1
          afterNo += 1
        } else if (matrix[i + 1][j] >= matrix[i][j + 1]) {
          rows.push({ kind: 'del', text: left[i], beforeNo, afterNo: null })
          i += 1
          beforeNo += 1
        } else {
          rows.push({ kind: 'add', text: right[j], beforeNo: null, afterNo })
          j += 1
          afterNo += 1
        }
      }
      while (i < rowsCount) {
        rows.push({ kind: 'del', text: left[i], beforeNo, afterNo: null })
        i += 1
        beforeNo += 1
      }
      while (j < colsCount) {
        rows.push({ kind: 'add', text: right[j], beforeNo: null, afterNo })
        j += 1
        afterNo += 1
      }
      return { rows, truncated }
    }

    function HomeTrendChart(props) {
      const { labels, done, review, total, attempted, demoMode, t, onOpenStudio } = props
      const wrapRef = React.useRef(null)
      const [size, setSize] = React.useState({ width: 1500, height: 230 })
      React.useEffect(() => {
        const measure = () => {
          const node = wrapRef.current
          if (!node) return
          const rect = node.getBoundingClientRect()
          const nextWidth = Math.max(320, Math.round(rect.width - 16))
          const nextHeight = Math.max(140, Math.round(rect.height))
          setSize((current) => (Math.abs(current.width - nextWidth) < 1 && Math.abs(current.height - nextHeight) < 1
            ? current
            : { width: nextWidth, height: nextHeight }))
        }
        measure()
        let observer
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(measure)
          if (wrapRef.current) observer.observe(wrapRef.current)
        }
        window.addEventListener('resize', measure)
        return () => {
          if (observer !== undefined) observer.disconnect()
          window.removeEventListener('resize', measure)
        }
      }, [])
      const width = size.width
      const height = size.height
      const left = 10
      const right = 10
      const top = 24
      const bottom = 30
      const max = Math.max(...done, ...review, 1) * 1.28
      const plotWidth = width - left - right
      const plotHeight = height - top - bottom
      const xAt = (index) => left + (plotWidth * index) / Math.max(labels.length - 1, 1)
      const yAt = (value) => top + plotHeight * (1 - value / max)
      const donePoints = done.map((value, index) => [xAt(index), yAt(value)])
      const reviewPoints = review.map((value, index) => [xAt(index), yAt(value)])
      const doneLine = smoothPath(donePoints)
      const reviewLine = smoothPath(reviewPoints)
      const area = donePoints.length === 0
        ? ''
        : `${doneLine} L${xAt(done.length - 1).toFixed(1)},${(top + plotHeight).toFixed(1)} L${xAt(0).toFixed(1)},${(top + plotHeight).toFixed(1)} Z`
      const lastDone = donePoints[donePoints.length - 1]
      const gridLines = [0, 1, 2, 3].map(index => {
        const y = top + (plotHeight * index) / 3
        return h('line', {
          key: `grid-${index}`,
          x1: left,
          x2: width - right,
          y1: y,
          y2: y,
          stroke: 'rgba(120, 155, 220, 0.13)',
          strokeDasharray: index === 3 ? undefined : '3 7',
        })
      })
      return h('div', { className: 'o2h-chartWrap', ref: wrapRef },
        h('svg', {
          className: 'o2h-chart',
          viewBox: `0 0 ${width} ${height}`,
          role: 'img',
          'aria-label': t('homeTrendTitle'),
        },
        h('defs', null,
          h('linearGradient', { id: 'o2hAreaGrad', x1: '0', y1: '0', x2: '0', y2: '1' },
            h('stop', { offset: '0%', stopColor: '#38bdf8', stopOpacity: 0.42 }),
            h('stop', { offset: '72%', stopColor: '#2563eb', stopOpacity: 0.08 }),
            h('stop', { offset: '100%', stopColor: '#2563eb', stopOpacity: 0 })),
          h('linearGradient', { id: 'o2hLineGrad', x1: '0', y1: '0', x2: '1', y2: '0' },
            h('stop', { offset: '0%', stopColor: '#60a5fa' }),
            h('stop', { offset: '58%', stopColor: '#22d3ee' }),
            h('stop', { offset: '100%', stopColor: '#a78bfa' }))),
        gridLines,
        h('path', { d: area, fill: 'url(#o2hAreaGrad)' }),
        h('path', {
          className: 'o2h-chartLine',
          d: doneLine,
          fill: 'none',
          stroke: 'url(#o2hLineGrad)',
          strokeWidth: 2.6,
          strokeLinecap: 'round',
          pathLength: 1,
          vectorEffect: 'non-scaling-stroke',
        }),
        h('path', {
          className: 'o2h-chartLineReview',
          d: reviewLine,
          fill: 'none',
          stroke: '#fbbf24',
          strokeWidth: 1.6,
          strokeDasharray: '4 5',
          strokeLinecap: 'round',
          vectorEffect: 'non-scaling-stroke',
        }),
        donePoints.map((point, index) => h('circle', {
          key: `done-${index}`,
          cx: point[0],
          cy: point[1],
          r: index === donePoints.length - 1 ? 4.2 : 2.6,
          fill: '#091321',
          stroke: index === donePoints.length - 1 ? '#22d3ee' : '#60a5fa',
          strokeWidth: index === donePoints.length - 1 ? 2.6 : 1.8,
          className: index === donePoints.length - 1 ? 'o2h-chartPointLast' : undefined,
        }, h('title', null, `${labels[index]}: ${done[index]}`))),
        reviewPoints.map((point, index) => h('circle', {
          key: `review-${index}`,
          cx: point[0],
          cy: point[1],
          r: 2,
          fill: '#fbbf24',
          opacity: 0.85,
        }, h('title', null, `${labels[index]}: ${review[index]}`))),
        labels.map((label, index) => h('text', {
          key: `label-${index}`,
          x: xAt(index),
          y: height - 7,
          textAnchor: 'middle',
          fill: 'rgba(153, 174, 211, 0.72)',
          fontSize: 10.5,
        }, label))),
        total === 0 && !demoMode
          ? h('div', { className: 'o2h-chartEmpty' },
            h('span', { className: 'o2h-chartEmptyIcon' }, h(StudioIcon, { name: 'chart', size: 18 })),
            h('p', null, attempted > 0 ? t('homeTrendNoTimestamps') : t('homeTrendEmpty')),
            h('button', { type: 'button', onClick: onOpenStudio }, t('homeTrendGo'), h(StudioIcon, { name: 'arrowRight', size: 12 })))
          : null)
    }

    /** Persistent top navigation shared by overview, workspace, and connections. */
    function StudioTopNav(props) {
      const { t, active, onNavigate, theme, onToggleTheme } = props
      const navRef = React.useRef(null)
      React.useEffect(() => {
        const nav = navRef.current
        if (nav === null) return
        const node = nav.querySelector("[data-active='true']")
        if (node !== null && typeof node.scrollIntoView === 'function') {
          node.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
        }
      }, [active])
      const item = (key, label, extraClass = '') => h('button', {
        type: 'button',
        className: `o2h-navItem${extraClass}`,
        'data-active': active === key ? 'true' : undefined,
        'aria-current': active === key ? 'page' : undefined,
        onClick: () => onNavigate(key),
      }, label)
      return h('header', { className: 'o2h-top' },
        h('div', { className: 'o2h-brand' },
          h('span', { className: 'o2h-mark' }, h(BrandIcon, { size: 44 })),
          h('span', { className: 'o2h-brandText' },
            h('span', { className: 'o2h-brandLine' },
              h('strong', null, t('pageTitle')),
              h('em', null, t('homePro'))),
            h('small', null, t('homeTagline')))),
        h('nav', { ref: navRef, className: 'o2h-nav', 'aria-label': t('homeNav') },
          item('home', t('homeNav')),
          item('tasks', t('navTasks')),
          item('studio', t('homeStudio')),
          item('connections', t('homeConnections')),
          item('settings', t('homeSettings'))),
        h('div', { className: 'o2h-topRight' },
          h('span', { className: 'o2h-engine' }, h('i', null), t('homeEngineReady')),
          typeof onToggleTheme === 'function'
            ? h('button', {
              type: 'button',
              className: 'o2h-iconBtn',
              onClick: onToggleTheme,
              title: theme === 'light' ? t('themeDark') : t('themeLight'),
              'aria-label': theme === 'light' ? t('themeDark') : t('themeLight'),
            }, h(StudioIcon, { name: theme === 'light' ? 'moon' : 'sun', size: 15 }))
            : null))
    }

    /** Measure the hero nodes and draw center-to-center connectors between them. */
    function HeroConnectors(props) {
      const { visualRef, sourceRef, consoleRef, targetRef } = props
      const [geometry, setGeometry] = React.useState(null)
      React.useEffect(() => {
        const measure = () => {
          const visual = visualRef.current
          const source = sourceRef.current
          const consoleNode = consoleRef.current
          const target = targetRef.current
          if (!visual || !source || !consoleNode || !target) return
          const v = visual.getBoundingClientRect()
          const s = source.getBoundingClientRect()
          const c = consoleNode.getBoundingClientRect()
          const t = target.getBoundingClientRect()
          if (v.width < 10 || v.height < 10) return
          const toX = (value) => value - v.left
          const toY = (value) => value - v.top
          const s1 = { x: toX(s.left + s.width / 2), y: toY(s.bottom) - 1 }
          const s2 = { x: toX(c.left) + 1, y: toY(c.top + c.height / 2) }
          const t1 = { x: toX(c.right) - 1, y: toY(c.top + c.height / 2) }
          const t2 = { x: toX(t.left + t.width / 2), y: toY(t.top) + 1 }
          setGeometry({ width: v.width, height: v.height, s1, s2, t1, t2 })
        }
        measure()
        let observer
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(measure)
          for (const ref of [visualRef, sourceRef, consoleRef, targetRef]) {
            if (ref.current) observer.observe(ref.current)
          }
        }
        window.addEventListener('resize', measure)
        return () => {
          if (observer !== undefined) observer.disconnect()
          window.removeEventListener('resize', measure)
        }
      }, [])
      const width = geometry === null ? 100 : geometry.width
      const height = geometry === null ? 100 : geometry.height
      const sourcePath = geometry === null
        ? 'M12.5 16 L12.5 50 L24 50'
        : `M${geometry.s1.x} ${geometry.s1.y} L${geometry.s1.x} ${geometry.s2.y} L${geometry.s2.x} ${geometry.s2.y}`
      const targetPath = geometry === null
        ? 'M76 50 L88.5 50 L88.5 90'
        : `M${geometry.t1.x} ${geometry.t1.y} L${geometry.t2.x} ${geometry.t1.y} L${geometry.t2.x} ${geometry.t2.y}`
      const dotRadius = geometry === null ? 1.2 : 2
      return h('svg', {
        className: 'o2h-connectors',
        viewBox: `0 0 ${width} ${height}`,
        preserveAspectRatio: 'none',
        'aria-hidden': 'true',
      },
      h('path', { className: 'o2h-connector', d: sourcePath }),
      h('path', { className: 'o2h-connector', d: targetPath }),
      h('circle', { className: 'o2h-connectorDot', r: dotRadius },
        h('animateMotion', { dur: '2.6s', repeatCount: 'indefinite', path: sourcePath })),
      h('circle', { className: 'o2h-connectorDot', r: dotRadius },
        h('animateMotion', { dur: '2.6s', begin: '1.3s', repeatCount: 'indefinite', path: targetPath })))
    }

    /** Full-page product overview shown before the SQL workspace. */
    function HomeView(props) {
      const { t, files, connections, tasks, compat, busy, onOpenStudio, onNewTask, onOpenConnections, onOpenFile, onNavigate, embedded, theme, onToggleTheme } = props
      const [range, setRange] = React.useState('7d')
      const visualRef = React.useRef(null)
      const sourceRef = React.useRef(null)
      const consoleRef = React.useRef(null)
      const targetRef = React.useRef(null)
      const realFiles = files.filter(file => !isPlaceholderFile(file))
      const taskRecords = Array.isArray(tasks) ? tasks : []
      const demoMode = realFiles.length === 0 && connections.length === 0 && taskRecords.length === 0
      const sources = demoMode ? DEMO_HOME.sources : connections.filter(conn => isSourceKind(conn.kind)).length
      const targets = demoMode ? DEMO_HOME.targets : connections.filter(conn => isTargetKind(conn.kind)).length
      const taskTotal = demoMode ? DEMO_HOME.tasks : taskRecords.length
      const taskLocal = demoMode ? DEMO_HOME.tasksLocal : taskRecords.filter(task => task.origin !== 'source').length
      const taskSource = demoMode ? DEMO_HOME.tasksSource : taskRecords.filter(task => task.origin === 'source').length
      const converted = realFiles.filter(file => file.status === 'ok').length
      const failed = realFiles.filter(file => file.status === 'error').length
      const attempted = converted + failed
      const convertedFiles = realFiles.filter(file => file.status === 'ok' || file.status === 'error')
      const successRate = demoMode
        ? DEMO_HOME.success
        : attempted === 0 ? null : (converted / attempted) * 100
      const pending = demoMode ? DEMO_HOME.pending : realFiles.filter(file => file.status === 'idle' || file.status === 'error').length
      const objectTypes = demoMode
        ? DEMO_HOME.types
        : new Set(convertedFiles.map(file => file.objType).filter(type => typeof type === 'string' && type !== '')).size
      const objects = demoMode ? DEMO_HOME.objects : convertedFiles.length
      const successText = successRate === null ? '\u2014' : `${successRate.toFixed(1)}%`
      const trend = buildHomeTrend(range, realFiles, demoMode, t)
      const recentConversions = realFiles
        .filter(file => typeof file.convertedAt === 'number' && file.convertedAt > 0)
        .sort((a, b) => b.convertedAt - a.convertedAt)
        .slice(0, 10)
      const sideTime = (ts) => {
        const minutes = Math.floor(Math.max(0, Date.now() - ts) / 60000)
        if (minutes < 1) return t('homeTimeJustNow')
        if (minutes < 60) return t('homeTimeMinutes', { count: minutes })
        const hours = Math.floor(minutes / 60)
        if (hours < 24) return t('homeTimeHours', { count: hours })
        return t('homeTimeDays', { count: Math.floor(hours / 24) })
      }
      const sourceConn = connections.find(conn => isSourceKind(conn.kind))
      const targetConn = connections.find(conn => isTargetKind(conn.kind))
      const sourceName = demoMode ? t('homeSourceValue') : (sourceConn ? sourceConn.name : t('homeSource'))
      const targetName = demoMode ? t('homeTargetValue') : (targetConn ? targetConn.name : t('homeTarget'))
      const targetVisualLabel = (kind) => engineLabel(kind)
      const heroSourceName = demoMode ? t('homeSourceValue') : (sourceConn ? engineLabel(sourceConn.kind) : t('homeSource'))
      const heroTargetName = demoMode ? t('homeTargetValue') : (targetConn ? targetVisualLabel(targetConn.kind) : t('homeTarget'))
      const demoStatus = t('homeDemoChip')
      const statCards = [
        {
          tone: 'green',
          icon: 'list',
          label: t('homeStatTasks'),
          value: formatCount(taskTotal),
          foot: taskTotal === 0
            ? t('homeStatTasksNone')
            : t('homeStatTasksFoot', { local: taskLocal, source: taskSource }),
          spark: demoMode
            ? [1, 1, 2, 2, 3, 3, DEMO_HOME.tasks]
            : [Math.max(0, taskTotal - 2), Math.max(0, taskTotal - 2), Math.max(0, taskTotal - 1), Math.max(0, taskTotal - 1), taskTotal, taskTotal, taskTotal],
        },
        {
          tone: 'blue',
          icon: 'database',
          label: t('homeStatConnections'),
          value: formatCount(demoMode ? DEMO_HOME.connections : connections.length),
          foot: t('homeStatConnectionsFoot', { sources, targets }),
          spark: demoMode ? [1, 2, 2, 3, 3, 4, 4] : [Math.max(0, connections.length - 2), Math.max(0, connections.length - 1), connections.length, connections.length, connections.length, connections.length, connections.length],
        },
        {
          tone: 'violet',
          icon: 'layers',
          label: t('homeStatObjects'),
          value: formatCount(objects),
          foot: t('homeStatObjectsFoot', { types: objectTypes }),
          spark: demoMode ? [8, 14, 18, 26, 31, 38, 44] : [0, 0, 1, 1, 2, 2, Math.max(objects, 1)],
        },
        {
          tone: 'cyan',
          icon: 'bolt',
          label: t('homeStatSuccess'),
          value: successText,
          foot: successRate === null ? t('homeStatSuccessNone') : t('homeStatSuccessFoot'),
          spark: demoMode ? [92, 93.4, 94.2, 96.1, 97, 97.8, 98.6] : [0, 0, 0, successRate ?? 0, successRate ?? 0, successRate ?? 0, successRate ?? 0],
        },
      ]
      const demoTasks = [
        { id: 'demo-erp', name: t('homeDemoTask1'), meta: t('homeDemoMeta1'), status: 'done', progress: 100, time: t('homeTimeMinutes', { count: 2 }) },
        { id: 'demo-finance', name: t('homeDemoTask2'), meta: t('homeDemoMeta2'), status: 'running', progress: 72, time: t('homeTimeMinutes', { count: 12 }) },
        { id: 'demo-stock', name: t('homeDemoTask3'), meta: t('homeDemoMeta3'), status: 'pending', progress: 12, time: t('homeTimeHours', { count: 1 }) },
      ]
      const realTasks = realFiles
        .slice()
        .sort((a, b) => (b.convertedAt ?? b.updatedAt ?? 0) - (a.convertedAt ?? a.updatedAt ?? 0))
        .slice(0, 4)
        .map((file) => {
          const source = connections.find(conn => conn.id === file.sourceId)
          const target = connections.find(conn => conn.id === props.targetConnId)
          const running = busy !== null && busy.fileId === file.id
          const status = running ? 'running' : file.status === 'ok' ? 'done' : file.status === 'error' ? 'error' : 'pending'
          return {
            id: file.id,
            file,
            name: file.name.replace(/\.sql$/i, ''),
            meta: `${source ? engineLabel(source.kind) : t('homeLocalFile')} \u2192 ${target ? engineLabel(target.kind) : 'HGDB V9'}${file.objType ? ` \u00b7 ${file.objType}` : ''}`,
            status,
            progress: status === 'done' || status === 'error' ? 100 : status === 'running' ? Math.min(92, 24 + busy.seconds * 3) : 10,
            time: formatRelative(file.convertedAt ?? file.updatedAt, t),
          }
        })
      const taskList = demoMode ? demoTasks : realTasks
      const statusMeta = {
        done: { icon: 'check', key: 'homeStatusDone' },
        running: { icon: 'sync', key: 'homeStatusRunning' },
        pending: { icon: 'clock', key: 'homeStatusPending' },
        error: { icon: 'alert', key: 'homeStatusError' },
      }
      const openTask = (task) => {
        if (task && task.file) onOpenFile(task.file)
        else onOpenStudio()
      }
      return h('div', { className: 'o2h o2h-home' },
        embedded ? null : h(StudioTopNav, { t, active: 'home', onNavigate, theme, onToggleTheme }),
        h('main', { className: 'o2h-scroll' },
          h('div', { className: 'o2h-inner' },
            h('section', { className: 'o2h-hero' },
              h('div', { className: 'o2h-heroCopy' },
                h('span', { className: 'o2h-eyebrow' },
                  h('i', { className: 'o2h-eyebrowDot' }),
                  t('homeEyebrow'),
                  demoMode ? h('span', { className: 'o2h-demoChip', title: t('homeDemoHint') }, demoStatus) : null),
                h('div', { className: 'o2h-heroLead' },
                  h('h1', { className: 'o2h-heroTitle' },
                    h('span', null, t('homeTitleA')),
                    h('span', { className: 'o2h-grad' }, t('homeTitleB'))),
                  h('p', { className: 'o2h-heroDesc' },
                    t('homeDesc').split('\n').map((line, index) => h('span', {
                      key: index,
                      className: 'o2h-heroDescLine',
                    }, line))))),
              h('div', { className: 'o2h-visual', 'aria-hidden': 'true' },
                h('div', { className: 'o2h-flow' },
                  h('div', { className: 'o2h-flowNode' },
                    h('svg', { className: 'o2h-dbIcon isSource', viewBox: '0 0 64 76', 'aria-hidden': 'true' },
                      h('ellipse', { cx: 32, cy: 13, rx: 25, ry: 9 }),
                      h('path', { d: 'M7 13v48c0 5 11.2 9 25 9s25-4 25-9V13' }),
                      h('path', { d: 'M7 29c0 5 11.2 9 25 9s25-4 25-9' }),
                      h('path', { d: 'M7 45c0 5 11.2 9 25 9s25-4 25-9' })),
                    h('small', null, 'SOURCE')),
                  h('div', { className: 'o2h-flowLine' },
                    h('i', { className: 'o2h-flowDot' }),
                    h('i', { className: 'o2h-flowDot o2h-flowDotDelay' })),
                  h('div', { className: 'o2h-flowEngine' },
                    h('svg', { className: 'o2h-engineOrbitSvg', viewBox: '0 0 132 132', 'aria-hidden': 'true' },
                      h('circle', { className: 'o2h-engineOrbitCircle', cx: 66, cy: 66, r: 64.5 })),
                    h('svg', { className: 'o2h-engineArcSvg', viewBox: '0 0 132 132', 'aria-hidden': 'true' },
                      h('circle', { className: 'o2h-engineArc', cx: 66, cy: 66, r: 57, transform: 'rotate(-90 66 66)' })),
                    h('span', { className: 'o2h-engineBox' }, h(StudioIcon, { name: 'convert', size: 32, strokeWidth: 2.4 })),
                    h('b', null, t('homePipelineEngineTitle')),
                    h('small', null, 'PARSE · TRANSFORM · GENERATE')),
                  h('div', { className: 'o2h-flowLine' },
                    h('i', { className: 'o2h-flowDot' })),
                  h('div', { className: 'o2h-flowNode' },
                    h('svg', { className: 'o2h-dbIcon isTarget', viewBox: '0 0 64 76', 'aria-hidden': 'true' },
                      h('ellipse', { cx: 32, cy: 13, rx: 25, ry: 9 }),
                      h('path', { d: 'M7 13v48c0 5 11.2 9 25 9s25-4 25-9V13' }),
                      h('path', { d: 'M7 29c0 5 11.2 9 25 9s25-4 25-9' }),
                      h('path', { d: 'M7 45c0 5 11.2 9 25 9s25-4 25-9' })),
                    h('small', null, 'TARGET'))))),
            h('section', { className: 'o2h-stats' },
              statCards.map(card => h('article', { key: card.label, className: 'o2h-stat', 'data-tone': card.tone },
                h('div', { className: 'o2h-statTop' },
                  h('span', { className: 'o2h-statIcon' }, h(StudioIcon, { name: card.icon, size: 16 })),
                  h('span', { className: 'o2h-statLabel' }, card.label),
                  h('span', { className: 'o2h-statLive' }, t('homeStatLive'))),
                h('div', { className: 'o2h-statValue' }, card.value),
                h('div', { className: 'o2h-statFoot' },
                  h('span', { className: 'o2h-statFootText' }, card.foot),
                  h(Sparkline, { values: card.spark }))))),
            h('div', { className: 'o2h-main' },
              h('section', { className: 'o2h-card o2h-trendCard' },
                h('header', { className: 'o2h-cardHead' },
                  h('div', { className: 'o2h-cardHeading' },
                    h('h2', { className: 'o2h-cardTitle' }, h(StudioIcon, { name: 'chart', size: 15 }), t('homeTrendTitle')),
                    h('p', { className: 'o2h-cardSub' }, range === '7d' ? t('homeTrendSub') : t('homeTrendSub30d'))),
                  h('div', { className: 'o2h-tabs', role: 'group', 'aria-label': t('homeTrendTitle') },
                    h('button', {
                      type: 'button', className: 'o2h-tab', 'data-active': range === '7d',
                      onClick: () => setRange('7d'),
                    }, t('homeTrend7d')),
                    h('button', {
                      type: 'button', className: 'o2h-tab', 'data-active': range === '30d',
                      onClick: () => setRange('30d'),
                    }, t('homeTrend30d')))),
                h('div', { className: 'o2h-trendBody' },
                  h('div', { className: 'o2h-chartCol' },
                    h(HomeTrendChart, {
                      labels: trend.labels,
                      done: trend.done,
                      review: trend.review,
                      total: trend.total,
                      attempted,
                      demoMode,
                      t,
                      onOpenStudio,
                    }),
                    h('footer', { className: 'o2h-chartFoot' },
                      h('span', { className: 'o2h-legend' },
                        h('i', { className: 'isDone' }),
                        t('homeTrendDone'),
                        h('i', { className: 'isReview' }),
                        t('homeTrendReview')),
                      h('span', { className: 'o2h-chartPeak' }, `${t('homeTrendPeak')} ${trend.peak}`))),
                  h('aside', { className: 'o2h-trendSide' },
                    h('section', { className: 'o2h-sideBlock' },
                      h('span', { className: 'o2h-sideEyebrow' }, t('homeSideTitle')),
                      h('div', { className: 'o2h-sideTiles' },
                        h('div', { className: 'o2h-sideTile' }, h('span', null, t('homeSideTotal')), h('b', null, trend.total)),
                        h('div', { className: 'o2h-sideTile' }, h('span', null, t('homeSidePeak')), h('b', null, trend.peak)),
                        h('div', { className: 'o2h-sideTile' }, h('span', null, t('homeSidePending')), h('b', null, pending)))),
                    h('section', { className: 'o2h-sideRecent' },
                      h('div', { className: 'o2h-sideRecentHead' },
                        h('span', { className: 'o2h-sideEyebrow' }, t('homeSideRecentTitle')),
                        h('span', { className: 'o2h-sideRecentCount' }, String(recentConversions.length))),
                      recentConversions.length === 0
                        ? h('p', { className: 'o2h-sideEmpty' }, t('homeSideRecentEmpty'))
                        : h('div', { className: 'o2h-sideRecentList' }, recentConversions.map(file => h('div', {
                          key: file.id,
                          className: 'o2h-sideRecentRow',
                          title: `${file.name} \u00b7 ${sideTime(file.convertedAt)}`,
                        },
                        h('i', { className: 'o2h-sideDot', 'data-status': file.status === 'ok' ? 'ok' : 'error' }),
                        h('span', { className: 'o2h-sideRecentName' }, file.name),
                        h('span', { className: 'o2h-sideRecentTime' }, sideTime(file.convertedAt)))))),
                    h('button', {
                      type: 'button',
                      className: 'o2h-sideMore',
                      onClick: () => onNavigate('tasks'),
                    }, t('homeSideRecentMore'), h(StudioIcon, { name: 'arrowRight', size: 12 })),
                    h('div', { className: 'o2h-sideActions' },
                      h('span', { className: 'o2h-sideEyebrow' }, t('homeQuickTitle')),
                      h('button', { type: 'button', className: 'o2h-sideAction', onClick: () => onNavigate('tasks') },
                        h(StudioIcon, { name: 'list', size: 13 }), t('navTasks')),
                      h('button', { type: 'button', className: 'o2h-sideAction', onClick: onOpenConnections },
                        h(StudioIcon, { name: 'link', size: 13 }), t('homeConnections'))))))
              ))))
    }

    function StudioPage(props) {
      const { useWorkspaces, convert, collect, archiveOne, t } = props
      const initial = React.useMemo(readStoredState, [])
      const STORE_VERSION = '2.3.5'
      const makeFile = (name, sql = '', origin = 'manual', sourceId = '', taskId = '') => ({
        id: `sql-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        sql,
        result: '',
        status: 'idle',
        note: '',
        origin,
        sourceId,
        taskId,
        objType: '',
        updatedAt: Date.now(),
      })
      const [files, setFiles] = React.useState(() => {
        const storedTasks = loadTasks()
        const storedConns = loadConnections()
        const knownTaskIds = new Set(storedTasks.map(task => task.id))
        const connIds = new Set(storedConns.map(conn => conn.id))
        const stored = Array.isArray(initial.files) ? initial.files : []
        // 不再依赖 filesVersion：升级插件后旧版本保存的文件也继续保留。
        const valid = stored.filter(file => file !== null && typeof file === 'object'
          && typeof file.id === 'string' && typeof file.name === 'string')
        if (valid.length > 0) {
          const byId = new Map()
          for (const file of valid) {
            const storedTaskId = typeof file.taskId === 'string' ? file.taskId : ''
            // 任务已不存在时保留 SQL 并转为本地文件，避免任何历史数据丢失。
            const taskId = storedTaskId === '' || knownTaskIds.has(storedTaskId) ? storedTaskId : ''
            const typedSource = file.origin === 'source' && typeof file.objType === 'string' && file.objType !== ''
            const sourceId = typedSource && connIds.has(file.sourceId) ? file.sourceId : ''
            const sql = typedSource && typeof file.sql === 'string' ? file.sql.trim() : file.sql
            byId.set(file.id, {
              ...makeFile(file.name),
              ...file,
              taskId,
              sql,
              status: file.status === 'warn' ? 'ok' : file.status,
              note: '',
              updatedAt: typeof file.updatedAt === 'number' ? file.updatedAt : undefined,
              origin: (file.origin === 'source' && sourceId === '') ? 'manual' : file.origin,
              sourceId,
            })
          }
          const restored = prunePlaceholders([...byId.values()])
          if (restored.length > 0) return restored
        }
        const firstTask = [...storedTasks].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
        if (firstTask !== undefined) {
          return [{
            ...makeFile(
              'SQL-01.sql',
              '',
              firstTask.origin === 'source' ? 'source' : 'manual',
              firstTask.origin === 'source' ? (firstTask.sourceId ?? '') : '',
              firstTask.id,
            ),
            autoBlank: true,
          }]
        }
        return [makeFile('untitled.sql', '')]
      })
      const filesRef = React.useRef(files)
      filesRef.current = files
      const removedFileIdsRef = React.useRef(new Set())
      /** 已删除任务 id：外部合并时也要过滤，避免旧文件被别的窗口写回。 */
      const deletedTaskIdsRef = React.useRef(new Set())
      const storedRawRef = React.useRef((() => {
        try {
          return typeof window === 'undefined' || !window.localStorage ? null : window.localStorage.getItem(STORAGE_KEY)
        } catch {
          return null
        }
      })())
      /** Fold in files another window/tab persisted meanwhile so a lean snapshot cannot wipe them. */
      const mergeExternalFiles = (list, raw) => {
        let parsed
        try {
          parsed = typeof raw === 'string' ? JSON.parse(raw) : undefined
        } catch {
          return list
        }
        const storedFiles = parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.files) ? parsed.files : []
        if (storedFiles.length === 0) return list
        const byId = new Map()
        for (const file of list) byId.set(file.id, file)
        let changed = false
        for (const file of storedFiles) {
          if (file === null || typeof file !== 'object' || typeof file.id !== 'string') continue
          if (removedFileIdsRef.current.has(file.id)) continue
          if (typeof file.taskId === 'string' && deletedTaskIdsRef.current.has(file.taskId)) continue
          const mine = byId.get(file.id)
          if (mine === undefined) {
            byId.set(file.id, file)
            changed = true
          } else if ((file.updatedAt ?? 0) > (mine.updatedAt ?? 0)) {
            byId.set(file.id, { ...mine, ...file })
            changed = true
          }
        }
        return changed ? [...byId.values()] : list
      }
      const persistFiles = (list) => {
        let storedRaw = null
        try {
          storedRaw = typeof window === 'undefined' || !window.localStorage ? null : window.localStorage.getItem(STORAGE_KEY)
        } catch {
          storedRaw = null
        }
        const next = storedRaw !== null && storedRaw !== storedRawRef.current ? mergeExternalFiles(list, storedRaw) : list
        const written = writeStoredState({ files: next, filesVersion: STORE_VERSION })
        if (typeof written === 'string') storedRawRef.current = written
        return { next, written }
      }
      const commitFiles = (updater) => {
        const current = filesRef.current
        const raw = typeof updater === 'function' ? updater(current) : updater
        if (raw === current) return
        const nextIds = new Set(raw.map(file => file.id))
        for (const file of current) {
          if (!nextIds.has(file.id)) removedFileIdsRef.current.add(file.id)
        }
        const { next, written } = persistFiles(raw)
        filesRef.current = next
        setFiles(next)
        if (written === false) setStatus({ text: t('storageWriteFailed'), kind: 'error' })
      }
      /** 清掉一条文件的转换与执行结果，保留源 SQL。 */
      const clearedFile = (file) => ({
        ...file,
        result: '',
        status: 'idle',
        note: '',
        warnings: undefined,
        applied: undefined,
        durationMs: undefined,
        convertedAt: undefined,
        execStatus: undefined,
        execNote: '',
        execAt: undefined,
        updatedAt: Date.now(),
      })
      /** 任务配置变了（重新获取 / 重新编辑）后，转换与执行结果都作废，步骤条要回到未完成。 */
      const resetTaskProgress = (taskId) => {
        commitFiles(list => {
          let changed = false
          const next = list.map(file => {
            if (file === null || typeof file !== 'object' || file.taskId !== taskId) return file
            if (file.result === '' && file.status === 'idle' && file.execStatus === undefined) return file
            changed = true
            return clearedFile(file)
          })
          return changed ? next : list
        })
      }
      const [activeId, setActiveId] = React.useState(typeof initial.activeId === 'string' ? initial.activeId : '')
      const [query, setQuery] = React.useState('')
      const [schema, setSchema] = React.useState(typeof initial.schema === 'string' ? initial.schema : '')
      const [compat, setCompat] = React.useState(initial.compat !== false)
      const [targetConnId, setTargetConnId] = React.useState(typeof initial.targetConnId === 'string' ? initial.targetConnId : '')
      const [sourceConnId, setSourceConnId] = React.useState(typeof initial.sourceConnId === 'string' ? initial.sourceConnId : '')
      const [convFilter, setConvFilter] = React.useState(typeof initial.convFilter === 'string' ? initial.convFilter : 'all')
      const [readTypes, setReadTypes] = React.useState(() => {
        const stored = initial.readTypes
        if (!Array.isArray(stored)) return OBJECT_TYPES
        const valid = stored.filter(type => ALL_OBJECT_TYPES.includes(type))
        return valid.length === 0 ? OBJECT_TYPES : valid
      })
      const [collapsedTypes, setCollapsedTypes] = React.useState(() => {
        const stored = initial.collapsedTypes
        return Array.isArray(stored) ? stored.filter(type => ALL_OBJECT_TYPES.includes(type)) : []
      })
      const [typeFilter, setTypeFilter] = React.useState(typeof initial.typeFilter === 'string' ? initial.typeFilter : 'all')
      const [connections, setConnections] = React.useState(loadConnections)
      const [connectionsReady, setConnectionsReady] = React.useState(false)
      React.useEffect(() => {
        let active = true
        hydrateConnections(loadConnections())
          .then((list) => {
            if (!active) return
            setConnections(list)
            setConnectionsReady(true)
          })
          .catch(() => {
            if (active) setConnectionsReady(true)
          })
        return () => { active = false }
      }, [])
      const [tasks, setTasks] = React.useState(loadTasks)
      const [activeTaskId, setActiveTaskId] = React.useState(typeof initial.activeTaskId === 'string' ? initial.activeTaskId : '')
      const [wizard, setWizard] = React.useState(null)
      const [connDraft, setConnDraft] = React.useState(null)
      /** 当前新增/编辑的是源库还是目标库（决定可选连接类型）。 */
      const [connSide, setConnSide] = React.useState('target')
      const [connTest, setConnTest] = React.useState(null)
      const [showPassword, setShowPassword] = React.useState(false)
      const [busy, setBusy] = React.useState(null)
      const [reading, setReading] = React.useState(false)
      const [executing, setExecuting] = React.useState(false)
      /** 正在执行到目标库的文件 id（仅用于动画，不落盘）。 */
      const [execFileId, setExecFileId] = React.useState('')
      /**
       * 悬浮 HUD 的「进行中作业」：读取 / 转换 / 执行共用一份记录。
       * 同时写入 localStorage，切到别的界面或重新挂载后仍能恢复显示，并在完成时刷新数据。
       */
      const [job, setJob] = React.useState(() => {
        const stored = readJobState()
        return stored !== null && stored.sessionId === PAGE_SESSION && !jobIsStale(stored) ? stored : null
      })
      const [jobElapsed, setJobElapsed] = React.useState(() => {
        const stored = readJobState()
        if (stored === null || stored.sessionId !== PAGE_SESSION) return 0
        return Math.max(0, Math.round((Date.now() - stored.startedAt) / 1000))
      })
      const jobRef = React.useRef(job)
      jobRef.current = job
      /** 本实例自己发起的作业开始时间；0 表示这份 job 来自别的实例（切走/重挂载后恢复）。 */
      const ownJobRef = React.useRef(0)
      /** 当前作业是否被用户终止；终止后循环不再继续。 */
      const cancelRef = React.useRef(false)
      /** 正在执行的 Host 作业 id，用于 /cancel 终止 Java 进程。 */
      const executeJobIdRef = React.useRef('')
      /** 当前执行请求的 AbortController：终止时立即让前端循环退出。 */
      const executeAbortRef = React.useRef(null)
      /** 执行轮次：终止后旧循环即使晚到也不再更新界面。 */
      const executeRunRef = React.useRef(0)
      /** 终止后短暂忽略其他窗口/旧请求写回的作业状态，避免悬浮条“复活”。 */
      const suppressJobRef = React.useRef(0)
      const VIEWS = ['home', 'studio', 'tasks', 'connections', 'settings']
      const [view, setView] = React.useState(() => (typeof initial.view === 'string' && VIEWS.includes(initial.view) ? initial.view : 'home'))
      const [theme, setTheme] = React.useState(readTheme)
      const [dropStatements, setDropStatements] = React.useState(readDropStatements)
      const [menu, setMenu] = React.useState(null)
      const [renaming, setRenaming] = React.useState(null)
      const renameCancelRef = React.useRef(false)
      const highlightRef = React.useRef(null)
      const [status, setStatus] = React.useState({ text: '', kind: '' })
      /** 统一的应用内确认弹窗（替代 window.confirm），返回 Promise<boolean>。 */
      const [confirmRequest, setConfirmRequest] = React.useState(null)
      const confirmResolveRef = React.useRef(null)
      const askConfirm = (options) => new Promise((resolve) => {
        confirmResolveRef.current = resolve
        setConfirmRequest({ tone: 'danger', confirmLabel: t('confirmOk'), ...options })
      })
      const resolveConfirm = (ok) => {
        const resolve = confirmResolveRef.current
        confirmResolveRef.current = null
        setConfirmRequest(null)
        if (typeof resolve === 'function') resolve(ok)
      }
      React.useEffect(() => {
        if (confirmRequest === null) return undefined
        const onKeyDown = (event) => {
          if (event.key === 'Escape') resolveConfirm(false)
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
      }, [confirmRequest])
      const gutterRef = React.useRef(null)
      const fileInputRef = React.useRef(null)
      const tasksRef = React.useRef(tasks)
      const resumedRef = React.useRef(false)
      const activeSessionRef = React.useRef(undefined)
      const workspaceId = useWorkspaces((state) => {
        const first = state.items[0]
        return first === undefined ? undefined : first.workspaceId
      })
      React.useEffect(() => {
        tasksRef.current = tasks
      }, [tasks])

      /** 从 localStorage 重新灌一遍文件/任务快照；用于「切走再回来」时接上后台已完成的作业。 */
      const refreshStoredSnapshot = () => {
        const stored = readStoredState()
        if (Array.isArray(stored.files)) {
          const valid = stored.files.filter(file => file !== null && typeof file === 'object'
            && typeof file.id === 'string' && typeof file.name === 'string')
          setFiles(valid)
          filesRef.current = valid
        }
        const storedTasks = loadTasks()
        tasksRef.current = storedTasks
        setTasks(storedTasks)
      }
      const beginJob = (kind, patch = {}) => {
        suppressJobRef.current = 0
        const record = {
          kind,
          startedAt: Date.now(),
          heartbeat: Date.now(),
          done: 0,
          total: 0,
          taskId: typeof activeTaskId === 'string' ? activeTaskId : '',
          label: '',
          sessionId: PAGE_SESSION,
          ...patch,
        }
        setJob(record)
        jobRef.current = record
        setJobElapsed(0)
        ownJobRef.current = record.startedAt
        writeJobState(record)
        return record
      }
      const updateJob = (patch) => {
        const base = jobRef.current
        if (base === null) return
        const next = { ...base, ...patch, heartbeat: Date.now() }
        jobRef.current = next
        setJob(next)
        writeJobState(next)
      }
      const endJob = () => {
        if (jobRef.current === null) return
        jobRef.current = null
        setJob(null)
        ownJobRef.current = 0
        writeJobState(null)
      }
      /** 终止当前执行：停掉 Host 侧 Java 进程，并让前端循环退出。 */
      const stopJob = () => {
        executeRunRef.current += 1
        cancelRef.current = true
        requestJobCancel()
        if (executeAbortRef.current !== null) {
          try {
            executeAbortRef.current.abort()
          } catch {
            /* already finished */
          }
          executeAbortRef.current = null
        }
        const jobId = executeJobIdRef.current
          || (jobRef.current !== null && typeof jobRef.current.jobId === 'string' ? jobRef.current.jobId : '')
        executeJobIdRef.current = ''
        suppressJobRef.current = Date.now() + 8000
        if (jobId !== '') {
          fetch('/api/plsql-studio/cancel', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ jobId }),
          }).catch(() => {})
        }
        setExecuting(false)
        setExecFileId('')
        endJob()
        setStatus({ text: t('jobStopped'), kind: '' })
      }
      // 每秒刷新耗时，并跟随落盘进度；作业被别的实例结束时立刻同步数据。
      React.useEffect(() => {
        if (job === null) return undefined
        const timer = setInterval(() => {
          const current = jobRef.current
          const owned = current !== null && ownJobRef.current === current.startedAt
          const stored = readJobState()
          if (stored === null || stored.sessionId !== PAGE_SESSION || jobIsStale(stored)) {
            // 本实例自己发起的作业以内存状态为准：即使 localStorage 写失败，也不能把进度条清掉。
            if (owned) {
              setJobElapsed(Math.max(0, Math.round((Date.now() - current.startedAt) / 1000)))
              return
            }
            writeJobState(null)
            setJob(null)
            refreshStoredSnapshot()
            return
          }
          setJobElapsed(Math.max(0, Math.round((Date.now() - stored.startedAt) / 1000)))
          if (owned) {
            if (stored.startedAt === current.startedAt
              && (stored.done !== current.done || stored.heartbeat !== current.heartbeat)) {
              setJob({ ...current, done: stored.done, heartbeat: stored.heartbeat })
            }
            return
          }
          if (current === null
            || stored.startedAt !== current.startedAt
            || stored.done !== current.done
            || stored.heartbeat !== current.heartbeat) {
            setJob(stored)
          }
        }, 900)
        return () => clearInterval(timer)
      }, [job === null])
      // 别的窗口/标签页发起的作业：空闲时低频探测，一旦发现就接管显示（含完成后的数据刷新）。
      React.useEffect(() => {
        const timer = setInterval(() => {
          if (jobRef.current !== null) return
          if (Date.now() < suppressJobRef.current) return
          const stored = readJobState()
          if (stored === null) return
          if (stored.sessionId !== PAGE_SESSION) {
            writeJobState(null)
            return
          }
          if (jobIsStale(stored)) return
          setJob(stored)
          setJobElapsed(Math.max(0, Math.round((Date.now() - stored.startedAt) / 1000)))
        }, 1500)
        return () => clearInterval(timer)
      }, [])
      // 关闭/刷新页面时终止正在执行的 Host 作业，避免只关窗口却继续在后台跑。
      React.useEffect(() => {
        const onPageHide = () => {
          cancelRef.current = true
          const jobId = executeJobIdRef.current
          if (jobId !== '') {
            executeJobIdRef.current = ''
            try {
              fetch('/api/plsql-studio/cancel', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ jobId }),
                keepalive: true,
              }).catch(() => {})
            } catch {
              /* page is going away */
            }
          }
          writeJobState(null)
        }
        window.addEventListener('pagehide', onPageHide)
        return () => window.removeEventListener('pagehide', onPageHide)
      }, [])

      const contextOf = fileContext
      const inContext = (file, connId) => contextOf(file) === connId
      const typeLabel = (type) => {
        const key = OBJECT_TYPE_LABEL_KEYS[type]
        return key === undefined ? type : t(key)
      }
      const activeTask = tasks.find(task => task.id === activeTaskId)
      const connNameById = (id) => {
        const conn = connections.find(item => item.id === id)
        return conn === undefined ? '' : conn.name
      }
      const contextFiles = activeTask !== undefined
        ? files.filter(file => file.taskId === activeTask.id)
        : []
      /**
       * 源库读取模式下对象只能从源库拉取，不允许手工粘贴 SQL：
       * 自动生成的空占位 SQL（autoBlank）不应出现在对象列表里，否则「还没读取」会显示成一条可编辑的空文件。
       */
      const sourceContext = activeTask !== undefined && activeTask.origin === 'source'
      const displayFiles = sourceContext ? contextFiles.filter(file => !isPlaceholderFile(file)) : contextFiles
      const sourceUnread = sourceContext && displayFiles.length === 0
      const visible = displayFiles.filter(file =>
        (query.trim() === '' || file.name.toLowerCase().includes(query.trim().toLowerCase()))
        && (typeFilter === 'all' || (file.objType ?? '') === typeFilter)
        && (convFilter === 'done' ? file.status === 'ok'
          : convFilter === 'pending' ? file.status === 'idle'
            : true))
      const active = visible.find(file => file.id === activeId)
        ?? visible[0]
        ?? displayFiles.find(file => file.id === activeId)
        ?? displayFiles[0]
        ?? contextFiles.find(file => file.id === activeId)
        ?? contextFiles[0]
        ?? files[0]
      const availableTypes = Array.from(new Set(contextFiles
        .map(file => file.objType)
        .filter(type => typeof type === 'string' && type !== ''))).sort()
      const showWelcome = activeTask === undefined
      const contextReady = activeTask !== undefined
      const hasTarget = targetConnId !== '' && connections.some(conn => conn.id === targetConnId)
      const badgeOf = (file) => {
        const map = {
          TABLE: ['TABLE', 'table'], VIEW: ['VIEW', 'view'], FUNCTION: ['FUNC', 'fn'],
          PROCEDURE: ['PROC', 'proc'], PACKAGE: ['PKG', 'pkg'], 'PACKAGE BODY': ['BODY', 'pkg'],
          TRIGGER: ['TRG', 'trg'], TYPE: ['TYPE', 'type'], SEQUENCE: ['SEQ', 'seq'],
          'MATERIALIZED VIEW': ['MV', 'mv'],
        }
        return map[file.objType] ?? (file.origin === 'source' ? ['OBJ', 'obj'] : ['SQL', 'sql'])
      }
      const startRename = (id) => {
        const file = files.find(item => item.id === id)
        if (file === undefined) return
        renameCancelRef.current = false
        setRenaming({ id, draft: file.name })
      }
      const commitRename = () => {
        if (renaming === null) return
        const id = renaming.id
        const name = renaming.draft.trim()
        setRenaming(null)
        if (name !== '') {
          commitFiles(list => list.map(file => (file.id === id ? { ...file, name, updatedAt: Date.now() } : file)))
        }
      }
      const cancelRename = () => {
        renameCancelRef.current = true
        setRenaming(null)
      }
      const fileRow = (file) => {
        const fileBusy = busy !== null && busy.fileId === file.id
        const fileExec = executing && execFileId === file.id
        const fileActive = fileBusy || fileExec
        return h('div', {
          key: file.id,
          className: `o2p-file${file.id === active.id ? ' o2p-fileActive' : ''}${fileActive ? ' o2p-fileBusy' : ''}`,
          'data-tone': fileExec ? 'exec' : undefined,
          onClick: () => setActiveId(file.id),
          onContextMenu: (event) => {
            event.preventDefault()
            setActiveId(file.id)
            setMenu({
              x: typeof window !== 'undefined' ? Math.min(event.clientX, window.innerWidth - 160) : 0,
              y: typeof window !== 'undefined' ? Math.min(event.clientY, window.innerHeight - 130) : 0,
              fileId: file.id,
            })
          },
        },
        h('span', { className: 'o2p-treeIcon' }, h(StudioIcon, { name: objectTypeIcon(file.objType), size: 14 })),
        renaming !== null && renaming.id === file.id
          ? h('input', {
            className: 'o2p-fileNameInput',
            value: renaming.draft,
            autoFocus: true,
            'aria-label': t('rename'),
            onFocus: (event) => event.target.select(),
            onClick: (event) => event.stopPropagation(),
            onChange: (event) => setRenaming({ id: file.id, draft: event.target.value }),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                commitRename()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                cancelRename()
              }
            },
            onBlur: () => {
              if (renameCancelRef.current) {
                renameCancelRef.current = false
                return
              }
              commitRename()
            },
          })
          : h('span', {
            className: 'o2p-fileName',
            title: file.name,
          }, file.name),
        h('span', {
          className: 'o2p-fileStatus',
          'data-status': file.status,
          'data-busy': fileActive ? 'true' : undefined,
          'data-tone': fileExec ? 'exec' : undefined,
        }, fileActive ? h('i', null) : file.status === 'ok' ? h(StudioIcon, { name: 'check', size: 13 }) : h('i', null)))
      }
      const localGroupHead = visible.length > 0
        ? h('div', { key: 'local-group', className: 'o2p-groupHead' },
          h('span', { className: 'o2p-groupHeadLeft' },
            h('span', { className: 'o2p-groupChevron' }, '\u25be'),
            h(StudioIcon, { name: 'file', size: 13 }),
            h('span', null, t('workbarLocal'))),
          h('span', { className: 'o2p-groupCount' }, String(visible.length)))
        : null
      const groupedByType = activeTask !== undefined && activeTask.origin === 'source'
      const untypedFiles = visible.filter(file => !ALL_OBJECT_TYPES.includes(file.objType))
      const typedBlocks = groupedByType
        ? ALL_OBJECT_TYPES.filter(type => visible.some(file => file.objType === type)).map(type => {
          const group = visible.filter(file => file.objType === type)
          const collapsed = collapsedTypes.includes(type)
          return h(React.Fragment, { key: `group-${type}` },
            h('div', {
              className: 'o2p-groupHead',
              onClick: () => setCollapsedTypes(current => (current.includes(type)
                ? current.filter(item => item !== type)
                : [...current, type])),
            },
            h('span', { className: 'o2p-groupHeadLeft' },
              h('span', { className: 'o2p-groupChevron' }, collapsed ? '\u25b8' : '\u25be'),
              h(StudioIcon, { name: objectTypeIcon(type), size: 13 }),
              h('span', null, type)),
            h('span', { className: 'o2p-groupCount' }, String(group.length))),
            collapsed ? null : group.map(fileRow))
        })
        : []
      const untypedBlock = groupedByType && untypedFiles.length > 0
        ? h(React.Fragment, { key: 'group-untyped' },
          h('div', { className: 'o2p-groupHead' },
            h('span', { className: 'o2p-groupHeadLeft' },
              h('span', { className: 'o2p-groupChevron' }, '\u25be'),
              h(StudioIcon, { name: 'file', size: 13 }),
              h('span', null, t('typeUnspecified'))),
            h('span', { className: 'o2p-groupCount' }, String(untypedFiles.length))),
          untypedFiles.map(fileRow))
        : null
      const fileBlocks = groupedByType
        ? [...typedBlocks, untypedBlock]
        : [localGroupHead, ...visible.map(fileRow)]

      React.useEffect(() => {
        const written = writeStoredState({
          filesVersion: STORE_VERSION,
          activeId: active === undefined ? activeId : active.id,
          schema,
          compat,
          targetConnId,
          sourceConnId,
          activeTaskId,
          view,
          convFilter,
          typeFilter,
          readTypes,
          collapsedTypes,
        })
        if (typeof written === 'string') storedRawRef.current = written
      }, [activeId, schema, compat, targetConnId, sourceConnId, activeTaskId, view, convFilter, typeFilter, readTypes, collapsedTypes])
      React.useEffect(() => {
        if (typeof window === 'undefined' || !window.localStorage) return undefined
        const onStorage = (event) => {
          if (event.key !== STORAGE_KEY || typeof event.newValue !== 'string') return
          storedRawRef.current = event.newValue
          let parsed
          try {
            parsed = JSON.parse(event.newValue)
          } catch {
            return
          }
          const incoming = parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.files) ? parsed.files : []
          if (incoming.length === 0) return
          const byId = new Map()
          for (const file of filesRef.current) byId.set(file.id, file)
          let changed = false
          for (const file of incoming) {
            if (file === null || typeof file !== 'object' || typeof file.id !== 'string') continue
            if (removedFileIdsRef.current.has(file.id)) continue
          if (typeof file.taskId === 'string' && deletedTaskIdsRef.current.has(file.taskId)) continue
            const mine = byId.get(file.id)
            if (mine === undefined) {
              byId.set(file.id, file)
              changed = true
            } else if ((file.updatedAt ?? 0) > (mine.updatedAt ?? 0)) {
              byId.set(file.id, { ...mine, ...file })
              changed = true
            }
          }
          if (!changed) return
          const next = [...byId.values()]
          filesRef.current = next
          setFiles(next)
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
      }, [])
      const busyFileId = busy === null ? null : busy.fileId
      React.useEffect(() => {
        if (busyFileId === null) return undefined
        const timer = setInterval(() => setBusy(current => (current === null
          ? null
          : { ...current, seconds: current.seconds + 1 })), 1000)
        return () => clearInterval(timer)
      }, [busyFileId])

      React.useEffect(() => {
        if (menu === null) return undefined
        const close = () => setMenu(null)
        window.addEventListener('mousedown', close)
        window.addEventListener('keydown', close)
        window.addEventListener('resize', close)
        window.addEventListener('scroll', close, true)
        return () => {
          window.removeEventListener('mousedown', close)
          window.removeEventListener('keydown', close)
          window.removeEventListener('resize', close)
          window.removeEventListener('scroll', close, true)
        }
      }, [menu])

      const wizardOpen = wizard !== null
      React.useEffect(() => {
        if (!wizardOpen) return undefined
        const onKey = (event) => { if (event.key === 'Escape') setWizard(null) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [wizardOpen])

      React.useEffect(() => {
        if (connTest === null || connTest.busy === true) return undefined
        const timer = setTimeout(() => setConnTest(null), 4000)
        return () => clearTimeout(timer)
      }, [connTest])

      const updateFile = (id, patch) => {
        commitFiles(list => list.map(file => (file.id === id ? { ...file, ...patch, updatedAt: Date.now() } : file)))
      }
      const updateActive = (patch) => updateFile(active.id, patch)
      const lineNumbers = (text) => {
        const count = text === '' ? 1 : text.split('\n').length
        return Array.from({ length: count }, (_, index) => index + 1).join('\n')
      }
      const goHome = () => setView('home')
      const openStudio = () => {
        if (activeTaskId === '') {
          const first = [...tasksRef.current].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
          if (first !== undefined) selectTask(first.id)
        }
        setView('studio')
      }
      const openFile = (file) => {
        if (file === null || typeof file !== 'object') {
          setView('studio')
          return
        }
        const fileTaskId = typeof file.taskId === 'string' ? file.taskId : ''
        if (fileTaskId !== '' && tasksRef.current.some(task => task.id === fileTaskId)) selectTask(fileTaskId)
        setActiveId(file.id)
        setView('studio')
      }
      const persistTasks = (list) => {
        tasksRef.current = list
        setTasks(list)
        saveTaskList(list)
      }
      const patchTask = (id, patch) => {
        const next = tasksRef.current.map(task => (task.id === id ? { ...task, ...patch } : task))
        persistTasks(next)
      }
      const openTaskWizard = (task) => {
        const editing = task !== undefined && task !== null
        const sourceId = editing ? (task.sourceId ?? '') : ''
        const wizardSource = connections.find(conn => conn.id === sourceId)
        const allowedTypes = objectTypesFor(wizardSource === undefined ? 'oracle' : wizardSource.kind)
        const seededTypes = (editing && Array.isArray(task.readTypes)
          ? task.readTypes.filter(type => ALL_OBJECT_TYPES.includes(type))
          : readTypes).filter(type => allowedTypes.includes(type))
        const targetId = editing ? (task.targetId ?? '') : ''
        const targetConn = connections.find(conn => conn.id === targetId)
        const seededDialect = editing && task.origin !== 'source'
          ? (['oracle', 'mysql', 'sqlserver'].includes(task.sqlDialect)
            ? task.sqlDialect
            : (looksLikeMysql((files.find(file => file.taskId === task.id) ?? {}).sql ?? '') ? 'mysql' : 'oracle'))
          : 'oracle'
        setWizard({
          editingId: editing ? task.id : '',
          step: 0,
          name: editing ? task.name : '',
          mode: editing && TASK_ORIGINS.includes(task.origin)
            ? (task.origin === 'sql' ? 'local' : task.origin)
            : (connections.some(conn => isSourceKind(conn.kind)) ? 'source' : 'local'),
          sourceId,
          targetId,
          schema: editing && typeof task.schema === 'string' ? task.schema : '',
          compatMode: targetConn === undefined
            ? (editing ? taskCompatMode(task) : 'postgresql')
            : compatModeForKind(targetConn.kind),
          readTypes: seededTypes.length === 0 ? allowedTypes : seededTypes,
          sqlDialect: seededDialect,
          files: [],
          sql: '',
          error: '',
        })
      }
      const applyTaskConfig = (task) => {
        const origin = TASK_ORIGINS.includes(task.origin) ? task.origin : 'local'
        setSourceConnId(origin === 'source' ? (task.sourceId ?? '') : '')
        setTargetConnId(typeof task.targetId === 'string' ? task.targetId : '')
        setSchema(typeof task.schema === 'string' ? task.schema : '')
        setCompat(task.compat !== false)
        const types = Array.isArray(task.readTypes) ? task.readTypes.filter(type => ALL_OBJECT_TYPES.includes(type)) : []
        if (types.length > 0) setReadTypes(types)
      }
      const nextSqlName = (taskId, list) => {
        const pool = Array.isArray(list) ? list : filesRef.current
        const taken = new Set(pool
          .filter(file => (taskId === '' ? file.taskId === '' : file.taskId === taskId))
          .map(file => file.name))
        let index = 1
        let name = `SQL-${String(index).padStart(2, '0')}.sql`
        while (taken.has(name)) {
          index += 1
          name = `SQL-${String(index).padStart(2, '0')}.sql`
        }
        return name
      }
      const blankForTask = (task, list) => {
        const name = nextSqlName(task.id, list)
        return {
          ...makeFile(
            name,
            '',
            task.origin === 'source' ? 'source' : 'manual',
            task.origin === 'source' ? (task.sourceId ?? '') : '',
            task.id,
          ),
          autoBlank: true,
        }
      }
      const selectTask = (id) => {
        setQuery('')
        setTypeFilter('all')
        setConvFilter('all')
        setStatus({ text: '', kind: '' })
        const task = tasksRef.current.find(item => item.id === id)
        if (task === undefined) {
          setActiveTaskId('')
          return
        }
        applyTaskConfig(task)
        setActiveTaskId(task.id)
        const owned = files.filter(file => file.taskId === task.id)
        if (owned.length > 0) {
          setActiveId(owned[0].id)
        } else {
          const blank = blankForTask(task)
          commitFiles(list => (list.some(file => file.taskId === task.id) ? list : [...list, blank]))
          setActiveId(blank.id)
        }
      }
      const openTask = (task) => {
        if (task !== undefined && task !== null) selectTask(task.id)
        setView('studio')
      }
      const bootstrappedRef = React.useRef(false)
      React.useEffect(() => {
        if (bootstrappedRef.current) return
        bootstrappedRef.current = true
        const stored = tasksRef.current.find(task => task.id === activeTaskId)
        if (stored !== undefined) {
          selectTask(stored.id)
          return
        }
        const first = [...tasksRef.current].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
        if (first !== undefined) {
          selectTask(first.id)
          return
        }
        setActiveTaskId('')
      }, [])
      const removeTask = async (task) => {
        if (!(await askConfirm({
          title: t('taskDelete'),
          message: t('taskDeleteConfirm', { name: task.name }),
          confirmLabel: t('delete'),
        }))) return
        deletedTaskIdsRef.current.add(task.id)
        const remaining = tasksRef.current.filter(item => item.id !== task.id)
        persistTasks(remaining)
        commitFiles(list => {
          const next = list.filter(file => file.taskId !== task.id)
          return next.length === 0 ? [makeFile('untitled.sql', '')] : next
        })
        // 删除后的文件若正被选中，回到剩余任务或本地列表，避免界面继续指向已删除的文件。
        const nextActive = filesRef.current.find(file => file.id === activeId)
        if (nextActive === undefined || nextActive.taskId === task.id) setActiveId('')
        if (jobRef.current !== null && jobRef.current.taskId === task.id) endJob()
        if (activeTaskId === task.id) {
          const first = [...remaining].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
          if (first !== undefined) selectTask(first.id)
          else setActiveTaskId('')
        }
      }
      const openNewTask = () => {
        openTaskWizard()
      }

      const newFile = () => {
        const name = activeTask === undefined
          ? `untitled-${files.length + 1}.sql`
          : nextSqlName(activeTask.id)
        const file = makeFile(name, '', sourceConnId === '' ? 'manual' : 'source', sourceConnId, activeTask !== undefined ? activeTask.id : '')
        commitFiles(list => [...list, file])
        setActiveId(file.id)
      }
      const importFile = (event) => {
        const picked = event.target.files && event.target.files[0]
        if (!picked) return
        const reader = new FileReader()
        reader.onload = () => {
          const created = makeFile(picked.name, String(reader.result ?? ''), sourceConnId === '' ? 'manual' : 'source', sourceConnId, activeTask !== undefined ? activeTask.id : '')
          commitFiles(list => [...list, created])
          setActiveId(created.id)
        }
        reader.readAsText(picked)
        event.target.value = ''
      }
      /** 任务下真实对象文件数（不含自动生成的空占位 SQL）。 */
      const countTaskObjects = (taskId) => filesRef.current.filter(file => file !== null
        && typeof file === 'object'
        && file.taskId === taskId
        && !isPlaceholderFile(file)).length
      /** 把 JDBC/Oracle 的原始报错翻译成可操作的中文提示，同时保留原始错误便于排查。 */
      const describeReadError = (raw) => {
        const text = typeof raw === 'string' ? raw : String(raw ?? '')
        const lower = text.toLowerCase()
        if (lower.includes('network adapter could not establish the connection')
          || lower.includes('connection refused')
          || lower.includes('unknownhost')
          || lower.includes('no route to host')
          || lower.includes('connect timed out')
          || lower.includes('connection reset')
          || lower.includes('socket connect')) {
          return t('readConnUnreachable', { detail: text })
        }
        if (lower.includes('ora-01017') || lower.includes('invalid username/password') || lower.includes('login denied')
          || lower.includes('access denied for user')) {
          return t('readAuthFailed', { detail: text })
        }
        if (lower.includes('ora-12505') || lower.includes('ora-12514') || lower.includes('unknown database')) {
          return t('readServiceMissing', { detail: text })
        }
        if (lower.includes('public key retrieval is not allowed')) {
          return t('readMysqlPublicKey', { detail: text })
        }
        return text
      }
      const readSourceObjects = async (connIdArg, options = {}) => {
        const connId = typeof connIdArg === 'string' ? connIdArg : sourceConnId
        const conn = connections.find(item => item.id === connId)
        const taskId = typeof options.taskId === 'string' ? options.taskId : ''
        const connDefaultSchema = conn === undefined
          ? ''
          : (conn.kind === 'mysql' ? conn.database : (conn.schema || conn.user))
        const requestedSchema = typeof options.schema === 'string' ? options.schema.trim() : ''
        // 任务里可能残留连接修改前的系统库名（如 mysql）；优先用连接当前的默认库，避免读取系统对象。
        const readSchema = requestedSchema === '' || isSystemSchema(requestedSchema)
          ? connDefaultSchema
          : requestedSchema
        if (conn === undefined) {
          setStatus({ text: t('readSourceMissing'), kind: 'error' })
          return
        }
        if (!isSourceKind(conn.kind)) {
          setStatus({ text: t('readUnsupported', { engine: engineLabel(conn.kind) }), kind: 'error' })
          return
        }
        const allowedTypes = objectTypesFor(conn.kind)
        const types = (Array.isArray(options.types) && options.types.length > 0 ? options.types : readTypes)
          .filter(type => allowedTypes.includes(type))
        if (types.length === 0) {
          setStatus({ text: t('taskNeedTypes'), kind: 'error' })
          return
        }
        if (reading) return
        setReading(true)
        setStatus({ text: t('reading'), kind: '' })
        beginJob('read', {
          taskId,
          total: 0,
          label: [conn.name, readSchema].filter(Boolean).join(' \u00b7 '),
        })
        const previousTask = taskId !== '' ? tasksRef.current.find(item => item.id === taskId) : undefined
        const previousStatus = previousTask === undefined || previousTask.status === 'reading'
          ? 'new'
          : previousTask.status
        if (taskId !== '') {
          patchTask(taskId, { status: 'reading', updatedAt: Date.now() })
          // 重新获取期间保留该任务下已有的对象 SQL：读取成功后再整体替换，失败则原样保留。
          // 不在请求前先清空，避免请求失败/页面中断后任务详情只剩一个空占位 SQL、而任务中心还显示旧对象数。
        }
        try {
          const response = await fetch('/api/plsql-studio/read-objects', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              kind: conn.kind,
              host: conn.host,
              port: Number(conn.port),
              database: conn.database,
              user: conn.user,
              password: conn.password ?? '',
              schema: readSchema,
              limit: 500,
              types,
            }),
          })
          const value = await response.json().catch(() => ({}))
          if (!response.ok || value.ok !== true) {
            if (taskId !== '') {
              patchTask(taskId, {
                status: previousStatus,
                objectCount: countTaskObjects(taskId),
                updatedAt: Date.now(),
              })
            }
            setStatus({ text: describeReadError((value && value.message) || `HTTP ${response.status}`), kind: 'error' })
            return
          }
          const objects = Array.isArray(value.objects) ? value.objects : []
          const created = objects.map(object => ({
            ...makeFile(`${object.name}.sql`, ensureTerminator(object.ddl), 'source', connId, taskId),
            objType: typeof object.type === 'string' ? object.type : '',
          }))
          commitFiles(list => {
            const selected = new Set(types)
            // 重新获取＝整任务重建：先删掉该任务下的所有文件（含手工导入/粘贴的 SQL），再用新对象填充。
            const kept = list.filter(file => (taskId !== ''
              ? file.taskId !== taskId
              : !(inContext(file, connId) && selected.has(file.objType))))
            const next = [...kept, ...created]
            if (next.every(file => !inContext(file, connId))) {
              next.push({ ...makeFile('untitled.sql', '', 'source', connId, taskId), autoBlank: true })
            }
            return prunePlaceholders(next)
          })
          if (created.length > 0) setActiveId(created[0].id)
          if (taskId !== '') patchTask(taskId, {
            status: 'ready',
            objectCount: created.length,
            lastReadAt: Date.now(),
            updatedAt: Date.now(),
            readTypes: types,
            schema: readSchema,
          })
          setStatus({ text: taskId === '' ? t('readObjects', { count: created.length }) : t('taskReadDone', { count: created.length }), kind: 'ok' })
        } catch (error) {
          if (taskId !== '') {
            patchTask(taskId, {
              status: previousStatus,
              objectCount: countTaskObjects(taskId),
              updatedAt: Date.now(),
            })
          }
          setStatus({ text: describeReadError(error && error.message ? error.message : String(error)), kind: 'error' })
        } finally {
          setReading(false)
          endJob()
        }
      }

      const wiz = (patch) => setWizard(current => (current === null ? current : { ...current, ...patch, error: '' }))
      const setWizardMode = (mode) => setWizard((current) => {
        if (current === null) return current
        const lastStep = mode === 'source' ? 2 : 1
        return { ...current, mode, step: Math.min(current.step, lastStep), error: '' }
      })
      const closeWizard = () => setWizard(null)
      const wizardError = (key) => setWizard(current => (current === null ? current : { ...current, error: t(key) }))
      const wizardStepsOf = (draft) => (draft !== null && draft.mode === 'source'
        ? [t('taskStepBasic'), t('taskStepTypes'), t('taskStepCompat')]
        : [t('taskStepBasic'), t('taskStepCompat')])
      const wizardStepError = (draft, index) => {
        if (index === 0) {
          if (draft.name.trim() === '') return 'taskNeedName'
          if (draft.mode === 'source' && draft.sourceId === '') return 'taskNeedSource'
          return ''
        }
        if (draft.mode === 'source' && index === 1 && draft.readTypes.length === 0) return 'taskNeedTypes'
        return ''
      }
      const wizardNext = () => {
        if (wizard === null) return
        const key = wizardStepError(wizard, wizard.step)
        if (key !== '') {
          wizardError(key)
          return
        }
        const total = wizard.mode === 'source' ? 3 : 2
        wiz({ step: Math.min(total - 1, wizard.step + 1) })
      }
      const wizardBack = () => setWizard(current => (current === null
        ? current
        : { ...current, step: Math.max(0, current.step - 1), error: '' }))
      const saveWizardTask = () => {
        if (wizard === null) return
        const key = wizardStepError(wizard, 0) || wizardStepError(wizard, 1)
        if (key !== '') {
          wizardError(key)
          return
        }
        const now = Date.now()
        const editing = wizard.editingId !== ''
        const taskId = editing
          ? wizard.editingId
          : `task-${now}-${Math.random().toString(36).slice(2, 6)}`
        const previous = tasksRef.current.find(task => task.id === taskId)
        const readTypesForTask = wizard.mode === 'source'
          ? wizard.readTypes
          : []
        const taskOrigin = wizard.mode === 'source'
          ? 'source'
          : (previous !== undefined && previous.origin === 'sql' ? 'sql' : 'local')
        const taskSource = wizard.mode === 'source' ? connections.find(conn => conn.id === wizard.sourceId) : undefined
        const targetForTask = wizard.targetId !== '' ? connections.find(conn => conn.id === wizard.targetId) : undefined
        // 选目标库时兼容模式锁定为目标库对应的模式；未选目标库时用向导里单选的模式（默认 PostgreSQL）。
        const taskCompatModeValue = targetForTask !== undefined
          ? compatModeForKind(targetForTask.kind)
          : (COMPAT_MODES.includes(wizard.compatMode) ? wizard.compatMode : 'postgresql')
        // MySQL 源固定按 HGDB 标准写法转换，不保留 Oracle 写法。
        const taskCompat = taskOrigin === 'source' && taskSource !== undefined && taskSource.kind === 'mysql'
          ? false
          : taskCompatModeValue === 'oracle'
        const task = {
          id: taskId,
          name: wizard.name.trim(),
          origin: taskOrigin,
          sourceId: wizard.mode === 'source' ? wizard.sourceId : '',
          targetId: wizard.targetId,
          schema: wizard.schema.trim(),
          compat: taskCompat,
          compatMode: taskCompatModeValue,
          sqlDialect: wizard.mode === 'local' ? (wizard.sqlDialect ?? 'oracle') : '',
          readTypes: readTypesForTask,
          status: previous === undefined ? 'new' : (previous.status === 'reading' ? 'new' : previous.status),
          objectCount: previous === undefined ? 0 : (previous.objectCount ?? 0),
          createdAt: previous === undefined ? now : (previous.createdAt ?? now),
          updatedAt: now,
        }
        const configChanged = previous !== undefined && (
          (previous.origin ?? '') !== task.origin
          || (previous.sourceId ?? '') !== task.sourceId
          || (previous.targetId ?? '') !== task.targetId
          || (previous.schema ?? '') !== task.schema
          || taskCompatMode(previous) !== task.compatMode
          || (previous.sqlDialect ?? '') !== task.sqlDialect
          || (previous.readTypes ?? []).join('|') !== task.readTypes.join('|')
        )
        if (configChanged) resetTaskProgress(taskId)
        if (editing) persistTasks(tasksRef.current.map(item => (item.id === taskId ? task : item)))
        else persistTasks([task, ...tasksRef.current])
        setWizard(null)
        setActiveTaskId(taskId)
        setQuery('')
        setTypeFilter('all')
        setConvFilter('all')
        setTargetConnId(task.targetId)
        setSchema(task.schema)
        setCompat(task.compat)
        setSourceConnId(task.origin === 'source' ? task.sourceId : '')
        if (task.readTypes.length > 0) setReadTypes(task.readTypes)
        setView('studio')
        if (task.origin === 'source') {
          commitFiles(list => (list.some(file => file.taskId === task.id)
            ? list
            : [...list, blankForTask(task, list)]))
          const sourceChanged = previous === undefined
            || previous.sourceId !== task.sourceId
            || previous.schema !== task.schema
            || (previous.readTypes ?? []).join('|') !== task.readTypes.join('|')
          if (sourceChanged) {
            setStatus({ text: t('taskReadStarted', { name: task.name }), kind: '' })
            readSourceObjects(task.sourceId, { taskId: task.id, types: task.readTypes, schema: task.schema })
          } else {
            setStatus({ text: t('taskSaved'), kind: 'ok' })
          }
          return
        }
        if (!files.some(file => file.taskId === taskId)) {
          const blank = blankForTask(task)
          commitFiles(list => [...list, blank])
          setActiveId(blank.id)
        }
        setStatus({ text: t('taskSaved'), kind: 'ok' })
      }
      const renderTaskWizard = () => {
        if (wizard === null) return null
        const steps = wizardStepsOf(wizard)
        const step = Math.min(wizard.step, steps.length - 1)
        const sourceConns = connections.filter(conn => isSourceKind(conn.kind))
        const targetConns = connections.filter(conn => isTargetKind(conn.kind))
        const sourceName = sourceConns.find(conn => conn.id === wizard.sourceId)
        const targetName = targetConns.find(conn => conn.id === wizard.targetId)
        /** 当前源库引擎决定可选对象类型与兼容模式提示。 */
        const wizardSourceKind = sourceName === undefined ? 'oracle' : sourceName.kind
        const wizardTargetKind = targetName === undefined ? '' : targetName.kind
        const wizardTypes = objectTypesFor(wizardSourceKind)
        const wizardIsMysql = wizardSourceKind === 'mysql'
        const field = (label, control) => h('div', { className: 'o2h-field' },
          h('span', { className: 'o2h-fieldLabel' }, label),
          control)
        const modeCard = (mode, icon, title, hint) => h('button', {
          type: 'button',
          className: 'o2h-modeCard',
          'data-active': wizard.mode === mode ? 'true' : undefined,
          onClick: () => setWizardMode(mode),
        },
        h('span', { className: 'o2h-modeCardIcon' }, h(StudioIcon, { name: icon, size: 16 })),
        h('b', null, title),
        h('small', null, hint))
        const summaryRow = (label, value) => h('div', { className: 'o2h-summaryRow' },
          h('span', { className: 'o2h-summaryLabel' }, label),
          h('span', { className: 'o2h-summaryValue', title: typeof value === 'string' ? value : undefined }, value))
        const originText = wizard.mode === 'source'
          ? (sourceName === undefined ? t('taskSourcePlaceholder') : sourceName.name)
          : (wizard.files.length === 0 && wizard.sql.trim() !== '' ? t('taskOriginSql') : t('taskOriginLocal'))
        const summaryTypes = wizard.mode === 'source'
          ? (wizard.readTypes.length === 0
            ? '\u2014'
            : `${wizard.readTypes.length === 1 ? t('taskTypesOne') : t('taskTypesCount', { count: wizard.readTypes.length })} \u00b7 ${wizard.readTypes.map(typeLabel).join(' / ')}`)
          : t('taskTypesNotNeeded')
        const basicBody = h(React.Fragment, null,
          field(t('taskName'), h('input', {
            className: 'o2h-input',
            type: 'text',
            value: wizard.name,
            placeholder: t('taskNamePlaceholder'),
            autoFocus: true,
            onChange: (event) => wiz({ name: event.target.value }),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                wizardNext()
              }
            },
          })),
          field(t('taskOrigin'), h('div', { className: 'o2h-modeGrid' },
            modeCard('source', 'database', t('taskOriginSource'), t('taskOriginSourceHint')),
            modeCard('local', 'file', t('taskOriginLocal'), t('taskOriginLocalHint')))),
          wizard.mode === 'local'
            ? field(t('taskSqlDialect'), h(StudioSelect, {
              value: wizard.sqlDialect,
              options: [
                { value: 'oracle', label: 'Oracle' },
                { value: 'mysql', label: 'MySQL' },
                { value: 'sqlserver', label: 'SQL Server' },
              ],
              onChange: (next) => wiz({ sqlDialect: next }),
            }))
            : null,
          wizard.mode === 'source'
            ? field(t('taskSource'), sourceConns.length === 0
              ? h('div', { className: 'o2h-wizardInline' },
                h('span', null, t('taskNoSourceConn')),
                h('button', {
                  type: 'button',
                  className: 'o2h-linkBtn',
                  onClick: () => { setWizard(null); openConnections() },
                }, t('taskGoConnections')))
              : h(StudioSelect, {
                value: wizard.sourceId,
                options: [
                  { value: '', label: t('taskSourcePlaceholder') },
                  ...sourceConns.map(conn => ({ value: conn.id, label: `${conn.name} (${engineLabel(conn.kind)})` })),
                ],
                onChange: (next) => {
                  const picked = sourceConns.find(conn => conn.id === next)
                  const allowed = objectTypesFor(picked === undefined ? 'oracle' : picked.kind)
                  const nextTypes = wizard.readTypes.filter(type => allowed.includes(type))
                  wiz({
                    sourceId: next,
                    schema: wizard.schema.trim() === '' && picked !== undefined
                      ? (picked.schema || (picked.kind === 'mysql' ? picked.database : ''))
                      : wizard.schema,
                    readTypes: nextTypes.length === 0 ? allowed : nextTypes,
                  })
                },
              }))
            : null,
          field(t('taskTargetOptional'), targetConns.length === 0
            ? h('div', { className: 'o2h-wizardInline' },
              h('span', null, t('taskNoTargetConn')),
              h('button', {
                type: 'button',
                className: 'o2h-linkBtn',
                onClick: () => { setWizard(null); openConnections() },
              }, t('taskGoConnections')))
            : h(StudioSelect, {
              value: wizard.targetId,
              options: [
                { value: '', label: t('taskTargetPlaceholder') },
                ...targetConns.map(conn => ({ value: conn.id, label: `${conn.name} (${engineLabel(conn.kind)})` })),
              ],
              onChange: (next) => {
                const picked = targetConns.find(conn => conn.id === next)
                wiz({
                  targetId: next,
                  compatMode: picked === undefined ? 'postgresql' : compatModeForKind(picked.kind),
                })
              },
            })),
          field(t('taskSchema'), h('input', {
            className: 'o2h-input',
            type: 'text',
            value: wizard.schema,
            placeholder: t('schemaHint'),
            onChange: (event) => wiz({ schema: event.target.value }),
          })))
        const typesBody = h(React.Fragment, null,
          h('div', { className: 'o2h-field' },
            h('span', { className: 'o2h-fieldLabel' }, t('taskTypesTitle')),
            h('p', { className: 'o2h-wizardHint' }, wizardIsMysql ? t('taskTypesHintMysql') : t('taskTypesHint'))),
          h('div', { className: 'o2h-typeGrid' }, wizardTypes.map(type => h('label', {
            key: type,
            className: 'o2h-typeTile',
            'data-checked': wizard.readTypes.includes(type) ? 'true' : undefined,
          },
          h('input', {
            type: 'checkbox',
            checked: wizard.readTypes.includes(type),
            onChange: (event) => wiz({
              readTypes: event.target.checked
                ? [...new Set([...wizard.readTypes, type])]
                : wizard.readTypes.filter(item => item !== type),
            }),
          }),
          h('span', { className: 'o2h-typeTileIcon' }, h(StudioIcon, { name: objectTypeIcon(type), size: 15 })),
          h('span', { className: 'o2h-typeTileText' },
            h('b', null, typeLabel(type)),
            h('small', null, type))))),
          h('div', { className: 'o2h-typeActions' },
            h('button', { type: 'button', className: 'o2h-linkBtn', onClick: () => wiz({ readTypes: wizardTypes }) }, t('selectAll')),
            h('button', { type: 'button', className: 'o2h-linkBtn', onClick: () => wiz({ readTypes: [] }) }, t('clearAll')),
            h('span', { className: 'o2h-typeActionsCount' }, wizard.readTypes.length === 1 ? t('taskTypesOne') : t('taskTypesCount', { count: wizard.readTypes.length }))))
        const compatLockedMode = wizardTargetKind === '' ? '' : compatModeForKind(wizardTargetKind)
        const compatMode = compatLockedMode !== ''
          ? compatLockedMode
          : (COMPAT_MODES.includes(wizard.compatMode) ? wizard.compatMode : 'postgresql')
        const compatLocked = compatLockedMode !== ''
        const compatOption = (mode) => h('label', {
          key: mode,
          className: 'o2h-compatOption',
          'data-checked': compatMode === mode ? 'true' : undefined,
          'data-disabled': compatLocked ? 'true' : undefined,
        },
        h('input', {
          type: 'radio',
          name: 'o2h-compat-mode',
          value: mode,
          checked: compatMode === mode,
          disabled: compatLocked,
          onChange: () => wiz({ compatMode: mode }),
        }),
        h('span', { className: 'o2h-compatText' },
          h('b', null, t(COMPAT_MODE_KEYS[mode])),
          h('small', null, t(`${COMPAT_MODE_KEYS[mode]}Hint`))))
        const compatBody = h(React.Fragment, null,
          wizardIsMysql && !compatLocked
            ? h('p', { className: 'o2h-wizardHint' }, t('taskCompatMysqlNote'))
            : h('div', { className: 'o2h-field' },
              h('span', { className: 'o2h-fieldLabel' }, t('taskCompatModeTitle')),
              h('div', { className: 'o2h-compatGrid', 'data-locked': compatLocked ? 'true' : undefined },
                COMPAT_MODES.map(compatOption)),
              h('p', { className: 'o2h-wizardHint' }, compatLocked ? t('taskCompatLocked') : t('taskCompatUnlockedHint')),
              wizardIsMysql
                ? h('p', { className: 'o2h-wizardHint' }, t('taskCompatMysqlNote'))
                : null),
          h('div', { className: 'o2h-field' },
            h('span', { className: 'o2h-fieldLabel' }, t('taskSummary')),
            h('div', { className: 'o2h-summary' },
              summaryRow(t('taskSummaryOrigin'), originText),
              wizard.mode === 'local'
                ? summaryRow(t('taskSqlDialect'), wizard.sqlDialect === 'mysql' ? 'MySQL' : wizard.sqlDialect === 'sqlserver' ? 'SQL Server' : 'Oracle')
                : null,
              summaryRow(t('taskSummaryTarget'), targetName === undefined ? '\u2014' : targetName.name),
              summaryRow(t('taskSummarySchema'), wizard.schema.trim() === '' ? t('taskSchemaInherit') : wizard.schema.trim()),
              summaryRow(t('taskSummaryTypes'), summaryTypes),
              summaryRow(t('taskSummaryCompat'), t(COMPAT_MODE_KEYS[compatMode])))))
        const body = step === 0 ? basicBody : (wizard.mode === 'source' && step === 1) ? typesBody : compatBody
        const lastStep = steps.length - 1
        return h('div', { className: 'o2h-wizardOverlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('taskWizardTitle') },
          h('div', { className: 'o2h-wizard' },
            h('header', { className: 'o2h-wizardHead' },
              h('div', { className: 'o2h-wizardHeading' },
                h('h2', { className: 'o2h-wizardTitle' }, wizard.editingId === '' ? t('taskWizardTitle') : t('taskWizardEditTitle')),
                h('p', { className: 'o2h-wizardSub' }, t('taskWizardSub'))),
              h('button', {
                type: 'button',
                className: 'o2h-iconBtn',
                title: t('cancel'),
                onClick: closeWizard,
              }, h(StudioIcon, { name: 'close', size: 15 }))),
            h('div', { className: 'o2h-wizardSteps' }, steps.map((label, index) => h('div', {
              key: label,
              className: 'o2h-wizardStep',
              'data-state': index < step ? 'done' : index === step ? 'active' : 'todo',
            },
            h('span', { className: 'o2h-wizardStepNo' }, index < step ? '\u2713' : String(index + 1)),
            h('span', { className: 'o2h-wizardStepLabel' }, label),
            index < lastStep ? h('span', { className: 'o2h-wizardStepLine' }) : null))),
            h('div', { className: 'o2h-wizardBody' }, body),
            h('footer', { className: 'o2h-wizardFoot' },
              wizard.error === '' ? h('span', { className: 'o2h-wizardFootHint' }) : h('span', { className: 'o2h-wizardError', role: 'alert' }, wizard.error),
              h('button', { type: 'button', className: 'o2h-ctaSecondary', onClick: closeWizard }, t('cancel')),
              step > 0
                ? h('button', { type: 'button', className: 'o2h-ctaSecondary', onClick: wizardBack }, t('taskBack'))
                : null,
              step < lastStep
                ? h('button', { type: 'button', className: 'o2h-ctaPrimary', onClick: wizardNext }, t('taskNext'))
                : h('button', { type: 'button', className: 'o2h-ctaPrimary', onClick: saveWizardTask }, wizard.editingId === '' ? t('taskSave') : t('taskSaveEdit'))),
            ))
      }

      const deleteFile = async (id) => {
        const file = files.find(item => item.id === id)
        if (file === undefined) return
        if (!(await askConfirm({ title: `${t('delete')} ${file.name}?`, confirmLabel: t('delete') }))) return
        const next = files.filter(item => item.id !== id)
        const inBucket = (item) => activeTask !== undefined && item.taskId === activeTask.id
        const sameBucket = next.filter(inBucket)
        if (sameBucket.length === 0) {
          if (activeTask !== undefined) {
            const blank = blankForTask(activeTask, next)
            commitFiles([...next, blank])
            setActiveId(blank.id)
            return
          }
          const first = [...tasksRef.current].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]
          commitFiles(next)
          if (first !== undefined) {
            selectTask(first.id)
          } else {
            setActiveTaskId('')
            setActiveId('')
          }
          return
        }
        commitFiles(next)
        if (active === undefined || !sameBucket.some(item => item.id === active.id)) setActiveId(sameBucket[0].id)
      }
      const deleteActive = () => deleteFile(active.id)
      const closeMenu = () => setMenu(null)
      const menuFile = menu === null ? undefined : files.find(file => file.id === menu.fileId)
      const menuConvert = () => {
        const target = menuFile
        closeMenu()
        if (target !== undefined) convertFiles([target])
      }
      const menuDelete = () => {
        const target = menu
        closeMenu()
        if (target !== null) deleteFile(target.fileId)
      }
      const menuRename = () => {
        const target = menu
        closeMenu()
        if (target !== null) startRename(target.fileId)
      }
      const menuRefetch = () => {
        closeMenu()
        if (activeTask === undefined || activeTask.origin !== 'source') return
        readSourceObjects(activeTask.sourceId, {
          taskId: activeTask.id,
          types: activeTask.readTypes,
          schema: activeTask.schema,
        })
      }
      const copySql = () => {
        copyText(active.sql).then(
          () => setStatus({ text: t('copied'), kind: 'ok' }),
          () => setStatus({ text: t('copyFailed'), kind: 'error' }),
        )
      }
      const copyResult = () => {
        if (active.result === '') return
        copyText(active.result).then(
          () => setStatus({ text: t('copied'), kind: 'ok' }),
          () => setStatus({ text: t('copyFailed'), kind: 'error' }),
        )
      }
      const saveBlob = (blob, filename) => {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = filename
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      const exportFiles = (list) => {
        const ready = list.filter(file => file.result !== '')
        if (ready.length === 0) return
        if (ready.length === 1) {
          const file = ready[0]
          saveBlob(
            new Blob([file.result], { type: 'text/plain;charset=utf-8' }),
            `${file.name.replace(/\.sql$/i, '')}.converted.sql`,
          )
          return
        }
        const taken = new Set()
        const entries = ready.map((file) => {
          const base = `${file.name.replace(/\.sql$/i, '') || 'query'}.converted.sql`
          let name = base
          let suffix = 2
          while (taken.has(name)) {
            name = base.replace(/\.sql$/i, `-${suffix}.sql`)
            suffix += 1
          }
          taken.add(name)
          return { name, text: file.result }
        })
        const taskName = activeTask === undefined || typeof activeTask.name !== 'string' ? '' : activeTask.name.trim()
        const zipName = `${(taskName === '' ? 'converted' : taskName).replace(/[\\/:*?"<>|]/g, '_')}.zip`
        saveBlob(buildZipBlob(entries), zipName)
        setStatus({ text: t('exportZipDone', { count: entries.length, name: zipName }), kind: 'ok' })
      }
      /**
       * 本地转换：按批让出主线程，边转边把每行结果刷成「已完成」，
       * 这样转换过程能看到进度条、扫描线与逐行高亮，而不是一次性瞬间刷新。
       */
      /** 文件所属源库引擎；没有绑定连接时按 SQL 特征判断。 */
      const fileEngine = (file) => {
        const taskDialect = activeTask !== undefined && activeTask.origin !== 'source'
          ? activeTask.sqlDialect
          : ''
        if (taskDialect === 'oracle' || taskDialect === 'mysql' || taskDialect === 'sqlserver') return taskDialect
        const id = typeof file.sourceId === 'string' && file.sourceId !== ''
          ? file.sourceId
          : (activeTask !== undefined && activeTask.origin === 'source' ? activeTask.sourceId : '')
        const conn = connections.find(item => item.id === id)
        if (conn !== undefined) return conn.kind === 'mysql' ? 'mysql' : 'oracle'
        return looksLikeMysql(file.sql) ? 'mysql' : 'oracle'
      }
      /** 目标是否为 HGDB-V9-MySQL（MySQL 兼容模式，采用最小改写）。 */
      const targetConnForConvert = connections.find(conn => conn.id === (
        (activeTask !== undefined && typeof activeTask.targetId === 'string' ? activeTask.targetId : '') || targetConnId
      ))
      const conversionTarget = targetConnForConvert !== undefined && targetConnForConvert.kind === 'hgdb-mysql'
        ? 'mysql'
        : 'pg'
      const convertFiles = async (list) => {
        if (reading) return
        const targets = list.filter(file => file.sql.trim() !== '')
        if (targets.length === 0) {
          setStatus({ text: t('needInput'), kind: 'error' })
          return
        }
        if (busy !== null) return
        const targetIds = new Set(targets.map(file => file.id))
        commitFiles(current => current.map(file => (targetIds.has(file.id)
          ? {
            ...file,
            result: '',
            status: 'idle',
            note: '',
            applied: undefined,
            warnings: undefined,
            durationMs: undefined,
            convertedAt: undefined,
          }
          : file)))
        const startedAll = Date.now()
        setBusy({ fileId: targets[0].id, seconds: 0 })
        setStatus({ text: '', kind: '' })
        beginJob('convert', {
          taskId: activeTaskId,
          total: targets.length,
          label: activeTask === undefined ? '' : activeTask.name,
        })
        let ok = 0
        let failed = 0
        const CHUNK = 8
        try {
          for (let index = 0; index < targets.length; index += CHUNK) {
            const slice = targets.slice(index, index + CHUNK)
            setBusy({ fileId: slice[0].id, seconds: Math.round((Date.now() - startedAll) / 1000) })
            updateJob({ done: ok + failed })
            // 让出一帧：让上面的忙碌动画先画出来，再继续算。
            await new Promise(resolve => setTimeout(resolve, 0))
            const patches = new Map()
            for (const file of slice) {
              const startedAt = Date.now()
              try {
                if (fileEngine(file) === 'sqlserver') {
                  patches.set(file.id, {
                    status: 'error',
                    note: t('sqlserverNeedsAi'),
                    applied: [],
                    warnings: [],
                    durationMs: 0,
                    convertedAt: Date.now(),
                    updatedAt: Date.now(),
                  })
                  failed += 1
                  continue
                }
                const local = convertLocally(file.sql, { compat, engine: fileEngine(file), drop: dropStatements, target: conversionTarget })
                if (local.unsupported === true) {
                  patches.set(file.id, {
                    result: local.text,
                    status: 'error',
                    note: t('mysqlRoutineNeedsAi'),
                    applied: [],
                    warnings: local.warnings,
                    durationMs: Date.now() - startedAt,
                    convertedAt: Date.now(),
                    updatedAt: Date.now(),
                  })
                  failed += 1
                  continue
                }
                patches.set(file.id, {
                  result: local.text,
                  status: 'ok',
                  note: '',
                  applied: local.applied,
                  warnings: local.warnings,
                  durationMs: Date.now() - startedAt,
                  convertedAt: Date.now(),
                  updatedAt: Date.now(),
                })
                ok += 1
              } catch (error) {
                patches.set(file.id, {
                  status: 'error',
                  note: error && error.message ? error.message : String(error),
                  applied: [],
                  warnings: [],
                  durationMs: Date.now() - startedAt,
                  convertedAt: Date.now(),
                  updatedAt: Date.now(),
                })
                failed += 1
              }
            }
            commitFiles(current => current.map(file => (patches.has(file.id)
              ? { ...file, ...patches.get(file.id) }
              : file)))
            patches.forEach((patch, id) => patchStoredFile(id, patch))
            updateJob({ done: ok + failed })
          }
        } finally {
          setBusy(null)
          endJob()
        }
        setStatus({
          text: failed === 0 ? t('convertDone') : `${t('convertDone')} \u00b7 ${failed} ${t('needsReview')}`,
          kind: failed === 0 ? 'ok' : 'error',
        })
      }
      const convertActive = () => convertFiles([active])
      const convertAll = () => convertFiles(visible)
      const exportActive = () => exportFiles([active])
      const exportAll = () => exportFiles(visible)
      const executeFiles = async (list) => {
        if (executing) return
        if (activeTask === undefined) {
          setStatus({ text: t('execNeedsTask'), kind: 'error' })
          return
        }
        const conn = connections.find(item => item.id === targetConnId)
        if (conn === undefined) {
          setStatus({ text: t('execMissing'), kind: 'error' })
          return
        }
        const targets = list.filter(file => file.result.trim() !== '')
        if (targets.length === 0) {
          setStatus({ text: t('execNoSql'), kind: 'error' })
          return
        }
        setExecuting(true)
        cancelRef.current = false
        executeRunRef.current += 1
        const runId = executeRunRef.current
        const executeJobId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        executeJobIdRef.current = executeJobId
        const startedStamp = Date.now()
        const cancelRequested = () => cancelRef.current || readJobCancelStamp() >= startedStamp
        beginJob('execute', { taskId: activeTaskId, total: targets.length, label: conn.name, jobId: executeJobId })
        let ok = 0
        let failed = 0
        let executed = 0
        let firstError = ''
        const runOne = async (file) => {
          const controller = typeof AbortController === 'function' ? new AbortController() : null
          executeAbortRef.current = controller
          try {
            const response = await fetch('/api/plsql-studio/execute', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              credentials: 'include',
              signal: controller === null ? undefined : controller.signal,
              body: JSON.stringify({
                kind: conn.kind,
                host: conn.host,
                port: Number(conn.port),
                database: conn.database,
                user: conn.user,
                password: conn.password ?? '',
                jobId: executeJobId,
                sql: `${schema.trim() === '' ? '' : `SET search_path TO ${schema.trim()};\n`}${file.result}`,
              }),
            })
            const value = await response.json().catch(() => ({}))
            if (response.ok && value.ok === true) return { ok: true, error: '' }
            const output = typeof value.output === 'string' ? value.output : ''
            const errorLine = output.split('\n').find(line => line.includes('ERROR')) ?? output.split('\n').find(line => line.trim() !== '')
            return { ok: false, error: (errorLine && errorLine.trim()) || (value && value.message) || `HTTP ${response.status}` }
          } catch (error) {
            return { ok: false, error: error && error.message ? error.message : String(error) }
          }
        }
        const failedFiles = []
        for (const file of targets) {
          if (cancelRequested()) {
            cancelRef.current = true
            break
          }
          setExecFileId(file.id)
          const outcome = await runOne(file)
          if (runId !== executeRunRef.current) return
          if (cancelRequested()) {
            cancelRef.current = true
            const patch = { execStatus: 'error', execNote: t('jobStopped'), execAt: Date.now() }
            updateFile(file.id, patch)
            patchStoredFile(file.id, patch)
            break
          }
          const patch = {
            execStatus: outcome.ok ? 'ok' : 'error',
            execNote: outcome.error || '',
            execAt: Date.now(),
          }
          updateFile(file.id, patch)
          patchStoredFile(file.id, patch)
          executed += 1
          updateJob({ done: executed })
          if (outcome.ok) ok += 1
          else {
            failed += 1
            failedFiles.push(file)
            if (firstError === '') firstError = outcome.error
          }
        }
        if (failedFiles.length > 0 && !cancelRequested()) {
          await new Promise(resolve => setTimeout(resolve, 150))
          for (const file of failedFiles) {
            setExecFileId(file.id)
            const outcome = await runOne(file)
            if (runId !== executeRunRef.current) return
            if (cancelRequested()) {
              cancelRef.current = true
              break
            }
            const patch = {
              execStatus: outcome.ok ? 'ok' : 'error',
              execNote: outcome.error || '',
              execAt: Date.now(),
            }
            updateFile(file.id, patch)
            patchStoredFile(file.id, patch)
            if (outcome.ok) {
              ok += 1
              failed -= 1
            } else if (firstError === '') {
              firstError = outcome.error
            }
          }
        }
        if (runId !== executeRunRef.current) return
        const stopped = cancelRef.current
        cancelRef.current = false
        executeJobIdRef.current = ''
        executeAbortRef.current = null
        setExecuting(false)
        setExecFileId('')
        endJob()
        setStatus(stopped
          ? { text: t('jobStopped'), kind: '' }
          : {
            text: `${t('execDone')} ${ok} / ${failed}${firstError === '' ? '' : ` \u00b7 ${firstError}`}`,
            kind: failed > 0 ? 'error' : 'ok',
          })
      }

      const deepConvert = () => {
        if (busy !== null || active.sql.trim() === '') return
        const fileId = active.id
        const startedAt = Date.now()
        setBusy({ fileId, seconds: 0 })
        setStatus({ text: '', kind: '' })
        beginJob('convert', { taskId: activeTaskId, total: 1, label: active.name })
        updateFile(fileId, {
          result: '',
          status: 'idle',
          note: '',
          applied: undefined,
          warnings: undefined,
          durationMs: undefined,
          convertedAt: undefined,
        })
        const engineOfActive = fileEngine(active)
        const prompt = buildSinglePrompt({ sql: active.sql, objectType: 'auto', schema, compat, engine: engineOfActive, drop: dropStatements, target: conversionTarget })
        Promise.resolve(convert(prompt, workspaceId, fileId)).then((outcome) => {
          setBusy(null)
          if (outcome && outcome.ok) {
            const converted = onlineConversionResult(outcome.text, {
              compat: engineOfActive === 'mysql' ? false : compat,
              sourceSql: active.sql,
            })
            const patch = {
              result: converted.text,
              status: 'ok',
              note: '',
              applied: [],
              warnings: (engineOfActive === 'mysql' ? MYSQL_WARNINGS : LOCAL_WARNINGS)
                .filter(warning => warning.pattern !== null && warning.pattern.test(converted.text))
                .map(warning => warning.id),
              durationMs: Date.now() - startedAt,
              convertedAt: Date.now(),
              updatedAt: Date.now(),
            }
            updateFile(fileId, patch)
            patchStoredFile(fileId, patch)
            setStatus({ text: converted.keptSource ? t('onlineCompatKept') : t('convertDone'), kind: 'ok' })
            return
          }
          const failPatch = {
            status: 'error',
            note: (outcome && outcome.message) || t('convertFailed'),
            applied: [],
            warnings: [],
            durationMs: Date.now() - startedAt,
            convertedAt: Date.now(),
            updatedAt: Date.now(),
          }
          updateFile(fileId, failPatch)
          patchStoredFile(fileId, failPatch)
          setStatus({ text: (outcome && outcome.message) || t('convertFailed'), kind: 'error' })
        }).catch((error) => {
          setBusy(null)
          setStatus({ text: error && error.message ? error.message : String(error), kind: 'error' })
        }).finally(() => {
          clearInflight()
          endJob()
        })
      }

      React.useEffect(() => {
        if (resumedRef.current) return
        const inflight = inflightState()
        if (inflight === undefined) return
        resumedRef.current = true
        const target = files.find(file => file.id === inflight.fileId) ?? files[0]
        activeSessionRef.current = inflight.sessionId
        setBusy({ fileId: target.id, seconds: 0 })
        Promise.resolve(collect(inflight.sessionId)).then((outcome) => {
          setBusy(null)
          if (outcome && outcome.ok) {
            const resumeEngine = target !== undefined && looksLikeMysql(target.sql) ? 'mysql' : 'oracle'
            const converted = onlineConversionResult(outcome.text, {
              compat: resumeEngine === 'mysql' ? false : compat,
              sourceSql: target.sql,
            })
            const patch = {
              result: converted.text,
              status: 'ok',
              applied: [],
              warnings: (resumeEngine === 'mysql' ? MYSQL_WARNINGS : LOCAL_WARNINGS)
                .filter(warning => warning.pattern !== null && warning.pattern.test(converted.text))
                .map(warning => warning.id),
              convertedAt: Date.now(),
              updatedAt: Date.now(),
            }
            updateFile(target.id, patch)
            patchStoredFile(target.id, patch)
          } else {
            const patch = { status: 'error', note: (outcome && outcome.message) || '', convertedAt: Date.now(), updatedAt: Date.now() }
            updateFile(target.id, patch)
            patchStoredFile(target.id, patch)
          }
        }).catch(() => setBusy(null)).finally(() => {
          clearInflight()
        })
      }, [])

      const openConnections = () => {
        setConnDraft(null)
        setConnTest(null)
        setShowPassword(false)
        setView('connections')
      }
      const toggleTheme = () => {
        setTheme((current) => {
          const next = current === 'dark' ? 'light' : 'dark'
          saveTheme(next)
          return next
        })
      }
      const navigate = (next) => {
        if (next === 'connections') {
          openConnections()
          return
        }
        if (next === 'studio') {
          openStudio()
          return
        }
        setView(['home', 'tasks', 'settings'].includes(next) ? next : 'home')
      }
      const startNewConn = (side = 'target') => {
        const kind = side === 'source' ? 'oracle' : 'hgdb'
        setConnSide(side)
        setConnTest(null)
        setShowPassword(false)
        setConnDraft({
          id: `conn-${Date.now()}`,
          name: '',
          kind,
          host: 'localhost',
          port: defaultPortFor(kind),
          database: '',
          user: '',
          password: '',
          schema: '',
        })
      }
      const saveConn = async () => {
        if (connDraft === null) return
        const port = Number(connDraft.port)
        if (connDraft.name.trim() === '' || connDraft.host.trim() === '' || !Number.isInteger(port) || port <= 0 || port > 65535) {
          setStatus({ text: t('needInput'), kind: 'error' })
          return
        }
        const { passwordUnreadable, passwordSaved, ...draft } = connDraft
        // 刚保存的密码在下一次编辑时同样算“已保存”，不再显示小眼睛。
        const savedDraft = typeof draft.password === 'string' && draft.password !== ''
          ? { ...draft, passwordSaved: true }
          : draft
        // MySQL 的 schema 就是数据库名，表单里不再单独维护。
        if (draft.kind === 'mysql' || draft.kind === 'hgdb-mysql') savedDraft.schema = ''
        const exists = connections.some(item => item.id === draft.id)
        const previousConn = connections.find(item => item.id === draft.id)
        const defaultSchemaOf = (conn) => {
          if (conn === undefined || conn === null) return ''
          if (conn.kind === 'mysql' || conn.kind === 'hgdb-mysql') return conn.database
          return conn.schema || conn.user
        }
        const oldDefaultSchema = defaultSchemaOf(previousConn)
        const newDefaultSchema = defaultSchemaOf(savedDraft)
        const next = exists
          ? connections.map(item => (item.id === draft.id ? savedDraft : item))
          : [...connections, savedDraft]
        setConnections(next)
        const persisted = await persistConnections(next)
        // 连接默认库变了：把仍沿用旧默认库（或系统库）的源库任务同步到新库。
        if (previousConn !== undefined && newDefaultSchema !== '' && oldDefaultSchema !== newDefaultSchema) {
          const synced = tasksRef.current.map(task => {
            if (task.origin !== 'source' || task.sourceId !== draft.id) return task
            const current = typeof task.schema === 'string' ? task.schema.trim() : ''
            if (current === '' || current === oldDefaultSchema || isSystemSchema(current)) {
              return { ...task, schema: newDefaultSchema, updatedAt: Date.now() }
            }
            return task
          })
          if (synced.some((task, index) => task !== tasksRef.current[index])) persistTasks(synced)
        }
        setConnDraft(null)
        setShowPassword(false)
        setStatus(persisted
          ? { text: t('connSaved'), kind: 'ok' }
          : { text: t('connSavedMemoryOnly'), kind: 'error' })
      }
      const removeConn = async (id) => {
        const target = connections.find(item => item.id === id)
        if (!(await askConfirm({
          title: t('connDelete'),
          message: target === undefined ? `${t('connDelete')}?` : `${t('connDelete')} ${target.name}?`,
          confirmLabel: t('connDelete'),
        }))) return
        const next = connections.filter(item => item.id !== id)
        setConnections(next)
        await persistConnections(next)
      }
      const testConn = async () => {
        if (connDraft === null) return
        setConnTest({ busy: true, kind: '', text: t('connTesting') })
        try {
          const response = await fetch('/api/plsql-studio/test', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              kind: connDraft.kind,
              host: connDraft.host,
              port: Number(connDraft.port),
              database: connDraft.database,
              user: connDraft.user,
              password: connDraft.password ?? '',
            }),
          })
          const value = await response.json().catch(() => ({}))
          if (!response.ok || value.ok !== true) {
            const rawMessage = (value && value.message) || `HTTP ${response.status}`
            // 旧 Host 不认识 MySQL / HGDB-V9-MySQL 类型，会退回 PostgreSQL 驱动并报协议错误。
            const staleHost = (connDraft.kind === 'mysql' || connDraft.kind === 'hgdb-mysql')
              && /org\.postgresql|PSQLException|postgresql/i.test(String(rawMessage))
            setConnTest({
              busy: false,
              kind: 'error',
              text: staleHost
                ? '连接测试用到了 PostgreSQL 驱动：Host 侧插件仍是旧版本。请完全退出并重启 DSH（只刷新页面不够），重新打开后再测试连接。'
                : rawMessage,
            })
            return
          }
          const detail = typeof value.output === 'string' && value.output !== '' ? `\n${value.output}` : ''
          setConnTest({
            busy: false,
            kind: 'ok',
            text: value.ok === true ? (value.message || 'OK') : `${value.message || 'OK'}${detail}`,
          })
        } catch (error) {
          setConnTest({ busy: false, kind: 'error', text: error && error.message ? error.message : String(error) })
        }
      }

      const targetConn = connections.find(item => item.id === targetConnId)
      const connKindLabel = (kind) => {
        if (kind === 'oracle') return t('connKindOracle')
        if (kind === 'mysql') return t('connKindMysql')
        if (kind === 'hgdb-oracle') return t('connKindHgdbOracle')
        if (kind === 'hgdb-mysql') return t('connKindHgdbMysql')
        return t('connKindHgdbPostgresql')
      }
      const connField = (id, label, control) => h('div', { className: 'o2p-connField' },
        h('label', { className: 'o2p-label', htmlFor: id }, label),
        control)
      const connRow = (conn) => h('div', { key: conn.id, className: 'o2p-conn o2h-connRow' },
        h('div', { className: 'o2p-connMain' },
          h('span', { className: 'o2p-connName' }, conn.name),
          h('span', { className: 'o2p-connMeta' }, `${connKindLabel(conn.kind)} \u00b7 ${conn.host}:${conn.port}/${conn.database}`),
          conn.schema ? h('span', { className: 'o2p-connMeta' }, `schema: ${conn.schema}`) : null),
        h('div', { className: 'o2p-connActions' },
          h('button', {
            type: 'button',
            className: 'o2p-ghost',
            disabled: !connectionsReady,
            onClick: () => {
              setConnSide(isSourceKind(conn.kind) ? 'source' : 'target')
              setConnTest(null)
              setShowPassword(false)
              setConnDraft({ ...conn })
            },
          }, t('connEdit')),
          h('button', { type: 'button', className: 'o2p-ghost', onClick: () => removeConn(conn.id) }, t('connDelete'))))
      const emptyColumn = (text) => h('p', { className: 'o2h-connEmptyCol' }, text)
      const connColumn = (side, title, hint, icon, items) => h('section', {
        className: 'o2h-card o2h-connColumn',
        'data-side': side,
      },
      h('div', { className: 'o2h-connColumnHead' },
        h('div', { className: 'o2h-connColumnTitle' },
          h(StudioIcon, { name: icon, size: 15 }),
          h('b', null, title),
          h('span', { className: 'o2h-connCount' }, String(items.length))),
        h('button', {
          type: 'button',
          className: 'o2h-ctaSecondary o2h-connAddBtn',
          onClick: () => startNewConn(side),
        }, h(StudioIcon, { name: 'plus', size: 12 }), t('connAdd'))),
      h('p', { className: 'o2h-connColumnHint' }, hint),
      h('div', { className: 'o2h-connColumnBody' },
        items.length === 0
          ? emptyColumn(side === 'source' ? t('connEmptySource') : t('connEmptyTarget'))
          : items.map(connRow)))
      const sourceConnections = connections.filter(conn => isSourceKind(conn.kind))
      const targetConnections = connections.filter(conn => isTargetKind(conn.kind))
      const connectionsBody = h('div', { className: 'o2h-connGrid' },
        connColumn('source', t('connSourceTitle'), t('connSourceHint'), 'download', sourceConnections),
        connColumn('target', t('connTargetTitle'), t('connTargetHint'), 'play', targetConnections))
      const passwordTyping = connDraft !== null
        && connDraft.passwordSaved !== true
        && (connDraft.password ?? '') !== ''
      const mysqlConnection = connDraft !== null && (connDraft.kind === 'mysql' || connDraft.kind === 'hgdb-mysql')
      const connFields = connDraft === null ? null : h(React.Fragment, null,
        h('div', { className: 'o2p-connRow' },
          connField('conn-name', t('connName'), h('input', {
            id: 'conn-name', className: 'o2p-input', type: 'text', value: connDraft.name,
            onChange: (event) => setConnDraft({ ...connDraft, name: event.target.value }),
          })),
          connField('conn-kind', t('connKind'), h(StudioSelect, {
            id: 'conn-kind',
            className: 'o2p-select',
            value: connDraft.kind,
            options: connSide === 'source'
              ? [
                { value: 'oracle', label: t('connKindOracle') },
                { value: 'mysql', label: t('connKindMysql') },
              ]
              : [
                { value: 'hgdb', label: t('connKindHgdbPostgresql') },
                { value: 'hgdb-oracle', label: t('connKindHgdbOracle') },
                { value: 'hgdb-mysql', label: t('connKindHgdbMysql') },
              ],
            onChange: (next) => setConnDraft({
              ...connDraft,
              kind: next,
              port: defaultPortFor(next),
              schema: next === 'mysql' || next === 'hgdb-mysql' ? '' : connDraft.schema,
            }),
          }))),
        h('div', { className: 'o2p-connRow' },
          connField('conn-host', t('connHost'), h('input', {
            id: 'conn-host', className: 'o2p-input', type: 'text', value: connDraft.host,
            onChange: (event) => setConnDraft({ ...connDraft, host: event.target.value }),
          })),
          connField('conn-port', t('connPort'), h('input', {
            id: 'conn-port', className: 'o2p-input', type: 'text', value: connDraft.port,
            onChange: (event) => setConnDraft({ ...connDraft, port: event.target.value }),
          }))),
        h('div', { className: `o2p-connRow${mysqlConnection ? ' o2p-connRowSingle' : ''}` },
          connField('conn-database', connDraft.kind === 'hgdb-mysql' ? t('connSchemaForMysql') : t('connDatabase'), h('input', {
            id: 'conn-database', className: 'o2p-input', type: 'text', value: connDraft.database,
            onChange: (event) => setConnDraft({ ...connDraft, database: event.target.value }),
          })),
          mysqlConnection
            ? null
            : connField('conn-schema', t('connSchema'), h('input', {
              id: 'conn-schema', className: 'o2p-input', type: 'text', value: connDraft.schema,
              placeholder: connDraft.kind === 'oracle' || connDraft.kind === 'hgdb-oracle' ? t('connSchemaOwnerPlaceholder') : t('connSchemaPlaceholder'),
              onChange: (event) => setConnDraft({ ...connDraft, schema: event.target.value }),
            }))),
        h('div', { className: 'o2p-connRow' },
          connField('conn-user', t('connUser'), h('input', {
            id: 'conn-user', className: 'o2p-input', type: 'text', value: connDraft.user,
            onChange: (event) => setConnDraft({ ...connDraft, user: event.target.value }),
          })),
          connField('conn-password', t('connPassword'), h('div', null,
            h('div', { className: 'o2p-passwordWrap' },
              h('input', {
                id: 'conn-password',
                className: `o2p-input${passwordTyping ? ' o2p-passwordInput' : ''}`,
                type: passwordTyping && showPassword ? 'text' : 'password',
                name: 'plsql-connection-password',
                autoComplete: 'new-password',
                title: connDraft.passwordSaved === true ? t('passwordSavedHint') : undefined,
                value: connDraft.password ?? '',
                onFocus: (event) => {
                  if (connDraft.passwordSaved === true) event.target.select()
                },
                onChange: (event) => setConnDraft({
                  ...connDraft,
                  password: event.target.value,
                  passwordSaved: false,
                  passwordUnreadable: false,
                }),
              }),
              passwordTyping
                ? h('button', {
                  type: 'button',
                  className: 'o2p-eyeBtn',
                  title: showPassword ? t('hidePassword') : t('showPassword'),
                  'aria-label': showPassword ? t('hidePassword') : t('showPassword'),
                  'aria-pressed': showPassword ? 'true' : 'false',
                  onClick: () => setShowPassword(current => !current),
                }, h(StudioIcon, { name: showPassword ? 'eyeOff' : 'eye', size: 15 }))
                : null),
            connDraft.passwordUnreadable
              ? h('p', { className: 'o2p-connNote' }, t('passwordUnreadable'))
              : null))))
      const closeConn = () => {
        setConnDraft(null)
        setConnTest(null)
        setShowPassword(false)
      }
      // 测试结果用悬浮提示展示，几秒后自动消失。
      React.useEffect(() => {
        if (connTest === null || connTest.busy === true) return undefined
        const timer = setTimeout(() => setConnTest(null), 3200)
        return () => clearTimeout(timer)
      }, [connTest])
      const connEditing = connDraft !== null && connections.some(item => item.id === connDraft.id)
      const connDialogTitle = `${connEditing ? t('connEditTitle') : t('connAdd')} · ${connSide === 'source' ? t('connSourceTitle') : t('connTargetTitle')}`
      const connDialog = connDraft === null ? null : renderOverlay(h('div', {
        className: 'o2h-wizardOverlay o2p-connOverlay',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': connDialogTitle,
      },
      h('div', { className: 'o2h-wizard o2p-connDialog' },
        h('header', { className: 'o2h-wizardHead' },
          h('div', { className: 'o2h-wizardHeading' },
            h('h2', { className: 'o2h-wizardTitle' }, connDialogTitle),
            h('p', { className: 'o2h-wizardSub' }, t('connDialogSub'))),
          h('button', {
            type: 'button',
            className: 'o2h-iconBtn',
            title: t('cancel'),
            onClick: closeConn,
          }, h(StudioIcon, { name: 'close', size: 15 }))),
        connTest !== null && connTest.busy !== true
          ? h('div', {
            className: 'o2h-connToast',
            'data-kind': connTest.kind,
            role: 'status',
            title: connTest.text,
          },
          h(StudioIcon, { name: connTest.kind === 'ok' ? 'check' : 'alert', size: 14 }),
          h('span', { className: 'o2h-connToastText' }, connTest.text.replace(/\s+/g, ' ').slice(0, 180)))
          : null,
        h('div', { className: 'o2h-wizardBody o2p-connDialogBody' },
          connFields),
        h('div', { className: 'o2h-wizardFoot' },
          h('button', {
            type: 'button',
            className: `o2h-ctaSecondary${connTest !== null && connTest.busy === true ? ' o2p-btnBusy' : ''}`,
            disabled: connTest !== null && connTest.busy === true,
            onClick: testConn,
          }, connTest !== null && connTest.busy === true ? t('connTesting') : t('connTest')),
          h('span', { className: 'o2h-wizardFootHint' }),
          h('button', { type: 'button', className: 'o2h-ctaSecondary', onClick: closeConn }, t('connCancel')),
          h('button', { type: 'button', className: 'o2h-ctaPrimary', onClick: saveConn }, t('connSave'))))), theme)

      const connectionsPage = h('div', { className: 'o2h o2h-connPage' },
        h('main', { className: 'o2h-scroll' },
          h('div', { className: 'o2h-inner o2h-connInner' },
            h('header', { className: 'o2h-connHero' },
              h('div', { className: 'o2h-connHeroRow' },
                h('div', { className: 'o2h-connHeroText' },
                  h('h1', { className: 'o2h-connTitle' }, t('connectionsTitle')),
                  h('p', { className: 'o2h-connDesc' }, t('connectionsPageDesc'))))),
            connectionsBody)),
        connDialog)

      const applyTheme = (next) => {
        setTheme(next)
        saveTheme(next)
      }
      const clearFetchedSql = async () => {
        if (!(await askConfirm({
          title: t('settingsClearFetched'),
          message: t('settingsClearFetchedConfirm'),
          confirmLabel: t('settingsCleanupAction'),
        }))) return
        commitFiles(list => list.filter(file => file.origin !== 'source'))
        persistTasks(tasksRef.current.map(task => (task.origin === 'source'
          ? { ...task, objectCount: 0, status: 'new', lastReadAt: undefined, updatedAt: Date.now() }
          : task)))
        setActiveId('')
        setStatus({ text: t('settingsClearedFetched'), kind: 'ok' })
      }
      const clearConvertedResults = async () => {
        if (!(await askConfirm({
          title: t('settingsClearConverted'),
          message: t('settingsClearConvertedConfirm'),
          confirmLabel: t('settingsCleanupAction'),
        }))) return
        commitFiles(list => list.map(file => ({
          ...file,
          result: '',
          status: 'idle',
          note: '',
          applied: undefined,
          warnings: undefined,
          durationMs: undefined,
          convertedAt: undefined,
          execStatus: undefined,
          execNote: '',
          execAt: undefined,
          updatedAt: Date.now(),
        })))
        setStatus({ text: t('settingsClearedConverted'), kind: 'ok' })
      }
      const settingsRow = (label, hint, control) => h('div', { className: 'o2h-settingsRow' },
        h('div', { className: 'o2h-settingsLabel' },
          h('b', null, label),
          hint === '' ? null : h('small', null, hint)),
        control)
      const settingsCard = (title, icon, rows) => h('section', { className: 'o2h-card o2h-settingsCard' },
        h('div', { className: 'o2h-cardHead' },
          h('div', { className: 'o2h-cardHeading' },
            h('h2', { className: 'o2h-cardTitle' }, h(StudioIcon, { name: icon, size: 14 }), title))),
        h('div', { className: 'o2h-settingsBody' }, rows))
      const fetchedSqlCount = files.filter(file => file.origin === 'source' && !isPlaceholderFile(file)).length
      const convertedResultCount = files.filter(file => typeof file.result === 'string' && file.result.trim() !== '').length
      const settingsPage = h('div', { className: 'o2h o2h-settingsPage' },
        h('main', { className: 'o2h-scroll' },
          h('div', { className: 'o2h-inner o2h-settingsInner' },
            h('header', { className: 'o2h-pageHead o2h-settingsHead' },
              h('div', { className: 'o2h-pageHeading' },
                h('h1', { className: 'o2h-pageTitle' }, t('settingsTitle')),
                h('p', { className: 'o2h-pageDesc' }, t('settingsDesc')))),
            settingsCard(t('settingsAppearance'), 'sun', [
              settingsRow(t('settingsTheme'), t('settingsThemeHint'),
                h('div', { className: 'o2h-themeSwitch' },
                  h('button', {
                    type: 'button',
                    'data-active': theme === 'light' ? 'true' : undefined,
                    onClick: () => applyTheme('light'),
                  }, t('settingsThemeLight')),
                  h('button', {
                    type: 'button',
                    'data-active': theme === 'dark' ? 'true' : undefined,
                    onClick: () => applyTheme('dark'),
                  }, t('settingsThemeDark')))),
            ]),
            settingsCard(t('settingsConvertOptions'), 'bolt', [
              settingsRow(t('settingsDropTitle'), t('settingsDropHint'),
                h('label', { className: 'o2h-toggle' },
                  h('input', {
                    type: 'checkbox',
                    checked: dropStatements,
                    onChange: (event) => {
                      const next = event.target.checked
                      setDropStatements(next)
                      saveDropStatements(next)
                    },
                  }),
                  h('span', { className: 'o2h-toggleTrack' }, h('i', null)),
                  h('span', { className: 'o2h-toggleText' },
                    dropStatements ? t('settingsOn') : t('settingsOff')))),
            ]),
            settingsCard(t('settingsData'), 'database', [
              settingsRow(t('settingsClearFetched'), t('settingsClearFetchedHint'),
                h('button', {
                  type: 'button',
                  className: 'o2h-ctaSecondary o2h-settingsBtn',
                  onClick: clearFetchedSql,
                }, `${t('settingsCleanupAction')}（${fetchedSqlCount}）`)),
              settingsRow(t('settingsClearConverted'), t('settingsClearConvertedHint'),
                h('button', {
                  type: 'button',
                  className: 'o2h-ctaSecondary o2h-settingsBtn',
                  onClick: clearConvertedResults,
                }, `${t('settingsCleanupAction')}（${convertedResultCount}）`)),
            ]),
            settingsCard(t('settingsAbout'), 'shield', [
              settingsRow(t('settingsVersion'), '', h('b', { className: 'o2h-settingsValue' }, PLUGIN_VERSION)),
            ]))))

      const busyHere = busy !== null && busy.fileId === active.id
      const execHere = executing && execFileId === active.id
      const hudJob = job
      /** 读取 / 转换 / 执行进行中：整页按钮与输入锁定，只允许顶部导航切换视图。 */
      const busyLock = reading || busy !== null || executing || job !== null
      const hudTitle = hudJob === null
        ? ''
        : hudJob.kind === 'read' ? t('jobReadTitle') : hudJob.kind === 'execute' ? t('jobExecuteTitle') : t('jobConvertTitle')
      const hudMeta = hudJob === null
        ? ''
        : hudJob.total > 0
          ? t('jobProgress', { done: Math.min(hudJob.done, hudJob.total), total: hudJob.total })
          : (hudJob.label || t('reading'))
      const hudPercent = hudJob !== null && hudJob.total > 0
        ? Math.max(6, Math.min(100, Math.round((hudJob.done / hudJob.total) * 100)))
        : 0
      const hudIcon = hudJob === null ? 'bolt' : hudJob.kind === 'read' ? 'download' : hudJob.kind === 'execute' ? 'play' : 'bolt'
      const hudRestored = hudJob !== null && hudJob.startedAt !== ownJobRef.current
      const confirmDialog = confirmRequest === null ? null : renderOverlay(h('div', {
        className: 'o2h-wizardOverlay o2h-confirmOverlay',
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-label': confirmRequest.title,
        onClick: (event) => {
          if (event.target === event.currentTarget) resolveConfirm(false)
        },
      },
      h('div', { className: 'o2h-confirm' },
        h('h3', { className: 'o2h-confirmTitle' }, confirmRequest.title),
        confirmRequest.message
          ? h('p', { className: 'o2h-confirmText' }, confirmRequest.message)
          : null,
        h('div', { className: 'o2h-confirmActions' },
          h('button', {
            type: 'button',
            className: 'o2h-ctaSecondary',
            onClick: () => resolveConfirm(false),
          }, t('cancel')),
          h('button', {
            type: 'button',
            className: `o2h-ctaPrimary${confirmRequest.tone === 'danger' ? ' o2h-confirmDanger' : ''}`,
            onClick: () => resolveConfirm(true),
          }, confirmRequest.confirmLabel ?? t('confirmOk'))))), theme)
      const hudLayers = hudJob === null ? null : h('div', { className: 'o2p-hudLayer' },
        h('div', {
          className: 'o2p-hud',
          'data-kind': hudJob.kind,
          'data-restored': hudRestored ? 'true' : undefined,
          role: 'status',
          'aria-live': 'polite',
        },
        h('span', { className: 'o2p-hudAura', 'aria-hidden': 'true' }),
        h('span', { className: 'o2p-hudOrb', 'aria-hidden': 'true' },
          h('span', { className: 'o2p-hudRing' }),
          h('span', { className: 'o2p-hudRing o2p-hudRingB' }),
          h(StudioIcon, { name: hudIcon, size: 18 })),
        h('div', { className: 'o2p-hudText' },
          h('b', null, hudTitle),
          h('small', { title: hudRestored ? t('jobRestoredHint') : undefined }, hudMeta)),
        hudJob.kind === 'read'
          ? h('span', { className: 'o2p-hudBar isIndeterminate' }, h('i', null))
          : h('span', { className: 'o2p-hudBar' }, h('i', { style: { width: `${hudPercent}%` } })),
        h('span', { className: 'o2p-hudTimer' }, `${jobElapsed}s`),
        hudJob.kind === 'execute'
          ? h('button', {
            type: 'button',
            className: 'o2p-hudStop',
            title: t('jobStop'),
            'aria-label': t('jobStop'),
            onClick: stopJob,
          })
          : null))
      const resultStatus = busyHere
        ? `${t('converting')} \u00b7 ${busy.seconds}s`
        : active.status === 'ok' ? t('convertDone')
          : active.status === 'error' ? (active.note || t('convertFailed'))
            : t('statusReady')
      const statusKind = busyHere ? 'idle' : active.status
      const doneCount = visible.filter(file => file.status === 'ok').length

      const pageShell = (title, desc, actions, body) => h('div', { className: 'o2h o2h-page' },
        h('main', { className: 'o2h-scroll' },
          h('div', { className: 'o2h-inner o2h-pageInner' },
            h('header', { className: 'o2h-pageHead' },
              h('div', { className: 'o2h-pageHeading' },
                h('h1', { className: 'o2h-pageTitle' }, title),
                h('p', { className: 'o2h-pageDesc' }, desc)),
              actions === null ? null : h('div', { className: 'o2h-pageActions' }, actions)),
            body)))

      const workFiles = files.filter(file => !isPlaceholderFile(file))
      const taskStatusMeta = {
        done: { icon: 'check', key: 'homeStatusDone', tone: 'done' },
        running: { icon: 'sync', key: 'homeStatusRunning', tone: 'running' },
        pending: { icon: 'clock', key: 'homeStatusPending', tone: 'pending' },
        error: { icon: 'alert', key: 'homeStatusError', tone: 'error' },
      }
      const demoTasksPage = [
        {
          id: 'demo-task-erp', file: null, name: t('homeDemoTask1'), meta: t('homeDemoMeta1'), types: [], status: 'done', progress: 100, time: t('homeTimeMinutes', { count: 2 }),
          steps: [
            { key: 'fetch', label: t('taskStepFetch'), hint: t('taskStepFetchHint'), icon: 'download', state: 'done' },
            { key: 'convert', label: t('taskStepConvert'), hint: t('taskStepConvertHint'), icon: 'bolt', state: 'done' },
            { key: 'execute', label: t('taskStepExecute'), hint: t('taskStepExecuteHint'), icon: 'play', state: 'done' },
          ],
        },
        {
          id: 'demo-task-finance', file: null, name: t('homeDemoTask2'), meta: t('homeDemoMeta2'), types: [], status: 'running', progress: 72, time: t('homeTimeMinutes', { count: 12 }),
          steps: [
            { key: 'fetch', label: t('taskStepFetch'), hint: t('taskStepFetchHint'), icon: 'download', state: 'done' },
            { key: 'convert', label: t('taskStepConvert'), hint: t('taskStepConvertHint'), icon: 'bolt', state: 'active' },
            { key: 'execute', label: t('taskStepExecute'), hint: t('taskStepExecuteHint'), icon: 'play', state: 'wait' },
          ],
        },
        {
          id: 'demo-task-stock', file: null, name: t('homeDemoTask3'), meta: t('homeDemoMeta3'), types: [], status: 'pending', progress: 12, time: t('homeTimeHours', { count: 1 }),
          steps: [
            { key: 'fetch', label: t('taskStepFetch'), hint: t('taskStepFetchHint'), icon: 'download', state: 'active' },
            { key: 'convert', label: t('taskStepConvert'), hint: t('taskStepConvertHint'), icon: 'bolt', state: 'wait' },
            { key: 'execute', label: t('taskStepExecute'), hint: t('taskStepExecuteHint'), icon: 'play', state: 'wait' },
          ],
        },
      ]
      const taskDisplay = (task) => {
        const owned = files.filter(file => file.taskId === task.id && !isPlaceholderFile(file))
        const running = task.status === 'reading' || owned.some(file => busy !== null && busy.fileId === file.id)
        const failed = owned.some(file => file.status === 'error')
        const doneCount = owned.filter(file => file.status === 'ok').length
        const status = running ? 'running' : failed ? 'error' : owned.length > 0 && doneCount === owned.length ? 'done' : 'pending'
        const progress = owned.length === 0 ? (running ? 6 : 0) : Math.round((doneCount / owned.length) * 100)
        const at = owned.reduce((max, file) => Math.max(max, file.convertedAt ?? file.updatedAt ?? 0), task.updatedAt ?? 0)
        const steps = []
        if (task.origin === 'source') {
          const reading = task.status === 'reading'
          const fetched = !reading && ((task.lastReadAt ?? 0) > 0 || (task.objectCount ?? 0) > 0 || owned.some(file => file.origin === 'source'))
          steps.push({
            key: 'fetch',
            label: t('taskStepFetch'),
            hint: t('taskStepFetchHint'),
            icon: 'download',
            state: reading ? 'active' : fetched ? 'done' : 'wait',
          })
        }
        const converting = owned.some(file => busy !== null && busy.fileId === file.id)
        const convertState = doneCount > 0 && doneCount === owned.length ? 'done'
          : converting ? 'active'
            : failed ? 'error'
              : doneCount > 0 ? 'active' : 'wait'
        steps.push({ key: 'convert', label: t('taskStepConvert'), hint: t('taskStepConvertHint'), icon: 'bolt', state: convertState })
        if ((task.targetId ?? '') !== '') {
          const executed = owned.filter(file => file.execStatus === 'ok').length
          const execFailed = owned.some(file => file.execStatus === 'error')
          const execState = owned.length > 0 && executed === owned.length ? 'done'
            : executed > 0 ? 'active'
              : execFailed ? 'error' : 'wait'
          steps.push({ key: 'execute', label: t('taskStepExecute'), hint: t('taskStepExecuteHint'), icon: 'play', state: execState })
        }
        return { status, progress, at, count: owned.length, steps }
      }
      const actualTasksPage = tasks
        .map((task) => {
          const display = taskDisplay(task)
          const originText = task.origin === 'source'
            ? (connNameById(task.sourceId) || t('taskMissingConn'))
            : task.origin === 'sql' ? t('taskOriginSql') : t('taskOriginLocal')
          const targetText = task.targetId === ''
            ? t('taskTargetUnset')
            : (connNameById(task.targetId) || t('taskMissingConn'))
          const types = Array.isArray(task.readTypes) ? task.readTypes : []
          // 对象数只按任务下真实的 SQL 文件统计；没有文件就不显示，避免用残留的 objectCount 误导。
          const objectCount = display.count
          const objectText = objectCount === 0
            ? ''
            : objectCount === 1 ? t('taskObjectsOne') : t('taskObjects', { count: objectCount })
          return {
            id: task.id,
            task,
            name: task.name,
            meta: `${originText} \u2192 ${targetText}${task.schema ? ` \u00b7 ${task.schema}` : ''}${objectText === '' ? '' : ` \u00b7 ${objectText}`} \u00b7 ${t(COMPAT_MODE_KEYS[taskCompatMode(task)])}`,
            types,
            status: display.status,
            progress: display.progress,
            steps: display.steps,
            time: formatRelative(display.at, t),
            at: display.at,
          }
        })
        .sort((a, b) => b.at - a.at)
      const tasksDemoMode = tasks.length === 0 && workFiles.length === 0 && connections.length === 0
      const taskRows = tasksDemoMode ? demoTasksPage : actualTasksPage
      const taskStats = [
        { label: t('tasksTotal'), value: taskRows.length, tone: 'blue' },
        { label: t('tasksRunning'), value: taskRows.filter(task => task.status === 'running').length, tone: 'cyan' },
        { label: t('tasksDone'), value: taskRows.filter(task => task.status === 'done').length, tone: 'green' },
        { label: t('tasksPending'), value: taskRows.filter(task => task.status === 'pending' || task.status === 'error').length, tone: 'amber' },
      ]
      const openTaskRow = (task) => {
        if (task.task !== undefined) openTask(task.task)
        else openStudio()
      }
      const tasksPage = pageShell(
        t('tasksTitle'),
        t('tasksDesc'),
        h('button', { type: 'button', className: 'o2h-ctaPrimary', onClick: openNewTask },
          h(StudioIcon, { name: 'plus', size: 16 }),
          t('tasksNew')),
        h(React.Fragment, null,
          h('div', { className: 'o2h-pageStats' },
            taskStats.map(stat => h('article', { key: stat.label, className: 'o2h-stat o2h-pageStat', 'data-tone': stat.tone },
              h('div', { className: 'o2h-statTop' },
                h('span', { className: 'o2h-statLabel' }, stat.label)),
              h('div', { className: 'o2h-statValue' }, String(stat.value))))),
          h('section', { className: 'o2h-card o2h-pageCard' },
            h('header', { className: 'o2h-cardHead' },
              h('div', { className: 'o2h-cardHeading' },
                h('h2', { className: 'o2h-cardTitle' }, h(StudioIcon, { name: 'layers', size: 15 }), t('tasksTitle')),
                h('p', { className: 'o2h-cardSub' }, t('tasksDesc'))),
              h('div', { className: 'o2h-cardAside' },
                tasksDemoMode ? h('span', { className: 'o2h-demoChip' }, t('tasksDemo')) : null)),
            taskRows.length === 0
              ? h('div', { className: 'o2h-pageEmpty' }, t('tasksEmpty'))
              : h('div', { className: 'o2h-pageTable' },
                taskRows.map(task => h('div', {
                  key: task.id,
                  className: 'o2h-pageRow o2h-taskPageRow',
                  role: 'button',
                  tabIndex: 0,
                  onClick: () => openTaskRow(task),
                  onKeyDown: (event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      openTaskRow(task)
                    }
                  },
                },
                h('span', { className: `o2h-taskIcon is-${task.status}` }, h(StudioIcon, { name: taskStatusMeta[task.status].icon, size: 15 })),
                h('span', { className: 'o2h-pageRowMain' },
                  h('b', { className: 'o2h-pageRowTitle' }, task.name),
                  h('span', { className: 'o2h-pageRowMeta' }, task.meta),
                  Array.isArray(task.types) && task.types.length > 0
                    ? h('span', { className: 'o2h-taskTypeChips' },
                      task.types.map(type => h('span', { key: type, className: 'o2h-taskTypeChip' }, typeLabel(type))))
                    : null),
                h('span', { className: 'o2h-pageRowProgress' },
                  h('span', { className: 'o2h-steps' },
                    task.steps.map((step, index) => h(React.Fragment, { key: step.key },
                      index === 0 ? null : h('i', { className: `o2h-stepLink is-${step.state}`, 'aria-hidden': 'true' }),
                      h('span', { className: `o2h-step is-${step.state}`, title: step.hint },
                        h('i', { className: 'o2h-stepDot' }, h(StudioIcon, { name: step.state === 'done' ? 'check' : step.icon, size: 11 })),
                        h('span', { className: 'o2h-stepLabel' }, step.label))))),
                  h('span', { className: 'o2h-taskTime' }, task.time)),
                task.task === undefined
                  ? h('span', { className: 'o2h-taskArrow' }, h(StudioIcon, { name: 'arrowUpRight', size: 14 }))
                  : h('span', { className: 'o2h-taskRowActions' },
                    h('button', {
                      type: 'button',
                      className: 'o2h-taskAction',
                      title: t('taskEdit'),
                      onClick: (event) => { event.stopPropagation(); openTaskWizard(task.task) },
                    }, h(StudioIcon, { name: 'edit', size: 13 })),
                    h('button', {
                      type: 'button',
                      className: 'o2h-taskAction isDanger',
                      title: t('taskDelete'),
                      onClick: (event) => { event.stopPropagation(); removeTask(task.task) },
                    }, h(StudioIcon, { name: 'trash', size: 13 })),
                    h('span', { className: 'o2h-taskArrow' }, h(StudioIcon, { name: 'arrowUpRight', size: 14 })))))))))

      return h('div', { className: 'o2p o2p-app', 'data-theme': theme },
        h('style', null, PAGE_CSS),
        h('style', null, HOME_CSS),
        h(StudioTopNav, { t, active: view, onNavigate: navigate, theme, onToggleTheme: toggleTheme }),
        // 作业进行中：整页内容（含所有按钮/输入）锁定，只留顶部导航可切换 tab。
        h('div', {
          className: 'o2p-lockWrap',
          'data-locked': busyLock ? 'true' : undefined,
          'aria-busy': busyLock ? 'true' : undefined,
          inert: busyLock ? '' : undefined,
        },
        h('div', { className: 'o2p-lockVeil', 'aria-hidden': 'true' }),
        view === 'home'
          ? h(HomeView, {
            t,
            files,
            connections,
            tasks,
            compat,
            busy,
            targetConnId,
            embedded: true,
            theme,
            onToggleTheme: toggleTheme,
            onNavigate: navigate,
            onOpenStudio: openStudio,
            onNewTask: openNewTask,
            onOpenConnections: openConnections,
            onOpenFile: openFile,
          })
          : view === 'connections'
            ? connectionsPage
            : view === 'settings'
              ? settingsPage
              : view === 'tasks'
                ? tasksPage
                : h('div', { className: 'o2p-shell' },
          h('header', { className: 'o2h-pageHead' },
            h('div', { className: 'o2h-pageHeading' },
              h('h1', { className: 'o2h-pageTitle' }, t('workspaceTitle')),
              h('p', { className: 'o2h-pageDesc' }, t('introText'))),
            contextReady
              ? h('div', { className: 'o2h-pageActions' },
                h('button', {
                  type: 'button',
                  className: `o2h-ctaPrimary${busy !== null ? ' o2p-btnBusy' : ''}`,
                  disabled: busy !== null || reading || visible.length === 0,
                  title: t('workbarConvertAllHint'),
                  onClick: convertAll,
                }, h(StudioIcon, { name: 'bolt', size: 14 }), t('workbarConvert')),
                h('button', {
                  type: 'button',
                  className: `o2h-ctaSecondary${executing ? ' o2p-btnBusy' : ''}`,
                  disabled: busy !== null || reading || executing || activeTask === undefined || visible.length === 0 || !hasTarget,
                  title: hasTarget ? t('workbarExecuteAllHint') : t('execNoTarget'),
                  onClick: () => executeFiles(visible),
                }, h(StudioIcon, { name: 'play', size: 14 }), executing ? t('executing') : t('workbarExecute')),
                h('button', {
                  type: 'button',
                  className: 'o2h-ctaSecondary',
                  disabled: busy !== null || visible.every(file => file.result === ''),
                  title: t('workbarExportAllHint'),
                  onClick: exportAll,
                }, h(StudioIcon, { name: 'file', size: 14 }), t('workbarExport')))
              : null),
          showWelcome
            ? h('div', { className: 'o2p-welcome' },
              h('div', { className: 'o2p-welcomeIcon' }, h(PanelIcon, { size: 30 })),
              h('h2', { className: 'o2p-welcomeTitle' }, t('welcomeTaskTitle')),
              h('p', { className: 'o2p-welcomeSub' }, t('welcomeTaskSub')),
              h('div', { className: 'o2p-welcomeActions' },
                h('button', {
                  type: 'button',
                  className: 'o2p-primary',
                  onClick: openNewTask,
                }, t('tasksNew')),
                h('button', {
                  type: 'button',
                  className: 'o2p-secondary',
                  onClick: () => navigate('tasks'),
                }, t('navTasks'))))
            : h('div', { className: 'o2p-body' },
            h('aside', { className: 'o2p-list o2p-explorer' },
              reading ? h('div', { className: 'o2p-loadBar', 'data-tone': 'read' }, h('span', null)) : null,
              h('div', { className: 'o2p-sourceRows o2p-taskTop' },
                h('div', { className: 'o2p-sourceRow' },
                  h('select', {
                    className: 'o2p-sourceSelect',
                    value: activeTaskId,
                    title: t('taskSelectLabel'),
                    onChange: (event) => selectTask(event.target.value),
                  },
                  h('option', { value: '' }, t('taskSelectPlaceholder')),
                  [...tasks]
                    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
                    .map(task => h('option', { key: task.id, value: task.id }, task.name))),
                  h('button', {
                    type: 'button',
                    className: `o2p-btn${reading ? ' o2p-btnBusy' : ''}`,
                    disabled: activeTask === undefined || activeTask.origin !== 'source' || reading || readTypes.length === 0,
                    onClick: () => {
                      if (activeTask === undefined || activeTask.origin !== 'source') return
                      readSourceObjects(activeTask.sourceId, { taskId: activeTask.id, types: readTypes, schema: activeTask.schema })
                    },
                  }, reading ? t('reading') : t('read')))),
              h('div', { className: 'o2p-sourceRows o2p-filterTop' },
                h('div', { className: 'o2p-sourceRow' },
                  h('select', {
                    className: 'o2p-sourceSelect',
                    value: typeFilter,
                    title: t('objectType'),
                    onChange: (event) => setTypeFilter(event.target.value),
                  },
                  h('option', { value: 'all' }, t('typeAll')),
                  availableTypes.map(type => h('option', { key: type, value: type }, type))),
                  h('select', {
                    className: 'o2p-sourceSelect',
                    value: convFilter,
                    title: t('filterConv'),
                    onChange: (event) => setConvFilter(event.target.value),
                  },
                  h('option', { value: 'all' }, `${t('filterConv')}: ${t('filterAll')}`),
                  h('option', { value: 'done' }, `${t('filterConv')}: ${t('filterDone')}`),
                  h('option', { value: 'pending' }, `${t('filterConv')}: ${t('filterPending')}`)))),
              h('div', { className: 'o2p-listHead' },
                h('input', {
                  className: 'o2p-search', type: 'search', value: query,
                  placeholder: t('searchFiles'),
                  onChange: (event) => setQuery(event.target.value),
                }),
                h('span', { className: 'o2p-listCount' }, `${doneCount} / ${visible.length}`)),
              h('div', { className: 'o2p-fileList' },
                reading && visible.length === 0
                  ? h('div', { className: 'o2p-scan' },
                    h('div', { className: 'o2p-scanHead' }, h('i', null), t('reading')),
                    [0, 1, 2, 3, 4, 5].map(index => h('div', {
                      key: index,
                      className: 'o2p-skel',
                      style: { animationDelay: `${index * 130}ms` },
                    })))
                  : visible.length === 0
                    ? h('p', { className: 'o2p-listEmpty' }, sourceUnread ? t('sourceNotReadList') : t('searchNoMatch'))
                    : fileBlocks)),
            h('section', { className: 'o2p-pane' },
              h('header', { className: 'o2p-paneHead' },
                h('h2', { className: 'o2p-paneTitle' }, t('sourceSql')),
                h('div', { className: 'o2p-tools' },
                  activeTask === undefined || activeTask.origin !== 'source'
                    ? h(React.Fragment, null,
                      h('button', { type: 'button', className: 'o2p-btn', onClick: newFile }, t('newSql')),
                      h('button', { type: 'button', className: 'o2p-btn', onClick: deleteActive }, t('delete')),
                      h('button', { type: 'button', className: 'o2p-btn', onClick: () => fileInputRef.current && fileInputRef.current.click() }, t('importSql')),
                      h('button', { type: 'button', className: 'o2p-btn', onClick: copySql }, t('copySql')))
                    : null,
                  h('button', { type: 'button', className: `o2p-btn o2p-btnAi${busyHere ? ' o2p-btnBusy' : ''}`, onClick: deepConvert, disabled: busy !== null || sourceUnread || active.sql.trim() === '' }, h(StudioIcon, { name: 'sparkles', size: 13 }), t('deepConvert')),
                  h('button', { type: 'button', className: `o2p-btn o2p-btnPrimary o2p-btnLead${busyHere ? ' o2p-btnBusy' : ''}`, onClick: convertActive, disabled: busy !== null || sourceUnread || reading }, h(StudioIcon, { name: 'bolt', size: 13 }), t('convertSyntax')))),
              reading ? h('div', { className: 'o2p-loadBar', 'data-tone': 'read' }, h('span', null)) : null,
              reading ? h('div', { className: 'o2p-scanline' }) : null,
              sourceUnread
                ? h('div', { className: 'o2p-emptyState' },
                  h('div', { className: 'o2p-emptyIcon' }, h(StudioIcon, { name: 'database', size: 24 })),
                  h('h3', { className: 'o2p-emptyTitle' }, t('sourceNotReadTitle')),
                  h('p', { className: 'o2p-emptyHint' }, t('sourceNotReadHint')),
                  h('button', {
                    type: 'button',
                    className: `o2p-btn o2p-btnPrimary${reading ? ' o2p-btnBusy' : ''}`,
                    disabled: reading || readTypes.length === 0,
                    onClick: () => readSourceObjects(activeTask.sourceId, { taskId: activeTask.id, types: readTypes, schema: activeTask.schema }),
                  }, h(StudioIcon, { name: 'download', size: 13 }), reading ? t('reading') : t('read')))
                : h(React.Fragment, null,
                  h('div', { className: 'o2p-editor' },
                    h('div', { className: 'o2p-gutter', ref: gutterRef }, lineNumbers(active.sql)),
                    h('div', { className: 'o2p-editorPane' },
                      h('pre', { className: 'o2p-highlight', ref: highlightRef, 'aria-hidden': 'true' }, highlightSql(active.sql)),
                      h('textarea', {
                        className: 'o2p-textarea o2p-textareaOverlay',
                        spellCheck: false,
                        wrap: 'off',
                        value: active.sql,
                        placeholder: t('pageSqlPlaceholder'),
                        onChange: (event) => updateActive({ sql: event.target.value, result: '', status: 'idle', note: '', convertedAt: undefined, applied: undefined, warnings: undefined, durationMs: undefined, execStatus: undefined, execNote: '', execAt: undefined }),
                        onScroll: (event) => {
                          if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop
                          if (highlightRef.current) {
                            highlightRef.current.scrollTop = event.currentTarget.scrollTop
                            highlightRef.current.scrollLeft = event.currentTarget.scrollLeft
                          }
                        },
                      }))),
                  h('footer', { className: 'o2p-paneFoot' },
                    h('span', null, `${active.sql.length} ${t('chars')} \u00b7 ${lineNumbers(active.sql).split('\n').length} ${t('linesUnit')}`),
                    h('span', null, compat ? t('compat') : '')))),
            h('section', { className: `${busyHere || execHere ? 'o2p-pane o2p-paneBusy' : 'o2p-pane'}${execHere ? ' o2p-paneExec' : ''}` },
              h('header', { className: 'o2p-paneHead' },
                h('h2', { className: 'o2p-paneTitle' }, t('resultTitle')),
                h('div', { className: 'o2p-tools' },
                  h('button', {
                    type: 'button',
                    className: `o2p-btn${executing ? ' o2p-btnBusy' : ''}`,
                    disabled: busy !== null || reading || executing || activeTask === undefined || active.result.trim() === '' || !hasTarget,
                    title: hasTarget ? t('execCurrentHint') : t('execNoTarget'),
                    onClick: () => executeFiles([active]),
                  }, executing ? t('executing') : t('executeCurrent')),
                  h('button', { type: 'button', className: 'o2p-btn', onClick: copyResult, disabled: busy !== null || active.result === '' }, t('copyResult')),
                  h('button', { type: 'button', className: 'o2p-btn', onClick: exportActive, disabled: busy !== null || active.result === '' }, t('exportResult')))),
              busyHere ? h('div', { className: 'o2p-loadBar' }, h('span', null)) : null,
              execHere ? h('div', { className: 'o2p-loadBar', 'data-tone': 'exec' }, h('span', null)) : null,
              busyHere ? h('div', { className: 'o2p-scanline' }) : null,
              execHere ? h('div', { className: 'o2p-execFlow' }) : null,
              h('div', { className: 'o2p-codeScroll' },
                active.result === ''
                  ? h('p', { className: 'o2p-emptyResult' }, t('resultEmpty'))
                  : h(React.Fragment, null,
                    h('div', { className: 'o2p-gutter' }, lineNumbers(active.result)),
                    h('pre', { className: 'o2p-code' }, highlightSql(active.result)))),
              h('footer', { className: 'o2p-paneFoot' },
                h('span', { title: active.note === '' ? undefined : active.note }, resultStatus),
                h('span', { className: 'o2p-dot', 'data-status': statusKind })))),
            h('footer', { className: 'o2p-statusbar' },
            h('div', { className: 'o2p-statusLeft' },
              h('span', { className: 'o2p-statusDot', 'data-kind': status.kind, 'aria-hidden': 'true' }),
              h('span', { className: 'o2p-statusText', 'data-kind': status.kind, role: 'status', title: status.text || undefined }, status.text || t('statusReady'))),
            h('span', null, activeTask === undefined || targetConn === undefined ? '' : targetConn.name))),
          h('input', {
            type: 'file',
            accept: '.sql,.txt',
            ref: fileInputRef,
            style: { display: 'none' },
            onChange: importFile,
          }),
          menu !== null
            ? h('div', {
              className: 'o2p-menu',
              style: { left: `${menu.x}px`, top: `${menu.y}px` },
              onMouseDown: (event) => event.stopPropagation(),
            },
            activeTask === undefined || activeTask.origin !== 'source'
              ? h(React.Fragment, null,
                h('button', { type: 'button', className: 'o2p-menuItem', onClick: menuDelete }, t('delete')),
                h('button', { type: 'button', className: 'o2p-menuItem', onClick: menuRename }, t('rename')),
                h('button', { type: 'button', className: 'o2p-menuItem', onClick: menuConvert }, t('convert')))
              : h(React.Fragment, null,
                h('button', { type: 'button', className: 'o2p-menuItem', onClick: menuConvert }, t('convert')),
                h('button', { type: 'button', className: 'o2p-menuItem', onClick: menuRefetch }, t('refetch'))))
            : null,
        wizard === null ? null : renderOverlay(renderTaskWizard(), theme)),
        confirmDialog,
        hudLayers)
    }

    return {
      inject: ['slots', 'locale', 'uiWorkspace', 'layout', 'remote', 'remote.session', 'workspaces'],
      __convertLocally: convertLocally,
      __highlightSql: highlightSql,
      __detectInput: detectInput,
      __buildSinglePrompt: buildSinglePrompt,
      __connectionCrypto: { encryptWithKey, decryptWithKey, persistConnections, hydrateConnections },
      __compat: { COMPAT_MODES, compatModeForKind, taskCompatMode },
      __homePreview: { HomeView, StudioPage, zh, en, PAGE_CSS, HOME_CSS },
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'plsqlstudio: dictionaries')
        const t = ctx.locale.bind(NS)

        const start = (promptText) => {
          if (!ctx.uiWorkspace || typeof ctx.uiWorkspace.startSession !== 'function') {
            throw new Error('uiWorkspace.startSession is unavailable in this build')
          }
          ctx.uiWorkspace.startSession(undefined, {
            agentPreset: 'plsqlstudio',
            prompt: promptText,
            whenDraftExists: 'replace',
          })
        }

        const assistantTextOf = (record) => {
          const event = record && record.event
          if (!event || event.type !== 'assistant/message') return ''
          const message = event.data && event.data.message
          const content = message && message.content
          if (!Array.isArray(content)) return ''
          const parts = []
          for (const block of content) {
            if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
          }
          return parts.join('\n')
        }

        const unwrapRemote = (result) => {
          if (result !== null && typeof result === 'object' && typeof result.ok === 'boolean' && 'value' in result) {
            if (!result.ok) {
              const failure = result.error || {}
              throw new Error(failure.message || failure.code || 'session remote call failed')
            }
            return result.value
          }
          return result
        }

        const archiveQuietly = async (id) => {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              await ctx.workspaces.archiveSession(id, { stopActivity: true })
              forgetSession(id)
              return true
            } catch {
              await new Promise(resolve => setTimeout(resolve, 700))
            }
          }
          return false
        }

        /** Collect one Session's assistant output, then archive the Session. */
        const collect = async (sessionId) => {
          const remote = ctx.remote && ctx.remote.session
          if (!remote || typeof remote.wait !== 'function') {
            return { ok: false, message: 'session remote is unavailable in this build', sessionId }
          }
          try {
            const parts = []
            let afterSeq
            await new Promise(resolve => setTimeout(resolve, 300))
            for (let round = 0; round < 30; round += 1) {
              const value = unwrapRemote(await remote.wait({
                sessionId,
                ...(afterSeq === undefined ? {} : { afterSeq }),
                timeoutMs: 30000,
                maxMessages: 20,
              }))
              if (!value || !value.state) throw new Error('session wait returned no state')
              afterSeq = value.state.cursor
              for (const record of value.output.records) {
                const text = assistantTextOf(record)
                if (text !== '') parts.push(text)
              }
              if (value.reason === 'idle') {
                if (parts.length === 0 && round < 3) {
                  await new Promise(resolve => setTimeout(resolve, 500))
                  continue
                }
                break
              }
              if (value.reason === 'input-required') {
                    return { ok: false, message: 'the agent is waiting for your answer', sessionId }
              }
            }
            const raw = parts.join('\n\n').trim()
            const text = raw
              .split('\n')
              .filter(line => !/(未连库验证|兼容模式能力假设|测试库实测确认|以上结论基于|编译与执行结果需)/.test(line))
              .join('\n')
              .trim()
            if (text === '') {
                await archiveQuietly(sessionId)
              return { ok: false, message: 'the agent returned no conversion output', sessionId }
            }
            await archiveQuietly(sessionId)
            return { ok: true, text, sessionId }
          } catch (error) {
            await archiveQuietly(sessionId)
            return {
              ok: false,
              message: error && error.message ? error.message : String(error),
              sessionId,
            }
          }
        }

        /**
         * Run one conversion in a background Session and return its assistant text.
         * The Session is archived once the run finishes, so the list stays clean.
         */
        const convert = async (promptText, workspaceId, fileId) => {
          const remote = ctx.remote && ctx.remote.session
          if (!remote || typeof remote.create !== 'function') {
            return { ok: false, message: 'session remote is unavailable in this build' }
          }
          let sessionId
          try {
            const created = unwrapRemote(await remote.create({
              ...(workspaceId === undefined ? {} : { workspaceId }),
              agentPreset: 'plsqlstudio',
            }))
            if (!created || typeof created.sessionId !== 'string') {
              return { ok: false, message: 'session create returned no id' }
            }
            sessionId = created.sessionId
            rememberSession(sessionId)
            markInflight(sessionId, fileId)
            try {
              unwrapRemote(await remote.rename({ sessionId, title: 'PLSQL Studio' }))
            } catch { /* the title is cosmetic */ }
            const requestId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
              ? crypto.randomUUID()
              : `plsql-${Date.now()}`
            unwrapRemote(await remote.prompt({
              requestId,
              sessionId,
              mode: 'queue',
              content: [{ type: 'text', text: promptText }],
            }))
          } catch (error) {
            if (sessionId !== undefined) await archiveQuietly(sessionId)
            return {
              ok: false,
              message: error && error.message ? error.message : String(error),
              ...(sessionId === undefined ? {} : { sessionId }),
            }
          }
          return collect(sessionId)
        }

        const archiveOne = (sessionId) => ctx.workspaces.archiveSession(sessionId, { stopActivity: true })

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'plsqlstudio',
              order: 25,
              label: () => t('nav'),
              locale: NS,
              inject: () => ({ t }),
            },
            (ownerProps = {}) => h(Workbench, { ...ownerProps, t: ownerProps.t || t, start }),
          ),
        )

        ctx.slots.inject('main', () =>
          ctx.slots.register(
            {
              name: 'main',
              key: 'plsqlstudio',
              locale: NS,
              inject: () => ({ convert, collect, archiveOne }),
            },
            StudioPage,
          ),
        )

        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'plsqlstudio',
              order: 30,
              label: () => t('nav'),
              locale: NS,
            },
            PanelIcon,
          ),
        )
      },
    }
  },
})
