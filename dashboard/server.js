// Startup Dashboard — zero-dependency Node server.
// Serves the dark-modern frontend and proxies Trello / GitHub / the Claude bridge,
// keeping all tokens server-side. Run it on the host (next to claude-bridge.js):
//   node dashboard/server.js     →   http://localhost:8090
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { config, reload, COLUMNS } = require('./lib/env');
const settings = require('./lib/settings');
const T = require('./lib/trello');
const { getCardDetail } = T;
const { listPRs, getPRDetail } = require('./lib/github');
const { bridgeHealth } = require('./lib/claude');
const activity = require('./lib/activity');
const owner = require('./lib/owner');
const store = require('./lib/store');
const repo = require('./lib/repo');
const memory = require('./lib/memory');
const { deleteClone } = repo;
const crypto = require('crypto');

// guarantee at least one project so the UI is never empty
store.bootstrap('');

const normRepo = (u) => {
  let s = String(u || '').trim().replace(/\.git$/, '');
  const ghIdx = s.toLowerCase().indexOf('github.com/');
  if (ghIdx !== -1) s = s.slice(ghIdx + 'github.com/'.length);
  let parts = s.split('/').filter(Boolean);
  // if first segment looks like a local path (~, ., Desktop…), skip junk and use last segment
  if (parts.length > 2 && /^[~.]|^(Desktop|Documents|Users|home)$/i.test(parts[0])) {
    const last = parts[parts.length - 1];
    // support owner__repo notation (double-underscore as separator)
    if (last.includes('__')) {
      const [owner, ...rest] = last.split('__');
      return owner + '/' + rest.join('-');
    }
    // can't reliably extract owner/repo — return as-is for server-side validation
    return last;
  }
  return parts.length >= 2 ? parts[0] + '/' + parts[1] : s;
};

// Resolve the effective GitHub owner/repo for a project.
// If the stored repo is a local path, read remote.origin.url from .git/config.
async function resolveRepo(project) {
  if (!project || !project.repo) return '';
  const stored = project.repo;
  // If it looks like a GitHub slug already (owner/repo), use it directly
  if (/^[^/]+\/[^/]+$/.test(normRepo(stored))) return stored;
  // Local path — try to read GitHub remote from .git/config
  try {
    const st = await repo.status(stored);
    if (st && st.githubRepo) return st.githubRepo;
  } catch {}
  return stored;
}

// sessionId -> AbortController for the command currently running in that session.
// Drives the STOP button and the "no switching while busy" lock.
const running = new Map();
function withRun(projectId, sessionId, repo, fn) {
  const ctrl = new AbortController();
  if (sessionId) running.set(sessionId, ctrl);
  return Promise.resolve(activity.run({ projectId, sessionId, repo, signal: ctrl.signal }, fn)).finally(() => {
    if (sessionId) running.delete(sessionId);
  });
}
const isAbort = (e) => e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''));

const ROOT = path.join(__dirname, '..');
const ROLES_DIR = path.join(ROOT, 'roles');
const STACKS_DIR = path.join(ROOT, 'stacks');
const ROLE_FILES = ['developer.md', 'tech-lead.md', 'product-owner.md'];
const STACK_FILES = ['backend.md', 'frontend.md', 'mobile.md'];

function readMdFiles(dir, files) {
  const out = {};
  for (const f of files) {
    try { out[f] = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { out[f] = ''; }
  }
  return out;
}
function writeMdFiles(dir, values) {
  for (const [name, content] of Object.entries(values)) {
    if (!/^[\w.-]+\.md$/.test(name)) continue;
    fs.writeFileSync(path.join(dir, name), content);
  }
}

const PUBLIC = path.join(__dirname, 'public');

// ---- tiny TTL cache so auto-refresh polling doesn't hammer the APIs -------
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}
// drop every per-project board cache (keys are 'state:<projectId>')
function dropState() {
  for (const k of [...cache.keys()]) if (k.startsWith('state:')) cache.delete(k);
}

const countTag = (comments, tag) => comments.filter((t) => t.indexOf(tag) >= 0).length;

