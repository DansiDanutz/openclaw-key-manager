import { timingSafeEqual } from 'node:crypto'

const PROVIDERS = new Set(['zai', 'anthropic', 'google', 'openai'])
const MAX_BODY_BYTES = 4096

function configuredOrigins() {
  return new Set(
    (process.env.KEY_MANAGER_ALLOWED_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
}

function applyCors(req, res) {
  const origin = req.headers.origin
  if (!origin || !configuredOrigins().has(origin)) return false

  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Vary', 'Origin')
  return true
}

function authenticate(req, res) {
  const expected = process.env.KEY_MANAGER_ADMIN_TOKEN
  if (!expected) {
    res.status(503).json({ error: 'service unavailable' })
    return false
  }

  const header = req.headers.authorization || ''
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : ''
  const expectedBuffer = Buffer.from(expected)
  const suppliedBuffer = Buffer.from(supplied)
  const valid = expectedBuffer.length === suppliedBuffer.length
    && timingSafeEqual(expectedBuffer, suppliedBuffer)

  if (!valid) {
    res.status(401).json({ error: 'unauthorized' })
    return false
  }
  return true
}

function providerKey(provider) {
  return process.env[`${provider.toUpperCase()}_KEY`] || ''
}

async function readJson(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      throw new Error('payload too large')
    }
  }
  return JSON.parse(body || '{}')
}

export default async function handler(req, res) {
  const corsAllowed = applyCors(req, res)
  if (req.method === 'OPTIONS') {
    return corsAllowed
      ? res.status(204).end()
      : res.status(403).json({ error: 'origin not allowed' })
  }

  try {
    const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`)
    const path = url.pathname

    if (path === '/health' && req.method === 'GET') {
      return res.json({ status: 'ok' })
    }

    if (!authenticate(req, res)) return

    if (path === '/keys' && req.method === 'GET') {
      const providers = [...PROVIDERS].filter((provider) => providerKey(provider))
      return res.json({ providers })
    }

    const keyMatch = path.match(/^\/keys\/([a-z]+)$/)
    if (keyMatch && req.method === 'GET') {
      const provider = keyMatch[1]
      if (!PROVIDERS.has(provider)) return res.status(404).json({ error: 'provider not found' })
      return res.json({ provider, configured: Boolean(providerKey(provider)) })
    }

    const usageMatch = path.match(/^\/keys\/([a-z]+)\/usage$/)
    if (usageMatch && req.method === 'POST') {
      const provider = usageMatch[1]
      if (!PROVIDERS.has(provider)) return res.status(404).json({ error: 'provider not found' })
      const body = await readJson(req)
      if (!Number.isSafeInteger(body.tokens) || body.tokens < 0) {
        return res.status(400).json({ error: 'invalid request' })
      }
      return res.status(501).json({ error: 'durable usage tracking not configured' })
    }

    const rotateMatch = path.match(/^\/keys\/([a-z]+)\/rotate$/)
    if (rotateMatch && req.method === 'POST') {
      if (!PROVIDERS.has(rotateMatch[1])) {
        return res.status(404).json({ error: 'provider not found' })
      }
      return res.status(501).json({ error: 'durable rotation not configured' })
    }

    return res.status(404).json({ error: 'not found' })
  } catch {
    return res.status(400).json({ error: 'invalid request' })
  }
}
