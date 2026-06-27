// Product-Owner control actions, callable from the dashboard composer.
// Mirrors n8n WF1 so you get the full Bale command set without Bale:
//   idea (new project) | fix: | feature: | /exit | /report
const { config, COLUMNS } = require('./env');
const T = require('./trello');
const { gh } = require('./github');
const { claude, jparse } = require('./claude');
const bale = require('./bale');
const activity = require('./activity');
const store = require('./store');
const repoLib = require('./repo');
const memory = require('./memory');

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

async function readRole(role) {
  try {
    const res = await fetch(config.bridge + '/role/' + role);
    return (await res.text()).trim();
  } catch (e) {
    return '';
  }
}

// ---- manual developer run (the n8n WF2 pipeline, triggered from the dashboard)
// Lets you test the clone+real-agent flow on one card without n8n: builds the
// same agent brief, calls the bridge /code-task, then opens the PR and moves the
// card to In Review. Mirrors workflows/workflow-2-developer.json.
async function runCodeTask(cardId) {
  const L = config.trello.lists;
  const detail = await T.getCardDetail(cardId);
  if (!detail || !detail.name) {
    reply('⚠️ کارت پیدا نشد.');
    return { error: 'card not found' };
  }
  const mm = T.parseMeta(detail.desc);
  if (!mm.repo) {
    reply('⚠️ این کارت آدرس repo ندارد؛ نمی‌توان کلون کرد.');
    return { error: 'no repo' };
  }
  const track = T.trackOf(detail.name);
  const dir = track + '/';
  const branch = 'task/' + cardId;

  // fix mode: branch already exists → patch, don't rewrite
  let isFix = false;
  try {
    await gh('GET', '/repos/' + mm.repo + '/git/ref/heads/' + branch);
    isFix = true;
  } catch (e) {}
  let failLog = '';
  if (isFix && detail.comments && detail.comments.length) {
    failLog = detail.comments.slice(0, 3).map((c) => c.text).filter(Boolean).join('\n----\n');
  }
  let apiDocs = '';
  if (track !== 'backend') {
    try {
      apiDocs = await gh('GET', '/repos/' + mm.repo + '/contents/docs/api/API.md?ref=develop', null, true);
    } catch (e) {}
  }

  reply('🚀 اجرای تسک «' + detail.name + '» روی ' + mm.repo + ' (کلون + agent)…');

  const stackText = await readStack(track);
  const devRole = (await readRole('developer')) || '';
  const base =
    (devRole ? devRole + '\n\n' : '') +
    stackText +
    '\nنام پروژه: ' + (mm.project || '') +
    (mm.ref ? '\nمرجع: ' + mm.ref : '') +
    '\nهمه‌ی کد باید زیر پوشه‌ی ' + dir + ' باشد.' +
    reportContext() +
    (apiDocs ? '\n\nمستندات API:\n' + apiDocs : '');
  const workRules =
    '\n\nتو داخل یک checkout گیت از پروژه کار می‌کنی و به ابزارهای Read/Grep/Edit/Write/Bash دسترسی کامل داری. قبل از نوشتن، فایل‌های همسایه را بخوان تا از قراردادها پیروی کنی. همه‌ی کد و تست‌ها باید زیر ' + dir + ' باشند؛ به track‌های دیگر دست نزن. طبق استک حداقل ۳ تست واقعی بنویس.\n\n⚙️ قبل از پایان، تست‌ها را با Bash لوکال اجرا کن و فقط وقتی سبز شدند کار را تمام کن. وقتی تمام شد متوقف شو.';
  const prompt = isFix
    ? base + workRules +
      '\n\n⚠️ این تسک قبلاً پیاده‌سازی شده بود ولی باگ/خطای build یا test داشت و برگشت. کد فعلی در working tree موجود است؛ آن را بخوان و فقط مشکل را رفع کن (بازنویسی نکن).\n\nخطاها:\n' +
      (failLog || '(نامشخص — کد را بازبینی کن)') +
      '\n\nتسک:\n' + detail.name + '\n' + detail.desc
    : base + workRules + '\n\nتسک:\n' + detail.name + '\n' + detail.desc;

  let ct;
  try {
    const r = await fetch(config.bridge + '/code-task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo: mm.repo,
        cloneUrl: mm.clone || '',
        branch,
        track,
        task: prompt,
        message: (isFix ? 'fix: ' : 'feat: ') + detail.name,
      }),
    });
    ct = await r.json();
  } catch (e) {
    ct = { ok: false, error: e.message };
  }

  if (!ct || !ct.ok) {
    reply('⚠️ اجرای تسک ناموفق: ' + ((ct && ct.error) || 'خطای نامشخص'));
    return ct || { error: 'failed' };
  }
  if (!ct.committed) {
    reply('⚠️ agent تغییری اعمال نکرد' + (ct.noChanges ? ' (no changes)' : '') + '.');
    return ct;
  }

  const [o, r] = mm.repo.split('/');
  let pr;
  try {
    pr = await gh('POST', '/repos/' + o + '/' + r + '/pulls', {
      title: detail.name,
      head: branch,
      base: 'develop',
      body: 'Trello: ' + cardId + '\nTrack: ' + track + '\nFiles: ' + (ct.filesChanged || []).slice(0, 20).join(', ') + '\n\n' + (detail.desc || ''),
    });
  } catch (e) {
    try {
      const ex = await gh('GET', '/repos/' + o + '/' + r + '/pulls?head=' + o + ':' + branch + '&state=open');
      pr = (ex && ex[0]) || null;
    } catch (e2) {}
    if (!pr) {
      reply('⚠️ کد push شد ولی ساخت PR ناموفق بود: ' + (e.message || ''));
      return { ok: true, committed: true, prError: true, branch };
    }
  }
  if (isFix) {
    const chg = (ct.filesChanged || []).slice(0, 12).join('، ');
    try { await T.addComment(cardId, '🛠️ فیکس اعمال شد (PR #' + pr.number + '). فایل‌ها: ' + (chg || '-')); } catch (e) {}
  }
  await T.moveCard(cardId, L.review);
  reply((isFix ? '🔧 فیکس شد و رفت برای ریویو: ' : '👀 رفت برای ریویو: ') + detail.name + '\nPR: ' + pr.html_url + '\nفایل‌ها: ' + (ct.filesChanged || []).length);
  return { ok: true, pr: pr.number, url: pr.html_url, files: (ct.filesChanged || []).length, isFix };
}

