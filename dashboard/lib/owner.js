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

// Graceful project end: clear the board so a new idea can start.
// (Distinct from /exit which is the emergency stop — same effect, friendlier intent.)
async function handleFinish() {
  const L = config.trello.lists;
  let cleared = 0;
  for (const k of Object.keys(L)) {
    const cs = await T.listCards(L[k]);
    cleared += cs.length;
    for (const c of cs) await T.deleteCard(c.id);
  }
  reply('🏁 پروژه تمام شد و برد پاک شد (' + cleared + ' تسک). حالا می‌توانی ایده‌ی جدید بفرستی.');
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

// ---- composer entry point: parse a Bale-style command and dispatch --------
async function runCommand(text) {
  const t = String(text || '').trim();
  const low = t.toLowerCase();
  activity.push('user', t);

  if (low === '/exit' || low === '/stop') return handleExit();
  if (low === '/finish' || low === 'finish' || low === '/done') return handleFinish();
  if (low === '/report') return handleReport();
  if (low === '/models') return handleModels();
  if (low.startsWith('/model ') || low.startsWith('/model\n')) return handleModel(t.slice(6).trim());
  if (low === '/help' || low === '/start') {
    reply('🤖 دستورها: idea (name/repo/idea) | fix: ... | feature: ... | /report | /finish | /exit | /models | /model <شماره>');
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
      clone: g(/clone:\s*(\S+)/i),
      idea: g(/idea:\s*([\s\S]+)/i),
    });
  }
  reply('🤷 دستور شناخته نشد. برای راهنما /help بزن.');
  return { unknown: true };
}

module.exports = { runCommand, runCodeTask, runReview };
