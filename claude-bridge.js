// Local Claude Code bridge → Anthropic-API compatible.
// Uses the Claude Code / Pro subscription, NOT an API token.
// Run it on the Mac itself (where claude code is installed and logged in):
//   node claude-bridge.js
// n8n (inside Docker) calls it via http://host.docker.internal:8787/v1/messages
//
// IMPORTANT: this bridge deliberately removes ANTHROPIC_API_KEY (and related
// auth env vars) before spawning `claude`. If an (often stale) ANTHROPIC_API_KEY
// is exported in your shell — e.g. in ~/.zshrc — the claude CLI would try
// API-key auth instead of your Pro login and fail with
// "Invalid API key · Fix external API key". Stripping it forces subscription auth.

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 8787;

// Child env without any Anthropic API-key vars → claude uses the Pro login.
const childEnv = { ...process.env };
delete childEnv.ANTHROPIC_API_KEY;
delete childEnv.ANTHROPIC_AUTH_TOKEN;
delete childEnv.ANTHROPIC_BASE_URL;

http.createServer((req, res) => {
  // Serve the customizable files for n8n. Because n8n does not allow require('fs'),
  // the contents of stacks/*.md and roles/*.md are read from here (on the Mac):
  //   GET /stack/backend   |   GET /role/tech-lead
  if (req.method === 'GET' && req.url && (req.url.indexOf('/stack') === 0 || req.url.indexOf('/role') === 0)) {
    const isRole = req.url.indexOf('/role') === 0;
    const dir = isRole ? 'roles' : 'stacks';
    const allow = isRole ? /(product-owner|developer|tech-lead)/ : /(backend|frontend|mobile)/;
    const m = req.url.match(allow);
    let text = '';
    if (m) { try { text = fs.readFileSync(path.join(__dirname, dir, m[1] + '.md'), 'utf8'); } catch (e) { text = ''; } }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(text);
  }
  if (req.method !== 'POST') { res.writeHead(405); return res.end('POST only'); }

  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    // Extract the prompt text from an Anthropic-style body (messages) or {prompt}.
    let prompt = '';
    try {
      const j = JSON.parse(body || '{}');
      if (Array.isArray(j.messages) && j.messages.length) {
        prompt = j.messages.map(m => (typeof m.content === 'string'
          ? m.content
          : (Array.isArray(m.content) ? m.content.map(p => p.text || '').join('\n') : ''))).join('\n');
      } else if (j.prompt) {
        prompt = j.prompt;
      } else {
        prompt = body;
      }
    } catch (e) { prompt = body; }

    // claude code in print mode + json output.
    // To switch the model, set the CLAUDE_MODEL env var (e.g. sonnet or opus).
    const args = ['-p', '--output-format', 'json'];
    if (process.env.CLAUDE_MODEL) { args.push('--model', process.env.CLAUDE_MODEL); }
    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv,
    });

    let out = '', err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));

    child.on('error', (e) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text: 'bridge error: ' + e.message }] }));
    });

    child.on('close', () => {
      let text = '';
      try {
        const r = JSON.parse(out);
        // claude -p returns { is_error, result, ... }. If it failed (auth, quota,
        // etc.), surface a clear bridge-side error so callers don't mistake the
        // error string for a real answer.
        if (r.is_error) {
          const msg = r.result || r.subtype || 'unknown claude error';
          console.error('[bridge] claude error:', msg);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ content: [{ type: 'text', text: '' }], error: { type: 'claude_error', message: msg } }));
        }
        text = r.result || r.text || out;   // result is claude -p's output field
      } catch (e) {
        text = out || err;
      }
      // Return the response exactly like the Anthropic API so n8n nodes work unchanged.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text }] }));
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}).listen(PORT, () => console.log('Claude bridge ready on http://localhost:' + PORT));