// ---- manual Tech Lead review (the n8n WF3 pipeline, from the dashboard) ----
// Reviews one In-Review card's PR: conflict/CI gate → Claude code review →
// APPROVE = squash-merge to develop + move card to Done; REQUEST_CHANGES (or
// CI fail/conflict) = close PR + send card back to To Do for a fix pass.
// Mirrors workflows/workflow-3-tech-lead.json.
async function runReview(cardId) {
  const L = config.trello.lists;
  const detail = await T.getCardDetail(cardId);
  if (!detail || !detail.name) {
    reply('⚠️ کارت پیدا نشد.');
    return { ok: false, error: 'card not found' };
  }
  const mm = T.parseMeta(detail.desc);
  if (!mm.repo) {
    reply('⚠️ این کارت آدرس repo ندارد.');
    return { ok: false, error: 'no repo' };
  }
  const [o, r] = mm.repo.split('/');
  const track = T.trackOf(detail.name);

  reply('🏗️ Tech Lead در حال ریویوی «' + detail.name + '»…');

  let prNum = null;
  try {
    const list = await gh('GET', '/repos/' + o + '/' + r + '/pulls?state=open&base=develop&per_page=100');
    const match = (list || []).find((p) => p && p.head && p.head.ref === 'task/' + cardId);
    if (match) prNum = match.number;
  } catch (e) {
    reply('⚠️ خطا در گرفتن لیست PRها: ' + e.message);
    return { ok: false, error: e.message };
  }
  if (!prNum) {
    reply('⚠️ برای این کارت PR بازی به develop پیدا نشد (شاید قبلاً merge/بسته شده).');
    return { ok: false, error: 'no open PR' };
  }

  let pr;
  try {
    pr = await gh('GET', '/repos/' + o + '/' + r + '/pulls/' + prNum);
  } catch (e) {
    reply('⚠️ خواندن PR #' + prNum + ' ناموفق: ' + e.message);
    return { ok: false, error: e.message };
  }

  // conflict with develop → close + send back to fix
  if (pr.mergeable === false || pr.mergeable_state === 'dirty') {
    try { await gh('PATCH', '/repos/' + o + '/' + r + '/pulls/' + prNum, { state: 'closed' }); } catch (e) {}
    await T.addComment(cardId, '🔴 کانفلیکت با develop در PR #' + prNum + '؛ PR بسته شد و تسک برای بازسازی برگشت.');
    await T.moveCard(cardId, L.todo);
    reply('⚠️ کانفلیکت در PR #' + prNum + '. بسته شد و کارت به «در صف» برگشت.');
    return { ok: true, status: 'conflict', pr: prNum };
  }

  // CI gate — never merge without a green CI
  let runs = [];
  try {
    runs = (await gh('GET', '/repos/' + o + '/' + r + '/commits/' + pr.head.sha + '/check-runs')).check_runs || [];
  } catch (e) {}
  if (runs.length && runs.some((x) => x.status !== 'completed')) {
    reply('⏳ CI هنوز در حال اجراست؛ کمی بعد دوباره ریویو بزن.');
    return { ok: true, status: 'waitCI', pr: prNum };
  }
  const failed = runs.filter((x) => x.conclusion && !['success', 'neutral', 'skipped'].includes(x.conclusion));
  if (failed.length) {
    let log = '';
    for (const x of failed) {
      log += '### ' + x.name + ' → ' + x.conclusion + '\n';
      if (x.output && x.output.summary) log += String(x.output.summary).slice(0, 800) + '\n';
    }
    log = log.trim().slice(0, 4000) || 'بدون جزئیات';
    try { await gh('PATCH', '/repos/' + o + '/' + r + '/pulls/' + prNum, { state: 'closed' }); } catch (e) {}
    await T.addComment(cardId, '🔴 CI رد شد (build/test) در PR #' + prNum + '. لاگ:\n' + log);
    await T.moveCard(cardId, L.todo);
    reply('❌ CI رد شد. PR بسته شد و کارت برای فیکس به «در صف» برگشت.');
    return { ok: true, status: 'ciFail', pr: prNum };
  }

  // Claude code review
  let files = [];
  try { files = await gh('GET', '/repos/' + o + '/' + r + '/pulls/' + prNum + '/files'); } catch (e) {}
  const diff = (files || []).map((f) => 'FILE: ' + f.filename + '\n' + (f.patch || '')).join('\n\n').slice(0, 12000);
  const tlRole = (await readRole('tech-lead')) || 'تو Tech Lead هستی.';
  const rev = jparse(
    await claude(
      tlRole +
        reportContext() +
        '\n\nاین diff را در برابر تسک و استاندارد استک (' + track +
        ') بسنج. خروجی فقط JSON با کلیدهای verdict (APPROVE یا REQUEST_CHANGES) و comment (فارسی). فقط JSON. تسک: ' +
        detail.name + '\n' + detail.desc + '\n\nDIFF:\n' + diff,
      1800,
    ),
  ) || { verdict: 'REQUEST_CHANGES', comment: 'خروجی ریویو خوانده نشد' };

  if (rev.verdict === 'APPROVE') {
    try { await gh('POST', '/repos/' + o + '/' + r + '/pulls/' + prNum + '/reviews', { event: 'APPROVE', body: rev.comment }); } catch (e) {}
    let merged = false, mergeErr = '';
    try {
      const mr = await gh('PUT', '/repos/' + o + '/' + r + '/pulls/' + prNum + '/merge', { merge_method: 'squash', commit_title: detail.name + ' (#' + prNum + ')' });
      merged = !!(mr && mr.merged);
      if (!merged) mergeErr = (mr && mr.message) || 'merge ناموفق';
    } catch (e) { mergeErr = e.message; }
    if (merged) {
      try { await gh('DELETE', '/repos/' + o + '/' + r + '/git/refs/heads/task/' + cardId); } catch (e) {}
      await T.moveCard(cardId, L.owner);
      reply('✅ تأیید و merge شد در develop: ' + detail.name + '\n' + (rev.comment || ''));
      return { ok: true, status: 'merged', pr: prNum };
    }
    await T.moveCard(cardId, L.owner);
    reply('✅ تأیید شد ولی merge خودکار نشد (' + mergeErr + '). دستی merge کن: ' + pr.html_url);
    return { ok: true, status: 'approved', pr: prNum, url: pr.html_url, mergeErr };
  }

  try { await gh('POST', '/repos/' + o + '/' + r + '/pulls/' + prNum + '/reviews', { event: 'REQUEST_CHANGES', body: rev.comment }); } catch (e) {}
  try { await gh('PATCH', '/repos/' + o + '/' + r + '/pulls/' + prNum, { state: 'closed' }); } catch (e) {}
  await T.addComment(cardId, '🔴 Tech Lead نیاز به اصلاح اعلام کرد: ' + (rev.comment || ''));
  await T.moveCard(cardId, L.todo);
  reply('🔧 نیاز به اصلاح: ' + detail.name + '\n' + (rev.comment || ''));
  return { ok: true, status: 'changes', pr: prNum, comment: rev.comment };
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

// A project stays "active" until the owner types `finish`. So the Done column
// (`owner`) counts too: even when every task is finished, the project remains
// live so fix:/feature: keep working and a new idea stays blocked.
const PROJECT_COLS = ['todo', 'prog', 'review', 'wait', 'owner'];

// repo of the active project (set by server via activity.run); '' when none.
const activeRepo = () => normRepo((activity.ctx() || {}).repo || '');
// keep only cards belonging to the active project (no filter when repo unknown).
function cardMatches(c, repo) {
  if (!repo) return true;
  return normRepo(T.parseMeta(c.desc).repo) === repo;
}

// ---- find the active project's meta from any populated column -------------
async function findMeta() {
  const L = config.trello.lists;
  const repo = activeRepo();
  for (const k of PROJECT_COLS) {
    const cs = await T.listCards(L[k]);
    for (const c of cs) {
      const mm = T.parseMeta(c.desc);
      if (mm.repo && cardMatches(c, repo)) return mm;
    }
  }
  return null;
}

async function countActive() {
  const L = config.trello.lists;
  const repo = activeRepo();
  let n = 0;
  for (const k of PROJECT_COLS) n += (await T.listCards(L[k])).filter((c) => cardMatches(c, repo)).length;
  return n;
}

// ---- model picker (proxied to the bridge) --------------------------------
async function bridgeModels() {
  const r = await fetch(config.bridge + '/models');
  return r.json();
}

async function handleModels() {
  let data;
  try {
    data = await bridgeModels();
  } catch (e) {
    reply('⚠️ پل در دسترس نیست؛ لیست مدل‌ها را نتوانستم بگیرم.');
    return { error: true };
  }
  const lines = data.models.map(
    (m, i) => (m.id === data.active ? '✅ ' : '▫️ ') + (i + 1) + '. ' + m.label,
  );
  reply('🧠 مدل‌ها (برای انتخاب: «/model شماره» یا «/model آی‌دی»):\n\n' + lines.join('\n'));
  return { models: data.models.length };
}

async function handleModel(arg) {
  let data;
  try {
    data = await bridgeModels();
  } catch (e) {
    reply('⚠️ پل در دسترس نیست.');
    return { error: true };
  }
  const a = String(arg || '').trim();
  let target = null;
  if (/^\d+$/.test(a)) target = data.models[Number(a) - 1];
  else target = data.models.find((m) => m.id === a);
  if (!target) {
    reply('⚠️ مدل پیدا نشد. «/models» را بزن تا لیست را ببینی.');
    return { notfound: true };
  }
  try {
    const r = await fetch(config.bridge + '/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: target.id }),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'switch failed');
    reply('✅ مدل فعال شد: ' + target.label);
    return { active: target.id };
  } catch (e) {
    reply('⚠️ تعویض مدل ناموفق: ' + e.message);
    return { error: true };
  }
}

// ---- command handlers ----------------------------------------------------
async function handleIdea({ name, repo, idea, link, clone }) {
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
    const desc = (t.desc || '') + '\n\n---\nrepo: ' + repo + '\nproject: ' + name + (link ? '\nref: ' + link : '') + (clone ? '\nclone: ' + clone : '');
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
  const body = (t.desc || '') + '\n\n---\nrepo: ' + mm.repo + '\nproject: ' + mm.project + (mm.ref ? '\nref: ' + mm.ref : '') + (mm.clone ? '\nclone: ' + mm.clone : '');
  await T.createCard(L.todo, name, body);
  reply('✅ ' + label + ' اضافه شد:\n• ' + name);
  return { added: name };
}

// Graceful project end: clear the board (and the canonical tasks file) so a
// fresh set of tasks can be started.
async function handleFinish() {
  const L = config.trello.lists;
  let cleared = 0;
  for (const k of Object.keys(L)) {
    const cs = await T.listCards(L[k]);
    cleared += cs.length;
    for (const c of cs) await T.deleteCard(c.id);
  }
  const pid = (activity.ctx() || {}).projectId;
  if (pid) store.writeTasks(pid, []); // keep the canonical file in sync
  reply('🏁 پروژه تمام شد و برد پاک شد (' + cleared + ' تسک). حالا می‌توانی تسک‌های جدید بسازی.');
  return { finished: cleared };
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

// ---- chat-first Product Owner -------------------------------------------
// The user only chats. The "agent" relays the message to the Product Owner,
// who — knowing the project's repo already — either answers the question or
// breaks the request into atomic tasks (Trello cards + the canonical tasks
// file). The agent does nothing else: it never writes code here; execution is
// governed by Play/Stop (auto-runner) or the manual run buttons.
// Ask the model with the project's real files in reach. When the active project
// has a local/cloned checkout, the prompt is run as a read-only agent *inside*
// that directory (so Read/Grep ground the answer and the model can break work
// into accurate tasks); otherwise it falls back to a plain bridge chat. This is
// what lets the Product Owner answer "what is this project / where is it" instead
// of only seeing the dashboard's own folder.
async function askProjectAware(prompt, maxTokens) {
  const ctx = activity.ctx() || {};
  let st = null;
  try { st = await repoLib.ensureGit(ctx.repo || ''); } catch (e) {}
  if (st && st.cloned && st.dir) {
    try {
      const r = await fetch(config.bridge + '/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctx.signal,
        body: JSON.stringify({ dir: st.dir, task: prompt, readonly: true, push: false }),
      });
      const j = await r.json().catch(() => ({}));
      if (j && j.ok && j.summary) return j.summary;
    } catch (e) {
      if (e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''))) throw e;
      // any other agent failure → fall back to plain chat below
    }
  }
  return claude(prompt, maxTokens);
}

