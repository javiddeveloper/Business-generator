// Mission Control frontend — vanilla JS, polls the server and renders live state.
const $ = (id) => document.getElementById(id);
const api = (p, opts) => fetch(p, opts).then((r) => r.json());

let currentRepo = null;
let lastActivitySig = '';
let firstRunHandled = false;
let lastState = null;
let prFilter = 'open';
let activeMainTab = 'board';
let activeSettingsTab = 'tokens';

// ---------- helpers ----------
const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const faNum = (n) => String(n).replace(/\d/g, (d) => FA_DIGITS[d]);

function timeAgo(ts) {
  const s = Math.floor((Date.now() - (typeof ts === 'string' ? new Date(ts).getTime() : ts)) / 1000);
  if (s < 60) return faNum(s) + ' ثانیه';
  if (s < 3600) return faNum(Math.floor(s / 60)) + ' دقیقه';
  if (s < 86400) return faNum(Math.floor(s / 3600)) + ' ساعت';
  return faNum(Math.floor(s / 86400)) + ' روز';
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const ROLE_LABEL = { user: 'تو', agent: 'سیستم', system: 'سیستم' };

// ---------- main tabs ----------
function switchMainTab(tab) {
  activeMainTab = tab;
  [...document.querySelectorAll('.mtab')].forEach((b) => b.classList.toggle('active', b.dataset.mtab === tab));
  $('view-board').style.display = tab === 'board' ? 'flex' : 'none';
  $('view-prs').style.display = tab === 'prs' ? 'flex' : 'none';
  if (tab === 'prs') refreshPRs();
}

$('mainTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.mtab');
  if (!btn || !btn.dataset.mtab) return;
  switchMainTab(btn.dataset.mtab);
});

// ---------- state / board ----------
async function refreshState() {
  let s;
  try {
    s = await api('/api/state');
  } catch (e) {
    setHealth('bad', 'سرور خاموش است');
    return;
  }

  if (!firstRunHandled && s.system && s.system.configured === false) {
    firstRunHandled = true;
    openSettings(true);
  }

  const chip = $('projectChip');
  chip.innerHTML = '';
  if (s.project && s.project.repo) {
    currentRepo = s.project.repo;
    chip.appendChild(el('span', null, '🗂️ ' + (s.project.project || s.project.repo)));
    const a = el('a', null, s.project.repo);
    a.href = 'https://github.com/' + s.project.repo;
    a.target = '_blank';
    chip.appendChild(a);
  } else {
    currentRepo = null;
    chip.appendChild(el('span', 'muted', 'پروژه‌ی فعالی نیست'));
  }

  $('statTasks').textContent = faNum(s.totals.tasks);
  $('statBugs').textContent = faNum(s.totals.bugs);
  $('statFixes').textContent = faNum(s.totals.fixes);

  const b = s.system.bridge;
  if (!b.online) setHealth('bad', 'پل خاموش است');
  else if (!b.ready) setHealth('warn', 'پل: ' + (b.detail || 'آماده نیست'));
  else setHealth('ok', 'پل آماده است');

  renderBoard(s.columns);
  lastState = s;
}

function setHealth(cls, label) {
  $('bridgeDot').className = 'dot ' + cls;
  $('bridgeLabel').textContent = label;
}

// ---------- model picker ----------
async function refreshModels() {
  const sel = $('modelSelect');
  let data;
  try {
    data = await api('/api/models');
  } catch (e) {
    return;
  }
  if (!data.models || !data.models.length) {
    sel.innerHTML = '<option>—</option>';
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  // only rebuild if the option set changed, to avoid clobbering an open dropdown
  const sig = data.models.map((m) => m.id).join(',');
  if (sel.dataset.sig !== sig) {
    sel.innerHTML = '';
    for (const m of data.models) {
      const o = el('option', null, m.label);
      o.value = m.id;
      sel.appendChild(o);
    }
    sel.dataset.sig = sig;
  }
  sel.value = data.active;
}

$('modelSelect').addEventListener('change', async (e) => {
  const id = e.target.value;
  try {
    await api('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  } catch (err) {}
  refreshState();
});

function renderBoard(columns) {
  const board = $('board');
  board.innerHTML = '';
  let total = 0;
  for (const col of columns) {
    total += col.cards.length;
    const c = el('div', 'column');
    const head = el('div', 'col-head');
    head.appendChild(el('span', null, col.emoji + '  ' + col.name));
    head.appendChild(el('span', 'count', faNum(col.cards.length)));
    c.appendChild(head);

    const cards = el('div', 'cards');
    if (!col.cards.length) cards.appendChild(el('div', 'empty', '—'));
    for (const card of col.cards) {
      const cd = el('div', 'card clickable');
      cd.addEventListener('click', () => openCardDetail(card.id, card.name));
      const title = el('div', 'card-title', card.name.replace(/^\[[^\]]*\]\[[^\]]*\](\[[^\]]*\])?\s*/, ''));
      title.setAttribute('dir', 'auto');
      cd.appendChild(title);
      const meta = el('div', 'card-meta');
      meta.appendChild(el('span', 'tag ' + card.track, card.track));
      if (card.complexity) meta.appendChild(el('span', 'tag cx', card.complexity));
      if (card.bugs) meta.appendChild(el('span', 'counter bug', '🔴 ' + faNum(card.bugs)));
      if (card.fixes) meta.appendChild(el('span', 'counter fix', '🛠️ ' + faNum(card.fixes)));
      cd.appendChild(meta);
      cards.appendChild(cd);
    }
    c.appendChild(cards);
    board.appendChild(c);
  }
  $('boardCount').textContent = faNum(total);
}

