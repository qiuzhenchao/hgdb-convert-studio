/**
 * Host half of HGDB Convert Studio: local routes for connection tests, object reading,
 * script execution and schema listing — every engine (Oracle / MySQL / SQL Server / HGDB V9)
 * goes through the bundled JDBC drivers.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_JAR = fileURLToPath(new URL('./drivers/postgresql.jar', import.meta.url))
const DEFAULT_ORACLE_JAR = fileURLToPath(new URL('./drivers/oracle.jar', import.meta.url))
const DEFAULT_MYSQL_JAR = fileURLToPath(new URL('./drivers/mysql.jar', import.meta.url))
const DEFAULT_CLASSES = fileURLToPath(new URL('./tools/classes', import.meta.url))

/** Host 侧插件版本：前端用它判断是否连到了旧实例。 */
const PLUGIN_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
  } catch {
    return ''
  }
})()

/** 最近一次连接测试的入参与结果，供 /last-test 排查。 */
let lastConnTest = null

/** First existing driver among the configured path and the bundled one. */
function resolveJar(configured, bundled) {
  const candidates = [configured, bundled].filter(item => typeof item === 'string' && item !== '')
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      /* keep looking */
    }
  }
  return undefined
}

/**
 * 两类 Oracle 连接用的是不同驱动，不能混用：
 *   - 真 Oracle 源库（kind=oracle）：Oracle JDBC（drivers/oracle.jar）
 *   - 瀚高 Oracle 兼容形态（kind=hgdb-oracle）：只能使用瀚高自己的驱动，Oracle 驱动不被接受
 */

/** 真 Oracle 源库驱动：配置 > drivers/oracle.jar。 */
function resolveOracleJar(configured) {
  return resolveJar(configured, DEFAULT_ORACLE_JAR)
}

/** 瀚高 Oracle 兼容驱动的候选文件名（放进 drivers/ 即自动生效）。 */
const HGDB_ORACLE_JAR_ALIASES = [
  'drivers/hgdb-oracle.jar',
  'drivers/hgdb-oracle-jdbc.jar',
  'drivers/hgdb.jar',
  'drivers/hgdb_jdbc.jar',
]

/**
 * 瀚高 Oracle 兼容驱动：配置 hgdbOracleJar > drivers/ 下单独的厂商驱动 > 内置瀚高 JDBC。
 * 注意：HGDB-V9-Oracle 不接受 Oracle 官方驱动；内置的 drivers/postgresql.jar 就是瀚高随包的 JDBC。
 */
function resolveHgdbOracleJar(configured) {
  const custom = resolveJar(configured, undefined)
  if (custom !== undefined) return custom
  for (const alias of HGDB_ORACLE_JAR_ALIASES) {
    let candidate
    try {
      candidate = fileURLToPath(new URL(`./${alias}`, import.meta.url))
    } catch {
      continue
    }
    if (resolveJar(undefined, candidate) !== undefined) return candidate
  }
  return resolveJar(undefined, DEFAULT_JAR)
}

/** 瀚高驱动的 JDBC URL：默认按 PG 协议拼，可用 hgdbOracleUrlPrefix 覆盖（例如 jdbc:highgo）。 */
function hgdbOracleUrl(config, host, port, database) {
  const prefix = typeof config.hgdbOracleUrlPrefix === 'string' && config.hgdbOracleUrlPrefix !== ''
    ? config.hgdbOracleUrlPrefix
    : 'jdbc:postgresql'
  return `${prefix}://${host}:${port}/${database}?sslmode=disable`
}

/** 瀚高驱动类名候选：不同版本可能不同，逐个尝试。 */
const HGDB_ORACLE_DRIVERS = ['com.highgo.jdbc.Driver', 'com.highgo.Driver', 'org.postgresql.Driver']

/** 当前 Oracle 驱动文件名，便于在提示里说明用的是哪一个。 */
export function oracleDriverName(jarPath) {
  if (typeof jarPath !== 'string' || jarPath === '') return ''
  const parts = jarPath.split(/[\\/]/)
  return parts[parts.length - 1]
}

/** First existing MySQL driver among the configured path and the bundled one. */
function resolveMysqlJar(configured) {
  return resolveJar(configured, DEFAULT_MYSQL_JAR)
}

/** JDBC URL for a MySQL source; timezone/SSL options match the bundled connector. */
export function mysqlJdbcUrl(host, port, database) {
  return `jdbc:mysql://${host}:${port}/${database}?useSSL=false&allowPublicKeyRetrieval=true`
    + '&serverTimezone=Asia/Shanghai&connectTimeout=10000&socketTimeout=60000&characterEncoding=UTF-8'
}

/** Object types the MySQL reader understands. */
export const MYSQL_OBJECT_TYPES = ['TABLE', 'VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER', 'EVENT']

