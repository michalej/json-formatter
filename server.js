const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const yaml = require('js-yaml');
const basicAuth = require('express-basic-auth');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// Basic Auth middleware (skip if env vars not set)
if (process.env.AUTH_USER && process.env.AUTH_PASS) {
  app.use(basicAuth({
    users: { [process.env.AUTH_USER]: process.env.AUTH_PASS },
    challenge: true,
    realm: 'JSON Formatter'
  }));
}

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

    let fixed = message.content[0].text.trim();
    fixed = fixed.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();

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

// YAML conversion
app.post('/api/to-yaml', (req, res) => {
  const { json } = req.body;
  if (!json) return res.status(400).json({ error: 'Missing json field' });
  try {
    const parsed = JSON.parse(json);
    const result = yaml.dump(parsed, { indent: 2, lineWidth: 120, noRefs: true });
    res.json({ result, valid: true });
  } catch (e) {
    res.json({ error: e.message, valid: false });
  }
});

app.post('/api/from-yaml', (req, res) => {
  const { yaml: yamlStr } = req.body;
  if (!yamlStr) return res.status(400).json({ error: 'Missing yaml field' });
  try {
    const parsed = yaml.load(yamlStr);
    const result = JSON.stringify(parsed, null, 2);
    res.json({ result, valid: true });
  } catch (e) {
    res.json({ error: e.message, valid: false });
  }
});

// Markdown conversion
app.post('/api/to-markdown', (req, res) => {
  const { json } = req.body;
  if (!json) return res.status(400).json({ error: 'Missing json field' });
  try {
    const parsed = JSON.parse(json);
    const result = jsonToMarkdown(parsed);
    res.json({ result, valid: true });
  } catch (e) {
    res.json({ error: e.message, valid: false });
  }
});

function jsonToMarkdown(data, depth = 0) {
  const prefix = '#'.repeat(Math.min(depth + 1, 6));
  if (data === null || data === undefined) return '_null_\n';
  if (typeof data !== 'object') return String(data) + '\n';

  if (Array.isArray(data)) {
    if (data.length === 0) return '_empty array_\n';
    // If array of objects with same keys → table
    if (data.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
      const allKeys = [...new Set(data.flatMap(obj => Object.keys(obj)))];
      if (allKeys.length > 0 && allKeys.length <= 20) {
        let md = '| ' + allKeys.join(' | ') + ' |\n';
        md += '| ' + allKeys.map(() => '---').join(' | ') + ' |\n';
        for (const row of data) {
          md += '| ' + allKeys.map(k => {
            const v = row[k];
            if (v === null || v === undefined) return '';
            if (typeof v === 'object') return '`' + JSON.stringify(v) + '`';
            return String(v);
          }).join(' | ') + ' |\n';
        }
        return md;
      }
    }
    // Fallback: list
    return data.map((item, i) => {
      if (typeof item === 'object' && item !== null) {
        return `- **[${i}]**\n` + jsonToMarkdown(item, depth + 1).split('\n').map(l => l ? '  ' + l : '').join('\n') + '\n';
      }
      return `- ${String(item)}\n`;
    }).join('');
  }

  // Object
  const entries = Object.entries(data);
  if (entries.length === 0) return '_empty object_\n';

  // Check if all values are simple
  const allSimple = entries.every(([, v]) => v === null || typeof v !== 'object');
  if (allSimple) {
    let md = '| Key | Value |\n| --- | --- |\n';
    for (const [k, v] of entries) {
      md += `| ${k} | ${v === null ? '_null_' : String(v)} |\n`;
    }
    return md;
  }

  let md = '';
  for (const [k, v] of entries) {
    if (v !== null && typeof v === 'object') {
      md += `${prefix} ${k}\n\n${jsonToMarkdown(v, depth + 1)}\n`;
    } else {
      md += `- **${k}**: ${v === null ? '_null_' : String(v)}\n`;
    }
  }
  return md;
}

app.post('/api/from-markdown', (req, res) => {
  const { markdown } = req.body;
  if (!markdown) return res.status(400).json({ error: 'Missing markdown field' });
  try {
    // Extract JSON from code blocks
    const codeBlockRegex = /```(?:json)?\s*\n([\s\S]*?)```/g;
    const blocks = [];
    let match;
    while ((match = codeBlockRegex.exec(markdown)) !== null) {
      blocks.push(match[1].trim());
    }
    if (blocks.length === 0) {
      return res.json({ error: 'No JSON code blocks found in markdown', valid: false });
    }
    // Try to parse each block, return first valid or all
    const results = [];
    for (const block of blocks) {
      try {
        results.push(JSON.parse(block));
      } catch (_) {
        // skip invalid blocks
      }
    }
    if (results.length === 0) {
      return res.json({ error: 'No valid JSON found in code blocks', valid: false });
    }
    const result = results.length === 1
      ? JSON.stringify(results[0], null, 2)
      : JSON.stringify(results, null, 2);
    res.json({ result, valid: true });
  } catch (e) {
    res.json({ error: e.message, valid: false });
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
