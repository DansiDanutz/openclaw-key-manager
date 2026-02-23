// API Manager - Vercel Serverless Version
// Central key management for OpenClaw agents

const crypto = require('crypto');

// In-memory key store (in production, use encrypted database)
const keys = {
  zai: process.env.ZAI_KEY || '6255260d9af848e59b3dea57feb4096d.8ragfHsLnBbBSoFh',
  anthropic: process.env.ANTHROPIC_KEY || '', // Rotating keys
  google: process.env.GOOGLE_KEY || '',
  openai: process.env.OPENAI_KEY || ''
};

// Usage tracking for rotation
const usage = {
  zai: { count: 0, lastRotation: Date.now(), resetAt: getNextRotation() },
  anthropic: { count: 0, lastRotation: Date.now() },
  google: { count: 0 },
  openai: { count: 0 }
};

// Get next rotation time (5 hours for Z.AI)
function getNextRotation() {
  const now = new Date();
  const next = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  return next.toISOString();
}

// Check if rotation needed
function shouldRotate(provider) {
  if (provider === 'zai') {
    const resetTime = new Date(usage.zai.resetAt);
    return new Date() >= resetTime;
  }
  return false;
}

// Rotate key if needed
function rotateKey(provider) {
  if (!shouldRotate(provider)) return keys[provider];
  
  console.log(`Rotating ${provider} key...`);
  // In production, fetch from secure vault
  // For now, use environment backup
  const backupKey = process.env[`${provider.toUpperCase()}_BACKUP_KEY`];
  
  if (backupKey) {
    keys[provider] = backupKey;
    usage[provider].lastRotation = Date.now();
    
    if (provider === 'zai') {
      usage[provider].resetAt = getNextRotation();
    }
    
    console.log(`${provider} key rotated`);
  }
  
  return keys[provider];
}

// Main handler (Vercel serverless)
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  // Handle OPTIONS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method;
    
    // GET /keys/zai
    if (path === '/keys/zai' && method === 'GET') {
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
      
      // Auto-rotate if needed
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
      
      // Parse body
      const body = await parseBody(req);
      const { tokens, droplet, timestamp } = body;
      
      usage[provider].count += tokens || 0;
      
      return res.json({ 
        success: true,
        provider,
        totalUsage: usage[provider].count,
        droplet
      });
    }
    
    // POST /keys/:provider/rotate
    const rotateMatch = path.match(/^\/keys\/([a-z]+)\/rotate$/);
    if (rotateMatch && method === 'POST') {
      const provider = rotateMatch[1];
      
      if (!keys[provider]) {
        return res.status(404).json({ error: 'Provider not found' });
      }
      
      const newKey = rotateKey(provider);
      
      return res.json({
        success: true,
        provider,
        newKey: newKey.substring(0, 20) + '...',
        rotatedAt: new Date().toISOString()
      });
    }
    
    // GET /keys (admin)
    if (path === '/keys' && method === 'GET') {
      return res.json({
        providers: Object.keys(keys),
        rotationSchedule: {
          zai: '5 hours',
          others: 'manual'
        }
      });
    }
    
    // 404
    return res.status(404).json({ error: 'Not found' });
    
  } catch (error) {
    console.error('Error:', error);
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