// ---------- PRs ----------
async function refreshPRs() {
  const list = $('prList');
  if (!currentRepo) {
    list.innerHTML = '';
    list.appendChild(el('div', 'empty', 'پروژه‌ی فعالی نیست.'));
    $('prCount').textContent = faNum(0);
    return;
  }
  const stateParam = prFilter === 'failure' ? 'all' : prFilter;
  let prs = [];
  try {
    prs = await api('/api/prs?repo=' + encodeURIComponent(currentRepo) + '&state=' + stateParam);
  } catch (e) {}
  if (prFilter === 'failure') prs = prs.filter((p) => p.ci && p.ci.state === 'failure');
  $('prCount').textContent = faNum(prs.length);
  list.innerHTML = '';
  if (!prs.length) {
    list.appendChild(el('div', 'empty', 'پول‌ریکوئستی نیست.'));
    return;
  }
  const CI_FA = { success: 'سبز', failure: 'قرمز', running: 'در حال اجرا', none: 'بدون CI', unknown: 'نامشخص' };
  for (const pr of prs) {
    const row = el('div', 'pr clickable');
    row.addEventListener('click', () => openPRDetail(currentRepo, pr.number, pr.title));
    row.appendChild(el('span', 'num', '#' + faNum(pr.number)));
    const a = el('span', 'pr-title', pr.title);
    a.setAttribute('dir', 'auto');
    row.appendChild(a);
    const stCls = pr.merged ? 'merged' : pr.state === 'open' ? 'open' : 'closed';
    const stTxt = pr.merged ? 'merged' : pr.state === 'open' ? 'باز' : 'بسته';
    row.appendChild(el('span', 'state ' + stCls, stTxt));
    row.appendChild(el('span', 'ci ' + pr.ci.state, CI_FA[pr.ci.state] || pr.ci.state));
    list.appendChild(row);
  }
}

// ---------- detail modal ----------
const detailOverlay = $('detailOverlay');

function closeDetail() {
  detailOverlay.hidden = true;
  $('detailBody').innerHTML = '';
}

function openDetailModal(title, meta) {
  $('detailTitle').textContent = title;
  $('detailMeta').textContent = meta || '';
  $('detailBody').innerHTML = '<div class="empty">در حال بارگذاری…</div>';
  detailOverlay.hidden = false;
}

async function openCardDetail(cardId, cardName) {
  openDetailModal(cardName.replace(/^\[[^\]]*\]\[[^\]]*\](\[[^\]]*\])?\s*/, ''), 'تسک ترلو');
  let data;
  try {
    data = await api('/api/card-detail?id=' + encodeURIComponent(cardId));
  } catch (e) {
    $('detailBody').innerHTML = '<div class="empty">خطا در بارگذاری</div>';
    return;
  }
  const body = $('detailBody');
  body.innerHTML = '';

  if (data.url) {
    const link = el('a', 'detail-link', '🔗 مشاهده در ترلو');
    link.href = data.url;
    link.target = '_blank';
    body.appendChild(link);
  }

  if (data.labels && data.labels.length) {
    const row = el('div', 'detail-row');
    row.appendChild(el('span', 'detail-key', 'برچسب‌ها'));
    const tags = el('div', 'detail-tags');
    data.labels.forEach((l) => tags.appendChild(el('span', 'tag cx', l)));
    row.appendChild(tags);
    body.appendChild(row);
  }

  if (data.desc && data.desc.trim()) {
    body.appendChild(el('div', 'detail-section-title', 'توضیحات'));
    const desc = el('div', 'detail-text');
    desc.textContent = data.desc;
    desc.setAttribute('dir', 'auto');
    body.appendChild(desc);
  }

  if (data.comments && data.comments.length) {
    body.appendChild(el('div', 'detail-section-title', 'نظرات (' + faNum(data.comments.length) + ')'));
    for (const c of data.comments) {
      const cm = el('div', 'detail-comment');
      const who = el('div', 'detail-comment-who', (c.author || 'ناشناس') + ' · ' + (c.ts ? timeAgo(c.ts) + ' پیش' : ''));
      const txt = el('div', 'detail-comment-text', c.text || '');
      txt.setAttribute('dir', 'auto');
      cm.appendChild(who);
      cm.appendChild(txt);
      body.appendChild(cm);
    }
  }

  if (!data.desc && (!data.comments || !data.comments.length)) {
    body.appendChild(el('div', 'empty', 'محتوایی ثبت نشده.'));
  }
}