// ---- board state ---------------------------------------------------------
// Built per active project: cards are filtered by the project's repo so each
// project shows only its own tasks. Result is cached to disk (store.writeBoard)
// so a project switch paints instantly and tasks survive a Trello outage.
async function buildState(project, effectiveRepo) {
  // Filter by the resolved GitHub slug — the same identity the Product Owner and
  // task-sync stamp into each card's `repo:` meta — so local-path projects match too.
  const repo = normRepo(effectiveRepo || (project && project.repo) || '');
  const L = config.trello.lists;
  const columns = [];
  let totalTasks = 0,
    totalBugs = 0,
    totalFixes = 0;

  for (const col of COLUMNS) {
    const cards = await T.listCards(L[col.key]);
    const outCards = [];
    for (const c of cards) {
      const mm = T.parseMeta(c.desc);
      if (repo && normRepo(mm.repo) !== repo) continue; // only this project's cards
      const acts = await T.cardComments(c.id, 30);
      const comments = (acts || []).map((a) => a && a.data && a.data.text).filter(Boolean);
      const bugs = countTag(comments, '🔴');
      const fixes = countTag(comments, '🛠️');
      totalTasks++;
      totalBugs += bugs;
      totalFixes += fixes;
      outCards.push({
        id: c.id,
        name: c.name,
        track: T.trackOf(c.name),
        complexity: T.complexityOf(c.name),
        bugs,
        fixes,
        desc: String(c.desc || '').split('\n---')[0].trim(),
      });
    }
    columns.push({ key: col.key, name: col.name, emoji: col.emoji, cards: outCards });
  }

  const bridge = await bridgeHealth();
  return {
    project: project ? { id: project.id, project: project.name, repo: project.repo, autoMode: !!project.autoMode } : null,
    columns,
    totals: { tasks: totalTasks, bugs: totalBugs, fixes: totalFixes },
    system: { bridge, configured: config.configured },
    running: [...running.keys()],
    ts: Date.now(),
  };
}

// Live build with disk-cache fallback: cache a non-empty board so a switch is
// instant; if the live board comes back empty (e.g. Trello down) but we have a
// cached snapshot with tasks, serve the cache so tasks aren't lost.
async function loadState(project) {
  const effectiveRepo = project ? await resolveRepo(project) : '';
  const state = await buildState(project, effectiveRepo);
  if (project) {
    if (state.totals.tasks > 0) {
      store.writeBoard(project.id, { columns: state.columns, totals: state.totals });
    } else {
      const cached = store.readBoard(project.id);
      if (cached && cached.totals && cached.totals.tasks > 0) {
        state.columns = cached.columns;
        state.totals = cached.totals;
        state.cached = true;
      }
    }
  }
  return state;
}

// ---- http helpers --------------------------------------------------------
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
function serveStatic(res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const fp = path.normalize(path.join(PUBLIC, rel));
  if (!fp.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  fs.readFile(fp, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });
}

// Parse one raw SSE event block ("event: x\ndata: {...}") into { event, data }.
function parseSseEvent(raw) {
  let event = 'message', dataStr = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
  }
  let data = {};
  try { data = JSON.parse(dataStr); } catch (e) {}
  return { event, data };
}

