/**
 * Host half of PLSQL Studio: one local route that tests a PostgreSQL/HGDB
 * connection with the bundled JDBC driver, or reports TCP reachability for
 * engines without a driver.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_JAR = fileURLToPath(new URL('./drivers/postgresql.jar', import.meta.url))
const DEFAULT_ORACLE_JAR = fileURLToPath(new URL('./drivers/oracle.jar', import.meta.url))
const DEFAULT_MYSQL_JAR = fileURLToPath(new URL('./drivers/mysql.jar', import.meta.url))
const DEFAULT_CLASSES = fileURLToPath(new URL('./tools/classes', import.meta.url))

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

/** First existing Oracle driver among the configured path and the bundled one. */
function resolveOracleJar(configured) {
  return resolveJar(configured, DEFAULT_ORACLE_JAR)
}

/** First existing MySQL driver among the configured path and the bundled one. */
function resolveMysqlJar(configured) {
  return resolveJar(configured, DEFAULT_MYSQL_JAR)
}

/** JDBC URL for a MySQL source; timezone/SSL options match the bundled connector. */
export function mysqlJdbcUrl(host, port, database) {
  return `jdbc:mysql://${host}:${port}/${database}?useSSL=false&allowPublicKeyRetrieval=true`
    + '&serverTimezone=Asia/Shanghai&connectTimeout=8000&socketTimeout=20000&characterEncoding=UTF-8'
}

/** Object types the MySQL reader understands. */
export const MYSQL_OBJECT_TYPES = ['TABLE', 'VIEW', 'FUNCTION', 'PROCEDURE', 'TRIGGER', 'EVENT']

/** Read objects (DDL) from one MySQL source database. */
export async function readMysqlObjects({ jar, classes, host, port, database, user, password, schema, types, limit }) {
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

/** Build a success message that includes the server version ConnTest read. */
function connectionMessage(result) {
  const version = /SERVER_VERSION:\s*(.+)/.exec(result.output ?? '')
  const text = version === null ? '' : version[1].trim().split(' on ')[0]
  return result.ok && text !== '' ? `连接成功（${text}）` : result.message
}

/** Check that a TCP port accepts a connection. */
function probePort(host, port) {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    const finish = (ok, message) => {
      socket.destroy()
      resolve({ ok, message })
    }
    socket.setTimeout(5000, () => finish(false, `连接 ${host}:${port} 超时`))
    socket.once('connect', () => finish(true, `端口 ${host}:${port} 可连接`))
    socket.once('error', (error) => finish(false, error.message))
  })
}

/** Open one JDBC connection and read its version; no temporary files involved. */
function runConnTest({ jar, classes, url, user, password }) {
  return new Promise((resolve) => {
    let settled = false
    let timer
    let output = ''
    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      resolve(value)
    }
    let child
    try {
      child = spawn('java', [
        '-Dfile.encoding=UTF-8',
        '-cp', `${jar}${delimiter}${classes}`,
        'ConnTest',
        '--url', url,
        '--user', user,
        '--password', password,
      ], { windowsHide: true })
    } catch (error) {
      finish({ ok: false, message: error instanceof Error ? error.message : String(error), output: '' })
      return
    }
    const collect = (chunk) => { output += chunk.toString() }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.once('error', (error) => finish({ ok: false, message: error.message, output }))
    timer = setTimeout(() => {
      child.kill()
      finish({ ok: false, message: '测试超时（20s）', output })
    }, 20000)
    child.once('close', (code) => {
      const detail = output.trim()
      const firstLine = detail.split('\n').find(line => line.trim() !== '') ?? ''
      finish({
        ok: code === 0,
        message: code === 0
          ? '连接成功'
          : `测试失败（exit ${code}）${firstLine === '' ? '，无输出' : `：${firstLine.slice(0, 160)}`}`,
        output: detail,
      })
    })
  })
}

/** Running Java children keyed by client job id, so a cancel request can stop them. */
const activeChildren = new Map()

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

