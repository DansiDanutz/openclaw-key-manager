// API Health Check
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    if (req.url === '/health') {
      return res.json({
        status: 'ok',
        providers: ['zai', 'anthropic', 'google', 'openai'],
        totalUsage: {
          zai: 50000,
          anthropic: 25000,
          google: 10000,
          openai: 15000
        }
      });
    }
    
    return res.status(404).json({ error: 'Not found' });
    
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
