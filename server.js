const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let db;

async function connectDB() {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('json_formatter');
    await db.collection('history').createIndex({ timestamp: -1 });
    console.log('MongoDB connected');
  } catch (err) {
    console.warn('MongoDB not available, history disabled:', err.message);
  }
}

// Format JSON
app.post('/api/format', (req, res) => {
  const { json, indent = 2 } = req.body;
  if (!json || typeof json !== 'string') return res.status(400).json({ error: 'Missing json field' });
  if (json.length > 1_000_000) return res.status(400).json({ error: 'Input too large (max 1MB)' });

  try {
    const parsed = JSON.parse(json);
    const formatted = JSON.stringify(parsed, null, indent === 'tab' ? '\t' : Number(indent));
    res.json({ formatted, valid: true });
  } catch (e) {
    res.json({ error: e.message, valid: false });
  }
});

// Minify JSON
app.post('/api/minify', (req, res) => {
  const { json } = req.body;
  if (!json) return res.status(400).json({ error: 'Missing json field' });
  try {
    const formatted = JSON.stringify(JSON.parse(json));
    res.json({ formatted, valid: true });
  } catch (e) {
    res.json({ error: e.message, valid: false });
  }
});

// AI Fix
app.post('/api/fix', async (req, res) => {
  const { json } = req.body;
  if (!json) return res.status(400).json({ error: 'Missing json field' });
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  try {
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Fix the JSON syntax errors in the following text. Do not change any values, keys, or structure. Only fix syntax issues (missing commas, brackets, quotes, trailing commas, etc). Return ONLY the fixed JSON, nothing else — no markdown, no explanation.\n\n${json}`
      }]
    });

    const fixed = message.content[0].text.trim();

    // Generate simple diff
    const originalLines = json.split('\n');
    const fixedLines = fixed.split('\n');
    const changes = [];
    const maxLen = Math.max(originalLines.length, fixedLines.length);
    for (let i = 0; i < maxLen; i++) {
      if (originalLines[i] !== fixedLines[i]) {
        changes.push({ line: i + 1, original: originalLines[i] || '', fixed: fixedLines[i] || '' });
      }
    }

    res.json({ fixed, changes, valid: true });
  } catch (e) {
    res.status(500).json({ error: 'AI fix failed: ' + e.message });
  }
});

// History endpoints
app.get('/api/history', async (req, res) => {
  if (!db) return res.json([]);
  try {
    const items = await db.collection('history').find().sort({ timestamp: -1 }).limit(50).toArray();
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/history', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not available' });
  const { content, formatted } = req.body;
  if (!content) return res.status(400).json({ error: 'Missing content' });
  try {
    const doc = {
      content,
      formatted: formatted || content,
      timestamp: new Date(),
      label: content.replace(/\s+/g, ' ').substring(0, 50)
    };
    const result = await db.collection('history').insertOne(doc);
    res.json({ id: result.insertedId, ...doc });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/history/:id', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not available' });
  try {
    await db.collection('history').deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

connectDB().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`JSON Formatter running on http://0.0.0.0:${PORT}`);
  });
});
