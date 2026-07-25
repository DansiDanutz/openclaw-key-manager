import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import test, { afterEach, beforeEach } from 'node:test'

import handler from '../api/index.js'

const ADMIN_TOKEN = 'a'.repeat(32)
const MANAGED_ENV = [
  'KEY_MANAGER_ADMIN_TOKEN',
  'KEY_MANAGER_ALLOWED_ORIGINS',
  'ZAI_KEY',
]
let originalEnv

beforeEach(() => {
  originalEnv = Object.fromEntries(MANAGED_ENV.map((name) => [name, process.env[name]]))
  for (const name of MANAGED_ENV) delete process.env[name]
})

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

function request(method, url, { body, token, origin } = {}) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)])
  req.method = method
  req.url = url
  req.headers = {
    host: 'api-manager.test',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(origin ? { origin } : {}),
  }
  return req
}

function response() {
  return {
    headers: {},
    statusCode: 200,
    body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
    end() { return this },
  }
}

async function invoke(method, url, options) {
  const res = response()
  await handler(request(method, url, options), res)
  return res
}

test('health is minimal and never exposes provider inventory', async () => {
  const res = await invoke('GET', '/health')
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { status: 'ok' })
})

test('key retrieval fails closed without an admin bearer token', async () => {
  process.env.KEY_MANAGER_ADMIN_TOKEN = ADMIN_TOKEN
  process.env.ZAI_KEY = 'test-provider-secret'
  const res = await invoke('GET', '/keys/zai')
  assert.equal(res.statusCode, 401)
  assert.deepEqual(res.body, { error: 'unauthorized' })
})

test('key retrieval fails closed when server auth is not configured', async () => {
  process.env.ZAI_KEY = 'test-provider-secret'
  const res = await invoke('GET', '/keys/zai', { token: 'anything' })
  assert.equal(res.statusCode, 503)
  assert.deepEqual(res.body, { error: 'service unavailable' })
})

test('matching weak admin tokens fail closed as unavailable', async () => {
  process.env.KEY_MANAGER_ADMIN_TOKEN = 'short-token'
  const res = await invoke('GET', '/keys', { token: 'short-token' })
  assert.equal(res.statusCode, 503)
  assert.deepEqual(res.body, { error: 'service unavailable' })
})

test('the shipped example admin token cannot authenticate', async () => {
  const example = await readFile(new URL('../.env.example', import.meta.url), 'utf8')
  const configured = example.match(/^KEY_MANAGER_ADMIN_TOKEN=(.*)$/m)?.[1] ?? ''
  process.env.KEY_MANAGER_ADMIN_TOKEN = configured

  const res = await invoke('GET', '/keys', { token: configured })
  assert.equal(res.statusCode, 503)
  assert.deepEqual(res.body, { error: 'service unavailable' })
})

test('authenticated provider status never returns the provider secret', async () => {
  process.env.KEY_MANAGER_ADMIN_TOKEN = ADMIN_TOKEN
  process.env.ZAI_KEY = 'test-provider-secret'
  const res = await invoke('GET', '/keys/zai', { token: ADMIN_TOKEN })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { provider: 'zai', configured: true })
  assert.equal(JSON.stringify(res.body).includes('test-provider-secret'), false)
})

test('usage rejects malformed and negative token counts', async () => {
  process.env.KEY_MANAGER_ADMIN_TOKEN = ADMIN_TOKEN
  const malformed = await invoke('POST', '/keys/zai/usage', {
    token: ADMIN_TOKEN, body: { tokens: -1 },
  })
  assert.equal(malformed.statusCode, 400)
  assert.deepEqual(malformed.body, { error: 'invalid request' })
})

test('CORS is not enabled for an unlisted origin', async () => {
  process.env.KEY_MANAGER_ADMIN_TOKEN = ADMIN_TOKEN
  const res = await invoke('GET', '/health', { origin: 'https://attacker.example' })
  assert.equal(res.headers['access-control-allow-origin'], undefined)
})

test('privileged requests from an unlisted browser origin are rejected before auth', async () => {
  process.env.KEY_MANAGER_ADMIN_TOKEN = ADMIN_TOKEN
  process.env.KEY_MANAGER_ALLOWED_ORIGINS = 'https://trusted.example'
  process.env.ZAI_KEY = 'test-provider-secret'

  const res = await invoke('GET', '/keys/zai', {
    origin: 'https://attacker.example',
    token: ADMIN_TOKEN,
  })

  assert.equal(res.statusCode, 403)
  assert.deepEqual(res.body, { error: 'origin not allowed' })
  assert.equal(JSON.stringify(res.body).includes('test-provider-secret'), false)
})