async function openPRDetail(repo, number, title) {
  openDetailModal('#' + number + ' · ' + title, 'پول‌ریکوئست گیت‌هاب');
  let data;
  try {
    data = await api('/api/pr-detail?repo=' + encodeURIComponent(repo) + '&number=' + number);
  } catch (e) {
    $('detailBody').innerHTML = '<div class="empty">خطا در بارگذاری</div>';
    return;
  }
  const body = $('detailBody');
  body.innerHTML = '';

  // header row
  const hrow = el('div', 'detail-header-row');
  const stCls = data.merged ? 'merged' : data.state === 'open' ? 'open' : 'closed';
  const stTxt = data.merged ? 'merged' : data.state === 'open' ? 'باز' : 'بسته';
  hrow.appendChild(el('span', 'state ' + stCls, stTxt));
  hrow.appendChild(el('span', 'detail-branch', data.head + ' → ' + data.base));
  if (data.author) hrow.appendChild(el('span', 'detail-author', '👤 ' + data.author));
  if (data.created_at) hrow.appendChild(el('span', 'detail-age', timeAgo(data.created_at) + ' پیش'));
  const link = el('a', 'detail-link', '🔗 GitHub');
  link.href = data.url;
  link.target = '_blank';
  hrow.appendChild(link);
  body.appendChild(hrow);

  if (data.body && data.body.trim()) {
    body.appendChild(el('div', 'detail-section-title', 'توضیحات'));
    const desc = el('div', 'detail-text');
    desc.textContent = data.body;
    desc.setAttribute('dir', 'auto');
    body.appendChild(desc);
  }

  if (data.files && data.files.length) {
    body.appendChild(el('div', 'detail-section-title', 'فایل‌های تغییریافته (' + faNum(data.files.length) + ')'));
    const ftable = el('div', 'detail-files');
    for (const f of data.files) {
      const fr = el('div', 'detail-file-row');
      fr.appendChild(el('span', 'detail-filename', f.filename));
      fr.appendChild(el('span', 'detail-add', '+' + f.additions));
      fr.appendChild(el('span', 'detail-del', '-' + f.deletions));
      ftable.appendChild(fr);
    }
    body.appendChild(ftable);
  }

  if (data.reviews && data.reviews.length) {
    body.appendChild(el('div', 'detail-section-title', 'ریویوها (' + faNum(data.reviews.length) + ')'));
    for (const r of data.reviews) {
      const rv = el('div', 'detail-comment');
      const REVIEW_STATE = { APPROVED: '✅ تأیید', CHANGES_REQUESTED: '🔴 درخواست تغییر', COMMENTED: '💬 نظر', DISMISSED: '⛔ رد' };
      const who = el('div', 'detail-comment-who', (r.author || '') + ' · ' + (REVIEW_STATE[r.state] || r.state));
      rv.appendChild(who);
      if (r.body && r.body.trim()) {
        const txt = el('div', 'detail-comment-text', r.body);
        txt.setAttribute('dir', 'auto');
        rv.appendChild(txt);
      }
      body.appendChild(rv);
    }
  }

  if (data.comments && data.comments.length) {
    body.appendChild(el('div', 'detail-section-title', 'نظرات (' + faNum(data.comments.length) + ')'));
    for (const c of data.comments) {
      const cm = el('div', 'detail-comment');
      const who = el('div', 'detail-comment-who', (c.author || 'ناشناس') + ' · ' + (c.ts ? timeAgo(c.ts) + ' پیش' : ''));
      const txt = el('div', 'detail-comment-text', c.body || '');
      txt.setAttribute('dir', 'auto');
      cm.appendChild(who);
      cm.appendChild(txt);
      body.appendChild(cm);
    }
  }
}

