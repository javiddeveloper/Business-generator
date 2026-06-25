// Startup Dashboard — zero-dependency Node server.
// Serves the dark-modern frontend and proxies Trello / GitHub / the Claude bridge,
// keeping all tokens server-side. Run it on the host (next to claude-bridge.js):
//   node dashboard/server.js     →   http://localhost:8090
const http = require('http');
const fs = require('fs');
const path = require('path');

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
const { deleteClone } = repo;

// guarantee at least one project so the UI is never empty
store.bootstrap('');

const normRepo = (u) =>
  String(u || '').trim().replace(/\.git$/, '').replace(/^https?:\/\/github\.com\//i, '').replace(/^github\.com\//i, '');

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
async function buildState(project) {
  const repo = project ? normRepo(project.repo) : '';
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
    project: project ? { id: project.id, project: project.name, repo: project.repo } : null,
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
  const state = await buildState(project);
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
      const key = 'state:' + (pid || '-');
      return sendJson(res, 200, await cached(key, 3000, () => loadState(project)));
    }
    if (p === '/api/browse' && req.method === 'POST') {
      const os = require('os');
      const { exec } = require('child_process');
      let cmd = '';
      if (os.platform() === 'win32') {
        cmd = 'powershell -NoProfile -Command "Add-Type -AssemblyName System.windows.forms; $f=New-Object System.Windows.Forms.FolderBrowserDialog; [void]$f.ShowDialog(); $f.SelectedPath"';
      } else if (os.platform() === 'darwin') {
        cmd = 'osascript -e \'POSIX path of (choose folder)\'';
      } else {
        cmd = 'zenity --file-selection --directory';
      }
      return new Promise((resolve) => {
        exec(cmd, (err, stdout) => {
          let selected = stdout ? stdout.trim() : '';
          sendJson(res, 200, { path: selected });
          resolve();
        });
      });
    }
    // ---- projects --------------------------------------------------------
    if (p === '/api/projects' && req.method === 'GET') return sendJson(res, 200, store.listProjects());
    if (p === '/api/projects' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      return sendJson(res, 200, store.createProject(body.name, body.repo));
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
      dropState();
      try {
        const result = await withRun(body.projectId, body.sessionId, project && project.repo, () => owner.runCommand(text));
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
      dropState();
      try {
        const result = await withRun(body.projectId, body.sessionId, project && project.repo, () => owner.runCodeTask(cardId));
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
      dropState();
      try {
        const result = await withRun(body.projectId, body.sessionId, project && project.repo, () => owner.runReview(cardId));
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

server.listen(config.port, () => {
  console.log('🚀 Startup Dashboard ready on http://localhost:' + config.port);
  console.log('   Claude bridge expected at ' + config.bridge);
});
