// Product-Owner control actions, callable from the dashboard composer.
// Mirrors n8n WF1 so you get the full Bale command set without Bale:
//   idea (new project) | fix: | feature: | /exit | /report
const { config, COLUMNS } = require('./env');
const T = require('./trello');
const { gh } = require('./github');
const { claude, jparse } = require('./claude');
const bale = require('./bale');
const activity = require('./activity');

const enc = (s) => Buffer.from(s || '', 'utf8').toString('base64');
const normRepo = (u) =>
  String(u || '')
    .trim()
    .replace(/\.git$/, '')
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^github\.com\//i, '');

// Agent reply helper: log to the timeline AND mirror to Bale.
function reply(text) {
  activity.push('agent', text);
  bale.send(text);
}

// ---- stack reading (served by the Claude bridge) -------------------------
const STACK_DEFAULT = {
  backend: 'Backend: Python + Django + DRF, clean architecture, all code under backend/, >=3 pytest tests.',
  frontend: 'Frontend: Angular standalone + TypeScript, all code under frontend/, package.json test script, >=3 tests.',
  mobile: 'Mobile: Kotlin Multiplatform + Compose, all code under mobile/ with Gradle, >=3 kotlin.test tests.',
};
async function readStack(track) {
  try {
    const res = await fetch(config.bridge + '/stack/' + track);
    const v = (await res.text()).trim();
    return v || STACK_DEFAULT[track];
  } catch (e) {
    return STACK_DEFAULT[track];
  }
}

// ---- per-stack CI generators (ported from WF1) ---------------------------
const mkWf = (track, steps) =>
  [
    'name: CI ' + track,
    'on:',
    '  pull_request:',
    '    branches: [ develop ]',
    '    paths:',
    "      - '" + track + "/**'",
    '  workflow_dispatch:',
    'jobs:',
    '  ' + track + ':',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
  ]
    .concat(steps)
    .join('\n') + '\n';