// ---- router --------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;
  try {
    if (p === '/api/models' && req.method === 'GET') {
      try {
        const r = await fetch(config.bridge + '/models');
        return sendJson(res, 200, await r.json());
      } catch (e) {
        return sendJson(res, 200, { models: [], active: '', error: 'پل در دسترس نیست' });
      }
    }
    if (p === '/api/models' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      try {
        const r = await fetch(config.bridge + '/model', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: body.id }),
        });
        const j = await r.json();
        dropState(); // health reflects the new engine on next poll
        return sendJson(res, r.status, j);
      } catch (e) {
        return sendJson(res, 502, { ok: false, error: e.message });
      }
    }
    if (p === '/api/roles' && req.method === 'GET') {
      return sendJson(res, 200, { files: ROLE_FILES, values: readMdFiles(ROLES_DIR, ROLE_FILES) });
    }
    if (p === '/api/roles' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      writeMdFiles(ROLES_DIR, body.values || {});
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/stacks' && req.method === 'GET') {
      return sendJson(res, 200, { files: STACK_FILES, values: readMdFiles(STACKS_DIR, STACK_FILES) });
    }
    if (p === '/api/stacks' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      writeMdFiles(STACKS_DIR, body.values || {});
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/settings' && req.method === 'GET') {
      return sendJson(res, 200, {
        configured: settings.isConfigured(),
        fields: settings.FIELDS,
        values: settings.parseFile(),
        rootDir: ROOT,
      });
    }
    if (p === '/api/settings' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      settings.write(body.values || {});
      reload();
      cache.clear();
      return sendJson(res, 200, { ok: true, configured: settings.isConfigured() });
    }
    if (p === '/api/state') {
      const pid = u.searchParams.get('projectId');
      const project = pid ? store.getProject(pid) : null;
      // On a project switch the frontend asks for sync=1: the canonical tasks
      // file is the source of truth, so (re)create any missing Trello cards
      // before building the board. Bypasses the TTL cache for that one call.
      if (u.searchParams.get('sync') === '1' && project) {
        try {
          const effectiveRepo = await resolveRepo(project);
          await owner.syncTasksToTrello(project.id, effectiveRepo, project.name);
        } catch {}
        dropState();
        const state = await loadState(project);
        cache.set('state:' + (pid || '-'), { t: Date.now(), v: state });
        return sendJson(res, 200, state);
      }
      const key = 'state:' + (pid || '-');
      return sendJson(res, 200, await cached(key, 3000, () => loadState(project)));
    }
    if (p === '/api/browse' && req.method === 'POST') {
      const { exec } = require('child_process');
      let cmd = '';
      if (os.platform() === 'win32') {
        cmd = 'powershell -NoProfile -Command "Add-Type -AssemblyName System.windows.forms; $f=New-Object System.Windows.Forms.FolderBrowserDialog; [void]$f.ShowDialog(); $f.SelectedPath"';
      } else if (os.platform() === 'darwin') {
        // Activate Finder first so the dialog appears in front of the browser window
        cmd = `osascript -e 'tell application "Finder" to activate' -e 'POSIX path of (choose folder with prompt "انتخاب پوشه پروژه:")'`;
      } else {
        cmd = 'zenity --file-selection --directory 2>/dev/null';
      }
      return new Promise((resolve) => {
        exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
          const selected = stdout ? stdout.trim() : '';
          if (!selected && err) {
            // User cancelled or dialog failed
            const errMsg = (stderr || err.message || '').trim();
            const cancelled = /User canceled|cancelled/i.test(errMsg) || err.code === 1;
            sendJson(res, 200, { path: '', cancelled: cancelled, error: cancelled ? null : errMsg });
          } else {
            sendJson(res, 200, { path: selected });
          }
          resolve();
        });
      });
    }
    // ---- ls: list subdirectories for in-browser folder picker -----------
    if (p === '/api/ls' && req.method === 'GET') {
      const reqPath = u.searchParams.get('path') || os.homedir();
      const resolved = (reqPath === '~') ? os.homedir()
        : reqPath.startsWith('~/') ? path.join(os.homedir(), reqPath.slice(2))
        : reqPath;
      try {
        const entries = fs.readdirSync(resolved, { withFileTypes: true });
        const dirs = entries
          .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
          .map((e) => ({ name: e.name, path: path.join(resolved, e.name) }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const parent = path.dirname(resolved);
        return sendJson(res, 200, { ok: true, current: resolved, parent: parent !== resolved ? parent : null, dirs });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: e.message });
      }
    }
    // ---- projects --------------------------------------------------------
    if (p === '/api/projects' && req.method === 'GET') return sendJson(res, 200, store.listProjects());
    if (p === '/api/projects' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const project = store.createProject(body.name, body.repo);
      // auto-clone GitHub repos in the background (non-blocking)
      if (project && project.repo) {
        const slug = project.repo;
        const isLocalPath = /^([a-zA-Z]:[/\\]|\\\\|\/|~)/.test(slug);
        if (!isLocalPath && slug.indexOf('/') >= 0) {
          repo.clone(slug).catch(() => {});
        }
      }
      return sendJson(res, 200, project);
    }
    if (p.startsWith('/api/projects/') && p.endsWith('/sessions')) {
      const pid = p.slice('/api/projects/'.length, -'/sessions'.length);
      if (req.method === 'GET') return sendJson(res, 200, store.listSessions(pid));
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        return sendJson(res, 200, store.createSession(pid, body.title));
      }
    }
    if (p.startsWith('/api/projects/') && (req.method === 'PATCH' || req.method === 'DELETE')) {
      const pid = p.slice('/api/projects/'.length);
      const isDelete = req.method === 'DELETE';
      const body = isDelete ? { archived: true } : JSON.parse((await readBody(req)) || '{}');
      dropState();
      const project = store.getProject(pid);
      const updated = store.updateProject(pid, body) || { error: 'not found' };
      // When archiving/deleting, also remove the local clone from disk
      if (isDelete && project && project.repo) {
        try { deleteClone(project.repo); } catch {}
      }
      return sendJson(res, 200, updated);
    }
    // ---- sessions --------------------------------------------------------
    if (p.startsWith('/api/sessions/')) {
      const sid = p.slice('/api/sessions/'.length);
      const pid = u.searchParams.get('projectId');
      if (req.method === 'PATCH') {
        const body = JSON.parse((await readBody(req)) || '{}');
        return sendJson(res, 200, store.updateSession(pid, sid, body) || { error: 'not found' });
      }
      if (req.method === 'DELETE') {
        store.deleteSession(pid, sid);
        return sendJson(res, 200, { ok: true });
      }
    }
    // ---- repo: branches + local clone -----------------------------------
    if (p === '/api/repo' && req.method === 'GET') {
      const pid = u.searchParams.get('projectId');
      const project = pid ? store.getProject(pid) : null;
      if (!project) return sendJson(res, 400, { ok: false, error: 'پروژه پیدا نشد' });
      return sendJson(res, 200, await repo.status(project.repo));
    }
    if (p === '/api/clone' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const project = body.projectId ? store.getProject(body.projectId) : null;
      if (!project) return sendJson(res, 400, { ok: false, error: 'پروژه پیدا نشد' });
      return sendJson(res, 200, await repo.clone(project.repo));
    }
    if (p === '/api/checkout' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const project = body.projectId ? store.getProject(body.projectId) : null;
      if (!project) return sendJson(res, 400, { ok: false, error: 'پروژه پیدا نشد' });
      if (!body.branch) return sendJson(res, 400, { ok: false, error: 'branch لازم است' });
      try {
        const st = await repo.checkout(project.repo, body.branch);
        store.updateProject(body.projectId, { branch: body.branch });
        return sendJson(res, 200, st);
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: e.message });
      }
    }
    if (p === '/api/repo/connect' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const project = body.projectId ? store.getProject(body.projectId) : null;
      if (!project) return sendJson(res, 400, { ok: false, error: 'پروژه پیدا نشد' });
      if (!body.remoteUrl) return sendJson(res, 400, { ok: false, error: 'remoteUrl لازم است' });
      try {
        await repo.connectGit(project.repo, body.remoteUrl);
        return sendJson(res, 200, await repo.status(project.repo));
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: e.message });
      }
    }
    if (p === '/api/chat' && req.method === 'POST') {
      // Chat-first: every message goes to the Product Owner, who answers and/or
      // breaks the request into tasks for the already-known repo. The PO logs
      // the user+agent turns into the session itself (via the activity context).
      const body = JSON.parse((await readBody(req)) || '{}');
      const text = (body.text || '').trim();
      if (!text) return sendJson(res, 400, { error: 'empty text' });
      const project = body.projectId ? store.getProject(body.projectId) : null;
      if (!project) return sendJson(res, 400, { ok: false, error: 'پروژه پیدا نشد' });
      const effectiveRepo = await resolveRepo(project);
      dropState();
      try {
        const result = await withRun(body.projectId, body.sessionId, effectiveRepo, () => owner.runOwnerChat(text));
        return sendJson(res, 200, { ok: true, reply: result.reply, tasksCreated: result.tasksCreated });
      } catch (e) {
        const msg = isAbort(e)
          ? 'stopped'
          : /fetch failed/i.test(e.message || '')
          ? 'اتصال به پل مدل برقرار نشد. مطمئن شو claude-bridge.js در حال اجراست.'
          : e.message;
        if (!isAbort(e) && body.projectId && body.sessionId) {
          store.appendMessage(body.projectId, body.sessionId, { role: 'system', text: '⚠️ ' + msg });
        }
        return sendJson(res, 200, { ok: false, error: msg });
      }
    }
    if (p === '/api/po-report' && req.method === 'POST') {
      // Product Owner progress report (triggered when auto-run is stopped).
      const body = JSON.parse((await readBody(req)) || '{}');
      const project = body.projectId ? store.getProject(body.projectId) : null;
      if (!project) return sendJson(res, 400, { ok: false, error: 'پروژه پیدا نشد' });
      const effectiveRepo = await resolveRepo(project);
      dropState();
      try {
        const result = await withRun(body.projectId, body.sessionId, effectiveRepo, () => owner.generateProgressReport());
        return sendJson(res, 200, { ok: true, report: result.report });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: isAbort(e) ? 'stopped' : e.message });
      }
    }
    if (p === '/api/ask' && req.method === 'POST') {
      // Chat mode: free Q&A with the model. Read-only — never changes files.
      // If the project is cloned locally, run a read-only agent inside the checkout
      // so answers are grounded in the real files (and any attached image).
      const body = JSON.parse((await readBody(req)) || '{}');
      const text = (body.text || '').trim();
      if (!text) return sendJson(res, 400, { error: 'empty text' });
      const project = body.projectId ? store.getProject(body.projectId) : null;
      const sid = body.sessionId;
      const imagePath = body.imagePath || null;
      if (project && sid) store.appendMessage(body.projectId, sid, { role: 'user', text });
      try {
        let reply = '';
        let st = null;
        if (project) { try { st = await repo.ensureGit(project.repo); } catch {} }
        if (st && st.cloned) {
          const prompt = 'این یک گفتگو درباره‌ی همین پروژه است. پوشه‌ی کاری ریشه‌ی پروژه است؛ برای پاسخ دقیق، فایل‌های واقعی پروژه را با ابزار Read/Grep بررسی کن و بر اساس محتوای واقعی پاسخ بده (نه حدس).' +
            memory.contextBlock(st.dir) +
            '\nسؤال کاربر:\n' + text;
          const r = await fetch(config.bridge + '/agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dir: st.dir, task: prompt, readonly: true, push: false, imagePath }),
          });
          const result = await r.json().catch(() => ({}));
          if (result && result.ok && result.summary) reply = result.summary;
          else if (result && result.error && !/agent نیست/.test(result.error)) reply = '⚠️ ' + result.error;
        }
        if (!reply) {
          const { claude } = require('./lib/claude');
          reply = await claude(text, 2000);
        }
        if (project && sid) store.appendMessage(body.projectId, sid, { role: 'agent', text: reply });
        return sendJson(res, 200, { ok: true, reply });
      } catch (e) {
        const msg = /fetch failed/i.test(e.message || '') ? 'اتصال به پل مدل برقرار نشد. مطمئن شو claude-bridge.js در حال اجراست.' : e.message;
        if (project && sid) store.appendMessage(body.projectId, sid, { role: 'system', text: '⚠️ ' + msg });
        return sendJson(res, 200, { ok: false, error: msg });
      }
    }
    if (p === '/api/agent' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const task = (body.task || '').trim();
      if (!task) return sendJson(res, 400, { error: 'task لازم است' });
      const project = body.projectId ? store.getProject(body.projectId) : null;
      if (!project) return sendJson(res, 400, { ok: false, error: 'پروژه پیدا نشد' });
      const sid = body.sessionId;
      if (sid) store.appendMessage(body.projectId, sid, { role: 'user', text: task });
      const st = await repo.ensureGit(project.repo);
      if (!st.cloned) {
        const msg = st.isLocalPath
          ? (st.dirExists ? 'راه‌اندازی git در این پوشه‌ی محلی ناموفق بود' : 'مسیر محلی پروژه پیدا نشد: ' + st.dir)
          : 'مخزن هنوز کلون نشده';
        return sendJson(res, 200, { ok: false, error: msg });
      }
      const push = body.push !== false;
      const imagePath = body.imagePath || null;
      // Prepend the engine-independent chained memory so a bridge switch keeps context.
      const taskWithMemory = task + memory.contextBlock(st.dir);
      try {
        const r = await fetch(config.bridge + '/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dir: st.dir, task: taskWithMemory, push, commitMessage: body.commitMessage, imagePath }),
        });
        const result = await r.json();
        const summary = result.summary || result.error || (result.ok ? 'تسک اجرا شد' : 'خطا در اجرا');
        if (sid) {
          store.appendMessage(body.projectId, sid, { role: 'agent', text: summary });
        }
        // Extend the chain so the next turn (any engine) sees what just happened.
        memory.append(st.dir, result.ok ? 'agent' : 'agent (خطا)',
          'تسک: ' + task.slice(0, 200) +
          (result.filesChanged && result.filesChanged.length ? '\nفایل‌ها: ' + result.filesChanged.slice(0, 20).join('، ') : '') +
          '\nنتیجه: ' + summary.slice(0, 400));
        return sendJson(res, 200, result);
      } catch (e) {
        const msg = /fetch failed/i.test(e.message || '') ? 'اتصال به پل مدل برقرار نشد. مطمئن شو claude-bridge.js در حال اجراست.' : e.message;
        // persist the error so the typed-out reply isn't wiped by the next
        // timeline repaint (refreshActivity re-renders only from stored messages).
        if (sid) store.appendMessage(body.projectId, sid, { role: 'system', text: '⚠️ ' + msg });
        return sendJson(res, 200, { ok: false, error: msg });
      }
    }
    if (p === '/api/agent-stream' && req.method === 'POST') {
      // Streaming variant of /api/agent: proxy the bridge's SSE stream to the
      // browser so agent output appears line-by-line. Persists the user turn up
      // front and the final summary (+ memory) once the stream finishes.
      const body = JSON.parse((await readBody(req)) || '{}');
      const task = (body.task || '').trim();
      if (!task) return sendJson(res, 400, { error: 'task لازم است' });
      const project = body.projectId ? store.getProject(body.projectId) : null;
      if (!project) return sendJson(res, 400, { ok: false, error: 'پروژه پیدا نشد' });
      const sid = body.sessionId;
      const st = await repo.ensureGit(project.repo);
      if (!st.cloned) {
        const msg = st.isLocalPath
          ? (st.dirExists ? 'راه‌اندازی git در این پوشه‌ی محلی ناموفق بود' : 'مسیر محلی پروژه پیدا نشد: ' + st.dir)
          : 'مخزن هنوز کلون نشده';
        return sendJson(res, 200, { ok: false, error: msg });
      }

      if (sid) store.appendMessage(body.projectId, sid, { role: 'user', text: task });
      const push = body.push !== false;
      const imagePath = body.imagePath || null;
      const taskWithMemory = task + memory.contextBlock(st.dir);
      dropState();

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const sse = (event, data) => { try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (e) {} };

      // STOP wiring: register in the same `running` map the /api/stop button uses,
      // so aborting cancels the upstream fetch → the bridge kills the child.
      const ctrl = new AbortController();
      if (sid) running.set(sid, ctrl);
      res.on('close', () => { try { ctrl.abort(); } catch (e) {} if (sid && running.get(sid) === ctrl) running.delete(sid); });

      let doneData = null, errData = null, transcript = '';
      try {
        const upstream = await fetch(config.bridge + '/agent-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dir: st.dir, task: taskWithMemory, push, commitMessage: body.commitMessage, imagePath }),
          signal: ctrl.signal,
        });
        if (!upstream.ok || !upstream.body) {
          const j = await upstream.json().catch(() => ({}));
          errData = { error: j.error || ('bridge stream error ' + upstream.status) };
        } else {
          let buf = '';
          for await (const chunk of upstream.body) {
            buf += Buffer.from(chunk).toString('utf8');
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const ev = parseSseEvent(buf.slice(0, idx));
              buf = buf.slice(idx + 2);
              if (ev.event === 'chunk') { transcript += (ev.data.text || '') + '\n'; sse('chunk', ev.data); }
              else if (ev.event === 'done') doneData = ev.data;
              else if (ev.event === 'error') errData = ev.data;
              else sse(ev.event, ev.data);
            }
          }
        }
      } catch (e) {
        if (!isAbort(e)) errData = { error: /fetch failed/i.test(e.message || '') ? 'اتصال به پل مدل برقرار نشد. مطمئن شو claude-bridge.js در حال اجراست.' : e.message };
      }
      if (sid && running.get(sid) === ctrl) running.delete(sid);

      if (doneData) {
        const summary = doneData.summary || transcript.trim() || 'تسک اجرا شد';
        if (sid) store.appendMessage(body.projectId, sid, { role: 'agent', text: summary });
        memory.append(st.dir, 'agent',
          'تسک: ' + task.slice(0, 200) +
          (doneData.filesChanged && doneData.filesChanged.length ? '\nفایل‌ها: ' + doneData.filesChanged.slice(0, 20).join('، ') : '') +
          '\nنتیجه: ' + summary.slice(0, 400));
        sse('done', { ...doneData, summary });
      } else if (errData) {
        if (sid) store.appendMessage(body.projectId, sid, { role: 'system', text: '⚠️ ' + errData.error });
        sse('error', errData);
      } else if (transcript.trim() && sid) {
        // Stopped/disconnected mid-run: keep the partial transcript so work isn't lost.
        // (The /api/stop handler appends its own "⏹️ متوقف شد" marker.)
        store.appendMessage(body.projectId, sid, { role: 'agent', text: transcript.trim() });
      }
      dropState();
      return res.end();
    }
    if (p === '/api/upload' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const pid = body.projectId || 'default';
      const ext = (body.ext || 'png').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'png';
      const allowed = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
      if (!allowed.includes(ext.toLowerCase())) return sendJson(res, 400, { ok: false, error: 'فرمت مجاز نیست' });
      const data = body.data || '';
      // strip data-url prefix if present
      const base64 = data.replace(/^data:[^;]+;base64,/, '');
      if (base64.length > 14 * 1024 * 1024) return sendJson(res, 400, { ok: false, error: 'حداکثر ۱۰MB' });
      const uploadDir = path.join(ROOT, 'data', 'uploads', pid);
      fs.mkdirSync(uploadDir, { recursive: true });
      const fname = crypto.randomUUID() + '.' + ext;
      const fpath = path.join(uploadDir, fname);
      fs.writeFileSync(fpath, Buffer.from(base64, 'base64'));
      return sendJson(res, 200, { ok: true, path: fpath });
    }
    // ---- messages (per session) -----------------------------------------
    if (p === '/api/messages' && req.method === 'GET') {
      const pid = u.searchParams.get('projectId');
      const sid = u.searchParams.get('sessionId');
      if (!pid || !sid) return sendJson(res, 400, { error: 'missing params' });
      return sendJson(res, 200, store.readMessages(pid, sid));
    }
    // ---- stop the command running in a session --------------------------
    if (p === '/api/stop' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const ctrl = running.get(body.sessionId);
      if (ctrl) ctrl.abort();
      if (body.projectId && body.sessionId) {
        store.appendMessage(body.projectId, body.sessionId, { role: 'system', text: '⏹️ متوقف شد' });
      }
      return sendJson(res, 200, { ok: true, stopped: !!ctrl });
    }
    if (p === '/api/prs') {
      const repo = u.searchParams.get('repo');
      if (!repo || repo.indexOf('/') < 0) return sendJson(res, 200, []);
      const [o, r] = repo.split('/');
      const state = u.searchParams.get('state') || 'open';
      const prs = await cached('prs:' + repo + ':' + state, 8000, () => listPRs(o, r, state).catch(() => []));
      return sendJson(res, 200, prs);
    }
    if (p === '/api/pr-detail' && req.method === 'GET') {
      const repo = u.searchParams.get('repo');
      const number = parseInt(u.searchParams.get('number'), 10);
      if (!repo || !number) return sendJson(res, 400, { error: 'missing params' });
      const [owner, repoName] = repo.split('/');
      const detail = await getPRDetail(owner, repoName, number);
      return sendJson(res, 200, detail);
    }
    if (p === '/api/card-detail' && req.method === 'GET') {
      const cardId = u.searchParams.get('id');
      if (!cardId) return sendJson(res, 400, { error: 'missing id' });
      const detail = await getCardDetail(cardId);
      return sendJson(res, 200, detail);
    }
    if (p === '/api/command' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const text = (body.text || '').trim();
      if (!text) return sendJson(res, 400, { error: 'empty command' });
      const project = body.projectId ? store.getProject(body.projectId) : null;
      const effectiveRepo = await resolveRepo(project);
      dropState();
      try {
        const result = await withRun(body.projectId, body.sessionId, effectiveRepo, () => owner.runCommand(text));
        return sendJson(res, 200, { ok: true, result });
      } catch (e) {
        if (!isAbort(e)) activity.run({ projectId: body.projectId, sessionId: body.sessionId }, () => activity.push('system', '⚠️ ' + e.message));
        return sendJson(res, 200, { ok: false, error: isAbort(e) ? 'stopped' : e.message });
      }
    }
    if (p === '/api/code-task' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const cardId = (body.cardId || '').trim();
      if (!cardId) return sendJson(res, 400, { error: 'missing cardId' });
      const project = body.projectId ? store.getProject(body.projectId) : null;
      const effectiveRepo = await resolveRepo(project);
      dropState();
      try {
        const result = await withRun(body.projectId, body.sessionId, effectiveRepo, () => owner.runCodeTask(cardId));
        return sendJson(res, 200, { ok: !!(result && result.ok), result });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: isAbort(e) ? 'stopped' : e.message });
      }
    }
    if (p === '/api/review' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const cardId = (body.cardId || '').trim();
      if (!cardId) return sendJson(res, 400, { error: 'missing cardId' });
      const project = body.projectId ? store.getProject(body.projectId) : null;
      const effectiveRepo = await resolveRepo(project);
      dropState();
      try {
        const result = await withRun(body.projectId, body.sessionId, effectiveRepo, () => owner.runReview(cardId));
        return sendJson(res, 200, { ok: !!(result && result.ok), result });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: isAbort(e) ? 'stopped' : e.message });
      }
    }
    if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'unknown endpoint' });
    return serveStatic(res, p);
  } catch (e) {
    return sendJson(res, 500, { error: e.message });
  }
});

