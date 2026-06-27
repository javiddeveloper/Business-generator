// Local model bridge → Anthropic-API compatible.
// Routes every request to the *active* coding engine, chosen from a small catalog:
//   1) Claude (Pro subscription via the `claude` CLI)   ← default
//   2) Gemini (OpenAI-compatible HTTP API, key from Google AI Studio)
//   3) GapGPT (OpenAI-compatible HTTP API, Iran-friendly)
//   4) Ollama (OpenAI-compatible HTTP API, local fallback for emergencies)
// Every HTTP engine reads its key / base URL / model name from secrets.env on
// each request (just like the dashboard Settings panel writes them), so changing
// a token takes effect immediately — no restart, no code change.
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
// For http engines the key / base URL / model can all be overridden from
// secrets.env (keyEnv / baseEnv / modelEnv). keyRequired:false → no API key
// needed (Ollama). modelDefault is used when modelEnv is empty.
const MODELS = [
  { id: 'claude-pro', label: 'Claude (Pro)', kind: 'cli', bin: 'claude', model: process.env.CLAUDE_MODEL || '' },
  // Gemini runs as a CLI agent (the `gemini` CLI is installed & logged in), so it
  // drives its own Read/Edit/Write loop inside the checkout — no Aider needed. Its
  // API key (if set in secrets.env) is injected into the child env by spawnEnv().
  { id: 'gemini', label: 'Gemini', kind: 'cli', bin: 'gemini', model: '', keyEnv: 'GEMINI_API_KEY' },
  { id: 'gapgpt', label: 'GapGPT', kind: 'http', keyEnv: 'GAPGPT_API_KEY', baseEnv: 'GAPGPT_BASE_URL', baseDefault: 'https://api.gapgpt.app/v1', modelEnv: 'GAPGPT_MODEL', modelDefault: 'gpt-4o' },
  { id: 'ollama', label: 'Ollama (محلی)', kind: 'http', keyRequired: false, keyEnv: 'OLLAMA_API_KEY', baseEnv: 'OLLAMA_BASE_URL', baseDefault: 'http://localhost:11434/v1', modelEnv: 'OLLAMA_MODEL', modelDefault: 'llama3.1' },
];

// Resolve the model name for an http engine: secrets override → default.
function httpModel(entry) {
  return (entry.modelEnv && secret(entry.modelEnv)) || entry.model || entry.modelDefault || '';
}

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

// Per-engine child env. Gemini CLI authenticates via GEMINI_API_KEY / GOOGLE_API_KEY
// (or its own OAuth login); inject the key from secrets.env when present so the
// dashboard's stored key takes effect without a separate `gemini` login step.
function spawnEnv(bin) {
  if (bin === 'gemini') {
    const key = secret('GEMINI_API_KEY');
    if (key) {
      // Set only GEMINI_API_KEY (drop GOOGLE_API_KEY) so the CLI doesn't warn
      // "Both GOOGLE_API_KEY and GEMINI_API_KEY are set".
      const env = { ...childEnv, GEMINI_API_KEY: key };
      delete env.GOOGLE_API_KEY;
      return env;
    }
  }
  return childEnv;
}

// The Gemini CLI prints diagnostic banners (color support, YOLO mode, key notes,
// ripgrep fallback) interleaved with its real answer. Strip those known noise
// lines so the returned summary is just the model's reply.
const GEMINI_NOISE = /256-color|YOLO mode|tool calls will be automatically approved|GOOGLE_API_KEY|GEMINI_API_KEY|Ripgrep is not available|Falling back to GrepTool|Loaded cached|Data collection is|DeprecationWarning|punycode/i;
function cleanGemini(text) {
  return String(text || '')
    .split('\n')
    .filter((l) => !GEMINI_NOISE.test(l))
    .join('\n')
    .trim();
}

