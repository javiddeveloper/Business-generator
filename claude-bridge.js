// Local model bridge → Anthropic-API compatible.
// Routes every request to the *active* coding engine, chosen from a small catalog:
//   1) Claude (Pro subscription via the `claude` CLI)   ← default
//   2) Gemini (Antigravity via the `agy` CLI)
//   3) GapGPT (OpenAI-compatible HTTP API, Iran-friendly)
// The active engine is stored in model-state.json and read fresh on every request,
// so switching from the dashboard / Bale takes effect immediately (no restart).
//
// Run it on the Mac itself (where the CLIs are installed and logged in):
//   node claude-bridge.js
// n8n (inside Docker) calls it via http://host.docker.internal:8787/v1/messages
//
// IMPORTANT: this bridge deliberately removes ANTHROPIC_API_KEY (and related auth
// env vars) before spawning a CLI. A stale ANTHROPIC_API_KEY in your shell would
// make `claude` try API-key auth instead of your Pro login and fail. Stripping it
// forces subscription auth.

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 8787;
const STATE_PATH = path.join(__dirname, 'model-state.json');
const SECRETS_PATH = path.join(__dirname, 'secrets.env');

// ---- model catalog -------------------------------------------------------
// kind 'cli'  → spawn `bin -p --output-format json [--model <model>]`
// kind 'http' → POST OpenAI-compatible /chat/completions
const MODELS = [
  { id: 'claude-pro', label: 'Claude (Pro)', kind: 'cli', bin: 'claude', model: process.env.CLAUDE_MODEL || '' },
  { id: 'gemini-antigravity', label: 'Gemini (Antigravity)', kind: 'cli', bin: 'agy', model: 'gemini-3-pro' },
  { id: 'gapgpt', label: 'GapGPT', kind: 'http', model: 'gpt-4o', keyEnv: 'GAPGPT_API_KEY', baseEnv: 'GAPGPT_BASE_URL', baseDefault: 'https://api.gapgpt.app/v1' },
];

function activeId() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')).active;
  } catch (e) {
    return MODELS[0].id;
  }
}
function activeModel() {
  return MODELS.find((m) => m.id === activeId()) || MODELS[0];
}
function setActive(id) {
  if (!MODELS.find((m) => m.id === id)) return false;
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify({ active: id }));
    return true;
  } catch (e) {
    return false;
  }
}

// Read a single key from secrets.env (the GapGPT key/base live there).
function secret(key) {
  try {
    const raw = fs.readFileSync(SECRETS_PATH, 'utf8');
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 0 || t.slice(0, i).trim() !== key) continue;
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return v;
    }
  } catch (e) {}
  return process.env[key] || '';
}

// Child env without any Anthropic API-key vars → CLI uses the subscription login.
const childEnv = { ...process.env };
delete childEnv.ANTHROPIC_API_KEY;
delete childEnv.ANTHROPIC_AUTH_TOKEN;
delete childEnv.ANTHROPIC_BASE_URL;

// ---- engine runners ------------------------------------------------------
function runCli(bin, model, prompt) {
  return new Promise((resolve) => {
    const args = ['-p', '--output-format', 'json'];
    if (model) args.push('--model', model);
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv });

    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ error: 'engine "' + bin + '" not runnable: ' + e.message }));
    child.on('close', () => {
      try {
        const r = JSON.parse(out);
        // claude/agy -p return { is_error, result, ... }. Surface real errors.
        if (r.is_error) return resolve({ error: r.result || r.subtype || 'unknown engine error' });
        return resolve({ text: r.result || r.text || r.response || out });
      } catch (e) {
        return resolve({ text: out || err });
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function runHttp(entry, prompt, maxTokens) {
  const key = secret(entry.keyEnv);
  if (!key) return { error: 'GapGPT key not set — add ' + entry.keyEnv + ' in secrets.env (Settings).' };
  const base = (secret(entry.baseEnv) || entry.baseDefault).replace(/\/$/, '');
  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: entry.model,
        max_tokens: maxTokens || 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { error: 'GapGPT ' + res.status + ': ' + ((j && j.error && j.error.message) || '') };
    const text = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    return { text };
  } catch (e) {
    return { error: 'GapGPT: ' + e.message };
  }
}

function runActive(prompt, maxTokens) {
  const m = activeModel();
  return m.kind === 'http' ? runHttp(m, prompt, maxTokens) : runCli(m.bin, m.model, prompt);
}

// ---- http helpers --------------------------------------------------------
const sendJson = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};
const publicModels = () => MODELS.map((m) => ({ id: m.id, label: m.label, kind: m.kind }));

http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://localhost');
  const p = u.pathname;

  // Model catalog + active selection (read by the dashboard / Bale).
  if (req.method === 'GET' && p === '/models') {
    return sendJson(res, 200, { models: publicModels(), active: activeId() });
  }
  if (req.method === 'POST' && p === '/model') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let id = u.searchParams.get('id') || '';
      if (!id) { try { id = (JSON.parse(body || '{}').id) || ''; } catch (e) {} }
      if (setActive(id)) return sendJson(res, 200, { ok: true, active: id });
      return sendJson(res, 400, { ok: false, error: 'unknown model id: ' + id, models: publicModels() });
    });
    return;
  }

  // Serve the customizable stacks/roles for n8n (which cannot require('fs')).
  if (req.method === 'GET' && (p.indexOf('/stack') === 0 || p.indexOf('/role') === 0)) {
    const isRole = p.indexOf('/role') === 0;
    const dir = isRole ? 'roles' : 'stacks';
    const allow = isRole ? /(product-owner|developer|tech-lead)/ : /(backend|frontend|mobile)/;
    const m = p.match(allow);
    let text = '';
    if (m) { try { text = fs.readFileSync(path.join(__dirname, dir, m[1] + '.md'), 'utf8'); } catch (e) { text = ''; } }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(text);
  }

  if (req.method !== 'POST') { res.writeHead(405); return res.end('POST only'); }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    // Extract the prompt (Anthropic-style messages or {prompt}) and max_tokens.
    let prompt = '', maxTokens = 0;
    try {
      const j = JSON.parse(body || '{}');
      maxTokens = Number(j.max_tokens) || 0;
      if (Array.isArray(j.messages) && j.messages.length) {
        prompt = j.messages
          .map((m) => (typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((x) => x.text || '').join('\n') : ''))
          .join('\n');
      } else if (j.prompt) {
        prompt = j.prompt;
      } else {
        prompt = body;
      }
    } catch (e) {
      prompt = body;
    }

    const result = await runActive(prompt, maxTokens);
    if (result.error) {
      console.error('[bridge] ' + activeId() + ' error:', result.error);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ content: [{ type: 'text', text: '' }], error: { type: 'engine_error', message: result.error } }));
    }
    // Return the Anthropic-API shape so all callers work unchanged.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text: result.text || '' }] }));
  });
}).listen(PORT, () => console.log('Model bridge ready on http://localhost:' + PORT + ' (active: ' + activeId() + ')'));
