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
const os = require('os');

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

// ==========================================================================
// Real-agent developer flow: clone the repo on the Mac, run the active CLI
// engine *inside* the checkout with full tools (Read/Edit/Write/Bash/Grep) and
// auto-approve (headless), then commit + push the task branch. n8n turns the
// returned data into a PR. Only CLI engines (claude/agy) can drive this — an
// HTTP engine (gapgpt) has no agent loop, so /code-task refuses it (Aider, a
// later phase, will bridge that gap).
// ==========================================================================

const AGENT_TIMEOUT_MS = 20 * 60 * 1000; // a real task may take a while
const WORKSPACE_DEFAULT = path.join(os.homedir(), '.business-generator', 'workspaces');

function workspaceRoot() {
  let d = (secret('WORKSPACE_DIR') || '').trim() || WORKSPACE_DEFAULT;
  if (d === '~' || d.startsWith('~/')) d = path.join(os.homedir(), d.slice(1));
  return d;
}

// Never let the GitHub token surface in logs / responses.
function redact(s) {
  const tk = secret('GITHUB_TOKEN');
  let r = String(s == null ? '' : s);
  if (tk) r = r.split(tk).join('***');
  return r;
}

// Accepts owner/repo, a full https URL, or git@github.com:owner/repo and returns
// an authenticated https clone URL with the token embedded. Local paths, file://
// URLs and non-GitHub remotes (mirrors/forks on other hosts, or local test repos)
// pass through untouched — only GitHub references get the token.
function buildAuthUrl(src, token) {
  const s = String(src || '').trim();
  if (/^(file:\/\/|\/|\.\/|\.\.\/)/.test(s)) return s;
  if (/^https?:\/\//i.test(s) && !/(^|\/\/)([^/]*\.)?github\.com\//i.test(s)) return s;
  if (/^git@/i.test(s) && !/github\.com/i.test(s)) return s;
  const slug = s
    .replace(/^git@github\.com:/i, '')
    .replace(/^https?:\/\/[^/@]*@github\.com\//i, '')
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^github\.com\//i, '')
    .replace(/\.git$/, '');
  return 'https://' + token + '@github.com/' + slug + '.git';
}

// Headless agent arguments per CLI. claude is the tested path; agy is best-effort
// (assumed claude-compatible flags) until validated on a machine that has it.
function agentArgs(bin, model) {
  const args = ['-p', '--output-format', 'json'];
  if (model) args.push('--model', model);
  if (bin === 'claude') {
    args.push('--dangerously-skip-permissions', '--allowedTools', 'Read Edit Write Bash Grep');
  } else {
    // agy / other CLIs: best-effort auto-approve. Adjust if the CLI differs.
    args.push('--dangerously-skip-permissions', '--allowedTools', 'Read Edit Write Bash Grep');
  }
  return args;
}

// Spawn a git subcommand; resolves { code, out, err } (never rejects).
function git(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, env: childEnv });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ code: -1, out, err: String(err) + e.message }));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}
async function gitOrThrow(args, cwd, label) {
  const r = await git(args, cwd);
  if (r.code !== 0) throw new Error(redact((label || 'git ' + args[0]) + ': ' + (r.err || r.out)).slice(0, 400));
  return r;
}

// GapGPT is a plain chat API, not an agent. To let it edit a real checkout we
// wrap it with Aider (https://aider.chat): Aider drives the file edits via git
// while talking to GapGPT over its OpenAI-compatible endpoint. Requires `aider`
// installed on the Mac (pip install aider-chat). We pass --no-auto-commit so our
// own commit/push flow stays uniform across engines.
function runAiderInDir(entry, prompt, cwd) {
  return new Promise((resolve) => {
    const key = secret(entry.keyEnv);
    if (!key) return resolve({ error: 'GapGPT key not set — add ' + entry.keyEnv + ' in secrets.env (Settings).' });
    const base = (secret(entry.baseEnv) || entry.baseDefault).replace(/\/$/, '');
    const env = { ...childEnv, OPENAI_API_KEY: key, OPENAI_API_BASE: base };
    const args = ['--no-auto-commit', '--yes-always', '--model', 'openai/' + entry.model, '--message', prompt];
    const child = spawn('aider', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env });
    let out = '', err = '', done = false;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} finish({ error: 'aider timed out after ' + Math.round(AGENT_TIMEOUT_MS / 60000) + 'm' }); }, AGENT_TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => finish({ error: 'aider not runnable (pip install aider-chat?): ' + e.message }));
    child.on('close', (code) => {
      if (code !== 0 && !out) return finish({ error: (err || 'aider exited ' + code).slice(0, 600) });
      finish({ summary: String(out || err).slice(0, 4000) });
    });
  });
}