// Detect a Gemini CLI API/auth/quota failure in its plain-text output and return a
// clean Persian message (or null if it's not an error). Used by every Gemini path
// so a denied key / blown quota surfaces as an error instead of a fake answer.
function geminiErrorMessage(raw) {
  const s = String(raw || '');
  if (/exhausted your daily quota|exceeded your current quota|RESOURCE_EXHAUSTED|TerminalQuotaError|\b429\b/i.test(s))
    return 'سهمیه‌ی روزانه‌ی مدل Gemini تمام شده است. یک مدل دیگر (Claude) انتخاب کن یا بعداً دوباره امتحان کن.';
  if (/denied access|PERMISSION_DENIED|"code":\s*403|\b403\b/i.test(s))
    return 'دسترسی کلید Gemini رد شد (۴۰۳): کلید GEMINI_API_KEY معتبر نیست یا پروژه‌ی Google به آن دسترسی ندارد. یک کلید معتبر در تنظیمات بگذار یا مدل فعال را به Claude تغییر بده.';
  if (/API key not valid|API_KEY_INVALID|invalid api key/i.test(s))
    return 'کلید GEMINI_API_KEY نامعتبر است. یک کلید درست در تنظیمات وارد کن یا مدل را به Claude تغییر بده.';
  if (/An unexpected critical error occurred|Error when talking to Gemini API|Error generating content via API|_ApiError/i.test(s))
    return 'خطای Gemini CLI: ' + (s.split('\n').find((l) => /error/i.test(l)) || s).slice(0, 200);
  return null;
}

// ---- engine runners ------------------------------------------------------
function runCli(bin, model, prompt) {
  return new Promise((resolve) => {
    let args, useStdin;
    if (bin === 'gemini') {
      // Gemini CLI: `gemini --prompt "text" [--model model]`; no --output-format flag
      args = ['--prompt', prompt];
      if (model) args.push('--model', model);
      useStdin = false;
    } else {
      args = ['-p', '--output-format', 'json'];
      if (model) args.push('--model', model);
      useStdin = true;
    }
    const child = spawn(bin, args, { stdio: useStdin ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'], env: spawnEnv(bin) });

    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ error: 'engine "' + bin + '" not runnable: ' + e.message }));
    child.on('close', () => {
      if (bin === 'gemini') {
        // Gemini CLI prints API/quota errors to stdout/stderr as plain text — detect & surface cleanly
        const raw = (out || err || '').trim();
        const gErr = geminiErrorMessage(raw);
        if (gErr) return resolve({ error: gErr });
        const clean = cleanGemini(raw);
        return resolve(clean ? { text: clean } : { error: 'gemini returned empty output' });
      }
      try {
        const r = JSON.parse(out);
        if (r.is_error || r.error) return resolve({ error: r.result || r.error || r.subtype || 'unknown engine error' });
        return resolve({ text: r.result || r.text || r.response || r.output || out });
      } catch (e) {
        return resolve({ text: out || err });
      }
    });
    if (useStdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    }
  });
}