async function runOwnerChat(text) {
  const ctx = activity.ctx() || {};
  const pid = ctx.projectId;
  const repo = normRepo(ctx.repo || '');
  const project = pid ? store.getProject(pid) : null;
  const projectName = (project && project.name) || '';
  const L = config.trello.lists;

  activity.push('user', text);

  const existing = (pid ? store.readTasks(pid) : []).map((t) => '• ' + t.title).join('\n');
  const poRole = (await readRole('product-owner')) || 'تو Product Owner یک تیم نرم‌افزاری هستی.';
  const prompt =
    poRole +
    '\n\nکاربر در حال گفتگو درباره‌ی پروژه «' + projectName + '»' + (repo ? ' (repo: ' + repo + ')' : '') + ' است. ' +
    'آدرس ریپو از قبل مشخص است؛ هرگز ریپو را نپرس.\n' +
    (existing ? 'تسک‌های فعلی این پروژه:\n' + existing + '\n\n' : '') +
    'پیام کاربر:\n' + text + '\n\n' +
    'تصمیم بگیر: اگر کاربر درخواست قابلیت/رفع‌باگ/کار جدید دارد، آن را به تسک‌های اتمیک بشکن (هر تسک کوچک و مستقل). ' +
    'اگر فقط سؤال یا مشورت است، tasks را خالی بگذار و در reply جواب بده.\n' +
    'فقط و فقط JSON برگردان با این شکل (بدون متن اضافه):\n' +
    '{"reply":"پیام دوستانه و فارسی به کاربر","tasks":[{"title":"...","desc":"...","track":"backend|frontend|mobile","complexity":"boilerplate|medium|complex"}]}';

  let raw = '';
  try {
    raw = await askProjectAware(prompt, 3000);
  } catch (e) {
    const msg = '⚠️ ' + (e.message || 'پاسخ مدل گرفته نشد');
    activity.push('agent', msg);
    return { reply: msg, tasksCreated: 0 };
  }
  const parsed = jparse(raw) || { reply: String(raw || '').trim(), tasks: [] };
  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const hasBackend = tasks.some((t) => (t.track || 'backend').toLowerCase() === 'backend');

  const created = [];
  for (const t of tasks) {
    if (!t || !t.title) continue;
    const tr = (t.track || 'backend').toLowerCase();
    const column = tr === 'backend' ? 'todo' : hasBackend ? 'wait' : 'todo';
    const complexity = t.complexity || 'medium';
    const name = '[' + tr + '][' + complexity + '] ' + t.title;
    const desc = (t.desc || '') + '\n\n---\nrepo: ' + repo + '\nproject: ' + projectName;
    let card = null;
    try { card = await T.createCard(L[column], name, desc); } catch (e) {}
    if (pid) store.addTask(pid, { cardId: card && card.id, title: t.title, desc: t.desc || '', track: tr, complexity, column });
    created.push('• ' + name);
  }

  let reply = (parsed.reply || '').trim();
  if (!reply && !created.length) reply = String(raw || '').trim() || 'متوجه نشدم؛ دوباره توضیح بده.';
  if (created.length) reply += (reply ? '\n\n' : '') + '✅ ' + created.length + ' تسک ساخته و به برد اضافه شد:\n' + created.join('\n');
  activity.push('agent', reply);
  return { reply, tasksCreated: created.length };
}