const ciBackend = (s) => {
  s = String(s || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .toLowerCase();
  if (/(node|express|nest|npm|javascript|typescript)/.test(s) && !/(python|django|flask|fastapi)/.test(s))
    return mkWf('backend', [
      '      - uses: actions/setup-node@v4',
      "        with: { node-version: '20' }",
      '      - name: install & test',
      '        run: |',
      '          cd backend',
      '          npm ci || npm install',
      '          CI=true npm test',
    ]);
  if (/(golang|\bgo\b)/.test(s))
    return mkWf('backend', [
      '      - uses: actions/setup-go@v5',
      "        with: { go-version: '1.22' }",
      '      - name: test',
      '        run: |',
      '          cd backend',
      '          go test ./...',
    ]);
  return mkWf('backend', [
    '      - uses: actions/setup-python@v5',
    "        with: { python-version: '3.12' }",
    '      - name: install & test',
    '        run: |',
    '          cd backend',
    '          pip install -r requirements.txt 2>/dev/null || pip install django djangorestframework pytest pytest-django',
    '          python -m pytest -q',
  ]);
};
const ciFrontend = (s) => {
  s = String(s || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .toLowerCase();
  if (/(angular|react|vue|svelte|next|vite|npm|package\.json|jest|jasmine|karma|typescript|\bnode\b)/.test(s))
    return mkWf('frontend', [
      '      - uses: actions/setup-node@v4',
      "        with: { node-version: '20' }",
      '      - name: install & test',
      '        run: |',
      '          cd frontend',
      '          npm ci || npm install',
      '          CI=true npm test',
    ]);
  return mkWf('frontend', [
    '      - name: static html check',
    '        run: |',
    '          cd frontend',
    '          n=$(find . -name "*.html" | wc -l)',
    '          if [ "$n" -eq 0 ]; then echo "no html files"; exit 1; fi',
    '          echo "static frontend ok ($n html files)"',
  ]);
};
const ciMobile = (s) => {
  s = String(s || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .toLowerCase();
  if (/(flutter|dart)/.test(s))
    return mkWf('mobile', [
      '      - uses: subosito/flutter-action@v2',
      "        with: { channel: 'stable' }",
      '      - name: test',
      '        run: |',
      '          cd mobile',
      '          flutter pub get',
      '          flutter test',
    ]);
  if (/(react native|react-native)/.test(s))
    return mkWf('mobile', [
      '      - uses: actions/setup-node@v4',
      "        with: { node-version: '20' }",
      '      - name: test',
      '        run: |',
      '          cd mobile',
      '          npm ci || npm install',
      '          CI=true npm test',
    ]);
  return mkWf('mobile', [
    '      - uses: actions/setup-java@v4',
    "        with: { distribution: 'temurin', java-version: '17' }",
    '      - name: test',
    '        run: |',
    '          cd mobile',
    '          chmod +x gradlew',
    '          ./gradlew test',
  ]);
};

// ---- repo bootstrap (main+develop, monorepo scaffold, per-stack CI) -------
async function bootstrap(repo) {
  const [o, r] = repo.split('/');
  let okMain = true;
  try {
    await gh('GET', '/repos/' + o + '/' + r + '/git/ref/heads/main');
  } catch (e) {
    okMain = false;
  }
  if (!okMain) await gh('PUT', '/repos/' + o + '/' + r + '/contents/README.md', { message: 'init', content: enc('# ' + r + '\n') });

  const sb = await readStack('backend'),
    sf = await readStack('frontend'),
    sm = await readStack('mobile');
  const wfFiles = {
    '.github/workflows/backend.yml': ciBackend(sb),
    '.github/workflows/frontend.yml': ciFrontend(sf),
    '.github/workflows/mobile.yml': ciMobile(sm),
  };
  const scaffold = {
    'backend/README.md': '# Backend\n',
    'frontend/README.md': '# Frontend\n',
    'mobile/README.md': '# Mobile\n',
    'docs/api/API.md': '# API Documentation\n',
  };

  let okDev = true;
  try {
    await gh('GET', '/repos/' + o + '/' + r + '/git/ref/heads/develop');
  } catch (e) {
    okDev = false;
  }
  if (!okDev) {
    try {
      const ref = await gh('GET', '/repos/' + o + '/' + r + '/git/ref/heads/main');
      await gh('POST', '/repos/' + o + '/' + r + '/git/refs', { ref: 'refs/heads/develop', sha: ref.object.sha });
    } catch (e) {}
  }

  const getSha = async (branch, p) => {
    try {
      return (await gh('GET', '/repos/' + o + '/' + r + '/contents/' + p + '?ref=' + branch)).sha;
    } catch (e) {
      return null;
    }
  };
  const put = async (branch, p, content, overwrite) => {
    const sha = await getSha(branch, p);
    if (sha && !overwrite) return null;
    const body = { message: 'chore: ci ' + p, content: enc(content), branch };
    if (sha) body.sha = sha;
    try {
      await gh('PUT', '/repos/' + o + '/' + r + '/contents/' + p, body);
      return null;
    } catch (e) {
      return (e && e.message) || String(e);
    }
  };

  let wfErr = '';
  for (const br of ['main', 'develop']) {
    for (const p of Object.keys(wfFiles)) {
      const er = await put(br, p, wfFiles[p], true);
      if (er && !wfErr) wfErr = p + ' (' + br + '): ' + er;
    }
    for (const p of Object.keys(scaffold)) await put(br, p, scaffold[p], false);
  }
  if (wfErr) throw new Error('CI push failed: ' + String(wfErr).slice(0, 250) + ' — token needs repo+workflow scope.');
}

// ---- find the active project's meta from any populated column -------------
async function findMeta() {
  const L = config.trello.lists;
  for (const k of ['todo', 'prog', 'review', 'wait']) {
    const cs = await T.listCards(L[k]);
    for (const c of cs) {
      const mm = T.parseMeta(c.desc);
      if (mm.repo) return mm;
    }
  }
  return null;
}

async function countActive() {
  const L = config.trello.lists;
  let n = 0;
  for (const k of ['todo', 'prog', 'review', 'wait']) n += (await T.listCards(L[k])).length;
  return n;
}

// ---- command handlers ----------------------------------------------------
async function handleIdea({ name, repo, idea, link }) {
  const L = config.trello.lists;
  if (!name || !repo || !idea) throw new Error('idea needs name, repo and idea');
  if ((await countActive()) > 0) {
    reply('⛔ یک پروژه در جریان است. تا تمام نشود ایده‌ی جدید نمی‌گیرم؛ از fix:/feature: استفاده کن.');
    return { blocked: true };
  }
  // clear board
  for (const k of Object.keys(L)) {
    for (const c of await T.listCards(L[k])) await T.deleteCard(c.id);
  }
  repo = normRepo(repo);
  const v = jparse(
    await claude('Is this a real software idea? Reply JSON {is_valid:boolean, reason:string}. Only JSON. Idea: ' + idea, 500),
  ) || { is_valid: true };
  if (v.is_valid === false) {
    reply('⚠️ ایده‌ی معتبر نیست: ' + (v.reason || ''));
    return { invalid: true };
  }
  reply('⏳ پروژه «' + name + '» در حال آماده‌سازی ریپو و تسک‌ها...');
  await bootstrap(repo);
  reply('🛠️ CI متناسب با استک‌ها روی develop راه‌اندازی شد. هر PR قبل از merge باید CI سبز بگیرد.');

  const raw = await claude(
    'Break this idea into atomic tasks. ' +
      (link ? 'Reference: ' + link + '. ' : '') +
      'Project: ' +
      name +
      '. Only the parts the idea needs (backend/frontend/mobile). Output JSON only with key "tasks": array of {title, desc, track, complexity}. track ∈ backend/frontend/mobile. complexity ∈ boilerplate/medium/complex. Add at least one test task per part. Idea: ' +
      idea,
    4000,
  );
  const tasks = (jparse(raw) && jparse(raw).tasks) || [];
  if (!tasks.length) {
    reply('⚠️ تسکی تولید نشد. پاسخ مدل:\n' + String(raw).slice(0, 400));
    return { notasks: true };
  }
  const hasBackend = tasks.some((t) => (t.track || 'backend').toLowerCase() === 'backend');
  const names = [];
  for (const t of tasks) {
    const tr = (t.track || 'backend').toLowerCase();
    const list = tr === 'backend' ? L.todo : hasBackend ? L.wait : L.todo;
    const cname = '[' + tr + '][' + (t.complexity || 'medium') + '] ' + t.title;
    const desc = (t.desc || '') + '\n\n---\nrepo: ' + repo + '\nproject: ' + name + (link ? '\nref: ' + link : '');
    await T.createCard(list, cname, desc);
    names.push('• ' + cname);
  }
  reply('✅ پروژه «' + name + '» شروع شد. ' + tasks.length + ' تسک:\n\n' + names.join('\n'));
  return { project: name, count: tasks.length };
}

async function handleFixFeature(kind, desc) {
  const L = config.trello.lists;
  const mm = await findMeta();
  if (!mm) {
    reply('⚠️ پروژه‌ی فعالی نیست. اول یک ایده‌ی کامل بفرست.');
    return { skip: true };
  }
  const label = kind === 'fix' ? 'رفع باگ' : 'قابلیت جدید';
  const t = jparse(
    await claude(
      'This is a ' +
        kind +
        ' request. Reply JSON {title, desc, track(backend/frontend/mobile), complexity(boilerplate/medium/complex)}. Only JSON. Request: ' +
        desc,
      1500,
    ),
  ) || { title: (desc || '').slice(0, 50), desc, track: 'backend', complexity: 'medium' };
  const name = '[' + (t.track || 'backend') + '][' + (t.complexity || 'medium') + '][' + kind + '] ' + t.title;
  const body = (t.desc || '') + '\n\n---\nrepo: ' + mm.repo + '\nproject: ' + mm.project + (mm.ref ? '\nref: ' + mm.ref : '');
  await T.createCard(L.todo, name, body);
  reply('✅ ' + label + ' اضافه شد:\n• ' + name);
  return { added: name };
}

async function handleExit() {
  const L = config.trello.lists;
  let cleared = 0;
  for (const k of Object.keys(L)) {
    const cs = await T.listCards(L[k]);
    cleared += cs.length;
    for (const c of cs) await T.deleteCard(c.id);
  }
  reply('🛑 خروج اضطراری: ' + cleared + ' تسک متوقف و از برد پاک شد.');
  return { exit: cleared };
}

async function handleReport() {
  const L = config.trello.lists;
  const SLABEL = { todo: 'To Do', prog: 'In Progress', wait: 'Waiting API', review: 'In Review', owner: 'Done/merge' };
  let blocks = [],
    total = 0;
  for (const col of COLUMNS) {
    const cs = await T.listCards(L[col.key]);
    for (const c of cs) {
      total++;
      const acts = await T.cardComments(c.id);
      const comments = (acts || []).map((a) => a && a.data && a.data.text).filter(Boolean).reverse();
      const bugs = comments.filter((t) => t.indexOf('🔴') >= 0).length;
      const fixes = comments.filter((t) => t.indexOf('🛠️') >= 0).length;
      const dsc = String(c.desc || '').split('\n---')[0].trim().slice(0, 300);
      blocks.push(
        '### ' + c.name + '\nStatus: ' + SLABEL[col.key] + ' | bugs: ' + bugs + ' | fixes: ' + fixes + '\nDesc: ' + (dsc || '-'),
      );
    }
  }
  if (!total) {
    reply('📊 گزارش: برد خالی است.');
    return { report: 0 };
  }
  let rep = '';
  try {
    rep = await claude(
      'Write a concise Persian per-task status report from this data. For each task: topic, status/progress, bugs and how fixed.\n\n' +
        blocks.join('\n\n'),
      3500,
    );
  } catch (e) {}
  reply('📊 گزارش به ازای هر تسک:\n\n' + (rep || blocks.join('\n\n')));
  return { report: total };
}

// ---- composer entry point: parse a Bale-style command and dispatch --------
async function runCommand(text) {
  const t = String(text || '').trim();
  const low = t.toLowerCase();
  activity.push('user', t);

  if (low === '/exit' || low === '/stop') return handleExit();
  if (low === '/report') return handleReport();
  if (low === '/help' || low === '/start') {
    reply('🤖 دستورها: idea (name/repo/idea) | fix: ... | feature: ... | /report | /exit');
    return { help: true };
  }
  if (low.startsWith('fix:')) return handleFixFeature('fix', t.slice(4).trim());
  if (low.startsWith('feature:')) return handleFixFeature('feature', t.slice(8).trim());
  if (/name:|repo:|idea:/i.test(t)) {
    const g = (re) => {
      const m = t.match(re);
      return m ? m[1].trim() : '';
    };
    return handleIdea({
      name: g(/name:\s*(.+)/i),
      repo: g(/repo:\s*(\S+)/i),
      link: g(/link:\s*(\S+)/i),
      idea: g(/idea:\s*([\s\S]+)/i),
    });
  }
  reply('🤷 دستور شناخته نشد. برای راهنما /help بزن.');
  return { unknown: true };
}

module.exports = { runCommand };
