import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

import handler from '../api/index.js'

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
  process.env.KEY_MANAGER_ADMIN_TOKEN = 'test-admin-token'
  process.env.ZAI_KEY = 'test-provider-secret'
  const res = await invoke('GET', '/keys/zai')
  assert.equal(res.statusCode, 401)
  assert.deepEqual(res.body, { error: 'unauthorized' })
})

test('key retrieval fails closed when server auth is not configured', async () => {
  delete process.env.KEY_MANAGER_ADMIN_TOKEN
  process.env.ZAI_KEY = 'test-provider-secret'
  const res = await invoke('GET', '/keys/zai', { token: 'anything' })
  assert.equal(res.statusCode, 503)
  assert.deepEqual(res.body, { error: 'service unavailable' })
})

test('authenticated provider status never returns the provider secret', async () => {
  process.env.KEY_MANAGER_ADMIN_TOKEN = 'test-admin-token'
  process.env.ZAI_KEY = 'test-provider-secret'
  const res = await invoke('GET', '/keys/zai', { token: 'test-admin-token' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { provider: 'zai', configured: true })
  assert.equal(JSON.stringify(res.body).includes('test-provider-secret'), false)
})

test('usage rejects malformed and negative token counts', async () => {
  process.env.KEY_MANAGER_ADMIN_TOKEN = 'test-admin-token'
  const malformed = await invoke('POST', '/keys/zai/usage', {
    token: 'test-admin-token', body: { tokens: -1 },
  })
  assert.equal(malformed.statusCode, 400)
  assert.deepEqual(malformed.body, { error: 'invalid request' })
})

test('CORS is not enabled for an unlisted origin', async () => {
  process.env.KEY_MANAGER_ADMIN_TOKEN = 'test-admin-token'
  delete process.env.KEY_MANAGER_ALLOWED_ORIGINS
  const res = await invoke('GET', '/health', { origin: 'https://attacker.example' })
  assert.equal(res.headers['access-control-allow-origin'], undefined)
})
