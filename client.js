window.__ModuleLoader__.load({
  id: 'dsh-hgdb-convert-studio',
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
            className: 'hcs-app',
            'data-theme': theme === 'dark' ? 'dark' : 'light',
          }, node),
          document.body,
        )
      }
      return node
    }

    const NS = 'hgdb-convert-studio'
    const STORAGE_KEY = 'hgdb-convert-studio.state.v1'
    const THEME_KEY = 'hgdb-convert-studio.theme.v1'
    const DROP_STATEMENTS_KEY = 'hgdb-convert-studio.drop-statements.v1'

    const DROP_CASCADE_KEY = 'hgdb-convert-studio.drop-cascade.v1'

    function readDropCascade() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return false
        return window.localStorage.getItem(DROP_CASCADE_KEY) === '1'
      } catch {
        return false
      }
    }

    function saveDropCascade(value) {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return
        window.localStorage.setItem(DROP_CASCADE_KEY, value === true ? '1' : '0')
      } catch {
        /* best effort */
      }
    }

    function readDropStatements() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return false
        return window.localStorage.getItem(DROP_STATEMENTS_KEY) === '1'
      } catch {
        return false
      }
    }

    const READ_DEPS_KEY = 'hgdb-convert-studio.read-deps.v1'

    function readDependencySetting() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return false
        return window.localStorage.getItem(READ_DEPS_KEY) === '1'
      } catch {
        return false
      }
    }

    function saveDependencySetting(value) {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return
        window.localStorage.setItem(READ_DEPS_KEY, value === true ? '1' : '0')
      } catch {
        /* best effort */
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
    const JOB_KEY = 'hgdb-convert-studio.job.v1'
    const JOB_CANCEL_KEY = 'hgdb-convert-studio.job-cancel.v1'
    const PAGE_SESSION_KEY = 'hgdb-convert-studio.page-session.v1'

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
          jobId: typeof value.jobId === 'string' ? value.jobId : '',
          // 恢复作业时必须保留会话标记，否则重启后会把旧作业当成本页面的作业复活
          sessionId: typeof value.sessionId === 'string' ? value.sessionId : '',
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

    const CONNECTIONS_KEY = 'hgdb-convert-studio.connections.v1'

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
    const CONNECTION_KEY_DB = 'hgdb-convert-studio.crypto'
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

    const DEPS_KEY = 'hgdb-convert-studio.deps.v1'

    /** 读取已缓存的依赖结果（按文件 id）。只保存轻量字段，DDL 不落盘。 */
    function loadDepsCache() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return new Map()
        const raw = window.localStorage.getItem(DEPS_KEY)
        if (typeof raw !== 'string' || raw === '') return new Map()
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return new Map()
        const map = new Map()
        for (const [fileId, value] of Object.entries(parsed).reverse()) {
          if (value === null || typeof value !== 'object' || !Array.isArray(value.items)) continue
          map.set(fileId, {
            from: typeof value.from === 'string' ? value.from : '',
            items: value.items
              .filter(item => item !== null && typeof item === 'object' && typeof item.name === 'string')
              .map(item => ({ name: item.name, type: typeof item.type === 'string' ? item.type : '', ddl: '' })),
          })
        }
        return map
      } catch {
        return new Map()
      }
    }

    function saveDepsCache(map) {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return
        const out = {}
        let count = 0
        for (const [fileId, value] of Array.from(map).reverse()) {
          if (count >= 800) break
          out[fileId] = { from: value.from, items: value.items.slice(0, 40) }
          count += 1
        }
        window.localStorage.setItem(DEPS_KEY, JSON.stringify(out))
      } catch {
        /* 超出配额时忽略 */
      }
    }

    const TASKS_KEY = 'hgdb-convert-studio.tasks.v1'
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
      nav: 'HGDB Convert Studio',
      title: 'HGDB Convert Studio',
      subtitle: '把 Oracle / MySQL / SQL Server 的表、视图、例程与包交给 hgdb-convert-studio 智能体转换。',
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
      block: '匿名块 / 例程片段',
      schema: '目标 schema',
      schemaEmpty: '没有可用的模式',
      schemaHint: '留空表示沿用源 schema',
      compat: '目标端已启用兼容模式',
      compatHint: '启用后优先保留源端语法；未确认的写法仍按 HGDB V9 标准处理。',
      sourceSql: '源 SQL',
      sourceTabDeps: '依赖对象',
      sourceTabDepsBadge: '{count}',
      depsEmpty: '当前 SQL 未识别到依赖对象。',
      depsEmptyUnread: '先读取源库对象，或直接粘贴 SQL，再查看依赖。',
      depsMissing: '未读取',
      depsLoaded: '已读取',
      depsHint: '静态识别依赖（FROM / JOIN / INTO / UPDATE / REFERENCES / CALL 等）；源库任务会自动连库读取准确依赖。',
      depsOpen: '打开该对象',
      depsCount: '{loaded} 个已读取 · {missing} 个未读取',
      depsNeedSetting: '在「系统设置 → 转换选项」勾选「获取依赖对象」后显示此页签。',
      depsFetch: '获取依赖',
      depsFetchHint: '从源库读取当前对象依赖的表 / 视图 / 例程，并显示 DDL',
      depsRefetch: '重新获取依赖',
      depsHostStale: 'Host 侧缺少依赖读取接口（HTTP 404）：请完全退出并重启 DSH 后再试；在此之前显示的是静态识别结果。',
      depsFetching: '正在读取依赖…',
      depsStaticHint: '静态识别仅供参考；正在读取源库依赖，也可以点右上角「获取依赖」重试。',
      depsDbEmpty: '源库未返回依赖对象。',
      depsNoDeps: '该对象在源库没有依赖对象。',
      depsNoDepsHint: '源库对象字典里查不到它引用的表 / 视图 / 例程（例如一张没有任何外键的独立表）。',
      depsFetchEmptyHint: '依赖接口没有返回对象，请确认源库连接与对象名。',
      depsLocalLoaded: '工作台已有',
      depsDbOnly: '仅源库',
      depsStaticOnly: '静态识别',
      depsCountEmpty: '源库未返回依赖',
      depsNoneShort: '无依赖对象',
      depsStaticListHint: '源库未返回依赖，下面是静态识别结果（仅供参考）。',
      depsShowDdl: '查看 DDL',
      depsHideDdl: '收起 DDL',
      depsCopyDdl: '复制 DDL',
      depsNoDdl: '源库未返回该对象的 DDL',
      depsDdlLoading: '正在读取…',
      depsLoadingHint: '正在从源库读取该对象的依赖，完成后自动显示。',
      depsNeedSource: '该任务没有绑定源库连接，无法从源库读取依赖。',
      depsNeedObjects: '还没有读取对象，先点上方下载图标从源库读取对象。',
      sqlPlaceholder: '粘贴要转换的 SQL…',
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
      flowHint: '会话会自动选中「HGDB Convert Studio」智能体，并把这段请求填进输入框；按回车开始。',
      preset: '预设：hgdb-convert-studio',
      pageTitle: 'HGDB Convert Studio',
      welcomeTitle: '开始 SQL 转换',
      welcomeSub: '读取源库对象，或直接粘贴/载入示例 SQL 开始',
      welcomeRead: '读取源库',
      welcomeSample: '载入示例',
      welcomeNew: '新建 SQL',
      introText: '按任务读取源对象、转换为 HGDB V9 语法并执行到目标库',
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
      'warn.set': 'SET 已按通用规则映射为 text[] + CHECK（<@ 取值集合），写入需传数组字面量',
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
      treeExpandAll: '展开全部',
      treeCollapseAll: '折叠全部',
      treeLocate: '定位当前 SQL',
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
      sourceNotReadHint: '源库读取模式下不支持手工粘贴 SQL：点上方下载图标从源库读取对象后，这里才会出现对象列表。',
      sourceNotReadList: '尚未读取对象',
      searchNoMatch: '没有匹配的 SQL 文件',
      readConnUnreachable: '连不上源库：请检查主机、端口、数据库或服务名，以及防火墙或 VPN。原始错误：{detail}',
      readAuthFailed: '源库用户名或密码不正确。原始错误：{detail}',
      readLinkDropped: '与源库的连接中途断开（网络抖动或超时），已自动重试一次仍失败；请检查网络后重试。{detail}',
      connTestTimeout: '连接测试未在限定时间内完成。{detail}',
      connTestFrontTimeout: '前端等待超时（45s）：Host 没有在 45 秒内返回结果。请确认 DSH 已重启到最新版本，并检查该端口是否被防火墙或代理拦截。',
      connTestElapsed: '（耗时 {seconds}s）',
      connTestNotOracle: '该端口不是 Oracle 监听（握手被直接断开）。若这是 HGDB-V9-Oracle，请把「类型」改为 HGDB-V9-Oracle。{detail}',
      connTestClosed: '服务端在握手阶段直接关闭了连接：端口上的服务不是该协议的数据库，或实例尚未就绪。请核对实例状态与监听端口。{detail}',
      connTestRefused: '目标主机拒绝连接：端口未开放或被防火墙拦截。{detail}',
      readServiceMissing: '源库上的 service_name/SID 或数据库不存在。原始错误：{detail}',
      readMysqlPublicKey: 'MySQL 拒绝授权（需要 allowPublicKeyRetrieval）：请确认连接串使用 useSSL=false&allowPublicKeyRetrieval=true，或改用 caching_sha2_password 兼容账号。原始错误：{detail}',
      jobReadTitle: '正在读取源库对象',
      jobConvertTitle: '正在转换语法',
      jobExecuteTitle: '正在执行到目标库',
      jobStop: '终止执行',
      jobStopRead: '停止获取',
      jobStopConvert: '停止转换',
      jobReadStopped: '已停止获取',
      jobConvertStopped: '已停止转换',
      jobStopped: '已终止执行',
      jobProgress: '{done} / {total} 个对象',
      jobReadCount: '已读取 {count} 个对象',
      jobRestoredHint: '后台仍在进行，完成后会自动刷新',
      jobReadCount: '{count} objects read',
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
      read: '读取对象',
      readHint: '从源库读取对象',
      reading: '正在读取',
      readObjects: '已读取 {count} 个对象',
      readObjectsInvalid: '源库返回的对象列表无效',
      readSourceMissing: '请先选择源端',
      targetEnd: '目标端',
      readUnsupported: '暂不支持从 {engine} 读取对象',
      sourceConnMissing: '请先在「管理连接」中添加 {engine} 连接',
      filterConv: '转换',
      filterAll: '全部',
      filterDone: '已转换',
      filterPending: '未转换',
      filterFailed: '转换失败',
      filterExec: '执行',
      filterExecDone: '已执行',
      filterExecPending: '未执行',
      filterExecFailed: '执行失败',
      filterWarn: '需复核',
      typeAll: '全部类型',
      typeUnspecified: '未指定',
      targetDb: '目标数据库',

      modeSql: 'SQL 文本',
      modeDir: '目录',
      pageSqlPlaceholder: '粘贴 SQL，或点击「导入」选择文件',

      homeNav: '项目总览',
      homeSettings: '系统设置',
      settingsTitle: '系统设置',
      settingsDesc: '主题、本地数据与版本信息',
      settingsAppearance: '外观',
      settingsTheme: '主题',
      settingsThemeHint: '浅色或深色，选择会保存在本机',
      settingsThemeLight: '浅色',
      settingsThemeDark: '深色',
      settingsLanguage: '语言',
      settingsLanguageHint: '切换界面语言，选择会保存在本机',
      langZh: '中文',
      langEn: 'English',
      langSwitchToEn: '切换到英文',
      langSwitchToZh: '切换到中文',
      settingsConvertOptions: '转换选项',
      settingsDropTitle: '生成删除语句',
      settingsDropHint: '转换时在 CREATE 前生成 DROP ... IF EXISTS，便于目标库重复执行',
      settingsCascadeTitle: '级联删除（DROP ... CASCADE）',
      settingsCascadeHint: '删除时连带依赖对象一起删，仅在拿不到依赖信息时使用',
      settingsCascadeConfirm: '会把依赖该对象的其它对象一起删除，且不会自动重建。生产库请谨慎。\n\n确认开启？',
      settingsDepsTitle: '获取对象时自动读取依赖',
      settingsDepsHint: '开启后获取对象的时候会自动从源库读取依赖，关闭则需要通过手动点「获取依赖」获取',
      settingsOn: '已开启',
      settingsOff: '已关闭',
      settingsData: '本地数据',
      taskCleanup: '清理任务数据',
      taskCleanupSource: '原始 SQL',
      taskCleanupSourceHint: '移除对象及其转换结果、日志和依赖缓存。',
      taskCleanupConverted: '转换结果',
      taskCleanupConvertedHint: '保留原始 SQL，重置转换和执行状态。',
      taskCleanupLogs: '日志',
      taskCleanupLogsHint: '清除读取、转换和执行的诊断信息，保留状态。',
      taskCleanupApply: '清理所选',
      taskCleanupDone: '已清理所选任务数据',
      settingsClearFetched: '清理获取的 SQL',
      settingsClearFetchedHint: '移除从源库读取的对象 SQL；任务、任务连接和本地导入/粘贴的 SQL 都会保留。',
      settingsClearFetchedConfirm: '确定清理所有从源库获取的对象 SQL？任务、连接与本地 SQL 会保留。',
      settingsClearedFetched: '已清理获取的 SQL',
      settingsClearConverted: '清理转换结果',
      settingsClearConvertedHint: '清空所有文件的转换与执行结果，保留 SQL 文本、任务与任务连接。',
      settingsClearConvertedConfirm: '确定清理所有转换与执行结果？SQL 文本、任务与连接会保留。',
      settingsClearedConverted: '已清理转换结果',
      settingsCleanupAction: '清理',
      reportUntitledTask: '未命名任务',
      reportLocalSql: '本地 SQL',
      reportUnset: '未指定',
      reportSchemaDefault: '沿用默认',
      reportErrorLine: '- 错误：{detail}',
      reportTimeLine: '- 时间：{time}',
      reportCellNone: '—',
      reportObject: '对象',
      reportType: '类型',
      reportTitle: '# 转换报告 · {name}',
      reportGeneratedAt: '- 生成时间：{time}',
      reportSourceLine: '- 源端：{value}',
      reportTargetLine: '- 目标端：{value}',
      reportSchemaLine: '- 目标 schema：{value}',
      reportCompatLine: '- 兼容模式：{value}',
      reportMetricObjects: '| 对象总数 | {value} |',
      reportMetricConverted: '| 已转换 | {value} |',
      reportMetricConvertFailed: '| 转换失败 | {value} |',
      reportMetricRuleHits: '| 规则命中总数 | {value} |',
      reportMetricRiskObjects: '| 含风险对象 | {value} |',
      reportMetricExecOk: '| 已执行 | {value} |',
      reportMetricExecFailed: '| 执行失败 | {value} |',
      reportMetricNotExec: '| 未执行 | {value} |',
      reportMetricNotExecRow: '| 未执行 | （尚未执行到目标库） |',
      reportOverview: '## 概览',
      reportMetricHead: '| 指标 | 取值 |',
      reportNotExecutedRow: '| 未执行 | （尚未执行到目标库） |',
      reportObjectsHead: '## 对象明细',
      reportObjectsCols: '| 对象 | 类型 | 转换 | 规则 | 风险 | 执行 |',
      reportRulesHead: '## 规则命中',
      reportRisksHead: '## 风险项',
      reportExecFailHead: '## 执行失败',
      reportRisksCols: '| 风险项 | 级别 | 涉及对象数 |',
      reportExecFailCols: '| 对象 | 级别 | 错误信息 |',
      reportUnknownError: '未知错误',
      reportOk: '成功',
      reportFail: '失败',
      reportNotExec: '未执行',
      reportConverted: '已转换',
      reportNotConverted: '未转换',
      reportExecOk: '成功',
      reportExecFail: '失败',
      reportState: '转换状态',
      reportRuleHits: '规则命中',
      reportRuleDetail: '规则明细',
      reportRisks: '风险项',
      reportExecState: '执行状态',
      reportExecError: '执行错误',
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
      tasksDesc: '按源库、目标库与兼容模式创建任务，统一跟踪读取、转换与执行',
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
      taskNoSourceConn: '还没有源库连接。',
      taskNoTargetConn: '还没有目标库连接，请先到「连接管理」添加。',
      taskGoConnections: '去添加连接',
      taskPickFiles: '选择 SQL 文件',
      taskPickedFiles: '已选择 {count} 个文件',
      taskNoFilePicked: '还没有选择文件',
      taskKeepFiles: '不重新选择文件时，任务下已有的 SQL 会保留；新选择的文件会追加。',
      taskSqlLabel: 'SQL 内容',
      taskSqlPlaceholder: '粘贴要转换的 SQL…',
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
      compatShortPostgresql: 'PostgreSQL兼容',
      compatShortOracle: 'Oracle兼容',
      compatShortMysql: 'MySQL兼容',
      compatShortSqlserver: 'SQL Server兼容',
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
      execMarkDone: '已执行到目标库',
      execMarkFailed: '执行失败',
      execMarkIdle: '尚未执行',
      execDropping: '正在按依赖顺序删除旧对象（{count} 个）…',
      execRunning: '正在执行…',
      execHostStale: 'Host 侧缺少执行接口（HTTP 404），请完全退出并重启 DSH 后重试',
      execErrNoSchema: '目标库没有 schema「{schema}」且自动创建失败：请手动创建，或改用已有的目标 schema',
      execErrExists: '对象已存在：{name}（可开启「生成删除语句」或先清理目标库）',
      execErrDepends: '目标库还有其他对象依赖它，无法直接删除：打开设置里的「级联删除（DROP ... CASCADE）」后重新转换，或先按依赖顺序删除引用它的对象。{detail}',
      execErrPermission: '权限不足：{detail}',
      execErrSyntax: '目标库不支持该语法：{detail}',
      execErrMissing: '依赖对象不存在：{detail}',
      pgAutonomousUnsupported: 'PG 模式无法保留 Oracle 自治事务。请重新设计独立事务边界，或使用支持该语法的 Oracle 兼容目标。',
      pgPackageNeedsRewrite: '转换结果仍包含 Oracle 包声明，需要先改写为 PG 支持的对象。',
      welcomeTaskTitle: '从一次转换任务开始',
      welcomeTaskSub: '任务详情按任务工作：选择任务后会自动带出源库、目标库、对象类型与兼容模式',
      taskRead: '读取对象',
      taskEdit: '编辑任务',
      taskStepFetch: '获取',
      taskStepConvert: '转换',
      taskStepExecute: '执行',
      taskStepExecutePartial: '部分已执行',
      taskStepExecutePartialHint: '{done} / {total} 个对象执行成功',
      taskStepFetchHint: '从源库读取对象 DDL',
      taskStepConvertHint: '把源 SQL 转换为目标端语法',
      taskStepExecuteHint: '在目标库执行转换结果',
      taskOpen: '打开任务',
      taskSaved: '任务已保存',
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
      homeStatSuccess: '转换成功率',
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
      homeConnectionStatus: '连接状态',
      homeSideSources: '源库连接',
      homeSideTargets: '目标库连接',
      homeDashOverview: '运行概览',
      homeStatExecuted: '目标库执行成功',
      homeStatExecutionFoot: '{failed} 个执行失败',
      homeStatAttempted: '{done} / {total} 个转换成功',
      homeReadFailed: '获取失败',
      homeReviewRequired: '待复核',
      homeExecFailed: '执行失败',
      homeConvertPending: '待转换',
      homeReadPending: '待获取',
      homeExecutePending: '待执行',
      homeTaskComplete: '已完成',
      homeTaskCounts: '{read} 已获取 · {converted} 已转换 · {executed} 已执行',
      homeBindConnection: '未绑定，去配置',
      homeSideRecentTitle: '任务进度',
      homeSideRecentEmpty: '暂无任务',
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
      homeFooterLeft: 'HGDB Convert Studio · 本地优先 · 数据不离开工作区',
      homeFooterRight: 'v{version} · 规则库已加载',
      homeTimeJustNow: '刚刚',
      homeTimeMinutes: '{count} 分钟前',
      homeTimeHours: '{count} 小时前',
      homeTimeDays: '{count} 天前',
      themeDark: '切换到深色模式',
      themeLight: '切换到浅色模式',
      connectionsPageEyebrow: 'CONNECTION REGISTRY',
      connectionsPageDesc: '左侧源库、右侧目标库；连接只保存在本机浏览器',
      workspaceTitle: '任务详情',
      workspaceEyebrow: 'CONVERSION WORKSPACE',
      currentTask: '当前任务',
      currentTaskLeave: '退出任务',
      currentTaskLeaveHint: '退出任务上下文；任务下的 SQL 仍保留在工作台。',
      workbarSource: '源端',
      workbarTarget: '目标端',
      workbarLocal: '本地 SQL',
      workbarConvert: '转换全部',
      workbarConvertAllHint: '转换当前任务下的全部 SQL',
      workbarExecuteAllHint: '把当前任务下已转换的 SQL 全部执行到目标库',
      workbarExportAllHint: '导出当前任务下全部转换结果（多个文件打包为 zip）',
      workbarExecute: '执行全部',
      workbarRetryFailed: '重跑失败',
      workbarRetryFailedHint: '只执行当前列表中仍为执行失败且有转换结果的对象',
      workbarExport: '导出结果',
      workbarReport: '下载报告',
      workbarReportHint: '导出当前任务的转换报告（Markdown：概览、对象明细、规则、风险、执行失败）',
      workbarReportCsvHint: '导出对象明细为 CSV（Excel 可直接打开），便于筛选与统计',
      reportDone: '已导出报告 {name}',
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
      paneTabResult: '结果',
      paneTabDiff: '差异',
      paneTabRules: '规则',
      paneTabExec: '执行',
      paneTabLocked: '先转换当前对象，生成结果后才能查看',
      ruleCatType: '类型映射',
      ruleCatFunction: '函数改写',
      ruleCatSyntax: '语法与 DDL',
      ruleCatPlsql: 'PL/SQL 与例程',
      ruleCatObject: '对象与权限',
      ruleCatRisk: '风险提示',
      ruleCountTimes: '{count} 次',
      ruleEmpty: '本次转换没有记录到规则命中。',
      ruleAiHint: '本文件由「AI 在线转换」生成，按语义改写，未逐条记录规则；可切到「差异」查看具体改动。',
      ruleLevelHigh: '高',
      ruleLevelMid: '中',
      ruleLevelLow: '低',
      ruleSampleTitle: '示例',
      ruleLocate: '定位到源码',
      tabCountRules: '{count}',
      diffOnly: '仅差异',
      diffStat: '+{added} / -{removed}',
      execPanelOk: '执行成功',
      execPanelFail: '执行失败',
      execPanelIdle: '尚未执行',
      execPanelAt: '执行时间',
      execPanelDuration: '耗时',
      execPanelStatements: '语句数',
      execPanelTarget: '目标库',
      execPanelError: '错误信息',
      execPanelRaw: '原始错误',
      execPanelHint: '常见处理：开启「生成删除语句」避免对象冲突、先执行被依赖的对象。',
      homeWeekMon: '周一',
      homeWeekTue: '周二',
      homeWeekWed: '周三',
      homeWeekThu: '周四',
      homeWeekFri: '周五',
      homeWeekSat: '周六',
      homeWeekSun: '周日',
    }

    const en = {
      nav: 'HGDB Convert Studio',
      title: 'HGDB Convert Studio',
      subtitle: 'Hand Oracle / MySQL / SQL Server tables, views, routines and packages to the hgdb-convert-studio agent.',
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
      block: 'Anonymous block / routine',
      schema: 'Target schema',
      schemaEmpty: 'No schemas available',
      schemaHint: 'Empty keeps the source schema',
      compat: 'Target compatibility mode enabled',
      compatHint: 'Prefer the source dialect when the target supports it; unverified constructs follow HGDB V9 standard.',
      sourceSql: 'Source SQL',
      sourceTabDeps: 'Dependencies',
      sourceTabDepsBadge: '{count}',
      depsEmpty: 'No dependency detected in this SQL.',
      depsEmptyUnread: 'Read objects from the source database, or paste SQL, then check dependencies.',
      depsMissing: 'Not loaded',
      depsLoaded: 'Loaded',
      depsHint: 'Dependencies detected statically (FROM / JOIN / INTO / UPDATE / REFERENCES / CALL); source tasks read them from the database automatically.',
      depsOpen: 'Open this object',
      depsCount: '{loaded} loaded · {missing} not loaded',
      depsNeedSetting: 'Enable “Fetch dependency objects” in Settings → Conversion options to show this tab.',
      depsFetch: 'Get dependencies',
      depsFetchHint: 'Read the tables, views and routines this object depends on, with DDL',
      depsRefetch: 'Refresh dependencies',
      depsHostStale: 'The host has no dependency endpoint (HTTP 404). Restart DSH and try again; static detection is shown until then.',
      depsFetching: 'Reading dependencies…',
      depsStaticHint: 'Static detection only; reading dependencies from the source now, or click “Get dependencies” to retry.',
      depsDbEmpty: 'The source returned no dependencies.',
      depsNoDeps: 'This object has no dependencies in the source.',
      depsNoDepsHint: 'The source catalog lists nothing it references (for example a standalone table without foreign keys).',
      depsFetchEmptyHint: 'The endpoint returned nothing; check the source connection and object name.',
      depsLocalLoaded: 'In workspace',
      depsDbOnly: 'Source only',
      depsStaticOnly: 'Static guess',
      depsCountEmpty: 'Source returned none',
      depsNoneShort: 'No dependencies',
      depsStaticListHint: 'The source returned no dependencies; the list below is static detection only.',
      depsShowDdl: 'Show DDL',
      depsHideDdl: 'Hide DDL',
      depsCopyDdl: 'Copy DDL',
      depsNoDdl: 'No DDL returned for this object',
      depsDdlLoading: 'Loading…',
      depsLoadingHint: 'Reading this object dependencies from the source; the list appears automatically.',
      depsNeedSource: 'This task has no source connection, so dependencies cannot be read from the database.',
      depsNeedObjects: 'No objects read yet — use the download button above to read them from the source.',
      sqlPlaceholder: 'Paste the SQL to convert…',
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
      flowHint: 'The session selects the "HGDB Convert Studio" agent and fills this request into the composer; press Enter to start.',
      preset: 'Agent: hgdb-convert-studio',
      pageTitle: 'HGDB Convert Studio',
      welcomeTitle: 'Start SQL conversion',
      welcomeSub: 'Read objects from a source connection, or paste/load sample SQL',
      welcomeRead: 'Read source',
      welcomeSample: 'Load sample',
      welcomeNew: 'New SQL',
      introText: "Read, convert and run the task's objects against HGDB V9",
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
      'warn.set': 'SET maps to text[] + CHECK (<@ allowed values) by a generic rule; writes need array literals',
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
      treeExpandAll: 'Expand all',
      treeCollapseAll: 'Collapse all',
      treeLocate: 'Locate current SQL',
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
      sourceNotReadHint: 'Source mode does not accept pasted SQL. Use the download button above to read objects from the database.',
      sourceNotReadList: 'No objects read yet',
      searchNoMatch: 'No matching SQL files',
      readConnUnreachable: 'Cannot reach the source database \u2014 check the host, port, database or service name, and firewall or VPN. Raw error: {detail}',
      readAuthFailed: 'The source database rejected the username/password. Raw error: {detail}',
      readLinkDropped: 'The connection to the source was dropped (network hiccup or timeout) and the automatic retry failed; check the network and try again. {detail}',
      connTestTimeout: 'The connection test did not finish in time. {detail}',
      connTestFrontTimeout: 'Frontend wait timed out after 45s: the host did not respond. Make sure DSH runs the latest build and check whether the port is blocked by a firewall or proxy.',
      connTestElapsed: ' ({seconds}s)',
      connTestNotOracle: 'This port is not an Oracle listener (the handshake was dropped). If this is HGDB-V9-Oracle, pick that type instead. {detail}',
      connTestClosed: 'The server closed the connection during the handshake: the port does not speak this database protocol, or the instance is not ready. Verify the instance and its listening port. {detail}',
      connTestRefused: 'The target refused the connection: the port is closed or blocked by a firewall. {detail}',
      readServiceMissing: 'The service_name/SID or database does not exist on the source. Raw error: {detail}',
      readMysqlPublicKey: 'MySQL rejected the login (public key retrieval). Use useSSL=false&allowPublicKeyRetrieval=true or a caching_sha2_password compatible account. Raw error: {detail}',
      jobReadTitle: 'Reading source objects',
      jobConvertTitle: 'Converting SQL',
      jobExecuteTitle: 'Executing on target',
      jobStop: 'Stop execution',
      jobStopRead: 'Stop reading',
      jobStopConvert: 'Stop conversion',
      jobReadStopped: 'Reading stopped',
      jobConvertStopped: 'Conversion stopped',
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
      read: 'Read objects',
      readHint: 'Read objects from the source database',
      reading: 'Reading…',
      readObjects: 'Read {count} objects',
      readObjectsInvalid: 'The source returned an invalid object list',
      readSourceMissing: 'Select a source first',
      targetEnd: 'Target',
      readUnsupported: 'Reading objects from {engine} is not supported yet',
      sourceConnMissing: 'Add an {engine} connection in Connections first',
      filterConv: 'Convert',
      filterAll: 'All',
      filterDone: 'Converted',
      filterPending: 'Pending',
      filterFailed: 'Convert failed',
      filterExec: 'Execution',
      filterExecDone: 'Executed',
      filterExecPending: 'Not executed',
      filterExecFailed: 'Exec failed',
      filterWarn: 'Needs review',
      typeAll: 'All types',
      typeUnspecified: 'Unspecified',
      targetDb: 'Target database',

      modeSql: 'SQL text',
      modeDir: 'Directory',
      pageSqlPlaceholder: 'Paste SQL, or click Import to select a file',

      homeNav: 'Project overview',
      homeSettings: 'System settings',
      settingsTitle: 'System settings',
      settingsDesc: 'Theme, local data and version information',
      settingsAppearance: 'Appearance',
      settingsTheme: 'Theme',
      settingsThemeHint: 'Light or dark; remembered on this machine',
      settingsThemeLight: 'Light',
      settingsThemeDark: 'Dark',
      settingsLanguage: 'Language',
      settingsLanguageHint: 'Switches the interface language; the choice is stored locally',
      langZh: '中文',
      langEn: 'English',
      langSwitchToEn: 'Switch to English',
      langSwitchToZh: 'Switch to Chinese',
      settingsConvertOptions: 'Conversion options',
      settingsDropTitle: 'Generate drop statements',
      settingsDropHint: 'Emit DROP ... IF EXISTS before CREATE so the target can be re-run',
      settingsCascadeTitle: 'Cascade drop (DROP ... CASCADE)',
      settingsCascadeHint: 'Also drops dependent objects; only needed when dependencies are unknown',
      settingsCascadeConfirm: 'Every object depending on it will be dropped too and is not recreated automatically. Be careful on production databases.\n\nEnable now?',
      settingsDepsTitle: 'Auto-read dependencies with objects',
      settingsDepsHint: 'When on, fetching objects also reads their dependencies from the source; when off, use “Get dependencies” manually',
      settingsOn: 'On',
      settingsOff: 'Off',
      settingsData: 'Local data',
      taskCleanup: 'Clean task data',
      taskCleanupSource: 'Source SQL',
      taskCleanupSourceHint: 'Remove objects and their conversion results, logs and cached dependencies.',
      taskCleanupConverted: 'Converted SQL',
      taskCleanupConvertedHint: 'Keep the source SQL and reset conversion and execution status.',
      taskCleanupLogs: 'Logs',
      taskCleanupLogsHint: 'Clear read, conversion and execution diagnostics while keeping status.',
      taskCleanupApply: 'Clear selected',
      taskCleanupDone: 'Selected task data cleared',
      settingsClearFetched: 'Clear fetched SQL',
      settingsClearFetchedHint: 'Removes object SQL read from source databases; tasks, their connections and local SQL stay.',
      settingsClearFetchedConfirm: 'Clear all object SQL fetched from source databases? Tasks, connections and local SQL stay.',
      settingsClearedFetched: 'Fetched SQL cleared',
      settingsClearConverted: 'Clear conversion results',
      settingsClearConvertedHint: 'Clears conversion and execution results; SQL text, tasks and connections stay.',
      settingsClearConvertedConfirm: 'Clear all conversion and execution results? SQL text, tasks and connections stay.',
      settingsClearedConverted: 'Conversion results cleared',
      settingsCleanupAction: 'Clear',
      reportUntitledTask: 'Untitled task',
      reportLocalSql: 'Local SQL',
      reportUnset: 'Not set',
      reportSchemaDefault: 'default',
      reportErrorLine: '- Error: {detail}',
      reportTimeLine: '- Time: {time}',
      reportCellNone: '-',
      reportObject: 'Object',
      reportType: 'Type',
      reportTitle: '# Conversion report · {name}',
      reportGeneratedAt: '- Generated: {time}',
      reportSourceLine: '- Source: {value}',
      reportTargetLine: '- Target: {value}',
      reportSchemaLine: '- Target schema: {value}',
      reportCompatLine: '- Compatibility: {value}',
      reportMetricObjects: '| Objects | {value} |',
      reportMetricConverted: '| Converted | {value} |',
      reportMetricConvertFailed: '| Convert failed | {value} |',
      reportMetricRuleHits: '| Rule hits | {value} |',
      reportMetricRiskObjects: '| Objects with risks | {value} |',
      reportMetricExecOk: '| Executed | {value} |',
      reportMetricExecFailed: '| Exec failed | {value} |',
      reportMetricNotExec: '| Not executed | {value} |',
      reportMetricNotExecRow: '| Not executed | (not run against the target yet) |',
      reportOverview: '## Overview',
      reportMetricHead: '| Metric | Value |',
      reportNotExecutedRow: '| Not executed | (not run against the target yet) |',
      reportObjectsHead: '## Objects',
      reportObjectsCols: '| Object | Type | Convert | Rules | Risks | Exec |',
      reportRulesHead: '## Rule hits',
      reportRisksHead: '## Risk items',
      reportExecFailHead: '## Execution failures',
      reportRisksCols: '| Risk | Level | Objects |',
      reportExecFailCols: '| Object | Level | Error |',
      reportUnknownError: 'Unknown error',
      reportOk: 'OK',
      reportFail: 'Failed',
      reportNotExec: 'Not executed',
      reportConverted: 'Converted',
      reportNotConverted: 'Not converted',
      reportExecOk: 'OK',
      reportExecFail: 'Failed',
      reportState: 'Conversion status',
      reportRuleHits: 'Rule hits',
      reportRuleDetail: 'Rule detail',
      reportRisks: 'Risks',
      reportExecState: 'Execution status',
      reportExecError: 'Execution error',
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
      tasksDesc: 'Create tasks by source, target and compatibility mode; track reads, conversions and runs',
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
      taskNoSourceConn: 'No source database connection yet.',
      taskNoTargetConn: 'No target connection yet. Add one in Connections first.',
      taskGoConnections: 'Add a connection',
      taskPickFiles: 'Choose SQL files',
      taskPickedFiles: '{count} files selected',
      taskNoFilePicked: 'No files selected yet',
      taskKeepFiles: 'Without new files, the SQL already in this task is kept; newly chosen files are appended.',
      taskSqlLabel: 'SQL content',
      taskSqlPlaceholder: 'Paste the SQL to convert…',
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
      compatShortPostgresql: 'PostgreSQL compat',
      compatShortOracle: 'Oracle compat',
      compatShortMysql: 'MySQL compat',
      compatShortSqlserver: 'SQL Server compat',
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
      execMarkDone: 'Executed on target',
      execMarkFailed: 'Execution failed',
      execMarkIdle: 'Not executed yet',
      execDropping: 'Dropping existing objects in dependency order ({count})…',
      execRunning: 'Executing…',
      execHostStale: 'The host has no execution endpoint (HTTP 404). Restart DSH and try again',
      execErrNoSchema: 'Schema “{schema}” is missing and could not be created: create it manually or pick an existing schema',
      execErrExists: 'Object already exists: {name} (enable “Generate drop statements” or clean the target first)',
      execErrDepends: 'Other objects depend on it, so it cannot be dropped: turn on “Cascade drop (DROP ... CASCADE)” and re-convert, or drop the dependent objects first. {detail}',
      execErrPermission: 'Permission denied: {detail}',
      execErrSyntax: 'The target rejected this syntax: {detail}',
      execErrMissing: 'A dependency is missing: {detail}',
      pgAutonomousUnsupported: 'PG mode cannot preserve Oracle autonomous transactions. Redesign the independent transaction boundary or use an Oracle-compatible target that supports it.',
      pgPackageNeedsRewrite: 'The result still declares an Oracle package. Rewrite it into objects supported by PG.',
      welcomeTaskTitle: 'Start with a conversion task',
      welcomeTaskSub: 'Task detail works by task: picking one brings its source, target, object types, and compatibility mode along',
      taskRead: 'Read objects',
      taskEdit: 'Edit task',
      taskStepFetch: 'Fetch',
      taskStepConvert: 'Convert',
      taskStepExecute: 'Run',
      taskStepExecutePartial: 'Partially run',
      taskStepExecutePartialHint: '{done} of {total} objects executed successfully',
      taskStepFetchHint: 'Read object DDL from the source database',
      taskStepConvertHint: 'Rewrite source SQL for the target dialect',
      taskStepExecuteHint: 'Execute the converted SQL on the target database',
      taskOpen: 'Open task',
      taskSaved: 'Task saved',
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
      homeStatSuccess: 'Conversion success rate',
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
      homeConnectionStatus: 'Connections',
      homeSideSources: 'Sources',
      homeSideTargets: 'Targets',
      homeDashOverview: 'Overview',
      homeStatExecuted: 'Executed on target',
      homeStatExecutionFoot: '{failed} execution failures',
      homeStatAttempted: '{done} / {total} converted',
      homeReadFailed: 'Read failed',
      homeReviewRequired: 'Needs review',
      homeExecFailed: 'Execution failed',
      homeConvertPending: 'Pending conversion',
      homeReadPending: 'Pending read',
      homeExecutePending: 'Pending execution',
      homeTaskComplete: 'Complete',
      homeTaskCounts: '{read} read · {converted} converted · {executed} executed',
      homeBindConnection: 'Unbound · Configure',
      homeSideRecentTitle: 'Task progress',
      homeSideRecentEmpty: 'No tasks yet',
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
      homeFooterLeft: 'HGDB Convert Studio · local-first · data never leaves the workspace',
      homeFooterRight: 'v{version} · rule library loaded',
      homeTimeJustNow: 'just now',
      homeTimeMinutes: '{count} min ago',
      homeTimeHours: '{count} h ago',
      homeTimeDays: '{count} d ago',
      themeDark: 'Switch to dark mode',
      themeLight: 'Switch to light mode',
      connectionsPageEyebrow: 'CONNECTION REGISTRY',
      connectionsPageDesc: 'Sources on the left, targets on the right; connections stay in this browser',
      workspaceTitle: 'Task detail',
      workspaceEyebrow: 'CONVERSION WORKSPACE',
      currentTask: 'Current task',
      currentTaskLeave: 'Leave',
      currentTaskLeaveHint: 'Leave this task context; its SQL files stay in the workspace.',
      workbarSource: 'Source',
      workbarTarget: 'Target',
      workbarLocal: 'Local SQL',
      workbarConvert: 'Convert all',
      workbarConvertAllHint: 'Convert every SQL in the current task',
      workbarExecuteAllHint: 'Execute every converted SQL of the task on the target database',
      workbarExportAllHint: 'Export all conversion results of the task as one zip',
      workbarExecute: 'Execute all',
      workbarRetryFailed: 'Retry failed',
      workbarRetryFailedHint: 'Run only objects in the current list that still show an execution failure and have converted SQL',
      workbarExport: 'Export results',
      workbarReport: 'Download report',
      workbarReportHint: 'Export a conversion report for this task (Markdown: summary, objects, rules, risks, failures)',
      workbarReportCsvHint: 'Export the object table as CSV (opens in Excel) for filtering and counting',
      reportDone: 'Report exported: {name}',
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
      paneTabResult: 'Result',
      paneTabDiff: 'Diff',
      paneTabRules: 'Rules',
      paneTabExec: 'Run',
      paneTabLocked: 'Convert this object first to see the result',
      ruleCatType: 'Type mapping',
      ruleCatFunction: 'Functions',
      ruleCatSyntax: 'Syntax & DDL',
      ruleCatPlsql: 'PL/SQL & routines',
      ruleCatObject: 'Objects & grants',
      ruleCatRisk: 'Risks',
      ruleCountTimes: '{count}×',
      ruleEmpty: 'No rule hits recorded for this conversion.',
      ruleAiHint: 'This file came from AI conversion; rules are not tracked per rewrite. Check the Diff tab for the actual changes.',
      ruleLevelHigh: 'High',
      ruleLevelMid: 'Med',
      ruleLevelLow: 'Low',
      ruleSampleTitle: 'Samples',
      ruleLocate: 'Locate in source',
      tabCountRules: '{count}',
      diffOnly: 'Changes only',
      diffStat: '+{added} / -{removed}',
      execPanelOk: 'Executed',
      execPanelFail: 'Failed',
      execPanelIdle: 'Not executed yet',
      execPanelAt: 'At',
      execPanelDuration: 'Duration',
      execPanelStatements: 'Statements',
      execPanelTarget: 'Target',
      execPanelError: 'Error',
      execPanelRaw: 'Raw error',
      execPanelHint: 'Common fixes: enable “Generate drop statements” to avoid conflicts, and run dependency objects first.',
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
        block: '匿名块 / 例程片段',
      }
      const typeText = typeNames[objectType] ?? objectType
      return [
        '你是 Oracle→HGDB V9 转换智能体。请把下面的 Oracle 对象转换为瀚高 HGDB V9 可编译的语法。',
        '',
        '## 转换约束',
        `1. 对象类型：${typeText}`,
        `2. 目标 schema：${schema.trim() || '沿用源 schema（未指定）'}`,
        `3. 目标端 Oracle 兼容模式：${compat ? '已启用。本次输出必须保持源端 Oracle 语法与写法：不要添加 $$ / LANGUAGE plpgsql，不要改写 NVL、DECODE、ROWNUM、SYSDATE、序列、包、%TYPE 等；仅做空白与格式整理。但标识符必须归一：schema 与对象名写成小写、不加双引号（目标 schema 由执行器建为小写；带引号的大写名只在 Oracle 兼容实例上碰巧能匹配到小写对象，PG 形态目标会直接报 schema "TEST" does not exist）。只有确认兼容模式下无法编译的写法才做最小改写并标注原因。此要求优先于任何默认的 HGDB V9 改写规则' : '未启用。全部改写为 HGDB V9 标准语法，不依赖兼容模式'}`,
        '4. 语义等价优先：空串/NULL、CHAR 补空格、DATE 精度、ROWNUM 求值时机、提交语义、包级状态、自治事务，都必须显式处理。',
        ...(drop === true
          ? ['5. 生成删除语句：在 CREATE 之前输出对应的 DROP ... IF EXISTS（表/视图/物化视图/函数/过程/触发器/包/序列/类型/同义词），便于在目标库重复执行；函数与存储过程必须带输入参数类型（`DROP FUNCTION IF EXISTS 名称(参数类型, ...)`，无参数写 `名称()`），否则目标库有同名重载会报 not unique；触发器用 DROP TRIGGER IF EXISTS 名称 ON 表名。']
          : []),
        '5. 标识符大小写：schema 与对象名一律输出小写、不加双引号（兼容模式也一样：目标 schema 由执行器建为小写；带引号的大写名只在 Oracle 兼容实例上碰巧能匹配到小写对象，PG 形态目标会报 schema "TEST" does not exist）；只有保留字或必须区分大小写时才加双引号，且全链路保持一致。',
        '6. 输出完整可执行 SQL，不要用省略号或伪代码。',
        '7. 逐项转换输入中的全部 SQL 对象，保持原顺序：直接给出结果，不要调用任何工具、不要读取技能文件、不要创建待办或中间文件。',
        ...(!compat ? ['PG 行级触发器：输出 RETURNS trigger 的 PL/pgSQL 函数与独立的 CREATE TRIGGER ... EXECUTE FUNCTION。将 :NEW/:OLD 改为 NEW/OLD，事件谓词改用 TG_OP。函数末尾使用 IF TG_OP = \'INSERT\' OR TG_OP = \'UPDATE\' THEN RETURN NEW; ELSE RETURN OLD; END IF;。'] : []),
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
        '2. 仅在有转换风险时附一条简短说明',
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
        '你是 SQL Server(T-SQL)→瀚高 HGDB V9 转换智能体。把下面的 SQL Server 对象转换为 HGDB V9（PostgreSQL 协议，标准语法）可执行 SQL。',
        '',
        '## 转换约束',
        `1. 目标 schema：${(schema ?? '').trim() || '沿用源 schema（未指定）'}`,
        '2. 语义等价优先：NULL/空串、排序规则、DATETIME 精度、IDENTITY、事务与锁语义必须显式处理。',
        '3. 标识符：去掉 [ ] 与 dbo. 前缀，普通标识符转小写；必须区分大小写时用双引号。',
        '4. 类型：NVARCHAR/NCHAR→VARCHAR/TEXT，DATETIME/DATETIME2/SMALLDATETIME→TIMESTAMP，BIT→BOOLEAN，MONEY/SMALLMONEY→NUMERIC，UNIQUEIDENTIFIER→UUID，VARBINARY/IMAGE→BYTEA，IDENTITY→GENERATED BY DEFAULT AS IDENTITY。',
        '5. 函数与查询：GETDATE()/GETUTCDATE()→CURRENT_TIMESTAMP，ISNULL→COALESCE，LEN→LENGTH，CHARINDEX→POSITION，DATEADD/DATEDIFF→interval 运算，TOP n→LIMIT n，OFFSET…FETCH→LIMIT/OFFSET，IIF→CASE，FOR XML PATH→STRING_AGG。',
        '6. 批处理与控制流：删除 GO 分隔符；@变量 改为 v_变量；BEGIN TRY/CATCH→BEGIN … EXCEPTION；存储过程与触发器改为 PL/pgSQL。',
        '7. 输出完整可执行 SQL，不要用省略号或伪代码。',
        ...(drop === true ? ['8. 在 CREATE 之前输出对应的 DROP ... IF EXISTS（表/视图/函数/过程/触发器/包/序列/类型）；MySQL 兼容目标不要输出 DROP TRIGGER（不支持），触发器改为先 DROP 后重建整个对象。'] : []),
        '',
        '## 输出格式',
        '1. 转换后的完整 SQL（用 ```sql 代码块）',
        '2. 仅在有转换风险时附一条简短说明',
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
        '1. SET(\'a\',\'b\') 类型 → text[] DEFAULT \'{}\' CHECK (col <@ ARRAY[\'a\',\'b\']::text[])（多值语义，写入传数组）；MySQL 兼容目标保留原样。',
        '2. 空间类型（GEOMETRY/POINT/LINESTRING/POLYGON 等）→ BYTEA/TEXT；SPATIAL KEY → 删除并说明。',
        '3. PARTITION BY ... → 删除分区子句。',
        '4. 视图上的 ALGORITHM=... / SQL SECURITY ... / DEFINER=... → 删除，保留 CREATE VIEW。',
        '5. utf8mb4_0900_* 排序规则 → utf8mb4_unicode_ci。',
        '6. JSON_EXTRACT(json, \'$.a.b\') → json ->> \'a\' 或 json #>> \'{a,b}\'。',
        '7. FOUND_ROWS() 不存在 → 用 COUNT(*) 或改写查询。',
        '8. 目标自带 plmysql 过程语言：函数/过程/触发器使用 LANGUAGE plmysql 外壳，过程体保留 MySQL 写法（SET、ELSEIF、DATE_FORMAT、IFNULL 等），只需修正 SIGNAL→RAISE、WHILE DO→LOOP、标签、handler 等差异；EVENT 仍改写为 pgAgent/pg_cron。',
        '9. DROP TRIGGER 不支持 → 改写为 DROP FUNCTION IF EXISTS <触发器名>_fn() CASCADE。',
        '',
        '## 约束',
        `1. 目标 schema：${(schema ?? '').trim() || '沿用源 schema（未指定）'}`,
        '2. 不要为了“看起来像 PostgreSQL”而改写已支持的 MySQL 写法；保持列类型、索引、默认值、注释与语义不变。',
        '3. 改写不支持项时优先保证语义等价，并在输出后列出关键改动。',
        '4. 输出完整可执行 SQL，不要用省略号或伪代码。',
        ...(drop === true ? ['5. 在 CREATE 之前输出对应的 DROP ... IF EXISTS（表/视图/函数/过程/触发器/包/序列/类型）；触发器写 DROP TRIGGER IF EXISTS 名称 ON 表名。'] : []),
        '',
        '## 输出格式',
        '1. 转换后的完整 SQL（用 ```sql 代码块）',
        '2. 仅在有转换风险时附一条简短说明',
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
        '你是 MySQL→瀚高 HGDB V9 转换智能体。目标是 HGDB V9 的 PostgreSQL / Oracle 形态（PG 协议，按标准语法执行），请把下面的 MySQL 对象完整改写为可执行 SQL。',
        '',
        '## 转换约束',
        `1. 目标 schema：${schema.trim() || '沿用源 schema（未指定）'}`,
        '2. 不使用 Oracle 兼容模式：全部按 HGDB V9 标准写法输出。',
        '3. 标识符：反引号改为小写无引号；保留字或必须区分大小写时才加双引号。',
        '4. 语义等价优先：自增、ON UPDATE CURRENT_TIMESTAMP、无符号整数范围、零日期、ENUM/SET、字符集与排序规则、索引前缀、外键动作都必须显式处理。',
        '5. 输出完整可执行 SQL，不要用省略号或伪代码。',
        ...(drop === true
          ? ['6. 生成删除语句：在 CREATE 之前输出对应的 DROP ... IF EXISTS（含触发器、包、序列、同义词），便于在目标库重复执行。']
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
        '2. 仅在有转换风险时附一条简短说明',
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
    function hasOracleAutonomousTransaction(sql) {
      const code = splitSql(typeof sql === 'string' ? sql : '').map(part => part.kind === 'code' ? part.text : ' ').join('')
      return /\bPRAGMA\s+AUTONOMOUS_TRANSACTION\s*;/i.test(code)
    }

    function onlineConversionResult(text, options = {}) {
      // 与本地转换共用同一套标识符归一与 DROP 规则，避免两条路径分叉
      const marked = onlineSqlResult(text)
      const header = '--在线转换\n'
      const body = normalizeQuotedIdentifiers(marked.startsWith(header) ? marked.slice(header.length) : marked)
      const source = typeof options.sourceSql === 'string' ? options.sourceSql.trim() : ''
      const compat = options.compat === true
      if (!compat && options.target !== 'mysql'
        && (hasOracleAutonomousTransaction(source) || hasOracleAutonomousTransaction(body))) {
        throw new Error(options.autonomousMessage ?? en.pgAutonomousUnsupported)
      }
      if (!compat && options.target !== 'mysql' && /(?:^|;)\s*CREATE\s+(?:OR\s+REPLACE\s+)?PACKAGE\b/im.test(body)) {
        throw new Error(options.packageMessage ?? en.pgPackageNeedsRewrite)
      }
      const routine = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE|PACKAGE|TRIGGER|TYPE)\b/i
      const wrapper = /\$\$|\$[A-Za-z_][A-Za-z0-9_]*\$|LANGUAGE\s+plpgsql/i
      if (compat && routine.test(source) && wrapper.test(body) && !wrapper.test(source)) {
        return {
          text: `--在线转换（兼容模式：保留源端语法）\n${regenerateRoutineDrop(normalizeQuotedIdentifiers(source), options)}`,
          keptSource: true,
        }
      }
      const targetSql = !compat && options.target !== 'mysql' ? normalizePgCollectionType(normalizePgSequence(stripOracleIndexStatistics(body))) : body
      return { text: `${header}${regenerateRoutineDrop(targetSql, options)}`, keptSource: false }
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
        `- 目标端 Oracle 兼容模式：${compat ? '已启用。保持源端 Oracle 语法与写法，不添加 $$ / LANGUAGE plpgsql，不改写 NVL、DECODE、ROWNUM 等；但 schema 与对象名仍写成小写、不加双引号（目标 schema 由执行器以小写创建）；仅做格式整理，必要改写需标注原因。此要求优先于默认 HGDB V9 改写规则' : '未启用。全部使用 HGDB V9 标准写法，不依赖兼容模式'}`,
        '',
        '## 要求',
        '1. 先输出对象清单与依赖顺序（类型 → 序列 → 表 → 函数 → 过程 → 包 → 视图 → 触发器）。',
        `2. 按依赖顺序逐个转换，结果写入 ${out}/（保持源目录相对结构，一个对象一个 .sql）。`,
        `3. 生成 ${out}/CONVERSION_REPORT.md：对象清单、状态（自动/需人工/未支持）、关键改动、风险、未验证项。`,
        '4. 不删除源文件，不覆盖用户未确认的既有转换结果。',
        '5. 需要输出 DROP 前缀时，函数与存储过程必须带输入参数类型（`DROP FUNCTION IF EXISTS 名称(参数类型)`，无参数写 `名称()`），否则目标库有同名重载会报 not unique。',
        '6. 直接开始转换，不要逐条征求意见，也不要创建待办。',
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
      .hch-settings { display: flex; flex-direction: column; gap: 16px; max-width: 1040px; padding: 4px 2px 28px; color: var(--dsw-alias-label-primary); }
      .hch-settings h2 { margin: 0; font-size: 16px; font-weight: 600; }
      .hch-settings .hch-sub { margin: 6px 0 0; font-size: 12.5px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
      .hch-settings .hch-note { padding: 10px 12px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); font-size: 12.5px; line-height: 1.65; color: var(--dsw-alias-label-secondary); }
      .hch-settings .hch-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
      .hch-settings .hch-chip { padding: 2px 8px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
      .hch-settings .hch-card { display: flex; flex-direction: column; gap: 14px; padding: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
      .hch-settings .hch-seg { display: inline-flex; padding: 3px; gap: 3px; border-radius: 8px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); align-self: flex-start; }
      .hch-settings .hch-seg button { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); padding: 5px 12px; border-radius: 6px; font-size: 12.5px; cursor: pointer; }
      .hch-settings .hch-seg button[aria-pressed="true"] { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: 0 1px 2px rgba(0,0,0,.12); }
      .hch-settings .hch-row { display: flex; flex-wrap: wrap; gap: 12px; }
      .hch-settings .hch-field { display: flex; flex-direction: column; gap: 6px; flex: 1 1 240px; min-width: 0; }
      .hch-settings .hch-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .hch-settings .hch-hint { font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
      .hch-settings input[type="text"], .hch-settings select, .hch-settings textarea { width: 100%; box-sizing: border-box; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; padding: 7px 10px; font-size: 12.5px; line-height: 1.5; outline: none; }
      .hch-settings input[type="text"]:focus-visible, .hch-settings select:focus-visible, .hch-settings textarea:focus-visible { border-color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 24%, transparent); }
      .hch-settings textarea { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; resize: vertical; }
      .hch-settings textarea.hch-sql { min-height: 260px; tab-size: 2; }
      .hch-settings .hch-check { display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px; line-height: 1.55; }
      .hch-settings .hch-check input { margin-top: 3px; }
      .hch-settings details { border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 8px 12px; background: var(--dsw-alias-bg-layer-2); }
      .hch-settings summary { cursor: pointer; font-size: 12.5px; color: var(--dsw-alias-label-primary); }
      .hch-settings details textarea { margin-top: 10px; min-height: 220px; background: var(--dsw-alias-bg-layer-1); }
      .hch-settings .hch-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
      .hch-settings button.hch-primary, .hch-settings button.hch-secondary { border: 1px solid transparent; border-radius: 7px; font-size: 12.5px; padding: 7px 14px; cursor: pointer; }
      .hch-settings button.hch-primary { background: var(--dsw-alias-brand-primary); color: #fff; font-weight: 600; }
      .hch-settings button.hch-primary:disabled { opacity: .45; cursor: not-allowed; }
      .hch-settings button.hch-secondary { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l1); }
      .hch-settings .hch-status { font-size: 12px; color: var(--dsw-alias-label-secondary); min-height: 18px; }
      .hch-settings .hch-status[data-kind="error"] { color: var(--dsw-alias-state-error-primary); }
      .hch-settings .hch-status[data-kind="ok"] { color: var(--dsw-alias-state-success-primary); }
      .hch-settings .hch-meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
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
        { className: 'hch hch-settings' },
        h('style', null, CSS),
        h(
          'header',
          null,
          h('h2', null, t('title')),
          h('p', { className: 'hch-sub' }, t('subtitle')),
          h(
            'div',
            { className: 'hch-chips' },
            h('span', { className: 'hch-chip' }, 'FUNCTION'),
            h('span', { className: 'hch-chip' }, 'PROCEDURE'),
            h('span', { className: 'hch-chip' }, 'PACKAGE'),
            h('span', { className: 'hch-chip' }, 'VIEW'),
            h('span', { className: 'hch-chip' }, 'TRIGGER'),
            h('span', { className: 'hch-chip' }, 'PL/SQL'),
          ),
        ),
        h('div', { className: 'hch-note' }, t('intro')),
        h(
          'section',
          { className: 'hch-card' },
          h(
            'div',
            { className: 'hch-seg', role: 'group', 'aria-label': t('mode') },
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
                  { className: 'hch-row' },
                  h(
                    'div',
                    { className: 'hch-field' },
                    h('label', { className: 'hch-label', htmlFor: 'hch-type' }, t('objectType')),
                    h(
                      'select',
                      {
                        id: 'hch-type',
                        value: objectType,
                        onChange: (event) => setObjectType(event.target.value),
                      },
                      typeOptions.map(([value, label]) => h('option', { key: value, value }, label)),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'hch-field' },
                    h('label', { className: 'hch-label', htmlFor: 'hch-schema' }, t('schema')),
                    h('input', {
                      id: 'hch-schema',
                      type: 'text',
                      value: schema,
                      placeholder: 'app',
                      onChange: (event) => setSchema(event.target.value),
                    }),
                    h('span', { className: 'hch-hint' }, t('schemaHint')),
                  ),
                ),
                h(
                  'div',
                  { className: 'hch-field' },
                  h('label', { className: 'hch-label', htmlFor: 'hch-sql' }, t('sourceSql')),
                  h('textarea', {
                    id: 'hch-sql',
                    className: 'hch-sql',
                    spellCheck: false,
                    value: sql,
                    placeholder: t('sqlPlaceholder'),
                    onChange: (event) => setSql(event.target.value),
                  }),
                  h(
                    'div',
                    { className: 'hch-meta' },
                    h('span', null, sql.length + ' ' + t('chars')),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'hch-secondary',
                        style: { padding: '2px 8px', fontSize: '11.5px' },
                        onClick: onSample,
                      },
                      t('sample'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'hch-secondary',
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
                { className: 'hch-row' },
                h(
                  'div',
                  { className: 'hch-field' },
                  h('label', { className: 'hch-label', htmlFor: 'hch-src' }, t('srcDir')),
                  h('input', {
                    id: 'hch-src',
                    type: 'text',
                    value: srcDir,
                    placeholder: 'D:\\\\migration\\\\src',
                    onChange: (event) => setSrcDir(event.target.value),
                  }),
                  h('span', { className: 'hch-hint' }, t('srcDirHint')),
                ),
                h(
                  'div',
                  { className: 'hch-field' },
                  h('label', { className: 'hch-label', htmlFor: 'hch-out' }, t('outDir')),
                  h('input', {
                    id: 'hch-out',
                    type: 'text',
                    value: outDir,
                    placeholder: 'converted',
                    onChange: (event) => setOutDir(event.target.value),
                  }),
                  h('span', { className: 'hch-hint' }, t('outDirHint')),
                ),
              ),
          h(
            'label',
            { className: 'hch-check' },
            h('input', {
              type: 'checkbox',
              checked: compat,
              onChange: (event) => setCompat(event.target.checked),
            }),
            h('span', null, h('strong', null, t('compat')), h('br'), h('span', { className: 'hch-hint' }, t('compatHint'))),
          ),
          h(
            'details',
            null,
            h('summary', null, t('preview') + ' · ' + t('previewHint')),
            h('textarea', { readOnly: true, value: prompt, spellCheck: false, 'aria-label': t('preview') }),
          ),
          h(
            'div',
            { className: 'hch-actions' },
            h('button', { type: 'button', className: 'hch-primary', disabled: !valid, onClick: onConvert }, t('convert')),
            h('button', { type: 'button', className: 'hch-secondary', onClick: onCopy }, t('copy')),
            h('span', { className: 'hch-hint' }, t('preset')),
          ),
          h('div', { className: 'hch-status', 'data-kind': status.kind, role: 'status' }, status.text),
          h('div', { className: 'hch-hint' }, t('flowHint')),
        ),
      )
    }

    const PAGE_CSS = `
.hcs { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 1.5; }
.hcs-shell { box-sizing: border-box; display: flex; flex: 1; flex-direction: column; gap: 10px; width: 100%; max-width: none; min-height: 0; margin: 0 auto; padding: 14px 24px 0; }
[data-platform='darwin'] .hcs-shell { padding-top: calc(12px + var(--dsh-frame-top-clearance, 0px)); }
.hcs-body { display: grid; flex: 1; grid-template-columns: 252px minmax(0, 1fr) minmax(0, 1fr); gap: 10px; min-height: 0; }
.hcs-list { display: flex; flex-direction: column; min-height: 0; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.hcs-treeIcon { display: grid; flex: none; place-items: center; width: 16px; height: 16px; color: #2563eb; }
.hcs-fileStatus { display: grid; flex: none; place-items: center; width: 15px; height: 15px; color: var(--dsw-alias-label-secondary); }
.hcs-fileStatus[data-status='ok'] { color: #10b981; }
.hcs-fileStatus[data-status='error'] { color: #dc2626; }
.hcs-fileStatus[data-status='warn'] { color: #d97706; }
.hcs-fileStatus i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.hcs-fileExec { display: grid; flex: none; place-items: center; width: 14px; height: 14px; border: 0; border-radius: 50%; background: color-mix(in srgb, var(--dsw-alias-label-secondary) 62%, transparent); color: #fff; transition: background .15s ease, color .15s ease, transform .12s ease; }
.hcs-fileExec svg { transform: translateX(.3px); }
.hcs-fileExec[data-status='ok'] { background: #10b981; }
.hcs-fileExec[data-status='error'] { background: #dc2626; }
.hcs-fileExec[data-status='running'] { background: #2563eb; animation: hcs-execPulse 1.1s ease-in-out infinite; }
@keyframes hcs-execPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, .45); } 50% { box-shadow: 0 0 0 3px rgba(37, 99, 235, .18); } }
.hcs-groupHeadLeft svg { flex: none; color: #2563eb; }
.hcs-listHead { display: flex; gap: 6px; padding: 10px 8px 4px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.hcs-search { box-sizing: border-box; flex: 1; min-width: 0; height: 26px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; outline: none; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 11.5px; }
.hcs-search:focus { border-color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
.hcs-fileList { display: flex; flex: 1; flex-direction: column; gap: 2px; min-height: 0; overflow: auto; padding: 6px; }
.hcs-file { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; cursor: pointer; }
.hcs-file:hover { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
.hcs-fileActive { background: var(--dsw-alias-bg-layer-2); }
.hcs-file input { margin: 0; }
.hcs-fileName { flex: 1; min-width: 0; overflow: hidden; color: var(--dsw-alias-label-primary); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.hcs-fileNameInput { flex: 1; min-width: 0; height: 22px; padding: 0 6px; border: 1px solid #2563eb; border-radius: 5px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, #2563eb 16%, transparent); }
.hcs-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
.hcs-menu { position: fixed; z-index: 60; display: flex; flex-direction: column; min-width: 116px; padding: 4px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); box-shadow: 0 10px 28px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent); }
.hcs-menuItem { width: 100%; padding: 6px 10px; border: 0; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.hcs-menuItem:hover { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
.hcs-menuItem:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }
.hcs-dot[data-status='ok'] { background: var(--dsw-alias-state-success-primary); }
.hcs-dot[data-status='warn'] { background: var(--dsw-alias-state-warn-primary); }
.hcs-dot[data-status='error'] { background: var(--dsw-alias-state-error-primary); }
.hcs-treeActions { display: flex; flex: none; align-items: center; gap: 2px; }
.hcs-treeAction { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.hcs-treeAction:hover:not(:disabled) { background: rgba(96, 165, 250, .16); color: var(--dsw-alias-label-primary); }
.hcs-treeAction:disabled { opacity: .4; cursor: default; }
button.hcs-groupHead { font-family: inherit; text-align: left; border: 0; }
.hcs-listCount { flex: none; align-self: center; color: #2563eb; font-size: 11px; font-weight: 600; white-space: nowrap; }
.hcs-groupHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 6px 2px 2px; padding: 2px 6px; border-radius: 4px; background: color-mix(in srgb, #2563eb 6%, transparent); color: #1d4ed8; font-size: 10px; font-weight: 700; letter-spacing: .04em; cursor: pointer; user-select: none; }
.hcs-groupHead:hover { background: color-mix(in srgb, #2563eb 12%, transparent); }
.hcs-groupHeadLeft { display: flex; align-items: center; gap: 4px; }
.hcs-groupChevron { display: inline-block; width: 8px; font-size: 9px; text-align: center; }
.hcs-groupCount { color: var(--dsw-alias-label-secondary); font-weight: 600; }
.hcs-typeMenuActions .hcs-ghost { height: 24px; padding: 0 9px; border: 1px solid color-mix(in srgb, #2563eb 25%, var(--dsw-alias-border-l2)); border-radius: 6px; background: color-mix(in srgb, #2563eb 6%, transparent); color: #1d4ed8; font-size: 11px; }
.hcs-typeMenuActions .hcs-ghost:hover { background: color-mix(in srgb, #2563eb 14%, transparent); color: #1d4ed8; }
.hcs-sourceRows { display: flex; flex-direction: column; gap: 8px; padding: 10px 8px 10px; }
.hcs-sourceRow { display: flex; gap: 6px; }
.hcs-chipSelect { position: relative; flex: 1 1 0; min-width: 0; }
.hcs-filterTop { gap: 6px; padding-top: 8px; }
.hcs-filterStatus > .hcs-chipSelect { flex: 1 1 0; }
.hcs-filterTop .hcs-chipBtn { height: 28px; }
.hcs-sourceRow > .hcs-chipSelect { flex: 1 1 auto; }
.hcs-filterTop .hcs-chipLabel { font-size: 11.5px; }
.hcs-chipSelect.hcs-reportSelect { flex: none; }
.hcs-reportSelect > .hcs-chipMenu { left: auto; right: 0; min-width: 132px; }
.hcs-chipMenu { max-width: min(320px, 92vw); }
.hcs-chipBtn { display: flex; align-items: center; gap: 5px; width: 100%; height: 30px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; transition: border-color .15s ease, background .15s ease; }
.hcs-chipBtn:hover { border-color: color-mix(in srgb, #2563eb 38%, transparent); background: color-mix(in srgb, #2563eb 6%, transparent); }
.hcs-chipBtn[data-open='true'] { border-color: color-mix(in srgb, #2563eb 55%, transparent); background: color-mix(in srgb, #2563eb 9%, transparent); }
.hcs-chipBtn svg { flex: none; color: color-mix(in srgb, #2563eb 70%, var(--dsw-alias-label-secondary)); }
.hcs-chipLabel { flex: 1 1 auto; min-width: 0; overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.hcs-chipCaret { flex: none; color: var(--dsw-alias-label-secondary); font-size: 9px; line-height: 1; transform: translateY(-1px); }
.hcs-chipBtn[data-open='true'] .hcs-chipCaret { transform: translateY(-1px) rotate(180deg); }
.hcs-chipMenu { position: absolute; top: calc(100% + 4px); left: 0; z-index: 40; display: flex; flex-direction: column; gap: 1px; min-width: 100%; max-height: 240px; padding: 4px; overflow: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base)); box-shadow: 0 12px 28px rgba(15, 23, 42, .16); }
.hcs-chipItem { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; text-align: left; white-space: nowrap; cursor: pointer; }
.hcs-chipItem:hover { background: color-mix(in srgb, #2563eb 9%, transparent); }
.hcs-chipItem[aria-selected='true'] { background: color-mix(in srgb, #2563eb 14%, transparent); color: #1d4ed8; font-weight: 600; }
.hcs-chipItem svg { flex: none; color: #1d4ed8; }
.hcs-chipDot { flex: none; width: 11px; height: 1px; }
.hcs-readBtn { display: grid; flex: none; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-secondary); cursor: pointer; transition: border-color .15s ease, background .15s ease, color .15s ease, transform .12s ease; }
.hcs-readBtn:hover:not(:disabled) { border-color: color-mix(in srgb, #2563eb 42%, transparent); background: color-mix(in srgb, #2563eb 8%, transparent); color: #1d4ed8; }
.hcs-readBtn:active:not(:disabled) { transform: translateY(1px); }
.hcs-readBtn:disabled { opacity: .5; cursor: not-allowed; }
.hcs-readSpin { width: 13px; height: 13px; border-radius: 50%; border: 2px solid color-mix(in srgb, #2563eb 30%, transparent); border-top-color: #2563eb; animation: hcs-spinRing .9s linear infinite; }
@media (prefers-reduced-motion: reduce) { .hcs-readSpin { animation: none; }}
.hcs-target .hcs-select, .hcs-target .hcs-input { width: 100%; }
.hcs-schemaWrap .hcs-input { width: 100%; padding-right: 28px; }
.hcs-select { appearance: none; -webkit-appearance: none; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%2364748b' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/></svg>"); background-repeat: no-repeat; background-position: right 8px center; padding-right: 22px; }
.hcs-pane { display: flex; flex-direction: column; min-height: 0; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.hcs-paneHead { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 36px; padding: 4px 8px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.hcs-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 5px; margin-left: auto; }
.hcs-btn { display: inline-flex; align-items: center; justify-content: center; gap: 5px; height: 26px; padding: 0 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 11px; line-height: 1; white-space: nowrap; cursor: pointer; vertical-align: middle; }
.hcs-btn > svg, .hcs-ghost > svg { flex: none; }
.hcs-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); }
.hcs-btn:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
.hcs-chipBtn:disabled, .hcs-chip:disabled, .hcs-search:disabled { opacity: .45; cursor: not-allowed; }
.hcs-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.hcs-btnPrimary { border-color: transparent; background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-base); font-weight: 600; }
.hcs-btnPrimary:hover:not(:disabled) { background: var(--dsw-alias-label-primary); opacity: 0.9; }
.hcs-editor { display: flex; flex: 1; min-height: 0; background: var(--dsw-alias-bg-base); }
.hcs-editorPane { position: relative; display: flex; flex: 1; min-width: 0; min-height: 0; }
.hcs-highlight { position: absolute; inset: 0; box-sizing: border-box; margin: 0; padding: 9px 12px; overflow: hidden; color: var(--dsw-alias-label-primary); font-family: Consolas, "Cascadia Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 20px; white-space: pre; tab-size: 2; pointer-events: none; }
.hcs-highlight .sql-kw { color: #1d4ed8; font-weight: 600; }
.hcs-highlight .sql-str { color: #15803d; }
.hcs-highlight .sql-num { color: #c2410c; }
.hcs-highlight .sql-com { color: #8b949e; font-style: italic; }
.hcs-highlight .sql-ident { color: #7c3aed; }
.hcs-textarea.hcs-textareaOverlay { position: relative; z-index: 1; background: transparent; color: transparent; caret-color: var(--dsw-alias-label-primary); }
.hcs-textarea.hcs-textareaOverlay::selection { background: color-mix(in srgb, #2563eb 28%, transparent); color: transparent; }
.hcs-textarea.hcs-textareaOverlay::placeholder { color: var(--dsw-alias-label-secondary); }
.hcs-gutter { flex: none; box-sizing: border-box; width: 44px; padding: 9px 8px; overflow: hidden; border-right: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font-family: Consolas, "Cascadia Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 20px; text-align: right; white-space: pre; user-select: none; }
.hcs-textarea { box-sizing: border-box; flex: 1; min-width: 0; padding: 9px 12px; border: 0; outline: none; resize: none; background: transparent; color: var(--dsw-alias-label-primary); font-family: Consolas, "Cascadia Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 20px; tab-size: 2; }
.hcs-codeScroll { display: flex; flex: 1; min-height: 0; overflow: auto; background: var(--dsw-alias-bg-base); }
.hcs-code { margin: 0; padding: 9px 12px; color: var(--dsw-alias-label-primary); font-family: Consolas, "Cascadia Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; line-height: 20px; white-space: pre; }
.hcs-code .sql-kw { color: #1d4ed8; font-weight: 600; }
.hcs-code .sql-str { color: #15803d; }
.hcs-code .sql-num { color: #c2410c; }
.hcs-code .sql-com { color: #8b949e; font-style: italic; }
.hcs-code .sql-ident { color: #7c3aed; }
.hcs-code .sql-type { color: #0f766e; }
.hcs-highlight .sql-type { color: #0f766e; }
.hcs-emptyResult { margin: 0; padding: 24px 16px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.hcs-listEmpty { margin: 0; padding: 18px 10px; color: var(--dsw-alias-label-secondary); font-size: 11.5px; line-height: 1.6; text-align: center; }
.hcs-emptyState { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 10px; min-height: 0; padding: 24px; text-align: center; }
.hcs-emptyIcon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; background: color-mix(in srgb, #2563eb 10%, transparent); color: #2563eb; }
.hcs-emptyTitle { margin: 0; font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.hcs-emptyHint { max-width: 420px; margin: 0; color: var(--dsw-alias-label-secondary); font-size: 11.5px; line-height: 1.7; }
/* ==== 读取 / 转换 / 执行 动效 ==== */
@keyframes hcs-barSlide { 0% { transform: translateX(-110%); } 100% { transform: translateX(340%); } }
@keyframes hcs-sheen { 0% { left: -60%; } 100% { left: 130%; } }
@keyframes hcs-spinRing { to { transform: rotate(360deg); } }
@keyframes hcs-scanDown { 0% { top: -12%; opacity: 0; } 10% { opacity: .9; } 90% { opacity: .9; } 100% { top: 104%; opacity: 0; } }
@keyframes hcs-skelPulse { 0%, 100% { opacity: .4; } 50% { opacity: .85; } }
@keyframes hcs-execFlow { 0% { left: 0; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { left: calc(100% - 6px); opacity: 0; } }
.hcs-loadBar { position: relative; flex: none; height: 2px; overflow: hidden; background: color-mix(in srgb, #2563eb 12%, transparent); }
.hcs-loadBar > span { position: absolute; top: 0; bottom: 0; left: 0; width: 32%; border-radius: 2px; background: linear-gradient(90deg, transparent, #2563eb, #60a5fa, transparent); animation: hcs-barSlide 1.15s cubic-bezier(.4, 0, .2, 1) infinite; }
.hcs-loadBar[data-tone='exec'] > span { background: linear-gradient(90deg, transparent, #059669, #34d399, transparent); }
.hcs-loadBar[data-tone='read'] { height: 3px; background: color-mix(in srgb, #2563eb 16%, transparent); }
.hcs-scan { display: flex; flex: 1; flex-direction: column; gap: 7px; padding: 10px 8px; min-height: 0; }
.hcs-scanHead { display: flex; align-items: center; gap: 7px; margin-bottom: 2px; color: #1d4ed8; font-size: 11.5px; font-weight: 600; letter-spacing: .01em; }
.hcs-scanHead > i { width: 7px; height: 7px; border-radius: 50%; background: #2563eb; animation: hcs-pulse 1.35s ease-out infinite; }
.hcs-skel { position: relative; flex: none; height: 23px; overflow: hidden; border-radius: 6px; background: color-mix(in srgb, #2563eb 7%, transparent); animation: hcs-skelPulse 1.7s ease-in-out infinite; }
.hcs-skel::after { content: ''; position: absolute; top: 0; bottom: 0; left: -60%; width: 46%; background: linear-gradient(90deg, transparent, color-mix(in srgb, #60a5fa 55%, transparent), transparent); animation: hcs-sheen 1.35s ease-in-out infinite; }
.hcs-fileStatus[data-busy='true'] i { width: 11px; height: 11px; border-radius: 50%; background: none; border: 1.6px solid color-mix(in srgb, #2563eb 28%, transparent); border-top-color: #2563eb; animation: hcs-spinRing .75s linear infinite; }
.hcs-fileStatus[data-busy='true'][data-tone='exec'] i { border-color: color-mix(in srgb, #10b981 26%, transparent); border-top-color: #10b981; }
.hcs-file[data-tone='exec'].hcs-fileBusy { background: color-mix(in srgb, #10b981 12%, transparent) !important; }
.hcs-file[data-tone='exec'].hcs-fileBusy::after { background: linear-gradient(90deg, transparent, color-mix(in srgb, #34d399 48%, transparent), transparent); }
.hcs-pane { position: relative; }
.hcs-paneExec::after { background: linear-gradient(90deg, #059669, #34d399, #6ee7b7, #059669) !important; background-size: 200% 100% !important; }
.hcs-scanline { position: absolute; left: 0; right: 0; height: 38%; z-index: 4; pointer-events: none; background: linear-gradient(180deg, transparent, color-mix(in srgb, #38bdf8 16%, transparent), transparent); animation: hcs-scanDown 1.9s ease-in-out infinite; }
.hcs-btnBusy::before { content: ''; display: inline-block; flex: none; width: 11px; height: 11px; margin-right: 0; border-radius: 50%; border: 1.6px solid color-mix(in srgb, currentColor 28%, transparent); border-top-color: currentColor; animation: hcs-spinRing .75s linear infinite; }
.hcs-execFlow { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; z-index: 4; pointer-events: none; background: color-mix(in srgb, #10b981 16%, transparent); }
.hcs-execFlow::after { content: ''; position: absolute; top: 0; bottom: 0; left: 0; width: 6px; border-radius: 3px; background: #10b981; box-shadow: 0 0 8px #34d399; animation: hcs-execFlow 1.25s ease-in-out infinite; }
/* ==== 悬浮作业 HUD（读取 / 转换 / 执行） ==== */
@keyframes hcs-hudIn { from { opacity: 0; transform: translate(-50%, -14px) scale(.94); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
@keyframes hcs-hudFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes hcs-hudSpin { to { transform: rotate(360deg); } }
.hcs-hudLayer { position: absolute; top: 74px; left: 50%; z-index: 90; transform: translateX(-50%); pointer-events: none; animation: hcs-hudIn .28s cubic-bezier(.2, .9, .3, 1) both; }
.hcs-hud { position: relative; display: flex; align-items: center; gap: 10px; min-width: 380px; max-width: min(640px, 92vw); padding: 9px 14px 9px 12px; overflow: hidden; border-radius: 14px; border: 1px solid color-mix(in srgb, #2563eb 26%, transparent); background: color-mix(in srgb, var(--dsw-alias-bg-layer-1, #fff) 86%, transparent); backdrop-filter: blur(14px) saturate(150%); box-shadow: 0 20px 48px rgba(15, 23, 42, .22), 0 2px 8px rgba(15, 23, 42, .08); pointer-events: auto; animation: hcs-hudFloat 3.4s ease-in-out infinite; }
.hcs-hud::after { content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1px; background: linear-gradient(90deg, #2563eb, #60a5fa, #a78bfa, #2563eb); background-size: 300% 100%; animation: hcs-flow 2.6s linear infinite; -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; }
.hcs-hudAura { position: absolute; top: 50%; left: -18px; width: 96px; height: 96px; margin-top: -48px; border-radius: 50%; background: conic-gradient(from 0deg, transparent 0deg, rgba(37, 99, 235, .55) 90deg, transparent 190deg); filter: blur(12px); opacity: .75; animation: hcs-hudSpin 2.8s linear infinite; pointer-events: none; }
.hcs-hudOrb { position: relative; z-index: 1; display: grid; flex: none; place-items: center; width: 38px; height: 38px; border-radius: 50%; color: #1d4ed8; background: radial-gradient(circle at 50% 45%, color-mix(in srgb, #2563eb 26%, transparent), transparent 74%); box-shadow: 0 6px 16px rgba(37, 99, 235, .26); }
.hcs-hudRing { position: absolute; inset: 3px; border-radius: 50%; border: 2px solid color-mix(in srgb, #2563eb 24%, transparent); border-top-color: #2563eb; animation: hcs-spinRing .95s linear infinite; }
.hcs-hudRingB { inset: -2px; border-width: 1.6px; border-color: color-mix(in srgb, #60a5fa 20%, transparent); border-bottom-color: #60a5fa; animation: hcs-spinRing 1.7s linear infinite reverse; }
.hcs-hudText { display: flex; flex: 1; flex-direction: column; gap: 1px; min-width: 0; }
.hcs-hudText b { color: var(--dsw-alias-label-primary); font-size: 12.5px; font-weight: 700; white-space: nowrap; }
.hcs-hudText small { display: flex; align-items: baseline; gap: 6px; min-width: 0; overflow: hidden; color: var(--dsw-alias-label-secondary); font-size: 11px; white-space: nowrap; }
.hcs-hudMetaLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.hcs-hud[data-kind='execute'] .hcs-hudMetaCount { color: #047857; }
.hcs-hudBar { position: relative; flex: none; width: 96px; height: 5px; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, #2563eb 14%, transparent); }
.hcs-hudBar i { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 999px; background: linear-gradient(90deg, #2563eb, #60a5fa); box-shadow: 0 0 10px rgba(37, 99, 235, .45); transition: width .4s ease; }
.hcs-hudBar.isIndeterminate i { width: 38%; background: linear-gradient(90deg, #2563eb, #60a5fa); animation: hcs-barSlide 1.25s cubic-bezier(.4, 0, .2, 1) infinite; }
.hcs-hudTimer { flex: none; min-width: 30px; color: #1d4ed8; font-size: 11.5px; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }
.hcs-hud[data-kind='execute'] { border-color: color-mix(in srgb, #10b981 30%, transparent); }
.hcs-hud[data-kind='execute']::after { background: linear-gradient(90deg, #059669, #34d399, #6ee7b7, #059669); background-size: 300% 100%; }
.hcs-hud[data-kind='execute'] .hcs-hudOrb { color: #059669; }
.hcs-hud[data-kind='execute'] .hcs-hudRing { border-color: color-mix(in srgb, #10b981 20%, transparent); border-top-color: #10b981; }
.hcs-hud[data-kind='execute'] .hcs-hudRingB { border-color: color-mix(in srgb, #34d399 16%, transparent); border-bottom-color: #34d399; }
.hcs-hud[data-kind='execute'] .hcs-hudBar i { background: linear-gradient(90deg, #059669, #34d399); }
.hcs-hud[data-kind='execute'] .hcs-hudTimer { color: #047857; }
.hcs-hudStop { flex: none; width: 16px; height: 16px; padding: 0; border: 0; border-radius: 3px; background: #ef4444; cursor: pointer; transition: background .15s ease, transform .15s ease; }
.hcs-hudStop:hover { background: #dc2626; }
.hcs-hudStop:active { transform: scale(.94); }
.hcs-hud[data-kind='execute'] .hcs-hudAura { background: conic-gradient(from 0deg, transparent 0deg, rgba(16, 185, 129, .5) 90deg, transparent 190deg); }
.hcs-hud[data-restored='true'] { box-shadow: 0 22px 52px rgba(15, 23, 42, .26), 0 0 0 1px rgba(37, 99, 235, .18) inset; }
/* 作业进行中：内容区整体锁定（顶部导航不受影响，仍可切换 tab） */
.hcs-lockWrap { position: relative; display: flex; flex: 1; flex-direction: column; min-height: 0; }
.hcs-lockVeil { display: none; position: absolute; inset: 0; z-index: 80; cursor: progress; background: color-mix(in srgb, var(--dsw-alias-bg-base, #f4f7fd) 28%, transparent); backdrop-filter: blur(1.2px) saturate(.92); }
.hcs-lockWrap[data-locked='true'] > .hcs-lockVeil { display: block; }
.hcs-lockWrap[data-locked='true'] { cursor: progress; }
@media (prefers-reduced-motion: reduce) {
  .hcs-loadBar > span, .hcs-skel, .hcs-skel::after, .hcs-scanline, .hcs-btnBusy::before, .hcs-fileStatus[data-busy='true'] i, .hcs-scanHead > i, .hcs-execFlow::after, .hcs-hudLayer, .hcs-hud, .hcs-hud::after, .hcs-hudAura, .hcs-hudRing, .hcs-hudRingB, .hcs-hudBar.isIndeterminate i { animation: none; }}
.hcs-paneFoot { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 8px; height: 26px; padding: 0 10px; border-top: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); font-size: 11px; }
.hcs-paneTabs { display: flex; flex: 1 1 auto; align-items: center; gap: 2px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.hcs-paneTabs::-webkit-scrollbar { display: none; }
.hcs-paneTab { flex: none; height: 24px; padding: 0 8px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11.5px; cursor: pointer; }
.hcs-paneTab:hover { background: color-mix(in srgb, #2563eb 8%, transparent); color: var(--dsw-alias-label-primary); }
.hcs-paneTab[data-active='true'] { border-color: color-mix(in srgb, #2563eb 32%, transparent); background: color-mix(in srgb, #2563eb 12%, transparent); color: #1d4ed8; font-weight: 600; }
.hcs-paneTab[data-active='true'] .hcs-tabBadge { background: color-mix(in srgb, #2563eb 26%, transparent); }
.hcs-tabBadge { display: inline-flex; align-items: center; justify-content: center; min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px; background: color-mix(in srgb, #2563eb 16%, transparent); color: #1d4ed8; font-size: 9px; font-weight: 700; }
.hcs-tabDot { flex: none; width: 5px; height: 5px; border-radius: 50%; background: #dc2626; }
.hcs-paneChips { display: flex; flex: 0 1 auto; align-items: center; gap: 4px; min-width: 0; overflow: hidden; }
.hcs-chip { flex: none; height: 18px; padding: 0 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 9.5px; white-space: nowrap; cursor: pointer; }
.hcs-chip:hover { border-color: color-mix(in srgb, #2563eb 42%, transparent); color: #1d4ed8; }
.hcs-chip[data-tone='warn'] { border-color: color-mix(in srgb, #d97706 42%, transparent); color: #b45309; }
.hcs-chip[data-tone='error'] { border-color: color-mix(in srgb, #dc2626 42%, transparent); color: #b91c1c; }
.hcs-chip[data-tone='ok'] { border-color: color-mix(in srgb, #10b981 42%, transparent); color: #047857; }
.hcs-paneFootStatus { flex: 1 1 auto; min-width: 0; overflow: hidden; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
.hcs-ruleScroll { display: flex; flex: 1; flex-direction: column; gap: 10px; min-height: 0; }
.hcs-ruleGroup { display: flex; flex-direction: column; gap: 1px; }
.hcs-ruleGroupTitle { margin: 0 0 3px; color: var(--dsw-alias-label-secondary); font-size: 9.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.hcs-ruleItem { display: flex; flex-direction: column; gap: 3px; padding: 4px 6px; border-radius: 5px; }
.hcs-ruleItem:hover { background: color-mix(in srgb, #2563eb 6%, transparent); }
.hcs-ruleLine { display: flex; align-items: center; gap: 6px; min-width: 0; }
.hcs-ruleName { flex: 1 1 auto; min-width: 0; overflow: hidden; color: var(--dsw-alias-label-primary); font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }
.hcs-ruleCount { flex: none; color: var(--dsw-alias-label-secondary); font-size: 10px; font-variant-numeric: tabular-nums; }
.hcs-ruleLevel { flex: none; padding: 0 4px; border-radius: 3px; font-size: 8.5px; font-weight: 700; }
.hcs-ruleLevel[data-level='high'] { background: color-mix(in srgb, #dc2626 14%, transparent); color: #b91c1c; }
.hcs-ruleLevel[data-level='mid'] { background: color-mix(in srgb, #d97706 15%, transparent); color: #b45309; }
.hcs-ruleLevel[data-level='low'] { background: color-mix(in srgb, #64748b 14%, transparent); color: #475569; }
.hcs-ruleSamples { display: flex; flex-direction: column; gap: 2px; font-family: Consolas, "Cascadia Mono", ui-monospace, monospace; }
.hcs-ruleSample { display: flex; align-items: baseline; gap: 5px; min-width: 0; padding: 1px 4px; border-radius: 4px; font-size: 10px; cursor: default; }
.hcs-ruleSample[role='button'] { cursor: pointer; }
.hcs-ruleSample[role='button']:hover { background: color-mix(in srgb, #2563eb 8%, transparent); }
.hcs-ruleSample[role='button']:focus-visible { outline: 2px solid color-mix(in srgb, #2563eb 45%, transparent); outline-offset: -1px; }
.hcs-ruleSampleLine { flex: none; width: 30px; color: var(--dsw-alias-label-secondary); opacity: .75; }
.hcs-ruleBefore { flex: 1 1 0; min-width: 0; overflow: hidden; color: #b91c1c; text-overflow: ellipsis; white-space: nowrap; }
.hcs-ruleArrow { flex: none; color: var(--dsw-alias-label-secondary); }
.hcs-ruleAfter { flex: 1 1 0; min-width: 0; overflow: hidden; color: #047857; text-overflow: ellipsis; white-space: nowrap; }
.hcs-ruleEmpty { display: flex; align-items: flex-start; gap: 7px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.6; }
.hcs-ruleEmpty p { margin: 0; }
.hcs-ruleEmpty svg { flex: none; margin-top: 1px; color: #d97706; }
.hcs-diffWrap { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.hcs-diffBar { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.hcs-diffToggle { display: flex; align-items: center; gap: 5px; color: var(--dsw-alias-label-secondary); font-size: 10.5px; cursor: pointer; }
.hcs-diffToggle input { margin: 0; }
.hcs-diffStat { color: #047857; font-size: 10.5px; font-variant-numeric: tabular-nums; }
.hcs-diffStat[data-empty='true'] { color: var(--dsw-alias-label-secondary); }
.hcs-diffText mark { padding: 0; background: transparent; color: inherit; }
.hcs-diffText mark.is-add { border-radius: 2px; background: color-mix(in srgb, #22c55e 30%, transparent); }
.hcs-diffText mark.is-del { border-radius: 2px; background: color-mix(in srgb, #ef4444 28%, transparent); }
.hcs-execScroll { display: flex; flex: 1; flex-direction: column; gap: 8px; min-height: 0; }
.hcs-execCard { display: flex; flex-direction: column; gap: 7px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; }
.hcs-execCard[data-status='ok'] { border-color: color-mix(in srgb, #10b981 34%, transparent); background: color-mix(in srgb, #10b981 6%, transparent); }
.hcs-execCard[data-status='error'] { border-color: color-mix(in srgb, #dc2626 34%, transparent); background: color-mix(in srgb, #dc2626 6%, transparent); }
.hcs-execHead { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-primary); font-size: 12px; }
.hcs-execCard[data-status='ok'] .hcs-execHead { color: #047857; }
.hcs-execCard[data-status='error'] .hcs-execHead { color: #b91c1c; }
.hcs-execMeta { display: flex; flex-wrap: wrap; gap: 10px; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.hcs-execError { margin: 0; padding: 7px 9px; border-radius: 6px; background: color-mix(in srgb, #dc2626 9%, transparent); color: #b91c1c; font-size: 11px; line-height: 1.6; word-break: break-word; }
.hcs-execHint { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 10.5px; line-height: 1.6; }
.hcs-deps { display: flex; flex: 1; flex-direction: column; gap: 8px; min-height: 0; overflow: auto; padding: 8px 10px; }
.hcs-depsList { display: flex; flex-direction: column; gap: 2px; }
.hcs-depsRow { display: grid; grid-template-columns: 18px minmax(0, 1fr) 92px 54px; align-items: center; gap: 8px; width: 100%; padding: 6px 8px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 11.5px; text-align: left; cursor: pointer; }
.hcs-depsRow:hover { border-color: color-mix(in srgb, #2563eb 26%, transparent); background: color-mix(in srgb, #2563eb 7%, transparent); }
.hcs-depsRow[data-status='missing'] { cursor: default; }
.hcs-depsRow[data-status='missing']:hover { border-color: transparent; background: transparent; }
.hcs-depsIcon { display: grid; place-items: center; color: color-mix(in srgb, #2563eb 72%, var(--dsw-alias-label-secondary)); }
.hcs-depsRow[data-status='missing'] .hcs-depsIcon { color: var(--dsw-alias-label-secondary); opacity: .7; }
.hcs-depsName { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: Consolas, "Cascadia Mono", ui-monospace, monospace; font-size: 11px; }
.hcs-depsType { overflow: hidden; color: var(--dsw-alias-label-secondary); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.hcs-depsStatus { justify-self: end; padding: 0 6px; border-radius: 999px; font-size: 9px; line-height: 16px; }
.hcs-depsRow[data-status='loaded'] .hcs-depsStatus { background: color-mix(in srgb, #10b981 16%, transparent); color: #047857; }
.hcs-depsRow[data-status='missing'] .hcs-depsStatus { background: color-mix(in srgb, #d97706 16%, transparent); color: #b45309; }
.hcs-depsHint { margin: 2px 0 0; color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1.6; }
.hcs-depsEmpty { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 7px; padding: 24px 16px; color: var(--dsw-alias-label-secondary); text-align: center; }
.hcs-depsEmpty svg { color: color-mix(in srgb, #2563eb 55%, var(--dsw-alias-label-secondary)); }
.hcs-depsEmpty p { margin: 0; font-size: 11.5px; }
.hcs-depsEmpty small { font-size: 10px; opacity: .82; line-height: 1.6; }
.hcs-depsBar { display: flex; flex: none; align-items: center; gap: 8px; }
.hcs-depsTag { padding: 0 7px; border-radius: 999px; font-size: 9.5px; line-height: 17px; }
.hcs-depsTag[data-tone='db'] { background: color-mix(in srgb, #2563eb 14%, transparent); color: #1d4ed8; }
.hcs-depsTag[data-tone='busy'] { background: color-mix(in srgb, #f59e0b 16%, transparent); color: #b45309; }
.hcs-depsCount { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 10.5px; }
.hcs-depsError { margin: 0; padding: 6px 8px; border-radius: 6px; background: color-mix(in srgb, #dc2626 9%, transparent); color: #b91c1c; font-size: 11px; line-height: 1.55; word-break: break-word; }
.hcs-depsItem { display: flex; flex-direction: column; }
.hcs-depsRow { grid-template-columns: 18px minmax(0, 1fr) 92px 78px 64px 20px; }
.hcs-depsRow[role='button'] { cursor: pointer; }
.hcs-depsRow[role='button']:focus-visible { outline: 2px solid color-mix(in srgb, #2563eb 45%, transparent); outline-offset: -1px; }
.hcs-depsJump { display: grid; place-items: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
button.hcs-depsJump:hover { background: color-mix(in srgb, #2563eb 12%, transparent); color: #1d4ed8; }
.hcs-depsDdlBtn { justify-self: end; color: #2563eb; font-size: 9.5px; white-space: nowrap; }
.hcs-depsRow[data-status='remote'] .hcs-depsDdlBtn { color: #1d4ed8; }
.hcs-depsDdl { max-height: 220px; margin: 2px 0 6px 18px; padding: 8px 10px; overflow: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: color-mix(in srgb, #2563eb 4%, transparent); color: var(--dsw-alias-label-primary); font-family: Consolas, "Cascadia Mono", ui-monospace, monospace; font-size: 10.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.hcs-depsRow[data-status='remote'] .hcs-depsStatus { background: color-mix(in srgb, #2563eb 14%, transparent); color: #1d4ed8; }
.hcs-select, .hcs-input { box-sizing: border-box; height: 26px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; outline: none; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-size: 11.5px; }
.hcs-input { width: 120px; }
.hcs-select:focus, .hcs-input:focus { border-color: var(--dsw-alias-state-business-primary, var(--dsw-alias-brand-primary)); }
.hcs-statusbar { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 10px; height: 24px; padding: 0 2px 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.hcs-statusLeft { display: flex; align-items: center; gap: 6px; min-width: 0; }
.hcs-statusDot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
.hcs-statusDot[data-kind='ok'] { background: var(--dsw-alias-state-success-primary); }
.hcs-statusDot[data-kind='warn'] { background: var(--dsw-alias-state-warn-primary); }
.hcs-statusDot[data-kind='error'] { background: var(--dsw-alias-state-error-primary); }
.hcs-statusText { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hcs-statusText[data-kind='error'] { color: var(--dsw-alias-state-error-primary); }
.hcs-conn { display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; }
.hcs-connMain { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
.hcs-connName { font-size: 14px; font-weight: 600; }
.hcs-connMeta { color: var(--dsw-alias-label-secondary); font-size: 12.5px; overflow-wrap: anywhere; }
.hcs-connActions { display: flex; flex: none; gap: 2px; }
.hch-wizard.hcs-connDialog { position: relative; width: min(620px, 100%); }
.hch-wizardBody.hcs-connDialogBody { display: flex; flex-direction: column; gap: 12px; padding: 16px 22px; }
.hcs-connDialogBody .hcs-connRow { gap: 12px; }
.hch-connToast { position: absolute; top: 14px; left: 50%; z-index: 6; display: flex; align-items: center; gap: 8px; max-width: min(460px, 78%); padding: 8px 13px; border: 1px solid rgba(16, 185, 129, .4); border-radius: 10px; background: rgba(5, 18, 15, .95); color: #bbf7d0; font-size: 11.5px; line-height: 1.4; box-shadow: 0 12px 30px rgba(0, 0, 0, .35); transform: translateX(-50%); animation: hch-toastIn .18s ease; pointer-events: none; }
.hch-connToast[data-kind='error'] { border-color: rgba(239, 68, 68, .45); background: rgba(24, 8, 10, .96); color: #fecaca; }
.hch-connToast svg { flex: none; }
.hch-connToastText { min-width: 0; overflow: hidden; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; }
.hcs-passwordWrap { position: relative; width: 100%; }
.hcs-passwordWrap .hcs-passwordInput { width: 100%; padding-right: 34px; }
.hcs-eyeBtn { position: absolute; top: 50%; right: 5px; transform: translateY(-50%); display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #94a3b8); cursor: pointer; }
.hcs-eyeBtn:hover { background: rgba(148, 163, 184, .18); color: var(--dsw-alias-label-primary, #475569); }
.hcs-connNote { margin: 5px 0 0; font-size: 11px; line-height: 1.45; color: #b45309; }
.hcs-connRow { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.hcs-connRow.hcs-connRowSingle { grid-template-columns: minmax(0, 1fr); }
.hcs-connField { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.hcs-connField .hcs-input, .hcs-connField .hcs-select { width: 100%; height: 30px; }
.hcs-connFoot > .hcs-ghost { flex: none; }
.hcs-label { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 14px; }
.hcs-ghost { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 26px; padding: 0 10px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 1; cursor: pointer; }
.hcs-ghost:hover { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); color: var(--dsw-alias-label-primary); }
.hcs-ghost:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 1px; }
@media (max-width: 1100px) {
  .hcs-body { grid-template-columns: 232px minmax(0, 1fr) minmax(0, 1fr); }}
@media (max-width: 860px) {
  .hcs-shell { padding: 12px 18px 0; }
  .hcs-body { grid-template-columns: minmax(0, 1fr); }
  .hcs-list { max-height: 180px; }
  .hcs-pane { min-height: 320px; }}
@media (max-width: 560px) {
  .hcs-shell { padding: 10px 12px 0; }}
.hcs-pane { border-color: color-mix(in srgb, #2563eb 14%, var(--dsw-alias-border-l2)); box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
.hcs-paneHead { background: linear-gradient(180deg, color-mix(in srgb, #2563eb 7%, var(--dsw-alias-bg-layer-1)), var(--dsw-alias-bg-layer-1)); border-bottom-color: color-mix(in srgb, #2563eb 12%, var(--dsw-alias-border-l2)); }
.hcs-btnPrimary { background: #2563eb; border-color: #2563eb; color: #fff; }
.hcs-btnPrimary:hover:not(:disabled) { background: #1d4ed8; border-color: #1d4ed8; opacity: 1; }
.hcs-btn:hover:not(:disabled) { background: color-mix(in srgb, #2563eb 9%, transparent); border-color: color-mix(in srgb, #2563eb 35%, var(--dsw-alias-border-l2)); }
.hcs-fileActive { background: color-mix(in srgb, #2563eb 9%, var(--dsw-alias-bg-layer-1)); box-shadow: inset 2px 0 0 #2563eb; }
.hcs-file:hover { background: color-mix(in srgb, #2563eb 6%, transparent); }
.hcs-list { border-color: color-mix(in srgb, #2563eb 14%, var(--dsw-alias-border-l2)); }
.hcs-listHead { background: color-mix(in srgb, #2563eb 5%, var(--dsw-alias-bg-layer-1)); }
.hcs-gutter { background: color-mix(in srgb, #2563eb 4%, var(--dsw-alias-bg-layer-2)); }
.hcs-statusText[data-kind='ok'] { color: #15803d; }
@keyframes hcs-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes hcs-pulse { 0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, .5); } 100% { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); } }
@keyframes hcs-flow { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
.hcs { background-image: radial-gradient(color-mix(in srgb, #2563eb 7%, transparent) 1px, transparent 1px); background-size: 24px 24px; }
.hcs-list, .hcs-pane { animation: hcs-rise .4s ease both; }
.hcs-body > .hcs-list { animation-delay: .02s; }
.hcs-body > .hcs-pane:nth-of-type(1) { animation-delay: .08s; }
.hcs-body > .hcs-pane:nth-of-type(2) { animation-delay: .14s; }
.hcs-file { transition: background .15s ease, transform .15s ease; }
.hcs-file:hover { transform: translateX(2px); }
.hcs-btn { transition: background .15s ease, border-color .15s ease, color .15s ease, transform .1s ease; }
.hcs-btn:active:not(:disabled) { transform: translateY(1px); }
.hcs-statusDot[data-kind='ok'] { animation: hcs-pulse .6s ease-out; }
.hcs-paneBusy { position: relative; }
.hcs-paneBusy::after { content: ''; position: absolute; inset: 0; border-radius: 8px; padding: 1px; background: linear-gradient(90deg, #2563eb, #60a5fa, #a78bfa, #2563eb); background-size: 200% 100%; animation: hcs-flow 1.2s linear infinite; -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; }
.hcs-routeChip.isSource { color: #dc2626; }
.hcs-routeChip.isTarget { color: #0d9488; }
.hcs-insightTab { display: inline-flex; align-items: center; gap: 5px; height: 30px; padding: 0 10px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 10.5px; cursor: pointer; }
.hcs-insightTab:hover { color: var(--dsw-alias-label-primary); }
.hcs-insightTab[data-active='true'] { border-bottom-color: #2563eb; color: #2563eb; font-weight: 600; }
.hcs-insightTab:disabled { opacity: .45; cursor: not-allowed; }
.hcs-insightTab:disabled:hover { color: var(--dsw-alias-label-secondary); }
.hcs-insightScroll { box-sizing: border-box; height: 100%; overflow: auto; padding: 9px 12px; }
.hcs-diffWrap { display: flex; flex-direction: column; height: 100%; }
.hcs-diffList { flex: 1; min-height: 0; overflow: auto; padding: 5px 0; font-family: Consolas, "Cascadia Mono", ui-monospace, monospace; font-size: 10.5px; line-height: 17px; }
.hcs-diffRow { display: grid; grid-template-columns: 34px 34px 14px minmax(0, 1fr); gap: 4px; padding: 0 10px; }
.hcs-diffNo { color: var(--dsw-alias-label-secondary); text-align: right; opacity: .68; user-select: none; }
.hcs-diffSign { font-weight: 700; text-align: center; }
.hcs-diffText { margin: 0; overflow: hidden; color: var(--dsw-alias-label-primary); text-overflow: ellipsis; white-space: pre; }
.hcs-diffRow.is-add { background: color-mix(in srgb, #22c55e 10%, transparent); }
.hcs-diffRow.is-add .hcs-diffSign { color: #15803d; }
.hcs-diffRow { cursor: pointer; }
.hcs-diffRow.is-del { background: color-mix(in srgb, #ef4444 9%, transparent); }
.hcs-diffRow.is-del .hcs-diffSign { color: #dc2626; }
.hcs-diffRow.is-del .hcs-diffText { opacity: .74; text-decoration: line-through; }
.hcs-execState.is-ok { color: #15803d; }
.hcs-execState.is-error { color: #b91c1c; }
.hcs-riskRow.is-error { border-color: color-mix(in srgb, #ef4444 24%, var(--dsw-alias-border-l2)); background: color-mix(in srgb, #ef4444 7%, transparent); }
.hcs-riskRow.is-error svg { color: #dc2626; }
@media (max-width: 860px) {
  .hcs-shell { overflow: auto; }}`

    const HOME_CSS = `
.hcs-app[data-theme='dark'] { background: #060b16; background-image: none; }
.hcs-app[data-theme='light'] { background: #f4f7fd; background-image: none; }
.hcs-app > .hch-top { flex: none; box-sizing: border-box; color: #eaf2ff; font-family: "Inter", "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif; font-size: 12px; line-height: 1.45; }
.hcs-app > .hch-top *, .hcs-app > .hch-top *::before, .hcs-app > .hch-top *::after { box-sizing: border-box; }
.hcs-app .hch { flex: 1; height: auto; min-height: 0; }
.hcs-app[data-theme='dark'] {
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
.hcs-app[data-theme='light'] {
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
.hcs-app[data-theme='dark'] .hcs-paneTitle { color: #93c5fd; }
.hcs-app[data-theme='dark'] .hcs-explorerTitle svg, .hcs-app[data-theme='dark'] .hcs-groupHeadLeft svg, .hcs-app[data-theme='dark'] .hcs-treeIcon { color: #60a5fa; }
.hcs-app[data-theme='dark'] .hcs-groupHead { background: rgba(59, 130, 246, .12); color: #93c5fd; }
.hcs-app[data-theme='dark'] .hcs-listCount, .hcs-app[data-theme='dark'] .hcs-countOnly { color: #60a5fa; }
.hcs-app[data-theme='dark'] .hcs-highlight .sql-kw, .hcs-app[data-theme='dark'] .hcs-code .sql-kw { color: #7dd3fc; }
.hcs-app[data-theme='dark'] .hcs-highlight .sql-str, .hcs-app[data-theme='dark'] .hcs-code .sql-str { color: #86efac; }
.hcs-app[data-theme='dark'] .hcs-highlight .sql-num, .hcs-app[data-theme='dark'] .hcs-code .sql-num { color: #fdba74; }
.hcs-app[data-theme='dark'] .hcs-highlight .sql-ident, .hcs-app[data-theme='dark'] .hcs-code .sql-ident { color: #c4b5fd; }
.hcs-app[data-theme='dark'] .hcs-highlight .sql-type, .hcs-app[data-theme='dark'] .hcs-code .sql-type { color: #5eead4; }
.hch, .hch *, .hch *::before, .hch *::after { box-sizing: border-box; }
.hch { --hch-line: rgba(121, 157, 224, .15); --hch-muted: #7b90b3; position: relative; isolation: isolate; display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; overflow: hidden; background:
  radial-gradient(960px 480px at 8% -12%, rgba(37, 99, 235, .24), transparent 60%),
  radial-gradient(760px 440px at 96% -4%, rgba(34, 211, 238, .13), transparent 62%),
  linear-gradient(180deg, #060b16 0%, #070d1c 52%, #060b16 100%); color: #eaf2ff; font-family: "Inter", "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif; font-size: 12px; line-height: 1.45; }
.hch::after { content: ''; position: absolute; inset: 0; z-index: 0; pointer-events: none; background-image: linear-gradient(rgba(126, 164, 255, .035) 1px, transparent 1px), linear-gradient(90deg, rgba(126, 164, 255, .035) 1px, transparent 1px); background-size: 52px 52px; -webkit-mask-image: linear-gradient(180deg, rgba(0, 0, 0, .7), transparent 72%); mask-image: linear-gradient(180deg, rgba(0, 0, 0, .7), transparent 72%); }
.hch-top, .hch-scroll { position: relative; z-index: 1; }
.hch-top { display: flex; flex: none; align-items: center; gap: 16px; min-height: 60px; padding: 0 24px; border-bottom: 1px solid rgba(121, 157, 224, .13); background: rgba(6, 11, 22, .74); backdrop-filter: blur(20px) saturate(140%); }
.hch-brand { display: flex; flex: 1 1 0; align-items: center; gap: 11px; min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; }
.hch-mark { position: relative; display: grid; flex: none; place-items: center; width: 44px; height: 44px; overflow: visible; border-radius: 12px; background: transparent; color: #fff; filter: drop-shadow(0 8px 18px rgba(37, 99, 235, .42)); }
.hch-mark::after { content: none; }
.hch-brandIcon { display: block; }
.hch-brandText { display: flex; flex-direction: column; min-width: 0; overflow: hidden; white-space: nowrap; }
.hch-brandLine { display: flex; align-items: center; gap: 7px; min-width: 0; color: #f1f7ff; font-size: 15px; font-weight: 700; letter-spacing: -.015em; line-height: 18px; }
.hch-brandLine strong { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hch-brandLine em { flex: none; }
.hch-brandLine strong { font-weight: 750; }
.hch-brandLine em { padding: 1px 5px; border-radius: 4px; background: linear-gradient(135deg, #60a5fa, #22d3ee); color: #06101f; font-size: 8px; font-style: normal; font-weight: 800; letter-spacing: .1em; line-height: 14px; }
.hch-brandText small { margin-top: 2px; color: #7085a8; font-size: 9.5px; letter-spacing: .02em; }
.hch-nav { display: flex; flex: 0 1 auto; align-items: center; justify-content: center; gap: 4px; min-width: 0; padding: 4px; overflow-x: auto; border: 1px solid rgba(121, 157, 224, .16); border-radius: 999px; background: rgba(255, 255, 255, .028); box-shadow: 0 6px 22px rgba(15, 23, 42, .1), inset 0 1px 0 rgba(255, 255, 255, .04); scrollbar-width: none; }
.hch-nav::-webkit-scrollbar { display: none; }
.hch-navItem { flex: none; height: 34px; padding: 0 17px; border: 0; border-radius: 999px; background: transparent; color: #8296b9; font: inherit; font-size: 12.5px; white-space: nowrap; cursor: pointer; transition: background .16s ease, color .16s ease; }
.hch-navItem:hover { background: rgba(255, 255, 255, .05); color: #dbe7ff; }
.hch-navItem[data-active='true'] { background: linear-gradient(135deg, rgba(59, 130, 246, .92), rgba(34, 211, 238, .64)); color: #fff; box-shadow: 0 4px 16px rgba(37, 99, 235, .3); }
.hch-topRight { display: flex; flex: 1 1 0; align-items: center; justify-content: flex-end; gap: 12px; min-width: 0; }
.hch-engine { display: flex; align-items: center; gap: 6px; color: #8ba2c6; font-size: 10px; white-space: nowrap; }
.hch-engine i { width: 6px; height: 6px; border-radius: 50%; background: #34d399; box-shadow: 0 0 0 3px rgba(52, 211, 153, .1), 0 0 10px #34d399; animation: hch-live 2.4s ease-in-out infinite; }
.hch-iconBtn { display: grid; flex: none; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid rgba(121, 157, 224, .18); border-radius: 8px; background: rgba(255, 255, 255, .03); color: #b9d4ff; cursor: pointer; transition: background .16s ease, border-color .16s ease, color .16s ease; }
.hch-iconBtn:hover { border-color: rgba(96, 165, 250, .46); background: rgba(59, 130, 246, .12); color: #fff; }
.hch-scroll { flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; scrollbar-color: rgba(96, 165, 250, .28) transparent; scrollbar-width: thin; }
.hch-scroll::-webkit-scrollbar { width: 10px; }
.hch-scroll::-webkit-scrollbar-track { background: transparent; }
.hch-scroll::-webkit-scrollbar-thumb { border: 3px solid transparent; border-radius: 999px; background: rgba(96, 165, 250, .26); background-clip: padding-box; }
.hch-scroll::-webkit-scrollbar-thumb:hover { background: rgba(96, 165, 250, .42); background-clip: padding-box; }
.hch-inner { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: none; margin: 0 auto; padding: 14px 24px 16px; }
.hch-home .hch-scroll { display: flex; flex-direction: column; }
.hch-home .hch-inner { flex: none; justify-content: flex-start; }
.hch-home .hch-main { flex: 1 1 auto; min-height: 0; }
.hch-home .hch-trendCard { flex: 1 1 auto; min-height: 240px; }
.hch-hero { position: relative; display: grid; flex: none; grid-template-columns: minmax(0, 1.05fr) minmax(500px, .95fr); gap: 18px; min-height: 0; padding: 28px 32px; overflow: hidden; border: 1px solid rgba(96, 165, 250, .22); border-radius: 20px; background: radial-gradient(90% 130% at 0% 0%, rgba(37, 99, 235, .28), transparent 58%), radial-gradient(70% 90% at 96% 100%, rgba(34, 211, 238, .1), transparent 60%), linear-gradient(135deg, rgba(14, 26, 50, .96), rgba(7, 13, 26, .96)); box-shadow: 0 28px 80px rgba(0, 0, 0, .36), inset 0 1px 0 rgba(255, 255, 255, .06); animation: hch-rise .55s ease backwards; }
.hch-hero::before { content: ''; position: absolute; inset: 0; z-index: 0; background-image: linear-gradient(rgba(126, 164, 255, .055) 1px, transparent 1px), linear-gradient(90deg, rgba(126, 164, 255, .055) 1px, transparent 1px); background-size: 34px 34px; -webkit-mask-image: radial-gradient(120% 120% at 28% 18%, #000 0%, transparent 70%); mask-image: radial-gradient(120% 120% at 28% 18%, #000 0%, transparent 70%); pointer-events: none; }
.hch-hero::after { content: ''; position: absolute; top: -190px; right: -150px; z-index: 0; width: 500px; height: 500px; border-radius: 50%; background: radial-gradient(circle, rgba(34, 211, 238, .24), rgba(37, 99, 235, .08) 44%, transparent 68%); filter: blur(8px); pointer-events: none; }
.hch-heroCopy, .hch-visual { position: relative; z-index: 1; }
.hch-heroCopy { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.hch-eyebrow { display: inline-flex; align-items: center; gap: 8px; width: fit-content; max-width: 100%; padding: 6px 12px; border: 1px solid rgba(96, 165, 250, .24); border-radius: 999px; background: rgba(59, 130, 246, .09); color: #8ec6ff; font-size: 10.5px; font-weight: 700; letter-spacing: .14em; line-height: 1; white-space: nowrap; }
.hch-eyebrowDot { width: 5px; height: 5px; border-radius: 50%; background: #22d3ee; box-shadow: 0 0 9px #22d3ee; animation: hch-live 2.2s ease-in-out infinite; }
.hch-demoChip { margin-left: 2px; padding: 2px 5px; border: 1px solid rgba(251, 191, 36, .24); border-radius: 4px; background: rgba(251, 191, 36, .1); color: #fcd34d; font-size: 8px; font-weight: 700; letter-spacing: .04em; }
.hch-heroTitle { display: flex; flex-direction: row; flex-wrap: wrap; align-items: baseline; gap: 0; margin: 14px 0 12px; color: #f4f8ff; font-size: clamp(34px, 3.6vw, 54px); font-weight: 850; letter-spacing: -.045em; line-height: 1.06; text-wrap: balance; }
.hch-grad { background: linear-gradient(100deg, #7dd3fc 0%, #22d3ee 36%, #818cf8 78%, #c084fc 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
.hch-heroDesc { display: flex; flex-direction: column; gap: 5px; max-width: 680px; margin: 0; color: #9db1d2; font-size: 14px; line-height: 1.7; }
.hch-heroDescLine { position: relative; display: block; padding-left: 14px; }
.hch-heroDescLine::before { content: ''; position: absolute; top: .72em; left: 0; width: 5px; height: 5px; border-radius: 50%; background: linear-gradient(135deg, #22d3ee, #60a5fa); box-shadow: 0 0 6px rgba(34, 211, 238, .55); }
.hch-ctaPrimary { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 36px; padding: 0 16px; overflow: hidden; border: 0; border-radius: 10px; background: linear-gradient(135deg, #2563eb 0%, #0ea5e9 100%); color: #fff; font: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; box-shadow: 0 12px 30px rgba(37, 99, 235, .38), inset 0 1px 0 rgba(255, 255, 255, .2); transition: transform .16s ease, box-shadow .16s ease; }
.hch-ctaPrimary::after { content: ''; position: absolute; top: -25%; bottom: -25%; left: -42%; width: 34%; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, .38), transparent); transform: skewX(-18deg); animation: hch-shine 3.8s ease-in-out infinite; }
.hch-ctaPrimary svg, .hch-ctaSecondary svg { position: relative; z-index: 1; }
.hch-ctaPrimary:hover { transform: translateY(-1px); box-shadow: 0 16px 38px rgba(37, 99, 235, .5), inset 0 1px 0 rgba(255, 255, 255, .24); }
.hch-ctaSecondary { display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 36px; padding: 0 14px; border: 1px solid rgba(147, 177, 233, .24); border-radius: 10px; background: rgba(255, 255, 255, .035); color: #c5d8f6; font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; backdrop-filter: blur(8px); transition: background .16s ease, border-color .16s ease, transform .16s ease; }
.hch-ctaSecondary:hover { transform: translateY(-1px); border-color: rgba(147, 197, 253, .48); background: rgba(59, 130, 246, .12); }
.hch-ctaPrimary:disabled, .hch-ctaSecondary:disabled { opacity: .42; cursor: not-allowed; box-shadow: none; transform: none; }
.hch-visual { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; min-height: 200px; }
.hch-flowTask { max-width: 100%; margin-bottom: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hch-flow { display: flex; align-items: flex-start; justify-content: space-between; width: 100%; max-width: none; }
.hch-flowNode { display: flex; flex: none; flex-direction: column; align-items: center; gap: 5px; width: 92px; }
.hch-dbIcon { width: 64px; height: 80px; overflow: visible; }
.hch-dbIcon ellipse, .hch-dbIcon path { fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.hch-dbIcon.isSource { color: #f87171; filter: drop-shadow(0 0 10px rgba(248, 113, 113, .28)); }
.hch-dbIcon.isTarget { color: #34d399; filter: drop-shadow(0 0 10px rgba(52, 211, 153, .28)); }
.hch-flowNode small { color: #8a9bb8; font-size: 9px; font-weight: 600; letter-spacing: .14em; }
.hch-flowLine { position: relative; flex: 1; height: 2px; margin-top: 40px; border-radius: 2px; background: linear-gradient(90deg, rgba(148, 163, 184, .18), rgba(148, 163, 184, .62), rgba(148, 163, 184, .18)); }
.hch-flowDot { position: absolute; top: 50%; left: 0; width: 8px; height: 8px; border-radius: 50%; background: #cbd5e1; box-shadow: 0 0 9px rgba(203, 213, 225, .85); transform: translate(-50%, -50%); animation: hch-flowMove 1.9s linear infinite; }
.hch-flowDotDelay { animation-delay: -.95s; }
.hch-flowEngine { position: relative; display: flex; flex: none; flex-direction: column; align-items: center; gap: 3px; width: 150px; }
.hch-engineOrbitSvg { position: absolute; top: -24px; left: 50%; width: 132px; height: 132px; margin-left: -66px; overflow: visible; }
.hch-engineOrbitCircle { fill: none; stroke: rgba(96, 165, 250, .5); stroke-width: 1.5; stroke-dasharray: 3 7; }
.hch-engineArcSvg { position: absolute; top: -24px; left: 50%; width: 132px; height: 132px; margin-left: -66px; overflow: visible; animation: hch-ringSpin 2.2s linear infinite; }
.hch-engineArc { fill: none; stroke: #60a5fa; stroke-width: 3; stroke-linecap: round; stroke-dasharray: 100 258; filter: drop-shadow(0 0 4px rgba(96, 165, 250, .9)); }
.hch-engineBox { position: relative; z-index: 2; display: grid; place-items: center; width: 84px; height: 84px; border: 1.5px solid rgba(96, 165, 250, .85); border-radius: 28px; background: linear-gradient(150deg, rgba(59, 130, 246, .3), rgba(7, 13, 26, .06)); color: #bfdbfe; box-shadow: 0 0 36px rgba(37, 99, 235, .3), inset 0 0 24px rgba(59, 130, 246, .14), inset 0 1px 0 rgba(255, 255, 255, .14); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
.hch-flowEngine b { margin-top: 24px; color: #eaf2ff; font-size: 14px; font-weight: 700; letter-spacing: -.01em; }
.hch-flowEngine small { width: max-content; color: #7186a9; font-size: 9.5px; letter-spacing: .08em; white-space: nowrap; }
@keyframes hch-flowMove { 0% { left: 0; opacity: 0; } 12% { opacity: 1; } 88% { opacity: 1; } 100% { left: 100%; opacity: 0; } }
@keyframes hch-ringSpin { to { transform: rotate(360deg); } }
@media (max-width: 620px) {
  .hch-flowNode { width: 84px; }
  .hch-dbIcon { width: 58px; height: 74px; }
  .hch-flowEngine { width: 136px; }
  .hch-flowEngine b { font-size: 13px; }
  .hch-flowEngine small { width: max-content; font-size: 9px; letter-spacing: .06em; white-space: nowrap; }
  .hch-flowLine { margin-top: 39px; }
  .hch-engineBox { width: 78px; height: 78px; border-radius: 26px; }
  .hch-engineOrbitSvg, .hch-engineArcSvg { top: -22px; width: 122px; height: 122px; margin-left: -61px; }}
.hch-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.hch-stat { --tone: #60a5fa; --tone-soft: rgba(96, 165, 250, .13); position: relative; padding: 11px 14px 9px; overflow: hidden; border: 1px solid rgba(121, 157, 224, .14); border-radius: 14px; background: linear-gradient(155deg, rgba(15, 26, 48, .88), rgba(8, 15, 29, .92)); box-shadow: 0 10px 28px rgba(0, 0, 0, .16); transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease; animation: hch-rise .55s ease backwards; }
.hch-stat:nth-child(2) { animation-delay: .04s; }
.hch-stat:nth-child(3) { animation-delay: .08s; }
.hch-stat:nth-child(4) { animation-delay: .12s; }
.hch-stat::before { content: ''; position: absolute; top: 0; right: 16px; left: 16px; height: 1px; background: linear-gradient(90deg, transparent, var(--tone), transparent); opacity: .8; }
.hch-stat::after { content: ''; position: absolute; top: -46px; right: -36px; width: 120px; height: 120px; border-radius: 50%; background: radial-gradient(circle, var(--tone-soft), transparent 68%); pointer-events: none; }
.hch-stat[data-tone='violet'] { --tone: #a78bfa; --tone-soft: rgba(167, 139, 250, .16); }
.hch-stat[data-tone='green'] { --tone: #34d399; --tone-soft: rgba(52, 211, 153, .14); }
.hch-stat[data-tone='cyan'] { --tone: #22d3ee; --tone-soft: rgba(34, 211, 238, .14); }
.hch-stat[data-tone='amber'] { --tone: #fbbf24; --tone-soft: rgba(251, 191, 36, .14); }
.hch-stat:hover { transform: translateY(-3px); border-color: color-mix(in srgb, var(--tone) 38%, transparent); box-shadow: 0 18px 38px rgba(0, 0, 0, .3); }
.hch-statTop { position: relative; z-index: 1; display: flex; align-items: center; gap: 8px; }
.hch-statIcon { display: grid; flex: none; place-items: center; width: 30px; height: 30px; border-radius: 9px; background: var(--tone-soft); color: var(--tone); }
.hch-statLabel { overflow: hidden; color: #9aafd0; font-size: 11.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.hch-statValue { position: relative; z-index: 1; margin: 8px 0 2px; color: #f2f7ff; font-size: 25px; font-weight: 800; letter-spacing: -.04em; line-height: 1; }
.hch-statFoot { position: relative; z-index: 1; display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; min-height: 24px; }
.hch-statFootText { color: #7186a9; font-size: 10.5px; line-height: 1.5; }
.hch-dash { display: grid; flex: none; grid-template-columns: minmax(0, 1fr) clamp(320px, 26vw, 380px); grid-template-rows: clamp(320px, 34vh, 420px) auto; gap: 12px; }
.hch-dash > .hch-trendCard { grid-column: 1; grid-row: 1; min-height: 0; }
.hch-dash > .hch-trendCard > .hch-chartCol { flex: 1 1 auto; min-height: 0; }
.hch-summaryCard { display: flex; flex-direction: column; gap: 10px; grid-column: 2; grid-row: 1; min-width: 0; min-height: 0; padding: 12px; overflow-x: hidden; overflow-y: auto; }
.hch-summaryCard .hch-sideTiles { min-width: 0; }
.hch-summaryCard .hch-sideTile { min-width: 0; padding: 7px 8px; overflow: hidden; }
.hch-summaryCard .hch-sideTile b { margin-top: 4px; font-size: 15px; }
.hch-summaryCard .hch-sideAction { height: 28px; }
.hch-summaryHead { display: flex; flex-direction: column; gap: 3px; }
.hch-summarySection { display: flex; flex-direction: column; gap: 5px; padding-top: 8px; border-top: 1px solid rgba(121, 157, 224, .1); }
.hch-summaryRow { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; color: #8ba2c6; font-size: 10.5px; }
.hch-summaryRow b { color: #f4f8ff; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.hch-summaryBar { height: 5px; overflow: hidden; border-radius: 999px; background: rgba(121, 157, 224, .14); }
.hch-summaryBar i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #2563eb, #22d3ee); transition: width .4s ease; }
.hch-summaryCard .hch-sideActions { margin-top: auto; padding-top: 10px; border-top: 1px solid rgba(121, 157, 224, .1); }
.hch-recentWide { display: flex; flex-direction: column; grid-column: 1 / -1; grid-row: 2; min-height: 0; padding-bottom: 6px; }
.hch-recentWideHead { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px 4px; }
.hch-recentWideList { padding: 0 16px; }
.hch-recentWideRow { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr) auto 13px; align-items: center; gap: 12px; width: 100%; padding: 9px 4px; background: none; border: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; border-bottom: 1px solid rgba(121, 157, 224, .08); }
.hch-taskPageRow[aria-disabled='true'], .hch-recentWideRow:disabled, .hch-flowTask:disabled, .hch-flowBinding:disabled, .hch-taskAction:disabled { cursor: progress; opacity: .62; }
.hch-recentWideRow:hover { background: rgba(96, 165, 250, .10); }
.hch-flowBinding { width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; font-size: 11px; }
@media (max-width: 560px) {
  .hch-recentWideRow { grid-template-columns: minmax(0, 1fr) auto 13px; gap: 5px 8px; }
  .hch-recentWideTask { grid-row: 2; grid-column: 1 / -1; white-space: normal; }}
.hch-recentWideRow:last-child { border-bottom: 0; }
.hch-recentWideName { overflow: hidden; color: #d4e2f7; font-size: 12.5px; text-overflow: ellipsis; white-space: nowrap; }
.hch-recentWideTask { overflow: hidden; color: #7f93b5; font-size: 11.5px; text-overflow: ellipsis; white-space: nowrap; }
.hch-recentWideStatus { color: inherit; font-size: 11px; }
.hch-recentWideStatus[data-status='ok'] { color: #6ee7b7; }
.hch-recentWideStatus[data-status='error'] { color: #fca5a5; }
.hch-recentWideEmpty { padding: 10px 16px 16px; }
.hch-recentWideHead .hch-cardTitle { font-size: 14px; }
.hch-recentWideHead .hch-linkBtn { gap: 5px; padding: 0 10px; border: 1px solid rgba(96, 165, 250, .24); border-radius: 7px; background: rgba(59, 130, 246, .08); font-size: 11.5px; text-decoration: none; }
.hch-recentWideHead .hch-linkBtn:hover { border-color: rgba(96, 165, 250, .46); background: rgba(59, 130, 246, .16); }
.hch-statMini .hch-statTop { gap: 6px; }
.hch-statMini .hch-statLabel { font-size: 9.5px; white-space: nowrap; }
.hch-statMini .hch-statValue { margin: 7px 0 0; font-size: 22px; }
.hch-statMini .hch-statFoot { margin-top: 6px; }
.hch-statMini .hch-statFootText { display: none; }
.hch-recentTitle .hch-cardTitle { font-size: 12px; }
.hch-card { position: relative; overflow: hidden; border: 1px solid rgba(121, 157, 224, .14); border-radius: 18px; background: linear-gradient(160deg, rgba(14, 25, 46, .9), rgba(7, 14, 27, .93)); box-shadow: 0 12px 34px rgba(0, 0, 0, .2), inset 0 1px 0 rgba(255, 255, 255, .035); animation: hch-rise .55s .08s ease backwards; }
.hch-cardHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 18px 0; }
.hch-cardHeading { min-width: 0; }
.hch-cardTitle { display: flex; align-items: center; gap: 7px; margin: 0; color: #e7f0ff; font-size: 12.5px; font-weight: 700; }
.hch-cardTitle svg { flex: none; color: #5ea3ff; }
.hch-cardSub { margin: 5px 0 0; color: #6f84a8; font-size: 9.5px; line-height: 1.45; }
.hch-tabs { display: flex; flex: none; gap: 2px; padding: 3px; border: 1px solid rgba(121, 157, 224, .14); border-radius: 9px; background: rgba(255, 255, 255, .022); }
.hch-tab { height: 23px; padding: 0 9px; border: 0; border-radius: 6px; background: transparent; color: #7f93b6; font: inherit; font-size: 9px; white-space: nowrap; cursor: pointer; }
.hch-tab:hover { color: #c9dcff; }
.hch-tab[data-active='true'] { background: rgba(59, 130, 246, .18); color: #bcd8ff; box-shadow: inset 0 0 0 1px rgba(96, 165, 250, .2); }
.hch-trendCard { display: flex; flex-direction: column; min-height: clamp(320px, 46vh, 440px); max-height: none; }
.hch-chartCol { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.hch-sideEyebrow { color: #7f93b5; font-size: 8px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
.hch-sideTiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.hch-sideTile { min-width: 0; padding: 8px 9px; border: 1px solid rgba(121, 157, 224, .12); border-radius: 9px; background: rgba(255, 255, 255, .022); }
.hch-sideTile span { display: block; overflow: hidden; color: #8ba2c6; font-size: 9px; white-space: nowrap; text-overflow: ellipsis; }
.hch-sideTile b { display: block; margin-top: 5px; color: #f4f8ff; font-size: 17px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
.hch-sideEmpty { margin: 4px 0 0; color: #7085a8; font-size: 10px; line-height: 1.5; }
.hch-sideActions { display: flex; flex-direction: column; gap: 6px; margin-top: auto; }
.hch-sideAction { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 10px; border: 1px solid rgba(121, 157, 224, .12); border-radius: 8px; background: rgba(255, 255, 255, .02); color: #b9cbe7; font: inherit; font-size: 10.5px; text-align: left; cursor: pointer; transition: background .15s ease, border-color .15s ease, color .15s ease; }
.hch-sideAction:hover { border-color: rgba(96, 165, 250, .3); background: rgba(59, 130, 246, .1); color: #fff; }
.hch-chartWrap { position: relative; flex: 1; min-height: 160px; padding: 4px 8px 0; }
.hch-chart { position: absolute; top: 4px; right: 8px; bottom: 0; left: 8px; display: block; width: auto; height: auto; }
.hch-chartLine { stroke-dasharray: 1; stroke-dashoffset: 1; animation: hch-draw 1.3s cubic-bezier(.2, .8, .2, 1) forwards; }
.hch-chartLineReview { stroke-dasharray: 4 5; stroke-dashoffset: 0; animation: hch-fade .7s .45s ease both; }
.hch-chartPointLast { animation: hch-point 2.4s ease-in-out infinite; }
.hch-chartEmpty { position: absolute; inset: 22px 12px 32px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; border-radius: 12px; background: rgba(7, 14, 27, .74); text-align: center; backdrop-filter: blur(4px); }
.hch-chartEmptyIcon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; background: rgba(59, 130, 246, .12); color: #60a5fa; }
.hch-chartEmpty p { margin: 0; color: #8196b9; font-size: 10px; }
.hch-chartEmpty button { display: inline-flex; align-items: center; gap: 4px; height: 28px; padding: 0 11px; border: 1px solid rgba(96, 165, 250, .3); border-radius: 7px; background: rgba(59, 130, 246, .12); color: #c6dcff; font: inherit; font-size: 9.5px; cursor: pointer; }
.hch-chartEmpty button:hover { background: rgba(59, 130, 246, .2); }
.hch-chartFoot { display: flex; flex: none; align-items: center; justify-content: space-between; gap: 10px; padding: 0 18px 12px; }
.hch-legend { display: flex; align-items: center; gap: 6px; color: #7e93b6; font-size: 9px; }
.hch-legend i { width: 7px; height: 7px; border-radius: 50%; }
.hch-legend i.isDone { background: #38bdf8; box-shadow: 0 0 7px rgba(56, 189, 248, .7); }
.hch-legend i.isReview { margin-left: 8px; background: #fbbf24; box-shadow: 0 0 6px rgba(251, 191, 36, .55); }
.hch-chartPeak { color: #60769a; font-size: 9px; }
.hch-check { display: flex; align-items: center; gap: 7px; padding: 7px 9px; border: 1px solid rgba(121, 157, 224, .1); border-radius: 8px; background: rgba(255, 255, 255, .018); }
.hch-linkBtn { display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 9px; border: 1px solid rgba(96, 165, 250, .2); border-radius: 7px; background: rgba(59, 130, 246, .07); color: #a9c9ff; font: inherit; font-size: 9px; cursor: pointer; transition: background .15s ease, border-color .15s ease; }
.hch-linkBtn:hover { border-color: rgba(96, 165, 250, .4); background: rgba(59, 130, 246, .15); }
.hch-taskIcon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 9px; }
.hch-taskIcon.is-done { background: rgba(52, 211, 153, .1); color: #34d399; }
.hch-taskIcon.is-running { background: rgba(34, 211, 238, .1); color: #22d3ee; }
.hch-taskIcon.is-running svg { animation: hch-rotate 1.5s linear infinite; }
.hch-taskIcon.is-pending { background: rgba(251, 191, 36, .1); color: #fbbf24; }
.hch-taskIcon.is-error { background: rgba(248, 113, 113, .1); color: #f87171; }
.hch-taskTrack i.is-done { background: linear-gradient(90deg, #10b981, #34d399); }
.hch-taskTrack i.is-error { background: linear-gradient(90deg, #ef4444, #fb7185); }
.hch-taskTrack i.is-running { background: linear-gradient(90deg, #2563eb, #22d3ee, #2563eb); background-size: 200% 100%; animation: hch-flow 1.6s linear infinite; }
.hch-taskTrack i.is-pending { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
.hch-taskTime { color: #5f7497; font-size: 7.5px; }
.hch-pill.is-done { border-color: rgba(52, 211, 153, .18); background: rgba(52, 211, 153, .08); color: #6ee7b7; }
.hch-pill.is-running { border-color: rgba(34, 211, 238, .18); background: rgba(34, 211, 238, .08); color: #67e8f9; }
.hch-pill.is-pending { border-color: rgba(251, 191, 36, .18); background: rgba(251, 191, 36, .08); color: #fcd34d; }
.hch-pill.is-error { border-color: rgba(248, 113, 113, .2); background: rgba(248, 113, 113, .09); color: #fca5a5; }
.hch-taskArrow { display: grid; place-items: center; color: #53698c; transition: color .15s ease, transform .15s ease; }
.hch-task:hover .hch-taskArrow { color: #7dd3fc; transform: translate(1px, -1px); }
.hch-connInner { max-width: none; }
.hch-connHero { display: flex; flex-direction: column; gap: 9px; padding: 4px 2px 2px; }
.hch-connHeroRow { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; position: relative; }
.hch-connHeroText { min-width: 0; }
.hch-connTitle { margin: 13px 0 7px; color: #f4f8ff; font-size: 30px; font-weight: 800; letter-spacing: -.035em; line-height: 1.1; }
.hch-connDesc { max-width: 680px; margin: 0; color: #7b90b3; font-size: 11.5px; line-height: 1.7; }
.hcs-app[data-theme='light'] .hch-toast { box-shadow: 0 18px 42px rgba(15, 23, 42, .16); }
@keyframes hch-toastIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes hch-toastDrop { from { opacity: 0; transform: translate(-50%, calc(-50% - 8px)); } to { opacity: 1; transform: translate(-50%, -50%); } }
.hch-connGrid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; }
.hch-connColumn { padding: 0 0 10px; border-top: 2px solid rgba(96, 165, 250, .45); }
.hch-connColumn[data-side='target'] { border-top-color: rgba(52, 211, 153, .45); }
.hch-connColumnHead { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 16px 0; }
.hch-connColumnTitle { display: flex; align-items: center; gap: 8px; color: #eaf2ff; font-size: 14px; font-weight: 700; }
.hch-connColumnTitle svg { color: #60a5fa; }
.hch-connColumn[data-side='target'] .hch-connColumnTitle svg { color: #34d399; }
.hch-connCount { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 20px; padding: 0 8px; border-radius: 999px; background: rgba(96, 165, 250, .14); color: #9cc4ff; font-size: 11.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.hch-connColumn[data-side='target'] .hch-connCount { background: rgba(52, 211, 153, .14); color: #6ee7b7; }
.hch-connAddBtn { height: 30px; padding: 0 12px; font-size: 12px; }
.hch-connColumnHint { margin: 6px 16px 10px; color: #7085a8; font-size: 11.5px; line-height: 1.5; }
.hch-connColumnBody { display: flex; flex-direction: column; gap: 8px; padding: 0 12px 4px; min-height: 96px; }
.hch-connColumn .hcs-conn { border-color: rgba(121, 157, 224, .14); background: rgba(255, 255, 255, .022); padding: 12px 14px; }
.hch-connColumn .hcs-connName { color: #e7f0ff; }
.hch-connColumn .hcs-connMeta { color: #7b90b3; }
.hch-connColumn .hcs-label { color: #8da2c3; }
.hch-connEmptyCol { margin: 0; padding: 22px 12px; border: 1px dashed rgba(121, 157, 224, .2); border-radius: 10px; color: #7b90b3; font-size: 12px; text-align: center; }
@media (max-width: 1100px) {
  .hch-connGrid { grid-template-columns: minmax(0, 1fr); }
  .hch-dash { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto auto; }
  .hch-summaryCard { grid-column: 1; grid-row: 2; }
  .hch-recentWide { grid-row: 3; }}
.hch-settingsInner { gap: 12px; max-width: 980px; }
.hch-settingsHead { padding: 0 2px; }
.hch-settingsCard { padding-bottom: 6px; }
.hch-settingsBody { display: flex; flex-direction: column; padding: 4px 18px 2px; }
.hch-settingsRow { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 12px 0; border-bottom: 1px solid rgba(121, 157, 224, .1); }
.hch-settingsRow:last-child { border-bottom: 0; }
.hch-settingsLabel { min-width: 0; }
.hch-settingsLabel b { display: block; color: #e7f0ff; font-size: 13.5px; font-weight: 650; }
.hch-settingsLabel small { display: block; margin-top: 3px; color: #7b90b3; font-size: 11.5px; line-height: 1.5; }
.hch-themeSwitch { display: flex; flex: none; gap: 3px; padding: 3px; border: 1px solid rgba(121, 157, 224, .16); border-radius: 9px; background: rgba(255, 255, 255, .022); }
.hch-langBtn { font-size: 11px; font-weight: 700; letter-spacing: .02em; }
.hch-langBtn[data-lang='en'] { font-size: 10px; }
.hch-themeSwitch button { height: 28px; padding: 0 16px; border: 0; border-radius: 6px; background: transparent; color: #8da2c3; font: inherit; font-size: 12px; cursor: pointer; }
.hch-themeSwitch button[data-active='true'] { background: rgba(59, 130, 246, .2); color: #dbeafe; box-shadow: inset 0 0 0 1px rgba(96, 165, 250, .22); }
.hch-settingsBtn { height: 32px; padding: 0 14px; font-size: 12.5px; }
.hch-toggle { position: relative; display: inline-flex; flex: none; align-items: center; gap: 8px; cursor: pointer; }
.hch-toggle input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.hch-toggleTrack { position: relative; flex: none; width: 34px; height: 18px; border-radius: 999px; background: rgba(148, 163, 184, .35); transition: background .16s ease; }
.hch-toggleTrack i { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(15, 23, 42, .28); transition: transform .16s ease; }
.hch-toggle input:checked + .hch-toggleTrack { background: linear-gradient(135deg, #2563eb, #0ea5e9); }
.hch-toggle input:checked + .hch-toggleTrack i { transform: translateX(16px); }
.hch-toggle input:focus-visible + .hch-toggleTrack { outline: 2px solid rgba(96, 165, 250, .55); outline-offset: 2px; }
.hch-toggleText { color: #9db1d2; font-size: 12px; }
.hch-wizardOverlay.hch-confirmOverlay { z-index: 160; }
.hch-confirm { width: min(420px, 100%); padding: 20px 22px 16px; border: 1px solid rgba(121, 157, 224, .22); border-radius: 16px; background: linear-gradient(160deg, rgba(14, 25, 46, .98), rgba(7, 14, 27, .99)); box-shadow: 0 28px 70px rgba(0, 0, 0, .55); }
.hch-confirmTitle { margin: 0; color: #f1f7ff; font-size: 15px; font-weight: 700; line-height: 1.45; word-break: break-word; }
.hch-confirmText { margin: 8px 0 0; color: #9db1d2; font-size: 12px; line-height: 1.65; }
.hch-cleanupOptions { display: grid; gap: 8px; margin-top: 14px; }
.hch-cleanupOption { display: flex; align-items: flex-start; gap: 9px; padding: 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; }
.hch-cleanupOption input { accent-color: #2563eb; }
.hch-cleanupOption small { display: block; margin-top: 3px; color: var(--dsw-alias-label-secondary); }
.hch-confirmActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
.hch-confirmDanger { background: linear-gradient(135deg, #dc2626, #ef4444); box-shadow: 0 10px 26px rgba(220, 38, 38, .32); }
.hch-confirmDanger:hover { background: linear-gradient(135deg, #b91c1c, #dc2626); }
.hch-connCard .hcs-conn { border-color: rgba(121, 157, 224, .14); background: rgba(255, 255, 255, .022); }
.hch-connCard .hcs-connName { color: #e7f0ff; }
.hch-connCard .hcs-connMeta { color: #7b90b3; }
.hch-connCard .hcs-label { color: #8da2c3; }
.hch-connCard .hcs-input, .hch-connCard .hcs-select { border-color: rgba(121, 157, 224, .18); background: rgba(7, 14, 27, .7); color: #e7f0ff; }
.hch button:focus-visible { outline: 2px solid rgba(56, 189, 248, .8); outline-offset: 2px; }
.hcs-app[data-theme='light'] .hch { background:
  radial-gradient(900px 430px at 8% -12%, rgba(37, 99, 235, .11), transparent 60%),
  radial-gradient(720px 400px at 96% -4%, rgba(34, 211, 238, .1), transparent 62%),
  linear-gradient(180deg, #f6f9ff 0%, #eef4ff 52%, #f6f9ff 100%); color: #0f172a; }
.hcs-app[data-theme='light'] .hch::after { background-image: linear-gradient(rgba(37, 99, 235, .055) 1px, transparent 1px), linear-gradient(90deg, rgba(37, 99, 235, .055) 1px, transparent 1px); }
.hcs-app[data-theme='light'] .hch-top { border-bottom-color: #e0e8f4; background: rgba(255, 255, 255, .82); color: #0f172a; }
.hcs-app[data-theme='light'] .hch-brandLine { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-brandText small, .hcs-app[data-theme='light'] .hch-engine, .hcs-app[data-theme='light'] .hch-heroDesc, .hcs-app[data-theme='light'] .hch-statLabel, .hcs-app[data-theme='light'] .hch-statFootText, .hcs-app[data-theme='light'] .hch-cardSub, .hcs-app[data-theme='light'] .hch-legend, .hcs-app[data-theme='light'] .hch-chartPeak, .hcs-app[data-theme='light'] .hch-pipeNode small, .hcs-app[data-theme='light'] .hch-checkLabel, .hcs-app[data-theme='light'] .hch-taskMeta, .hcs-app[data-theme='light'] .hch-taskTime, .hcs-app[data-theme='light'] .hch-foot, .hcs-app[data-theme='light'] .hch-connDesc, .hcs-app[data-theme='light'] .hch-connTest { color: #64748b; }
.hcs-app[data-theme='light'] .hch-heroDescLine::before { background: #0891b2; box-shadow: 0 0 5px rgba(8, 145, 178, .45); }
.hcs-app[data-theme='light'] .hch-heroTitle, .hcs-app[data-theme='light'] .hch-statValue, .hcs-app[data-theme='light'] .hch-cardTitle, .hcs-app[data-theme='light'] .hch-pipeNode b, .hcs-app[data-theme='light'] .hch-taskName, .hcs-app[data-theme='light'] .hch-connTitle, .hcs-app[data-theme='light'] .hch-nodeText b { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-nav { border-color: #dbe5f2; background: rgba(15, 23, 42, .025); }
.hcs-app[data-theme='light'] .hch-navItem { color: #5b6b85; }
.hcs-app[data-theme='light'] .hch-navItem:hover { background: #eef4fc; color: #0f172a; }
.hcs-app[data-theme='light'] .hch-topBtn { border-color: #cfe0f8; background: #eff6ff; color: #1d4ed8; }
.hcs-app[data-theme='light'] .hch-topBtn:hover { border-color: #93c5fd; background: #dbeafe; }
.hcs-app[data-theme='light'] .hch-iconBtn { border-color: #d7e3f4; background: #fff; color: #1d4ed8; }
.hcs-app[data-theme='light'] .hch-iconBtn:hover { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; }
.hcs-app[data-theme='light'] .hch-hero { border-color: #d8e4f5; background: radial-gradient(90% 130% at 0% 0%, rgba(37, 99, 235, .12), transparent 58%), radial-gradient(70% 90% at 96% 100%, rgba(34, 211, 238, .08), transparent 60%), linear-gradient(135deg, #ffffff, #f2f7ff); box-shadow: 0 24px 70px rgba(37, 99, 235, .12), inset 0 1px 0 #fff; }
.hcs-app[data-theme='light'] .hch-hero::before { background-image: linear-gradient(rgba(37, 99, 235, .055) 1px, transparent 1px), linear-gradient(90deg, rgba(37, 99, 235, .055) 1px, transparent 1px); }
.hcs-app[data-theme='light'] .hch-hero::after { background: radial-gradient(circle, rgba(34, 211, 238, .15), rgba(37, 99, 235, .05) 44%, transparent 68%); }
.hcs-app[data-theme='light'] .hch-eyebrow { border-color: #cfe0ff; background: #edf5ff; color: #2563eb; }
.hcs-app[data-theme='light'] .hch-ctaSecondary { border-color: #d3e1f4; background: #fff; color: #1e3a8a; }
.hcs-app[data-theme='light'] .hch-ctaSecondary:hover { border-color: #93c5fd; background: #eff6ff; }
.hcs-app[data-theme='light'] .hch-visualHalo { background: radial-gradient(circle, rgba(37, 99, 235, .14), transparent 66%); }
.hcs-app[data-theme='light'] .hch-orbit { border-color: rgba(37, 99, 235, .15); }
.hcs-app[data-theme='light'] .hch-orbitB { border-color: rgba(13, 148, 136, .12); }
.hcs-app[data-theme='light'] .hch-connector { stroke: rgba(37, 99, 235, .34); }
.hcs-app[data-theme='light'] .hch-connectorDot { fill: #0891b2; filter: drop-shadow(0 0 2px rgba(8, 145, 178, .6)); }
.hcs-app[data-theme='light'] .hch-flowNode small, .hcs-app[data-theme='light'] .hch-flowEngine small { color: #64748b; }
.hcs-app[data-theme='light'] .hch-flowEngine b { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-flowLine { background: linear-gradient(90deg, rgba(37, 99, 235, .12), rgba(37, 99, 235, .4), rgba(37, 99, 235, .12)); }
.hcs-app[data-theme='light'] .hch-flowDot { background: #0891b2; box-shadow: 0 0 9px rgba(8, 145, 178, .6); }
.hcs-app[data-theme='light'] .hch-engineBox { border-color: #60a5fa; background: linear-gradient(150deg, rgba(37, 99, 235, .2), rgba(14, 165, 233, .06)); color: #1d4ed8; box-shadow: 0 10px 28px rgba(37, 99, 235, .12), 0 0 24px rgba(37, 99, 235, .12), inset 0 1px 0 rgba(255, 255, 255, .5); }
.hcs-app[data-theme='light'] .hch-engineOrbitCircle { stroke: rgba(37, 99, 235, .35); }
.hcs-app[data-theme='light'] .hch-engineArc { stroke: #2563eb; filter: drop-shadow(0 0 4px rgba(37, 99, 235, .55)); }
.hcs-app[data-theme='light'] .hch-console { border-color: #d4e2f5; background: linear-gradient(160deg, #ffffff, #f2f7ff); box-shadow: 0 20px 50px rgba(37, 99, 235, .16), inset 0 1px 0 #fff; }
.hcs-app[data-theme='light'] .hch-consoleHead { border-bottom-color: #e3ebf6; }
.hcs-app[data-theme='light'] .hch-consoleTitle { color: #64748b; }
.hcs-app[data-theme='light'] .hch-windowDots i { background: #cbd5e1; }
.hcs-app[data-theme='light'] .hch-nodeChip { border-color: #d6e3f5; background: #fff; box-shadow: 0 14px 32px rgba(37, 99, 235, .12), inset 0 1px 0 #fff; }
.hcs-app[data-theme='light'] .hch-nodeText small { color: #64748b; }
.hcs-app[data-theme='light'] .hch-stat, .hcs-app[data-theme='light'] .hch-card { border-color: #e0e8f3; background: linear-gradient(155deg, #ffffff, #f8fbff); box-shadow: 0 10px 28px rgba(15, 23, 42, .05), inset 0 1px 0 #fff; }
.hcs-app[data-theme='light'] .hch-trendSide { border-left-color: #e6edf7; background: linear-gradient(180deg, rgba(37, 99, 235, .025), transparent 55%); }
.hcs-app[data-theme='light'] .hch-quickBtn { border-color: #e2eaf5; background: #fff; color: #334155; }
.hcs-app[data-theme='light'] .hch-quickBtn:hover { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; }
.hcs-app[data-theme='light'] .hch-recentCount { color: #94a3b8; }
.hcs-app[data-theme='light'] .hch-summarySection { border-top-color: #eef3fa; }
.hcs-app[data-theme='light'] .hch-summaryRow { color: #64748b; }
.hcs-app[data-theme='light'] .hch-summaryRow b { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-summaryBar { background: #e8eef7; }
.hcs-app[data-theme='light'] .hch-recentWideRow { border-bottom-color: #eef3fa; }
.hcs-app[data-theme='light'] .hch-recentWideName { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-recentWideTask, .hcs-app[data-theme='light'] .hch-recentWideTime { color: #94a3b8; }
.hcs-app[data-theme='light'] .hch-sideEyebrow { color: #64748b; }
.hcs-app[data-theme='light'] .hch-sideTile { border-color: #e2eaf5; background: #fff; }
.hcs-app[data-theme='light'] .hch-sideTile span { color: #64748b; }
.hcs-app[data-theme='light'] .hch-sideTile b { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-sideRecentRow { border-bottom-color: #eef3fa; }
.hcs-app[data-theme='light'] .hch-sideRecentName { color: #334155; }
.hcs-app[data-theme='light'] .hch-sideRecentTime, .hcs-app[data-theme='light'] .hch-sideRecentCount, .hcs-app[data-theme='light'] .hch-sideEmpty { color: #94a3b8; }
.hcs-app[data-theme='light'] .hch-sideMore { border-color: #dbe5f2; color: #64748b; }
.hcs-app[data-theme='light'] .hch-sideMore:hover { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; }
.hcs-app[data-theme='light'] .hch-sideAction { border-color: #dbe5f2; background: #fff; color: #334155; }
.hcs-app[data-theme='light'] .hch-sideAction:hover { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; }
.hcs-app[data-theme='light'] .hch-stat:hover { box-shadow: 0 18px 38px rgba(15, 23, 42, .08); }
.hcs-app[data-theme='light'] .hch-statLive { color: #94a3b8; }
.hcs-app[data-theme='light'] .hch-tabs { border-color: #dde7f4; background: #f2f7fd; }
.hcs-app[data-theme='light'] .hch-tab { color: #64748b; }
.hcs-app[data-theme='light'] .hch-tab:hover { color: #1e3a8a; }
.hcs-app[data-theme='light'] .hch-tab[data-active='true'] { background: #dbeafe; color: #1d4ed8; box-shadow: none; }
.hcs-app[data-theme='light'] .hch-chart text { fill: #64748b; }
.hcs-app[data-theme='light'] .hch-chart line { stroke: #e3eaf4; }
.hcs-app[data-theme='light'] .hch-chartEmpty { background: rgba(255, 255, 255, .82); }
.hcs-app[data-theme='light'] .hch-chartEmpty p { color: #64748b; }
.hcs-app[data-theme='light'] .hch-chartEmpty button { border-color: #cfe0ff; background: #eff6ff; color: #1d4ed8; }
.hcs-app[data-theme='light'] .hch-checkValue { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-meterHead { color: #64748b; }
.hcs-app[data-theme='light'] .hch-meterHead b { color: #0e7490; }
.hcs-app[data-theme='light'] .hch-meterTrack { background: #e2e8f2; }
.hcs-app[data-theme='light'] .hch-codeOld { color: #b91c1c; text-decoration-color: rgba(185, 28, 28, .45); }
.hcs-app[data-theme='light'] .hch-codeNew { color: #0e7490; }
.hcs-app[data-theme='light'] .hch-running, .hcs-app[data-theme='light'] .hch-consoleNote { color: #047857; }
.hcs-app[data-theme='light'] .hch-consoleNote.isWarn { color: #b45309; }
.hcs-app[data-theme='light'] .hch-pipeNode, .hcs-app[data-theme='light'] .hch-check { border-color: #e2eaf5; background: #f8fbff; }
.hcs-app[data-theme='light'] .hch-pipeCta { border-color: #cfe0ff; background: #eff6ff; color: #1d4ed8; }
.hcs-app[data-theme='light'] .hch-linkBtn { border-color: #cfe0ff; background: #eff6ff; color: #1d4ed8; }
.hcs-app[data-theme='light'] .hch-task:hover { background: #f1f7ff; }
.hcs-app[data-theme='light'] .hch-task + .hch-task { border-top-color: #edf2f9; }
.hcs-app[data-theme='light'] .hch-taskTrack { background: #e6edf7; }
.hcs-app[data-theme='light'] .hch-connColumn .hcs-conn { border-color: #e2eaf5; background: #fff; }
.hcs-app[data-theme='light'] .hch-connColumn .hcs-connName { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-connColumn .hcs-connMeta { color: #64748b; }
.hcs-app[data-theme='light'] .hch-connColumnTitle { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-connColumnTitle svg { color: #2563eb; }
.hcs-app[data-theme='light'] .hch-connColumn[data-side='target'] .hch-connColumnTitle svg { color: #059669; }
.hcs-app[data-theme='light'] .hch-connCount { background: #eff6ff; color: #1d4ed8; }
.hcs-app[data-theme='light'] .hch-connColumn[data-side='target'] .hch-connCount { background: #ecfdf5; color: #047857; }
.hcs-app[data-theme='light'] .hch-connColumnHint { color: #64748b; }

.hcs-app[data-theme='light'] .hch-connEmptyCol { border-color: #dbe5f2; color: #64748b; }
.hcs-app[data-theme='light'] .hch-settingsRow { border-bottom-color: #eef3fa; }
.hcs-app[data-theme='light'] .hch-settingsLabel b { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-settingsLabel small { color: #64748b; }
.hcs-app[data-theme='light'] .hch-settingsValue { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-settingsText { color: #475569; }
.hcs-app[data-theme='light'] .hch-themeSwitch { border-color: #e0e8f3; background: #fff; }
.hcs-app[data-theme='light'] .hch-themeSwitch button { color: #64748b; }
.hcs-app[data-theme='light'] .hch-themeSwitch button[data-active='true'] { background: #eff6ff; color: #1d4ed8; }
.hcs-app[data-theme='light'] .hch-toggleTrack { background: #cbd5e1; }
.hcs-app[data-theme='light'] .hch-toggleText { color: #475569; }
.hcs-app[data-theme='light'] .hch-confirm { border-color: #e0e8f3; background: #fff; box-shadow: 0 28px 70px rgba(15, 23, 42, .22); }
.hcs-app[data-theme='light'] .hch-confirmTitle { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-confirmText { color: #475569; }
.hcs-app[data-theme='light'] .hch-connToast { border-color: #a7f3d0; background: #f0fdf4; color: #047857; box-shadow: 0 16px 40px rgba(15, 23, 42, .18); }
.hcs-app[data-theme='light'] .hch-connToast[data-kind='error'] { border-color: #fecaca; background: #fef2f2; color: #b91c1c; }
.hcs-app[data-theme='light'] .hch-connCard .hcs-connName { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-connCard .hcs-connMeta, .hcs-app[data-theme='light'] .hch-connCard .hcs-connEmpty, .hcs-app[data-theme='light'] .hch-connCard .hcs-label { color: #64748b; }
.hcs-app[data-theme='light'] .hch-connCard .hcs-input, .hcs-app[data-theme='light'] .hch-connCard .hcs-select { border-color: #dbe5f2; background: #f8fbff; color: #0f172a; }
.hcs-app[data-theme='light'] .hch-connTest[data-kind='ok'] { border-color: #a7f3d0; color: #047857; }
.hcs-app[data-theme='light'] .hch-connTest[data-kind='error'] { border-color: #fecaca; color: #b91c1c; }
/* Overview pages: migration tasks, assessment, history */
.hch-pageInner { max-width: none; }
.hch-pageHead { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 4px 2px 2px; }
.hch-pageHeading { flex: 1 1 320px; min-width: 0; }
.hch-pageTitle { margin: 13px 0 7px; color: #f4f8ff; font-size: 30px; font-weight: 800; letter-spacing: -.035em; line-height: 1.1; }
.hch-pageDesc { max-width: 720px; margin: 0; color: #7b90b3; font-size: 11.5px; line-height: 1.7; }
.hch-pageActions { display: flex; flex: none; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 10px; margin-left: auto; padding-top: 10px; }
.hch-pageStats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.hch-pageStat { padding-bottom: 16px; }
.hch-pageStat .hch-statTop { justify-content: space-between; }
.hch-pageCard { padding-bottom: 6px; }
.hch-pageTable { display: flex; flex-direction: column; padding: 8px; }
.hch-pageRow { display: grid; align-items: center; gap: 12px; padding: 11px 10px; border-radius: 10px; cursor: pointer; transition: background .15s ease; }
.hch-pageRow:hover { background: rgba(59, 130, 246, .06); }
.hch-pageRow:focus-visible { outline: 2px solid #38bdf8; outline-offset: -2px; }
.hch-taskPageRow { grid-template-columns: 32px minmax(0, 1fr) 240px 112px; }
.hch-pageRowMain { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.hch-pageRowTitle { overflow: hidden; color: #e2ecff; font-size: 10.5px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.hch-pageRowMeta { overflow: hidden; color: #6d82a6; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.hch-pageRowProgress { display: flex; flex-direction: column; gap: 5px; }
.hch-steps { display: flex; align-items: center; min-width: 0; }
.hch-step { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
.hch-stepDot { position: relative; display: grid; flex: none; place-items: center; width: 18px; height: 18px; border: 1px dashed rgba(148, 163, 184, .42); border-radius: 50%; background: rgba(148, 163, 184, .05); color: #64748b; transition: background .2s ease, color .2s ease, box-shadow .2s ease; }
.hch-stepLabel { overflow: hidden; color: #64748b; font-size: 9.5px; line-height: 1; white-space: nowrap; text-overflow: ellipsis; }
.hch-step.is-done .hch-stepDot { border: 0; background: linear-gradient(135deg, #10b981, #34d399); color: #04231f; box-shadow: 0 0 0 3px rgba(52, 211, 153, .12), 0 4px 12px rgba(16, 185, 129, .26); }
.hch-step.is-done .hch-stepLabel { color: #6ee7b7; }
.hch-step.is-partial .hch-stepDot { color: #6ee7b7; border-color: currentColor; }
.hch-step.is-partial .hch-stepLabel { color: #6ee7b7; }
.hch-step.is-active .hch-stepDot { border: 0; background: linear-gradient(135deg, #2563eb, #22d3ee); color: #eaf6ff; box-shadow: 0 0 0 3px rgba(34, 211, 238, .12), 0 6px 16px rgba(37, 99, 235, .32); animation: hch-stepPulse 1.8s ease-in-out infinite; }
.hch-step.is-active .hch-stepLabel { color: #bae6fd; font-weight: 600; }
.hch-step.is-error .hch-stepDot { border: 0; background: linear-gradient(135deg, #ef4444, #fb7185); color: #fff1f2; box-shadow: 0 0 0 3px rgba(248, 113, 113, .14), 0 4px 12px rgba(239, 68, 68, .26); }
.hch-step.is-error .hch-stepLabel { color: #fca5a5; }
.hch-stepLink { display: block; flex: none; width: 16px; height: 2px; margin: 0 5px; border-radius: 2px; background: repeating-linear-gradient(90deg, rgba(148, 163, 184, .34) 0 4px, transparent 4px 8px); }
.hch-stepLink.is-done { background: linear-gradient(90deg, #10b981, #34d399); }
.hch-stepLink.is-active { background: linear-gradient(90deg, #22d3ee, #2563eb, #22d3ee); background-size: 200% 100%; animation: hch-flow 1.6s linear infinite; }
.hch-stepLink.is-error { background: linear-gradient(90deg, #ef4444, #fb7185); }
@keyframes hch-stepPulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(34, 211, 238, .1), 0 6px 16px rgba(37, 99, 235, .28); }
  50% { box-shadow: 0 0 0 6px rgba(34, 211, 238, .16), 0 8px 22px rgba(37, 99, 235, .46); }
}
.hch-pageEmpty { padding: 36px 16px; color: #7186a9; font-size: 10.5px; text-align: center; }
.hch-cardAside { display: flex; flex: none; align-items: center; gap: 8px; }
.hch-taskTypeChips { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
.hch-taskTypeChip { padding: 1px 5px; border: 1px solid rgba(96, 165, 250, .18); border-radius: 4px; background: rgba(59, 130, 246, .07); color: #8fb8ee; font-size: 7px; font-weight: 600; line-height: 13px; }
.hch-taskTypeChip.isMore { border-color: transparent; background: transparent; color: #6d82a6; }
.hch-taskRowActions { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
.hch-taskAction { display: grid; place-items: center; width: 25px; height: 25px; padding: 0; border: 1px solid rgba(121, 157, 224, .16); border-radius: 7px; background: rgba(255, 255, 255, .025); color: #8da2c3; cursor: pointer; transition: background .15s ease, border-color .15s ease, color .15s ease; }
.hch-taskAction:hover { border-color: rgba(96, 165, 250, .42); background: rgba(59, 130, 246, .13); color: #dbeafe; }
.hch-taskAction.isDanger:hover { border-color: rgba(248, 113, 113, .42); background: rgba(248, 113, 113, .12); color: #fca5a5; }
.hch-pageRow .hch-taskAction { opacity: .58; }
.hch-pageRow:hover .hch-taskAction, .hch-pageRow:focus-within .hch-taskAction { opacity: 1; }
.hch-wizardOverlay { position: fixed; inset: 0; z-index: 90; display: flex; align-items: center; justify-content: center; padding: 22px; background: rgba(3, 8, 18, .64); backdrop-filter: blur(7px); animation: hch-fade .18s ease both; }
.hch-wizard { display: flex; flex-direction: column; width: min(720px, 100%); max-height: min(88vh, 820px); overflow: hidden; border: 1px solid rgba(96, 165, 250, .26); border-radius: 18px; background: radial-gradient(120% 110% at 0% 0%, rgba(37, 99, 235, .2), transparent 56%), linear-gradient(165deg, #0c1628, #070d1b); color: #eaf2ff; box-shadow: 0 34px 96px rgba(0, 0, 0, .62), inset 0 1px 0 rgba(255, 255, 255, .06); animation: hch-wizardIn .22s cubic-bezier(.2, .8, .2, 1) both; }
.hch-wizardHead { display: flex; flex: none; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 18px 22px 13px; border-bottom: 1px solid rgba(121, 157, 224, .12); }
.hch-wizardHeading { min-width: 0; }
.hch-wizardTitle { margin: 9px 0 5px; color: #f4f8ff; font-size: 21px; font-weight: 800; letter-spacing: -.03em; line-height: 1.15; }
.hch-wizardSub { max-width: 560px; margin: 0; color: #7b90b3; font-size: 9.5px; line-height: 1.6; }
.hch-wizardSteps { display: flex; flex: none; align-items: center; gap: 8px; padding: 13px 22px 0; }
.hch-wizardStep { display: flex; align-items: center; gap: 7px; color: #66799b; font-size: 9px; font-weight: 600; white-space: nowrap; }
.hch-wizardStepNo { display: grid; place-items: center; width: 21px; height: 21px; border: 1px solid rgba(121, 157, 224, .22); border-radius: 50%; background: rgba(255, 255, 255, .03); color: #8da2c3; font-size: 8.5px; font-weight: 700; }
.hch-wizardStep[data-state='active'] { color: #dbeafe; }
.hch-wizardStep[data-state='active'] .hch-wizardStepNo { border-color: #3b82f6; background: linear-gradient(135deg, rgba(59, 130, 246, .9), rgba(14, 165, 233, .7)); color: #fff; box-shadow: 0 0 0 3px rgba(59, 130, 246, .12), 0 4px 14px rgba(37, 99, 235, .35); }
.hch-wizardStep[data-state='done'] { color: #7dd3fc; }
.hch-wizardStep[data-state='done'] .hch-wizardStepNo { border-color: rgba(52, 211, 153, .4); background: rgba(52, 211, 153, .12); color: #6ee7b7; }
.hch-wizardStepLine { width: 34px; height: 1px; background: rgba(121, 157, 224, .18); }
.hch-wizardBody { display: flex; flex: 1; flex-direction: column; gap: 14px; min-height: 0; overflow: auto; padding: 18px 22px 20px; scrollbar-color: rgba(96, 165, 250, .28) transparent; scrollbar-width: thin; }
.hch-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.hch-fieldLabel { color: #8da2c3; font-size: 8.5px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
.hch-input, .hch-select { box-sizing: border-box; width: 100%; padding: 0 11px; border: 1px solid rgba(121, 157, 224, .2); border-radius: 9px; outline: none; background: rgba(255, 255, 255, .035); color: #eaf2ff; font: inherit; font-size: 11.5px; }
.hch-input, .hch-select { height: 34px; }
.hch-select { appearance: none; -webkit-appearance: none; padding-right: 28px; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%239db1d2' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/></svg>"); background-repeat: no-repeat; background-position: right 10px center; }
.hch-select option { background: #0c1628; color: #eaf2ff; }
.hch-selectWrap { position: relative; width: 100%; }
.hch-selectBtn { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding-right: 10px; background-image: none; text-align: left; cursor: pointer; }
.hch-selectValue { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hch-selectArrow { flex: none; width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid #9db1d2; }
.hch-selectMenu { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 120; max-height: 260px; padding: 4px; border: 1px solid rgba(121, 157, 224, .3); border-radius: 10px; background: #0c1628; box-shadow: 0 18px 44px rgba(0, 0, 0, .55); overflow: auto; }
.hch-selectMenu[data-up='true'] { top: auto; bottom: calc(100% + 4px); }
.hch-selectOption { display: block; width: 100%; padding: 8px 9px; border: 0; border-radius: 7px; background: transparent; color: #dbe7fb; font: inherit; font-size: 11.5px; text-align: left; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hch-selectOption:hover, .hch-selectOption[data-selected='true'] { background: rgba(59, 130, 246, .18); color: #ffffff; }
.hch-selectMenu[data-theme='light'] { border-color: #d9e4f2; background: #ffffff; box-shadow: 0 18px 44px rgba(15, 23, 42, .16); }
.hch-selectMenu[data-theme='light'] .hch-selectOption { color: #0f172a; }
.hch-selectMenu[data-theme='light'] .hch-selectOption:hover, .hch-selectMenu[data-theme='light'] .hch-selectOption[data-selected='true'] { background: #eff6ff; color: #1d4ed8; }
.hch-input:focus, .hch-select:focus { border-color: rgba(96, 165, 250, .72); background: rgba(59, 130, 246, .07); box-shadow: 0 0 0 3px rgba(37, 99, 235, .14); }
.hch-input::placeholder { color: #5f7497; }
.hch-modeGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.hch-modeCard { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; padding: 10px 11px; border: 1px solid rgba(121, 157, 224, .17); border-radius: 11px; background: rgba(255, 255, 255, .022); color: #b9cbe8; font: inherit; text-align: left; cursor: pointer; transition: border-color .16s ease, background .16s ease, box-shadow .16s ease; }
.hch-modeCard:hover { border-color: rgba(96, 165, 250, .42); background: rgba(59, 130, 246, .07); }
.hch-modeCard b { font-size: 10.5px; font-weight: 650; }
.hch-modeCard small { color: #7186a9; font-size: 7.5px; line-height: 1.45; }
.hch-modeCardIcon { display: grid; place-items: center; width: 25px; height: 25px; margin-bottom: 4px; border-radius: 7px; background: rgba(96, 165, 250, .1); color: #7dd3fc; }
.hch-modeCard[data-active='true'] { border-color: rgba(59, 130, 246, .75); background: linear-gradient(145deg, rgba(37, 99, 235, .24), rgba(14, 165, 233, .06)); color: #fff; box-shadow: 0 0 0 1px rgba(59, 130, 246, .28), 0 10px 26px rgba(37, 99, 235, .2); }
.hch-modeCard[data-active='true'] small { color: #9db1d2; }
.hch-modeCard[data-active='true'] .hch-modeCardIcon { background: rgba(59, 130, 246, .32); color: #e0f2fe; }
.hch-wizardInline { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 9px 11px; border: 1px dashed rgba(121, 157, 224, .24); border-radius: 9px; color: #8da2c3; font-size: 10px; }
.hch-linkBtn { padding: 0; border: 0; background: transparent; color: #7dd3fc; font: inherit; font-size: 10px; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }
.hch-linkBtn:hover { color: #bae6fd; }
.hch-filePick .hch-ctaSecondary { height: 32px; padding: 0 13px; font-size: 10.5px; }
.hch-wizardHint { margin: 0; color: #7186a9; font-size: 9px; line-height: 1.55; }
.hch-typeGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.hch-typeTile { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 9px 10px; border: 1px solid rgba(121, 157, 224, .17); border-radius: 9px; background: rgba(255, 255, 255, .022); cursor: pointer; transition: border-color .15s ease, background .15s ease; }
.hch-typeTile:hover { border-color: rgba(96, 165, 250, .4); background: rgba(59, 130, 246, .06); }
.hch-typeTile[data-checked='true'] { border-color: rgba(59, 130, 246, .62); background: rgba(37, 99, 235, .14); }
.hch-typeTile input { flex: none; margin: 0; accent-color: #3b82f6; }
.hch-typeTileIcon { display: grid; flex: none; place-items: center; width: 22px; height: 22px; border-radius: 6px; background: rgba(96, 165, 250, .1); color: #7dd3fc; }
.hch-typeTileText { display: flex; flex-direction: column; min-width: 0; }
.hch-typeTileText b { color: #e6f0ff; font-size: 10px; font-weight: 600; }
.hch-typeTileText small { color: #6d82a6; font-size: 7px; letter-spacing: .05em; }
.hch-typeActions { display: flex; align-items: center; gap: 12px; }
.hch-typeActions .hch-ctaSecondary { height: 30px; padding: 0 10px; }
.hch-typeActionsCount { margin-left: auto; color: #7b90b3; font-size: 9px; }
.hch-compatGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.hch-compatOption { display: flex; align-items: flex-start; gap: 8px; min-width: 0; padding: 9px 10px; border: 1px solid rgba(121, 157, 224, .17); border-radius: 9px; background: rgba(255, 255, 255, .022); cursor: pointer; transition: border-color .15s ease, background .15s ease; }
.hch-compatOption:hover { border-color: rgba(96, 165, 250, .4); background: rgba(59, 130, 246, .06); }
.hch-compatOption[data-checked='true'] { border-color: rgba(59, 130, 246, .62); background: rgba(37, 99, 235, .14); }
.hch-compatOption[data-disabled='true'] { cursor: default; opacity: .85; }
.hch-compatOption input { flex: none; margin: 2px 0 0; accent-color: #3b82f6; }
.hch-compatText { display: flex; flex-direction: column; min-width: 0; }
.hch-compatText b { color: #e6f0ff; font-size: 10px; font-weight: 600; }
.hch-compatText small { margin-top: 2px; color: #6d82a6; font-size: 8px; line-height: 1.45; }
.hch-summary { display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(121, 157, 224, .15); border-radius: 11px; background: rgba(255, 255, 255, .02); }
.hch-summaryRow { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 9px 12px; border-bottom: 1px solid rgba(121, 157, 224, .08); font-size: 9.5px; }
.hch-summaryRow:last-child { border-bottom: 0; }
.hch-summaryLabel { flex: none; color: #7186a9; }
.hch-summaryValue { min-width: 0; overflow: hidden; color: #e2ecff; font-weight: 600; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
.hch-wizardFoot { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 8px; padding: 13px 22px 17px; border-top: 1px solid rgba(121, 157, 224, .12); }
.hch-wizardFootHint { flex: 1 1 160px; min-width: 0; }
.hch-wizardFoot .hch-ctaSecondary, .hch-wizardFoot .hch-ctaPrimary { height: 34px; padding: 0 15px; font-size: 10.5px; }
@keyframes hch-wizardIn { from { opacity: 0; transform: translateY(14px) scale(.985); } to { opacity: 1; transform: none; } }
.hcs-app[data-theme='light'] .hch-wizardOverlay { background: rgba(15, 23, 42, .34); }
.hcs-app[data-theme='light'] .hch-wizard { border-color: #d9e4f2; background: radial-gradient(120% 110% at 0% 0%, rgba(37, 99, 235, .08), transparent 56%), linear-gradient(165deg, #ffffff, #f7faff); color: #0f172a; box-shadow: 0 28px 72px rgba(15, 23, 42, .24), inset 0 1px 0 #fff; }
.hcs-app[data-theme='light'] .hch-wizardHead { border-bottom-color: #e6eef9; }
.hcs-app[data-theme='light'] .hch-wizardTitle { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-wizardSub, .hcs-app[data-theme='light'] .hch-wizardHint, .hcs-app[data-theme='light'] .hch-wizardInline, .hcs-app[data-theme='light'] .hch-filePickHint, .hcs-app[data-theme='light'] .hch-typeActionsCount { color: #64748b; }
.hcs-app[data-theme='light'] .hch-wizardStep { color: #94a3b8; }
.hcs-app[data-theme='light'] .hch-wizardStepNo { border-color: #d9e4f2; background: #fff; color: #64748b; }
.hcs-app[data-theme='light'] .hch-wizardStep[data-state='active'] { color: #1d4ed8; }
.hcs-app[data-theme='light'] .hch-wizardStep[data-state='done'] { color: #047857; }
.hcs-app[data-theme='light'] .hch-fieldLabel { color: #64748b; }
.hcs-app[data-theme='light'] .hch-input, .hcs-app[data-theme='light'] .hch-select, .hcs-app[data-theme='light'] .hch-textarea { border-color: #d9e4f2; background: #ffffff; color: #0f172a; }
.hcs-app[data-theme='light'] .hch-input::placeholder, .hcs-app[data-theme='light'] .hch-textarea::placeholder { color: #94a3b8; }
.hcs-app[data-theme='light'] .hch-select option { background: #ffffff; color: #0f172a; }
.hcs-app[data-theme='light'] .hch-selectArrow { border-top-color: #64748b; }
.hcs-app[data-theme='light'] .hch-selectMenu { border-color: #d9e4f2; background: #ffffff; box-shadow: 0 18px 44px rgba(15, 23, 42, .16); }
.hcs-app[data-theme='light'] .hch-selectOption { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-selectOption:hover, .hcs-app[data-theme='light'] .hch-selectOption[data-selected='true'] { background: #eff6ff; color: #1d4ed8; }
.hcs-app[data-theme='light'] .hch-modeCard { border-color: #e0e8f3; background: #fff; color: #475569; }
.hcs-app[data-theme='light'] .hch-modeCard small { color: #94a3b8; }
.hcs-app[data-theme='light'] .hch-modeCard[data-active='true'] { border-color: #7db3f6; background: linear-gradient(145deg, #eff6ff, #f5faff); color: #0f172a; box-shadow: 0 0 0 1px rgba(59, 130, 246, .2), 0 10px 24px rgba(37, 99, 235, .1); }
.hcs-app[data-theme='light'] .hch-modeCard[data-active='true'] .hch-modeCardIcon { background: #dbeafe; color: #1d4ed8; }
.hcs-app[data-theme='light'] .hch-modeCardIcon { background: #eff6ff; color: #2563eb; }
.hcs-app[data-theme='light'] .hch-typeTile { border-color: #e0e8f3; background: #fff; }
.hcs-app[data-theme='light'] .hch-typeTile[data-checked='true'] { border-color: #8ab8f8; background: #eff6ff; }
.hcs-app[data-theme='light'] .hch-typeTileIcon { background: #eff6ff; color: #2563eb; }
.hcs-app[data-theme='light'] .hch-typeTileText b { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-typeTileText small { color: #94a3b8; }
.hcs-app[data-theme='light'] .hch-switchRow { border-color: #d9e4f2; background: linear-gradient(145deg, #f3f8ff, #fbfdff); }
.hcs-app[data-theme='light'] .hch-switchText b { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-switchText small { color: #64748b; }
.hcs-app[data-theme='light'] .hch-compatOption { border-color: #e0e8f3; background: #fff; }
.hcs-app[data-theme='light'] .hch-compatOption[data-checked='true'] { border-color: #8ab8f8; background: #eff6ff; }
.hcs-app[data-theme='light'] .hch-compatText b { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-compatText small { color: #64748b; }
.hcs-app[data-theme='light'] .hch-summary { border-color: #e0e8f3; background: #fff; }
.hcs-app[data-theme='light'] .hch-summaryRow { border-bottom-color: #eef3fa; }
.hcs-app[data-theme='light'] .hch-summaryValue { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-wizardFoot { border-top-color: #e6eef9; }
.hcs-app[data-theme='light'] .hch-taskTypeChip { border-color: #dbeafe; background: #eff6ff; color: #2563eb; }
.hcs-app[data-theme='light'] .hch-taskAction { border-color: #e0e8f3; background: #fff; color: #64748b; }
.hcs-app[data-theme='light'] .hch-taskAction:hover { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; }
.hcs-app[data-theme='light'] .hch-taskAction.isDanger:hover { border-color: #fecaca; background: #fef2f2; color: #b91c1c; }
@media (max-width: 640px) {
  .hch-wizardOverlay { padding: 0; }
  .hch-wizard { width: 100%; height: 100%; max-height: 100%; border: 0; border-radius: 0; }
  .hch-wizardSteps { overflow-x: auto; scrollbar-width: none; }
  .hch-wizardStepLine { width: 16px; }
  .hch-modeGrid { grid-template-columns: minmax(0, 1fr); }
  .hch-typeGrid { grid-template-columns: minmax(0, 1fr); }
  .hch-taskTypeChips { display: none; }
  .hch-taskRowActions { gap: 2px; }
  .hch-taskAction { width: 24px; height: 24px; }}
.hch-assessHead .hch-cardTitle { margin: 0 0 4px; }
.hcs-app[data-theme='light'] .hch-pageTitle { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-pageDesc, .hcs-app[data-theme='light'] .hch-pageRowMeta, .hcs-app[data-theme='light'] .hch-assessLegendRow, .hcs-app[data-theme='light'] .hch-assessBarLabel, .hcs-app[data-theme='light'] .hch-assessNote, .hcs-app[data-theme='light'] .hch-donutValue span, .hcs-app[data-theme='light'] .hch-historyHead { color: #64748b; }
.hcs-app[data-theme='light'] .hch-pageRowTitle, .hcs-app[data-theme='light'] .hch-donutValue b, .hcs-app[data-theme='light'] .hch-assessLegendRow b, .hcs-app[data-theme='light'] .hch-assessLegendTotal b, .hcs-app[data-theme='light'] .hch-assessBarValue { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-stepDot { border-color: #cbd5e1; background: #f1f5f9; color: #94a3b8; }
.hcs-app[data-theme='light'] .hch-stepLabel { color: #94a3b8; }
.hcs-app[data-theme='light'] .hch-step.is-done .hch-stepDot { border: 0; background: linear-gradient(135deg, #10b981, #34d399); color: #04231f; }
.hcs-app[data-theme='light'] .hch-step.is-done .hch-stepLabel { color: #047857; }
.hcs-app[data-theme='light'] .hch-step.is-partial .hch-stepDot, .hcs-app[data-theme='light'] .hch-step.is-partial .hch-stepLabel { color: #047857; }
.hcs-app[data-theme='light'] .hch-step.is-active .hch-stepDot { border: 0; background: linear-gradient(135deg, #2563eb, #22d3ee); color: #eff6ff; }
.hcs-app[data-theme='light'] .hch-step.is-active .hch-stepLabel { color: #1d4ed8; }
.hcs-app[data-theme='light'] .hch-step.is-error .hch-stepDot { border: 0; background: linear-gradient(135deg, #ef4444, #fb7185); color: #fff; }
.hcs-app[data-theme='light'] .hch-step.is-error .hch-stepLabel { color: #b91c1c; }
.hcs-app[data-theme='light'] .hch-stepLink { background: repeating-linear-gradient(90deg, rgba(148, 163, 184, .42) 0 4px, transparent 4px 8px); }
.hcs-app[data-theme='light'] .hch-assessBarTrack { background: #e6edf7; }
.hcs-app[data-theme='light'] .hch-assessHead, .hcs-app[data-theme='light'] .hch-assessLegendTotal, .hcs-app[data-theme='light'] .hch-historyHead { border-color: #e2eaf5; }
.hcs-app[data-theme='light'] .hch-historyRow { color: #334155; }
.hcs-app[data-theme='light'] .hch-historyRow:hover { background: #f1f7ff; }
.hcs-app[data-theme='light'] .hch-historyObjectName { color: #0f172a; }
.hcs-app[data-theme='light'] .hch-historyObjectMeta { color: #64748b; }
.hcs-app[data-theme='light'] .hch-historyActionTag.isBoth { border-color: #99f6e4; background: #f0fdfa; color: #0f766e; }
@media (max-width: 1100px) {
  .hch-navItem { height: 32px; padding: 0 13px; font-size: 12px; }}
@media (max-width: 1280px) {
  .hch-top { gap: 10px; padding: 0 16px; }
  .hch-brandText small { display: none; }
  .hch-navItem { height: 32px; padding: 0 13px; font-size: 12px; }}
@media (max-width: 1080px) {
  .hch-brandText small { display: none; }
  .hch-engine { display: none; }
  .hch-navItem { padding: 0 11px; font-size: 11.5px; }}
@media (max-width: 860px) {
  .hch-top { flex-wrap: wrap; gap: 8px; padding: 8px 12px; }
  .hch-brand { flex: 1 1 auto; }
  .hch-topRight { flex: 0 0 auto; }
  .hch-nav { order: 3; flex: 1 0 100%; width: 100%; justify-content: flex-start; }
  .hch-navItem { flex: 0 0 auto; }}
@media (max-width: 960px) {
  .hch-navItem { padding: 0 10px; font-size: 11.5px; }}
@media (max-width: 860px) {
  .hch-pageStats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hch-taskPageRow { grid-template-columns: 30px minmax(0, 1fr) 118px; }
  .hch-pageRowProgress { display: none; }}
@media (max-width: 560px) {
  .hch-pageTitle { font-size: 25px; }
  .hch-pageStats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }}
@keyframes hch-toastIn { from { opacity: 0; transform: translate(-50%, -6px); } to { opacity: 1; transform: translate(-50%, 0); } }
@keyframes hch-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes hch-shine { 0%, 55% { left: -42%; } 86%, 100% { left: 118%; } }
@keyframes hch-live { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .55; transform: scale(.82); } }
@keyframes hch-orbitSpin { to { transform: translate(-50%, -50%) rotate(360deg); } }
@keyframes hch-dashFlow { to { stroke-dashoffset: -16; } }
@keyframes hch-flowDot { 0% { left: 0; opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { left: calc(100% - 5px); opacity: 0; } }
@keyframes hch-breathe { 0%, 100% { opacity: .55; transform: scale(.9); } 50% { opacity: 1; transform: scale(1.12); } }
@keyframes hch-draw { to { stroke-dashoffset: 0; } }
@keyframes hch-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes hch-point { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
@keyframes hch-meter { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes hch-rotate { to { transform: rotate(360deg); } }
@keyframes hch-flow { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }
@media (max-width: 1120px) {
  .hch-hero { grid-template-columns: minmax(0, 1fr) minmax(360px, .9fr); padding: 28px; }
  .hch-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }}
@media (max-width: 860px) {
  .hch-top { flex-wrap: wrap; gap: 10px; padding: 12px 18px; }
  .hch-nav { order: 3; width: 100%; justify-content: center; }
  .hch-topRight { margin-left: auto; }
  .hch-engine { display: none; }
  .hch-inner { padding: 18px; }
  .hch-hero { grid-template-columns: minmax(0, 1fr); gap: 18px; padding: 26px 22px; }
  .hch-visual { width: 100%; max-width: 430px; min-height: 300px; margin: 0 auto; }}
@media (max-height: 1120px) {
  .hch-home .hch-inner { gap: 10px; padding-top: 12px; padding-bottom: 12px; }
  .hch-home .hch-hero { padding: 18px 26px; }
  .hch-home .hch-heroTitle { margin: 10px 0 8px; font-size: clamp(28px, 3vw, 44px); }
  .hch-home .hch-heroDesc { font-size: 12.5px; line-height: 1.55; }
  .hch-home .hch-stats { gap: 10px; }
  .hch-home .hch-trendCard .hch-cardHead { padding: 14px 16px 0; }}
@media (max-width: 560px) {
  .hch-top { padding: 10px 14px; }
  .hch-brandText small { display: none; }
  .hch-inner { gap: 12px; padding: 12px 12px 26px; }
  .hch-hero { padding: 22px 18px 20px; border-radius: 18px; }
  .hch-heroTitle { font-size: 30px; }
  .hch-heroDesc { font-size: 13.5px; }
  .hch-ctaPrimary, .hch-ctaSecondary { width: 100%; }
  .hch-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .hch-stat { padding: 13px 13px 12px; }
  .hch-statValue { font-size: 24px; }
  .hch-statFootText { font-size: 8px; }
  .hch-cardHead { padding: 14px 14px 0; }
  .hch-cardSub { font-size: 8.5px; }
  .hch-chartWrap { padding: 2px 0 0; }
  .hch-chartFoot { padding: 0 14px 12px; }}
@media (max-width: 700px) {
  .hch-chart text { font-size: 16px; }}
@media (prefers-reduced-motion: reduce) {
  .hch *, .hch *::before, .hch *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; }}
/* Readability pass: lift the smallest type while keeping the same layout language */
.hcs { font-size: 13px; }
.hch { font-size: 13px; }
.hcs-search { height: 30px; font-size: 12.5px; }
.hcs-listCount { font-size: 12px; }
.hcs-groupHead { font-size: 11.5px; }
.hcs-groupChevron { font-size: 10px; }
.hcs-typeMenuActions .hcs-ghost { font-size: 12px; }
.hcs-btn { height: 28px; font-size: 12px; }
.hcs-btnAi { display: inline-flex; align-items: center; gap: 5px; }
.hcs-btnAi svg { flex: none; color: #7c3aed; }
.hcs-btnLead { display: inline-flex; align-items: center; gap: 5px; }
.hcs-btnLead svg { flex: none; }
.hcs-ghost { height: 26px; font-size: 12px; }
.hcs-paneFoot { height: 28px; font-size: 12px; }
.hcs-select, .hcs-input { height: 30px; font-size: 12.5px; }
.hcs-statusbar { height: 26px; font-size: 12px; }
.hcs-label { font-size: 12px; line-height: 16px; }
.hcs-connName { font-size: 14px; }
.hcs-connMeta { font-size: 12.5px; }
.hcs-menuItem { font-size: 13px; }
.hcs-fileName, .hcs-fileNameInput { font-size: 13px; }
.hcs-insightTab { height: 32px; font-size: 12px; }
.hcs-diffList { font-size: 11.5px; line-height: 18px; }
.hcs-diffNo { font-size: 10.5px; }
.hch-brandText small { font-size: 10.5px; }
.hch-engine { font-size: 11px; }
.hch-nav { gap: 6px; padding: 5px; }
.hch-navItem { height: 38px; padding: 0 26px; font-size: 13.5px; }
.hch-demoChip { font-size: 9.5px; }
.hch-eyebrow { font-size: 10px; }
.hch-heroDesc { font-size: 15px; }
.hch-ctaPrimary, .hch-ctaSecondary { height: 38px; font-size: 12.5px; }
.hch-statLabel { font-size: 11.5px; }
.hch-statFootText { font-size: 10.5px; }
.hch-cardTitle { font-size: 14px; }
.hch-cardSub { font-size: 11.5px; }
.hch-tab { height: 26px; font-size: 11px; }
.hch-sideEyebrow { font-size: 9.5px; }
.hch-sideAction { height: 34px; font-size: 12px; }
.hch-legend, .hch-chartPeak { font-size: 10.5px; }
.hch-taskTime { font-size: 9.5px; }
.hch-pageDesc { font-size: 13px; max-width: 940px; }
.hch-pageRowTitle { font-size: 12.5px; }
.hch-pageRowMeta { font-size: 10.5px; }
.hch-pageEmpty { font-size: 12px; }
.hch-taskTypeChip { font-size: 9px; line-height: 15px; }
.hch-wizardSub { font-size: 11.5px; }
.hch-wizardStep { font-size: 10.5px; }
.hch-wizardStepNo { font-size: 10px; }
.hch-fieldLabel { font-size: 10.5px; }
.hch-input, .hch-select { height: 38px; font-size: 13px; }
.hch-modeCard b { font-size: 12px; }
.hch-modeCard small { font-size: 10px; }
.hch-wizardInline { font-size: 11.5px; }
.hch-filePick .hch-ctaSecondary { height: 34px; font-size: 12px; }
.hch-wizardHint { font-size: 11px; }
.hch-typeTileText b { font-size: 11.5px; }
.hch-typeTileText small { font-size: 9px; }
.hch-typeActionsCount { font-size: 10.5px; }
.hch-linkBtn { font-size: 11.5px; }
.hch-summaryRow { font-size: 11.5px; }
.hch-wizardFoot .hch-ctaSecondary, .hch-wizardFoot .hch-ctaPrimary { height: 36px; font-size: 12px; }
.hch-connDesc { font-size: 13px; }
.hch-flowNode small { font-size: 10px; }
.hch-flowEngine small { width: max-content; font-size: 10.5px; letter-spacing: .08em; white-space: nowrap; }
/* Readability pass 2: task/history rows carry the primary information, keep them at body size */
.hch-pageRow { padding: 14px 12px; }
.hch-pageRowTitle { font-size: 14px; }
.hch-pageRowMeta { font-size: 12px; }
.hch-pageEmpty { font-size: 13px; }
.hch-taskPageRow { grid-template-columns: 34px minmax(0, 1fr) 240px 120px; }
.hch-taskTypeChips { gap: 5px; margin-top: 6px; }
.hch-taskTypeChip { padding: 2px 7px; font-size: 11px; line-height: 18px; }
.hch-taskTime { font-size: 11px; }
.hch-taskAction { width: 28px; height: 28px; }
.hch-cardSub { font-size: 12.5px; }
.hch-statLabel { font-size: 12px; }
.hch-statFootText { font-size: 11.5px; }
.hch-wizardSub { font-size: 12.5px; }
.hch-fieldLabel { font-size: 11.5px; }
.hch-wizardHint { font-size: 12px; }
.hch-modeCard small { font-size: 11px; }
.hch-typeTileText small { font-size: 10px; }
.hch-summaryRow { font-size: 12.5px; }
.hch-typeActionsCount { font-size: 11.5px; }
.hcs-taskTop, .hcs-filterTop { padding-bottom: 0; }
.hch-pageRowTitle { font-size: 15px; }
.hch-heroLead { width: 100%; max-width: 100%; }
.hch-pageRowMeta { font-size: 13px; }
.hch-taskTypeChip { font-size: 12px; line-height: 19px; }
.hch-taskTime { font-size: 11.5px; }
.hch-stepLabel { font-size: 11px; }
.hch-taskPageRow { grid-template-columns: 34px minmax(0, 1fr) 250px 120px; }
@media (max-width: 860px) {
  .hch-taskPageRow { grid-template-columns: 30px minmax(0, 1fr) 118px; }}

/* 顶栏自适应：按宽度逐级收缩，导航可横向滚动，不遮挡品牌 */
@media (max-width: 1360px) {
  .hch-top { gap: 12px; padding: 0 18px; }
  .hch-navItem { height: 34px; padding: 0 18px; font-size: 13px; }
  .hch-engine { font-size: 10.5px; }}
@media (max-width: 1200px) {
  .hch-brandLine { font-size: 14px; }
  .hch-brandText small { display: none; }
  .hch-mark { width: 38px; height: 38px; }
  .hch-nav { padding: 4px; gap: 4px; }
  .hch-navItem { height: 32px; padding: 0 13px; font-size: 12.5px; }
  .hch-topRight { gap: 8px; }}
@media (max-width: 1040px) {
  .hch-top { gap: 10px; padding: 0 12px; min-height: 54px; }
  .hch-pageActions { gap: 8px; padding-top: 6px; }
  .hch-pageHeading { flex: 1 1 100%; }
  .hch-pageActions { flex: 1 1 100%; }
  .hch-brand { gap: 8px; }
  .hch-brandLine { font-size: 13px; }
  .hch-brandLine em { font-size: 7.5px; padding: 1px 4px; letter-spacing: .06em; }
  .hch-mark { width: 34px; height: 34px; }
  .hch-navItem { height: 30px; padding: 0 11px; font-size: 12px; }
  .hch-engine { display: none; }
  /* 窄屏导航可能溢出：改为从左侧开始，避免居中导致左端不可见 */
  .hch-nav { justify-content: flex-start; }}
@media (max-width: 820px) {
  .hch-nav { min-width: 0; }
  .hch-navItem { padding: 0 10px; font-size: 11.5px; }}
@media (max-width: 640px) {
  .hch-brandLine em { display: none; }
  .hch-navItem { padding: 0 8px; font-size: 11px; }
  .hch-top { gap: 8px; padding: 0 8px; }}`

    function summaryRow(label, value) {
      return h('div', { className: 'hcs-summaryRow', role: 'listitem' },
        h('span', { className: 'hcs-summaryLabel' }, label),
        h('span', { className: 'hcs-summaryValue' }, value))
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
      if (/\bPIPELINED\s*$/i.test(returnText)) {
        const pipeline = rewritePgPipeline(bodyRaw)
        if (pipeline !== null) {
          return { text: `CREATE OR REPLACE FUNCTION ${head[2]}(${params}) RETURNS SETOF ${pipeline.type} AS $$\n${pipeline.body}\n$$ LANGUAGE plpgsql;` }
        }
      }

      let body = bodyRaw
      const beginAt = /\bBEGIN\b/i.exec(bodyRaw)
      if (beginAt !== null) {
        const declarations = bodyRaw.slice(0, beginAt.index).trim()
        if (declarations !== '') {
          body = rewritePgRoutine(declarations, bodyRaw.slice(beginAt.index))
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

    /**
     * 目标 schema 由执行器用不带引号的小写名创建（CREATE SCHEMA IF NOT EXISTS test），
     * 而 Oracle GET_DDL 给的是 "TEST"."FN_X"。在 HGDB / PostgreSQL 里双引号是大小写精确的
     * 名称：实测 schema "TEST" 直接报 does not exist，引号内的大写对象名也会变成后续不带
     * 引号就引用不到的对象。这里把带引号的标识符统一归一成小写无引号（跳过字符串与注释），
     * 让本地转换与 AI 在线转换落到同一个目标名上。
     */
    function normalizeQuotedIdentifiers(text) {
      return splitSql(String(text ?? '')).map((part) => {
        if (part.kind !== 'code') return part.text
        return part.text.replace(/"([A-Za-z_][A-Za-z0-9_$#]*)"/g, (match, identifier) => identifier.toLowerCase())
      }).join('')
    }

    function normalizePgCollectionType(sql) {
      const collection = new RegExp(
        '(?:^|;)\\s*CREATE\\s+(?:OR\\s+REPLACE\\s+)?TYPE\\s+(' + DROP_NAME + ')'
        + '\\s+(?:AS|IS)\\s+TABLE\\s+OF\\s+(' + DROP_NAME + '(?:\\s*\\(\\d+(?:\\s*,\\s*\\d+)?\\))?)\\s*(?=;|$)', 'i')
      const match = collection.exec(sql)
      if (match === null) return sql
      const [, name, element] = match
      const start = match.index + match[0].search(/\bCREATE\b/i)
      const prefix = sql.slice(0, start).replace(
        new RegExp('(\\bDROP\\s+)TYPE(\\s+IF\\s+EXISTS\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|;))', 'i'),
        '$1DOMAIN$2')
      return prefix + `CREATE DOMAIN ${name} AS ${element}[]` + sql.slice(match.index + match[0].length)
    }

    function normalizePgSequence(text) {
      const sequence = /(^|;)\s*CREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"(?:[^"]|"")*"|[\w$]+)(?:\s*\.\s*(?:"(?:[^"]|"")*"|[\w$]+))?(\s+[^;]*)/gi
      return text.replace(sequence, (statement, _prefix, options) => {
        const normalized = options.replace(/\b(?:NOCACHE|NOCYCLE|NOMAXVALUE|NOMINVALUE|NOORDER|ORDER)\b|\b(MAXVALUE|MINVALUE)\s+([+-]?\d+)\b/gi,
          (token, bound, raw) => {
            if (bound !== undefined) {
              const value = BigInt(raw)
              if (value > 9223372036854775807n) return `${bound.toUpperCase()} 9223372036854775807`
              if (value < -9223372036854775808n) return `${bound.toUpperCase()} -9223372036854775808`
              return token
            }
            return { NOCACHE: 'CACHE 1', NOCYCLE: 'NO CYCLE', NOMAXVALUE: 'NO MAXVALUE', NOMINVALUE: 'NO MINVALUE' }[token.toUpperCase()] ?? ''
          })
        return statement.slice(0, -options.length) + normalized.trimEnd()
      })
    }

    function stripOracleIndexStatistics(text) {
      return splitSql(text).map(part => part.kind === 'code'
        ? part.text.replace(/\)\s*(?:USING\s+INDEX\s+)?COMPUTE\s+STATISTICS\b(?=\s*(?:[,);]|$))/gi, ')')
        : part.text).join('')
    }

    function rewritePgQuery(text) {
      const masked = splitSql(text).map(part => part.kind === 'code'
        ? part.text.replace(/"(?:""|[^"])*"/g, name => 'x'.repeat(name.length))
        : part.text.replace(/[^\r\n]/g, ' ')).join('')
      const inserts = []
      const derivedTable = /\b(?:FROM|JOIN)\s*\(\s*(?:SELECT|WITH|VALUES)\b/gi
      for (const match of masked.matchAll(derivedTable)) {
        let close = masked.indexOf('(', match.index) + 1
        let depth = 1
        for (; close < masked.length && depth > 0; close++) {
          if (masked[close] === '(') depth++
          else if (masked[close] === ')') depth--
        }
        if (depth !== 0) continue
        const tail = masked.slice(close)
        if (!/^\s*(?:[),;]|$|(?:WHERE|JOIN|LEFT|RIGHT|FULL|INNER|OUTER|CROSS|ON|GROUP|HAVING|ORDER|LIMIT|OFFSET|FETCH|UNION|INTERSECT|EXCEPT|WINDOW|FOR)\b)/i.test(tail)) continue
        let next = inserts.length + 1
        while (new RegExp(`\\b__hcs_subquery_${next}\\b`, 'i').test(text) || inserts.some(item => item.alias === next)) next++
        inserts.push({ close, alias: next })
      }
      for (const { close, alias } of inserts.sort((a, b) => b.close - a.close)) {
        text = text.slice(0, close) + ` AS __hcs_subquery_${alias}` + text.slice(close)
      }
      return text.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|\bLISTAGG\(\s*([\w$.]+)\s*,\s*('(?:[^']|'')*')\s*\)\s*WITHIN\s+GROUP\s*\(\s*ORDER\s+BY\s+([\w$.]+(?:\s+(?:ASC|DESC))?)\s*\)/gi,
        (match, value, delimiter, order) => value === undefined ? match : `STRING_AGG((${value})::text, ${delimiter} ORDER BY ${order})`)
    }

    function rewritePgPipeline(text) {
      // Match the cursor/fetch/pipe idiom only when every projected field comes from the fetched row.
      const match = /^\s*CURSOR\s+(\w+)\s+IS\s+(SELECT\b[\s\S]*?);\s*(\w+)\s+\1%ROWTYPE\s*;\s*BEGIN\s+OPEN\s+\1\s*;\s*LOOP\s+FETCH\s+\1\s+INTO\s+\3\s*;\s*EXIT\s+WHEN\s+\1%NOTFOUND\s+OR\s+\1%ROWCOUNT\s*>\s*(\w+)\s*;\s*PIPE\s+ROW\s*\(\s*([\w$.]+)\s*\(([^()]*)\)\s*\)\s*;\s*END\s+LOOP\s*;\s*CLOSE\s+\1\s*;\s*RETURN\s*;\s*END\s*;\s*$/i.exec(text)
      if (match === null) return null
      const [, , query, row, limit, type, fields] = match
      const projection = new RegExp(`^\\s*${row}\\.\\w+\\s*$`, 'i')
      if (!fields.split(',').every(field => projection.test(field))) return null
      // The original ordered cursor stops after the limit. A NULL limit leaves it unbounded.
      return {
        type,
        body: `DECLARE\n  ${row} record;\nBEGIN\n  FOR ${row} IN ${query}\n    LIMIT CASE WHEN ${limit} IS NULL THEN NULL ELSE greatest(0, floor(${limit}))::bigint END\n  LOOP\n    RETURN NEXT ROW(${fields})::${type};\n  END LOOP;\n  RETURN;\nEND;`,
      }
    }

    function rewritePgRoutine(declarations, body) {
      for (const [, type, element] of declarations.matchAll(/\bTYPE\s+(\w+)\s+IS\s+TABLE\s+OF\s+((?:VARCHAR|CHAR|NUMERIC|INTEGER|TEXT|DATE|TIMESTAMP)(?:\s*\(\d+(?:\s*,\s*\d+)?\))?)\s*;/gi)) {
        const variable = new RegExp(`\\b(\\w+)\\s+${type}\\s*:=\\s*${type}\\(([^()]*)\\)\\s*;`, 'i')
        const match = variable.exec(declarations)
        if (!match || !/^\s*'(?:[^']|'')*'(?:\s*,\s*'(?:[^']|'')*')*\s*$/.test(match[2])) continue
        const [, name, values] = match
        declarations = declarations.replace(variable, `${name} ${element}[] := ARRAY[${values}];`)
          .replace(new RegExp(`\\bTYPE\\s+${type}\\s+IS\\s+TABLE\\s+OF\\s+[^;]+;`, 'i'), '')
        body = splitSql(body).map(part => part.kind === 'code'
          ? part.text.replace(new RegExp(`\\b${name}\\.COUNT\\b`, 'gi'), `cardinality(${name})`)
            .replace(new RegExp(`\\b${name}\\(\\s*(\\w+)\\s*\\)`, 'gi'), `${name}[$1]`)
          : part.text).join('')
      }
      body = body.replace(/(\bFETCH\s+(\w+)\s+INTO\s+\w+\s*;\s*EXIT\s+WHEN\s+)\2%NOTFOUND\b/gi, '$1NOT FOUND')
      body = body.replace(/\bRAISE_APPLICATION_ERROR\(\s*-20\d{3}\s*,\s*([^;]+)\);/gi, "RAISE EXCEPTION '%', $1;")
      return `\nDECLARE\n${declarations.trim()}\n${body}`
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
      out = normalizeQuotedIdentifiers(out)
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

    function convertPgRowTrigger(text, options) {
      const match = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?TRIGGER\s+((?:[\w$]+\.)?[\w$]+)\s+(BEFORE|AFTER|INSTEAD\s+OF)\s+((?:INSERT|UPDATE|DELETE)(?:\s+OR\s+(?:INSERT|UPDATE|DELETE))*)\s+ON\s+((?:[\w$]+\.)?[\w$]+)\s+FOR\s+EACH\s+ROW\s+((?:DECLARE\b[\s\S]*?)?BEGIN\b[\s\S]*?)\bEND(?:[ \t]+([\w$]+))?\s*;?\s*\/?\s*(?:ALTER\s+TRIGGER\s+((?:[\w$]+\.)?[\w$]+)\s+(ENABLE|DISABLE)\s*;?\s*)?$/i.exec(text)
      if (match === null) return null
      const [, qualifiedName, timing, events, tableName, body, endName, alteredName, triggerState] = match
      const name = qualifiedName.split('.').at(-1)
      if (endName !== undefined && endName.toLowerCase() !== name.toLowerCase()) return null
      if (alteredName !== undefined && ![name.toLowerCase(), qualifiedName.toLowerCase()].includes(alteredName.toLowerCase())) return null

      const pgBody = body.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:[^']|'')*'|\bRAISE_APPLICATION_ERROR\(\s*(-20\d{3})\s*,\s*('(?:[^']|'')*')\s*\)\s*;/gi,
        (match, number, message) => number === undefined ? match : `RAISE EXCEPTION '%', ${message} USING ERRCODE = 'P${number.slice(-4)}';`)
      const parts = splitSql(pgBody)
      const code = parts.filter(part => part.kind === 'code').map(part => part.text).join(' ')
      if (/\b(?:RETURN|GOTO|FORALL|BULK\s+COLLECT|RAISE_APPLICATION_ERROR|DBMS_\w+|EXECUTE\s+IMMEDIATE)\b|\b(?:INSERTING|UPDATING|DELETING)\s*\(|\bEXCEPTION\s+WHEN\b|(?<!:):(?!:|=)(?!NEW\b|OLD\b)\w+/i.test(code)) return null

      const changes = [{ id: 'sql.triggerFunction', count: 1 }, { id: 'sql.triggerReturn', count: 1 }]
      let rowRefs = 0
      let eventChecks = 0
      const rewritten = parts.map(part => part.kind === 'code' ? part.text
        .replace(/\bSELECT\s+([\w$.]+)\.NEXTVAL\s+INTO\s+(:NEW\.[\w$]+)(?:\s+FROM\s+DUAL)?\s*;/gi,
          (_, sequence, column) => `${column} := nextval('${sequence.toLowerCase()}');`)
        .replace(/:(NEW|OLD)\s*\./gi, (_, row) => {
          rowRefs++
          return row.toUpperCase() + '.'
        })
        .replace(/\b(INSERTING|UPDATING|DELETING)\b/gi, (_, predicate) => {
          eventChecks++
          return `TG_OP = '${{ INSERTING: 'INSERT', UPDATING: 'UPDATE', DELETING: 'DELETE' }[predicate.toUpperCase()]}'`
        }) : part.text).join('').trimEnd()
      if (rowRefs) changes.push({ id: 'sql.triggerRows', count: rowRefs })
      if (eventChecks) changes.push({ id: 'sql.triggerEvents', count: eventChecks })
      if (triggerState !== undefined) changes.push({ id: 'sql.triggerState', count: 1 })

      const table = tableName.includes('.') || !qualifiedName.includes('.')
        ? tableName : qualifiedName.split('.')[0] + '.' + tableName
      const schema = table.includes('.') ? table.split('.')[0] + '.' : ''
      let hash = 0
      for (const char of name.toLowerCase()) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0
      const fn = `${schema}${name.slice(0, 42)}_${hash.toString(36)}_trg_fn`
      let delimiter = '$trigger$'
      while (body.includes(delimiter)) delimiter = delimiter.slice(0, -1) + '_$'
      const drop = options.drop === true ? `DROP TRIGGER IF EXISTS ${name} ON ${table};\n` : ''
      const disable = triggerState?.toUpperCase() === 'DISABLE' ? `ALTER TABLE ${table} DISABLE TRIGGER ${name};\n` : ''
      return {
        text: `${drop}CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS ${delimiter}
${rewritten}
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        RETURN NEW;
    ELSE
        RETURN OLD;
    END IF;
END;
${delimiter} LANGUAGE plpgsql;
CREATE TRIGGER ${name}
${timing.toUpperCase()} ${events.toUpperCase()} ON ${table}
FOR EACH ROW EXECUTE FUNCTION ${fn}();
${disable}`,
        changes,
      }
    }

    function splitOracleObjectScript(source) {
      const masked = splitSql(source).map(part => part.kind === 'code' ? part.text : part.text.replace(/[^\r\n]/g, ' ')).join('')
      const headers = [...masked.matchAll(/(?:^|(?<=[;\n]))[ \t\r\n]*CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?(?:(?:GLOBAL\s+TEMPORARY|UNIQUE|BITMAP|MATERIALIZED)\s+)?(?:TABLE|VIEW|SEQUENCE|INDEX|FUNCTION|PROCEDURE|TRIGGER|PACKAGE|TYPE|SYNONYM)\b/gi)]
      const starts = [0, ...headers.slice(1).map(match => match.index + match[0].search(/\bCREATE\b/i))]
      return starts.map((start, index) => ({ sql: source.slice(start, starts[index + 1]), start }))
    }

    function convertLocally(source, options = {}) {
      const engine = options.engine === 'mysql' || (options.engine === undefined && looksLikeMysql(source))
        ? 'mysql'
        : 'oracle'
      if (engine === 'mysql') return withDropStatement(convertMysqlLocally(source, options), options)
      const objects = splitOracleObjectScript(source)
      if (objects.length > 1) {
        const applied = new Map()
        const warnings = new Set()
        const results = objects.map(({ sql, start }) => {
          const result = convertLocally(sql, { ...options, engine })
          const offset = lineOfOffset(source, start) - 1
          for (const warning of result.warnings) warnings.add(warning)
          for (const rule of result.applied) {
            const previous = applied.get(rule.id)
            const samples = (rule.samples ?? []).map(sample => ({ ...sample, line: sample.line + offset }))
            applied.set(rule.id, {
              id: rule.id, count: (previous?.count ?? 0) + rule.count,
              samples: [...(previous?.samples ?? []), ...samples].slice(0, 6),
            })
          }
          return result.text.trim()
        })
        return { text: results.join('\n\n') + '\n', applied: [...applied.values()], warnings: [...warnings] }
      }
      const compat = options.compat !== false
      if (!compat && options.target !== 'mysql' && hasOracleAutonomousTransaction(source)) {
        throw new Error(options.autonomousMessage ?? en.pgAutonomousUnsupported)
      }
      const counts = {}
      const bucket = createSampleBucket()
      let text = splitSql(source).map((part) => {
        if (part.kind !== 'code') return part.text
        let code = part.text.replace(/(\bCREATE\s+(?:OR\s+REPLACE\s+)?)(?:NON)?EDITIONABLE\s+(?=(?:TRIGGER|FUNCTION|PROCEDURE|PACKAGE|TYPE|VIEW|SYNONYM)\b)/gi, '$1')
        if (compat) return normalizeSynonymDdl(code)
        for (const rule of LOCAL_RULES) {
          const hits = code.match(rule.pattern)
          if (hits === null) continue
          counts[rule.id] = (counts[rule.id] ?? 0) + hits.length
          code = regexReplaceSampled(code, rule.pattern, rule.replace, function (match, after, offset) {
            bucket.add(rule.id, sampleSnippet(match), sampleSnippet(after), lineOfOffset(code, offset))
          })
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
      const applied = Object.keys(counts).map((id) => {
        const entry = { id, count: counts[id] }
        const samples = bucket.listOf(id)
        if (samples !== undefined && samples.length > 0) entry.samples = samples
        return entry
      })
      if (!compat && /^\s*(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW|SELECT|WITH)\b/i.test(text)) text = rewritePgQuery(text)
      const sourceTrigger = !compat && options.target !== 'mysql' && /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:NON)?EDITIONABLE\s+)?TRIGGER\b/i.test(text)
      if (sourceTrigger) {
        const trigger = convertPgRowTrigger(normalizeQuotedIdentifiers(text), options)
        if (trigger !== null) {
          const remaining = warnings.filter(id => id !== 'trigger' && id !== 'needsAgent')
          const body = trigger.text.slice(trigger.text.indexOf('RETURNS trigger'))
          if (/\b(?:CONNECT\s+BY|PACKAGE|DBMS_\w+)\b/i.test(body)) remaining.push('needsAgent')
          return { text: trigger.text, applied: [...applied, ...trigger.changes], warnings: remaining }
        }
      }
      const cleaned = cleanOracleDdl(text)
      const targetSql = compat || options.target === 'mysql' ? cleaned : normalizePgCollectionType(normalizePgSequence(stripOracleIndexStatistics(cleaned)))
      return withDropStatement({ text: `${ensureTerminator(formatCreateTable(targetSql))}\n`, applied, warnings }, options)
    }

    /**
     * 按转换后的 CREATE 语句识别对象，生成可选的 DROP ... IF EXISTS 前缀。
     * 覆盖表/视图/物化视图/函数/过程/触发器/包/序列/类型/同义词/索引，
     * 并兼容 CREATE DEFINER=... / TEMPORARY / UNLOGGED 这类前缀。
     */
    /** 对象名（可带 schema 前缀 / 引号 / 反引号）。 */
    const DROP_NAME = '(?:"[^"]+"|`[^`]+`|[A-Za-z_][\\w$]*)(?:\\s*\\.\\s*(?:"[^"]+"|`[^`]+`|[A-Za-z_][\\w$]*))?'
    const DROP_CREATE = new RegExp(
      '\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:DEFINER\\s*=\\s*\\S+\\s+)?(?:TEMPORARY\\s+|TEMP\\s+|UNLOGGED\\s+)?'
      + '(TABLE|VIEW|MATERIALIZED\\s+VIEW|FUNCTION|PROCEDURE|TRIGGER|PACKAGE(?:\\s+BODY)?|SEQUENCE|TYPE|DOMAIN|SYNONYM|(?:UNIQUE\\s+)?INDEX)'
      + '\\s+(' + DROP_NAME + ')',
      'i',
    )
    const DROP_ON = new RegExp('\\bON\\s+(' + DROP_NAME + ')\\s+(?:FOR|EXECUTE|WHEN|BEGIN|REFERENCING|INSTEAD)', 'i')

    /**
     * 从 CREATE FUNCTION/PROCEDURE 的参数表里取出 DROP 需要的输入参数类型。
     * 目标库可能有同名重载（例如兼容模式建过 (number)、PG 模式建过 (numeric)），
     * 不带参数的 DROP FUNCTION 会报 42725 not unique，因此按输入参数类型精确匹配：
     * 去掉 IN/INOUT 模式、参数名、DEFAULT 默认值与 NUMBER(12,2) 这类类型修饰，
     * 排除纯 OUT 参数（不属于函数标识）。类型无法静态确定（%TYPE、变量引用）时返回 null，
     * 调用方退回不带参数的旧写法。
     */
    function dropSignatureOf(text) {
      const head = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+[\w$."]+\s*\(/i.exec(String(text ?? ''))
      if (head === null) return null
      const body = String(text)
      const open = head.index + head[0].length - 1
      let depth = 0
      let close = -1
      let single = false
      let quoted = false
      for (let index = open; index < body.length; index += 1) {
        const char = body[index]
        if (single) {
          if (char === "'") {
            if (body[index + 1] === "'") index += 1
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
      if (close < 0) return null
      const types = []
      for (const item of splitTopLevel(body.slice(open + 1, close))) {
        let rest = item.replace(/\s+/g, ' ').trim()
        if (rest === '') continue
        rest = rest.replace(/\s+(?:DEFAULT|:=)\s+[\s\S]*$/i, '').trim()
        if (rest === '') return null
        const tokens = rest.split(' ')
        let typeText = rest
        if (tokens.length > 1) {
          if (/^(?:IN|OUT|INOUT|VARIADIC)$/i.test(tokens[0])) {
            // 无参数名、直接以模式开头：IN NUMBER / OUT NUMBER
            typeText = rest
          } else {
            const remaining = rest.slice(tokens[0].length).trim()
            // 无参数名的多词类型（DOUBLE PRECISION 等）不要把首词当参数名
            typeText = /^(?:PRECISION|VARYING|WITH\s+TIME\s+ZONE|WITHOUT\s+TIME\s+ZONE)$/i.test(remaining)
              ? rest
              : remaining
          }
        }
        const mode = /^(IN\s+OUT|INOUT|IN|OUT|VARIADIC)\b/i.exec(typeText)
        const modeText = mode === null ? '' : mode[1].toUpperCase().replace(/\s+/g, ' ')
        if (mode !== null) typeText = typeText.slice(mode[0].length).trim()
        typeText = typeText.replace(/^NOCOPY\b/i, '').trim()
        if (typeText === '') return null
        const base = typeText.replace(/\([^()]*\)\s*$/, '').trim()
        // %TYPE / 变量引用、括号外的杂字符（默认值里带逗号的表达式被切开）都无法确定类型
        if (!/^(?:"[^"]+"|[A-Za-z_])[\w$." ]*$/.test(base)) return null
        if (modeText === 'OUT') continue
        types.push(base)
      }
      return types
    }

    /**
     * 按转换后的 CREATE 语句识别对象，生成可选的 DROP ... IF EXISTS 前缀。
     * 覆盖表 / 视图 / 物化视图 / 函数 / 过程 / 触发器 / 包 / 序列 / 类型 / 同义词 / 索引，
     * 兼容 CREATE DEFINER=... / TEMPORARY / UNLOGGED 这类前缀。
     */
    function dropStatementFor(text, options) {
      const opts = options !== undefined && options !== null ? options : {}
      const target = opts.target === 'mysql' ? 'mysql' : 'pg'
      const compat = opts.compat === true
      const match = DROP_CREATE.exec(String(text ?? ''))
      if (match === null) return ''
      let kind = match[1].toUpperCase().replace(/\s+/g, ' ')
      const name = match[2].replace(/\s+/g, '')
      if (kind === 'PACKAGE BODY') kind = 'PACKAGE'
      if (kind === 'UNIQUE INDEX') kind = 'INDEX'
      // MySQL 协议目标不支持 DROP TRIGGER（实测报错），这类目标上不生成
      if (kind === 'TRIGGER' && target === 'mysql') return ''
      // 包 / 同义词只有 Oracle 兼容形态才有对应语法
      if ((kind === 'PACKAGE' || kind === 'SYNONYM') && target === 'pg' && !compat) return ''
      const cascade = opts.cascade === true && target !== 'mysql' ? ' CASCADE' : ''
      if (kind === 'TRIGGER') {
        const onMatch = DROP_ON.exec(String(text ?? ''))
        if (onMatch === null) return ''
        // PG 原生要求 DROP TRIGGER ... ON <表>
        return `DROP TRIGGER IF EXISTS ${name} ON ${onMatch[1].replace(/\s+/g, '')};\n`
      }
      // INDEX 没有 IF EXISTS 之外的依赖问题，也不需要 CASCADE
      const tail = kind === 'INDEX' ? '' : cascade
      // 函数/过程带参数签名，避免目标库存在同名重载时 42725 not unique；
      // MySQL 协议的 DROP FUNCTION 不接受参数列表，保持不带参数
      const signature = (kind === 'FUNCTION' || kind === 'PROCEDURE') && target !== 'mysql'
        ? dropSignatureOf(text)
        : null
      const args = signature === null ? '' : `(${signature.join(', ')})`
      return `DROP ${kind} IF EXISTS ${name}${args}${tail};\n`
    }

    /** 转换结果开头的 DROP 语句（可能有多条）。 */
    const DROP_LEAD = /^\s*DROP\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|PROCEDURE|TRIGGER|PACKAGE|SEQUENCE|TYPE|DOMAIN|SYNONYM|INDEX)\s+IF\s+EXISTS\b[^;]*;\s*/i

    function dropPreambleOf(sql) {
      const text = String(sql ?? '')
      const drops = []
      let rest = text
      let match = DROP_LEAD.exec(rest)
      while (match !== null) {
        drops.push(match[0].trim())
        rest = rest.slice(match[0].length)
        match = DROP_LEAD.exec(rest)
      }
      return { drops, rest }
    }

    /** 去掉开头 DROP 前缀，供「先批量删、再批量建」的第二阶段使用。 */
    function stripDropPreamble(sql) {
      return dropPreambleOf(sql).rest
    }

    /**
     * AI 结果兜底：把 CREATE FUNCTION/PROCEDURE 前面的 DROP 改成带参数签名的形式。
     * 已有 DROP 就地改写，没有就在最前面补一条；表 / 视图 / 触发器 / 包等其它对象不动，
     * 与本地转换的 dropStatementFor 输出保持一致。
     */
    function regenerateRoutineDrop(sql, options) {
      if (options === undefined || options === null || options.drop !== true) return sql
      // MySQL 协议的 DROP FUNCTION 不带参数列表，交给模型/本地规则原样处理
      if (options.target === 'mysql') return sql
      const head = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\s+([\w$."]+)/i.exec(sql)
      if (head === null) return sql
      const signature = dropSignatureOf(sql)
      if (signature === null) return sql
      const kind = head[1].toUpperCase()
      const statement = `DROP ${kind} IF EXISTS ${head[2].replace(/\s+/g, '')}(${signature.join(', ')});`
      const existing = new RegExp('\\bDROP\\s+' + kind + '\\s+IF\\s+EXISTS\\b[^;]*;', 'i')
      if (existing.test(sql)) return sql.replace(existing, statement)
      return `${statement}\n${sql}`
    }

    /**
     * 按依赖关系排出执行顺序：被依赖的对象在前。
     * depsOf(file) 返回该对象依赖的对象名数组（来自源库依赖列表或静态识别）。
     * 无依赖信息的对象保持原有顺序。
     */
    function planDependencyOrder(files, depsOf) {
      const list = Array.isArray(files) ? files.filter(file => file !== null && typeof file === 'object') : []
      const nameOf = (file) => String(file.name ?? '').replace(/\.sql$/i, '').trim().toLowerCase()
      const byName = new Map()
      for (const file of list) byName.set(nameOf(file), file)
      const index = new Map(list.map((file, position) => [file.id, position]))
      const dependsOn = new Map()
      for (const file of list) {
        const deps = typeof depsOf === 'function' ? depsOf(file) : []
        const names = new Set()
        for (const dep of Array.isArray(deps) ? deps : []) {
          const key = String(dep ?? '').replace(/\.sql$/i, '').trim().toLowerCase()
          if (key === '' || key === nameOf(file)) continue
          if (byName.has(key)) names.add(key)
        }
        dependsOn.set(nameOf(file), names)
      }
      const ordered = []
      const placed = new Set()
      const visiting = new Set()
      const visit = (name) => {
        if (placed.has(name) || visiting.has(name)) return
        visiting.add(name)
        for (const dep of dependsOn.get(name) ?? []) visit(dep)
        visiting.delete(name)
        placed.add(name)
        const file = byName.get(name)
        if (file !== undefined) ordered.push(file)
      }
      for (const file of list) visit(nameOf(file))
      // 兜底：极端情况下（重名等）漏掉的对象按原顺序补上
      for (const file of list) {
        if (!ordered.includes(file)) ordered.push(file)
      }
      return ordered
    }

    /** 开启「生成删除语句」时，在转换结果前加 DROP ... IF EXISTS。 */
    function withDropStatement(result, options) {
      if (options.drop !== true || result === null || typeof result.text !== 'string') return result
      const drop = dropStatementFor(result.text, options)
      if (drop === '') {
        // 触发器在 MySQL 兼容目标上不支持 DROP TRIGGER，明确提示而不是静默跳过
        if (options.target === 'mysql' && /\bCREATE\s+(?:DEFINER\s*=\s*\S+\s+)?TRIGGER\b/i.test(result.text)) {
          const warnings = Array.isArray(result.warnings) ? result.warnings : []
          if (!warnings.includes('dropTriggerUnsupported')) {
            return { ...result, warnings: [...warnings, 'dropTriggerUnsupported'] }
          }
        }
        return result
      }
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

    /**
     * 规则目录：把内部规则 id 翻译成“改了什么”。
     * cat：type / function / syntax / plsql / object / risk；risk 级别用 level 标注。
     */
    const RULE_CATALOG = {
      // Oracle 类型
      'types.varchar': { cat: 'type', label: 'VARCHAR2 → VARCHAR' },
      'types.number': { cat: 'type', label: 'NUMBER → NUMERIC' },
      'types.integer': { cat: 'type', label: 'BINARY_INTEGER / PLS_INTEGER → INTEGER' },
      'types.lob': { cat: 'type', label: 'CLOB / BLOB → TEXT / BYTEA' },
      'types.raw': { cat: 'type', label: 'RAW → BYTEA' },
      'types.date': { cat: 'type', label: 'DATE → TIMESTAMP' },
      'types.refCursor': { cat: 'type', label: 'SYS_REFCURSOR → refcursor' },
      // Oracle 函数与表达式
      'fn.nvl': { cat: 'function', label: 'NVL → COALESCE' },
      'fn.sysdate': { cat: 'function', label: 'SYSDATE / SYSTIMESTAMP → CURRENT_TIMESTAMP' },
      'fn.sysGuid': { cat: 'function', label: 'SYS_GUID → gen_random_uuid' },
      'fn.sysContext': { cat: 'function', label: 'SYS_CONTEXT → current_setting' },
      'fn.currentUser': { cat: 'function', label: 'USER → CURRENT_USER' },
      'fn.raise': { cat: 'function', label: 'RAISE_APPLICATION_ERROR → RAISE EXCEPTION' },
      'fn.xmlElement': { cat: 'function', label: 'XMLELEMENT → xmlelement' },
      'fn.getClobVal': { cat: 'function', label: '.getClobVal() → ::text' },
      // Oracle SQL 语法 / DDL
      'sql.dual': { cat: 'syntax', label: 'FROM DUAL → 去掉' },
      'sql.minus': { cat: 'syntax', label: 'MINUS → EXCEPT' },
      'sql.explain': { cat: 'syntax', label: 'EXPLAIN PLAN FOR → EXPLAIN' },
      'sql.triggerFunction': { cat: 'syntax', label: '行级触发器 → 触发函数与 CREATE TRIGGER' },
      'sql.triggerReturn': { cat: 'syntax', label: '按 TG_OP 返回 NEW 或 OLD' },
      'sql.triggerRows': { cat: 'syntax', label: ':NEW / :OLD → NEW / OLD' },
      'sql.triggerEvents': { cat: 'syntax', label: 'INSERTING / UPDATING / DELETING → TG_OP' },
      'sql.triggerState': { cat: 'syntax', label: '保留触发器启用或禁用状态' },
      'sql.analyzeTable': { cat: 'syntax', label: 'ANALYZE TABLE ... COMPUTE STATISTICS → ANALYZE' },
      'ddl.synonym': { cat: 'syntax', label: 'CREATE OR REPLACE SYNONYM → CREATE SYNONYM' },
      'ddl.forceView': { cat: 'syntax', label: 'FORCE VIEW → 普通 VIEW' },
      // Oracle PL/SQL
      'plsql.executeImmediate': { cat: 'plsql', label: 'EXECUTE IMMEDIATE → EXECUTE' },
      'plsql.noCopy': { cat: 'plsql', label: 'NOCOPY → 去掉' },
      'plsql.authid': { cat: 'plsql', label: 'AUTHID → 去掉' },
      'plsql.resultCache': { cat: 'plsql', label: 'RESULT_CACHE → 去掉' },
      'plsql.deterministic': { cat: 'plsql', label: 'DETERMINISTIC → IMMUTABLE' },
      // MySQL 函数与语法
      'fn.ifnull': { cat: 'function', label: 'IFNULL → COALESCE' },
      'fn.now': { cat: 'function', label: 'NOW() / LOCALTIME → CURRENT_TIMESTAMP' },
      'fn.curdate': { cat: 'function', label: 'CURDATE() → CURRENT_DATE' },
      'fn.curtime': { cat: 'function', label: 'CURTIME() → CURRENT_TIME' },
      'sql.limitOffset': { cat: 'syntax', label: 'LIMIT m,n → LIMIT n OFFSET m' },
      // MySQL 兼容目标（最小改写）
      'mysql.setType': { cat: 'type', label: "SET('a','b') → VARCHAR(255)", level: 'warn' },
      'mysql.spatial': { cat: 'type', label: '空间类型 → BYTEA', level: 'warn' },
      'mysql.spatialIndex': { cat: 'syntax', label: 'SPATIAL KEY → 删除', level: 'warn' },
      'mysql.partition': { cat: 'syntax', label: 'PARTITION BY → 删除分区子句', level: 'warn' },
      'mysql.viewOptions': { cat: 'syntax', label: '视图 ALGORITHM / SQL SECURITY → 去掉', level: 'warn' },
      'mysql.collation0900': { cat: 'type', label: 'utf8mb4_0900_* → utf8mb4_unicode_ci' },
      'mysql.jsonExtract': { cat: 'function', label: "JSON_EXTRACT → ->> / #>>", level: 'warn' },
      'mysql.foundRows': { cat: 'function', label: 'FOUND_ROWS() → 需改写', level: 'high' },
      'mysql.dropTrigger': { cat: 'syntax', label: 'DROP TRIGGER → DROP FUNCTION ... CASCADE' },
      'mysql.simpleFunction': { cat: 'plsql', label: '单语句 RETURN 函数原样保留' },
      'mysql.routine': { cat: 'plsql', label: '例程 → plmysql / PL-pgSQL 外壳' },
      // Oracle 风险项
      bulk: { cat: 'risk', label: 'BULK COLLECT / FORALL', level: 'mid' },
      commit: { cat: 'risk', label: '事务内 COMMIT', level: 'mid' },
      connectBy: { cat: 'risk', label: 'CONNECT BY 层次查询', level: 'mid' },
      databaseLink: { cat: 'risk', label: 'DATABASE LINK', level: 'high' },
      decode: { cat: 'risk', label: 'DECODE', level: 'low' },
      defaultOnNull: { cat: 'risk', label: 'DEFAULT ON NULL', level: 'high' },
      bitmap: { cat: 'risk', label: 'BITMAP INDEX', level: 'mid' },
      insertAll: { cat: 'risk', label: 'INSERT ALL / FIRST', level: 'mid' },
      job: { cat: 'risk', label: 'DBMS_SCHEDULER / DBMS_JOB', level: 'high' },
      jsonValue: { cat: 'risk', label: 'JSON_VALUE / JSON_QUERY', level: 'mid' },
      keep: { cat: 'risk', label: 'KEEP (DENSE_RANK)', level: 'mid' },
      listagg: { cat: 'risk', label: 'LISTAGG', level: 'low' },
      merge: { cat: 'risk', label: 'MERGE', level: 'low' },
      mvRefresh: { cat: 'risk', label: 'MATERIALIZED VIEW REFRESH', level: 'high' },
      needsAgent: { cat: 'risk', label: '需要智能体改写', level: 'high' },
      nvl2: { cat: 'risk', label: 'NVL2', level: 'low' },
      outerJoin: { cat: 'risk', label: '(+) 外连接', level: 'mid' },
      package: { cat: 'risk', label: 'PACKAGE / PACKAGE BODY', level: 'high' },
      pipelined: { cat: 'risk', label: 'PIPELINED 函数', level: 'mid' },
      pivot: { cat: 'risk', label: 'PIVOT', level: 'high' },
      rowid: { cat: 'risk', label: 'ROWID', level: 'mid' },
      rownum: { cat: 'risk', label: 'ROWNUM', level: 'mid' },
      sample: { cat: 'risk', label: 'SAMPLE', level: 'high' },
      sequence: { cat: 'risk', label: 'SEQUENCE', level: 'low' },
      trigger: { cat: 'risk', label: '触发器', level: 'mid' },
      dropTriggerUnsupported: { cat: 'risk', label: 'MySQL 兼容目标不支持 DROP TRIGGER，已跳过删除语句', level: 'mid' },
      unpivot: { cat: 'risk', label: 'UNPIVOT', level: 'high' },
      withFunction: { cat: 'risk', label: 'WITH FUNCTION', level: 'high' },
      wmConcat: { cat: 'risk', label: 'WM_CONCAT', level: 'mid' },
      xmlAgg: { cat: 'risk', label: 'XMLAGG', level: 'mid' },
      xmlTable: { cat: 'risk', label: 'XMLTABLE', level: 'high' },
      xmlType: { cat: 'risk', label: 'XMLTYPE', level: 'high' },
      autonomous: { cat: 'risk', label: 'PRAGMA AUTONOMOUS_TRANSACTION', level: 'mid' },
      // MySQL 风险项
      unsigned: { cat: 'risk', label: 'UNSIGNED 无符号类型', level: 'low' },
      onUpdate: { cat: 'risk', label: 'ON UPDATE CURRENT_TIMESTAMP', level: 'mid' },
      enum: { cat: 'risk', label: 'ENUM 枚举', level: 'mid' },
      set: { cat: 'risk', label: 'SET 集合', level: 'mid' },
      fulltext: { cat: 'risk', label: 'FULLTEXT / SPATIAL 索引', level: 'mid' },
      partition: { cat: 'risk', label: '分区表', level: 'mid' },
      prefixIndex: { cat: 'risk', label: '前缀索引', level: 'low' },
      zeroDate: { cat: 'risk', label: "'0000-00-00' 零日期", level: 'mid' },
      routine: { cat: 'risk', label: '存储过程 / 函数', level: 'mid' },
      event: { cat: 'risk', label: 'EVENT 定时事件', level: 'high' },
      groupConcat: { cat: 'risk', label: 'GROUP_CONCAT', level: 'low' },
      dateFormat: { cat: 'risk', label: 'DATE_FORMAT', level: 'low' },
      strToDate: { cat: 'risk', label: 'STR_TO_DATE', level: 'low' },
      onDuplicate: { cat: 'risk', label: 'ON DUPLICATE KEY', level: 'low' },
      insertIgnore: { cat: 'risk', label: 'INSERT IGNORE', level: 'low' },
      replaceInto: { cat: 'risk', label: 'REPLACE INTO', level: 'mid' },
      regexp: { cat: 'risk', label: 'REGEXP', level: 'low' },
      div: { cat: 'risk', label: 'DIV 整除', level: 'low' },
      userVariable: { cat: 'risk', label: '@用户变量', level: 'mid' },
      backslashEscape: { cat: 'risk', label: '反斜杠转义字符串', level: 'low' },
      delimiter: { cat: 'risk', label: 'DELIMITER 指令', level: 'low' },
      useDatabase: { cat: 'risk', label: 'USE 切换库', level: 'low' },
      session: { cat: 'risk', label: '会话级 SET / LOCK TABLES', level: 'mid' },
      createSchema: { cat: 'risk', label: 'CREATE DATABASE / SCHEMA', level: 'low' },
      unknownType: { cat: 'risk', label: '未知类型', level: 'high' },
      routineHandler: { cat: 'risk', label: '异常处理器 → EXIT WHEN NOT FOUND', level: 'mid' },
      routineControl: { cat: 'risk', label: 'LEAVE / ITERATE 循环控制', level: 'mid' },
      routineDateFormat: { cat: 'risk', label: '例程内 DATE_FORMAT', level: 'mid' },
      routineUserVar: { cat: 'risk', label: '例程内 @变量', level: 'mid' },
      routineParam: { cat: 'risk', label: '例程参数模式', level: 'low' },
    }

    /** 逐处替换并按需采样“改前 → 改后”，供「规则」页签展示示例。 */
    function regexReplaceSampled(text, pattern, replacement, onHit) {
      return text.replace(pattern, function (match) {
        const args = Array.prototype.slice.call(arguments)
        const offset = typeof args[args.length - 2] === 'number' ? args[args.length - 2] : 0
        let after
        if (typeof replacement === 'function') after = replacement.apply(null, args)
        else if (typeof replacement === 'string') {
          const single = new RegExp(pattern.source, pattern.flags.replace(/g/g, ''))
          after = match.replace(single, replacement)
        } else after = match
        if (typeof onHit === 'function') {
          try {
            onHit(match, after, offset, args)
          } catch {
            /* 采样失败不影响转换 */
          }
        }
        return after
      })
    }

    /** 偏移量换算成行号（1 起）。 */
    function lineOfOffset(text, offset) {
      if (!Number.isFinite(offset) || offset <= 0) return 1
      const limit = Math.min(offset, String(text).length)
      let line = 1
      for (let index = 0; index < limit; index += 1) {
        if (String(text)[index] === '\n') line += 1
      }
      return line
    }

    /** 示例片段压缩成一行并限长。 */
    function sampleSnippet(value) {
      const one = String(value ?? '').replace(/\s+/g, ' ').trim()
      return one.length > 64 ? `${one.slice(0, 64)}…` : one
    }

    /** 采样桶：每规则最多 2 条，整体最多 60 条。 */
    function createSampleBucket() {
      const samples = new Map()
      return {
        add(id, before, after, line) {
          if (samples.size >= 60 && !samples.has(id)) return
          const list = samples.get(id) ?? []
          if (list.length >= 2) return
          list.push({ line, before, after })
          samples.set(id, list)
        },
        listOf(id) {
          return samples.get(id)
        },
      }
    }

    /** 去掉注释与字符串字面量，避免把注释里的表名当成依赖。 */
    function stripSqlNoise(text) {
      let out = String(text ?? '')
      out = out.replace(/\/\*[\s\S]*?\*\//g, ' ')
      out = out.replace(/--[^\n]*/g, ' ')
      out = out.replace(/'(?:[^']|'')*'/g, "''")
      out = out.replace(/`(?:[^`]|``)*`/g, (whole) => whole)
      return out
    }

    /** 规范化标识符：去掉引号/反引号，取最后一段（schema 前缀去掉），统一小写。 */
    function dependencyIdent(raw) {
      return String(raw ?? '')
        .replace(/["`]/g, '')
        .split('.')
        .map(part => part.trim())
        .filter(Boolean)
        .pop()
        ?.toLowerCase() ?? ''
    }

    /**
     * 从源 SQL 里识别依赖对象：
     * 1) 关键字后面（FROM / JOIN / INTO / UPDATE / REFERENCES / CALL ...）出现的表、视图、例程名；
     * 2) 与任务内其它对象重名的标识符（避免漏掉 SELECT 里直接调用的函数）。
     * 只做静态识别，不连库。
     */
    /** 明显不是对象名的标识符（关键字、伪表、函数、系统 schema）。 */
    const DEPENDENCY_STOPWORDS = new Set((
      'dual current_timestamp current_date current_time localtimestamp localtime now sysdate systimestamp '
      + 'sysdatetime getdate new old inserted deleted values select set only lateral unnest generate_series '
      + 'mysql information_schema performance_schema pg_catalog sys public json_table openjson '
      + 'if exists view index trigger procedure function package type sequence synonym'
    ).split(/\s+/).filter(Boolean))

    /**
     * 从源 SQL 里识别依赖对象：
     * 1) 明确的引用位置（FROM / JOIN / REFERENCES / INSERT INTO / MERGE INTO / TABLE / CALL / TRUNCATE / 语句级 UPDATE）；
     * 2) 与任务内已有对象同名的标识符（覆盖 SELECT 里直接调用的函数）。
     * 只做静态识别，不连库。
     */
    function dependencyRefsOf(sql, knownNames) {
      const text = stripSqlNoise(sql)
      const hits = new Map()
      const push = (raw) => {
        const name = dependencyIdent(raw)
        if (name === '' || name.length < 2) return
        if (DEPENDENCY_STOPWORDS.has(name)) return
        if (!hits.has(name)) hits.set(name, { name, keyword: true })
      }
      const ident = '(?:"[^"]+"|`[^`]+`|[A-Za-z_][\\w$]*)(?:\\s*\\.\\s*(?:"[^"]+"|`[^`]+`|[A-Za-z_][\\w$]*))?'
      const patterns = [
        // FROM / JOIN（含 LEFT JOIN 等写法）/ REFERENCES
        new RegExp('\\b(?:FROM|JOIN|REFERENCES)\\s+(' + ident + ')', 'gi'),
        // INSERT INTO / REPLACE INTO / MERGE INTO
        new RegExp('\\b(?:INSERT|REPLACE|MERGE)\\s+(?:IGNORE\\s+)?INTO\\s+(' + ident + ')', 'gi'),
        // CREATE [TEMPORARY] TABLE / DROP TABLE / TRUNCATE TABLE
        new RegExp('\\bTABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+|IF\\s+EXISTS\\s+)?(' + ident + ')', 'gi'),
        new RegExp('\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?TRIGGER\\s+' + ident
          + '\\s+(?:BEFORE|AFTER|INSTEAD\\s+OF)\\s+(?:INSERT|UPDATE|DELETE)(?:\\s+OR\\s+(?:INSERT|UPDATE|DELETE))*\\s+ON\\s+(' + ident + ')', 'gi'),
        // CALL proc(...)
        new RegExp('\\bCALL\\s+(' + ident + ')', 'gi'),
        new RegExp('\\bCREATE\\s+DOMAIN\\s+' + ident + '\\s+AS\\s+(' + ident + ')', 'gi'),
        new RegExp('\\bRETURNS\\s+SETOF\\s+(' + ident + ')', 'gi'),
        // 语句开头的 UPDATE t SET ...（避免把 ON UPDATE CURRENT_TIMESTAMP 当表名）
        new RegExp('(?:^|;)\\s*UPDATE\\s+(' + ident + ')', 'gi'),
      ]
      for (const pattern of patterns) {
        let match = pattern.exec(text)
        while (match !== null) {
          push(match[1])
          match = pattern.exec(text)
        }
      }
      if (knownNames !== undefined && knownNames.size > 0) {
        const identPattern = new RegExp(ident, 'g')
        let match = identPattern.exec(text)
        while (match !== null) {
          const name = dependencyIdent(match[0])
          if (knownNames.has(name) && !hits.has(name)) hits.set(name, { name, keyword: false })
          match = identPattern.exec(text)
        }
      }
      return [...hits.values()]
    }

    /** 行级 diff：先裁掉公共前后缀，再对中间做 LCS，避免大文件爆内存。 */
    function diffLines(before, after) {
      const a = String(before ?? '').split('\n')
      const b = String(after ?? '').split('\n')
      let start = 0
      while (start < a.length && start < b.length && a[start] === b[start]) start += 1
      let endA = a.length - 1
      let endB = b.length - 1
      while (endA >= start && endB >= start && a[endA] === b[endB]) {
        endA -= 1
        endB -= 1
      }
      const rows = []
      for (let index = 0; index < start; index += 1) {
        rows.push({ type: 'same', oldNo: index + 1, newNo: index + 1, text: a[index] })
      }
      const midA = a.slice(start, endA + 1)
      const midB = b.slice(start, endB + 1)
      let added = 0
      let removed = 0
      const pushDel = (index) => {
        rows.push({ type: 'del', oldNo: start + index + 1, newNo: null, text: midA[index] })
        removed += 1
      }
      const pushAdd = (index) => {
        rows.push({ type: 'add', oldNo: null, newNo: start + index + 1, text: midB[index] })
        added += 1
      }
      const n = midA.length
      const m = midB.length
      if (n > 0 && m > 0 && n * m <= 4000000) {
        const width = m + 1
        const table = new Int32Array((n + 1) * width)
        for (let i = n - 1; i >= 0; i -= 1) {
          for (let j = m - 1; j >= 0; j -= 1) {
            table[i * width + j] = midA[i] === midB[j]
              ? table[(i + 1) * width + j + 1] + 1
              : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
          }
        }
        let i = 0
        let j = 0
        while (i < n && j < m) {
          if (midA[i] === midB[j]) {
            rows.push({ type: 'same', oldNo: start + i + 1, newNo: start + j + 1, text: midA[i] })
            i += 1
            j += 1
          } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
            pushDel(i)
            i += 1
          } else {
            pushAdd(j)
            j += 1
          }
        }
        while (i < n) {
          pushDel(i)
          i += 1
        }
        while (j < m) {
          pushAdd(j)
          j += 1
        }
      } else {
        for (let i = 0; i < n; i += 1) pushDel(i)
        for (let j = 0; j < m; j += 1) pushAdd(j)
      }
      for (let index = endA + 1; index < a.length; index += 1) {
        const offset = index - (endA + 1)
        rows.push({ type: 'same', oldNo: index + 1, newNo: endB + 2 + offset, text: a[index] })
      }
      return { rows, added, removed }
    }

    /** 词级 token 切分：保留空白，便于逐词比较。 */
    function diffTokens(text) {
      return String(text ?? '').split(/(\s+)/).filter(part => part !== '')
    }

    /** 行内差异：把改动的词标出来；行数过多时退化为整行。 */
    function inlineDiff(beforeText, afterText) {
      const a = diffTokens(beforeText)
      const b = diffTokens(afterText)
      if (a.length === 0 || b.length === 0 || a.length * b.length > 40000) {
        return {
          before: [{ type: 'del', text: beforeText }],
          after: [{ type: 'add', text: afterText }],
        }
      }
      const width = b.length + 1
      const table = new Int32Array((a.length + 1) * width)
      for (let i = a.length - 1; i >= 0; i -= 1) {
        for (let j = b.length - 1; j >= 0; j -= 1) {
          table[i * width + j] = a[i] === b[j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
        }
      }
      const before = []
      const after = []
      const push = (list, type, text) => {
        const last = list[list.length - 1]
        if (last !== undefined && last.type === type) last.text += text
        else list.push({ type, text })
      }
      let i = 0
      let j = 0
      while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
          push(before, 'same', a[i])
          push(after, 'same', b[j])
          i += 1
          j += 1
        } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
          push(before, 'del', a[i])
          i += 1
        } else {
          push(after, 'add', b[j])
          j += 1
        }
      }
      while (i < a.length) {
        push(before, 'del', a[i])
        i += 1
      }
      while (j < b.length) {
        push(after, 'add', b[j])
        j += 1
      }
      return { before, after }
    }

    /* ===== 界面语言 ===== */

    const LANG_KEY = 'hgdb-convert-studio.lang.v1'

    function readLang() {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return 'zh'
        const value = window.localStorage.getItem(LANG_KEY)
        return value === 'en' ? 'en' : 'zh'
      } catch {
        return 'zh'
      }
    }

    function saveLang(value) {
      try {
        if (typeof window === 'undefined' || !window.localStorage) return
        window.localStorage.setItem(LANG_KEY, value === 'en' ? 'en' : 'zh')
      } catch {
        /* best effort */
      }
    }

    /** 简单的 {name} 占位替换。 */
    function formatTemplate(template, params) {
      const text = typeof template === 'string' ? template : String(template ?? '')
      if (params === undefined || params === null) return text
      return text.replace(/\{(\w+)\}/g, (whole, key) => (
        Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : whole
      ))
    }

    /** 组合出当前语言的翻译函数：先查本地字典，再退回宿主提供的 t。 */
    function makeTranslator(lang, hostT) {
      return (key, params) => {
        const text = dictText(lang, key)
        if (text !== null) return formatTemplate(text, params)
        return typeof hostT === 'function' ? hostT(key, params) : key
      }
    }

    /** 按语言取文案；找不到时返回 null，交给调用方兜底。 */
    function dictText(lang, key) {
      const dict = lang === 'en' ? en : zh
      const value = dict[key]
      return typeof value === 'string' ? value : null
    }

    /** 规则标签的英文版本：只包含含中文的条目，其余标签本身就是英文/符号。 */
    const RULE_LABELS_EN = {
      'sql.dual': 'FROM DUAL -> removed',
      'ddl.forceView': 'FORCE VIEW -> plain VIEW',
      'plsql.noCopy': 'NOCOPY -> removed',
      'plsql.authid': 'AUTHID -> removed',
      'plsql.resultCache': 'RESULT_CACHE -> removed',
      'mysql.spatial': 'Spatial types -> BYTEA',
      'mysql.spatialIndex': 'SPATIAL KEY -> dropped',
      'mysql.partition': 'PARTITION BY -> partition clause dropped',
      'mysql.viewOptions': 'View ALGORITHM / SQL SECURITY -> removed',
      'mysql.foundRows': 'FOUND_ROWS() -> needs rewrite',
      'mysql.simpleFunction': 'Single-statement RETURN function kept as is',
      'mysql.routine': 'Routine -> plmysql / PL-pgSQL shell',
      'commit': 'COMMIT inside transaction',
      'connectBy': 'CONNECT BY hierarchical query',
      'sql.triggerFunction': 'Row trigger → trigger function and CREATE TRIGGER',
      'sql.triggerReturn': 'Return NEW or OLD based on TG_OP',
      'sql.triggerRows': ':NEW / :OLD → NEW / OLD',
      'sql.triggerEvents': 'INSERTING / UPDATING / DELETING → TG_OP',
      'sql.triggerState': 'Preserve enabled or disabled trigger state',
      'needsAgent': 'Needs agent rewrite',
      'outerJoin': '(+) outer join',
      'pipelined': 'PIPELINED function',
      'trigger': 'Trigger',
      'dropTriggerUnsupported': 'MySQL-compatible target has no DROP TRIGGER; drop skipped',
      'unsigned': 'UNSIGNED type',
      'enum': 'ENUM column',
      'set': 'SET column',
      'fulltext': 'FULLTEXT / SPATIAL index',
      'partition': 'Partitioned table',
      'prefixIndex': 'Prefix index',
      'routine': 'Stored procedure / function',
      'event': 'EVENT scheduler job',
      'div': 'DIV integer division',
      'userVariable': '@user variable',
      'backslashEscape': 'Backslash-escaped string',
      'delimiter': 'DELIMITER directive',
      'useDatabase': 'USE database switch',
      'session': 'Session-level SET / LOCK TABLES',
      'unknownType': 'Unknown type',
      'routineHandler': 'Exception handler -> EXIT WHEN NOT FOUND',
      'routineControl': 'LEAVE / ITERATE loop control',
      'routineDateFormat': 'DATE_FORMAT inside routine',
      'routineUserVar': '@variable inside routine',
      'routineParam': 'Routine parameter mode',
    }

    const RULE_CATEGORY_ORDER = ['type', 'function', 'syntax', 'plsql', 'object', 'risk']
    const RULE_CATEGORY_KEYS = {
      type: 'ruleCatType',
      function: 'ruleCatFunction',
      syntax: 'ruleCatSyntax',
      plsql: 'ruleCatPlsql',
      object: 'ruleCatObject',
      risk: 'ruleCatRisk',
    }

    /** 查规则目录；未知 id 原样显示，避免丢信息。 */
    function ruleInfo(id, lang) {
      const entry = RULE_CATALOG[id]
      if (entry === undefined) {
        return { id, cat: id.startsWith('mysql.') ? 'syntax' : 'risk', label: id, level: 'mid' }
      }
      const label = lang === 'en' ? (RULE_LABELS_EN[id] ?? entry.label) : entry.label
      return { id, cat: entry.cat, label, level: entry.level ?? 'low' }
    }

    /** 把 applied / warnings 汇总成按类别分组、可渲染的规则清单。 */
    function groupRules(applied, warnings, lang) {
      const groups = new Map()
      const push = (info, count, samples) => {
        if (!groups.has(info.cat)) groups.set(info.cat, new Map())
        const bucket = groups.get(info.cat)
        const existing = bucket.get(info.id)
        if (existing === undefined) bucket.set(info.id, { ...info, count, samples: samples ?? [] })
        else {
          existing.count += count
          if (samples !== undefined && samples.length > 0) existing.samples = samples
        }
      }
      const counted = new Set()
      for (const item of Array.isArray(applied) ? applied : []) {
        if (item === null || typeof item !== 'object') continue
        counted.add(String(item.id))
        push(ruleInfo(String(item.id), lang), Number(item.count) || 1, item.samples)
      }
      for (const id of Array.isArray(warnings) ? warnings : []) {
        // 同一条规则既算“命中”又算“提示”时只统计一次，避免出现 2 次这种虚高数字
        if (counted.has(String(id))) continue
        push(ruleInfo(String(id), lang), 1, undefined)
      }
      const ordered = []
      for (const cat of RULE_CATEGORY_ORDER) {
        const bucket = groups.get(cat)
        if (bucket === undefined || bucket.size === 0) continue
        ordered.push({
          cat,
          items: [...bucket.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
        })
      }
      return ordered
    }


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

    /** 拆分括号内的取值列表（SET/ENUM），逗号在顶层才分割，字符串内的逗号保留。 */
    function mysqlSplitValues(text) {
      const items = []
      let current = ''
      let single = false
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
        if (char === "'") { single = true; current += char; continue }
        if (char === ',') { items.push(current); current = ''; continue }
        current += char
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
        // 通用映射：SET 允许多值，用 text[] 承载，取值集合用 CHECK ... <@ ARRAY[...] 约束
        return { type: 'text[]', setValues: size, numeric: false }
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
      let columnCheck = ''
      if (converted.enumValues !== undefined && converted.enumValues !== '') {
        columnCheck = ` CHECK (${name} IN ${converted.enumValues})`
      }
      if (converted.setValues !== undefined && converted.setValues !== '') {
        const values = mysqlSplitValues(converted.setValues.replace(/^\s*\(/, '').replace(/\)\s*$/, ''))
        const list = values.map(item => item.trim()).filter(item => item !== '')
        if (list.length > 0) {
          // SET 的取值是字面量，直接复用成数组字面量；<@ 表示“数组元素都在给定集合内”
          columnCheck = ` CHECK (${name} <@ ARRAY[${list.join(',')}]::text[])`
          notes.push(`${tableName}.${name}：MySQL SET 已映射为 text[] + CHECK（<@ 允许为空集合或多值），写入时请传数组字面量`)
        }
        // MySQL 用 '' 表示空集合，PG 数组要用 '{}'
        tail = tail.replace(/\bDEFAULT\s+''/g, "DEFAULT '{}'")
      }
      if (autoIncrement) {
        text += ' GENERATED BY DEFAULT AS IDENTITY'
        tail = tail.replace(/\bNOT\s+NULL\b/gi, ' ')
        tail = tail.replace(/\bDEFAULT\s+\S+/gi, ' ')
        tail = tail.replace(/\s+/g, ' ').trim()
      }
      if (tail !== '') text += ` ${tail}`
      text += columnCheck
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

/** 把 MySQL 的参数/返回类型映射为 HGDB 类型。 */
    function mysqlRoutineType(raw, ctx) {
      const match = /^\s*([A-Za-z]+)\s*(\([^)]*\))?\s*(UNSIGNED)?/i.exec(raw)
      if (match === null) return raw.trim()
      const mapped = mysqlColumnType(match[1], match[2] ?? '', match[3] !== undefined, ctx)
      return mapped === null ? raw.trim() : mapped.type
    }

    /** 解析 MySQL 参数列表为 PG 参数列表。 */
    function mysqlRoutineParams(raw, kind, ctx) {
      return mysqlSplitTopLevel(raw).map((part) => {
        let text = part.trim()
        if (text === '') return ''
        let mode = ''
        const modeMatch = /^(IN|OUT|INOUT)\s+/i.exec(text)
        if (modeMatch !== null) {
          mode = modeMatch[1].toUpperCase()
          text = text.slice(modeMatch[0].length)
        }
        const split = /^(`[^`]+`|[A-Za-z_][\w$]*)\s+([\s\S]+)$/.exec(text)
        if (split === null) {
          ctx.warn('routineParam')
          return text
        }
        const name = mysqlQuoteIdent(mysqlUnquote(split[1]))
        const type = mysqlRoutineType(split[2], ctx)
        if (kind === 'FUNCTION' && mode !== '' && mode !== 'IN') ctx.warn('routineParam')
        return `${kind === 'FUNCTION' ? '' : `${mode === '' ? 'IN' : mode} `}${name} ${type}`.trim()
      }).filter(Boolean)
    }

    /** MySQL 例程体 → PL/pgSQL 块（DECLARE / BEGIN / END）。 */
    function mysqlRoutineBodyToPg(body, kind, ctx) {
      let text = mysqlReplaceIdents(body).trim()
      if (/^\s*BEGIN\b/i.test(text)) {
        text = text.replace(/^\s*BEGIN\b/i, '')
        text = text.replace(/\s*END\s*;?\s*$/i, '')
      } else {
        text = text.replace(/;\s*$/i, '')
      }
      if (kind === 'TRIGGER') {
        text = text.replace(/\bSET\s+(NEW|OLD)\.([A-Za-z_][\w$]*)\s*=\s*/gi, '$1.$2 := ')
      } else {
        text = text.replace(/(^|\n)\s*SET\s+@?([A-Za-z_][\w$]*)\s*=\s*/g, (whole, lead, name) => `${lead}${name} := `)
      }
      const decls = []
      let notFoundHandler = false
      text = text.replace(/^\s*DECLARE\s+(?:CONTINUE|EXIT|UNDO)\s+HANDLER[\s\S]*?;\s*$/gim, () => {
        notFoundHandler = true
        ctx.warn('routineHandler')
        return ''
      })
      text = text.replace(/^\s*DECLARE\s+([A-Za-z_][\w$]*)\s+([\s\S]*?);\s*$/gim, (whole, name, rest) => {
        let type = rest.trim()
        let init = ''
        const def = /\bDEFAULT\s+([\s\S]+)$/i.exec(type)
        if (def !== null) {
          init = ` := ${def[1].trim()}`
          type = type.slice(0, def.index).trim()
        }
        if (/^CURSOR\s+FOR\b/i.test(type)) decls.push(`${name} CURSOR FOR ${type.replace(/^CURSOR\s+FOR\s+/i, '')}`)
        else decls.push(`${name} ${mysqlRoutineType(type, ctx)}${init}`)
        return ''
      })
      text = text.replace(/\bELSEIF\b/gi, 'ELSIF')
      text = text.replace(/^(\s*)([A-Za-z_][\w$]*)\s*:\s*LOOP\b/gim, '$1<<$2>> LOOP')
      text = text.replace(/\bWHILE\s+([^\n]*?)\s+DO\b/gi, 'WHILE $1 LOOP')
      text = text.replace(/\bEND\s+WHILE\s*;/gi, 'END LOOP;')
      text = text.replace(/\bREPEAT\b/gi, 'LOOP')
      text = text.replace(/\bUNTIL\s+([^\n]*?)\s+END\s+LOOP\s*;/gi, 'EXIT WHEN $1;\nEND LOOP;')
      text = text.replace(/\bSIGNAL\s+SQLSTATE\s+'[^']*'\s+SET\s+MESSAGE_TEXT\s*=\s*'([^']*)'\s*;/gi, "RAISE EXCEPTION '$1';")
      text = text.replace(/\bIFNULL\s*\(/gi, 'COALESCE(')
      text = text.replace(/\bRAND\s*\(\s*\)/gi, 'random()')
      text = text.replace(/\b(LPAD|RPAD)\s*\(\s*([^,]+?)\s*,/gi, '$1(($2)::text,')
      text = text.replace(/\bLEAVE\s+([A-Za-z_][\w$]*)\s*;/gi, 'EXIT $1;')
      text = text.replace(/\bITERATE\s+([A-Za-z_][\w$]*)\s*;/gi, 'CONTINUE $1;')
      text = text.replace(/\bNOW\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP')
      text = text.replace(/\bCURDATE\s*\(\s*\)/gi, 'CURRENT_DATE')
      text = text.replace(/\bCURTIME\s*\(\s*\)/gi, 'CURRENT_TIME')
      const dateFormatMap = { Y: 'YYYY', y: 'YY', m: 'MM', d: 'DD', H: 'HH24', h: 'HH12', i: 'MI', s: 'SS', M: 'Mon', b: 'Mon', e: 'DD' }
      text = text.replace(/DATE_FORMAT\s*\(\s*([^,()]+)\s*,\s*'([^']*)'\s*\)/gi, (whole, expr, format) =>
        `to_char(${expr.trim()}, '${format.replace(/%([YymdHhisMbe])/g, (spec, code) => dateFormatMap[code] ?? spec)}')`)
      text = text.replace(/\bLAST_INSERT_ID\s*\(\s*\)/gi, 'LASTVAL()')
      if (/\bDATE_FORMAT\s*\(/i.test(text)) ctx.warn('routineDateFormat')
      if (/@[A-Za-z_]/.test(text)) ctx.warn('routineUserVar')
      if (/\b(?:LEAVE|ITERATE)\b/i.test(text)) ctx.warn('routineControl')
      if (notFoundHandler) text = text.replace(/(\bFETCH\b[^;]*;)/gi, '$1\n  EXIT WHEN NOT FOUND;')
      const decl = decls.length === 0 ? '' : `DECLARE\n  ${decls.join(';\n  ')};\n`
      return `${decl}BEGIN\n${text.trim()}\nEND;`
    }

    /** 本地转换 MySQL 函数 / 存储过程 / 触发器为 PL/pgSQL。 */
    /** plmysql 外壳：保留 MySQL 风格 SET / ELSEIF / DATE_FORMAT / IFNULL，仅修正循环、标签、SIGNAL 等差异。 */
    function mysqlRoutineBodyToPlmysql(body, kind, ctx) {
      let text = mysqlReplaceIdents(body).trim()
      if (/^\s*BEGIN\b/i.test(text)) {
        text = text.replace(/^\s*BEGIN\b/i, '').replace(/\s*END\s*;?\s*$/i, '')
      }
      let notFoundHandler = false
      text = text.replace(/^\s*DECLARE\s+(?:CONTINUE|EXIT|UNDO)\s+HANDLER[\s\S]*?;\s*$/gim, () => {
        notFoundHandler = true
        ctx.warn('routineHandler')
        return ''
      })
      const decls = []
      text = text.replace(/^\s*DECLARE\s+([A-Za-z_][\w$]*)\s+([\s\S]*?);\s*$/gim, (whole, name, rest) => {
        let type = rest.trim()
        let init = ''
        const def = /\bDEFAULT\s+([\s\S]+)$/i.exec(type)
        if (def !== null) {
          init = ` := ${def[1].trim()}`
          type = type.slice(0, def.index).trim()
        }
        if (/^CURSOR\s+FOR\b/i.test(type)) decls.push(`${name} ${type}`)
        else decls.push(`${name} ${mysqlRoutineType(type, ctx)}${init}`)
        return ''
      })
      text = text.replace(/\bSIGNAL\s+SQLSTATE\s+'[^']*'\s+SET\s+MESSAGE_TEXT\s*=\s*'([^']*)'\s*;/gi, "RAISE EXCEPTION '$1';")
      text = text.replace(/\bWHILE\s+([^\n]*?)\s+DO\b/gi, 'WHILE $1 LOOP')
      text = text.replace(/\bEND\s+WHILE\s*;/gi, 'END LOOP;')
      text = text.replace(/^(\s*)([A-Za-z_][\w$]*)\s*:\s*LOOP\b/gim, '$1<<$2>> LOOP')
      text = text.replace(/\bLEAVE\s+([A-Za-z_][\w$]*)\s*;/gi, 'EXIT $1;')
      text = text.replace(/\bITERATE\s+([A-Za-z_][\w$]*)\s*;/gi, 'CONTINUE $1;')
      text = text.replace(/\bLAST_INSERT_ID\s*\(\s*\)/gi, 'LASTVAL()')
      text = text.replace(/\b(LPAD|RPAD)\s*\(\s*([^,]+?)\s*,/gi, '$1(($2)::text,')
      if (notFoundHandler) text = text.replace(/(\bFETCH\b[^;]*;)/gi, '$1\n  EXIT WHEN NOT FOUND;')
      const decl = decls.length === 0 ? '' : `DECLARE\n  ${decls.join(';\n  ')};\n`
      return `${decl}BEGIN\n${text.trim()}\nEND;`
    }

    function mysqlConvertRoutine(statement, kind, ctx, language = 'plpgsql') {
      ctx.warn('routine')
      if (kind === 'TRIGGER') ctx.warn('trigger')
      const text = statement.trim()
      if (kind === 'FUNCTION' || kind === 'PROCEDURE') {
        const head = kind === 'FUNCTION'
          ? /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:DEFINER\s*=\s*(?:`[^`]*`|'[^']*'|\S+)\s+)?FUNCTION\s+([^\s(]+)\s*\(/i
          : /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:DEFINER\s*=\s*(?:`[^`]*`|'[^']*'|\S+)\s+)?PROCEDURE\s+([^\s(]+)\s*\(/i
        const match = head.exec(text)
        if (match === null) return mysqlMarkRoutine(statement, kind, ctx)
        const open = text.indexOf('(', match.index)
        const close = mysqlFindParen(text, open)
        if (close < 0) return mysqlMarkRoutine(statement, kind, ctx)
        const name = mysqlReplaceIdents(match[1])
        const params = mysqlRoutineParams(text.slice(open + 1, close), kind, ctx)
        let rest = text.slice(close + 1)
        let returns = ''
        if (kind === 'FUNCTION') {
          const returnsMatch = /^\s*RETURNS\s+([A-Za-z]+(?:\s*\([^)]*\))?(?:\s+UNSIGNED)?)/i.exec(rest)
          if (returnsMatch === null) return mysqlMarkRoutine(statement, kind, ctx)
          returns = mysqlRoutineType(returnsMatch[1], ctx)
          rest = rest.slice(returnsMatch[0].length)
        }
        const begin = /\bBEGIN\b/i.exec(rest)
        const single = /^\s*RETURN\b/i.exec(rest)
        if (begin === null && single === null) return mysqlMarkRoutine(statement, kind, ctx)
        const body = language === 'plmysql'
          ? mysqlRoutineBodyToPlmysql(rest.slice((begin ?? single).index), kind, ctx)
          : mysqlRoutineBodyToPg(rest.slice((begin ?? single).index), kind, ctx)
        if (kind === 'FUNCTION') {
          return `CREATE OR REPLACE FUNCTION ${name}(${params.join(', ')}) RETURNS ${returns} LANGUAGE ${language} AS $fn$\n${body}\n$fn$;`
        }
        return `CREATE OR REPLACE PROCEDURE ${name}(${params.join(', ')}) LANGUAGE ${language} AS $fn$\n${body}\n$fn$;`
      }
      const trigger = /^\s*CREATE\s+(?:DEFINER\s*=\s*(?:`[^`]*`|'[^']*'|\S+)\s+)?TRIGGER\s+([^\s]+)\s+(BEFORE|AFTER)\s+(INSERT|UPDATE|DELETE)\s+ON\s+([^\s]+)\s+FOR\s+EACH\s+ROW\s+([\s\S]+)$/i.exec(text)
      if (trigger === null) return mysqlMarkRoutine(statement, kind, ctx)
      const name = mysqlReplaceIdents(trigger[1])
      const when = trigger[2].toUpperCase()
      const event = trigger[3].toUpperCase()
      const table = mysqlReplaceIdents(trigger[4])
      const fnName = `${name.replace(/"/g, '').replace(/\./g, '_')}_fn`
      let body = language === 'plmysql'
        ? mysqlRoutineBodyToPlmysql(trigger[5], 'TRIGGER', ctx)
        : mysqlRoutineBodyToPg(trigger[5], 'TRIGGER', ctx)
      if (!/\bRETURN\b/i.test(body)) {
        body = body.replace(/\nEND;$/, `\n  IF TG_OP = 'DELETE' THEN\n    RETURN OLD;\n  END IF;\n  RETURN NEW;\nEND;`)
      }
      return `CREATE OR REPLACE FUNCTION ${fnName}() RETURNS trigger LANGUAGE ${language} AS $trg$\n${body}\n$trg$;\nCREATE TRIGGER ${name} ${when} ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fnName}();`
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
          code = regexReplaceSampled(code, rule.pattern, rule.replace, function (match, after, offset) {
            if (typeof ctx.sample === 'function') {
              ctx.sample(rule.id, sampleSnippet(match), sampleSnippet(after), lineOfOffset(code, offset))
            }
          })
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
      if (/^CREATE\s+TRIGGER\b/i.test(body)) return `${leading}${mysqlConvertRoutine(body, 'TRIGGER', ctx)}`
      if (/^CREATE\s+(?:OR\s+REPLACE\s+)?PROCEDURE\b/i.test(body)) return `${leading}${mysqlConvertRoutine(body, 'PROCEDURE', ctx)}`
      if (/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i.test(body)) return `${leading}${mysqlConvertRoutine(body, 'FUNCTION', ctx)}`
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
      const bucket = createSampleBucket()
      const ctx = {
        count(id, value) { counts[id] = (counts[id] ?? 0) + value },
        warn(id) { warnings.add(id) },
        sample(id, before, after, line) { bucket.add(id, before, after, line) },
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
        applied: Object.keys(counts).map((id) => {
          const entry = { id, count: counts[id] }
          const samples = bucket.listOf(id)
          if (samples !== undefined && samples.length > 0) entry.samples = samples
          return entry
        }),
        warnings: [...warnings],
      }
    }

    /**
     * HGDB-V9-MySQL 最小改写：实测支持的 MySQL 语法原样保留，
     * 只处理实测不支持的部分（SET 类型、空间类型/索引、分区、视图选项、0900 排序规则、JSON_EXTRACT、FOUND_ROWS）。
     * 函数/过程/触发器改用目标内置的 plmysql 外壳，过程体保持 MySQL 写法。
     */
    function convertMysqlMinimal(source) {
      const warnings = new Set()
      const applied = []
      const bucket = createSampleBucket()
      const count = (id, value = 1) => {
        const item = applied.find(entry => entry.id === id)
        if (item === undefined) applied.push({ id, count: value })
        else item.count += value
      }
      /** 替换并计数/采样，供「规则」页签展示最小改写的示例。 */
      const replaceSampled = (current, pattern, replacement, id) => regexReplaceSampled(current, pattern, replacement, (match, after, offset) => {
        count(id)
        bucket.add(id, sampleSnippet(match), sampleSnippet(after), lineOfOffset(current, offset))
      })
      const routine = /^\s*CREATE\s+(?:DEFINER\s*=\s*\S+\s+)?(?:PROCEDURE|TRIGGER|EVENT)\b/i.test(source)
        || /^\s*CREATE\s+(?:DEFINER\s*=\s*\S+\s+)?FUNCTION\b[\s\S]*\bBEGIN\b/i.test(source)
      if (routine) {
        // 实测：目标支持“单条 RETURN 表达式”的 MySQL 函数框架，可原样保留；
        // 带 BEGIN...END 的复合函数、存储过程、触发器必须转 PL/pgSQL。
        const simpleFunction = /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:DEFINER\s*=\s*\S+\s+)?FUNCTION\b/i.test(source)
          && !/\b(?:BEGIN|DECLARE)\b/i.test(source)
          && /\bRETURN\b/i.test(source)
        if (simpleFunction) {
          return { text: ensureTerminator(source), applied: [], warnings: ['mysql.simpleFunction'] }
        }
        // 目标自带 plmysql 外壳：保留 MySQL 风格过程体，只修正循环/标签/SIGNAL 等差异。
        const kind = /^\s*CREATE\s+(?:DEFINER\s*=\s*\S+\s+)?TRIGGER\b/i.test(source)
          ? 'TRIGGER'
          : /^\s*CREATE\s+(?:DEFINER\s*=\s*\S+\s+)?PROCEDURE\b/i.test(source) ? 'PROCEDURE' : 'FUNCTION'
        const warnings = new Set()
        const ctx = { warn(id) { warnings.add(id) }, count() {} }
        const converted = mysqlConvertRoutine(source, kind, ctx, 'plmysql')
        if (converted.includes('-- TODO:')) return convertMysqlFull(source)
        return { text: converted, applied: [], warnings: [...warnings] }
      }

      let text = source
      // 视图选项：ALGORITHM / DEFINER / SQL SECURITY 不支持。
      const view = /^(\s*CREATE\s+(?:OR\s+REPLACE\s+)?)([\s\S]*?)\bVIEW\b/i.exec(text)
      if (view !== null && /(?:ALGORITHM|DEFINER|SQL\s+SECURITY)/i.test(view[2])) {
        const removed = view[2].replace(/\s+/g, ' ').trim()
        text = `${view[1]}VIEW${text.slice(view[0].length)}`
        warnings.add('mysql.viewOptions')
        count('mysql.viewOptions')
        bucket.add('mysql.viewOptions', sampleSnippet(removed), '（已移除视图选项）', 1)
      }
      // utf8mb4_0900_* 排序规则不存在，退到 unicode_ci。
      if (/\butf8mb4_0900_\w+\b/i.test(text)) {
        text = replaceSampled(text, /\butf8mb4_0900_\w+\b/gi, 'utf8mb4_unicode_ci', 'mysql.collation0900')
        warnings.add('mysql.collation0900')
      }
      // SET('a','b') 类型不支持，退化为 varchar。
      if (/\bSET\s*\(\s*'/i.test(text)) {
        text = replaceSampled(text, /\bSET\s*\([^)]*\)/gi, 'varchar(255)', 'mysql.setType')
        warnings.add('mysql.setType')
      }
      // 空间类型与 SPATIAL 索引不支持。
      if (/\b(?:GEOMETRY|POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\b/i.test(text)) {
        text = replaceSampled(text, /\b(?:GEOMETRY|POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\b/gi, 'bytea', 'mysql.spatial')
        warnings.add('mysql.spatial')
      }
      if (/\bSPATIAL\s+(?:KEY|INDEX)\b/i.test(text)) {
        const match = /SPATIAL\s+(?:KEY|INDEX)\s+`?\w+`?\s*\([^)]*\)/i.exec(text)
        text = text.replace(/,\s*SPATIAL\s+(?:KEY|INDEX)\s+`?\w+`?\s*\([^)]*\)/gi, '')
        text = text.replace(/SPATIAL\s+(?:KEY|INDEX)\s+`?\w+`?\s*\([^)]*\),\s*/gi, '')
        warnings.add('mysql.spatialIndex')
        count('mysql.spatialIndex')
        bucket.add('mysql.spatialIndex', sampleSnippet(match === null ? 'SPATIAL KEY' : match[0]), '（已移除空间索引）', lineOfOffset(source, match === null ? 0 : match.index))
      }
      // PARTITION BY 不支持，去掉分区子句（保留表定义）。
      if (/^\s*CREATE\s+TABLE\b/i.test(text) && /\bPARTITION\s+BY\b/i.test(text)) {
        const removedPartition = /\s*(PARTITION\s+BY\b[\s\S]*?)(?=;\s*$)/i.exec(text)
        text = text.replace(/\s*PARTITION\s+BY\b[\s\S]*?(?=;\s*$)/i, '')
        warnings.add('mysql.partition')
        count('mysql.partition')
        bucket.add('mysql.partition', sampleSnippet(removedPartition === null ? 'PARTITION BY ...' : removedPartition[1]), '（已移除分区子句）', lineOfOffset(source, removedPartition === null ? 0 : removedPartition.index))
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
      if (/DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?/i.test(text)) {
        text = text.replace(/DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?(`[^`]+`|[A-Za-z_][\w$.]*)\s*;?/gi, (whole, triggerName) => {
          const fnName = mysqlUnquote(triggerName).replace(/["`]/g, '').replace(/\./g, '_') + '_fn'
          warnings.add('mysql.dropTrigger')
          count('mysql.dropTrigger')
          return `DROP FUNCTION IF EXISTS ${fnName}() CASCADE;`
        })
      }
      for (const entry of applied) {
        const samples = bucket.listOf(entry.id)
        if (samples !== undefined && samples.length > 0) entry.samples = samples
      }
      return { text: ensureTerminator(text), applied, warnings: [...warnings] }
    }
    /* @mysql-rules:end */

    const COMMON_SQL_KEYWORDS = new Set((
      'select from where insert into update delete create drop alter truncate or replace function procedure trigger view table type '
      + 'return declare begin end if then else loop for while execute using null is as and not in exists like between '
      + 'primary key foreign references unique check default constraint index on values set group by order having union all distinct '
      + 'join left right inner outer cross case when commit rollback savepoint exception grant revoke cursor '
      + 'coalesce sum count max min avg current_timestamp comment'
    ).split(' '))

    const COMMON_SQL_TYPES = new Set('numeric varchar char date timestamp integer int smallint bigint decimal float real double precision'.split(' '))
    const SQL_DIALECT_HIGHLIGHT = Object.fromEntries(Object.entries({
      postgresql: [
        'returns elsif raise notice others language plpgsql do perform returning limit offset fetch next only materialized sequence '
        + 'public nextval currval lateral recursive with conflict excluded ilike over partition filter array variadic record strict diagnostics',
        'boolean text interval bytea json jsonb uuid serial bigserial timestamptz timetz money xml inet cidr',
      ],
      oracle: [
        'package body materialized sequence elsif immediate raise others pragma autonomous_transaction bulk collect forall '
        + 'synonym ref rowtype nvl nvl2 sysdate systimestamp decode rownum rowid dual level connect start prior nextval currval',
        'number varchar2 nvarchar2 nchar interval boolean clob nclob blob bfile raw long rowid urowid pls_integer binary_integer natural',
      ],
      mysql: [
        'returns elseif repeat until delimiter handler signal resignal diagnostics limit offset auto_increment engine unsigned '
        + 'duplicate replace zerofill event deterministic show describe explain language plmysql charset collate',
        'boolean text tinytext mediumtext longtext tinyint mediumint datetime time year varbinary binary blob tinyblob mediumblob longblob enum json bit',
      ],
      sqlserver: [
        'returns top go print try catch throw raiserror identity output inserted deleted exec nocount merge transaction '
        + 'nvarchar max with over partition offset fetch next only',
        'bit tinyint nvarchar nchar datetime datetime2 datetimeoffset smalldatetime time uniqueidentifier sql_variant money smallmoney varbinary binary xml',
      ],
    }).map(([dialect, [keywords, types]]) => [
      dialect, { keywords: new Set(keywords.split(' ')), types: new Set(types.split(' ')) },
    ]))

    /** Colour source and target SQL with their own lexical rules. */
    function highlightSql(text, dialect = 'oracle') {
      if (text === '') return null
      const rules = SQL_DIALECT_HIGHLIGHT[dialect] ?? SQL_DIALECT_HIGHLIGHT.postgresql
      const variants = {
        oracle: String.raw`[qQ]'(?:\[[\s\S]*?\]|\{[\s\S]*?\}|\([\s\S]*?\)|<[\s\S]*?>|([^\s'])[\s\S]*?\1)'`,
        mysql: String.raw`#[^\n]*|\x60(?:[^\x60]|\x60\x60)*\x60|'(?:\\[\s\S]|''|[^'\\])*'`,
        sqlserver: String.raw`\[(?:[^\]]|\]\])*\]`,
        postgresql: String.raw`\b[eE]'(?:\\[\s\S]|''|[^'\\])*'`,
      }
      const common = String.raw`--[^\n]*|/\*[\s\S]*?\*/|'(?:[^']|'')*'|"(?:""|[^"])*"|\b\d+(?:\.\d+)?\b|[A-Za-z_][A-Za-z0-9_$#]*|;`
      const dollar = dialect === 'postgresql' || dialect === 'mysql' ? String.raw`\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$|` : ''
      const nodes = []
      let index = 0
      const emit = (token, className) => nodes.push(className === ''
        ? token
        : h('span', { key: `sql${index++}`, className }, token))
      const scan = (sql, routineAllowed) => {
        const pattern = new RegExp(`${variants[dialect] ? variants[dialect] + '|' : ''}${dollar}${common}`, 'g')
        let last = 0
        let statementStart = 0
        let match
        while ((match = pattern.exec(sql)) !== null) {
          if (match.index > last) emit(sql.slice(last, match.index), '')
          const token = match[0]
          const word = token.toLowerCase()
          let className = ''
          if (token[0] === '$') {
            const prefix = sql.slice(statementStart, match.index)
            const routine = routineAllowed && (/^\s*do\s*$/i.test(prefix)
              || (/\bcreate\s+(?:or\s+replace\s+)?(?:function|procedure)\b/i.test(prefix) && /\bas\s*$/i.test(prefix)))
            const end = sql.indexOf(token, pattern.lastIndex)
            if (routine) {
              emit(token, 'sql-kw')
              scan(sql.slice(pattern.lastIndex, end < 0 ? sql.length : end), false)
              if (end >= 0) emit(token, 'sql-kw')
              pattern.lastIndex = end < 0 ? sql.length : end + token.length
              last = pattern.lastIndex
              continue
            }
            if (dialect === 'postgresql') {
              pattern.lastIndex = end < 0 ? sql.length : end + token.length
              emit(sql.slice(match.index, pattern.lastIndex), 'sql-str')
              last = pattern.lastIndex
              continue
            }
          } else if (token === ';') statementStart = pattern.lastIndex
          else if (token.startsWith('--') || token.startsWith('/*') || token[0] === '#') className = 'sql-com'
          else if (token[0] === "'" || /^[eq]'/i.test(token)) className = 'sql-str'
          else if (token[0] === '"' || token[0] === '`' || token[0] === '[') className = 'sql-ident'
          else if (/^\d/.test(token)) className = 'sql-num'
          else if (COMMON_SQL_TYPES.has(word) || rules.types.has(word)) className = 'sql-type'
          else if (COMMON_SQL_KEYWORDS.has(word) || rules.keywords.has(word)) className = 'sql-kw'
          emit(token, className)
          last = pattern.lastIndex
        }
        if (last < sql.length) emit(sql.slice(last), '')
      }
      scan(text, true)
      return nodes
    }

    let nextBrandIconId = 0

    /** Database cylinder with circular arrows for the conversion workbench. */
    function BrandIcon({ size = 36 }) {
      const [id] = React.useState(() => ++nextBrandIconId)
      const gradient = `hcs-db-${id}`
      const clip = `hcs-db-clip-${id}`
      const outline = 'M18 1.2c7.5 0 13.5 2.3 13.5 5.2v22.8c0 3.1-6 5.6-13.5 5.6S4.5 32.3 4.5 29.2V6.4c0-2.9 6-5.2 13.5-5.2Z'
      return h('svg', {
        width: size, height: size, viewBox: '0 0 36 36', 'aria-hidden': 'true',
        className: 'hch-brandIcon',
      },
      h('defs', null,
        h('linearGradient', { id: gradient, x2: '0%', y2: '100%' },
          h('stop', { stopColor: '#0099F7' }),
          h('stop', { offset: '100%', stopColor: '#283BCF' })),
        h('clipPath', { id: clip }, h('path', { d: outline }))),
      h('path', { d: outline, fill: `url(#${gradient})` }),
      h('g', {
        clipPath: `url(#${clip})`, fill: 'none', stroke: '#FFFFFF',
        strokeLinecap: 'round', strokeLinejoin: 'round',
      },
        h('path', { d: 'M4.5 6.4c0 2.9 6 5.2 13.5 5.2s13.5-2.3 13.5-5.2', strokeWidth: 1.15 }),
        h('path', { d: 'M11.7 19.8a6.5 6.5 0 0 1 11.5-2.4', strokeWidth: 2 }),
        h('path', { d: 'M24.3 23.2a6.5 6.5 0 0 1-11.5 2.4', strokeWidth: 2 }),
        h('path', { d: 'M25.5 19.9l-6-1.2 4.3-4.4Z M10.5 23.1l6 1.2-4.3 4.4Z', fill: '#FFFFFF', stroke: 'none' })))
    }

    function PanelIcon({ size = 16 }) {
      return h(BrandIcon, { size })
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

    const PLUGIN_VERSION = '3.3.7'

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
        playCircle: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'm10 8.5 6 3.5-6 3.5z'],
        terminal: ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'm7 9 3 3-3 3', 'M13 15h4'],
        database: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'],
        globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3.6 9h16.8', 'M3.6 15h16.8', 'M12 3c2.4 2.4 3.6 5.4 3.6 9s-1.2 6.6-3.6 9c-2.4-2.4-3.6-5.4-3.6-9S9.6 5.4 12 3z'],
        sync: ['M20.5 12a8.5 8.5 0 0 1-14.4 6.1', 'M3.5 12a8.5 8.5 0 0 1 14.4-6.1', 'M17.9 3.6v3.1h-3.1', 'M6.1 20.4v-3.1h3.1'],
        convert: ['M4 9h14', 'm14 5 4 4-4 4', 'M20 15H6', 'm6 11-4 4 4 4'],
        chart: ['M4 20V9', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
        treeExpand: ['M12 3v18', 'm7 8 5-5 5 5', 'm7 16 5 5 5-5'],
        treeCollapse: ['m7 4 5 5 5-5', 'm7 20 5-5 5 5'],
        treeLocate: ['M20 12a8 8 0 1 0-16 0 8 8 0 0 0 16 0z', 'M12 2v4m0 12v4M2 12h4m12 0h4'],
        arrowRight: ['M4 12h15', 'm13 6 6 6-6 6'],
        arrowUpRight: ['M7 17 17 7', 'M8 7h9v9'],
        plus: ['M12 5v14', 'M5 12h14'],
        check: ['m5 12 4 4L19 6'],
        shield: ['M12 3 20 6v5c0 4.6-3.3 7.9-8 10-4.7-2.1-8-5.4-8-10V6z', 'm8.5 12 2.4 2.4 4.6-4.8'],
        alert: ['M12 3 2.8 20h18.4z', 'M12 9v4.5', 'M12 17.2h.01'],
        clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3.2 2'],
        bolt: ['M13 2 4 14h6l-1 8 9-12h-6z'],
        download: ['M12 3.5v10.5', 'M7.5 9.5 12 14l4.5-4.5', 'M4.5 15.5v2.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2.5'],
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
        cleanup: ['m14 3 7 7-9 9-7-7z', 'm5 12-3 3 7 7 3-3', 'M14 22h7'],
        trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6M14 11v6'],
        copy: ['M9 3h9a2 2 0 0 1 2 2v11', 'M4 7h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z'],
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
      const { id, value, options, onChange, className = 'hch-select', ariaLabel } = props
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
        ? buttonRef.current.closest('.hcs-app')
        : null
      const themeName = themeHost !== null && themeHost.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
      const menu = open && menuRect !== null
        ? h('div', {
          ref: menuRef,
          className: 'hch-selectMenu',
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
          className: 'hch-selectOption',
          'data-selected': option.value === value ? 'true' : undefined,
          onClick: () => {
            onChange(option.value)
            setOpen(false)
          },
        }, option.label)))
        : null
      return h('div', { className: 'hch-selectWrap' },
        h('button', {
          ref: buttonRef,
          id,
          type: 'button',
          className: `${className} hch-selectBtn`,
          'aria-haspopup': 'listbox',
          'aria-expanded': open ? 'true' : 'false',
          'aria-label': ariaLabel,
          onClick: toggle,
        },
        h('span', { className: 'hch-selectValue' }, selected === undefined ? '\u2014' : selected.label),
        h('span', { className: 'hch-selectArrow', 'aria-hidden': 'true' })),
        menu === null || typeof document === 'undefined'
          ? null
          : (ReactDOM !== null && typeof ReactDOM.createPortal === 'function'
            ? ReactDOM.createPortal(menu, document.body)
            : menu))
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
      const left = 38
      const right = 10
      const top = 24
      const bottom = 30
      const max = Math.max(...done, ...review, 1) * 1.28
      const plotWidth = width - left - right
      const plotHeight = height - top - bottom
      const xAt = (index) => left + (plotWidth * index) / Math.max(labels.length - 1, 1)
      const yAt = (value) => top + plotHeight * (1 - value / max)
      const baseline = top + plotHeight
      const barWidth = Math.max(3, Math.min(22, (plotWidth / Math.max(labels.length, 1)) * 0.32))
      const donePoints = done.map((value, index) => [xAt(index), yAt(value)])
      const reviewPoints = review.map((value, index) => [xAt(index), yAt(value)])
      const doneLine = smoothPath(donePoints)
      const reviewLine = smoothPath(reviewPoints)
      const area = donePoints.length === 0
        ? ''
        : `${doneLine} L${xAt(done.length - 1).toFixed(1)},${(top + plotHeight).toFixed(1)} L${xAt(0).toFixed(1)},${(top + plotHeight).toFixed(1)} Z`
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
      const yTicks = [0, 1, 2, 3].map(index => h('text', {
        key: `tick-${index}`,
        x: left - 8,
        y: top + (plotHeight * index) / 3 + 3,
        textAnchor: 'end',
        fill: 'rgba(153, 174, 211, 0.62)',
        fontSize: 9.5,
      }, String(Math.round(max * (1 - index / 3)))))
      const bars = done.map((value, index) => h('rect', {
        key: `bar-${index}`,
        x: xAt(index) - barWidth / 2,
        y: yAt(value),
        width: barWidth,
        height: Math.max(2, baseline - yAt(value)),
        rx: Math.min(4, barWidth / 2),
        fill: 'url(#o2hBarGrad)',
      }))
      return h('div', { className: 'hch-chartWrap', ref: wrapRef },
        h('svg', {
          className: 'hch-chart',
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
            h('stop', { offset: '100%', stopColor: '#a78bfa' })),
          h('linearGradient', { id: 'o2hBarGrad', x1: '0', y1: '0', x2: '0', y2: '1' },
            h('stop', { offset: '0%', stopColor: '#60a5fa', stopOpacity: 0.5 }),
            h('stop', { offset: '100%', stopColor: '#2563eb', stopOpacity: 0.06 }))),
        gridLines,
        yTicks,
        bars,
        h('path', { d: area, fill: 'url(#o2hAreaGrad)' }),
        h('path', {
          className: 'hch-chartLine',
          d: doneLine,
          fill: 'none',
          stroke: 'url(#o2hLineGrad)',
          strokeWidth: 2.6,
          strokeLinecap: 'round',
          pathLength: 1,
          vectorEffect: 'non-scaling-stroke',
        }),
        h('path', {
          className: 'hch-chartLineReview',
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
          className: index === donePoints.length - 1 ? 'hch-chartPointLast' : undefined,
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
          ? h('div', { className: 'hch-chartEmpty' },
            h('span', { className: 'hch-chartEmptyIcon' }, h(StudioIcon, { name: 'chart', size: 18 })),
            h('p', null, attempted > 0 ? t('homeTrendNoTimestamps') : t('homeTrendEmpty')),
            h('button', { type: 'button', onClick: onOpenStudio }, t('homeTrendGo'), h(StudioIcon, { name: 'arrowRight', size: 12 })))
          : null)
    }

    /** Persistent top navigation shared by overview, workspace, and connections. */
    function StudioTopNav(props) {
      const { t, active, onNavigate, theme, onToggleTheme, lang, onToggleLang, onSetLang } = props
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
        className: `hch-navItem${extraClass}`,
        'data-active': active === key ? 'true' : undefined,
        'aria-current': active === key ? 'page' : undefined,
        onClick: () => onNavigate(key),
      }, label)
      return h('header', { className: 'hch-top' },
        h('div', { className: 'hch-brand' },
          h('span', { className: 'hch-mark' }, h(BrandIcon, { size: 44 })),
          h('span', { className: 'hch-brandText' },
            h('span', { className: 'hch-brandLine' },
              h('strong', null, t('pageTitle')),
              h('em', null, t('homePro'))),
            h('small', null, t('homeTagline')))),
        h('nav', { ref: navRef, className: 'hch-nav', 'aria-label': t('homeNav') },
          item('home', t('homeNav')),
          item('tasks', t('navTasks')),
          item('studio', t('homeStudio')),
          item('connections', t('homeConnections')),
          item('settings', t('homeSettings'))),
        h('div', { className: 'hch-topRight' },
          h('span', { className: 'hch-engine' }, h('i', null), t('homeEngineReady')),
          typeof onToggleLang === 'function'
            ? h('button', {
              type: 'button',
              className: 'hch-iconBtn hch-langBtn',
              onClick: onToggleLang,
              title: lang === 'en' ? t('langSwitchToZh') : t('langSwitchToEn'),
              'aria-label': lang === 'en' ? t('langSwitchToZh') : t('langSwitchToEn'),
              'data-lang': lang,
            }, lang === 'en' ? 'EN' : '中')
            : null,
          typeof onToggleTheme === 'function'
            ? h('button', {
              type: 'button',
              className: 'hch-iconBtn',
              onClick: onToggleTheme,
              title: theme === 'light' ? t('themeDark') : t('themeLight'),
              'aria-label': theme === 'light' ? t('themeDark') : t('themeLight'),
            }, h(StudioIcon, { name: theme === 'light' ? 'moon' : 'sun', size: 15 }))
            : null))
    }


    /** Full-page product overview shown before the SQL workspace. */
    function HomeViewBody(props) {
      const { t, files, connections, tasks, activeTaskId, lockedTaskId, onOpenStudio, onNewTask, onOpenConnections,
        onOpenFile, onOpenTask, onEditTask, onNavigate, embedded, theme, onToggleTheme, lang, onToggleLang } = props
      const [range, setRange] = React.useState('7d')
      const realFiles = files.filter(file => !isPlaceholderFile(file))
      const taskRecords = Array.isArray(tasks) ? tasks : []
      const demoMode = realFiles.length === 0 && connections.length === 0 && taskRecords.length === 0
      const sources = connections.filter(conn => isSourceKind(conn.kind)).length
      const targets = connections.filter(conn => isTargetKind(conn.kind)).length
      const taskLocal = taskRecords.filter(task => task.origin !== 'source').length
      const converted = realFiles.filter(file => file.status === 'ok').length
      const failed = realFiles.filter(file => file.status === 'error').length
      const executed = realFiles.filter(file => file.execStatus === 'ok').length
      const executionFailed = realFiles.filter(file => file.execStatus === 'error').length
      const attempted = converted + failed
      const successRate = attempted === 0 ? null : (converted / attempted) * 100
      const pending = realFiles.filter(file => file.status === 'idle' || file.status === 'error').length
      const successText = successRate === null ? '—' : `${successRate.toFixed(1)}%`
      const trend = buildHomeTrend(range, realFiles, demoMode, t)
      const currentTask = taskRecords.find(task => task.id === activeTaskId)
      const sourceConn = connections.find(conn => conn.id === currentTask?.sourceId && isSourceKind(conn.kind))
      const targetConn = connections.find(conn => conn.id === currentTask?.targetId && isTargetKind(conn.kind))
      const compatLabel = currentTask === undefined ? '' : t({
        oracle: 'compatShortOracle', mysql: 'compatShortMysql', postgresql: 'compatShortPostgresql',
      }[taskCompatMode(currentTask)])
      const renderBinding = (conn, local = false) => {
        if (currentTask === undefined) return null
        if (local) return h('span', { className: 'hch-flowBinding' }, t('homeLocalFile'))
        if (conn !== undefined) return h('span', { className: 'hch-flowBinding', title: conn.name }, conn.name)
        return h('button', {
          type: 'button', className: 'hch-linkBtn hch-flowBinding', disabled: currentTask.id === lockedTaskId, onClick: () => onEditTask(currentTask),
        }, t('homeBindConnection'))
      }
      const filesByTask = new Map()
      for (const file of realFiles) {
        if (!filesByTask.has(file.taskId)) filesByTask.set(file.taskId, [])
        filesByTask.get(file.taskId).push(file)
      }
      const workQueue = taskRecords.map(task => {
        const objects = filesByTask.get(task.id) ?? []
        const converted = objects.filter(file => file.status === 'ok').length
        const executed = objects.filter(file => file.execStatus === 'ok').length
        const execError = objects.find(file => file.execStatus === 'error')
        const review = objects.find(file => file.status === 'error')
        const next = objects.find(file => file.status !== 'ok')
        const toExecute = task.targetId ? objects.find(file => file.execStatus !== 'ok') : undefined
        const steps = [
          [task.lastReadError, 'homeReadFailed'],
          [execError, 'homeExecFailed', execError],
          [review, 'homeReviewRequired', review],
          [task.origin === 'source' && objects.length === 0 && !task.lastReadAt, 'homeReadPending'],
          [next || objects.length === 0, 'homeConvertPending', next],
          [toExecute, 'homeExecutePending', toExecute],
        ]
        const priority = steps.findIndex(([matches]) => matches)
        const [, status, file] = steps[priority] ?? [true, 'homeTaskComplete']
        return { task, file, status, priority: priority < 0 ? steps.length : priority,
          read: task.origin === 'source' ? objects.length : '—', converted, executed }
      }).sort((a, b) => a.priority - b.priority || (b.task.updatedAt ?? 0) - (a.task.updatedAt ?? 0)).slice(0, 10)
      const statCards = [
        { tone: 'green', icon: 'list', label: t('homeStatTasks'), value: formatCount(taskRecords.length),
          foot: t('homeStatTasksFoot', { local: taskLocal, source: taskRecords.length - taskLocal }) },
        { tone: 'blue', icon: 'database', label: t('homeStatConnections'), value: formatCount(connections.length),
          foot: t('homeStatConnectionsFoot', { sources, targets }) },
        { tone: 'violet', icon: 'bolt', label: t('homeStatSuccess'), value: successText,
          foot: t('homeStatAttempted', { done: converted, total: attempted }) },
        { tone: 'cyan', icon: 'check', label: t('homeStatExecuted'), value: formatCount(executed),
          foot: t('homeStatExecutionFoot', { failed: executionFailed }) },
      ]
      return h('div', { className: 'hch hch-home' },
        embedded ? null : h(StudioTopNav, { t, active: 'home', onNavigate, theme, onToggleTheme, lang, onToggleLang, onSetLang: props.onSetLang }),
        h('main', { className: 'hch-scroll' },
          h('div', { className: 'hch-inner' },
            h('section', { className: 'hch-hero' },
              h('div', { className: 'hch-heroCopy' },
                h('span', { className: 'hch-eyebrow' },
                  h('i', { className: 'hch-eyebrowDot' }),
                  t('homeEyebrow'),
                  demoMode ? h('span', { className: 'hch-demoChip', title: t('homeDemoHint') }, t('homeDemoChip')) : null),
                h('div', { className: 'hch-heroLead' },
                  h('h1', { className: 'hch-heroTitle' },
                    h('span', null, t('homeTitleA')),
                    h('span', { className: 'hch-grad' }, t('homeTitleB'))),
                  h('p', { className: 'hch-heroDesc' },
                    t('homeDesc').split('\n').map((line, index) => h('span', {
                      key: index,
                      className: 'hch-heroDescLine',
                    }, line))))),
              h('div', { className: 'hch-visual', 'aria-label': currentTask?.name ?? t('homePipelineTitle') },
                currentTask === undefined ? null : h('button', {
                  type: 'button', className: 'hch-linkBtn hch-flowTask', disabled: currentTask.id === lockedTaskId, onClick: () => onOpenTask(currentTask),
                  title: currentTask.name,
                }, currentTask.name),
                h('div', { className: 'hch-flow' },
                  h('div', { className: 'hch-flowNode' },
                    h('svg', { className: 'hch-dbIcon isSource', viewBox: '0 0 64 76', 'aria-hidden': 'true' },
                      h('ellipse', { cx: 32, cy: 13, rx: 25, ry: 9 }),
                      h('path', { d: 'M7 13v48c0 5 11.2 9 25 9s25-4 25-9V13' }),
                      h('path', { d: 'M7 29c0 5 11.2 9 25 9s25-4 25-9' }),
                      h('path', { d: 'M7 45c0 5 11.2 9 25 9s25-4 25-9' })),
                    h('small', null, t('homePipelineSource')),
                    renderBinding(sourceConn, currentTask?.origin === 'local')),
                  h('div', { className: 'hch-flowLine' },
                    h('i', { className: 'hch-flowDot' }),
                    h('i', { className: 'hch-flowDot hch-flowDotDelay' })),
                  h('div', { className: 'hch-flowEngine' },
                    h('svg', { className: 'hch-engineOrbitSvg', viewBox: '0 0 132 132', 'aria-hidden': 'true' },
                      h('circle', { className: 'hch-engineOrbitCircle', cx: 66, cy: 66, r: 64.5 })),
                    h('svg', { className: 'hch-engineArcSvg', viewBox: '0 0 132 132', 'aria-hidden': 'true' },
                      h('circle', { className: 'hch-engineArc', cx: 66, cy: 66, r: 57, transform: 'rotate(-90 66 66)' })),
                    h('span', { className: 'hch-engineBox' }, h(StudioIcon, { name: 'convert', size: 32, strokeWidth: 2.4 })),
                    h('b', null, t('homePipelineEngineTitle')),
                    h('small', null, compatLabel)),
                  h('div', { className: 'hch-flowLine' },
                    h('i', { className: 'hch-flowDot' })),
                  h('div', { className: 'hch-flowNode' },
                    h('svg', { className: 'hch-dbIcon isTarget', viewBox: '0 0 64 76', 'aria-hidden': 'true' },
                      h('ellipse', { cx: 32, cy: 13, rx: 25, ry: 9 }),
                      h('path', { d: 'M7 13v48c0 5 11.2 9 25 9s25-4 25-9V13' }),
                      h('path', { d: 'M7 29c0 5 11.2 9 25 9s25-4 25-9' }),
                      h('path', { d: 'M7 45c0 5 11.2 9 25 9s25-4 25-9' })),
                    h('small', null, t('homePipelineTarget')),
                    renderBinding(targetConn))))),
            h('section', { className: 'hch-stats' },
              statCards.map(card => h('article', { key: card.label, className: 'hch-stat', 'data-tone': card.tone },
                h('div', { className: 'hch-statTop' },
                  h('span', { className: 'hch-statIcon' }, h(StudioIcon, { name: card.icon, size: 16 })),
                  h('span', { className: 'hch-statLabel' }, card.label)),
                h('div', { className: 'hch-statValue' }, card.value),
                h('div', { className: 'hch-statFoot' },
                  h('span', { className: 'hch-statFootText' }, card.foot))))),
            h('div', { className: 'hch-dash' },
              h('section', { className: 'hch-card hch-trendCard' },
                h('header', { className: 'hch-cardHead' },
                  h('div', { className: 'hch-cardHeading' },
                    h('h2', { className: 'hch-cardTitle' }, h(StudioIcon, { name: 'chart', size: 15 }), t('homeTrendTitle')),
                    h('p', { className: 'hch-cardSub' }, range === '7d' ? t('homeTrendSub') : t('homeTrendSub30d'))),
                  h('div', { className: 'hch-tabs', role: 'group', 'aria-label': t('homeTrendTitle') },
                    h('button', {
                      type: 'button', className: 'hch-tab', 'data-active': range === '7d',
                      onClick: () => setRange('7d'),
                    }, t('homeTrend7d')),
                    h('button', {
                      type: 'button', className: 'hch-tab', 'data-active': range === '30d',
                      onClick: () => setRange('30d'),
                    }, t('homeTrend30d')))),
                h('div', { className: 'hch-chartCol' },
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
                  h('footer', { className: 'hch-chartFoot' },
                    h('span', { className: 'hch-legend' },
                      h('i', { className: 'isDone' }),
                      t('homeTrendDone'),
                      h('i', { className: 'isReview' }),
                      t('homeTrendReview')),
                    h('span', { className: 'hch-chartPeak' }, `${t('homeTrendPeak')} ${trend.peak}`)))),
              h('section', { className: 'hch-card hch-summaryCard' },
                h('div', { className: 'hch-summaryHead' },
                  h('h2', { className: 'hch-cardTitle' }, h(StudioIcon, { name: 'clock', size: 14 }), t('homeSideTitle')),
                  h('p', { className: 'hch-cardSub' }, range === '7d' ? t('homeTrendSub') : t('homeTrendSub30d'))),
                h('div', { className: 'hch-sideTiles' },
                  h('div', { className: 'hch-sideTile' }, h('span', null, t('homeSideTotal')), h('b', null, trend.total)),
                  h('div', { className: 'hch-sideTile' }, h('span', null, t('homeSidePeak')), h('b', null, trend.peak)),
                  h('div', { className: 'hch-sideTile' }, h('span', null, t('homeSidePending')), h('b', null, pending))),
                h('div', { className: 'hch-summarySection' },
                  h('div', { className: 'hch-summaryRow' },
                    h('span', null, t('homeStatSuccess')),
                    h('b', null, successText)),
                  h('div', { className: 'hch-summaryBar' },
                    h('i', { style: { width: `${successRate === null ? 0 : Math.max(0, Math.min(100, successRate))}%` } }))),
                h('div', { className: 'hch-summarySection' },
                  h('span', { className: 'hch-sideEyebrow' }, t('homeConnectionStatus')),
                  h('div', { className: 'hch-summaryRow' }, h('span', null, t('homeSideSources')), h('b', null, String(sources))),
                  h('div', { className: 'hch-summaryRow' }, h('span', null, t('homeSideTargets')), h('b', null, String(targets)))),
                h('div', { className: 'hch-sideActions' },
                  h('span', { className: 'hch-sideEyebrow' }, t('homeQuickTitle')),
                  h('button', { type: 'button', className: 'hch-sideAction', onClick: () => onNavigate('tasks') },
                    h(StudioIcon, { name: 'list', size: 13 }), t('navTasks')),
                  h('button', { type: 'button', className: 'hch-sideAction', onClick: onOpenConnections },
                    h(StudioIcon, { name: 'link', size: 13 }), t('homeConnections')))),
              h('section', { className: 'hch-card hch-recentWide' },
                h('div', { className: 'hch-recentWideHead' },
                  h('h2', { className: 'hch-cardTitle' }, h(StudioIcon, { name: 'clock', size: 14 }), t('homeSideRecentTitle')),
                  h('button', { type: 'button', className: 'hch-linkBtn', onClick: () => onNavigate('tasks') },
                    t('homeSideRecentMore'), h(StudioIcon, { name: 'arrowRight', size: 12 }))),
                workQueue.length === 0
                  ? h('p', { className: 'hch-sideEmpty hch-recentWideEmpty' }, t('homeSideRecentEmpty'))
                  : h('div', { className: 'hch-recentWideList' }, workQueue.map(item =>
                    h('button', {
                      key: item.task.id, type: 'button', className: 'hch-recentWideRow',
                      disabled: item.task.id === lockedTaskId,
                      onClick: () => item.file ? onOpenFile(item.file) : onOpenTask(item.task),
                      title: item.task.lastReadError || item.file?.execNote || item.file?.note || item.task.name,
                    },
                    h('span', { className: 'hch-recentWideName' }, item.task.name),
                    h('span', { className: 'hch-recentWideTask' }, t('homeTaskCounts', item)),
                    h('span', { className: 'hch-recentWideStatus', 'data-status': item.status === 'homeTaskComplete' ? 'ok' : item.priority < 3 ? 'error' : undefined },
                      t(item.status)),
                    h(StudioIcon, { name: 'arrowRight', size: 13 })))))))))

    }

    function StudioPageBody(props) {
      const { useWorkspaces, convert, collect, archiveOne, t, lang, onToggleLang } = props
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
        const tasksById = new Map(storedTasks.map(task => [task.id, task]))
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
            const task = tasksById.get(taskId)
            const requiresRewrite = task !== undefined && taskCompatMode(task) === 'postgresql'
              && (hasOracleAutonomousTransaction(sql) || hasOracleAutonomousTransaction(file.result)
                || (file.aiConverted !== true && file.warnings?.includes('needsAgent')))
            byId.set(file.id, {
              ...makeFile(file.name),
              ...file,
              taskId,
              sql,
              status: file.status === 'warn' ? 'ok' : file.status,
              note: file.note ?? '',
              ...(file.execStatus === 'running' ? { execStatus: undefined, execNote: '', execAt: undefined } : {}),
              updatedAt: typeof file.updatedAt === 'number' ? file.updatedAt : undefined,
              origin: (file.origin === 'source' && sourceId === '') ? 'manual' : file.origin,
              sourceId,
              ...(requiresRewrite && (file.status === 'ok' || file.status === 'warn')
                ? { status: 'error', note: t(hasOracleAutonomousTransaction(sql) || hasOracleAutonomousTransaction(file.result)
                  ? 'pgAutonomousUnsupported' : 'warn.needsAgent'), execStatus: undefined, execNote: '', execAt: undefined }
                : {}),
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
            byId.set(file.id, {
              ...mine, ...file, execStatus: file.execStatus, execNote: file.execNote, execAt: file.execAt,
            })
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
      const applyConversionResult = (file, patch) => {
        const result = patch.result ?? ''
        const execution = patch.status === 'ok' && result.trim() !== '' && result === file.result
          ? {}
          : { execStatus: undefined, execNote: '', execAt: undefined }
        return { ...file, aiConverted: false, ...patch, result, ...execution }
      }
      const saveFileConversion = (id, patch) => {
        commitFiles(list => list.map(file => file.id === id ? applyConversionResult(file, patch) : file))
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
      const [execFilter, setExecFilter] = React.useState(typeof initial.execFilter === 'string' ? initial.execFilter : 'all')
      /** 结果列页签：result / diff / rules / exec。 */
      const [paneTab, setPaneTab] = React.useState('result')
      /** 差异页签是否只看差异行。 */
      const [diffOnly, setDiffOnly] = React.useState(true)
      /** 源列页签：source（源 SQL）/ deps（依赖对象）；未开启“获取依赖对象”时只显示源 SQL。 */
      const [sourceTab, setSourceTab] = React.useState('source')
      /** 左侧筛选下拉（类型 / 转换状态）当前展开项，'' 表示都收起。 */
      const [openFilter, setOpenFilter] = React.useState('')
      const [readDeps, setReadDeps] = React.useState(readDependencySetting)
      /** 源库依赖结果（按文件缓存）：{ loading, error, from, items }。 */
      const [depsState, setDepsState] = React.useState({ loading: false, error: '', from: '', fileId: '', items: [], fetched: false })
      /** 展开查看 DDL 的依赖名。 */
      const [depsOpenDdl, setDepsOpenDdl] = React.useState('')
      /** 已获取过的依赖结果按文件缓存，切回该文件不再重复请求。 */
      const depsCacheRef = React.useRef(loadDepsCache())
      const depsPrefetchRef = React.useRef(new Map())
      const depsRequestsRef = React.useRef(new Map())
      /** 依赖对象自身的 DDL 缓存（key: fileId|对象名），按需展开时懒加载。 */
      const depsDdlRef = React.useRef(new Map())
      /** 正在加载 DDL 的 key。 */
      const [depsDdlLoading, setDepsDdlLoading] = React.useState('')
      /** DDL 后台预取计数，变化时触发重渲染。 */
      const [depsDdlVersion, setDepsDdlVersion] = React.useState(0)
      /** 已发起过 DDL 请求的 key，避免重复。 */
      const depsDdlAskedRef = React.useRef(new Set())
      const [readTypes, setReadTypes] = React.useState(() => {
        const stored = initial.readTypes
        if (!Array.isArray(stored)) return OBJECT_TYPES
        const valid = stored.filter(type => ALL_OBJECT_TYPES.includes(type) || type === 'local' || type === 'untyped')
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
      const selectedTaskRef = React.useRef(activeTaskId)
      selectedTaskRef.current = activeTaskId
      const lockedTaskId = job?.taskId
      const isTaskLocked = (id) => (jobRef.current ?? job)?.taskId === id
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
      const [dropCascade, setDropCascade] = React.useState(readDropCascade)
      const [menu, setMenu] = React.useState(null)
      const [renaming, setRenaming] = React.useState(null)
      const renameCancelRef = React.useRef(false)
      const highlightRef = React.useRef(null)
      const [status, setStatus] = React.useState({ text: '', kind: '' })
      /** 统一的应用内确认弹窗（替代 window.confirm），返回 Promise<boolean>。 */
      const [confirmRequest, setConfirmRequest] = React.useState(null)
      const [cleanupDraft, setCleanupDraft] = React.useState(null)
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
      /** 源 SQL 文本域：规则示例点击后定位到对应行。 */
      const textareaRef = React.useRef(null)
      const fileInputRef = React.useRef(null)
      const tasksRef = React.useRef(tasks)
      const resumedRef = React.useRef(false)
      const interruptibleJobRef = React.useRef(null)
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
      const startInterruptibleJob = (kind, details) => {
        const controller = new AbortController()
        const record = beginJob(kind, details)
        interruptibleJobRef.current = controller
        const stopped = new Promise(resolve => controller.signal.addEventListener('abort', () => resolve(null), { once: true }))
        return {
          signal: controller.signal,
          wait: (result) => Promise.race([result, stopped]),
          cancelled: () => controller.signal.aborted || readJobCancelStamp() >= record.startedAt,
          finish: () => {
            if (interruptibleJobRef.current !== controller) return
            interruptibleJobRef.current = null
            if (jobRef.current?.startedAt === record.startedAt) endJob()
          },
        }
      }
      /** Stop the active operation and discard any late response. */
      const clearInterruptedExecution = (taskId) => {
        if (!filesRef.current.some(file => file.taskId === taskId && file.execStatus === 'running')) return
        const updatedAt = Date.now()
        commitFiles(list => list.map(file => file.taskId === taskId && file.execStatus === 'running'
          ? { ...file, execStatus: undefined, execAt: undefined, execNote: '', updatedAt }
          : file))
      }
      const stopJob = () => {
        const current = jobRef.current ?? job
        if (current === null) return
        requestJobCancel()
        suppressJobRef.current = Date.now() + 8000
        if (current.kind !== 'execute') {
          interruptibleJobRef.current?.abort()
          if (current.kind === 'convert' && interruptibleJobRef.current === null) {
            const inflight = inflightState()
            if (inflight !== undefined) {
              clearInflight()
              Promise.resolve(archiveOne(inflight.sessionId)).catch(() => {})
            }
          }
          if (current.kind === 'read' && current.jobId) {
            fetch('/api/hgdb-convert-studio/cancel', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ jobId: current.jobId }),
            }).catch(() => {})
          }
          if (jobRef.current === null) {
            writeJobState(null)
            setJob(null)
          }
          setStatus({ text: t(current.kind === 'read' ? 'jobReadStopped' : 'jobConvertStopped'), kind: '' })
          return
        }
        executeRunRef.current += 1
        cancelRef.current = true
        if (executeAbortRef.current !== null) {
          try {
            executeAbortRef.current.abort()
          } catch {
            /* already finished */
          }
          executeAbortRef.current = null
        }
        const jobId = executeJobIdRef.current
          || (jobRef.current !== null && typeof jobRef.current.jobId === 'string' ? jobRef.current.jobId : (current.jobId ?? ''))
        executeJobIdRef.current = ''
        if (jobId !== '') {
          fetch('/api/hgdb-convert-studio/cancel', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ jobId }),
          }).catch(() => {})
        }
        clearInterruptedExecution(current.taskId)
        setExecuting(false)
        setExecFileId('')
        if (jobRef.current === null) {
          writeJobState(null)
          setJob(null)
        } else endJob()
        setStatus({ text: t('jobStopped'), kind: '' })
      }
      // 每秒刷新耗时，并跟随落盘进度；作业被别的实例结束时立刻同步数据。
      React.useEffect(() => {
        if (job === null) return undefined
        const timer = setInterval(() => {
          const current = jobRef.current
          const owned = current !== null && ownJobRef.current === current.startedAt
          if (owned && interruptibleJobRef.current !== null && readJobCancelStamp() >= current.startedAt) {
            interruptibleJobRef.current.abort()
          }
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
              fetch('/api/hgdb-convert-studio/cancel', {
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
      const hasTarget = targetConnId !== '' && connections.some(conn => conn.id === targetConnId)

      const visible = displayFiles.filter(file =>
        (query.trim() === '' || file.name.toLowerCase().includes(query.trim().toLowerCase()))
        && (typeFilter === 'all' || (file.objType ?? '') === typeFilter)
        && (convFilter === 'done' ? file.status === 'ok'
          : convFilter === 'pending' ? file.status === 'idle'
            : convFilter === 'failed' ? file.status === 'error'
              : true)
        && (!hasTarget ? true
          : execFilter === 'ok' ? file.execStatus === 'ok'
            : execFilter === 'pending' ? (file.execStatus ?? 'idle') === 'idle'
              : execFilter === 'failed' ? file.execStatus === 'error'
                : true))
      const active = visible.find(file => file.id === activeId)
        ?? visible[0]
        ?? displayFiles.find(file => file.id === activeId)
        ?? displayFiles[0]
        ?? contextFiles.find(file => file.id === activeId)
        ?? contextFiles[0]
        ?? { id: '', name: '', sql: '', result: '', note: '', status: 'idle', origin: 'manual' }
      const availableTypes = Array.from(new Set(contextFiles
        .map(file => file.objType)
        .filter(type => typeof type === 'string' && type !== ''))).sort()
      const contextReady = activeTask !== undefined
      const hasActiveSql = contextReady && active.sql.trim() !== ''
      const hasSourceConnection = sourceContext && connections.some(conn => conn.id === activeTask.sourceId && isSourceKind(conn.kind))
      const canReadObjects = hasSourceConnection && readTypes.length > 0 && job === null
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
      const activeTreeRowRef = React.useRef(null)
      const [locateFileId, setLocateFileId] = React.useState('')
      const fileRow = (file) => {
        const fileBusy = busy !== null && busy.fileId === file.id
        const fileExec = executing && execFileId === file.id
        const fileActive = fileBusy || fileExec
        return h('div', {
          key: file.id,
          ref: file.id === active.id ? activeTreeRowRef : undefined,
          className: `hcs-file${file.id === active.id ? ' hcs-fileActive' : ''}${fileActive ? ' hcs-fileBusy' : ''}`,
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
        h('span', { className: 'hcs-treeIcon' }, h(StudioIcon, { name: objectTypeIcon(file.objType), size: 14 })),
        renaming !== null && renaming.id === file.id
          ? h('input', {
            className: 'hcs-fileNameInput',
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
            className: 'hcs-fileName',
            title: file.name,
          }, file.name),
        h('span', {
          className: 'hcs-fileStatus',
          'data-status': file.status,
          // 只有“转换”在用这个转圈；执行有独立的播放标记，避免执行时误以为在转换。
          'data-busy': fileBusy ? 'true' : undefined,
          'data-tone': fileBusy ? undefined : (fileExec ? 'exec' : undefined),
        }, fileBusy ? h('i', null) : file.status === 'ok' ? h(StudioIcon, { name: 'check', size: 13 }) : h('i', null)),
        hasTarget
          ? h('span', {
            className: 'hcs-fileExec',
            'data-status': fileExec ? 'running' : (file.execStatus ?? 'idle'),
            title: fileExec
              ? t('execRunning')
              : file.execStatus === 'ok' ? t('execMarkDone')
                : file.execStatus === 'error' ? (file.execNote || t('execMarkFailed'))
                  : t('execMarkIdle'),
          }, h(StudioIcon, { name: 'play', size: 9 }))
          : null)
      }
      /** 紧凑筛选下拉：图标 + 当前值 + 菜单，替代原生 select 的系统样式。 */
      const chipSelect = (id, icon, label, value, options, onPick) => {
        const active = options.find(option => option.value === value)
        const open = openFilter === id
        return h('div', { className: 'hcs-chipSelect' },
          h('button', {
            type: 'button',
            className: 'hcs-chipBtn',
            disabled: id !== 'task' && displayFiles.length === 0,
            'data-open': open ? 'true' : undefined,
            title: label,
            onClick: () => setOpenFilter(open ? '' : id),
          },
          h(StudioIcon, { name: icon, size: 12 }),
          h('span', { className: 'hcs-chipLabel' }, active === undefined ? label : active.label),
          h('span', { className: 'hcs-chipCaret', 'aria-hidden': 'true' }, '\u25be')),
          open
            ? h('div', { className: 'hcs-chipMenu', role: 'listbox' }, options.map(option => h('button', {
              key: option.value,
              type: 'button',
              role: 'option',
              className: 'hcs-chipItem',
              'aria-selected': option.value === value ? 'true' : undefined,
              onClick: () => {
                onPick(option.value)
                setOpenFilter('')
              },
            },
            option.value === value
              ? h(StudioIcon, { name: 'check', size: 11 })
              : h('span', { className: 'hcs-chipDot', 'aria-hidden': 'true' }),
            h('span', null, option.label))))
            : null)
      }

      const groupedByType = activeTask !== undefined && activeTask.origin === 'source'
      const treeGroupOf = (file) => groupedByType
        ? (ALL_OBJECT_TYPES.includes(file.objType) ? file.objType : 'untyped')
        : 'local'
      const groups = new Map()
      for (const file of visible) {
        const group = treeGroupOf(file)
        if (!groups.has(group)) groups.set(group, [])
        groups.get(group).push(file)
      }
      const groupKeys = [...ALL_OBJECT_TYPES, 'untyped', 'local']
      const taskGroupKeys = [...new Set(displayFiles.map(treeGroupOf))]
      const fileBlocks = groupKeys.filter(key => groups.has(key)).map(key => {
        const group = groups.get(key)
        const collapsed = collapsedTypes.includes(key)
        const label = key === 'local' ? t('workbarLocal') : key === 'untyped' ? t('typeUnspecified') : key
        return h(React.Fragment, { key },
          h('button', {
            type: 'button', className: 'hcs-groupHead', 'aria-expanded': !collapsed,
            onClick: () => setCollapsedTypes(current => current.includes(key)
              ? current.filter(item => item !== key) : [...current, key]),
          },
          h('span', { className: 'hcs-groupHeadLeft' },
            h('span', { className: 'hcs-groupChevron' }, collapsed ? '▸' : '▾'),
            h(StudioIcon, { name: objectTypeIcon(key), size: 13 }),
            h('span', null, label)),
          h('span', { className: 'hcs-groupCount' }, String(group.length))),
          collapsed ? null : group.map(fileRow))
      })
      const canLocate = displayFiles.some(file => file.id === active.id)
      const locateActiveSql = () => {
        if (!canLocate) return
        const group = treeGroupOf(active)
        if (!visible.some(file => file.id === active.id)) {
          setQuery('')
          setTypeFilter('all')
          setConvFilter('all')
          setExecFilter('all')
        }
        setActiveId(active.id)
        setCollapsedTypes(current => current.filter(item => item !== group))
        setLocateFileId(active.id)
      }
      React.useEffect(() => {
        if (locateFileId === '') return
        const row = activeTreeRowRef.current
        const list = row?.closest('.hcs-fileList')
        if (locateFileId === active.id && list != null) {
          const rowBounds = row.getBoundingClientRect()
          const listBounds = list.getBoundingClientRect()
          const offset = rowBounds.top - listBounds.top - list.clientTop
          list.scrollTop += offset - (list.clientHeight - rowBounds.height) / 2
        }
        setLocateFileId('')
      }, [locateFileId, active.id])

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
          execFilter,
          typeFilter,
          readTypes,
          collapsedTypes,
        })
        if (typeof written === 'string') storedRawRef.current = written
      }, [activeId, schema, compat, targetConnId, sourceConnId, activeTaskId, view, convFilter, execFilter, typeFilter, readTypes, collapsedTypes])
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
        if (isTaskLocked(fileTaskId)) return
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
        if (task && isTaskLocked(task.id)) return
        const editing = task !== undefined && task !== null
        const sourceId = editing ? (task.sourceId ?? '') : ''
        const wizardSource = connections.find(conn => conn.id === sourceId)
        const allowedTypes = objectTypesFor(wizardSource === undefined ? 'oracle' : wizardSource.kind)
        const seededTypes = (editing && Array.isArray(task.readTypes)
          ? task.readTypes.filter(type => ALL_OBJECT_TYPES.includes(type))
          : allowedTypes).filter(type => allowedTypes.includes(type))
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
      // 点空白处收起筛选下拉
      React.useEffect(() => {
        if (openFilter === '') return
        const onPointerDown = (event) => {
          const target = event.target
          if (target !== null && typeof target.closest === 'function' && target.closest('.hcs-chipSelect') !== null) return
          setOpenFilter('')
        }
        window.addEventListener('pointerdown', onPointerDown)
        return () => window.removeEventListener('pointerdown', onPointerDown)
      }, [openFilter])

      /** 任务下拉里的展示名：任务名 · 兼容形态（不显示目标库，避免过长）。 */
      const taskOptionLabel = (task) => {
        if (task === null || task === undefined) return ''
        const target = connections.find(conn => conn.id === (task.targetId ?? ''))
        let mode
        if (target !== undefined && target.kind === 'hgdb-mysql') mode = t('compatShortMysql')
        else if (target !== undefined && target.kind === 'hgdb-oracle') mode = t('compatShortOracle')
        else mode = task.compat === true ? t('compatShortOracle') : t('compatShortPostgresql')
        // 用窄空格包裹分隔符：既有边界感，又比普通空格省地方
        return `${task.name}\u2009\u00b7\u2009${mode}`
      }
      const selectTask = (id) => {
        setSourceTab('source')
        setPaneTab('result')
        setOpenFilter('')
        setMenu(null)
        setQuery('')
        setTypeFilter('all')
        setConvFilter('all')
        setExecFilter('all')
        setDepsState({ loading: false, error: '', from: '', fileId: '', items: [], fetched: false })
        setDepsOpenDdl('')
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
        if (task && isTaskLocked(task.id)) return
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
        if (isTaskLocked(task.id)) return
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
      /** 简单标识符原样使用，含特殊字符时加双引号，避免 schema 名注入或语法错误。 */
    function sqlIdent(raw) {
      const name = String(raw).trim()
      if (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(name)) return name
      return `"${name.replace(/"/g, '""')}"`
    }

    /** 把目标库返回的执行错误翻成人能看懂的一句话。 */
      const describeExecError = (raw) => {
        const text = String(raw ?? '').replace(/^(?:\s*ERROR:\s*)+/i, '').trim()
        if (text === '') return t('execMarkFailed')
        if (/type\s+"autonomous_transaction"\s+does not exist/i.test(text)) return t('pgAutonomousUnsupported')
        if (/no schema has been selected to create in/i.test(text)) {
          return t('execErrNoSchema', { schema: schema.trim() || t('taskSchemaInherit') })
        }
        const exists = /(?:relation|table|view|function|procedure|type|index)\s+"([^"]+)"\s+already exists/i.exec(text)
        if (exists !== null) return t('execErrExists', { name: exists[1] })
        if (/because other objects depend on (?:them|it)/i.test(text) || /objects depend on/i.test(text)) {
          return t('execErrDepends', { detail: text })
        }
        if (/permission denied/i.test(text)) return t('execErrPermission', { detail: text })
        if (/syntax error at or near/i.test(text)) return t('execErrSyntax', { detail: text })
        if (/(?:relation|function|operator|type)\s+.+\s+does not exist/i.test(text)) return t('execErrMissing', { detail: text })
        return text
      }
      /** 测试连接失败的提示：去掉 Java 异常前缀，给出可操作的结论。 */
      const describeConnTestMessage = (raw) => {
        const text = String(raw ?? '')
          .replace(/Exception in thread "[^"]*"\s*/g, '')
          .replace(/测试失败（exit \d+）：/g, '')
          .trim()
        const lower = text.toLowerCase()
        if (lower.includes('测试超时')) {
          return t('connTestTimeout', { detail: text.slice(0, 160) })
        }
        if (lower.includes('got minus one from a read call')) {
          return t('connTestNotOracle', { detail: text.slice(0, 160) })
        }
        if (lower.includes('eofexception') || lower.includes('connection attempt failed') || lower.includes('尝试连接已失败')) {
          return t('connTestClosed', { detail: text.slice(0, 160) })
        }
        if (lower.includes('communications link failure') || lower.includes('connection is closed')) {
          return t('readLinkDropped', { detail: text.slice(0, 200) })
        }
        if (lower.includes('connection refused') || lower.includes('连接被拒绝')) {
          return t('connTestRefused', { detail: text.slice(0, 160) })
        }
        return text
      }

      const describeReadError = (raw) => {
        // 去掉 Java 异常前缀与“读取失败：”外壳，只留有用信息
        const text = (typeof raw === 'string' ? raw : String(raw ?? ''))
          .replace(/^读取失败[:：]\s*/, '')
          .replace(/^Exception in thread "[^"]*"\s*/, '')
          .trim()
        const lower = text.toLowerCase()
        if (lower.includes('communications link failure')) {
          return t('readLinkDropped', { detail: text.length > 240 ? `${text.slice(0, 240)}…` : text })
        }
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
      const mergeReadObjects = (list, objects, context) => {
        const { connId, taskId, sourceKey, sameLegacyScope } = context
        const identity = (type, name) => JSON.stringify([type, name])
        const existing = new Map()
        for (const file of list) {
          if (file.origin !== 'source' || file.taskId !== taskId || file.sourceId !== connId || isPlaceholderFile(file)) continue
          existing.set(identity(file.objType, file.sourceObjectName ?? file.name.replace(/\.sql$/i, '')), file)
        }
        const replacements = new Map()
        const additions = []
        const fetched = []
        const seen = new Set()
        for (const object of objects) {
          if (!object || typeof object.name !== 'string' || typeof object.ddl !== 'string' || object.ddl.trim() === '') continue
          const objType = typeof object.type === 'string' ? object.type : ''
          const key = identity(objType, object.name)
          if (seen.has(key)) continue
          seen.add(key)
          const old = existing.get(key)
          const sql = ensureTerminator(object.ddl)
          const sameSource = old !== undefined && (old.sourceReadKey === sourceKey
            || (old.sourceReadKey === undefined && sameLegacyScope))
          if (sameSource && old.sql === sql) {
            const unchanged = old.sourceReadKey === undefined
              ? { ...old, sourceReadKey: sourceKey, sourceObjectName: object.name }
              : old
            if (unchanged !== old) replacements.set(old.id, unchanged)
            fetched.push(unchanged)
            continue
          }

          // A new id keeps late dependency responses for the old SQL out of the new cache.
          const file = {
            ...makeFile(old?.name ?? `${object.name}.sql`, sql, 'source', connId, taskId),
            objType, sourceReadKey: sourceKey, sourceObjectName: object.name,
          }
          if (old === undefined) additions.push(file)
          else replacements.set(old.id, file)
          fetched.push(file)
        }
        // A bounded DDL response cannot prove that missing objects were deleted.
        const next = replacements.size === 0 && additions.length === 0 ? list
          : prunePlaceholders([...list.map(file => replacements.get(file.id) ?? file), ...additions])
        return { next, fetched, replacements }
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
        if (reading || jobRef.current !== null) return
        setReading(true)
        setStatus({ text: t('reading'), kind: '' })
        const readJobId = `read-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const operation = startInterruptibleJob('read', {
          taskId,
          total: 0,
          label: [conn.name, readSchema].filter(Boolean).join(' \u00b7 '),
          jobId: readJobId,
        })
        // 轮询 Host 的 PROGRESS 行，实时更新「已读取 N / 总数」
        const progressTimer = setInterval(async () => {
          try {
            const response = await fetch(`/api/hgdb-convert-studio/job-progress?jobId=${encodeURIComponent(readJobId)}`, { credentials: 'include' })
            if (!response.ok || operation.cancelled()) return
            const value = await response.json().catch(() => ({}))
            if (!operation.cancelled() && value !== null && typeof value === 'object' && Number(value.total) > 0) {
              updateJob({ done: Number(value.done) || 0, total: Number(value.total) })
            }
          } catch {
            /* 忽略单次轮询失败 */
          }
        }, 700)
        const previousTask = taskId !== '' ? tasksRef.current.find(item => item.id === taskId) : undefined
        const previousStatus = previousTask === undefined || previousTask.status === 'reading'
          ? 'new'
          : previousTask.status
        if (taskId !== '') {
          patchTask(taskId, { status: 'reading', updatedAt: Date.now() })
        }
        try {
          const response = await fetch('/api/hgdb-convert-studio/read-objects', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            signal: operation.signal,
            body: JSON.stringify({
              kind: conn.kind,
              host: conn.host,
              port: Number(conn.port),
              database: conn.database,
              jobId: readJobId,
              user: conn.user,
              password: conn.password ?? '',
              schema: readSchema,
              limit: 500,
              types,
            }),
          })
          const value = await response.json().catch(() => ({}))
          if (operation.cancelled()) throw new Error(t('jobReadStopped'))
          if (!response.ok || value.ok !== true) {
            const message = describeReadError(value.message || `HTTP ${response.status}`)
            if (taskId !== '') {
              patchTask(taskId, {
                status: previousStatus,
                lastReadError: message,
                objectCount: countTaskObjects(taskId),
                updatedAt: Date.now(),
              })
            }
            setStatus({ text: message, kind: 'error' })
            return
          }
          if (!Array.isArray(value.objects)) throw new Error(t('readObjectsInvalid'))
          const scope = conn.kind === 'oracle' ? String(readSchema).toUpperCase() : readSchema
          const sourceKey = JSON.stringify([conn.kind, conn.host.trim().toLowerCase(), Number(conn.port), conn.database, conn.user, scope])
          const previousSchema = previousTask?.schema?.trim() || connDefaultSchema
          const sameLegacyScope = previousTask?.sourceId === connId
            && (conn.kind === 'oracle' ? previousSchema.toUpperCase() : previousSchema) === scope
          const { next, fetched, replacements } = mergeReadObjects(filesRef.current, value.objects, { connId, taskId, sourceKey, sameLegacyScope })
          let cacheChanged = false
          for (const [id, file] of replacements) {
            if (id !== file.id && depsCacheRef.current.delete(id)) cacheChanged = true
          }
          if (cacheChanged) saveDepsCache(depsCacheRef.current)
          commitFiles(next)
          if (fetched.length > 0 && selectedTaskRef.current === taskId) {
            setActiveId(current => replacements.get(current)?.id
              ?? (next.some(file => file.id === current && !isPlaceholderFile(file)) ? current : fetched[0].id))
          }
          if (taskId !== '') patchTask(taskId, {
            status: 'ready',
            objectCount: countTaskObjects(taskId),
            lastReadAt: Date.now(),
            lastReadError: undefined,
            updatedAt: Date.now(),
            readTypes: types,
            schema: readSchema,
          })
          setStatus({ text: taskId === '' ? t('readObjects', { count: fetched.length }) : t('taskReadDone', { count: fetched.length }), kind: 'ok' })
          const uncached = readDeps ? fetched.filter(file => !depsCacheRef.current.has(file.id)
            && !depsPrefetchRef.current.has(file.id)) : []
          if (uncached.length > 0) {
            const pending = prefetchDependencies(uncached, conn, readSchema)
            for (const file of uncached) depsPrefetchRef.current.set(file.id, pending)
            const clearPending = () => {
              for (const file of uncached) depsPrefetchRef.current.delete(file.id)
            }
            pending.then(clearPending, clearPending)
          }
        } catch (error) {
          const cancelled = operation.cancelled()
          const message = cancelled ? '' : describeReadError(error && error.message ? error.message : String(error))
          if (taskId !== '') {
            patchTask(taskId, {
              status: previousStatus,
              ...(cancelled ? {} : { lastReadError: message }),
              objectCount: countTaskObjects(taskId),
              updatedAt: Date.now(),
            })
          }
          if (cancelled) return
          setStatus({ text: message, kind: 'error' })
        } finally {
          clearInterval(progressTimer)
          setReading(false)
          operation.finish()
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
        if (editing && isTaskLocked(wizard.editingId)) return
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
        setExecFilter('all')
        setTargetConnId(task.targetId)
        setSchema(task.schema)
        setCompat(task.compat)
        setSourceConnId(task.origin === 'source' ? task.sourceId : '')
        if (task.readTypes.length > 0) setReadTypes(task.readTypes)
        if (task.origin === 'source') {
          commitFiles(list => (list.some(file => file.taskId === task.id)
            ? list
            : [...list, blankForTask(task, list)]))
        } else if (!files.some(file => file.taskId === taskId)) {
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
        const field = (label, control) => h('div', { className: 'hch-field' },
          h('span', { className: 'hch-fieldLabel' }, label),
          control)
        const modeCard = (mode, icon, title, hint) => h('button', {
          type: 'button',
          className: 'hch-modeCard',
          'data-active': wizard.mode === mode ? 'true' : undefined,
          onClick: () => setWizardMode(mode),
        },
        h('span', { className: 'hch-modeCardIcon' }, h(StudioIcon, { name: icon, size: 16 })),
        h('b', null, title),
        h('small', null, hint))
        const summaryRow = (label, value) => h('div', { className: 'hch-summaryRow' },
          h('span', { className: 'hch-summaryLabel' }, label),
          h('span', { className: 'hch-summaryValue', title: typeof value === 'string' ? value : undefined }, value))
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
            className: 'hch-input',
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
          field(t('taskOrigin'), h('div', { className: 'hch-modeGrid' },
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
              ? h('div', { className: 'hch-wizardInline' },
                h('span', null, t('taskNoSourceConn')),
                h('button', {
                  type: 'button',
                  className: 'hch-linkBtn',
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
                  wiz({
                    sourceId: next,
                    schema: wizard.schema.trim() === '' && picked !== undefined
                      ? (picked.schema || (picked.kind === 'mysql' ? picked.database : ''))
                      : wizard.schema,
                    readTypes: next === wizard.sourceId ? wizard.readTypes : allowed,
                  })
                },
              }))
            : null,
          field(t('taskTargetOptional'), targetConns.length === 0
            ? h('div', { className: 'hch-wizardInline' },
              h('span', null, t('taskNoTargetConn')),
              h('button', {
                type: 'button',
                className: 'hch-linkBtn',
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
            className: 'hch-input',
            type: 'text',
            value: wizard.schema,
            placeholder: t('schemaHint'),
            onChange: (event) => wiz({ schema: event.target.value }),
          })))
        const typesBody = h(React.Fragment, null,
          h('div', { className: 'hch-field' },
            h('span', { className: 'hch-fieldLabel' }, t('taskTypesTitle')),
            h('p', { className: 'hch-wizardHint' }, wizardIsMysql ? t('taskTypesHintMysql') : t('taskTypesHint'))),
          h('div', { className: 'hch-typeGrid' }, wizardTypes.map(type => h('label', {
            key: type,
            className: 'hch-typeTile',
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
          h('span', { className: 'hch-typeTileIcon' }, h(StudioIcon, { name: objectTypeIcon(type), size: 15 })),
          h('span', { className: 'hch-typeTileText' },
            h('b', null, typeLabel(type)),
            h('small', null, type))))),
          h('div', { className: 'hch-typeActions' },
            h('button', { type: 'button', className: 'hch-ctaSecondary', disabled: wizardTypes.every(type => wizard.readTypes.includes(type)), onClick: () => wiz({ readTypes: wizardTypes }) }, t('selectAll')),
            h('button', { type: 'button', className: 'hch-ctaSecondary', disabled: wizard.readTypes.length === 0, onClick: () => wiz({ readTypes: [] }) }, t('clearAll')),
            h('span', { className: 'hch-typeActionsCount' }, wizard.readTypes.length === 1 ? t('taskTypesOne') : t('taskTypesCount', { count: wizard.readTypes.length }))))
        const compatLockedMode = wizardTargetKind === '' ? '' : compatModeForKind(wizardTargetKind)
        const compatMode = compatLockedMode !== ''
          ? compatLockedMode
          : (COMPAT_MODES.includes(wizard.compatMode) ? wizard.compatMode : 'postgresql')
        const compatLocked = compatLockedMode !== ''
        const compatOption = (mode) => h('label', {
          key: mode,
          className: 'hch-compatOption',
          'data-checked': compatMode === mode ? 'true' : undefined,
          'data-disabled': compatLocked ? 'true' : undefined,
        },
        h('input', {
          type: 'radio',
          name: 'hch-compat-mode',
          value: mode,
          checked: compatMode === mode,
          disabled: compatLocked,
          onChange: () => wiz({ compatMode: mode }),
        }),
        h('span', { className: 'hch-compatText' },
          h('b', null, t(COMPAT_MODE_KEYS[mode])),
          h('small', null, t(`${COMPAT_MODE_KEYS[mode]}Hint`))))
        const compatBody = h(React.Fragment, null,
          wizardIsMysql && !compatLocked
            ? h('p', { className: 'hch-wizardHint' }, t('taskCompatMysqlNote'))
            : h('div', { className: 'hch-field' },
              h('span', { className: 'hch-fieldLabel' }, t('taskCompatModeTitle')),
              h('div', { className: 'hch-compatGrid', 'data-locked': compatLocked ? 'true' : undefined },
                COMPAT_MODES.map(compatOption)),
              h('p', { className: 'hch-wizardHint' }, compatLocked ? t('taskCompatLocked') : t('taskCompatUnlockedHint')),
              wizardIsMysql
                ? h('p', { className: 'hch-wizardHint' }, t('taskCompatMysqlNote'))
                : null),
          h('div', { className: 'hch-field' },
            h('span', { className: 'hch-fieldLabel' }, t('taskSummary')),
            h('div', { className: 'hch-summary' },
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
        return h('div', { className: 'hch-wizardOverlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('taskWizardTitle') },
          h('div', { className: 'hch-wizard' },
            h('header', { className: 'hch-wizardHead' },
              h('div', { className: 'hch-wizardHeading' },
                h('h2', { className: 'hch-wizardTitle' }, wizard.editingId === '' ? t('taskWizardTitle') : t('taskWizardEditTitle')),
                h('p', { className: 'hch-wizardSub' }, t('taskWizardSub'))),
              h('button', {
                type: 'button',
                className: 'hch-iconBtn',
                title: t('cancel'),
                onClick: closeWizard,
              }, h(StudioIcon, { name: 'close', size: 15 }))),
            h('div', { className: 'hch-wizardSteps' }, steps.map((label, index) => h('div', {
              key: label,
              className: 'hch-wizardStep',
              'data-state': index < step ? 'done' : index === step ? 'active' : 'todo',
            },
            h('span', { className: 'hch-wizardStepNo' }, index < step ? '\u2713' : String(index + 1)),
            h('span', { className: 'hch-wizardStepLabel' }, label),
            index < lastStep ? h('span', { className: 'hch-wizardStepLine' }) : null))),
            h('div', { className: 'hch-wizardBody' }, body),
            h('footer', { className: 'hch-wizardFoot' },
              wizard.error === '' ? h('span', { className: 'hch-wizardFootHint' }) : h('span', { className: 'hch-wizardError', role: 'alert' }, wizard.error),
              h('button', { type: 'button', className: 'hch-ctaSecondary', onClick: closeWizard }, t('cancel')),
              step > 0
                ? h('button', { type: 'button', className: 'hch-ctaSecondary', onClick: wizardBack }, t('taskBack'))
                : null,
              step < lastStep
                ? h('button', { type: 'button', className: 'hch-ctaPrimary', onClick: wizardNext }, t('taskNext'))
                : h('button', { type: 'button', className: 'hch-ctaPrimary', onClick: saveWizardTask }, wizard.editingId === '' ? t('taskSave') : t('taskSaveEdit'))),
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
      /** 任务级转换报告：对象明细 + 规则汇总 + 风险 + 执行结果，便于交给客户/评审。 */
      const taskReportFiles = () => files
        .filter(file => activeTask !== undefined && file.taskId === activeTask.id && !isPlaceholderFile(file))
        .sort((a, b) => a.name.localeCompare(b.name))
      const reportSummaryOf = () => {
        const list = taskReportFiles()
        const converted = list.filter(file => file.status === 'ok').length
        const convertFailed = list.filter(file => file.status === 'error').length
        const execOk = list.filter(file => file.execStatus === 'ok').length
        const execFailed = list.filter(file => file.execStatus === 'error').length
        const execPending = hasTarget ? list.length - execOk - execFailed : 0
        const riskFiles = list.filter(file => Array.isArray(file.warnings) && file.warnings.length > 0).length
        const ruleHits = list.reduce((sum, file) => sum + (Array.isArray(file.applied) ? file.applied.reduce((inner, item) => inner + (Number(item.count) || 0), 0) : 0), 0)
        return { list, converted, convertFailed, execOk, execFailed, execPending, riskFiles, ruleHits }
      }
      const buildReportMarkdown = () => {
        const summary = reportSummaryOf()
        const taskName = activeTask === undefined ? t('reportUntitledTask') : activeTask.name
        const sourceConn = connections.find(conn => conn.id === (activeTask === undefined ? '' : activeTask.sourceId))
        const lines = []
        lines.push(t('reportTitle', { name: taskName }))
        lines.push('')
        lines.push(t('reportGeneratedAt', { time: new Date().toLocaleString() }))
        lines.push(t('reportSourceLine', {
          value: sourceConn === undefined
            ? t('reportLocalSql')
            : `${sourceConn.name} (${connKindLabel(sourceConn.kind)})`,
        }))
        lines.push(t('reportTargetLine', {
          value: targetConn === undefined
            ? t('reportUnset')
            : `${targetConn.name} (${connKindLabel(targetConn.kind)})`,
        }))
        lines.push(t('reportSchemaLine', {
          value: (activeTask === undefined ? '' : activeTask.schema) || t('reportSchemaDefault'),
        }))
        lines.push(t('reportCompatLine', {
          value: t(COMPAT_MODE_KEYS[activeTask === undefined ? 'postgresql' : taskCompatMode(activeTask)]),
        }))
        lines.push('')
        lines.push(t('reportOverview'))
        lines.push('')
        lines.push(t('reportMetricHead'))
        lines.push(`| --- | --- |`)
        lines.push(t('reportMetricObjects', { value: summary.list.length }))
        lines.push(t('reportMetricConverted', { value: summary.converted }))
        lines.push(t('reportMetricConvertFailed', { value: summary.convertFailed }))
        lines.push(t('reportMetricRuleHits', { value: summary.ruleHits }))
        lines.push(t('reportMetricRiskObjects', { value: summary.riskFiles }))
        lines.push(t('reportMetricExecOk', { value: summary.execOk }))
        lines.push(t('reportMetricExecFailed', { value: summary.execFailed }))
        lines.push(hasTarget
          ? t('reportMetricNotExec', { value: summary.execPending })
          : t('reportMetricNotExecRow'))
        lines.push('')
        lines.push(t('reportObjectsHead'))
        lines.push('')
        lines.push(t('reportObjectsCols'))
        lines.push('| --- | --- | --- | --- | --- | --- |')
        for (const file of summary.list) {
          const convState = file.status === 'ok' ? t('reportOk')
            : file.status === 'error' ? t('reportFail')
              : t('reportNotConverted')
          const execState = file.execStatus === 'ok' ? t('reportExecOk')
            : file.execStatus === 'error' ? t('reportExecFail')
              : t('reportNotExec')
          const ruleCount = Array.isArray(file.applied)
            ? file.applied.reduce((sum, item) => sum + (Number(item.count) || 0), 0)
            : 0
          const risks = Array.isArray(file.warnings) ? file.warnings.length : 0
          lines.push(`| ${file.name} | ${file.objType || t('reportCellNone')} | ${convState} | ${ruleCount} | ${risks} | ${execState} |`)
        }
        lines.push('')
        const ruleRows = summary.list.filter(file => Array.isArray(file.applied) && file.applied.length > 0)
        if (ruleRows.length > 0) {
          lines.push(t('reportRulesHead'))
          lines.push('')
          lines.push(t('reportRulesCols'))
          lines.push('| --- | --- | --- |')
          for (const file of ruleRows) {
            for (const item of file.applied) {
              lines.push(`| ${file.name} | ${ruleInfo(item.id, lang).label} | ${item.count} |`)
            }
          }
          lines.push('')
        }
        const riskRows = summary.list.filter(file => Array.isArray(file.warnings) && file.warnings.length > 0)
        if (riskRows.length > 0) {
          lines.push(t('reportRisksHead'))
          lines.push('')
          lines.push(t('reportRisksCols'))
          lines.push('| --- | --- | --- |')
          for (const file of riskRows) {
            for (const id of file.warnings) {
              lines.push(`| ${file.name} | ${ruleInfo(id, lang).label} | 1 |`)
            }
          }
          lines.push('')
        }
        const failedExec = summary.list.filter(file => file.execStatus === 'error')
        if (failedExec.length > 0) {
          lines.push(t('reportExecFailHead'))
          lines.push('')
          for (const file of failedExec) {
            lines.push(`### ${file.name}`)
            lines.push('')
            lines.push(t('reportErrorLine', { detail: file.execNote || t('reportUnknownError') }))
            lines.push(t('reportTimeLine', { time: file.execAt === undefined ? t('reportCellNone') : new Date(file.execAt).toLocaleString() }))
            lines.push('')
          }
        }
        return lines.join('\n')
      }
      const reportTable = () => {
        const summary = reportSummaryOf()
        const head = [
          t('reportObject'),
          t('reportType'),
          t('reportState'),
          t('reportRuleHits'),
          t('reportRuleDetail'),
          t('reportRisks'),
          t('reportExecState'),
          t('reportExecError'),
        ]
        const rows = []
        for (const file of summary.list) {
          const convState = file.status === 'ok' ? t('reportOk')
            : file.status === 'error' ? t('reportFail')
              : t('reportNotConverted')
          const execState = file.execStatus === 'ok' ? t('reportExecOk')
            : file.execStatus === 'error' ? t('reportExecFail')
              : t('reportNotExec')
          rows.push([
            file.name,
            file.objType || '',
            convState,
            Array.isArray(file.applied) ? file.applied.reduce((sum, item) => sum + (Number(item.count) || 0), 0) : 0,
            Array.isArray(file.applied) ? file.applied.map(item => `${ruleInfo(item.id, lang).label} x${item.count}`).join('; ') : '',
            Array.isArray(file.warnings) ? file.warnings.map(id => ruleInfo(id, lang).label).join('; ') : '',
            execState,
            file.execNote || '',
          ])
        }
        return { head, rows }
      }
      const buildReportCsv = () => {
        const { head, rows } = reportTable()
        const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`
        return '\ufeff' + [head, ...rows].map(row => row.map(escape).join(',')).join('\r\n')
      }
      const buildReportHtml = () => {
        const { head, rows } = reportTable()
        const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[char]))
        const title = escape(t('reportTitle', { name: activeTask.name }).replace(/^#\s*/, ''))
        const headings = head.map(value => `<th scope="col">${escape(value)}</th>`).join('')
        const body = rows.map(row => `<tr>${row.map(value => `<td>${escape(value)}</td>`).join('')}</tr>`).join('\n')
        return `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;color:#172554;margin:32px}
div{overflow:auto}table{border-collapse:collapse;width:100%}
th,td{padding:8px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #dbe4f0}
th{background:#eff6ff}td{white-space:pre-wrap;overflow-wrap:anywhere}
</style>
<h1>${title}</h1>
<p>${escape(t('reportGeneratedAt', { time: new Date().toLocaleString() }))}</p>
<div><table><thead><tr>${headings}</tr></thead><tbody>${body}</tbody></table></div>
</html>`
      }
      const exportReport = (format) => {
        if (activeTask === undefined) return
        const base = (activeTask.name || 'conversion').replace(/[\\/:*?"<>|]/g, '_')
        const formats = {
          md: [buildReportMarkdown, 'text/markdown'],
          csv: [buildReportCsv, 'text/csv'],
          html: [buildReportHtml, 'text/html'],
        }
        const [build, mime] = formats[format]
        const name = `${base}-report.${format}`
        saveBlob(new Blob([build()], { type: `${mime};charset=utf-8` }), name)
        setStatus({ text: t('reportDone', { name }), kind: 'ok' })
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
      const resultDialect = targetConnForConvert === undefined
        ? (activeTask === undefined ? (compat ? 'oracle' : 'postgresql') : taskCompatMode(activeTask))
        : compatModeForKind(targetConnForConvert.kind)
      const conversionTarget = resultDialect === 'mysql' ? 'mysql' : 'pg'
      const conversionCompat = resultDialect === 'oracle'
      const convertFiles = async (list) => {
        if (reading) return
        const targets = list.filter(file => file.sql.trim() !== '')
        if (targets.length === 0) {
          setStatus({ text: t('needInput'), kind: 'error' })
          return
        }
        if (busy !== null || jobRef.current !== null) return
        const startedAll = Date.now()
        setBusy({ fileId: targets[0].id, seconds: 0 })
        setStatus({ text: '', kind: '' })
        const operation = startInterruptibleJob('convert', {
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
            if (operation.cancelled()) return
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
                const local = convertLocally(file.sql, { compat: conversionCompat, engine: fileEngine(file), drop: dropStatements, cascade: dropCascade, target: conversionTarget, autonomousMessage: t('pgAutonomousUnsupported') })
                const requiresRewrite = !conversionCompat && conversionTarget !== 'mysql' && local.warnings.includes('needsAgent')
                if (local.unsupported === true || requiresRewrite) {
                  patches.set(file.id, {
                    result: local.text,
                    status: 'error',
                    note: t(requiresRewrite ? 'warn.needsAgent' : 'mysqlRoutineNeedsAi'),
                    applied: local.applied,
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
                  aiConverted: false,
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
              ? applyConversionResult(file, patches.get(file.id))
              : file)))
            updateJob({ done: ok + failed })
          }
        } finally {
          setBusy(null)
          operation.finish()
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
      const canExecuteResult = (file) => file.status !== 'error' && file.result.trim() !== ''
        && (conversionCompat || conversionTarget === 'mysql' || file.aiConverted === true || !file.warnings?.includes('needsAgent'))
      const failedExecutionFiles = visible.filter(file => file.execStatus === 'error' && canExecuteResult(file))
      const executeFiles = async (list) => {
        if (executing || jobRef.current !== null) return
        if (activeTask === undefined) {
          setStatus({ text: t('execNeedsTask'), kind: 'error' })
          return
        }
        const conn = connections.find(item => item.id === targetConnId)
        if (conn === undefined) {
          setStatus({ text: t('execMissing'), kind: 'error' })
          return
        }
        const targets = list.filter(canExecuteResult)
        const autonomousFile = compatModeForKind(conn.kind) === 'postgresql' && targets.find(file =>
          hasOracleAutonomousTransaction(file.sql) || hasOracleAutonomousTransaction(file.result))
        if (autonomousFile) {
          setStatus({ text: `${autonomousFile.name} · ${t('pgAutonomousUnsupported')}`, kind: 'error' })
          return
        }
        if (targets.length === 0) {
          setStatus({ text: t('execNoSql'), kind: 'error' })
          return
        }
        // 依赖顺序：被依赖的对象先建；DROP 阶段反过来（依赖方先删），避免级联删除丢对象
        const depsOfFile = (file) => {
          const cached = depsCacheRef.current.get(file.id)
          const declared = dependencyRefsOf(file.result).map(item => item.name)
          return [...declared, ...(cached?.items.map(item => item.name) ?? [])]
        }
        const sequence = planDependencyOrder(targets, depsOfFile)
        const orderedDrops = dropStatements && targets.every(file => depsCacheRef.current.has(file.id))
        const execSqlById = new Map()
        const dropById = new Map()
        for (const file of orderedDrops ? sequence : []) {
          const split = dropPreambleOf(file.result)
          if (split.drops.length > 0) {
            dropById.set(file.id, split.drops.map(sql => sql.replace(/\s+CASCADE(?=\s*;\s*$)/i, '')).join('\n'))
          }
          execSqlById.set(file.id, split.rest)
        }
        const execSqlFor = (file) => {
          const stripped = execSqlById.get(file.id)
          return stripped === undefined ? file.result : stripped
        }
        const schemaPrefix = schema.trim() === ''
          ? ''
          : `CREATE SCHEMA IF NOT EXISTS ${sqlIdent(schema.trim())};\nSET search_path TO ${sqlIdent(schema.trim())};\n`
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
        const errorsByFile = new Map()
        /** 批量执行：一次 JVM、一次连接跑完一个分片，避免每个对象都重新启动与登录。 */
        /** Host 是否已提供批量路由；旧 Host 会返回 404，此时自动退回逐个执行。 */
        let batchAvailable = true
        const runOneFile = async (file) => {
          const controller = typeof AbortController === 'function' ? new AbortController() : null
          executeAbortRef.current = controller
          try {
            const response = await fetch('/api/hgdb-convert-studio/execute', {
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
                sql: `${schemaPrefix}${execSqlFor(file)}`,
              }),
            })
            if (response.status === 404) return { ok: false, error: t('execHostStale') }
            const value = await response.json().catch(() => ({}))
            if (response.ok && value.ok === true) return { ok: true, error: '' }
            const output = typeof value.output === 'string' ? value.output : ''
            const errorLine = output.split('\n').find(line => line.includes('ERROR')) ?? output.split('\n').find(line => line.trim() !== '')
            return { ok: false, error: (errorLine && errorLine.trim()) || (value && value.message) || `HTTP ${response.status}` }
          } catch (error) {
            return { ok: false, error: error && error.message ? error.message : String(error) }
          }
        }
        const runChunk = async (chunk) => {
          if (batchAvailable === false) {
            const outcomes = []
            for (const file of chunk) {
              setExecFileId(file.id)
              outcomes.push(await runOneFile(file))
            }
            return outcomes
          }
          const controller = typeof AbortController === 'function' ? new AbortController() : null
          executeAbortRef.current = controller
          try {
            const response = await fetch('/api/hgdb-convert-studio/execute-batch', {
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
                schema: schema.trim(),
                jobId: executeJobId,
                items: chunk.map(file => ({ id: file.id, sql: execSqlFor(file) })),
              }),
            })
            // Host 还是旧版本（没有批量路由）：退回逐个执行，功能不受影响，只是慢一些。
            if (response.status === 404) {
              batchAvailable = false
              const outcomes = []
              for (const file of chunk) {
                setExecFileId(file.id)
                outcomes.push(await runOneFile(file))
              }
              return outcomes
            }
            const value = await response.json().catch(() => ({}))
            const results = Array.isArray(value.results) ? value.results : []
            const byId = new Map()
            for (const item of results) {
              if (item !== null && typeof item === 'object' && typeof item.id === 'string') {
                byId.set(item.id, { ok: item.ok === true, error: typeof item.error === 'string' ? item.error : '' })
              }
            }
            return chunk.map((file) => {
              const found = byId.get(file.id)
              if (found !== undefined) return found
              return {
                ok: false,
                error: (value && typeof value.message === 'string' ? value.message : '') || `HTTP ${response.status}`,
              }
            })
          } catch (error) {
            const message = error && error.message ? error.message : String(error)
            return chunk.map(() => ({ ok: false, error: message }))
          }
        }
        /** 只跑 SQL、不更新对象执行状态（用于“先批量删”阶段）。 */
        const runSqlEntries = async (entries) => {
          if (entries.length === 0) return
          const controller = typeof AbortController === 'function' ? new AbortController() : null
          executeAbortRef.current = controller
          try {
            const response = await fetch('/api/hgdb-convert-studio/execute-batch', {
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
                schema: schema.trim(),
                jobId: executeJobId,
                items: entries,
              }),
            })
            if (response.status === 404) {
              // 旧 Host：逐个执行删除语句
              for (const entry of entries) {
                await fetch('/api/hgdb-convert-studio/execute', {
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
                    jobId: executeJobId,
                    sql: entry.sql,
                  }),
                }).catch(() => null)
              }
            }
          } catch {
            /* 删除阶段失败不阻断创建：创建时会再报具体错误 */
          }
        }
        const saveOutcomes = (patches) => {
          const updatedAt = Date.now()
          commitFiles(files => files.map(file => patches.has(file.id)
            ? { ...file, ...patches.get(file.id), updatedAt }
            : file))
        }
        const failedFiles = []
        const CHUNK = 80
        /** 批量执行时无法逐条回报进度：先把整批标成“执行中”，否则只有第一个会变色。 */
        const markRunning = (chunk) => {
          const ids = new Set(chunk.map(file => file.id))
          commitFiles(list => list.map(file => (ids.has(file.id)
            ? { ...file, execStatus: 'running', execNote: '' }
            : file)))
        }
        // 先批量删（依赖方 → 被依赖方），再按正序批量建：不需要 CASCADE 也不会冲突
        if (dropById.size > 0) {
          const dropEntries = [...sequence]
            .reverse()
            .filter(file => dropById.has(file.id))
            .map(file => ({
              id: file.id,
              // 已经按依赖倒序删除，这里去掉 CASCADE，避免误删依赖它的对象
              sql: `${schemaPrefix}${dropById.get(file.id)}`,
            }))
          if (dropEntries.length > 0) {
            setStatus({ text: t('execDropping', { count: dropEntries.length }), kind: '' })
            for (let index = 0; index < dropEntries.length; index += CHUNK) {
              if (cancelRequested()) {
                cancelRef.current = true
                break
              }
              const chunk = dropEntries.slice(index, index + CHUNK)
              await runSqlEntries(chunk)
            }
          }
        }
        for (let index = 0; index < sequence.length; index += CHUNK) {
          if (cancelRequested()) {
            cancelRef.current = true
            break
          }
          const chunk = sequence.slice(index, index + CHUNK)
          setExecFileId(chunk[0].id)
          markRunning(chunk)
          const outcomes = await runChunk(chunk)
          if (runId !== executeRunRef.current) return
          if (cancelRequested()) {
            cancelRef.current = true
            break
          }
          const patches = new Map()
          chunk.forEach((file, position) => {
            const outcome = outcomes[position] ?? { ok: false, error: '' }
            patches.set(file.id, {
              execStatus: outcome.ok ? 'ok' : 'error',
              execNote: outcome.ok ? '' : describeExecError(outcome.error),
              execAt: Date.now(),
            })
            executed += 1
            if (outcome.ok) ok += 1
            else {
              failed += 1
              failedFiles.push(file)
              errorsByFile.set(file.id, describeExecError(outcome.error))
            }
          })
          saveOutcomes(patches)
          updateJob({ done: executed })
        }
        // 失败对象再批量重跑一次：多半是对象间依赖顺序问题，第二次通常能通过。
        if (failedFiles.length > 0 && !cancelRequested()) {
          for (let index = 0; index < failedFiles.length; index += CHUNK) {
            if (cancelRequested()) {
              cancelRef.current = true
              break
            }
            const chunk = failedFiles.slice(index, index + CHUNK)
            setExecFileId(chunk[0].id)
            markRunning(chunk)
            const outcomes = await runChunk(chunk)
            if (runId !== executeRunRef.current) return
            if (cancelRequested()) {
              cancelRef.current = true
              break
            }
            const patches = new Map()
            chunk.forEach((file, position) => {
              const outcome = outcomes[position] ?? { ok: false, error: '' }
              const patch = {
                execStatus: outcome.ok ? 'ok' : 'error',
                execNote: outcome.ok ? '' : describeExecError(outcome.error),
                execAt: Date.now(),
              }
              patches.set(file.id, patch)
              if (outcome.ok) {
                ok += 1
                failed -= 1
                errorsByFile.delete(file.id)
              } else {
                errorsByFile.set(file.id, describeExecError(outcome.error))
              }
            })
            saveOutcomes(patches)
            updateJob({ done: executed })
          }
        }
        if (runId !== executeRunRef.current) return
        const stopped = cancelRef.current
        if (stopped) clearInterruptedExecution(activeTaskId)
        cancelRef.current = false
        executeJobIdRef.current = ''
        executeAbortRef.current = null
        setExecuting(false)
        setExecFileId('')
        endJob()
        const firstError = errorsByFile.values().next().value ?? ''
        setStatus(stopped
          ? { text: t('jobStopped'), kind: '' }
          : {
            text: `${t('execDone')} ${ok} / ${failed}${firstError === '' ? '' : ` \u00b7 ${firstError}`}`,
            kind: failed > 0 ? 'error' : 'ok',
          })
      }

      const deepConvert = () => {
        if (busy !== null || jobRef.current !== null || active.sql.trim() === '') return
        if (!conversionCompat && conversionTarget !== 'mysql' && hasOracleAutonomousTransaction(active.sql)) {
          const message = t('pgAutonomousUnsupported')
          saveFileConversion(active.id, { status: 'error', note: message, applied: [], warnings: [], convertedAt: Date.now(), updatedAt: Date.now() })
          setStatus({ text: message, kind: 'error' })
          return
        }
        const fileId = active.id
        const startedAt = Date.now()
        setBusy({ fileId, seconds: 0 })
        setStatus({ text: '', kind: '' })
        const operation = startInterruptibleJob('convert', { taskId: activeTaskId, total: 1, label: active.name })
        const engineOfActive = fileEngine(active)
        const prompt = buildSinglePrompt({ sql: active.sql, objectType: 'auto', schema, compat: conversionCompat, engine: engineOfActive, drop: dropStatements, target: conversionTarget })
        operation.wait(convert(prompt, workspaceId, fileId, operation.signal)).then((outcome) => {
          if (operation.cancelled()) return
          if (outcome && outcome.ok) {
            const converted = onlineConversionResult(outcome.text, {
              compat: engineOfActive === 'mysql' ? false : conversionCompat,
              sourceSql: active.sql,
              autonomousMessage: t('pgAutonomousUnsupported'),
              packageMessage: t('pgPackageNeedsRewrite'),
              drop: dropStatements,
              cascade: dropCascade,
              target: conversionTarget,
            })
            const patch = {
              result: converted.text,
              status: 'ok',
              note: '',
              aiConverted: true,
              applied: [],
              warnings: (engineOfActive === 'mysql' ? MYSQL_WARNINGS : LOCAL_WARNINGS)
                .filter(warning => warning.pattern !== null && warning.pattern.test(converted.text))
                .map(warning => warning.id),
              durationMs: Date.now() - startedAt,
              convertedAt: Date.now(),
              updatedAt: Date.now(),
            }
            saveFileConversion(fileId, patch)
            setStatus({ text: converted.keptSource ? t('onlineCompatKept') : t('convertDone'), kind: 'ok' })
            return
          }
          const failPatch = {
            result: '',
            status: 'error',
            note: (outcome && outcome.message) || t('convertFailed'),
            applied: [],
            warnings: [],
            durationMs: Date.now() - startedAt,
            convertedAt: Date.now(),
            updatedAt: Date.now(),
          }
          saveFileConversion(fileId, failPatch)
          setStatus({ text: (outcome && outcome.message) || t('convertFailed'), kind: 'error' })
        }).catch((error) => {
          if (operation.cancelled()) return
          const message = error && error.message ? error.message : String(error)
          saveFileConversion(fileId, { status: 'error', note: message, applied: [], warnings: [], convertedAt: Date.now(), updatedAt: Date.now() })
          setStatus({ text: message, kind: 'error' })
        }).finally(() => {
          clearInflight()
          setBusy(null)
          operation.finish()
        })
      }

      React.useEffect(() => {
        if (resumedRef.current) return
        const inflight = inflightState()
        if (inflight === undefined) return
        resumedRef.current = true
        const target = files.find(file => file.id === inflight.fileId) ?? files[0]
        const operation = startInterruptibleJob('convert', { taskId: target.taskId, total: 1, label: target.name })
        operation.signal.addEventListener('abort', () => {
          Promise.resolve(archiveOne(inflight.sessionId)).catch(() => {})
        }, { once: true })
        setBusy({ fileId: target.id, seconds: 0 })
        operation.wait(collect(inflight.sessionId, operation.signal)).then((outcome) => {
          if (operation.cancelled()) return
          if (outcome && outcome.ok) {
            const resumeEngine = fileEngine(target)
            const converted = onlineConversionResult(outcome.text, {
              compat: resumeEngine === 'mysql' ? false : conversionCompat,
              sourceSql: target.sql,
              autonomousMessage: t('pgAutonomousUnsupported'),
              packageMessage: t('pgPackageNeedsRewrite'),
              drop: dropStatements,
              cascade: dropCascade,
              target: conversionTarget,
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
            saveFileConversion(target.id, { ...patch, aiConverted: true })
          } else {
            const patch = { status: 'error', note: (outcome && outcome.message) || '', convertedAt: Date.now(), updatedAt: Date.now() }
            saveFileConversion(target.id, patch)
          }
        }).catch(error => {
          if (operation.cancelled()) return
          const message = error && error.message ? error.message : String(error)
          saveFileConversion(target.id, { status: 'error', note: message, applied: [], warnings: [], convertedAt: Date.now(), updatedAt: Date.now() })
        }).finally(() => {
          clearInflight()
          setBusy(null)
          operation.finish()
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
        const startedAt = Date.now()
        // 前端兜底超时：Host 卡住时不至于一直转圈
        const controller = typeof AbortController === 'function' ? new AbortController() : null
        const guard = setTimeout(() => {
          if (controller !== null) controller.abort()
        }, 45000)
        try {
          const response = await fetch('/api/hgdb-convert-studio/test', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            signal: controller === null ? undefined : controller.signal,
            body: JSON.stringify({
              kind: connDraft.kind,
              host: connDraft.host,
              port: Number(connDraft.port),
              database: connDraft.database,
              schema: connDraft.schema ?? '',
              user: connDraft.user,
              password: connDraft.password ?? '',
            }),
          })
          const value = await response.json().catch(() => ({}))
          if (!response.ok || value.ok !== true) {
            const rawMessage = describeConnTestMessage((value && value.message) || `HTTP ${response.status}`)
            // 旧 Host 不认识 MySQL / HGDB-V9-MySQL 类型，会退回 PostgreSQL 驱动并报协议错误。
            const staleHost = (connDraft.kind === 'mysql' || connDraft.kind === 'hgdb-mysql')
              && /PSQLException|org\.postgresql|postgresql\.util/i.test(String(rawMessage))
            setConnTest({
              busy: false,
              kind: 'error',
              text: staleHost
                ? '连接测试用到了 PostgreSQL 驱动：Host 侧插件仍是旧版本。请完全退出并重启 DSH（只刷新页面不够），重新打开后再测试连接。'
                : `${rawMessage}\n目标：${connDraft.kind} · ${connDraft.host}:${connDraft.port}\nHost 版本：${typeof value.version === 'string' && value.version !== '' ? value.version : '未知'}`,
            })
            return
          }
          const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
          setConnTest({
            busy: false,
            kind: 'ok',
            text: `OK${value.message ? ` ${value.message}` : ''}${t('connTestElapsed', { seconds: elapsed })}`,
          })
        } catch (error) {
          const aborted = error && (error.name === 'AbortError' || /aborted/i.test(String(error.message)))
          setConnTest({
            busy: false,
            kind: 'error',
            text: aborted
              ? t('connTestFrontTimeout')
              : (error && error.message ? error.message : String(error)),
          })
        } finally {
          clearTimeout(guard)
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
      const connField = (id, label, control) => h('div', { className: 'hcs-connField' },
        h('label', { className: 'hcs-label', htmlFor: id }, label),
        control)
      const connRow = (conn) => h('div', { key: conn.id, className: 'hcs-conn hch-connRow' },
        h('div', { className: 'hcs-connMain' },
          h('span', { className: 'hcs-connName' }, conn.name),
          h('span', { className: 'hcs-connMeta' }, `${connKindLabel(conn.kind)} \u00b7 ${conn.host}:${conn.port}/${conn.database}`),
          conn.schema ? h('span', { className: 'hcs-connMeta' }, `schema: ${conn.schema}`) : null),
        h('div', { className: 'hcs-connActions' },
          h('button', {
            type: 'button',
            className: 'hcs-ghost',
            disabled: !connectionsReady,
            onClick: () => {
              setConnSide(isSourceKind(conn.kind) ? 'source' : 'target')
              setConnTest(null)
              setShowPassword(false)
              setConnDraft({ ...conn })
            },
          }, t('connEdit')),
          h('button', { type: 'button', className: 'hcs-ghost', onClick: () => removeConn(conn.id) }, t('connDelete'))))
      const emptyColumn = (text) => h('p', { className: 'hch-connEmptyCol' }, text)
      const connColumn = (side, title, hint, icon, items) => h('section', {
        className: 'hch-card hch-connColumn',
        'data-side': side,
      },
      h('div', { className: 'hch-connColumnHead' },
        h('div', { className: 'hch-connColumnTitle' },
          h(StudioIcon, { name: icon, size: 15 }),
          h('b', null, title),
          h('span', { className: 'hch-connCount' }, String(items.length))),
        h('button', {
          type: 'button',
          className: 'hch-ctaSecondary hch-connAddBtn',
          onClick: () => startNewConn(side),
        }, h(StudioIcon, { name: 'plus', size: 12 }), t('connAdd'))),
      h('p', { className: 'hch-connColumnHint' }, hint),
      h('div', { className: 'hch-connColumnBody' },
        items.length === 0
          ? emptyColumn(side === 'source' ? t('connEmptySource') : t('connEmptyTarget'))
          : items.map(connRow)))
      const sourceConnections = connections.filter(conn => isSourceKind(conn.kind))
      const targetConnections = connections.filter(conn => isTargetKind(conn.kind))
      const connectionsBody = h('div', { className: 'hch-connGrid' },
        connColumn('source', t('connSourceTitle'), t('connSourceHint'), 'download', sourceConnections),
        connColumn('target', t('connTargetTitle'), t('connTargetHint'), 'play', targetConnections))
      const passwordTyping = connDraft !== null
        && connDraft.passwordSaved !== true
        && (connDraft.password ?? '') !== ''
      const mysqlConnection = connDraft !== null && (connDraft.kind === 'mysql' || connDraft.kind === 'hgdb-mysql')
      const connFields = connDraft === null ? null : h(React.Fragment, null,
        h('div', { className: 'hcs-connRow' },
          connField('conn-name', t('connName'), h('input', {
            id: 'conn-name', className: 'hcs-input', type: 'text', value: connDraft.name,
            onChange: (event) => setConnDraft({ ...connDraft, name: event.target.value }),
          })),
          connField('conn-kind', t('connKind'), h(StudioSelect, {
            id: 'conn-kind',
            className: 'hcs-select',
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
        h('div', { className: 'hcs-connRow' },
          connField('conn-host', t('connHost'), h('input', {
            id: 'conn-host', className: 'hcs-input', type: 'text', value: connDraft.host,
            onChange: (event) => setConnDraft({ ...connDraft, host: event.target.value }),
          })),
          connField('conn-port', t('connPort'), h('input', {
            id: 'conn-port', className: 'hcs-input', type: 'text', value: connDraft.port,
            onChange: (event) => setConnDraft({ ...connDraft, port: event.target.value }),
          }))),
        h('div', { className: `hcs-connRow${mysqlConnection ? ' hcs-connRowSingle' : ''}` },
          connField('conn-database', connDraft.kind === 'hgdb-mysql' ? t('connSchemaForMysql') : t('connDatabase'), h('input', {
            id: 'conn-database', className: 'hcs-input', type: 'text', value: connDraft.database,
            onChange: (event) => setConnDraft({ ...connDraft, database: event.target.value }),
          })),
          mysqlConnection
            ? null
            : connField('conn-schema', t('connSchema'), h('input', {
              id: 'conn-schema', className: 'hcs-input', type: 'text', value: connDraft.schema,
              placeholder: connDraft.kind === 'oracle' || connDraft.kind === 'hgdb-oracle' ? t('connSchemaOwnerPlaceholder') : t('connSchemaPlaceholder'),
              onChange: (event) => setConnDraft({ ...connDraft, schema: event.target.value }),
            }))),
        h('div', { className: 'hcs-connRow' },
          connField('conn-user', t('connUser'), h('input', {
            id: 'conn-user', className: 'hcs-input', type: 'text', value: connDraft.user,
            onChange: (event) => setConnDraft({ ...connDraft, user: event.target.value }),
          })),
          connField('conn-password', t('connPassword'), h('div', null,
            h('div', { className: 'hcs-passwordWrap' },
              h('input', {
                id: 'conn-password',
                className: `hcs-input${passwordTyping ? ' hcs-passwordInput' : ''}`,
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
                  className: 'hcs-eyeBtn',
                  title: showPassword ? t('hidePassword') : t('showPassword'),
                  'aria-label': showPassword ? t('hidePassword') : t('showPassword'),
                  'aria-pressed': showPassword ? 'true' : 'false',
                  onClick: () => setShowPassword(current => !current),
                }, h(StudioIcon, { name: showPassword ? 'eyeOff' : 'eye', size: 15 }))
                : null),
            connDraft.passwordUnreadable
              ? h('p', { className: 'hcs-connNote' }, t('passwordUnreadable'))
              : null))))
      const closeConn = () => {
        setConnDraft(null)
        setConnTest(null)
        setShowPassword(false)
      }
      // 测试结果用悬浮提示展示，几秒后自动消失。
      React.useEffect(() => {
        if (connTest === null || connTest.busy === true) return undefined
        const timer = setTimeout(() => setConnTest(null), connTest.kind === 'ok' ? 5000 : 9000)
        return () => clearTimeout(timer)
      }, [connTest])
      const connEditing = connDraft !== null && connections.some(item => item.id === connDraft.id)
      const connDialogTitle = `${connEditing ? t('connEditTitle') : t('connAdd')} · ${connSide === 'source' ? t('connSourceTitle') : t('connTargetTitle')}`
      const connDialog = connDraft === null ? null : renderOverlay(h('div', {
        className: 'hch-wizardOverlay hcs-connOverlay',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': connDialogTitle,
      },
      h('div', { className: 'hch-wizard hcs-connDialog' },
        h('header', { className: 'hch-wizardHead' },
          h('div', { className: 'hch-wizardHeading' },
            h('h2', { className: 'hch-wizardTitle' }, connDialogTitle),
            h('p', { className: 'hch-wizardSub' }, t('connDialogSub'))),
          h('button', {
            type: 'button',
            className: 'hch-iconBtn',
            title: t('cancel'),
            onClick: closeConn,
          }, h(StudioIcon, { name: 'close', size: 15 }))),
        connTest !== null && connTest.busy !== true
          ? h('div', {
            className: 'hch-connToast',
            'data-kind': connTest.kind,
            role: 'status',
            title: connTest.text,
          },
          h(StudioIcon, { name: connTest.kind === 'ok' ? 'check' : 'alert', size: 14 }),
          h('span', { className: 'hch-connToastText' }, connTest.text.split('\n').filter(line => line.trim() !== '').join('\n').slice(0, 600)))
          : null,
        h('div', { className: 'hch-wizardBody hcs-connDialogBody' },
          connFields),
        h('div', { className: 'hch-wizardFoot' },
          h('button', {
            type: 'button',
            className: `hch-ctaSecondary${connTest !== null && connTest.busy === true ? ' hcs-btnBusy' : ''}`,
            disabled: connTest !== null && connTest.busy === true,
            onClick: testConn,
          }, connTest !== null && connTest.busy === true ? t('connTesting') : t('connTest')),
          h('span', { className: 'hch-wizardFootHint' }),
          h('button', { type: 'button', className: 'hch-ctaSecondary', onClick: closeConn }, t('connCancel')),
          h('button', { type: 'button', className: 'hch-ctaPrimary', onClick: saveConn }, t('connSave'))))), theme)

      const connectionsPage = h('div', { className: 'hch hch-connPage' },
        h('main', { className: 'hch-scroll' },
          h('div', { className: 'hch-inner hch-connInner' },
            h('header', { className: 'hch-connHero' },
              h('div', { className: 'hch-connHeroRow' },
                h('div', { className: 'hch-connHeroText' },
                  h('h1', { className: 'hch-connTitle' }, t('connectionsTitle')),
                  h('p', { className: 'hch-connDesc' }, t('connectionsPageDesc'))))),
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
        if (jobRef.current !== null) return
        for (const file of filesRef.current) {
          if (file.origin === 'source') depsCacheRef.current.delete(file.id)
        }
        saveDepsCache(depsCacheRef.current)
        commitFiles(list => list.filter(file => file.origin !== 'source'))
        persistTasks(tasksRef.current.map(task => (task.origin === 'source'
          ? { ...task, objectCount: 0, status: 'new', lastReadAt: undefined, lastReadError: undefined, updatedAt: Date.now() }
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
        if (jobRef.current !== null) return
        commitFiles(list => list.map(file => ({
          ...file,
          result: '',
          status: 'idle',
          note: '',
          aiConverted: undefined,
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
      const settingsRow = (label, hint, control) => h('div', { className: 'hch-settingsRow' },
        h('div', { className: 'hch-settingsLabel' },
          h('b', null, label),
          hint === '' ? null : h('small', null, hint)),
        control)
      const settingsCard = (title, icon, rows) => h('section', { className: 'hch-card hch-settingsCard' },
        h('div', { className: 'hch-cardHead' },
          h('div', { className: 'hch-cardHeading' },
            h('h2', { className: 'hch-cardTitle' }, h(StudioIcon, { name: icon, size: 14 }), title))),
        h('div', { className: 'hch-settingsBody' }, rows))
      const fetchedSqlCount = files.filter(file => file.origin === 'source' && !isPlaceholderFile(file)).length
      const convertedResultCount = files.filter(file => file.result?.trim() || file.status === 'error'
        || file.convertedAt || file.execStatus || file.execAt).length
      const settingsPage = h('div', { className: 'hch hch-settingsPage' },
        h('main', { className: 'hch-scroll' },
          h('div', { className: 'hch-inner hch-settingsInner' },
            h('header', { className: 'hch-pageHead hch-settingsHead' },
              h('div', { className: 'hch-pageHeading' },
                h('h1', { className: 'hch-pageTitle' }, t('settingsTitle')),
                h('p', { className: 'hch-pageDesc' }, t('settingsDesc')))),
            settingsCard(t('settingsAppearance'), 'sun', [
              settingsRow(t('settingsTheme'), t('settingsThemeHint'),
                h('div', { className: 'hch-themeSwitch' },
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
              settingsRow(t('settingsLanguage'), t('settingsLanguageHint'),
                h('div', { className: 'hch-themeSwitch' },
                  [['zh', t('langZh')], ['en', t('langEn')]].map(([value, label]) => h('button', {
                    key: value,
                    type: 'button',
                    'data-active': lang === value ? 'true' : undefined,
                    onClick: () => {
                      if (typeof props.onSetLang === 'function') props.onSetLang(value)
                    },
                  }, label)))),
            ]),
            settingsCard(t('settingsConvertOptions'), 'bolt', [
              settingsRow(t('settingsDropTitle'), t('settingsDropHint'),
                h('label', { className: 'hch-toggle' },
                  h('input', {
                    type: 'checkbox',
                    checked: dropStatements,
                    onChange: (event) => {
                      const next = event.target.checked
                      setDropStatements(next)
                      saveDropStatements(next)
                    },
                  }),
                  h('span', { className: 'hch-toggleTrack' }, h('i', null)),
                  h('span', { className: 'hch-toggleText' },
                    dropStatements ? t('settingsOn') : t('settingsOff')))),
              settingsRow(t('settingsCascadeTitle'), t('settingsCascadeHint'),
                h('label', { className: 'hch-toggle' },
                  h('input', {
                    type: 'checkbox',
                    checked: dropCascade,
                    onChange: async (event) => {
                      const next = event.target.checked
                      if (next && !(await askConfirm({
                        title: t('settingsCascadeTitle'),
                        message: t('settingsCascadeConfirm'),
                        confirmLabel: t('settingsOn'),
                      }))) {
                        event.target.checked = false
                        return
                      }
                      setDropCascade(next)
                      saveDropCascade(next)
                    },
                  }),
                  h('span', { className: 'hch-toggleTrack' }, h('i', null)),
                  h('span', { className: 'hch-toggleText' },
                    dropCascade ? t('settingsOn') : t('settingsOff')))),
              settingsRow(t('settingsDepsTitle'), t('settingsDepsHint'),
                h('label', { className: 'hch-toggle' },
                  h('input', {
                    type: 'checkbox',
                    checked: readDeps,
                    onChange: (event) => {
                      const next = event.target.checked
                      setReadDeps(next)
                      saveDependencySetting(next)
                      if (next === false) setSourceTab('source')
                    },
                  }),
                  h('span', { className: 'hch-toggleTrack' }, h('i', null)),
                  h('span', { className: 'hch-toggleText' },
                    readDeps ? t('settingsOn') : t('settingsOff')))),
            ]),
            settingsCard(t('settingsData'), 'database', [
              settingsRow(t('settingsClearFetched'), t('settingsClearFetchedHint'),
                h('button', {
                  type: 'button',
                  className: 'hch-ctaSecondary hch-settingsBtn',
                  onClick: clearFetchedSql,
                  disabled: job !== null || fetchedSqlCount === 0,
                }, `${t('settingsCleanupAction')}（${fetchedSqlCount}）`)),
              settingsRow(t('settingsClearConverted'), t('settingsClearConvertedHint'),
                h('button', {
                  type: 'button',
                  className: 'hch-ctaSecondary hch-settingsBtn',
                  onClick: clearConvertedResults,
                  disabled: job !== null || convertedResultCount === 0,
                }, `${t('settingsCleanupAction')}（${convertedResultCount}）`)),
            ]),
            settingsCard(t('settingsAbout'), 'shield', [
              settingsRow(t('settingsVersion'), '', h('b', { className: 'hch-settingsValue' }, PLUGIN_VERSION)),
            ]))))

      const busyHere = busy !== null && busy.fileId === active.id
      const execHere = executing && execFileId === active.id
      const hudJob = job
      const taskDetailLocked = view === 'studio' && isTaskLocked(activeTaskId)
      const hudTitle = hudJob === null
        ? ''
        : hudJob.kind === 'read' ? t('jobReadTitle') : hudJob.kind === 'execute' ? t('jobExecuteTitle') : t('jobConvertTitle')
      const hudLabel = hudJob === null
        ? ''
        : (hudJob.label || (hudJob.kind === 'read' ? t('reading') : ''))
      /** 计数只在拿到总数后显示，避免出现 0/? */
      const hudCount = hudJob !== null && hudJob.total > 0
        ? `${Math.min(hudJob.done, hudJob.total)}/${hudJob.total}`
        : ''
      const hudPercent = hudJob !== null && hudJob.total > 0
        ? Math.max(6, Math.min(100, Math.round((hudJob.done / hudJob.total) * 100)))
        : 0
      const hudIcon = hudJob === null ? 'bolt' : hudJob.kind === 'read' ? 'download' : hudJob.kind === 'execute' ? 'play' : 'bolt'
      const hudRestored = hudJob !== null && hudJob.startedAt !== ownJobRef.current
      const cleanupTask = cleanupDraft === null ? undefined : tasks.find(task => task.id === cleanupDraft.taskId)
      const cleanupFiles = cleanupTask === undefined ? [] : files.filter(file => file.taskId === cleanupTask.id && !isPlaceholderFile(file))
      const hasConversionData = file => Boolean(file.result || file.status === 'error' || file.convertedAt || file.execStatus || file.execAt)
      const hasLog = file => Boolean(file.note || file.execNote || file.execAt || file.durationMs)
      const cleanupCounts = {
        source: cleanupFiles.length,
        converted: cleanupFiles.filter(hasConversionData).length,
        logs: cleanupFiles.filter(hasLog).length + (cleanupTask?.lastReadError ? 1 : 0),
      }
      const applyTaskCleanup = () => {
        if (cleanupTask === undefined || isTaskLocked(cleanupTask.id)) return
        const { source, converted, logs } = cleanupDraft
        if (source) {
          for (const file of filesRef.current) {
            if (file.taskId === cleanupTask.id) depsCacheRef.current.delete(file.id)
          }
          saveDepsCache(depsCacheRef.current)
          commitFiles(list => list.filter(file => file.taskId !== cleanupTask.id))
          patchTask(cleanupTask.id, { objectCount: 0, status: 'new', lastReadAt: undefined, lastReadError: undefined, updatedAt: Date.now() })
          if (activeTaskId === cleanupTask.id) {
            setActiveId('')
            setDepsState({ loading: false, error: '', from: '', fileId: '', items: [], fetched: false })
            setDepsOpenDdl('')
          }
        } else {
          commitFiles(list => list.map(file => {
            if (file.taskId !== cleanupTask.id) return file
            if (converted && hasConversionData(file)) return { ...clearedFile(file), aiConverted: undefined }
            if (logs && hasLog(file)) return { ...file, note: '', execNote: '', execAt: undefined, durationMs: undefined, updatedAt: Date.now() }
            return file
          }))
          if (logs && cleanupTask.lastReadError) {
            patchTask(cleanupTask.id, { lastReadError: undefined, updatedAt: Date.now() })
          }
        }
        setCleanupDraft(null)
        setStatus({ text: t('taskCleanupDone'), kind: 'ok' })
      }
      const cleanupDialog = cleanupTask === undefined ? null : renderOverlay(h('div', {
        className: 'hch-wizardOverlay hch-confirmOverlay',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('taskCleanup'),
        onClick: event => { if (event.target === event.currentTarget) setCleanupDraft(null) },
        onKeyDown: event => { if (event.key === 'Escape') setCleanupDraft(null) },
      },
      h('div', { className: 'hch-confirm' },
        h('h3', { className: 'hch-confirmTitle' }, t('taskCleanup')),
        h('p', { className: 'hch-confirmText' }, cleanupTask.name),
        h('div', { className: 'hch-cleanupOptions' },
          [['source', 'taskCleanupSource'], ['converted', 'taskCleanupConverted'], ['logs', 'taskCleanupLogs']].map(([key, label], index) =>
            h('label', { className: 'hch-cleanupOption', key },
              h('input', {
                type: 'checkbox', autoFocus: index === 0 && cleanupCounts[key] > 0,
                checked: cleanupDraft[key] || (key !== 'source' && cleanupDraft.source && cleanupCounts[key] > 0),
                disabled: cleanupCounts[key] === 0 || (key !== 'source' && cleanupDraft.source),
                onChange: event => {
                  const checked = event.target.checked
                  setCleanupDraft(current => ({ ...current, [key]: checked }))
                },
              }),
              h('span', null, h('b', null, `${t(label)} (${cleanupCounts[key]})`),
                h('small', null, t(`${label}Hint`)))))),
        h('div', { className: 'hch-confirmActions' },
          h('button', { type: 'button', className: 'hch-ctaSecondary', onClick: () => setCleanupDraft(null) }, t('cancel')),
          h('button', {
            type: 'button', className: 'hch-ctaPrimary hch-confirmDanger',
            disabled: isTaskLocked(cleanupTask.id) || !Object.keys(cleanupCounts).some(key => cleanupDraft[key] && cleanupCounts[key] > 0),
            onClick: applyTaskCleanup,
          }, t('taskCleanupApply'))))), theme)
      const confirmDialog = confirmRequest === null ? null : renderOverlay(h('div', {
        className: 'hch-wizardOverlay hch-confirmOverlay',
        role: 'alertdialog',
        'aria-modal': 'true',
        'aria-label': confirmRequest.title,
        onClick: (event) => {
          if (event.target === event.currentTarget) resolveConfirm(false)
        },
      },
      h('div', { className: 'hch-confirm' },
        h('h3', { className: 'hch-confirmTitle' }, confirmRequest.title),
        confirmRequest.message
          ? h('p', { className: 'hch-confirmText' }, confirmRequest.message)
          : null,
        h('div', { className: 'hch-confirmActions' },
          h('button', {
            type: 'button',
            className: 'hch-ctaSecondary',
            onClick: () => resolveConfirm(false),
          }, t('cancel')),
          h('button', {
            type: 'button',
            className: `hch-ctaPrimary${confirmRequest.tone === 'danger' ? ' hch-confirmDanger' : ''}`,
            onClick: () => resolveConfirm(true),
          }, confirmRequest.confirmLabel ?? t('confirmOk'))))), theme)
      const hudLayers = hudJob === null ? null : h('div', { className: 'hcs-hudLayer' },
        h('div', {
          className: 'hcs-hud',
          'data-kind': hudJob.kind,
          'data-restored': hudRestored ? 'true' : undefined,
          role: 'status',
          'aria-live': 'polite',
        },
        h('span', { className: 'hcs-hudAura', 'aria-hidden': 'true' }),
        h('span', { className: 'hcs-hudOrb', 'aria-hidden': 'true' },
          h('span', { className: 'hcs-hudRing' }),
          h('span', { className: 'hcs-hudRing hcs-hudRingB' }),
          h(StudioIcon, { name: hudIcon, size: 18 })),
        h('div', { className: 'hcs-hudText' },
          h('b', null, hudTitle),
          h('small', { title: hudRestored ? t('jobRestoredHint') : undefined },
            h('span', { className: 'hcs-hudMetaLabel' }, hudLabel === '' ? t('reading') : hudLabel),
            hudCount === '' ? null : h('span', { className: 'hcs-hudMetaCount' }, hudCount))),
        hudJob.kind === 'read' && hudJob.total === 0
          ? h('span', { className: 'hcs-hudBar isIndeterminate' }, h('i', null))
          : h('span', { className: 'hcs-hudBar' }, h('i', { style: { width: `${Math.max(4, hudPercent)}%` } })),
        h('span', { className: 'hcs-hudTimer' }, `${jobElapsed}s`),
        h('button', {
            type: 'button',
            className: 'hcs-hudStop',
            title: t(hudJob.kind === 'read' ? 'jobStopRead' : hudJob.kind === 'convert' ? 'jobStopConvert' : 'jobStop'),
            'aria-label': t(hudJob.kind === 'read' ? 'jobStopRead' : hudJob.kind === 'convert' ? 'jobStopConvert' : 'jobStop'),
            onClick: stopJob,
          })))
      const resultStatus = busyHere
        ? `${t('converting')} \u00b7 ${busy.seconds}s`
        : active.status === 'ok' ? t('convertDone')
          : active.status === 'error' ? (active.note || t('convertFailed'))
            : t('statusReady')
      const statusKind = busyHere ? 'idle' : active.status
      const doneCount = visible.filter(file => file.status === 'ok').length
      // ---- 分析面板（P0/P1）：规则命中、差异、执行结果 ----
      const activeRuleGroups = groupRules(active.applied, active.warnings, lang)
      const activeRuleCount = (Array.isArray(active.applied) ? active.applied.length : 0)
        + (Array.isArray(active.warnings) ? active.warnings.length : 0)
      const activeRiskCount = Array.isArray(active.warnings) ? active.warnings.length : 0
      /** 从源库读取当前对象的依赖（连库，走 Host 的 /dependencies）。 */
      const fetchDependencies = (target, refresh = false, allowFetch = true) => {
        const file = target !== undefined && target !== null ? target : active
        if (activeTask === undefined || file === undefined) return
        // 还没读取对象（或该任务没有对象）时不去源库查依赖
        if (activeTask.origin !== 'source') return
        if (contextFiles.length === 0) return
        const conn = connections.find(item => item.id === (activeTask.sourceId ?? ''))
        if (conn === undefined) {
          setDepsState({ loading: false, error: t('depsNeedSource'), from: '', fileId: file.id, items: [], fetched: false })
          return
        }
        const objectName = String(file.name ?? '').replace(/\.sql$/i, '').trim()
        if (objectName === '') return
        const showCached = (cached) => setDepsState({
          loading: false, error: '', from: cached.from, fileId: file.id, fetched: true, items: cached.items,
        })
        const cached = depsCacheRef.current.get(file.id)
        if (cached !== undefined && !refresh) {
          showCached(cached)
          return
        }
        if (!allowFetch) return
        setDepsState({ loading: true, error: '', from: '', fileId: file.id, items: [], fetched: false })
        const finish = (patch) => setDepsState(current => current.fileId !== file.id
          ? current
          : { loading: false, error: '', from: '', fileId: file.id, items: [], fetched: false, ...patch })
        if (depsRequestsRef.current.has(file.id)) return
        const request = (async () => {
          const pending = depsPrefetchRef.current.get(file.id)
          if (pending !== undefined) await pending.catch(() => {})
          const prefetched = depsCacheRef.current.get(file.id)
          if (prefetched !== undefined && (pending !== undefined || !refresh)) {
            finish({ from: prefetched.from, fetched: true, items: prefetched.items })
            return
          }
          try {
            const response = await fetch('/api/hgdb-convert-studio/dependencies', {
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
                schema: conn.kind === 'mysql'
                  ? (conn.database || '')
                  : ((activeTask.schema ?? '').trim() || conn.schema || ''),
                name: objectName,
              }),
            })
            const value = await response.json().catch(() => ({}))
            if (response.status === 404) {
              finish({ error: t('depsHostStale') })
              return
            }
            if (!response.ok || value.ok !== true) {
              finish({ error: value.message || `HTTP ${response.status}` })
              return
            }
            const raw = Array.isArray(value.items) ? value.items : []
            const items = raw
              .filter(item => item !== null && typeof item === 'object' && typeof item.name === 'string')
              .map(item => ({
                name: item.name,
                type: typeof item.type === 'string' ? item.type : '',
                ddl: typeof item.ddl === 'string' ? item.ddl : '',
              }))
            if (!filesRef.current.some(item => item.id === file.id)) return
            depsCacheRef.current.set(file.id, { from: conn.kind, items })
            saveDepsCache(depsCacheRef.current)
            finish({ from: conn.kind, fetched: true, items })
          } catch (error) {
            finish({ error: error && error.message ? error.message : String(error) })
          }
        })()
        depsRequestsRef.current.set(file.id, request)
        request.finally(() => depsRequestsRef.current.delete(file.id))
      }
      // ---- 依赖对象（设置开启时才计算与展示）----
      const taskObjects = files.filter(file => file !== null && typeof file === 'object'
        && !isPlaceholderFile(file)
        && (activeTask === undefined ? file.taskId === active.taskId : file.taskId === activeTask.id))
      const activeObjectName = String(active.name ?? '').replace(/\.sql$/i, '').trim().toLowerCase()
      const knownObjectNames = new Map()
      for (const file of taskObjects) {
        if (file.id === active.id) continue
        const key = String(file.name ?? '').replace(/\.sql$/i, '').trim().toLowerCase()
        if (key !== '') knownObjectNames.set(key, file)
      }
      /** 是否已经连库查过（即使结果为空也算）；用于区分“没查过”和“源库确实没有依赖”。 */
      const depsFetched = depsState.fileId === active.id && depsState.fetched === true
      const dbDeps = depsFetched ? depsState.items : []
      const staticDependencies = dependencyRefsOf(active.sql, new Set(knownObjectNames.keys()))
        .filter(ref => ref.name !== activeObjectName)
        .map((ref) => {
          const owner = knownObjectNames.get(ref.name)
          return {
            name: owner === undefined ? ref.name : String(owner.name).replace(/\.sql$/i, ''),
            type: owner === undefined ? '' : (owner.objType ?? ''),
            fileId: owner === undefined ? '' : owner.id,
            ddl: '',
            status: owner === undefined ? 'missing' : 'loaded',
            fromKeyword: ref.keyword,
          }
        })
      /** 源库结果优先；源库确实没有结果时，静态识别仅作为参考列出。 */
      const dbDependencyItems = dbDeps
        .filter(item => String(item.name).toLowerCase() !== activeObjectName)
        .map(item => {
        const owner = knownObjectNames.get(String(item.name).toLowerCase())
        return {
          name: item.name,
          type: item.type,
          ddl: item.ddl,
          fileId: owner === undefined ? '' : owner.id,
          status: owner === undefined ? 'remote' : 'loaded',
          fromDb: true,
          fromKeyword: false,
        }
        })
      const activeDependencies = (dbDependencyItems.length > 0
        ? dbDependencyItems
        : staticDependencies.map(item => ({ ...item, fromDb: false }))
      ).sort((a, b) => {
        if (a.status !== b.status) return a.status === 'loaded' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      const depsLoaded = activeDependencies.filter(item => item.status === 'loaded').length
      const depsRemote = activeDependencies.filter(item => item.status === 'remote').length
      const depsMissing = activeDependencies.length - depsLoaded
      const activeExecStatus = active.execStatus ?? 'idle'
      const activeExecAt = typeof active.execAt === 'number' ? active.execAt : undefined
      const hasResult = typeof active.result === 'string' && active.result.trim() !== ''

      const isAiConversion = hasResult && (active.aiConverted === true || active.applied === undefined)
      // 差异比对只看转换本身，不把附加的 DROP ... IF EXISTS 前缀算进去
      const activeDiff = hasResult
        ? diffLines(active.sql, stripDropPreamble(active.result))
        : { rows: [], added: 0, removed: 0 }
      const diffChanged = activeDiff.added + activeDiff.removed
      const diffRowNode = (row, tokens, key) => h('div', {
        key,
        className: `hcs-diffRow is-${row.type}`,
        title: row.oldNo === null ? undefined : t('ruleLocate'),
        onClick: row.oldNo === null ? undefined : () => revealSourceLine(row.oldNo),
      },
      h('span', { className: 'hcs-diffNo' }, row.oldNo === null ? '' : String(row.oldNo)),
      h('span', { className: 'hcs-diffNo' }, row.newNo === null ? '' : String(row.newNo)),
      h('span', { className: 'hcs-diffSign' }, row.type === 'add' ? '+' : row.type === 'del' ? '-' : ''),
      h('code', { className: 'hcs-diffText' }, tokens.map((token, tokenIndex) => (token.type === 'same'
        ? token.text
        : h('mark', { key: tokenIndex, className: `is-${token.type}` }, token.text)))))
      const diffRowList = (rows) => {
        const nodes = []
        let index = 0
        while (index < rows.length) {
          const row = rows[index]
          if (row.type === 'same') {
            nodes.push(diffRowNode(row, [{ type: 'same', text: row.text }], `s-${index}`))
            index += 1
            continue
          }
          const dels = []
          const adds = []
          while (index < rows.length && rows[index].type !== 'same') {
            if (rows[index].type === 'del') dels.push(rows[index])
            else adds.push(rows[index])
            index += 1
          }
          const max = Math.max(dels.length, adds.length)
          for (let pair = 0; pair < max; pair += 1) {
            const del = dels[pair]
            const add = adds[pair]
            if (del !== undefined && add !== undefined) {
              const parts = inlineDiff(del.text, add.text)
              nodes.push(diffRowNode(del, parts.before, `d-${pair}-${del.oldNo}`))
              nodes.push(diffRowNode(add, parts.after, `a-${pair}-${add.newNo}`))
            } else if (del !== undefined) {
              nodes.push(diffRowNode(del, [{ type: 'del', text: del.text }], `d-${pair}-${del.oldNo}`))
            } else {
              nodes.push(diffRowNode(add, [{ type: 'add', text: add.text }], `a-${pair}-${add.newNo}`))
            }
          }
        }
        return nodes
      }
      const diffVisibleRows = diffOnly ? activeDiff.rows.filter(row => row.type !== 'same') : activeDiff.rows
      const diffBody = h('div', { className: 'hcs-diffWrap' },
        h('div', { className: 'hcs-diffBar' },
          h('label', { className: 'hcs-diffToggle' },
            h('input', {
              type: 'checkbox',
              checked: diffOnly,
              onChange: (event) => setDiffOnly(event.target.checked),
            }),
            t('diffOnly')),
          h('span', {
            className: 'hcs-diffStat',
            'data-empty': diffChanged === 0 ? 'true' : undefined,
          }, t('diffStat', { added: activeDiff.added, removed: activeDiff.removed }))),
        !hasResult
          ? h('p', { className: 'hcs-emptyResult' }, t('resultEmpty'))
          : diffChanged === 0
            ? h('p', { className: 'hcs-emptyResult' }, t('insightNoDiff'))
            : h('div', { className: 'hcs-diffList' }, diffRowList(diffVisibleRows)))

      /** 点击规则示例：把源 SQL 定位到对应行并选中该行。 */
      const revealSourceLine = (line) => {
        const node = textareaRef.current
        if (node === null || node === undefined) return
        const lines = String(active.sql ?? '').split('\n')
        const index = Math.max(1, Math.min(Math.max(lines.length, 1), Math.round(Number(line) || 1)))
        let start = 0
        for (let i = 0; i < index - 1; i += 1) start += (lines[i] ?? '').length + 1
        const end = start + (lines[index - 1] ?? '').length
        try {
          node.focus({ preventScroll: true })
          node.setSelectionRange(start, end)
        } catch {
          /* 某些环境不支持 focus options，忽略 */
        }
        const lineHeight = 17
        const nextTop = Math.max(0, (index - 3) * lineHeight)
        node.scrollTop = nextTop
        if (gutterRef.current !== null) gutterRef.current.scrollTop = nextTop
        if (highlightRef.current !== null) {
          highlightRef.current.scrollTop = nextTop
          highlightRef.current.scrollLeft = node.scrollLeft
        }
      }
      const ruleSampleRow = (item, sample, sampleIndex) => h('div', {
        key: `${item.id}-sample-${sampleIndex}`,
        className: 'hcs-ruleSample',
        role: typeof sample.line === 'number' ? 'button' : undefined,
        tabIndex: typeof sample.line === 'number' ? 0 : undefined,
        title: typeof sample.line === 'number' ? t('ruleLocate') : undefined,
        onClick: typeof sample.line === 'number' ? () => revealSourceLine(sample.line) : undefined,
        onKeyDown: typeof sample.line === 'number'
          ? (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              revealSourceLine(sample.line)
            }
          }
          : undefined,
      },
      h('span', { className: 'hcs-ruleSampleLine' }, sample.line === undefined ? '' : `L${sample.line}`),
      h('code', { className: 'hcs-ruleBefore', title: sample.before }, sample.before),
      h('span', { className: 'hcs-ruleArrow', 'aria-hidden': 'true' }, '\u2192'),
      h('code', { className: 'hcs-ruleAfter', title: sample.after }, sample.after))
      const ruleItemNode = (item) => h('div', {
        key: item.id,
        className: 'hcs-ruleItem',
        'data-level': item.cat === 'risk' ? item.level : undefined,
        title: item.id,
      },
      h('div', { className: 'hcs-ruleLine' },
        h('span', { className: 'hcs-ruleName' }, item.label),
        item.cat === 'risk'
          ? h('span', { className: 'hcs-ruleLevel', 'data-level': item.level }, t(item.level === 'high' ? 'ruleLevelHigh' : item.level === 'mid' ? 'ruleLevelMid' : 'ruleLevelLow'))
          : null,
        h('span', { className: 'hcs-ruleCount' }, t('ruleCountTimes', { count: item.count }))),
      Array.isArray(item.samples) && item.samples.length > 0
        ? h('div', { className: 'hcs-ruleSamples' }, item.samples.map((sample, sampleIndex) => ruleSampleRow(item, sample, sampleIndex)))
        : null)
      const rulesBody = h('div', { className: 'hcs-insightScroll hcs-ruleScroll' },
        !hasResult
          ? h('p', { className: 'hcs-emptyResult' }, t('insightNoResult'))
          : activeRuleCount === 0
            ? h('div', { className: 'hcs-ruleEmpty' },
              h(StudioIcon, { name: 'alert', size: 15 }),
              h('p', null, isAiConversion ? t('ruleAiHint') : t('ruleEmpty')))
            : h(React.Fragment, null,
              activeRuleGroups.map(group => h('section', { key: group.cat, className: 'hcs-ruleGroup' },
                h('h3', { className: 'hcs-ruleGroupTitle' }, t(RULE_CATEGORY_KEYS[group.cat] ?? 'ruleCatRisk')),
                group.items.map(item => ruleItemNode(item)))),
              null))

      const execBody = h('div', { className: 'hcs-insightScroll hcs-execScroll' },
        h('div', { className: 'hcs-execCard', 'data-status': activeExecStatus },
          h('div', { className: 'hcs-execHead' },
            h(StudioIcon, { name: activeExecStatus === 'ok' ? 'check' : activeExecStatus === 'error' ? 'alert' : 'play', size: 15 }),
            h('b', null, activeExecStatus === 'ok'
              ? t('execPanelOk')
              : activeExecStatus === 'error' ? t('execPanelFail') : activeExecStatus === 'running' ? t('executing') : t('execPanelIdle'))),
          h('div', { className: 'hcs-execMeta' },
            activeExecAt === undefined ? null : h('span', null, `${t('execPanelAt')} ${formatRelative(activeExecAt, t)}`),
            hasTarget && targetConn !== undefined ? h('span', null, `${t('execPanelTarget')} ${targetConn.name}`) : null),
          activeExecStatus === 'error'
            ? h(React.Fragment, null,
              h('p', { className: 'hcs-execError' }, active.execNote?.replace(/^(?:\s*ERROR:\s*)+/i, '') || t('execMarkFailed')),
              h('p', { className: 'hcs-execHint' }, t('execPanelHint')))
            : activeExecStatus === 'ok'
              ? h('p', { className: 'hcs-execHint' }, t('execCurrentHint'))
              : h('p', { className: 'hcs-execHint' }, t('insightLogEmpty'))))


      // 打开「依赖对象」页签且是源库任务时，自动从源库读一次（失败不影响静态结果）。
      /** 批量预取：给一批对象一次性读回依赖（一次 JVM），结果写入按文件缓存。 */
      const prefetchDependencies = async (list, conn, schema) => {
        const BATCH = 120
        for (let index = 0; index < list.length; index += BATCH) {
          const slice = list.slice(index, index + BATCH)
          const names = slice.map(file => String(file.name ?? '').replace(/\.sql$/i, '').trim()).filter(Boolean)
          if (names.length === 0) continue
          try {
            const response = await fetch('/api/hgdb-convert-studio/dependencies', {
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
                schema,
                names,
              }),
            })
            if (response.status === 404) break
            const value = await response.json().catch(() => ({}))
            if (!response.ok || value.ok !== true) continue
            const results = Array.isArray(value.results) ? value.results : []
            const byObject = new Map()
            for (const item of results) {
              if (item !== null && typeof item === 'object' && typeof item.object === 'string') {
                byObject.set(item.object.toLowerCase(), Array.isArray(item.deps) ? item.deps : [])
              }
            }
            const liveIds = new Set(filesRef.current.map(file => file.id))
            for (const file of slice) {
              if (!liveIds.has(file.id)) continue
              const key = String(file.name ?? '').replace(/\.sql$/i, '').trim().toLowerCase()
              const deps = byObject.get(key)
              if (deps === undefined) continue
              depsCacheRef.current.set(file.id, { from: conn.kind, items: deps.map(dep => ({ name: dep.name, type: dep.type, ddl: '' })) })
            }
          } catch {
            /* 单批失败不影响其它批次 */
          }
        }
        saveDepsCache(depsCacheRef.current)
      }

      /** 按需加载某个依赖对象的 DDL（源库单对象查询）。 */
      const loadDependencyDdl = async (item, options) => {
        const silent = options !== undefined && options !== null && options.silent === true
        if (activeTask === undefined || item === undefined || !item.name) return
        const conn = connections.find(connItem => connItem.id === (activeTask.sourceId ?? ''))
        if (conn === undefined) return
        const ddlKey = `${active.id}|${item.name}`
        if (depsDdlRef.current.has(ddlKey)) return
        if (!silent) setDepsDdlLoading(ddlKey)
        try {
          const response = await fetch('/api/hgdb-convert-studio/dependencies', {
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
              schema: conn.kind === 'mysql' ? (conn.database || '') : ((activeTask.schema ?? '').trim() || conn.schema || ''),
              ddlOf: item.name,
              type: item.type || '',
            }),
          })
          const value = await response.json().catch(() => ({}))
          const first = Array.isArray(value.items) ? value.items[0] : undefined
          const ddl = first !== undefined && typeof first.ddl === 'string' ? first.ddl : ''
          depsDdlRef.current.set(ddlKey, ddl)
        } catch {
          depsDdlRef.current.set(ddlKey, '')
        } finally {
          if (!silent) setDepsDdlLoading('')
        }
      }

      // 依赖列表就绪后，后台预热每项的 DDL，点开时基本无需等待。
      React.useEffect(() => {
        if (!depsFetched || dbDependencyItems.length === 0) return
        const pending = dbDependencyItems
          .filter(item => depsDdlRef.current.get(`${active.id}|${item.name}`) === undefined)
          .slice(0, 12)
        if (pending.length === 0) return
        let cancelled = false
        const run = async () => {
          for (const item of pending) {
            const key = `${active.id}|${item.name}`
            if (depsDdlAskedRef.current.has(key)) continue
            depsDdlAskedRef.current.add(key)
            await loadDependencyDdl(item, { silent: true })
            if (cancelled) return
          }
          if (!cancelled) setDepsDdlVersion(version => version + 1)
        }
        run()
        return () => { cancelled = true }
      }, [depsState.fileId, depsFetched, dbDependencyItems.length])

      // 打开「依赖对象」页签（或在该页签下切换文件）时，优先用缓存；没有缓存就自动连库读一次，
      // 保证看到的是源库的准确依赖而不是静态猜测。
      React.useEffect(() => {
        if (sourceTab === 'deps') fetchDependencies(active, false, readDeps)
      }, [sourceTab, active.id, readDeps])

      const pageShell = (title, desc, actions, body) => h('div', { className: 'hch hch-page' },
        h('main', { className: 'hch-scroll' },
          h('div', { className: 'hch-inner hch-pageInner' },
            h('header', { className: 'hch-pageHead' },
              h('div', { className: 'hch-pageHeading' },
                h('h1', { className: 'hch-pageTitle' }, title),
                h('p', { className: 'hch-pageDesc' }, desc)),
              actions === null ? null : h('div', { className: 'hch-pageActions' }, actions)),
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
        const running = isTaskLocked(task.id)
        const failed = owned.some(file => file.status === 'error')
        const doneCount = owned.filter(file => file.status === 'ok').length
        const executedCount = owned.filter(file => file.execStatus === 'ok').length
        const executionFailed = owned.some(file => file.execStatus === 'error')
        const needsExecution = (task.targetId ?? '') !== ''
        const conversionDone = owned.length > 0 && doneCount === owned.length
        const executionDone = !needsExecution || (owned.length > 0 && executedCount === owned.length)
        // 有目标库时必须“转换完成 + 全部执行成功”才算整任务完成；
        // 否则任务列表前面的对号会早于「执行」步骤出现。
        const status = running
          ? 'running'
          : task.lastReadError || failed || executionFailed
            ? 'error'
            : conversionDone && executionDone ? 'done' : 'pending'
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
            state: reading ? 'active' : task.lastReadError ? 'error' : fetched ? 'done' : 'wait',
          })
        }
        const converting = owned.some(file => busy !== null && busy.fileId === file.id)
        const convertState = converting ? 'active'
          : doneCount > 0 && doneCount === owned.length ? 'done'
            : failed ? 'error'
              : doneCount > 0 ? 'active' : 'wait'
        steps.push({ key: 'convert', label: t('taskStepConvert'), hint: t('taskStepConvertHint'), icon: 'bolt', state: convertState })
        if ((task.targetId ?? '') !== '') {
          const executed = owned.filter(file => file.execStatus === 'ok').length
          const execFailed = owned.some(file => file.execStatus === 'error')
          const execState = job?.kind === 'execute' && job.taskId === task.id ? 'active'
            : owned.length > 0 && executed === owned.length ? 'done'
            : execFailed ? 'error'
              : executed > 0 ? 'partial' : 'wait'
          const partial = execState === 'partial'
          steps.push({
            key: 'execute',
            label: t(partial ? 'taskStepExecutePartial' : 'taskStepExecute'),
            hint: partial ? t('taskStepExecutePartialHint', { done: executed, total: owned.length }) : t('taskStepExecuteHint'),
            icon: partial ? 'check' : 'play',
            state: execState,
          })
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
        h('button', { type: 'button', className: 'hch-ctaPrimary', onClick: openNewTask },
          h(StudioIcon, { name: 'plus', size: 16 }),
          t('tasksNew')),
        h(React.Fragment, null,
          h('div', { className: 'hch-pageStats' },
            taskStats.map(stat => h('article', { key: stat.label, className: 'hch-stat hch-pageStat', 'data-tone': stat.tone },
              h('div', { className: 'hch-statTop' },
                h('span', { className: 'hch-statLabel' }, stat.label)),
              h('div', { className: 'hch-statValue' }, String(stat.value))))),
          h('section', { className: 'hch-card hch-pageCard' },
            h('header', { className: 'hch-cardHead' },
              h('div', { className: 'hch-cardHeading' },
                h('h2', { className: 'hch-cardTitle' }, h(StudioIcon, { name: 'layers', size: 15 }), t('tasksTitle')),
                h('p', { className: 'hch-cardSub' }, t('tasksDesc'))),
              h('div', { className: 'hch-cardAside' },
                tasksDemoMode ? h('span', { className: 'hch-demoChip' }, t('tasksDemo')) : null)),
            taskRows.length === 0
              ? h('div', { className: 'hch-pageEmpty' }, t('tasksEmpty'))
              : h('div', { className: 'hch-pageTable' },
                taskRows.map(task => h('div', {
                  key: task.id,
                  className: 'hch-pageRow hch-taskPageRow',
                  role: 'button',
                  tabIndex: task.id === lockedTaskId ? -1 : 0,
                  'aria-disabled': task.id === lockedTaskId ? 'true' : undefined,
                  onClick: () => openTaskRow(task),
                  onKeyDown: (event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      openTaskRow(task)
                    }
                  },
                },
                h('span', { className: `hch-taskIcon is-${task.status}` }, h(StudioIcon, { name: taskStatusMeta[task.status].icon, size: 15 })),
                h('span', { className: 'hch-pageRowMain' },
                  h('b', { className: 'hch-pageRowTitle' }, task.name),
                  h('span', { className: 'hch-pageRowMeta' }, task.meta),
                  Array.isArray(task.types) && task.types.length > 0
                    ? h('span', { className: 'hch-taskTypeChips' },
                      task.types.map(type => h('span', { key: type, className: 'hch-taskTypeChip' }, typeLabel(type))))
                    : null),
                h('span', { className: 'hch-pageRowProgress' },
                  h('span', { className: 'hch-steps' },
                    task.steps.map((step, index) => h(React.Fragment, { key: step.key },
                      index === 0 ? null : h('i', { className: `hch-stepLink is-${step.state}`, 'aria-hidden': 'true' }),
                      h('span', { className: `hch-step is-${step.state}`, title: step.hint },
                        h('i', { className: 'hch-stepDot' }, h(StudioIcon, { name: step.state === 'done' ? 'check' : step.state === 'error' ? 'alert' : step.icon, size: 11 })),
                        h('span', { className: 'hch-stepLabel' }, step.label))))),
                  h('span', { className: 'hch-taskTime' }, task.time)),
                task.task === undefined
                  ? h('span', { className: 'hch-taskArrow' }, h(StudioIcon, { name: 'arrowUpRight', size: 14 }))
                  : h('span', { className: 'hch-taskRowActions' },
                    h('button', {
                      type: 'button',
                      className: 'hch-taskAction',
                      disabled: task.id === lockedTaskId,
                      title: t('taskEdit'),
                      onClick: (event) => { event.stopPropagation(); openTaskWizard(task.task) },
                    }, h(StudioIcon, { name: 'edit', size: 13 })),
                    h('button', {
                      type: 'button',
                      className: 'hch-taskAction',
                      disabled: task.id === lockedTaskId,
                      title: t('taskCleanup'),
                      'aria-label': t('taskCleanup'),
                      onClick: event => {
                        event.stopPropagation()
                        if (!isTaskLocked(task.id)) setCleanupDraft({ taskId: task.id, source: false, converted: false, logs: false })
                      },
                    }, h(StudioIcon, { name: 'cleanup', size: 13 })),
                    h('button', {
                      type: 'button',
                      className: 'hch-taskAction isDanger',
                      disabled: task.id === lockedTaskId,
                      title: t('taskDelete'),
                      onClick: (event) => { event.stopPropagation(); removeTask(task.task) },
                    }, h(StudioIcon, { name: 'trash', size: 13 })),
                    h('span', { className: 'hch-taskArrow' }, h(StudioIcon, { name: 'arrowUpRight', size: 14 })))))))))

      return h('div', { className: 'hcs hcs-app', 'data-theme': theme },
        h('style', null, PAGE_CSS),
        h('style', null, HOME_CSS),
        h(StudioTopNav, { t, active: view, onNavigate: navigate, theme, onToggleTheme: toggleTheme, lang, onToggleLang: props.onToggleLang, onSetLang: props.onSetLang }),
        h('div', {
          className: 'hcs-lockWrap',
          'data-locked': taskDetailLocked ? 'true' : undefined,
          'aria-busy': taskDetailLocked ? 'true' : undefined,
          inert: taskDetailLocked ? '' : undefined,
        },
        h('div', { className: 'hcs-lockVeil', 'aria-hidden': 'true' }),
        view === 'home'
          ? h(HomeView, {
            t,
            files,
            connections,
            tasks,
            activeTaskId,
            lockedTaskId,
            embedded: true,
            theme,
            onToggleTheme: toggleTheme,
            onNavigate: navigate,
            onOpenStudio: openStudio,
            onNewTask: openNewTask,
            onOpenConnections: openConnections,
            onOpenFile: openFile,
            onOpenTask: openTask,
            onEditTask: openTaskWizard,
          })
          : view === 'connections'
            ? connectionsPage
            : view === 'settings'
              ? settingsPage
              : view === 'tasks'
                ? tasksPage
                : h('div', { className: 'hcs-shell' },
          h('header', { className: 'hch-pageHead' },
            h('div', { className: 'hch-pageHeading' },
              h('h1', { className: 'hch-pageTitle' }, t('workspaceTitle')),
              h('p', { className: 'hch-pageDesc' }, t('introText'))),
            h('div', { className: 'hch-pageActions' },
                h('button', {
                  type: 'button',
                  className: `hch-ctaPrimary${busy !== null ? ' hcs-btnBusy' : ''}`,
                  disabled: job !== null || !visible.some(file => file.sql.trim() !== ''),
                  title: t('workbarConvertAllHint'),
                  onClick: convertAll,
                }, h(StudioIcon, { name: 'bolt', size: 14 }), t('workbarConvert')),
                h('button', {
                  type: 'button',
                  className: `hch-ctaSecondary${executing ? ' hcs-btnBusy' : ''}`,
                  disabled: job !== null || !contextReady || !visible.some(canExecuteResult) || !hasTarget,
                  title: hasTarget ? t('workbarExecuteAllHint') : t('execNoTarget'),
                  onClick: () => executeFiles(visible),
                }, h(StudioIcon, { name: 'play', size: 14 }), executing ? t('executing') : t('workbarExecute')),
                h('button', {
                  type: 'button',
                  className: 'hch-ctaSecondary',
                  disabled: job !== null || !hasTarget || failedExecutionFiles.length === 0,
                  title: hasTarget ? t('workbarRetryFailedHint') : t('execNoTarget'),
                  onClick: () => executeFiles(failedExecutionFiles),
                }, h(StudioIcon, { name: 'sync', size: 14 }), t('workbarRetryFailed')),
                h('button', {
                  type: 'button',
                  className: 'hch-ctaSecondary',
                  disabled: visible.every(file => file.result === ''),
                  title: t('workbarExportAllHint'),
                  onClick: exportAll,
                }, h(StudioIcon, { name: 'file', size: 14 }), t('workbarExport')),
                h('div', { className: 'hcs-chipSelect hcs-reportSelect' },
                  h('button', {
                    type: 'button',
                    className: 'hch-ctaSecondary',
                    disabled: !displayFiles.some(file => !isPlaceholderFile(file)),
                    'aria-expanded': openFilter === 'report',
                    onClick: () => setOpenFilter(openFilter === 'report' ? '' : 'report'),
                  }, h(StudioIcon, { name: 'list', size: 14 }), t('workbarReport')),
                  openFilter === 'report' && contextReady ? h('div', { className: 'hcs-chipMenu' },
                    [['md', 'Markdown'], ['csv', 'CSV'], ['html', 'HTML']].map(([format, label]) => h('button', {
                      key: format, type: 'button', className: 'hcs-chipItem',
                      onClick: () => { setOpenFilter(''); exportReport(format) },
                    }, label))) : null))
            ),
          h('div', { className: 'hcs-body' },
            h('aside', { className: 'hcs-list hcs-explorer' },
              taskDetailLocked && reading ? h('div', { className: 'hcs-loadBar', 'data-tone': 'read' }, h('span', null)) : null,
              h('div', { className: 'hcs-sourceRows hcs-taskTop' },
                h('div', { className: 'hcs-sourceRow' },
                  chipSelect(
                    'task',
                    'list',
                    t('taskSelectLabel'),
                    activeTaskId,
                    [
                      { value: '', label: t('taskSelectPlaceholder') },
                      ...[...tasks]
                        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
                        .map(task => ({ value: task.id, label: taskOptionLabel(task) })),
                    ],
                    selectTask,
                  ),
                  h('button', {
                    type: 'button',
                    className: 'hcs-readBtn',
                    disabled: !canReadObjects,
                    title: reading ? t('reading') : t('readHint'),
                    'aria-label': t('read'),
                    onClick: () => {
                      if (activeTask === undefined || activeTask.origin !== 'source') return
                      readSourceObjects(activeTask.sourceId, { taskId: activeTask.id, types: readTypes, schema: activeTask.schema })
                    },
                  }, reading ? h('i', { className: 'hcs-readSpin' }) : h(StudioIcon, { name: 'download', size: 15 })))),
              h('div', { className: 'hcs-sourceRows hcs-filterTop' },
                // 第一行：对象类型与对象计数
                h('div', { className: 'hcs-sourceRow' },
                  chipSelect(
                    'type',
                    'layers',
                    t('objectType'),
                    typeFilter,
                    [{ value: 'all', label: t('typeAll') }, ...availableTypes.map(type => ({ value: type, label: type }))],
                    setTypeFilter,
                  ),
                  h('span', { className: 'hcs-listCount' }, `${doneCount} / ${visible.length}`)),
                // 第二行：状态筛选（转换 / 执行）并列，没绑目标库时转换独占
                h('div', { className: 'hcs-sourceRow hcs-filterStatus' },
                  chipSelect(
                    'conv',
                    'sync',
                    t('filterConv'),
                    convFilter,
                    [
                      { value: 'all', label: t('filterAll') },
                      { value: 'done', label: t('filterDone') },
                      { value: 'pending', label: t('filterPending') },
                      { value: 'failed', label: t('filterFailed') },
                    ],
                    setConvFilter,
                  ),
                  hasTarget
                    ? chipSelect(
                      'exec',
                      'play',
                      t('filterExec'),
                      execFilter,
                      [
                        { value: 'all', label: t('filterAll') },
                        { value: 'ok', label: t('filterExecDone') },
                        { value: 'pending', label: t('filterExecPending') },
                        { value: 'failed', label: t('filterExecFailed') },
                      ],
                      setExecFilter,
                    )
                    : null)),
              h('div', { className: 'hcs-listHead' },
                h('input', {
                  className: 'hcs-search', type: 'search', value: query, disabled: displayFiles.length === 0,
                  placeholder: t('searchFiles'),
                  onChange: (event) => setQuery(event.target.value),
                }),
                h('div', { className: 'hcs-treeActions' },
                  [
                    ['treeExpand', 'treeExpandAll', !taskGroupKeys.some(key => collapsedTypes.includes(key)),
                      () => setCollapsedTypes(current => current.filter(key => !taskGroupKeys.includes(key)))],
                    ['treeCollapse', 'treeCollapseAll', taskGroupKeys.every(key => collapsedTypes.includes(key)),
                      () => setCollapsedTypes(current => [...new Set([...current, ...taskGroupKeys])])],
                    ['treeLocate', 'treeLocate', !canLocate, locateActiveSql],
                  ].map(([icon, label, disabled, onClick]) => h('button', {
                    key: icon, type: 'button', className: 'hcs-treeAction', title: t(label), 'aria-label': t(label), disabled, onClick,
                  }, h(StudioIcon, { name: icon, size: 14 }))))),
              h('div', { className: 'hcs-fileList' },
                reading && visible.length === 0
                  ? h('div', { className: 'hcs-scan' },
                    h('div', { className: 'hcs-scanHead' }, h('i', null), t('reading')),
                    [0, 1, 2, 3, 4, 5].map(index => h('div', {
                      key: index,
                      className: 'hcs-skel',
                      style: { animationDelay: `${index * 130}ms` },
                    })))
                  : visible.length === 0
                    ? h('p', { className: 'hcs-listEmpty' }, !contextReady ? t('taskSelectPlaceholder') : sourceUnread ? t('sourceNotReadList') : t('searchNoMatch'))
                    : fileBlocks)),
            h('section', { className: 'hcs-pane' },
              h('header', { className: 'hcs-paneHead' },
                h('div', { className: 'hcs-paneTabs', role: 'tablist' },
                    h('button', {
                      type: 'button',
                      role: 'tab',
                      className: 'hcs-insightTab hcs-paneTab',
                      'data-active': sourceTab === 'source' ? 'true' : undefined,
                      onClick: () => setSourceTab('source'),
                    }, t('sourceSql')),
                    h('button', {
                      type: 'button',
                      role: 'tab',
                      className: 'hcs-insightTab hcs-paneTab',
                      'data-active': sourceTab === 'deps' ? 'true' : undefined,
                      disabled: !hasActiveSql,
                      title: sourceUnread ? t('depsNeedObjects') : undefined,
                      onClick: () => {
                        if (sourceUnread) return
                        setSourceTab('deps')
                      },
                    }, t('sourceTabDeps'),
                    activeDependencies.length > 0
                      ? h('span', { className: 'hcs-tabBadge' }, String(activeDependencies.length))
                      : null)),
                h('div', { className: 'hcs-tools' },
                  activeTask === undefined || activeTask.origin !== 'source'
                    ? h(React.Fragment, null,
                      h('button', { type: 'button', className: 'hcs-btn', disabled: !contextReady, onClick: newFile }, t('newSql')),
                      h('button', { type: 'button', className: 'hcs-btn', disabled: !contextReady || active.id === '', onClick: deleteActive }, t('delete')),
                      h('button', { type: 'button', className: 'hcs-btn', disabled: !contextReady, onClick: () => fileInputRef.current && fileInputRef.current.click() }, t('importSql')),
                      h('button', { type: 'button', className: 'hcs-btn', disabled: !hasActiveSql, onClick: copySql }, t('copySql')))
                    : null,
                  h('button', {
                    type: 'button',
                    className: `hcs-btn${depsState.loading ? ' hcs-btnBusy' : ''}`,
                    disabled: depsState.loading || !hasActiveSql || !hasSourceConnection,
                    title: sourceUnread
                      ? t('depsNeedObjects')
                      : (activeTask !== undefined && activeTask.origin === 'source' ? t('depsFetchHint') : t('depsNeedSource')),
                    onClick: () => {
                      if (sourceUnread) return
                      setSourceTab('deps')
                      fetchDependencies(active, sourceTab === 'deps' && depsState.fileId === active.id && depsState.fetched)
                    },
                  }, h(StudioIcon, { name: 'layers', size: 13 }), depsState.loading
                    ? t('depsFetching')
                    : (!sourceUnread && depsState.fileId === active.id && depsState.fetched ? t('depsRefetch') : t('depsFetch'))),
                  h('button', { type: 'button', className: `hcs-btn hcs-btnAi${busyHere ? ' hcs-btnBusy' : ''}`, onClick: deepConvert, disabled: job !== null || !hasActiveSql }, h(StudioIcon, { name: 'sparkles', size: 13 }), t('deepConvert')),
                  h('button', { type: 'button', className: `hcs-btn hcs-btnPrimary hcs-btnLead${busyHere ? ' hcs-btnBusy' : ''}`, onClick: convertActive, disabled: job !== null || !hasActiveSql }, h(StudioIcon, { name: 'bolt', size: 13 }), t('convertSyntax')))),
              taskDetailLocked && reading ? h('div', { className: 'hcs-loadBar', 'data-tone': 'read' }, h('span', null)) : null,
              taskDetailLocked && reading ? h('div', { className: 'hcs-scanline' }) : null,
              sourceTab === 'deps'
                ? h('div', { className: 'hcs-deps' },
                  h('div', { className: 'hcs-depsBar' },
                    depsState.loading
                      ? h('span', { className: 'hcs-depsTag', 'data-tone': 'busy' }, t('depsFetching'))
                      : null,
                    h('span', { className: 'hcs-depsCount' },
                      depsFetched && activeDependencies.length === 0
                        ? t('depsNoneShort')
                        : t('depsCount', { loaded: depsLoaded, missing: depsMissing + depsRemote }))),
                  depsState.error !== ''
                    ? h('p', { className: 'hcs-depsError' }, depsState.error)
                    : null,
                  depsState.loading
                    ? h('div', { className: 'hcs-depsEmpty' },
                      h(StudioIcon, { name: 'download', size: 18 }),
                      h('p', null, t('depsFetching')),
                      h('small', null, t('depsLoadingHint')))
                    : activeDependencies.length === 0
                    ? h('div', { className: 'hcs-depsEmpty' },
                      h(StudioIcon, { name: depsFetched ? 'check' : 'link', size: 18 }),
                      h('p', null, active.sql.trim() === ''
                        ? t('depsEmptyUnread')
                        : (depsFetched ? t('depsNoDeps') : t('depsEmpty'))),
                      h('small', null, depsFetched ? t('depsNoDepsHint') : t('depsHint')))
                    : h(React.Fragment, null,
                      h('div', { className: 'hcs-depsList' }, activeDependencies.map(item => {
                        const ddlKey = `${active.id}|${item.name}`
                        const cachedDdl = depsDdlRef.current.get(ddlKey)
                        const rowDdl = item.ddl ? item.ddl : (cachedDdl ?? '')
                        const ddlLoading = depsDdlLoading === ddlKey
                        const openDdl = depsOpenDdl === item.name
                        const toggleDdl = () => {
                          if (openDdl) {
                            setDepsOpenDdl('')
                            return
                          }
                          setDepsOpenDdl(item.name)
                          if (rowDdl === '') loadDependencyDdl(item)
                        }
                        return h('div', { key: `${item.status}-${item.name}`, className: 'hcs-depsItem' },
                          h('div', {
                            className: 'hcs-depsRow',
                            'data-status': item.status,
                            role: 'button',
                            tabIndex: 0,
                            title: openDdl ? t('depsHideDdl') : t('depsShowDdl'),
                            onClick: toggleDdl,
                            onKeyDown: (event) => {
                              if (event.key !== 'Enter' && event.key !== ' ') return
                              event.preventDefault()
                              toggleDdl()
                            },
                          },
                          h('span', { className: 'hcs-depsIcon' }, h(StudioIcon, { name: item.type === '' ? 'link' : objectTypeIcon(item.type), size: 13 })),
                          h('span', { className: 'hcs-depsName' }, item.name),
                          h('span', { className: 'hcs-depsType' }, item.type === '' ? '\u2014' : typeLabel(item.type)),
                          h('span', { className: 'hcs-depsStatus' }, t(item.status === 'loaded'
                            ? 'depsLocalLoaded'
                            : (item.fromDb ? 'depsDbOnly' : 'depsStaticOnly'))),
                          h('span', { className: 'hcs-depsDdlBtn' },
                            ddlLoading ? t('depsDdlLoading') : (openDdl ? t('depsHideDdl') : t('depsShowDdl'))),
                          item.fileId === ''
                            ? h('span', { className: 'hcs-depsJump', 'aria-hidden': 'true' })
                            : h('button', {
                              type: 'button',
                              className: 'hcs-depsJump',
                              title: t('depsOpen'),
                              'aria-label': t('depsOpen'),
                              onClick: (event) => {
                                event.stopPropagation()
                                setActiveId(item.fileId)
                                setSourceTab('source')
                              },
                            }, h(StudioIcon, { name: 'arrowUpRight', size: 12 }))),
                          openDdl
                            ? h('pre', { className: 'hcs-depsDdl' }, ddlLoading
                              ? t('depsDdlLoading')
                              : (rowDdl === '' ? t('depsNoDdl') : rowDdl))
                            : null)
                      })),

                      depsFetched && dbDependencyItems.length > 0
                        ? null
                        : h('p', { className: 'hcs-depsHint' }, depsFetched
                          ? t('depsStaticListHint')
                          : (activeTask !== undefined && activeTask.origin === 'source' ? t('depsStaticHint') : t('depsHint')))))
                : sourceUnread
                  ? h('div', { className: 'hcs-emptyState' },
                    h('div', { className: 'hcs-emptyIcon' }, h(StudioIcon, { name: 'database', size: 24 })),
                    h('h3', { className: 'hcs-emptyTitle' }, t('sourceNotReadTitle')),
                    h('p', { className: 'hcs-emptyHint' }, t('sourceNotReadHint')),
                    h('button', {
                      type: 'button',
                      className: `hcs-btn hcs-btnPrimary${reading ? ' hcs-btnBusy' : ''}`,
                      disabled: !canReadObjects,
                      onClick: () => readSourceObjects(activeTask.sourceId, { taskId: activeTask.id, types: readTypes, schema: activeTask.schema }),
                    }, h(StudioIcon, { name: 'download', size: 13 }), reading ? t('reading') : t('read')))
                  : h(React.Fragment, null,
                    h('div', { className: 'hcs-editor' },
                      h('div', { className: 'hcs-gutter', ref: gutterRef }, lineNumbers(active.sql)),
                      h('div', { className: 'hcs-editorPane' },
                        h('pre', { className: 'hcs-highlight', ref: highlightRef, 'aria-hidden': 'true' }, highlightSql(active.sql, fileEngine(active))),
                        h('textarea', {
                          className: 'hcs-textarea hcs-textareaOverlay',
                          ref: textareaRef,
                          spellCheck: false,
                          wrap: 'off',
                          value: active.sql,
                          readOnly: !contextReady,
                          placeholder: t('pageSqlPlaceholder'),
                          onChange: (event) => updateActive({ sql: event.target.value, result: '', status: 'idle', note: '', convertedAt: undefined, applied: undefined, warnings: undefined, aiConverted: undefined, durationMs: undefined, execStatus: undefined, execNote: '', execAt: undefined }),
                          onScroll: (event) => {
                            if (gutterRef.current) gutterRef.current.scrollTop = event.currentTarget.scrollTop
                            if (highlightRef.current) {
                              highlightRef.current.scrollTop = event.currentTarget.scrollTop
                              highlightRef.current.scrollLeft = event.currentTarget.scrollLeft
                            }
                          },
                        }))),
                    h('footer', { className: 'hcs-paneFoot' },
                      h('span', null, `${active.sql.length} ${t('chars')} \u00b7 ${lineNumbers(active.sql).split('\n').length} ${t('linesUnit')}`),
                      h('span', null, compat ? t('compat') : '')))),

            h('section', { className: `${busyHere || execHere ? 'hcs-pane hcs-paneBusy' : 'hcs-pane'}${execHere ? ' hcs-paneExec' : ''}` },
              h('header', { className: 'hcs-paneHead' },
                h('div', { className: 'hcs-paneTabs', role: 'tablist' },
                  ['result', 'diff', 'rules', 'exec'].map((key) => {
                    const badge = key === 'rules' ? activeRuleCount : 0
                    // 还没有转换结果时，其它页签不可用（和左侧未读取对象时的禁用效果一致）
                    const locked = key === 'rules' ? !hasResult && activeRuleCount === 0 : key !== 'result' && !hasResult
                    return h('button', {
                      key,
                      type: 'button',
                      role: 'tab',
                      className: 'hcs-insightTab hcs-paneTab',
                      'data-active': paneTab === key ? 'true' : undefined,
                      'data-tone': key === 'exec' && activeExecStatus === 'error' ? 'error' : undefined,
                      disabled: locked,
                      title: locked ? t('paneTabLocked') : undefined,
                      onClick: () => {
                        if (locked) return
                        setPaneTab(key)
                      },
                    },
                    t(key === 'result' ? 'paneTabResult' : key === 'diff' ? 'paneTabDiff' : key === 'rules' ? 'paneTabRules' : 'paneTabExec'),
                    badge > 0 ? h('span', { className: 'hcs-tabBadge' }, String(badge)) : null,
                    key === 'exec' && activeExecStatus === 'error' ? h('span', { className: 'hcs-tabDot' }) : null)
                  })),
                h('div', { className: 'hcs-tools' },
                  h('button', {
                    type: 'button',
                    className: `hcs-btn${executing ? ' hcs-btnBusy' : ''}`,
                    disabled: job !== null || !contextReady || !canExecuteResult(active) || !hasTarget,
                    title: hasTarget ? t('execCurrentHint') : t('execNoTarget'),
                    onClick: () => executeFiles([active]),
                  }, h(StudioIcon, { name: 'play', size: 12 }), executing ? t('executing') : t('executeCurrent')),
                  h('button', { type: 'button', className: 'hcs-btn', onClick: copyResult, disabled: !hasResult }, h(StudioIcon, { name: 'copy', size: 12 }), t('copyResult')),
                  h('button', { type: 'button', className: 'hcs-btn', onClick: exportActive, disabled: !hasResult }, h(StudioIcon, { name: 'download', size: 12 }), t('exportResult')))),
              busyHere ? h('div', { className: 'hcs-loadBar' }, h('span', null)) : null,
              execHere ? h('div', { className: 'hcs-loadBar', 'data-tone': 'exec' }, h('span', null)) : null,
              busyHere ? h('div', { className: 'hcs-scanline' }) : null,
              execHere ? h('div', { className: 'hcs-execFlow' }) : null,
              paneTab === 'result'
                ? h('div', { className: 'hcs-codeScroll' },
                  active.result === ''
                    ? h('p', { className: 'hcs-emptyResult' }, t('resultEmpty'))
                    : h(React.Fragment, null,
                      h('div', { className: 'hcs-gutter' }, lineNumbers(active.result)),
                      h('pre', { className: 'hcs-code' }, highlightSql(active.result, resultDialect))))
                : paneTab === 'diff'
                  ? diffBody
                  : paneTab === 'rules'
                    ? rulesBody
                    : execBody,
              h('footer', { className: 'hcs-paneFoot' },
                h('div', { className: 'hcs-paneChips' },
                  h('button', {
                    type: 'button',
                    className: 'hcs-chip',
                    disabled: !hasResult && activeRuleCount === 0,
                    onClick: () => setPaneTab('rules'),
                  }, `${t('paneTabRules')} ${activeRuleCount}`),
                  activeRiskCount > 0
                    ? h('button', {
                      type: 'button',
                      className: 'hcs-chip',
                      'data-tone': 'warn',
                      onClick: () => setPaneTab('rules'),
                    }, `${t('insightRisk')} ${activeRiskCount}`)
                    : null,
                  activeExecStatus === 'idle'
                    ? null
                    : h('button', {
                      type: 'button',
                      className: 'hcs-chip',
                      'data-tone': activeExecStatus,
                      onClick: () => setPaneTab('exec'),
                    }, activeExecStatus === 'ok' ? t('execPanelOk') : activeExecStatus === 'running' ? t('executing') : t('execPanelFail'))),
                h('span', { className: 'hcs-paneFootStatus', title: active.note === '' ? undefined : active.note }, resultStatus),
                h('span', { className: 'hcs-dot', 'data-status': statusKind })))),
            h('footer', { className: 'hcs-statusbar' },
            h('div', { className: 'hcs-statusLeft' },
              h('span', { className: 'hcs-statusDot', 'data-kind': status.kind, 'aria-hidden': 'true' }),
              h('span', { className: 'hcs-statusText', 'data-kind': status.kind, role: 'status', title: status.text || undefined }, status.text || t('statusReady'))),
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
              className: 'hcs-menu',
              style: { left: `${menu.x}px`, top: `${menu.y}px` },
              onMouseDown: (event) => event.stopPropagation(),
            },
            activeTask === undefined || activeTask.origin !== 'source'
              ? h(React.Fragment, null,
                h('button', { type: 'button', className: 'hcs-menuItem', onClick: menuDelete }, t('delete')),
                h('button', { type: 'button', className: 'hcs-menuItem', onClick: menuRename }, t('rename')),
                h('button', { type: 'button', className: 'hcs-menuItem', onClick: menuConvert }, t('convert')))
              : h(React.Fragment, null,
                h('button', { type: 'button', className: 'hcs-menuItem', onClick: menuConvert }, t('convert')),
                h('button', { type: 'button', className: 'hcs-menuItem', onClick: menuRefetch }, t('refetch'))))
            : null,
        wizard === null ? null : renderOverlay(renderTaskWizard(), theme)),
        cleanupDialog,
        confirmDialog,
        // 作业进度浮窗只在 SQL 工作台显示；切到任务中心/首页/设置时不打扰
        view === 'studio' ? hudLayers : null)
    }

    /** 语言状态 + 切换：界面所有文案都由它决定。 */
    function useLangToggle(props) {
      const [lang, setLang] = React.useState(readLang)
      const toggle = () => {
        const next = lang === 'zh' ? 'en' : 'zh'
        saveLang(next)
        setLang(next)
      }
      const set = (next) => {
        if (next !== 'zh' && next !== 'en') return
        saveLang(next)
        setLang(next)
      }
      const t = makeTranslator(lang, props.t)
      return { lang, setLang: set, toggle, t }
    }

    function HomeView(props) {
      const { lang, setLang, toggle, t } = useLangToggle(props)
      // 直接调用内部组件，保持返回的是一棵树（便于测试与渲染）
      return HomeViewBody({ ...props, t, lang, onSetLang: setLang, onToggleLang: toggle })
    }

    function StudioPage(props) {
      const { lang, setLang, toggle, t } = useLangToggle(props)
      return StudioPageBody({ ...props, t, lang, onSetLang: setLang, onToggleLang: toggle })
    }


    return {
      inject: ['slots', 'locale', 'uiWorkspace', 'layout', 'remote', 'remote.session', 'workspaces'],
      __convertLocally: convertLocally,
      __onlineConversionResult: onlineConversionResult,
      __normalizeQuotedIdentifiers: normalizeQuotedIdentifiers,
      __highlightSql: highlightSql,
      __detectInput: detectInput,
      __buildSinglePrompt: buildSinglePrompt,
      __connectionCrypto: { encryptWithKey, decryptWithKey, persistConnections, hydrateConnections },
      __compat: { COMPAT_MODES, compatModeForKind, taskCompatMode },
      __analysis: { diffLines, inlineDiff, groupRules, ruleInfo, RULE_CATALOG, RULE_CATEGORY_KEYS },
      __deps: { dependencyRefsOf, stripSqlNoise, dependencyIdent },
      __drop: { dropStatementFor, withDropStatement, stripDropPreamble, dropPreambleOf, planDependencyOrder },
      __homePreview: { HomeView, StudioPage, StudioTopNav, zh, en, PAGE_CSS, HOME_CSS, makeTranslator, readLang, saveLang },
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'hgdb-convert-studio: dictionaries')
        const t = ctx.locale.bind(NS)

        const start = (promptText) => {
          if (!ctx.uiWorkspace || typeof ctx.uiWorkspace.startSession !== 'function') {
            throw new Error('uiWorkspace.startSession is unavailable in this build')
          }
          ctx.uiWorkspace.startSession(undefined, {
            agentPreset: 'hgdb-convert-studio',
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
        const collect = async (sessionId, signal) => {
          const remote = ctx.remote && ctx.remote.session
          if (!remote || typeof remote.wait !== 'function') {
            return { ok: false, message: 'session remote is unavailable in this build', sessionId }
          }
          try {
            const parts = []
            let afterSeq
            for (let round = 0; round < 30 && !signal?.aborted; round += 1) {
              const value = unwrapRemote(await remote.wait({
                sessionId,
                ...(afterSeq === undefined ? {} : { afterSeq }),
                timeoutMs: 30000,
                maxMessages: 20,
              }))
              if (signal?.aborted) break
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
            if (signal?.aborted) return { ok: false, sessionId }
            const raw = parts.join('\n\n').trim()
            const text = raw
              .split('\n')
              .filter(line => !/(未连库验证|兼容模式能力假设|测试库实测确认|以上结论基于|编译与执行结果需)/.test(line))
              .join('\n')
              .trim()
            if (text === '') {
              return { ok: false, message: 'the agent returned no conversion output', sessionId }
            }
            return { ok: true, text, sessionId }
          } catch (error) {
            return {
              ok: false,
              message: error && error.message ? error.message : String(error),
              sessionId,
            }
          } finally {
            if (!signal?.aborted) void archiveQuietly(sessionId)
          }
        }

        /**
         * Run one conversion in a background Session and return its assistant text.
         * The Session is archived once the run finishes, so the list stays clean.
         */
        const convert = async (promptText, workspaceId, fileId, signal) => {
          const remote = ctx.remote && ctx.remote.session
          if (!remote || typeof remote.create !== 'function') {
            return { ok: false, message: 'session remote is unavailable in this build' }
          }
          let sessionId
          try {
            const created = unwrapRemote(await remote.create({
              ...(workspaceId === undefined ? {} : { workspaceId }),
              agentPreset: 'hgdb-convert-studio',
            }))
            if (!created || typeof created.sessionId !== 'string') {
              return { ok: false, message: 'session create returned no id' }
            }
            sessionId = created.sessionId
            rememberSession(sessionId)
            if (signal?.aborted) {
              void archiveQuietly(sessionId)
              return { ok: false, sessionId }
            }
            signal?.addEventListener('abort', () => { void archiveQuietly(sessionId) }, { once: true })
            markInflight(sessionId, fileId)
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
            if (sessionId !== undefined && !signal?.aborted) void archiveQuietly(sessionId)
            return {
              ok: false,
              message: error && error.message ? error.message : String(error),
              ...(sessionId === undefined ? {} : { sessionId }),
            }
          }
          return collect(sessionId, signal)
        }

        const archiveOne = archiveQuietly

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'hgdb-convert-studio',
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
              key: 'hgdb-convert-studio',
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
              id: 'hgdb-convert-studio',
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
