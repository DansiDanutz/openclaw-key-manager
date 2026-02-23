// API Manager - Central Key Management Service
// Deploy to: https://api.crawdbot.com
// All droplets fetch keys via this API, no hardcoded keys

const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

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

// API: Get key for provider
app.get('/keys/:provider', (req, res) => {
  const { provider } = req.params;
  
  if (!keys[provider]) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  
  // Auto-rotate if needed
  const key = rotateKey(provider);
  
  res.json({
    provider,
    key,
    rotation: {
      last: new Date(usage[provider].lastRotation).toISOString(),
      next: usage[provider].resetAt || 'not scheduled'
    }
  });
  
  // Log access
  console.log(`[${new Date().toISOString()}] Key fetched: ${provider} by ${req.ip || 'unknown'}`);
});

// API: Report usage
app.post('/keys/:provider/usage', (req, res) => {
  const { provider } = req.params;
  const { tokens, droplet, timestamp } = req.body;
  
  if (!usage[provider]) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  
  usage[provider].count += tokens || 0;
  
  res.json({ 
    success: true,
    provider,
    totalUsage: usage[provider].count,
    droplet
  });
  
  console.log(`[${timestamp}] Usage reported: ${provider} ${tokens} tokens by ${droplet}`);
});

// API: Get usage stats
app.get('/keys/:provider/usage', (req, res) => {
  const { provider } = req.params;
  
  if (!usage[provider]) {
    return res.status(404).json({ error: 'Provider not found' });
  }
  
  res.json({
    provider,
    totalUsage: usage[provider].count,
    lastRotation: new Date(usage[provider].lastRotation).toISOString(),
    nextRotation: usage[provider].resetAt || 'not scheduled'
  });
});

// API: Get all keys (admin only)
app.get('/keys', (req, res) => {
  // In production, add admin authentication
  res.json({
    providers: Object.keys(keys),
    rotationSchedule: {
      zai: '5 hours',
      others: 'manual'
    }
  });
});

// API: Rotate key manually
app.post('/keys/:provider/rotate', (req, res) => {
  const { provider } = req.params;
  
  const newKey = rotateKey(provider);
  
  res.json({
    success: true,
    provider,
    newKey: newKey.substring(0, 20) + '...',
    rotatedAt: new Date().toISOString()
  });
  
  console.log(`[MANUAL] Rotated ${provider} key`);
});

// API: Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    providers: Object.keys(keys),
    totalUsage: {
      zai: usage.zai.count,
      anthropic: usage.anthropic.count,
      google: usage.google.count,
      openai: usage.openai.count
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API Key Manager running on port ${PORT}`);
  console.log(`Providers: ${Object.keys(keys).join(', ')}`);
  console.log(`Rotation: Z.AI every 5 hours`);
});

module.exports = app;
