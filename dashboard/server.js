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

const countTag = (comments, tag) => comments.filter((t) => t.indexOf(tag) >= 0).length;

// ---- board state ---------------------------------------------------------
async function buildState() {
  const L = config.trello.lists;
  let project = null;
  const columns = [];
  let totalTasks = 0,
    totalBugs = 0,
    totalFixes = 0;

  for (const col of COLUMNS) {
    const cards = await T.listCards(L[col.key]);
    const outCards = [];
    for (const c of cards) {
      const mm = T.parseMeta(c.desc);
      if (!project && mm.repo) project = mm;
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
    project,
    columns,
    totals: { tasks: totalTasks, bugs: totalBugs, fixes: totalFixes },
    system: { bridge, configured: config.configured },
    ts: Date.now(),
  };
}

// ---- activity timeline (Trello comments + local log, merged & sorted) -----
async function buildActivity() {
  const L = config.trello.lists;
  const events = [];
  for (const col of COLUMNS) {
    const cards = await T.listCards(L[col.key]);
    for (const c of cards) {
      const acts = await T.cardComments(c.id, 15);
      for (const a of acts || []) {
        const text = a && a.data && a.data.text;
        if (!text) continue;
        events.push({
          id: a.id,
          ts: new Date(a.date).getTime(),
          role: 'agent',
          card: c.name,
          column: col.name,
          text,
        });
      }
    }
  }
  for (const ev of activity.list()) events.push(ev);
  events.sort((a, b) => a.ts - b.ts);
  return events.slice(-120);
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
        cache.delete('state'); // health reflects the new engine on next poll
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
    if (p === '/api/state') return sendJson(res, 200, await cached('state', 3000, buildState));
    if (p === '/api/activity') return sendJson(res, 200, await cached('activity', 3000, buildActivity));
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
      cache.delete('state'); // reflect changes on next poll immediately
      cache.delete('activity');
      try {
        const result = await owner.runCommand(text);
        return sendJson(res, 200, { ok: true, result });
      } catch (e) {
        activity.push('system', '⚠️ ' + e.message);
        return sendJson(res, 200, { ok: false, error: e.message });
      }
    }
    if (p === '/api/code-task' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const cardId = (body.cardId || '').trim();
      if (!cardId) return sendJson(res, 400, { error: 'missing cardId' });
      cache.delete('state');
      cache.delete('activity');
      try {
        const result = await owner.runCodeTask(cardId);
        return sendJson(res, 200, { ok: !!(result && result.ok), result });
      } catch (e) {
        return sendJson(res, 200, { ok: false, error: e.message });
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