/** Read objects (DDL) from one MySQL source database. */
export async function readMysqlObjects({ jar, classes, host, port, database, user, password, schema, types, limit, jobId = '' }) {
  const argsFor = (targetSchema) => [
    '--url', mysqlJdbcUrl(host, port, database),
    '--user', user,
    '--password', password,
    '--schema', targetSchema,
    '--limit', String(limit),
    ...(types.length === 0 ? [] : ['--types', types.join(',')]),
  ]
  const run = await runJavaClass({
    jar,
    classes,
    mainClass: 'ReadMysqlObjects',
    args: argsFor(schema === '' ? database : schema),
    timeoutMs: 90000,
    jobId,
  })
  const objects = run.code === 0 ? parseObjects(run.output) : undefined
  if (objects === undefined) {
    const firstLine = run.output.split('\n').find(line => line.trim() !== '') ?? '读取失败'
    return { ok: false, message: `读取失败：${firstLine.slice(0, 200)}`, output: run.output.slice(-4000) }
  }
  return { ok: true, objects }
}

export const inject = ['webServer']

/** Read one small JSON request body. */
async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 2 * 1024 * 1024) throw new Error('request body is too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? {} : JSON.parse(text)
}

/** Reply with one JSON object. */
function reply(res, status, value) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(value))
}

/** Verify JDBC login using the same Java launcher as reads and execution. */
async function runConnTest({ jar, classes, url, user, password, timeoutMs = 20000, drivers = [] }) {
  const run = await runJavaClass({
    jar,
    classes,
    mainClass: 'ConnTest',
    args: [
      '--url', url,
      '--user', user,
      '--password', password,
      ...(drivers.length === 0 ? [] : ['--driver', drivers.join(',')]),
    ],
    timeoutMs,
  })
  const output = run.output.trim()
  const firstLine = output.split('\n').find(line => line.trim() !== '') ?? ''
  return {
    ok: run.code === 0,
    message: run.timedOut
      ? `测试超时（${Math.round(timeoutMs / 1000)}s）`
      : run.code === 0 ? '连接成功' : `测试失败（exit ${run.code}）：${firstLine.slice(0, 160) || '无输出'}`,
    output,
  }
}

/** Running Java children keyed by client job id, so a cancel request can stop them. */
const activeChildren = new Map()
const cancelledJobs = new Set()

/** 最近一次解析到的 Java 进度（jobId -> { done, total }），供前端轮询。 */
const jobProgress = new Map()

/** Kill a Java child and its descendants (Windows launcher may hold the real JVM). */
function killProcessTree(child) {
  if (child === undefined || child === null) return
  if (process.platform === 'win32' && typeof child.pid === 'number') {
    try {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      return
    } catch {
      /* fall back to child.kill */
    }
  }
  try {
    child.kill('SIGKILL')
  } catch {
    /* already gone */
  }
}

function javaExecutable() {
  const binary = process.platform === 'win32' ? 'java.exe' : 'java'
  if (process.env.JAVA_HOME) {
    const configured = join(process.env.JAVA_HOME, 'bin', binary)
    if (existsSync(configured)) return configured
  }
  if (process.platform !== 'win32') return binary

  // Oracle's javapath redirector can hang before the JVM even starts.
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const path = directory.replace(/^"|"$/g, '')
    if (path === '' || /[\\/]Oracle[\\/]Java[\\/]javapath(?:[\\/]|$)/i.test(path)) continue
    const candidate = join(path, binary)
    if (existsSync(candidate)) return candidate
  }
  if (process.env.ProgramFiles) {
    const javaDir = join(process.env.ProgramFiles, 'Java')
    const installations = readdirSync(javaDir, { throwIfNoEntry: false }) ?? []
    installations.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
    for (const installation of installations) {
      const candidate = join(javaDir, installation, 'bin', binary)
      if (existsSync(candidate)) return candidate
    }
  }
  return binary
}

/** Run one Java class with the bundle's drivers and classes. */
function runJavaClass({ jar, classes, mainClass, args, timeoutMs = 45000, jobId = '' }) {
  if (cancelledJobs.has(jobId)) {
    return Promise.resolve({ code: -1, output: '作业已停止' })
  }
  return new Promise((resolve) => {
    let settled = false
    let timer
    let output = ''
    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      if (jobId !== '') {
        activeChildren.delete(jobId)
        setTimeout(() => jobProgress.delete(jobId), 30000)
      }
      resolve(value)
    }
    let child
    try {
      child = spawn(javaExecutable(), [
        '-Djava.net.preferIPv4Stack=true',
        '-Dfile.encoding=UTF-8',
        '-cp', `${jar}${delimiter}${classes}`,
        mainClass,
        ...args,
      ], { windowsHide: true })
    } catch (error) {
      finish({ code: -1, output: error instanceof Error ? error.message : String(error) })
      return
    }
    if (jobId !== '') activeChildren.set(jobId, child)
    const collect = (chunk) => {
      const text = chunk.toString()
      output += text
      if (jobId === '') return
      // Java 侧会打印 PROGRESS done/total，这里取最后一次
      const matches = text.match(/PROGRESS\s+(\d+)\/(\d+)/g)
      if (matches === null) return
      const last = matches[matches.length - 1]
      const parsed = /PROGRESS\s+(\d+)\/(\d+)/.exec(last)
      if (parsed !== null) {
        jobProgress.set(jobId, { done: Number(parsed[1]), total: Number(parsed[2]) })
      }
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.once('error', (error) => finish({ code: -1, output: error.message }))
    timer = setTimeout(() => {
      killProcessTree(child)
      finish({ code: -1, output: `Java 操作超时（${Math.round(timeoutMs / 1000)}s）`, timedOut: true })
    }, timeoutMs)
    child.once('close', (code) => finish({ code, output }))
  })
}