async function runHttp(entry, prompt, maxTokens) {
  const key = secret(entry.keyEnv);
  if (entry.keyRequired !== false && !key) {
    return { error: entry.label + ' key not set — add ' + entry.keyEnv + ' in secrets.env (Settings).' };
  }
  const base = (secret(entry.baseEnv) || entry.baseDefault).replace(/\/$/, '');
  const model = httpModel(entry);
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = 'Bearer ' + key;
  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens || 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { error: entry.label + ' ' + res.status + ': ' + ((j && j.error && j.error.message) || '') };
    const text = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    return { text };
  } catch (e) {
    return { error: entry.label + ': ' + e.message };
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

// Headless agent arguments per CLI. claude is the tested path; agy is best-effort.
// readonly → restrict to read-only tools (for project-aware chat that must not edit files).
function agentArgs(bin, model, readonly) {
  const args = [];
  if (bin === 'claude') {
    args.push('-p', '--output-format', 'json');
    if (model) args.push('--model', model);
    args.push('--dangerously-skip-permissions', '--allowedTools', readonly ? 'Read Grep Glob' : 'Read Edit Write Bash Grep');
  } else if (bin === 'gemini') {
    // Gemini CLI headless: prompt is passed inline via --prompt in the caller
    if (model) args.push('--model', model);
    args.push('-y');
  } else {
    args.push('-p', '--output-format', 'json');
    if (model) args.push('--model', model);
    args.push('--dangerously-skip-permissions');
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

// An HTTP engine (GapGPT / Gemini / Ollama) is a plain chat API, not an agent.
// To let it edit a real checkout we wrap it with Aider (https://aider.chat):
// Aider drives the file edits via git while talking to the engine over its
// OpenAI-compatible endpoint. Requires `aider` installed on the Mac
// (pip install aider-chat). We pass --no-auto-commit so our own commit/push flow
// stays uniform across engines. Key / base / model all come from secrets.env.
function runAiderInDir(entry, prompt, cwd) {
  return new Promise((resolve) => {
    const key = secret(entry.keyEnv);
    if (entry.keyRequired !== false && !key) return resolve({ error: entry.label + ' key not set — add ' + entry.keyEnv + ' in secrets.env (Settings).' });
    const base = (secret(entry.baseEnv) || entry.baseDefault).replace(/\/$/, '');
    // Ollama needs no real key but the OpenAI client insists one is set.
    const env = { ...childEnv, OPENAI_API_KEY: key || 'sk-no-key-required', OPENAI_API_BASE: base };
    const args = ['--no-auto-commit', '--yes-always', '--model', 'openai/' + httpModel(entry), '--message', prompt];
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

// Pick the right agent runner for the active engine. CLI engines drive their own
// agent loop; HTTP engines (GapGPT / Gemini / Ollama) edit the checkout via Aider.
function runEngineInDir(engine, prompt, cwd, readonly) {
  if (engine.kind === 'cli') return runAgentInDir(engine.bin, engine.model, prompt, cwd, readonly);
  if (engine.kind === 'http') return runAiderInDir(engine, prompt, cwd);
  return Promise.resolve({ error: 'engine "' + engine.label + '" is not agent-capable' });
}

// Copy an attached design image into the checkout (git-ignored .design/) so the
// agent's Read tool can reach it, and append an instruction pointing at it.
// Shared by the buffered /agent and the streaming /agent-stream endpoints.
function withImage(dir, task, imagePath) {
  if (!imagePath || !fs.existsSync(imagePath)) return task;
  let imgRef = imagePath;
  try {
    const designDir = path.join(dir, '.design');
    fs.mkdirSync(designDir, { recursive: true });
    const dest = path.join(designDir, path.basename(imagePath));
    fs.copyFileSync(imagePath, dest);
    imgRef = dest;
    const excludeFile = path.join(dir, '.git', 'info', 'exclude');
    let ex = '';
    try { ex = fs.readFileSync(excludeFile, 'utf8'); } catch (e) {}
    if (!/^\.design\/?$/m.test(ex)) fs.appendFileSync(excludeFile, '\n.design/\n');
  } catch (e) {}
  return task + '\n\nیک تصویر دیزاین در مسیر ' + imgRef + ' وجود دارد؛ با ابزار Read آن را بخوان و دقیقاً بر اساس همان دیزاین پیاده‌سازی کن.';
}

// Run the active CLI engine inside `cwd` with full tools + auto-approve.
function runAgentInDir(bin, model, prompt, cwd, readonly) {
  return new Promise((resolve) => {
    const baseArgs = agentArgs(bin, model, readonly);
    // Gemini requires prompt inline; other CLIs read from stdin
    const args = bin === 'gemini' ? ['--prompt', prompt, ...baseArgs] : baseArgs;
    const child = spawn(bin, args, { cwd, stdio: bin === 'gemini' ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'], env: spawnEnv(bin) });
    let out = '', err = '', done = false;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} finish({ error: 'agent timed out after ' + Math.round(AGENT_TIMEOUT_MS / 60000) + 'm' }); }, AGENT_TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => finish({ error: 'engine "' + bin + '" not runnable: ' + e.message }));
    child.on('close', (code) => {
      if (bin === 'gemini') {
        const gErr = geminiErrorMessage(out || err);
        if (gErr) return finish({ error: gErr });
        if (code !== 0 && !out.trim()) return finish({ error: (err || 'gemini exited ' + code).slice(0, 600) });
        return finish({ summary: cleanGemini(out || err).slice(0, 4000) });
      }
      try {
        const r = JSON.parse(out);
        if (r.is_error || r.error) return finish({ error: r.result || r.error || r.subtype || 'agent error' });
        return finish({ summary: String(r.result || r.text || r.output || '').slice(0, 4000), durationMs: r.duration_ms, cost: r.total_cost_usd });
      } catch (e) {
        if (code !== 0) return finish({ error: (err || out || 'agent exited ' + code).slice(0, 600) });
        return finish({ summary: String(out).slice(0, 4000) });
      }
    });
    if (bin !== 'gemini') {
      child.stdin.write(prompt);
      child.stdin.end();
    }
  });
}

// Headless agent args for *streaming*: claude/others emit NDJSON via stream-json
// (needs --verbose in -p mode); gemini streams plain text. Mirrors agentArgs.
function agentArgsStream(bin, model, readonly) {
  const args = [];
  if (bin === 'gemini') {
    if (model) args.push('--model', model);
    args.push('-y');
  } else if (bin === 'claude') {
    args.push('-p', '--output-format', 'stream-json', '--verbose');
    if (model) args.push('--model', model);
    args.push('--dangerously-skip-permissions', '--allowedTools', readonly ? 'Read Grep Glob' : 'Read Edit Write Bash Grep');
  } else {
    args.push('-p', '--output-format', 'stream-json', '--verbose');
    if (model) args.push('--model', model);
    args.push('--dangerously-skip-permissions');
  }
  return args;
}

// Turn one claude stream-json tool_use block into a short terminal line.
function toolUseLine(c) {
  const name = c.name || 'tool';
  const inp = c.input || {};
  if (name === 'Bash') return '🔧 Bash: ' + String(inp.command || '').replace(/\s+/g, ' ').slice(0, 120);
  if (name === 'Write') return '🔧 Write ' + (inp.file_path || '');
  if (name === 'Edit' || name === 'MultiEdit') return '🔧 Edit ' + (inp.file_path || '');
  if (name === 'Read') return '🔧 Read ' + (inp.file_path || '');
  if (name === 'Grep') return '🔧 Grep ' + (inp.pattern || '');
  if (name === 'Glob') return '🔧 Glob ' + (inp.pattern || '');
  return '🔧 ' + name;
}

// Convert a parsed claude stream-json event into a human-readable line (or '').
// `result` events are handled by the caller (they carry the final summary).
function streamLineFromEvent(evt) {
  if (!evt || typeof evt !== 'object') return '';
  if (evt.type === 'system' && evt.subtype === 'init') {
    return '▸ شروع شد' + (evt.model ? ' · ' + evt.model : '');
  }
  if (evt.type === 'assistant' && evt.message && Array.isArray(evt.message.content)) {
    const parts = [];
    for (const c of evt.message.content) {
      if (c.type === 'text' && c.text && c.text.trim()) parts.push(c.text.trim());
      else if (c.type === 'tool_use') parts.push(toolUseLine(c));
    }
    return parts.join('\n');
  }
  if (evt.type === 'user' && evt.message && Array.isArray(evt.message.content)) {
    for (const c of evt.message.content) {
      if (c.type === 'tool_result' && c.is_error) return '  ✗ ابزار با خطا برگشت';
    }
  }
  return '';
}

// Run the active CLI engine inside `cwd`, emitting readable lines via onChunk as
// they happen. Resolves { summary, durationMs, cost } | { error } | { aborted }.
// `signal` (AbortSignal) kills the child on stop / client disconnect.
function runAgentInDirStream(bin, model, prompt, cwd, readonly, onChunk, signal) {
  return new Promise((resolve) => {
    const baseArgs = agentArgsStream(bin, model, readonly);
    const args = bin === 'gemini' ? ['--prompt', prompt, ...baseArgs] : baseArgs;
    const child = spawn(bin, args, { cwd, stdio: bin === 'gemini' ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'], env: spawnEnv(bin) });
    let err = '', buf = '', done = false;
    let finalSummary = '', durationMs, cost, sawError = '';
    const geminiAcc = [];
    const emit = (s) => { if (s) { try { onChunk(s); } catch (e) {} } };
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(v);
    };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) {} finish({ error: 'agent timed out after ' + Math.round(AGENT_TIMEOUT_MS / 60000) + 'm' }); }, AGENT_TIMEOUT_MS);
    const onAbort = () => { try { child.kill('SIGKILL'); } catch (e) {} finish({ aborted: true }); };
    if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener('abort', onAbort); }

    const handleLine = (line) => {
      const s = line.trim();
      if (!s) return;
      if (bin === 'gemini') { if (GEMINI_NOISE.test(s)) return; geminiAcc.push(s); emit(s); return; }
      let evt;
      try { evt = JSON.parse(s); } catch (e) { emit(s); return; }
      if (evt.type === 'result') {
        finalSummary = String(evt.result || finalSummary || '');
        durationMs = evt.duration_ms;
        cost = evt.total_cost_usd;
        if (evt.is_error || evt.subtype === 'error_max_turns') sawError = evt.result || evt.subtype || 'agent error';
        return;
      }
      emit(streamLineFromEvent(evt));
    };

    child.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        handleLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => finish({ error: 'engine "' + bin + '" not runnable: ' + e.message }));
    child.on('close', (code) => {
      if (buf.trim()) handleLine(buf);
      if (sawError) return finish({ error: sawError });
      if (bin === 'gemini') {
        const gErr = geminiErrorMessage(geminiAcc.join('\n') + '\n' + err);
        if (gErr) return finish({ error: gErr });
      }
      if (code !== 0 && !finalSummary && !geminiAcc.length) return finish({ error: (err || 'agent exited ' + code).slice(0, 600) });
      const summary = finalSummary || geminiAcc.join('\n') || 'تسک اجرا شد';
      finish({ summary: String(summary).slice(0, 4000), durationMs, cost });
    });
    if (bin !== 'gemini') {
      child.stdin.write(prompt);
      child.stdin.end();
    }
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
  const agentCapable = engine.kind === 'cli' || engine.kind === 'http';
  if (!agentCapable) {
    return { ok: false, status: 409, error: 'موتور فعال «' + engine.label + '» agent نیست. یک موتور CLI (Claude) یا HTTP (Gemini/GapGPT/Ollama با Aider) انتخاب کن.' };
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

  // Direct agent: run the active engine inside an existing local dir on the current branch.
  if (req.method === 'POST' && p === '/agent') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let input;
      try { input = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, 400, { ok: false, error: 'invalid JSON' }); }
      const dir = String(input.dir || '').trim();
      const task = String(input.task || '').trim();
      if (!dir || !task) return sendJson(res, 400, { ok: false, error: 'dir و task لازم است' });
      if (!fs.existsSync(dir)) return sendJson(res, 400, { ok: false, error: 'مسیر پروژه وجود ندارد: ' + dir });
      // A git repo is optional: file-grounded chat/agent only needs a folder. Commit/
      // push are skipped when there's no .git (a plain local folder), so read-only
      // chat and editing a non-versioned folder both work.
      const hasGit = fs.existsSync(path.join(dir, '.git'));

      const engine = activeModel();
      const agentCapable = engine.kind === 'cli' || engine.kind === 'http';
      if (!agentCapable) return sendJson(res, 409, { ok: false, error: 'موتور فعال agent نیست: ' + engine.label });

      const fullTask = withImage(dir, task, input.imagePath);

      const readonly = !!input.readonly;
      const agent = await runEngineInDir(engine, fullTask, dir, readonly);
      if (agent.error) return sendJson(res, 200, { ok: false, error: 'agent: ' + agent.error });

      // Read-only safety net: not every engine honors a read-only tool set (Claude
      // does via --allowedTools; the Gemini CLI has no such switch), so revert any
      // tracked-file edits a read-only run made — chat must never change the project.
      if (readonly && hasGit) await git(['-C', dir, 'checkout', '--', '.']);

      let branch = '';
      if (hasGit) branch = (await git(['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'])).out.trim();

      let pushed = false;
      let filesChanged = [];
      if (hasGit && !readonly && input.push !== false) {
        await git(['-C', dir, 'add', '-A']);
        const staged = await git(['-C', dir, 'diff', '--cached', '--name-only']);
        filesChanged = staged.out.split('\n').map((s) => s.trim()).filter(Boolean);
        if (filesChanged.length) {
          const msg = (input.commitMessage || 'agent: ' + task.slice(0, 80)).slice(0, 200);
          await git(['-C', dir, 'commit', '-m', msg]);
          const pushR = await git(['-C', dir, 'push', 'origin', 'HEAD']);
          pushed = pushR.code === 0;
        }
      }

      const summary = agent.summary || '';
      console.log('[agent] dir=' + dir + ' branch=' + branch + ' pushed=' + pushed + ' files=' + filesChanged.length);
      return sendJson(res, 200, { ok: true, branch, pushed, filesChanged, summary });
    });
    return;
  }

  // Streaming agent: same as /agent but emits the engine's output line-by-line as
  // Server-Sent Events. CLI engines only (HTTP engines have no agent loop) — the
  // caller is expected to fall back to /agent when the active engine isn't CLI.
  if (req.method === 'POST' && p === '/agent-stream') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let input;
      try { input = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, 400, { ok: false, error: 'invalid JSON' }); }
      const dir = String(input.dir || '').trim();
      const task = String(input.task || '').trim();
      if (!dir || !task) return sendJson(res, 400, { ok: false, error: 'dir و task لازم است' });
      if (!fs.existsSync(dir)) return sendJson(res, 400, { ok: false, error: 'مسیر پروژه وجود ندارد: ' + dir });
      const hasGit = fs.existsSync(path.join(dir, '.git'));

      const engine = activeModel();
      if (engine.kind !== 'cli') return sendJson(res, 409, { ok: false, error: 'streaming فقط برای موتورهای CLI است: ' + engine.label });

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const sse = (event, data) => { try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (e) {} };
      sse('start', { engine: engine.id });

      // Kill the child if the client disconnects mid-stream (e.g. STOP upstream).
      const ac = new AbortController();
      res.on('close', () => ac.abort());

      const readonly = !!input.readonly;
      const fullTask = withImage(dir, task, input.imagePath);
      const agent = await runAgentInDirStream(engine.bin, engine.model, fullTask, dir, readonly, (line) => sse('chunk', { text: line }), ac.signal);
      if (agent.aborted) return res.end();
      if (agent.error) { sse('error', { error: agent.error }); return res.end(); }

      // Read-only safety net (see /agent): discard any edits a read-only run made.
      if (readonly && hasGit) await git(['-C', dir, 'checkout', '--', '.']);

      const branch = hasGit ? (await git(['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'])).out.trim() : '';
      let pushed = false, filesChanged = [];
      if (hasGit && !readonly && input.push !== false) {
        await git(['-C', dir, 'add', '-A']);
        const staged = await git(['-C', dir, 'diff', '--cached', '--name-only']);
        filesChanged = staged.out.split('\n').map((s) => s.trim()).filter(Boolean);
        if (filesChanged.length) {
          const msg = (input.commitMessage || 'agent: ' + task.slice(0, 80)).slice(0, 200);
          await git(['-C', dir, 'commit', '-m', msg]);
          sse('chunk', { text: '📦 commit: ' + filesChanged.length + ' فایل' });
          const pushR = await git(['-C', dir, 'push', 'origin', 'HEAD']);
          pushed = pushR.code === 0;
          sse('chunk', { text: pushed ? '⬆️ push شد → ' + branch : '⚠️ push ناموفق' });
        }
      }
      console.log('[agent-stream] dir=' + dir + ' branch=' + branch + ' pushed=' + pushed + ' files=' + filesChanged.length);
      sse('done', { ok: true, branch, pushed, filesChanged, summary: agent.summary || '' });
      res.end();
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