$('detailClose').addEventListener('click', closeDetail);
detailOverlay.addEventListener('click', (e) => { if (e.target === detailOverlay) closeDetail(); });

// ---------- activity / chat ----------
async function refreshActivity() {
  let events = [];
  try {
    events = await api('/api/activity');
  } catch (e) {
    return;
  }
  const sig = events.map((e) => e.id).join(',');
  if (sig === lastActivitySig) return;
  lastActivitySig = sig;

  const tl = $('timeline');
  const atBottom = tl.scrollHeight - tl.scrollTop - tl.clientHeight < 60;
  tl.innerHTML = '';
  if (!events.length) {
    tl.appendChild(el('div', 'empty', 'در انتظار فعالیت…'));
    return;
  }
  for (const ev of events) {
    const m = el('div', 'msg ' + (ev.role || 'agent'));
    const who = el('div', 'who');
    who.appendChild(el('span', null, ROLE_LABEL[ev.role] || 'سیستم'));
    who.appendChild(el('span', null, '· ' + timeAgo(ev.ts) + ' پیش'));
    m.appendChild(who);

    const bubble = el('div', 'bubble');
    bubble.setAttribute('dir', 'auto');
    if (ev.card) bubble.appendChild(el('span', 'card-ref', '↳ ' + ev.card + (ev.column ? ' · ' + ev.column : '')));
    bubble.appendChild(document.createTextNode(ev.text));
    m.appendChild(bubble);
    tl.appendChild(m);
  }
  if (atBottom) tl.scrollTop = tl.scrollHeight;
}

// ---------- composer ----------
const composer = $('composer');
const sendBtn = $('sendBtn');

function autoGrow() {
  composer.style.height = 'auto';
  composer.style.height = Math.min(composer.scrollHeight, 140) + 'px';
}
composer.addEventListener('input', autoGrow);
composer.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

$('quick').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const tpl = btn.dataset.tpl;
  if (tpl === 'idea') composer.value = 'name: \nrepo: https://github.com/' + (currentRepo || 'USER/REPO') + '\nidea: ';
  else composer.value = tpl + ' ';
  autoGrow();
  composer.focus();
});

