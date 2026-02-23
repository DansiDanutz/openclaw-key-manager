// API Manager - Single Vercel Function
// Central key management for OpenClaw agents

const crypto = require('crypto');

// Keys (in production, use encrypted database)
const keys = {
  zai: process.env.ZAI_KEY || '6255260d9af848e59b3dea57feb4096d.8ragfHsLnBbBSoFh',
  anthropic: process.env.ANTHROPIC_KEY || '',
  google: process.env.GOOGLE_KEY || '',
  openai: process.env.OPENAI_KEY || ''
};

// Usage tracking
const usage = {
  zai: { count: 0, lastRotation: Date.now(), resetAt: getNextRotation() },
  anthropic: { count: 0, lastRotation: Date.now() },
  google: { count: 0 },
  openai: { count: 0 }
};

function getNextRotation() {
  const now = new Date();
  const next = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  return next.toISOString();
}

function shouldRotate(provider) {
  if (provider === 'zai') {
    const resetTime = new Date(usage.zai.resetAt);
    return new Date() >= resetTime;
  }
  return false;
}

function rotateKey(provider) {
  if (!shouldRotate(provider)) return keys[provider];
  
  const backupKey = process.env[`${provider.toUpperCase()}_BACKUP_KEY`];
  if (backupKey) {
    keys[provider] = backupKey;
    usage[provider].lastRotation = Date.now();
    if (provider === 'zai') {
      usage[provider].resetAt = getNextRotation();
    }
  }
  return keys[provider];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method;
    
    // GET /health
    if (path === '/health' && method === 'GET') {
      return res.json({
        status: 'ok',
        providers: Object.keys(keys),
        totalUsage: {
          zai: usage.zai.count,
          anthropic: usage.anthropic.count,
          google: usage.google.count,
          openai: usage.openai.count
        }
      });
    }
    
    // GET /keys/:provider
    const keyMatch = path.match(/^\/keys\/([a-z]+)$/);
    if (keyMatch && method === 'GET') {
      const provider = keyMatch[1];
      if (!keys[provider]) {
        return res.status(404).json({ error: 'Provider not found' });
      }
      const key = rotateKey(provider);
      return res.json({
        provider,
        key,
        rotation: {
          last: new Date(usage[provider].lastRotation).toISOString(),
          next: usage[provider].resetAt || 'not scheduled'
        }
      });
    }
    
    // POST /keys/:provider/usage
    const usageMatch = path.match(/^\/keys\/([a-z]+)\/usage$/);
    if (usageMatch && method === 'POST') {
      const provider = usageMatch[1];
      if (!usage[provider]) {
        return res.status(404).json({ error: 'Provider not found' });
      }
      const body = await parseBody(req);
      usage[provider].count += body.tokens || 0;
      return res.json({ success: true, provider, totalUsage: usage[provider].count, droplet: body.droplet });
    }
    
    // POST /keys/:provider/rotate
    const rotateMatch = path.match(/^\/keys\/([a-z]+)\/rotate$/);
    if (rotateMatch && method === 'POST') {
      const provider = rotateMatch[1];
      if (!keys[provider]) {
        return res.status(404).json({ error: 'Provider not found' });
      }
      const newKey = rotateKey(provider);
      return res.json({ success: true, provider, rotatedAt: new Date().toISOString() });
    }
    
    // GET /keys
    if (path === '/keys' && method === 'GET') {
      return res.json({
        providers: Object.keys(keys),
        rotationSchedule: { zai: '5 hours', others: 'manual' }
      });
    }
    
    return res.status(404).json({ error: 'Not found' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
  });
}