/** Extract the JSON array printed by a helper class. */
function parseJsonArray(output) {
  const start = output.indexOf('[')
  const end = output.lastIndexOf(']')
  if (start < 0 || end <= start) return undefined
  try {
    const value = JSON.parse(output.slice(start, end + 1))
    return Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** Extract the JSON array printed by ReadObjects. */
function parseObjects(output) {
  const start = output.indexOf('[')
  const end = output.lastIndexOf(']')
  if (start < 0 || end <= start) return undefined
  try {
    const value = JSON.parse(output.slice(start, end + 1))
    return Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Run many scripts in ONE JVM and ONE connection (batch mode).
 * `items` is [{ id, sql }]; returns { code, output, results } where results keep the original ids.
 */
async function runSqlBatch({ jar, classes, items, url, user, password, schema = '', jobId = '' }) {
  let dir
  try {
    dir = await mkdtemp(join(tmpdir(), 'plsql-batch-'))
    const order = []
    for (let index = 0; index < items.length; index += 1) {
      const name = String(index).padStart(5, '0')
      order.push({ file: name, id: items[index].id })
      await writeFile(join(dir, `${name}.sql`), items[index].sql, 'utf8')
    }
    const args = ['--url', url, '--user', user, '--password', password, '--dir', dir]
    if (typeof schema === 'string' && schema.trim() !== '') args.push('--schema', schema.trim())
    const run = await runJavaClass({
      jar,
      classes,
      mainClass: 'SqlBatchRunner',
      args,
      timeoutMs: Math.max(120000, items.length * 4000),
      jobId,
    })
    const byFile = new Map()
    for (const line of run.output.split('\n')) {
      const text = line.trim()
      if (!text.startsWith('{')) continue
      try {
        const value = JSON.parse(text)
        if (value !== null && typeof value === 'object' && typeof value.id === 'string') {
          byFile.set(value.id, value)
        }
      } catch {
        /* ignore non-JSON log lines */
      }
    }
    const results = order.map(({ file, id }) => {
      const found = byFile.get(file)
      return found === undefined
        ? { id, ok: false, error: '执行器没有返回该文件的结果', statements: 0 }
        : { id, ok: found.ok === true, error: typeof found.error === 'string' ? found.error : '', statements: found.statements ?? 0 }
    })
    return { code: run.code, output: run.output, results }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      code: -1,
      output: message,
      results: items.map(item => ({ id: item.id, ok: false, error: message, statements: 0 })),
    }
  } finally {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Run one SQL script through the bundled PG runner and clean the temp file afterwards. */
async function runSqlScript({ jar, classes, sql, url, user, password, jobId = '' }) {
  let dir
  try {
    dir = await mkdtemp(join(tmpdir(), 'plsql-exec-'))
    const file = join(dir, 'script.sql')
    await writeFile(file, sql, 'utf8')
    return await runJavaClass({
      jar,
      classes,
      mainClass: 'SqlRunner',
      args: ['--url', url, '--user', user, '--password', password, '--file', file],
      timeoutMs: 120000,
      jobId,
    })
  } catch (error) {
    return { code: -1, output: error instanceof Error ? error.message : String(error) }
  } finally {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** @param ctx - Host context owning the web server route. */
export function apply(ctx, config = {}) {
  const jar = typeof config.jdbcJar === 'string' ? config.jdbcJar : DEFAULT_JAR
  const classes = typeof config.classes === 'string' ? config.classes : DEFAULT_CLASSES

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/hgdb-convert-studio/test',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        reply(res, 405, { ok: false, message: 'POST only' })
        return
      }
      let body
      try {
        body = await readJson(req)
      } catch (error) {
        reply(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
        return
      }
      // 记录本次请求，便于用 /last-test 排查“界面说超时但实际能连”的情况
      lastConnTest = {
        at: new Date().toISOString(),
        version: PLUGIN_VERSION,
        kind: typeof body.kind === 'string' ? body.kind : '',
        host: typeof body.host === 'string' ? body.host : '',
        port: Number(body.port),
        database: typeof body.database === 'string' ? body.database : '',
        user: typeof body.user === 'string' ? body.user : '',
        hasPassword: typeof body.password === 'string' && body.password !== '',
        result: null,
      }

      // 统一把版本号带进响应，前端据此判断是否连到旧 Host
      const replyTest = (response, payload) => {
        if (lastConnTest !== null) lastConnTest.result = { ok: payload.ok, message: String(payload.message ?? '').slice(0, 300) }
        reply(response, 200, { ...payload, version: PLUGIN_VERSION })
      }
      const host = typeof body.host === 'string' ? body.host.trim() : ''
      const port = Number(body.port)
      const user = typeof body.user === 'string' ? body.user : ''
      const password = typeof body.password === 'string' ? body.password : ''
      const database = typeof body.database === 'string' ? body.database.trim() : ''
      const rawKind = typeof body.kind === 'string' ? body.kind : ''
      // 注意：hgdb-oracle（瀚高 Oracle 兼容）与 oracle（真 Oracle）不是同一个驱动
      const kind = rawKind === 'oracle'
        ? 'oracle'
        : rawKind === 'hgdb-oracle'
          ? 'hgdb-oracle'
          : rawKind === 'mysql'
            ? 'mysql'
            : rawKind === 'hgdb-mysql' ? 'hgdb-mysql' : 'hgdb'
      if (host === '' || !Number.isInteger(port) || port <= 0 || port > 65535) {
        reply(res, 400, { ok: false, message: '需要有效的主机与端口' })
        return
      }
      if (kind === 'mysql' || kind === 'hgdb-mysql') {
        if (user === '' || database === '') {
          reply(res, 400, { ok: false, message: 'MySQL 协议连接需要用户名与数据库名' })
          return
        }
        const mysqlJar = resolveMysqlJar(config.mysqlJar)
        if (mysqlJar === undefined) {
          replyTest(res, { ok: false, message: '未找到 MySQL JDBC 驱动（drivers/mysql.jar）' })
          return
        }
        const result = await runConnTest({
          jar: kind === 'hgdb-mysql' ? [mysqlJar, jar].join(delimiter) : mysqlJar,
          classes,
          url: mysqlJdbcUrl(host, port, database),
          user,
          password,
        })
        replyTest(res, result)
        return
      }
      if (kind === 'hgdb-oracle') {
        if (user === '' || database === '') {
          reply(res, 400, { ok: false, message: 'HGDB-V9-Oracle 测试需要用户名与数据库名' })
          return
        }
        // HGDB-V9-Oracle 不接受 Oracle 官方驱动，只能使用瀚高 JDBC（PostgreSQL 协议，默认 15219）
        const hgdbJar = resolveHgdbOracleJar(config.hgdbOracleJar)
        if (hgdbJar === undefined) {
          reply(res, 500, { ok: false, message: '未找到瀚高 JDBC 驱动（drivers/postgresql.jar）' })
          return
        }
        const result = await runConnTest({
          jar: [hgdbJar, jar].join(delimiter),
          classes,
          url: hgdbOracleUrl(config, host, port, database),
          user,
          password,
          drivers: HGDB_ORACLE_DRIVERS,
        })
        const driver = oracleDriverName(hgdbJar)
        replyTest(res, {
          ok: result.ok,
          message: result.ok ? result.message : `${result.message}\n驱动：${driver}`,
          output: result.output,
        })
        return
      }
      if (kind === 'oracle') {
        if (user === '' || database === '') {
          reply(res, 400, { ok: false, message: 'Oracle 测试需要用户名与数据库/服务名' })
          return
        }
        const oracleJar = resolveOracleJar(config.oracleJar)
        if (oracleJar === undefined) {
          replyTest(res, { ok: false, message: '未找到 Oracle JDBC 驱动（drivers/oracle.jar）' })
          return
        }
        const serviceUrl = `jdbc:oracle:thin:@//${host}:${port}/${database}`
        const testUrl = (url) => runConnTest({ jar: oracleJar, classes, url, user, password })
        let result = await testUrl(serviceUrl)
        if (!result.ok) {
          // 与获取对象一致，先试服务名，再试 SID。
          const sidResult = await testUrl(`jdbc:oracle:thin:@${host}:${port}:${database}`)
          if (sidResult.ok) result = sidResult
          else result = { ...sidResult, message: `服务名方式：${result.message}\nSID 方式：${sidResult.message}` }
        }
        const driver = oracleDriverName(oracleJar)
        const suffix = driver === '' ? '' : `\n驱动：${driver}`
        replyTest(res, {
          ok: result.ok,
          message: result.ok ? result.message : `${result.message}${suffix}`,
          output: result.output,
        })
        return
      }
      if (user === '' || database === '') {
        reply(res, 400, { ok: false, message: 'HGDB 测试需要用户名与数据库名' })
        return
      }
      const url = `jdbc:postgresql://${host}:${port}/${database}?sslmode=disable`
      const result = await runConnTest({ jar, classes, url, user, password })
      replyTest(res, result)
    },
  }), 'hgdb-convert-studio: connection test route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/hgdb-convert-studio/last-test',
    handler: async (req, res) => {
      reply(res, 200, {
        ok: true,
        version: PLUGIN_VERSION,
        last: lastConnTest,
      })
    },
  }), 'hgdb-convert-studio: last connection test diagnostics')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/hgdb-convert-studio/read-objects',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        reply(res, 405, { ok: false, message: 'POST only' })
        return
      }
      let body
      try {
        body = await readJson(req)
      } catch (error) {
        reply(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
        return
      }
      const host = typeof body.host === 'string' ? body.host.trim() : ''
      const port = Number(body.port)
      const user = typeof body.user === 'string' ? body.user : ''
      const password = typeof body.password === 'string' ? body.password : ''
      const schema = typeof body.schema === 'string' ? body.schema.trim() : ''
      const limit = Number.isInteger(body.limit) ? Math.min(Math.max(body.limit, 1), 500) : 200
      // 读取进度：Java 侧打印 PROGRESS done/total，前端轮询 /job-progress
      const readJobId = typeof body.jobId === 'string' ? body.jobId.slice(0, 120) : ''
      if (host === '' || !Number.isInteger(port) || port <= 0 || port > 65535) {
        reply(res, 400, { ok: false, message: '需要有效的主机与端口' })
        return
      }
      if (user === '') {
        reply(res, 400, { ok: false, message: '需要用户名' })
        return
      }
      const database = typeof body.database === 'string' ? body.database.trim() : ''
      const kind = body.kind === 'mysql' ? 'mysql' : 'oracle'
      if (kind === 'mysql') {
        if (database === '') {
          reply(res, 400, { ok: false, message: 'MySQL 读取需要数据库名' })
          return
        }
        const mysqlJar = resolveMysqlJar(config.mysqlJar)
        if (mysqlJar === undefined) {
          reply(res, 500, { ok: false, message: '未找到 MySQL JDBC 驱动（drivers/mysql.jar）' })
          return
        }
        const types = Array.isArray(body.types)
          ? body.types.filter(item => typeof item === 'string' && MYSQL_OBJECT_TYPES.includes(item))
          : []
        const result = await readMysqlObjects({
          jar: mysqlJar,
          classes,
          host,
          port,
          database,
          user,
          password,
          schema,
          types,
          limit,
          jobId: readJobId,
        })
        reply(res, 200, result)
        return
      }
      const oracleJar = resolveOracleJar(config.oracleJar)
      if (oracleJar === undefined) {
        reply(res, 500, { ok: false, message: '未找到 Oracle JDBC 驱动（drivers/oracle.jar）' })
        return
      }
      const ALLOWED_TYPES = ['TABLE', 'VIEW', 'MATERIALIZED VIEW', 'FUNCTION', 'PROCEDURE', 'PACKAGE', 'PACKAGE BODY', 'TRIGGER', 'TYPE', 'SEQUENCE', 'SYNONYM', 'JOB']
      const types = Array.isArray(body.types)
        ? body.types.filter(item => typeof item === 'string' && ALLOWED_TYPES.includes(item))
        : []
      const argsFor = (url) => ['--url', url, '--user', user, '--password', password, '--limit', String(limit), ...(schema === '' ? [] : ['--schema', schema]), ...(types.length === 0 ? [] : ['--types', types.join(',')])]
      const serviceUrl = `jdbc:oracle:thin:@//${host}:${port}/${typeof body.database === 'string' ? body.database.trim() : ''}`
      let run = await runJavaClass({ jar: oracleJar, classes, mainClass: 'ReadObjects', args: argsFor(serviceUrl), timeoutMs: 90000, jobId: readJobId })
      let objects = run.code === 0 ? parseObjects(run.output) : undefined
      if (objects === undefined) {
        const sidUrl = `jdbc:oracle:thin:@${host}:${port}:${typeof body.database === 'string' ? body.database.trim() : ''}`
        const sidRun = await runJavaClass({ jar: oracleJar, classes, mainClass: 'ReadObjects', args: argsFor(sidUrl), timeoutMs: 90000, jobId: readJobId })
        const sidObjects = sidRun.code === 0 ? parseObjects(sidRun.output) : undefined
        if (sidObjects !== undefined) {
          objects = sidObjects
          run = sidRun
        }
      }
      if (objects === undefined) {
        const firstLine = run.output.split('\n').find(line => line.trim() !== '') ?? '读取失败'
        reply(res, 200, { ok: false, message: `读取失败：${firstLine.slice(0, 200)}`, output: run.output.slice(-4000) })
        return
      }
      reply(res, 200, { ok: true, objects })
    },
  }), 'hgdb-convert-studio: read source objects route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/hgdb-convert-studio/execute',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        reply(res, 405, { ok: false, message: 'POST only' })
        return
      }
      let body
      try {
        body = await readJson(req)
      } catch (error) {
        reply(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
        return
      }
      const host = typeof body.host === 'string' ? body.host.trim() : ''
      const port = Number(body.port)
      const user = typeof body.user === 'string' ? body.user : ''
      const password = typeof body.password === 'string' ? body.password : ''
      const database = typeof body.database === 'string' ? body.database.trim() : ''
      const sql = typeof body.sql === 'string' ? body.sql : ''
      if (host === '' || !Number.isInteger(port) || port <= 0 || port > 65535 || database === '' || user === '') {
        reply(res, 400, { ok: false, message: '需要有效的目标库连接信息' })
        return
      }
      if (sql.trim() === '') {
        reply(res, 400, { ok: false, message: '没有可执行的 SQL' })
        return
      }
      const url = `jdbc:postgresql://${host}:${port}/${database}?sslmode=disable`
      const targetKind = body.kind === 'hgdb-mysql' ? 'hgdb-mysql' : 'hgdb'
      let executeUrl = url
      let executeJar = jar
      if (targetKind === 'hgdb-mysql') {
        const mysqlJar = resolveMysqlJar(config.mysqlJar)
        if (mysqlJar === undefined) {
          reply(res, 500, { ok: false, message: '未找到 MySQL JDBC 驱动（drivers/mysql.jar）' })
          return
        }
        executeUrl = mysqlJdbcUrl(host, port, database)
        // SqlRunner 可能显式加载 PostgreSQL 驱动，两个驱动都放进 classpath。
        executeJar = [mysqlJar, jar].join(delimiter)
      } else if (body.kind === 'hgdb-oracle') {
        // 瀚高 Oracle 兼容形态必须用瀚高自己的驱动，Oracle 官方驱动不被接受
        const hgdbJar = resolveHgdbOracleJar(config.hgdbOracleJar)
        if (hgdbJar === undefined) {
          reply(res, 500, { ok: false, message: '缺少瀚高 Oracle 兼容驱动：请把瀚高提供的 JDBC 驱动放到 drivers/hgdb-oracle.jar，或在插件配置 hgdbOracleJar 指定路径' })
          return
        }
        executeUrl = hgdbOracleUrl(config, host, port, database)
        executeJar = [hgdbJar, jar].join(delimiter)
      }
      const jobId = typeof body.jobId === 'string' ? body.jobId.slice(0, 120) : ''
      const result = await runSqlScript({ jar: executeJar, classes, sql, url: executeUrl, user, password, jobId })
      reply(res, 200, {
        ok: result.code === 0,
        message: result.code === 0 ? '执行成功' : '执行失败',
        output: result.output.slice(-8000),
      })
    },
  }), 'hgdb-convert-studio: execute script route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/hgdb-convert-studio/execute-batch',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        reply(res, 405, { ok: false, message: 'POST only' })
        return
      }
      let body
      try {
        body = await readJson(req)
      } catch (error) {
        reply(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
        return
      }
      const host = typeof body.host === 'string' ? body.host.trim() : ''
      const port = Number(body.port)
      const user = typeof body.user === 'string' ? body.user : ''
      const password = typeof body.password === 'string' ? body.password : ''
      const database = typeof body.database === 'string' ? body.database.trim() : ''
      const schema = typeof body.schema === 'string' ? body.schema : ''
      const items = Array.isArray(body.items)
        ? body.items
          .filter(item => item !== null && typeof item === 'object' && typeof item.id === 'string' && typeof item.sql === 'string' && item.sql.trim() !== '')
          .slice(0, 500)
          .map(item => ({ id: item.id.slice(0, 200), sql: item.sql }))
        : []
      if (host === '' || !Number.isInteger(port) || port <= 0 || port > 65535 || database === '' || user === '') {
        reply(res, 400, { ok: false, message: '需要有效的目标库连接信息' })
        return
      }
      if (items.length === 0) {
        reply(res, 400, { ok: false, message: '没有可执行的 SQL' })
        return
      }
      const url = `jdbc:postgresql://${host}:${port}/${database}?sslmode=disable`
      let executeUrl = url
      let executeJar = jar
      if (body.kind === 'hgdb-mysql') {
        const mysqlJar = resolveMysqlJar(config.mysqlJar)
        if (mysqlJar === undefined) {
          reply(res, 500, { ok: false, message: '未找到 MySQL JDBC 驱动（drivers/mysql.jar）' })
          return
        }
        executeUrl = mysqlJdbcUrl(host, port, database)
        executeJar = [mysqlJar, jar].join(delimiter)
      } else if (body.kind === 'hgdb-oracle') {
        const hgdbJar = resolveHgdbOracleJar(config.hgdbOracleJar)
        if (hgdbJar === undefined) {
          reply(res, 500, { ok: false, message: '缺少瀚高 Oracle 兼容驱动：请把瀚高提供的 JDBC 驱动放到 drivers/hgdb-oracle.jar，或在插件配置 hgdbOracleJar 指定路径' })
          return
        }
        executeUrl = hgdbOracleUrl(config, host, port, database)
        executeJar = [hgdbJar, jar].join(delimiter)
      }
      const jobId = typeof body.jobId === 'string' ? body.jobId.slice(0, 120) : ''
      const run = await runSqlBatch({
        jar: executeJar,
        classes,
        items,
        url: executeUrl,
        user,
        password,
        schema,
        jobId,
      })
      const okCount = run.results.filter(item => item.ok).length
      reply(res, 200, {
        ok: okCount === run.results.length,
        message: okCount === run.results.length ? '执行成功' : `${run.results.length - okCount} 个对象执行失败`,
        results: run.results,
        output: run.output.slice(-8000),
      })
    },
  }), 'hgdb-convert-studio: execute batch route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/hgdb-convert-studio/schemas',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        reply(res, 405, { ok: false, message: 'POST only' })
        return
      }
      let body
      try {
        body = await readJson(req)
      } catch (error) {
        reply(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
        return
      }
      const host = typeof body.host === 'string' ? body.host.trim() : ''
      const port = Number(body.port)
      const user = typeof body.user === 'string' ? body.user : ''
      const password = typeof body.password === 'string' ? body.password : ''
      const database = typeof body.database === 'string' ? body.database.trim() : ''
      if (host === '' || !Number.isInteger(port) || port <= 0 || port > 65535 || database === '' || user === '') {
        reply(res, 400, { ok: false, message: '需要有效的目标库连接信息' })
        return
      }
      const url = `jdbc:postgresql://${host}:${port}/${database}?sslmode=disable`
      const targetKind = body.kind === 'hgdb-mysql' ? 'hgdb-mysql' : 'hgdb'
      let schemaUrl = url
      let schemaJar = jar
      if (targetKind === 'hgdb-mysql') {
        const mysqlJar = resolveMysqlJar(config.mysqlJar)
        if (mysqlJar === undefined) {
          reply(res, 500, { ok: false, message: '未找到 MySQL JDBC 驱动（drivers/mysql.jar）' })
          return
        }
        schemaUrl = mysqlJdbcUrl(host, port, database)
        schemaJar = [mysqlJar, jar].join(delimiter)
      }
      const run = await runJavaClass({
        jar: schemaJar,
        classes,
        mainClass: 'ListSchemas',
        args: ['--url', schemaUrl, '--user', user, '--password', password],
        timeoutMs: 45000,
      })
      const schemas = run.code === 0 ? parseJsonArray(run.output) : undefined
      if (schemas === undefined) {
        const firstLine = run.output.split('\n').find(line => line.trim() !== '') ?? '读取模式失败'
        reply(res, 200, { ok: false, message: firstLine.slice(0, 200), output: run.output.slice(-4000) })
        return
      }
      reply(res, 200, { ok: true, schemas })
    },
  }), 'hgdb-convert-studio: list target schemas route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/hgdb-convert-studio/dependencies',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        reply(res, 405, { ok: false, message: 'POST only' })
        return
      }
      let body
      try {
        body = await readJson(req)
      } catch (error) {
        reply(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
        return
      }
      const kind = typeof body.kind === 'string' ? body.kind : ''
      const host = typeof body.host === 'string' ? body.host.trim() : ''
      const port = Number(body.port)
      const user = typeof body.user === 'string' ? body.user : ''
      const password = typeof body.password === 'string' ? body.password : ''
      const database = typeof body.database === 'string' ? body.database.trim() : ''
      const schema = typeof body.schema === 'string' ? body.schema.trim() : ''
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const names = Array.isArray(body.names)
        ? body.names.filter(item => typeof item === 'string' && item.trim() !== '').map(item => item.trim()).slice(0, 300)
        : []
      const ddlOf = typeof body.ddlOf === 'string' ? body.ddlOf.trim() : ''
      const ddlType = typeof body.type === 'string' ? body.type.trim() : ''
      if (host === '' || !Number.isInteger(port) || port <= 0 || port > 65535 || database === '' || user === '') {
        reply(res, 400, { ok: false, message: '需要有效的源库连接信息' })
        return
      }
      if (name === '' && names.length === 0 && ddlOf === '') {
        reply(res, 400, { ok: false, message: '需要对象名' })
        return
      }
      // MySQL 的 schema 就是库名：任务里的 schema 可能是 Oracle 风格的名字，
      // 直接拼进 information_schema 查询会查不到任何依赖，所以这里以库名为准。
      const scope = kind === 'mysql' ? database : schema
      const argsFor = (url) => {
        const value = ['--url', url, '--user', user, '--password', password]
        if (names.length > 0) value.push('--names', names.join(','))
        else if (ddlOf !== '') value.push('--ddl-of', ddlOf)
        else value.push('--name', name)
        if (ddlType !== '') value.push('--type', ddlType)
        if (scope !== '') value.push('--schema', scope)
        return value
      }
      const runDeps = (url, jar) => runJavaClass({
        jar,
        classes,
        mainClass: 'ReadDependencies',
        args: argsFor(url),
        timeoutMs: names.length > 0 ? 120000 : 60000,
        jobId: typeof body.jobId === 'string' ? body.jobId.slice(0, 120) : '',
      })
      let run
      let items
      if (kind === 'mysql') {
        const mysqlJar = resolveMysqlJar(config.mysqlJar)
        if (mysqlJar === undefined) {
          reply(res, 500, { ok: false, message: '未找到 MySQL JDBC 驱动（drivers/mysql.jar）' })
          return
        }
        run = await runDeps(mysqlJdbcUrl(host, port, database), [mysqlJar, jar].join(delimiter))
        items = run.code === 0 ? parseJsonArray(run.output) : undefined
      } else {
        // Oracle：先按 service name，再退回 SID（与读取对象一致）
        const oracleJar = resolveOracleJar(config.oracleJar)
        if (oracleJar === undefined) {
          reply(res, 500, { ok: false, message: '未找到 Oracle JDBC 驱动（drivers/oracle.jar）' })
          return
        }
        run = await runDeps(`jdbc:oracle:thin:@//${host}:${port}/${database}`, oracleJar)
        items = run.code === 0 ? parseJsonArray(run.output) : undefined
        if (items === undefined) {
          const sidRun = await runDeps(`jdbc:oracle:thin:@${host}:${port}:${database}`, oracleJar)
          const sidItems = sidRun.code === 0 ? parseJsonArray(sidRun.output) : undefined
          if (sidItems !== undefined) {
            items = sidItems
            run = sidRun
          }
        }
      }
      if (items === undefined) {
        const firstLine = run.output.split('\n').find(line => line.trim() !== '') ?? '读取依赖失败'
        reply(res, 200, { ok: false, message: firstLine.slice(0, 200), output: run.output.slice(-4000) })
        return
      }
      const clean = items.filter(item => item !== null && typeof item === 'object')
      if (names.length > 0) {
        reply(res, 200, {
          ok: true,
          results: clean
            .filter(item => typeof item.object === 'string')
            .map(item => ({
              object: item.object,
              deps: Array.isArray(item.deps)
                ? item.deps.filter(dep => dep !== null && typeof dep === 'object' && typeof dep.name === 'string')
                  .map(dep => ({ name: dep.name, type: typeof dep.type === 'string' ? dep.type : '' }))
                : [],
            })),
        })
        return
      }
      reply(res, 200, {
        ok: true,
        items: clean
          .filter(item => typeof item.name === 'string')
          .map(item => ({
            name: item.name,
            type: typeof item.type === 'string' ? item.type : '',
            ddl: typeof item.ddl === 'string' ? item.ddl : '',
          })),
      })
    },
  }), 'hgdb-convert-studio: read source object dependencies route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/hgdb-convert-studio/job-progress',
    handler: async (req, res) => {
      const jobId = new URL(req.url, 'http://127.0.0.1').searchParams.get('jobId') ?? ''
      const value = jobId === '' ? undefined : jobProgress.get(jobId)
      reply(res, 200, value === undefined
        ? { ok: true, done: 0, total: 0 }
        : { ok: true, done: value.done, total: value.total })
    },
  }), 'hgdb-convert-studio: job progress route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/hgdb-convert-studio/cancel',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        reply(res, 405, { ok: false, message: 'POST only' })
        return
      }
      let body
      try {
        body = await readJson(req)
      } catch (error) {
        reply(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) })
        return
      }
      const jobId = typeof body.jobId === 'string' ? body.jobId : ''
      if (jobId.length > 0 && jobId.length <= 120 && !cancelledJobs.has(jobId)) {
        cancelledJobs.add(jobId)
        setTimeout(() => cancelledJobs.delete(jobId), 30000).unref()
      }
      const child = jobId === '' ? undefined : activeChildren.get(jobId)
      if (child === undefined) {
        reply(res, 200, { ok: true, cancelled: false })
        return
      }
      try {
        killProcessTree(child)
      } catch {
        /* the process may already be gone */
      }
      activeChildren.delete(jobId)
      reply(res, 200, { ok: true, cancelled: true })
    },
  }), 'hgdb-convert-studio: cancel running script route')
}