/** Run one Java class with the bundle's drivers and classes. */
function runJavaClass({ jar, classes, mainClass, args, timeoutMs = 45000, jobId = '' }) {
  return new Promise((resolve) => {
    let settled = false
    let timer
    let output = ''
    const finish = (value) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      if (jobId !== '') activeChildren.delete(jobId)
      resolve(value)
    }
    let child
    try {
      child = spawn('java', [
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
    const collect = (chunk) => { output += chunk.toString() }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.once('error', (error) => finish({ code: -1, output: error.message }))
    timer = setTimeout(() => {
      killProcessTree(child)
      finish({ code: -1, output: '读取超时（45s）' })
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
    path: '/api/plsql-studio/test',
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
      const kind = body.kind === 'oracle' ? 'oracle' : body.kind === 'mysql' ? 'mysql' : body.kind === 'hgdb-mysql' ? 'hgdb-mysql' : 'hgdb'
      if (host === '' || !Number.isInteger(port) || port <= 0 || port > 65535) {
        reply(res, 400, { ok: false, message: '需要有效的主机与端口' })
        return
      }
      if (kind === 'hgdb-mysql') {
        if (user === '' || database === '') {
          reply(res, 400, { ok: false, message: 'HGDB（MySQL 协议）测试需要用户名与默认 schema/库名' })
          return
        }
        const mysqlJar = resolveMysqlJar(config.mysqlJar)
        if (mysqlJar === undefined) {
          const probe = await probePort(host, port)
          reply(res, 200, {
            ok: probe.ok,
            message: probe.ok ? `${probe.message}（未找到 MySQL JDBC 驱动，仅验证端口）` : probe.message,
            output: '',
          })
          return
        }
        const result = await runConnTest({ jar: mysqlJar, classes, url: mysqlJdbcUrl(host, port, database), user, password })
        reply(res, 200, {
          ok: result.ok,
          message: connectionMessage(result),
          output: result.output,
        })
        return
      }
      if (kind === 'mysql') {
        if (user === '' || database === '') {
          reply(res, 400, { ok: false, message: 'MySQL 测试需要用户名与数据库名' })
          return
        }
        const mysqlJar = resolveMysqlJar(config.mysqlJar)
        if (mysqlJar === undefined) {
          const probe = await probePort(host, port)
          reply(res, 200, {
            ok: probe.ok,
            message: probe.ok ? `${probe.message}（未找到 MySQL JDBC 驱动，仅验证端口）` : probe.message,
            output: '',
          })
          return
        }
        const result = await runConnTest({ jar: mysqlJar, classes, url: mysqlJdbcUrl(host, port, database), user, password })
        const productLine = (result.output ?? '').split('\n').find(line => line.trim() !== '') ?? ''
        reply(res, 200, {
          ok: result.ok,
          message: result.ok && productLine.trim() !== '' ? `连接成功（${productLine.trim()}）` : result.message,
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
          const probe = await probePort(host, port)
          reply(res, 200, {
            ok: probe.ok,
            message: probe.ok ? `${probe.message}（未找到 Oracle JDBC 驱动，仅验证端口）` : probe.message,
            output: '',
          })
          return
        }
        const serviceUrl = `jdbc:oracle:thin:@//${host}:${port}/${database}`
        let result = await runConnTest({ jar: oracleJar, classes, url: serviceUrl, user, password })
        if (!result.ok) {
          const sidUrl = `jdbc:oracle:thin:@${host}:${port}:${database}`
          const sidResult = await runConnTest({ jar: oracleJar, classes, url: sidUrl, user, password })
          if (sidResult.ok) result = sidResult
          else result = { ...sidResult, message: `服务名方式：${result.message}\nSID 方式：${sidResult.message}` }
        }
        reply(res, 200, { ok: result.ok, message: result.message, output: result.output })
        return
      }
      if (user === '' || database === '') {
        reply(res, 400, { ok: false, message: 'HGDB 测试需要用户名与数据库名' })
        return
      }
      const url = `jdbc:postgresql://${host}:${port}/${database}?sslmode=disable`
      const result = await runConnTest({ jar, classes, url, user, password })
      reply(res, 200, { ok: result.ok, message: connectionMessage(result), output: result.output })
    },
  }), 'plsql-studio: connection test route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/plsql-studio/read-objects',
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
      let run = await runJavaClass({ jar: oracleJar, classes, mainClass: 'ReadObjects', args: argsFor(serviceUrl), timeoutMs: 90000 })
      let objects = run.code === 0 ? parseObjects(run.output) : undefined
      if (objects === undefined) {
        const sidUrl = `jdbc:oracle:thin:@${host}:${port}:${typeof body.database === 'string' ? body.database.trim() : ''}`
        const sidRun = await runJavaClass({ jar: oracleJar, classes, mainClass: 'ReadObjects', args: argsFor(sidUrl), timeoutMs: 90000 })
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
  }), 'plsql-studio: read source objects route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/plsql-studio/execute',
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
      }
      const jobId = typeof body.jobId === 'string' ? body.jobId.slice(0, 120) : ''
      const result = await runSqlScript({ jar: executeJar, classes, sql, url: executeUrl, user, password, jobId })
      reply(res, 200, {
        ok: result.code === 0,
        message: result.code === 0 ? '执行成功' : '执行失败',
        output: result.output.slice(-8000),
      })
    },
  }), 'plsql-studio: execute script route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/plsql-studio/schemas',
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
  }), 'plsql-studio: list target schemas route')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/api/plsql-studio/cancel',
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
  }), 'plsql-studio: cancel running script route')
}