async function send() {
  const text = composer.value.trim();
  if (!text) return;
  sendBtn.disabled = true;
  composer.value = '';
  autoGrow();
  try {
    await api('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch (e) {}
  sendBtn.disabled = false;
  lastActivitySig = '';
  await Promise.all([refreshActivity(), refreshState()]);
}
sendBtn.addEventListener('click', send);

// ---------- settings ----------
const overlay = $('settingsOverlay');

function switchSettingsTab(tab) {
  activeSettingsTab = tab;
  [...document.querySelectorAll('.stab')].forEach((b) => b.classList.toggle('active', b.dataset.stab === tab));
  $('settingsForm').style.display = tab === 'tokens' ? 'flex' : 'none';
  $('settingsStacks').style.display = tab === 'stacks' ? 'flex' : 'none';
  $('settingsRoles').style.display = tab === 'roles' ? 'flex' : 'none';
  const subMap = {
    tokens: 'کلیدها و توکن‌ها را اینجا ویرایش کن. در <code>secrets.env</code> ذخیره می‌شوند.',
    stacks: 'تخصص‌های هر دامنه را ویرایش کن. در پوشه <code>stacks/</code> ذخیره می‌شوند.',
    roles: 'وظایف و دستورالعمل‌های هر نقش را ویرایش کن. در پوشه <code>roles/</code> ذخیره می‌شوند.',
  };
  $('settingsSub').innerHTML = subMap[tab];
}

async function loadStacksPanel() {
  let data;
  try { data = await api('/api/stacks'); } catch { return; }
  const panel = $('settingsStacks');
  panel.innerHTML = '';
  const LABELS = { 'backend.md': '⚙️ بکند', 'frontend.md': '🖥️ فرانت‌اند', 'mobile.md': '📱 موبایل' };
  for (const f of data.files) {
    panel.appendChild(el('div', 'group-title', LABELS[f] || f));
    const ta = document.createElement('textarea');
    ta.className = 'md-editor';
    ta.dataset.file = f;
    ta.value = data.values[f] || '';
    panel.appendChild(ta);
  }
}

async function loadRolesPanel() {
  let data;
  try { data = await api('/api/roles'); } catch { return; }
  const panel = $('settingsRoles');
  panel.innerHTML = '';
  const LABELS = { 'developer.md': '👨‍💻 توسعه‌دهنده', 'tech-lead.md': '🏗️ تک‌لید', 'product-owner.md': '🎯 مالک محصول' };
  for (const f of data.files) {
    panel.appendChild(el('div', 'group-title', LABELS[f] || f));
    const ta = document.createElement('textarea');
    ta.className = 'md-editor';
    ta.dataset.file = f;
    ta.value = data.values[f] || '';
    panel.appendChild(ta);
  }
}

async function openSettings(firstRun) {
  let data;
  try {
    data = await api('/api/settings');
  } catch (e) {
    return;
  }
  $('settingsTitle').textContent = firstRun ? 'به مرکز فرماندهی خوش آمدی 👋' : 'تنظیمات';

  const form = $('settingsForm');
  form.innerHTML = '';
  let lastGroup = '';
  for (const f of data.fields) {
    if (f.group !== lastGroup) {
      form.appendChild(el('div', 'group-title', f.group));
      lastGroup = f.group;
    }
    const field = el('div', 'field');
    const label = el('label');
    label.appendChild(el('span', null, f.label));
    if (f.required) label.appendChild(el('span', 'req', '*'));
    if (f.hint) label.appendChild(el('span', 'hint', '· ' + f.hint));
    field.appendChild(label);

    const wrap = el('div', 'field-input');
    const input = el('input');
    input.type = f.secret ? 'password' : 'text';
    input.value = data.values[f.key] || '';
    input.dataset.key = f.key;
    input.dataset.required = f.required ? '1' : '';
    wrap.appendChild(input);
    if (f.secret) {
      const rev = el('button', 'reveal', '👁');
      rev.type = 'button';
      rev.addEventListener('click', () => {
        input.type = input.type === 'password' ? 'text' : 'password';
      });
      wrap.appendChild(rev);
    }
    field.appendChild(wrap);
    form.appendChild(field);
  }

  await Promise.all([loadStacksPanel(), loadRolesPanel()]);
  switchSettingsTab(firstRun ? 'tokens' : activeSettingsTab);
  $('saveState').textContent = '';
  $('saveState').className = 'save-state';
  overlay.hidden = false;
}

function closeSettings() {
  overlay.hidden = true;
}

async function saveSettings() {
  const st = $('saveState');
  st.textContent = 'در حال ذخیره…';
  st.className = 'save-state';
  try {
    if (activeSettingsTab === 'tokens') {
      const inputs = [...$('settingsForm').querySelectorAll('input')];
      const values = {};
      let missing = 0;
      for (const i of inputs) {
        values[i.dataset.key] = i.value.trim();
        if (i.dataset.required && !i.value.trim()) { i.classList.add('missing'); missing++; }
        else i.classList.remove('missing');
      }
      if (missing) {
        st.textContent = 'لطفاً فیلدهای ستاره‌دار را پر کن (' + faNum(missing) + ' مانده).';
        st.className = 'save-state err';
        return;
      }
      const res = await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });
      if (!res.ok) { st.textContent = 'خطا در ذخیره'; st.className = 'save-state err'; return; }
      await refreshState();
    } else {
      const panelId = activeSettingsTab === 'stacks' ? 'settingsStacks' : 'settingsRoles';
      const endpoint = '/api/' + activeSettingsTab;
      const editors = [...$(panelId).querySelectorAll('textarea.md-editor')];
      const values = {};
      for (const ta of editors) values[ta.dataset.file] = ta.value;
      const res = await api(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });
      if (!res.ok) { st.textContent = 'خطا در ذخیره'; st.className = 'save-state err'; return; }
    }
    st.textContent = '✅ ذخیره شد';
    st.className = 'save-state ok';
    setTimeout(closeSettings, 700);
  } catch (e) {
    st.textContent = 'خطا: ' + e.message;
    st.className = 'save-state err';
  }
}

$('gearBtn').addEventListener('click', () => openSettings(false));
$('settingsClose').addEventListener('click', closeSettings);
$('saveBtn').addEventListener('click', saveSettings);
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeSettings();
});

$('settingsTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.stab');
  if (!btn) return;
  switchSettingsTab(btn.dataset.stab);
});

// ---------- PR filters ----------
$('prFilters').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  prFilter = btn.dataset.f;
  [...$('prFilters').querySelectorAll('button')].forEach((b) => b.classList.toggle('active', b.dataset.f === prFilter));
  refreshPRs();
});

// ---------- loops ----------
refreshState();
refreshActivity();
refreshModels();
setInterval(refreshState, 5_000);
setInterval(refreshActivity, 5_000);
setInterval(refreshModels, 10_000);