// ---- sync the canonical tasks file → Trello (on project switch) ----------
// File is the source of truth: any task whose card is missing from the board
// is (re)created so the active project always shows its own tasks. Existing
// cards are left untouched; nothing is deleted.
async function syncTasksToTrello(pid, repo, projectName) {
  const tasks = pid ? store.readTasks(pid) : [];
  if (!tasks.length) return { synced: 0 };
  const L = config.trello.lists;
  const liveIds = new Set();
  for (const k of Object.keys(L)) {
    for (const c of await T.listCards(L[k])) liveIds.add(c.id);
  }
  let created = 0;
  for (const task of tasks) {
    if (task.cardId && liveIds.has(task.cardId)) continue;
    const list = L[task.column] || L.todo;
    const name = '[' + (task.track || 'backend') + '][' + (task.complexity || 'medium') + '] ' + task.title;
    const desc = (task.desc || '') + '\n\n---\nrepo: ' + normRepo(repo) + '\nproject: ' + (projectName || '');
    try {
      const card = await T.createCard(list, name, desc);
      task.cardId = card && card.id;
      created++;
    } catch (e) {}
  }
  if (created) store.writeTasks(pid, tasks);
  return { synced: created };
}

// ---- progress report (Product Owner) ------------------------------------
// Generated when auto-run is stopped: "how far did we get, what's left".
// Stored per project so the Developer/Tech-Lead read it on the next run.
async function generateProgressReport() {
  const L = config.trello.lists;
  const pid = (activity.ctx() || {}).projectId;
  const repo = activeRepo();
  const SLABEL = { todo: 'در صف', prog: 'در حال انجام', wait: 'منتظر API', review: 'در حال ریویو', owner: 'تمام‌شده' };
  const counts = {};
  const blocks = [];
  for (const col of COLUMNS) {
    const cs = (await T.listCards(L[col.key])).filter((c) => cardMatches(c, repo));
    counts[col.key] = cs.length;
    for (const c of cs) {
      const acts = await T.cardComments(c.id, 10);
      const comments = (acts || []).map((a) => a && a.data && a.data.text).filter(Boolean);
      const bugs = comments.filter((t) => t.indexOf('🔴') >= 0).length;
      const dsc = String(c.desc || '').split('\n---')[0].trim().slice(0, 200);
      blocks.push('### ' + c.name + '\nوضعیت: ' + (SLABEL[col.key] || col.key) + ' | باگ: ' + bugs + '\n' + (dsc || ''));
    }
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  let text;
  if (!total) {
    text = '📋 گزارش وضعیت: هیچ تسکی روی برد این پروژه نیست.';
  } else {
    const poRole = (await readRole('product-owner')) || 'تو Product Owner هستی.';
    let body = '';
    try {
      body = await claude(
        poRole +
          '\n\nیک گزارش پیشرفت کوتاه و کاربردی به فارسی بنویس: «تا کجا پیش رفتیم» و «چقدر مانده». ' +
          'برای هر بخش وضعیت فعلی و قدم بعدیِ پیشنهادی را بگو. لحن مدیریتی و مختصر.\n\n' +
          'شمار ستون‌ها: ' + JSON.stringify(counts) + '\n\nتسک‌ها:\n' + blocks.join('\n\n'),
        2500,
      );
    } catch (e) {}
    const done = counts.owner || 0;
    const pct = total ? Math.round((done / total) * 100) : 0;
    text = '📋 گزارش وضعیت پروژه (پیشرفت تقریبی ' + pct + '٪ — ' + done + '/' + total + ' تسک تمام‌شده):\n\n' + (body || blocks.join('\n\n'));
  }
  if (pid) store.writeReport(pid, { text });
  // Mirror the stop report into the chained memory file in the checkout, so the
  // next run — regardless of which bridge is active — reads the same context.
  try {
    const st = await repoLib.status(activeRepo());
    if (st && st.cloned && st.dir) memory.sync(st.dir, text);
  } catch (e) {}
  activity.push('agent', text);
  return { report: text, total };
}

// The latest stored report, formatted to prepend to a developer/tech-lead brief.
function reportContext() {
  const pid = (activity.ctx() || {}).projectId;
  const rep = pid ? store.readReport(pid) : null;
  if (!rep || !rep.text) return '';
  return '\n\n📋 گزارش وضعیت قبلی پروژه (برای ادامه‌ی منسجم کار، اول این را بخوان و در نظر بگیر):\n' + rep.text + '\n';
}

// ---- composer entry point: parse a Bale-style command and dispatch --------
async function runCommand(text) {
  const t = String(text || '').trim();
  const low = t.toLowerCase();

  // Anything that isn't a known slash command is free chat → the Product Owner
  // (runOwnerChat logs the user+agent turns itself, so do it before our push).
  const isSlash = low === 'finish' || /^\/(finish|done|report|models?|model|help|start)\b/.test(low);
  if (!isSlash) return runOwnerChat(t);

  activity.push('user', t);

  // Execution lifecycle (start/stop everything) is now governed by Play/Stop,
  // so the emergency /exit command has been removed. /finish stays as the
  // graceful "clear the board" action.
  if (low === '/finish' || low === 'finish' || low === '/done') return handleFinish();
  if (low === '/report') return handleReport();
  if (low === '/models') return handleModels();
  if (low.startsWith('/model ') || low.startsWith('/model\n')) return handleModel(t.slice(6).trim());
  if (low === '/help' || low === '/start') {
    reply('🤖 دستورها: /report | /finish | /models | /model <شماره>\nبرای هر چیز دیگری فقط چت کن — تسک‌ها را Product Owner می‌سازد.');
    return { help: true };
  }
  return { unknown: true };
}

module.exports = { runCommand, runCodeTask, runReview, runOwnerChat, syncTasksToTrello, generateProgressReport };