// Pick the right agent runner for the active engine.
function runEngineInDir(engine, prompt, cwd) {
  if (engine.kind === 'cli') return runAgentInDir(engine.bin, engine.model, prompt, cwd);
  if (engine.id === 'gapgpt') return runAiderInDir(engine, prompt, cwd);
  return Promise.resolve({ error: 'engine "' + engine.label + '" is not agent-capable' });
}

// Run the active CLI engine inside `cwd` with full tools + auto-approve.
function runAgentInDir(bin, model, prompt, cwd) {
  return new Promise((resolve) => {
    const child = spawn(bin, agentArgs(bin, model), { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: childEnv });
    let out = '', err = '', done = false;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} finish({ error: 'agent timed out after ' + Math.round(AGENT_TIMEOUT_MS / 60000) + 'm' }); }, AGENT_TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => finish({ error: 'engine "' + bin + '" not runnable: ' + e.message }));
    child.on('close', (code) => {
      try {
        const r = JSON.parse(out);
        if (r.is_error) return finish({ error: r.result || r.subtype || 'agent error' });
        return finish({ summary: String(r.result || r.text || '').slice(0, 4000), durationMs: r.duration_ms, cost: r.total_cost_usd });
      } catch (e) {
        if (code !== 0) return finish({ error: (err || out || 'agent exited ' + code).slice(0, 600) });
        return finish({ summary: String(out).slice(0, 4000) });
      }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// Per-repo lock so two tasks on the same checkout never clobber each other.
const repoLocks = new Map();
function withRepoLock(repo, fn) {
  const prev = repoLocks.get(repo) || Promise.resolve();
  const next = prev.then(fn, fn); // run fn whether or not the previous task threw
  repoLocks.set(repo, next.then(() => {}, () => {}));
  return next;
}

// Clone if missing, else fetch + hard-reset to origin/develop (clean slate).
async function ensureWorkspace(dir, authUrl) {
  if (!fs.existsSync(path.join(dir, '.git'))) {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    const c = await git(['clone', authUrl, dir]);
    if (c.code !== 0) throw new Error(redact('clone failed: ' + (c.err || c.out)).slice(0, 400));
    await git(['-C', dir, 'config', 'user.email', 'bot@business-generator.local']);
    await git(['-C', dir, 'config', 'user.name', 'Startup Bot']);
  } else {
    // Refresh the stored credential in case the token rotated, then fetch.
    await git(['-C', dir, 'remote', 'set-url', 'origin', authUrl]);
    await gitOrThrow(['-C', dir, 'fetch', '--prune', 'origin'], undefined, 'fetch');
  }
  await gitOrThrow(['-C', dir, 'checkout', '-B', 'develop', 'origin/develop'], undefined, 'checkout develop');
  await gitOrThrow(['-C', dir, 'reset', '--hard', 'origin/develop'], undefined, 'reset develop');
  await git(['-C', dir, 'clean', '-fd']);
}

async function handleCodeTask(input) {
  const repo = String(input.repo || '').trim().replace(/\.git$/, '').replace(/^https?:\/\/github\.com\//i, '');
  const branch = String(input.branch || '').trim();
  const task = String(input.task || '').trim();
  if (!repo || repo.indexOf('/') < 0) return { ok: false, status: 400, error: 'repo (owner/name) لازم است' };
  if (!branch) return { ok: false, status: 400, error: 'branch لازم است' };
  if (!task) return { ok: false, status: 400, error: 'task (دستور برای agent) لازم است' };

  const engine = activeModel();
  const agentCapable = engine.kind === 'cli' || engine.id === 'gapgpt';
  if (!agentCapable) {
    return { ok: false, status: 409, error: 'موتور فعال «' + engine.label + '» agent نیست. یک موتور CLI (claude/agy) یا GapGPT (با Aider) انتخاب کن.' };
  }
  const token = secret('GITHUB_TOKEN');
  if (!token) return { ok: false, status: 400, error: 'GITHUB_TOKEN در secrets.env تنظیم نشده' };

  const authUrl = buildAuthUrl(input.cloneUrl || repo, token);
  const dir = path.join(workspaceRoot(), repo.replace(/[\/]/g, '__'));

  return withRepoLock(repo, async () => {
    try {
      await ensureWorkspace(dir, authUrl);

      // Fix mode: the task branch already exists on origin → patch it, don't rebase off develop.
      const ls = await git(['-C', dir, 'ls-remote', '--heads', 'origin', branch]);
      const isFix = ls.code === 0 && ls.out.indexOf('refs/heads/' + branch) >= 0;
      if (isFix) {
        await gitOrThrow(['-C', dir, 'fetch', 'origin', '+refs/heads/' + branch + ':refs/remotes/origin/' + branch], undefined, 'fetch branch');
        await gitOrThrow(['-C', dir, 'checkout', '-B', branch, 'refs/remotes/origin/' + branch], undefined, 'checkout branch');
      } else {
        await gitOrThrow(['-C', dir, 'checkout', '-B', branch, 'origin/develop'], undefined, 'branch from develop');
      }

      // Run the real agent inside the checkout (CLI engine, or Aider for GapGPT).
      const agent = await runEngineInDir(engine, task, dir);
      if (agent.error) return { ok: false, status: 502, error: 'agent: ' + agent.error };

      // Stage everything and see whether the agent actually changed files.
      await git(['-C', dir, 'add', '-A']);
      const staged = await git(['-C', dir, 'diff', '--cached', '--name-only']);
      const filesChanged = staged.out.split('\n').map((s) => s.trim()).filter(Boolean);
      if (!filesChanged.length) {
        return { ok: true, repo, branch, isFix, committed: false, noChanges: true, filesChanged: [], engine: engine.id, agent };
      }

      const message = String(input.message || ((isFix ? 'fix: ' : 'feat: ') + (input.track || 'task') + ' ' + branch)).slice(0, 200);
      await gitOrThrow(['-C', dir, 'commit', '-m', message], undefined, 'commit');
      const head = (await git(['-C', dir, 'rev-parse', 'HEAD'])).out.trim();
      const push = await git(['-C', dir, 'push', 'origin', 'HEAD:refs/heads/' + branch]);
      if (push.code !== 0) return { ok: false, status: 502, error: redact('push failed: ' + (push.err || push.out)).slice(0, 400) };

      return { ok: true, repo, branch, isFix, committed: true, head, filesChanged, message, engine: engine.id, agent };
    } catch (e) {
      return { ok: false, status: 500, error: redact(e.message || String(e)).slice(0, 400) };
    }
  });
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

  // Real-agent developer flow: clone repo + run active CLI engine inside it + push.
  if (req.method === 'POST' && p === '/code-task') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let input;
      try { input = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, 400, { ok: false, error: 'invalid JSON body' }); }
      let out;
      try { out = await handleCodeTask(input); } catch (e) { out = { ok: false, status: 500, error: redact(e.message || String(e)) }; }
      const code = out.ok ? 200 : (out.status || 500);
      delete out.status;
      if (out.ok) console.log('[code-task] ' + out.repo + ' ' + out.branch + (out.committed ? ' → ' + (out.filesChanged || []).length + ' files pushed' : ' (no changes)'));
      else console.error('[code-task] error:', out.error);
      return sendJson(res, code, out);
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