// ---- auto-runner: full-autonomy execution loop ---------------------------
// When a project's Play/Stop is on (autoMode), the board advances by itself:
// each tick runs the Tech Lead on a review-ready card (→ merge to develop), or
// the Developer on a To Do / In Progress card (→ open a PR). Real GitHub ops.
// One step per tick per project; a per-project gate prevents overlap.
const autoBusy = new Set();

function latestSessionId(pid) {
  const ss = store.listSessions(pid) || [];
  if (!ss.length) return null;
  return ss.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0].id;
}

async function nextAutoCard(repoNorm) {
  const L = config.trello.lists;
  const pick = async (key) => {
    const cards = await T.listCards(L[key]);
    return cards.find((c) => normRepo(T.parseMeta(c.desc).repo) === repoNorm) || null;
  };
  const rev = await pick('review');
  if (rev) return { card: rev, kind: 'review' };
  const code = (await pick('todo')) || (await pick('prog'));
  if (code) return { card: code, kind: 'code' };
  return null;
}

async function autoStepProject(project) {
  const effectiveRepo = await resolveRepo(project);
  const repoNorm = normRepo(effectiveRepo || project.repo);
  if (!repoNorm || repoNorm.indexOf('/') < 0) return; // need a real owner/repo to act
  const next = await nextAutoCard(repoNorm);
  if (!next) return;
  const sid = latestSessionId(project.id);
  dropState();
  await withRun(project.id, sid, effectiveRepo, () =>
    next.kind === 'review' ? owner.runReview(next.card.id) : owner.runCodeTask(next.card.id),
  );
  dropState();
}

async function autoTick() {
  let projects = [];
  try { projects = store.listProjects().filter((p) => p.autoMode); } catch { return; }
  for (const project of projects) {
    if (autoBusy.has(project.id)) continue;
    autoBusy.add(project.id);
    autoStepProject(project)
      .catch((e) => { try { console.error('[auto] ' + project.id + ': ' + (e && e.message ? e.message : e)); } catch {} })
      .finally(() => autoBusy.delete(project.id));
  }
}
const AUTO_INTERVAL = Number(process.env.AUTO_INTERVAL_MS || 20000);
setInterval(autoTick, AUTO_INTERVAL);

server.listen(config.port, () => {
  console.log('🚀 Startup Dashboard ready on http://localhost:' + config.port);
  console.log('   Claude bridge expected at ' + config.bridge);
  console.log('   Auto-runner tick every ' + Math.round(AUTO_INTERVAL / 1000) + 's (active for projects with Play on)');
});
