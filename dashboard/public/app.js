// Mission Control frontend — vanilla JS, polls the server and renders live state.
const $ = (id) => document.getElementById(id);
const api = (p, opts) => fetch(p, opts).then((r) => r.json());

let currentRepo = null;
let lastActivitySig = null;
let firstRunHandled = false;
let lastState = null;
let prFilter = 'open';
let activeMainTab = 'board';
let activeSettingsTab = 'tokens';

// ---------- project / session state ----------
let activeProjectId = null;
let activeSessionId = null;
let currentProjects = [];
let currentSessions = [];
let busy = false; // a command is running in the active session → lock switching
const msgCache = new Map(); // sessionId → messages (instant switch without refetch)
const LS = {
  proj: 'mc_projectId',
  sess: (pid) => 'mc_session_' + pid,
  board: (pid) => 'mc_board_' + pid,
  projects: 'mc_projects',
};

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

// ---------- projects & sessions ----------
const normRepo = (u) =>
  String(u || '').trim().replace(/\.git$/, '').replace(/^https?:\/\/github\.com\//i, '').replace(/^github\.com\//i, '');

// Disable project/session switching and turn the send button into STOP while a
// command is running, so the user can't switch context mid-flight.
function lockUI(on) {
  busy = on;
  $('projectSelect').disabled = on;
  $('newProjectBtn').disabled = on;
  $('sessionSelect').disabled = on;
  $('newSessionBtn').disabled = on;
  $('sendBtn').style.display = on ? 'none' : '';
  $('stopBtn').style.display = on ? '' : 'none';
}

async function loadProjects() {
  try {
    currentProjects = await api('/api/projects');
    localStorage.setItem(LS.projects, JSON.stringify(currentProjects));
  } catch {
    currentProjects = JSON.parse(localStorage.getItem(LS.projects) || '[]');
  }
  if (!currentProjects.length) return;
  const stored = localStorage.getItem(LS.proj);
  activeProjectId = currentProjects.some((p) => p.id === stored) ? stored : currentProjects[0].id;
  localStorage.setItem(LS.proj, activeProjectId);
  renderProjects();
}

function renderProjects() {
  const sel = $('projectSelect');
  sel.innerHTML = '';
  for (const p of currentProjects) {
    const o = el('option', null, p.name);
    o.value = p.id;
    sel.appendChild(o);
  }
  if (activeProjectId) sel.value = activeProjectId;
}

async function loadSessions() {
  let sessions = [];
  try {
    sessions = await api('/api/projects/' + activeProjectId + '/sessions');
  } catch {}
  if (!sessions.length) {
    try {
      const s = await api('/api/projects/' + activeProjectId + '/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'چت اصلی' }),
      });
      sessions = [s];
    } catch {}
  }
  currentSessions = sessions;
  const key = LS.sess(activeProjectId);
  const stored = localStorage.getItem(key);
  activeSessionId = sessions.some((s) => s.id === stored) ? stored : (sessions[sessions.length - 1] || {}).id || null;
  if (activeSessionId) localStorage.setItem(key, activeSessionId);
  renderSessions();
}

function renderSessions() {
  const sel = $('sessionSelect');
  sel.innerHTML = '';
  for (const s of currentSessions) {
    const o = el('option', null, s.title);
    o.value = s.id;
    sel.appendChild(o);
  }
  if (activeSessionId) sel.value = activeSessionId;
}

// paint the active session from cache (or clear) so a switch shows no stale chat
function paintCachedSession() {
  const m = msgCache.get(activeSessionId);
  if (m) renderMessages(m);
  else $('timeline').innerHTML = '';
}

async function selectProject(pid) {
  if (busy || pid === activeProjectId) return;
  activeProjectId = pid;
  localStorage.setItem(LS.proj, pid);
  renderProjects();
  await loadSessions();
  paintCachedBoard();
  paintCachedSession();
  lastActivitySig = null; // force a re-render even if the new session is empty
  await Promise.all([refreshActivity(), refreshState()]);
  if (activeMainTab === 'repo') refreshRepo();
}

async function selectSession(sid) {
  if (busy || sid === activeSessionId) return;
  activeSessionId = sid;
  localStorage.setItem(LS.sess(activeProjectId), sid);
  $('sessionSelect').value = sid; // keep the dropdown in sync when called programmatically
  paintCachedSession();
  lastActivitySig = null;
  await refreshActivity();
}

// paint the last cached board for the active project instantly (before live fetch)
function paintCachedBoard() {
  try {
    const snap = JSON.parse(localStorage.getItem(LS.board(activeProjectId)) || 'null');
    if (snap && snap.columns) renderBoard(snap.columns);
    else $('board').innerHTML = '';
  } catch {}
}

// ----- projects modal (create / rename / delete) -----
const projectsOverlay = $('projectsOverlay');
function openProjects() {
  if (busy) return;
  $('newProjName').value = '';
  $('newProjRepoRemote').value = '';
  $('newProjRepoLocal').value = '';
  renderProjectsList();
  projectsOverlay.hidden = false;
  $('newProjName').focus();
}
function closeProjects() { projectsOverlay.hidden = true; }

function renderProjectsList() {
  const box = $('projectsList');
  box.innerHTML = '';
  for (const p of currentProjects) {
    const row = el('div', 'manage-row' + (p.id === activeProjectId ? ' active' : ''));
    const main = el('button', 'manage-name');
    main.appendChild(el('span', null, p.name));
    if (p.repo) main.appendChild(el('span', 'manage-sub', p.repo));
    main.addEventListener('click', () => { closeProjects(); selectProject(p.id); });
    row.appendChild(main);

    const acts = el('div', 'manage-actions');
    const ren = el('button', 'mini-btn', '✏️');
    ren.title = 'تغییر نام';
    ren.addEventListener('click', () => inlineRename(main, p.name, async (val) => {
      await api('/api/projects/' + p.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: val }) });
      await loadProjects(); renderProjectsList();
    }));
    acts.appendChild(ren);
    const del = el('button', 'mini-btn danger', '🗑');
    del.title = 'حذف';
    del.disabled = currentProjects.length <= 1;
    del.addEventListener('click', () => deleteProject(p.id));
    acts.appendChild(del);
    row.appendChild(acts);
    box.appendChild(row);
  }
}

async function createProjectFromModal() {
  const name = $('newProjName').value.trim();
  if (!name) { $('newProjName').focus(); return; }
  let repo = $('newProjRepoLocal').value.trim();
  if (!repo) repo = $('newProjRepoRemote').value.trim();
  try {
    const p = await api('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, repo }),
    });
    await loadProjects();
    closeProjects();
    activeProjectId = null; // bypass the equality guard so selectProject runs
    await selectProject(p.id);
  } catch (e) {}
}

async function deleteProject(pid) {
  if (currentProjects.length <= 1) return;
  if (!confirm('این پروژه و همه‌ی چت‌هایش حذف شود؟')) return;
  try {
    await api('/api/projects/' + pid, { method: 'DELETE' });
    await loadProjects();
    renderProjectsList();
    if (pid === activeProjectId) {
      activeProjectId = null;
      await selectProject(currentProjects[0].id);
    }
  } catch (e) {}
}

// ----- sessions (chats) modal -----
const sessionsOverlay = $('sessionsOverlay');
function openSessions() {
  if (busy) return;
  $('newSessTitle').value = '';
  renderSessionsList();
  sessionsOverlay.hidden = false;
  $('newSessTitle').focus();
}
function closeSessions() { sessionsOverlay.hidden = true; }

function renderSessionsList() {
  const box = $('sessionsList');
  box.innerHTML = '';
  for (const s of currentSessions) {
    const row = el('div', 'manage-row' + (s.id === activeSessionId ? ' active' : ''));
    const main = el('button', 'manage-name');
    main.appendChild(el('span', null, s.title));
    main.addEventListener('click', () => { closeSessions(); selectSession(s.id); });
    row.appendChild(main);

    const acts = el('div', 'manage-actions');
    const ren = el('button', 'mini-btn', '✏️');
    ren.title = 'تغییر نام';
    ren.addEventListener('click', () => inlineRename(main, s.title, async (val) => {
      await api('/api/sessions/' + s.id + '?projectId=' + encodeURIComponent(activeProjectId), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: val }),
      });
      await loadSessions(); renderSessionsList();
    }));
    acts.appendChild(ren);
    const del = el('button', 'mini-btn danger', '🗑');
    del.title = 'حذف';
    del.disabled = currentSessions.length <= 1;
    del.addEventListener('click', () => deleteSession(s.id));
    acts.appendChild(del);
    row.appendChild(acts);
    box.appendChild(row);
  }
}

async function createSessionFromModal() {
  const title = $('newSessTitle').value.trim();
  try {
    const s = await api('/api/projects/' + activeProjectId + '/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
    });
    await loadSessions();
    closeSessions();
    activeSessionId = null;
    await selectSession(s.id);
  } catch (e) {}
}

async function deleteSession(sid) {
  if (currentSessions.length <= 1) return;
  if (!confirm('این چت حذف شود؟')) return;
  try {
    await api('/api/sessions/' + sid + '?projectId=' + encodeURIComponent(activeProjectId), { method: 'DELETE' });
    msgCache.delete(sid);
    await loadSessions();
    renderSessionsList();
    if (sid === activeSessionId) { activeSessionId = null; await selectSession(currentSessions[currentSessions.length - 1].id); }
  } catch (e) {}
}

// shared: turn a name button into an inline edit field (no native prompt)
function inlineRename(nameEl, current, onSave) {
  const row = nameEl.parentElement;
  const input = el('input', 'rename-input');
  input.value = current;
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return; done = true;
    const val = input.value.trim();
    if (save && val && val !== current) await onSave(val);
    else if (row.isConnected) input.replaceWith(nameEl);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

$('projectSelect').addEventListener('change', (e) => selectProject(e.target.value));
$('sessionSelect').addEventListener('change', (e) => selectSession(e.target.value));
$('newProjectBtn').addEventListener('click', openProjects);
$('newSessionBtn').addEventListener('click', openSessions);
$('projectsClose').addEventListener('click', closeProjects);
$('sessionsClose').addEventListener('click', closeSessions);
$('newProjCreate').addEventListener('click', createProjectFromModal);
$('newSessCreate').addEventListener('click', createSessionFromModal);
$('newProjName').addEventListener('keydown', (e) => { if (e.key === 'Enter') createProjectFromModal(); });
$('newProjRepoRemote').addEventListener('keydown', (e) => { if (e.key === 'Enter') createProjectFromModal(); });
$('newProjRepoLocal').addEventListener('keydown', (e) => { if (e.key === 'Enter') createProjectFromModal(); });
$('newSessTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter') createSessionFromModal(); });
$('browseLocalBtn').addEventListener('click', async () => {
  $('browseLocalBtn').disabled = true;
  $('browseLocalBtn').textContent = '⏳ ...';
  try {
    const res = await api('/api/browse', { method: 'POST' });
    if (res && res.path) $('newProjRepoLocal').value = res.path;
  } catch (e) {}
  $('browseLocalBtn').disabled = false;
  $('browseLocalBtn').textContent = '📁 Browse';
});
projectsOverlay.addEventListener('click', (e) => { if (e.target === projectsOverlay) closeProjects(); });
sessionsOverlay.addEventListener('click', (e) => { if (e.target === sessionsOverlay) closeSessions(); });

// ---------- main tabs ----------
function switchMainTab(tab) {
  activeMainTab = tab;
  [...document.querySelectorAll('.mtab')].forEach((b) => b.classList.toggle('active', b.dataset.mtab === tab));
  $('view-board').style.display = tab === 'board' ? 'flex' : 'none';
  $('view-prs').style.display = tab === 'prs' ? 'flex' : 'none';
  $('view-repo').style.display = tab === 'repo' ? 'flex' : 'none';
  if (tab === 'prs') refreshPRs();
  if (tab === 'repo') refreshRepo();
}

// ---------- repo tab (branches + local clone) ----------
async function refreshRepo() {
  const box = $('repoView');
  if (!activeProjectId) { box.innerHTML = ''; box.appendChild(el('div', 'empty', 'پروژه‌ای انتخاب نشده.')); return; }
  box.innerHTML = '';
  box.appendChild(el('div', 'empty', 'در حال بارگذاری…'));
  let r;
  try {
    r = await api('/api/repo?projectId=' + encodeURIComponent(activeProjectId));
  } catch (e) {
    box.innerHTML = ''; box.appendChild(el('div', 'empty', 'خطا در دریافت اطلاعات ریپو.')); return;
  }
  renderRepo(r);
}

function renderRepo(r) {
  const box = $('repoView');
  box.innerHTML = '';
  if (!r || !r.ok) {
    box.appendChild(el('div', 'empty', (r && r.error) || 'ریپوی این پروژه مشخص نیست.'));
    $('branchCount').textContent = faNum(0);
    return;
  }

  const isLocal = r.isLocalPath;

  // ---- folder was deleted by the user after cloning ----
  if (r.folderMissing) {
    const warn = el('div', 'repo-folder-missing');
    warn.innerHTML = '<span class="repo-folder-missing-icon">⚠️</span>';
    const msg = el('div', 'repo-folder-missing-msg');
    msg.appendChild(el('strong', null, isLocal ? 'پوشهٔ محلی پیدا نشد' : 'پوشهٔ کلون پیدا نشد'));
    msg.appendChild(el('p', null, 'مسیر ' + r.dir + ' وجود ندارد.'));
    warn.appendChild(msg);

    const acts = el('div', 'repo-folder-missing-actions');

    if (!isLocal) {
      const reCloneBtn = el('button', 'send', '📥 کلون مجدد');
      reCloneBtn.addEventListener('click', async () => {
        reCloneBtn.disabled = true;
        reCloneBtn.textContent = 'در حال کلون…';
        let res;
        try {
          res = await api('/api/clone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: activeProjectId }) });
        } catch (e) { res = { ok: false, error: e.message }; }
        if (res && res.ok) renderRepo(res);
        else {
          reCloneBtn.disabled = false;
          reCloneBtn.textContent = '📥 کلون مجدد';
          const err = el('div', 'repo-err', '⚠️ ' + ((res && res.error) || 'کلون ناموفق بود'));
          box.appendChild(err);
        }
      });
      acts.appendChild(reCloneBtn);
    }

    const delBtn = el('button', 'mini-btn danger', '🗑 حذف پروژه');
    delBtn.addEventListener('click', async () => {
      if (!confirm('پروژه از لیست حذف شود؟')) return;
      await deleteProject(activeProjectId);
    });
    acts.appendChild(delBtn);
    warn.appendChild(acts);
    box.appendChild(warn);
    $('branchCount').textContent = faNum(0);
    return;
  }

  // header: repo slug + clone status + clone/update button
  const head = el('div', 'repo-head');
  const info = el('div', 'repo-info');
  
  if (isLocal) {
    const title = el('span', 'repo-title', r.repo);
    info.appendChild(title);
    const st = el('span', 'repo-status ok', '✓ پروژه محلی');
    info.appendChild(st);
  } else {
    const title = el('a', 'repo-title', r.repo);
    title.href = 'https://github.com/' + r.repo;
    title.target = '_blank';
    info.appendChild(title);
    const st = el('span', 'repo-status ' + (r.cloned ? 'ok' : 'warn'), r.cloned ? '✓ کلون‌شده روی این سیستم' : '⬇️ هنوز کلون نشده');
    info.appendChild(st);
  }
  
  if (r.dir) info.appendChild(el('span', 'repo-dir', r.dir));
  head.appendChild(info);

  if (!isLocal) {
    const cloneBtn = el('button', 'send', r.cloned ? '🔄 به‌روزرسانی' : '📥 کلون');
    cloneBtn.addEventListener('click', async () => {
      cloneBtn.disabled = true;
      cloneBtn.textContent = r.cloned ? 'در حال به‌روزرسانی…' : 'در حال کلون…';
      let res;
      try {
        res = await api('/api/clone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: activeProjectId }) });
      } catch (e) { res = { ok: false, error: e.message }; }
      if (res && res.ok) renderRepo(res);
      else {
        cloneBtn.disabled = false;
        cloneBtn.textContent = r.cloned ? '🔄 به‌روزرسانی' : '📥 کلون';
        const err = el('div', 'repo-err', '⚠️ ' + ((res && res.error) || 'کلون ناموفق بود'));
        box.appendChild(err);
      }
    });
    head.appendChild(cloneBtn);
  }
  
  box.appendChild(head);

  // branches
  const branches = r.branches || [];
  $('branchCount').textContent = faNum(branches.length);
  if (r.branchesError) box.appendChild(el('div', 'repo-err', '⚠️ ' + r.branchesError));
  const bhead = el('div', 'repo-section-title', '🌿 شاخه‌ها (' + faNum(branches.length) + ')');
  box.appendChild(bhead);
  if (!branches.length) {
    box.appendChild(el('div', 'empty', 'شاخه‌ای پیدا نشد.'));
    return;
  }
  const list = el('div', 'branch-list');
  for (const b of branches) {
    const row = el('div', 'branch-row');
    const isCur = b === r.current;
    const isDef = b === r.defaultBranch;
    row.appendChild(el('span', 'branch-name' + (isCur ? ' current' : ''), b));
    if (isCur) row.appendChild(el('span', 'branch-tag cur', 'فعلی'));
    if (isDef) row.appendChild(el('span', 'branch-tag def', 'پیش‌فرض'));
    list.appendChild(row);
  }
  box.appendChild(list);
}

$('mainTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.mtab');
  if (!btn || !btn.dataset.mtab) return;
  switchMainTab(btn.dataset.mtab);
});

// ---------- state / board ----------
async function refreshState() {
  if (!activeProjectId) return;
  let s;
  try {
    s = await api('/api/state?projectId=' + encodeURIComponent(activeProjectId));
  } catch (e) {
    setHealth('bad', 'سرور خاموش است');
    return;
  }

  if (!firstRunHandled && s.system && s.system.configured === false) {
    firstRunHandled = true;
    openSettings(true);
  }

  // project repo link (the chip itself holds the switcher, so only touch the link)
  const link = $('projectRepoLink');
  currentRepo = normRepo((s.project && s.project.repo) || '') || null;
  const isLocal = currentRepo && /^([a-zA-Z]:[/\\]|\\\\|\/|~)/.test(currentRepo);
  
  if (currentRepo) {
    if (isLocal) {
      link.textContent = 'مسیر محلی';
      link.href = '#';
      link.onclick = (e) => { e.preventDefault(); switchMainTab('repo'); };
    } else {
      link.textContent = currentRepo;
      link.href = 'https://github.com/' + currentRepo;
      link.onclick = null;
    }
    link.hidden = false;
  } else {
    link.hidden = true;
  }

  $('statTasks').textContent = faNum(s.totals.tasks);
  $('statBugs').textContent = faNum(s.totals.bugs);
  $('statFixes').textContent = faNum(s.totals.fixes);

  const b = s.system.bridge;
  if (!b.online) setHealth('bad', 'پل خاموش است');
  else if (!b.ready) setHealth('warn', 'پل: ' + (b.detail || 'آماده نیست'));
  else setHealth('ok', 'پل آماده است');

  // keep the UI locked if the active session has a command running (survives reload)
  const sessionBusy = Array.isArray(s.running) && s.running.indexOf(activeSessionId) >= 0;
  if (sessionBusy && !busy) lockUI(true);
  else if (!sessionBusy && busy) lockUI(false);

  renderBoard(s.columns);
  // cache the board snapshot for an instant paint on the next project switch
  try { localStorage.setItem(LS.board(activeProjectId), JSON.stringify({ columns: s.columns, totals: s.totals })); } catch {}
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
      cd.addEventListener('click', () => openCardDetail(card.id, card.name, col.key));
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

async function openCardDetail(cardId, cardName, colKey) {
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

  // Column-aware action: Developer run (To Do/In Progress) or Tech Lead review
  // (In Review). Waiting/Done show a status note instead of a button.
  if (data.desc && /repo:\s*\S+/.test(data.desc)) {
    renderCardAction(body, cardId, colKey);
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

function renderCardAction(body, cardId, colKey) {
  const wrap = el('div', 'detail-run');

  if (colKey === 'owner') {
    wrap.appendChild(el('div', 'run-task-msg ok', '✅ این تسک تأیید و merge شده است.'));
    body.appendChild(wrap);
    return;
  }
  if (colKey === 'wait') {
    wrap.appendChild(el('div', 'run-task-msg', '⏳ منتظر آماده‌شدن API بک‌اند است. ابتدا تسک‌های backend را اجرا کن.'));
    body.appendChild(wrap);
    return;
  }

  const isReview = colKey === 'review';
  const cfg = isReview
    ? { endpoint: '/api/review', label: '🏗️ ریویوی Tech Lead (merge یا برگشت برای اصلاح)',
        confirm: 'Tech Lead این PR را بررسی می‌کند: اگر CI سبز و کد سالم بود merge، وگرنه برای اصلاح به «در صف» برمی‌گردد. ادامه؟' }
    : { endpoint: '/api/code-task', label: '▶ اجرای این تسک با agent (کلون + کد + PR)',
        confirm: 'agent این تسک را کلون می‌کند، کد می‌نویسد و یک PR به develop می‌سازد. ادامه؟' };

  const btn = el('button', 'run-task-btn', cfg.label);
  const msg = el('div', 'run-task-msg');
  btn.addEventListener('click', async () => {
    if (!confirm(cfg.confirm)) return;
    btn.disabled = true;
    btn.textContent = '⏳ در حال اجرا…';
    msg.textContent = '';
    msg.className = 'run-task-msg';
    let res;
    try {
      res = await api(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cardId }),
      });
    } catch (e) {
      res = { ok: false, error: e.message };
    }
    const r = (res && res.result) || {};
    if (res && res.ok) {
      msg.className = 'run-task-msg ok';
      let done = true;
      if (cfg.endpoint === '/api/code-task') {
        msg.innerHTML = '✅ PR #' + faNum(r.pr) + ' ساخته شد (' + faNum(r.files || 0) + ' فایل). ';
        const a = el('a', 'detail-link', '🔗 مشاهده PR');
        a.href = r.url; a.target = '_blank';
        msg.appendChild(a);
      } else {
        const REV = {
          merged: '✅ تأیید و merge شد در develop. کارت به «تمام‌شده» رفت.',
          approved: '✅ تأیید شد ولی merge خودکار نشد — دستی merge کن.',
          changes: '🔧 نیاز به اصلاح. کارت به «در صف» برگشت (دفعهٔ بعد در حالت fix).',
          ciFail: '❌ CI رد شد. PR بسته و کارت برای فیکس به «در صف» برگشت.',
          conflict: '⚠️ کانفلیکت با develop. PR بسته و کارت برگشت.',
          waitCI: '⏳ CI هنوز در حال اجراست؛ کمی بعد دوباره بزن.',
        };
        msg.textContent = REV[r.status] || '✅ انجام شد.';
        if (r.status === 'changes' || r.status === 'ciFail' || r.status === 'conflict') msg.className = 'run-task-msg err';
        if (r.status === 'waitCI') { msg.className = 'run-task-msg'; done = false; }
      }
      if (done) btn.textContent = '✅ انجام شد';
      else { btn.disabled = false; btn.textContent = cfg.label; }
      lastActivitySig = null;
      refreshActivity(); refreshState();
      if (activeMainTab === 'prs') refreshPRs();
    } else {
      msg.className = 'run-task-msg err';
      msg.textContent = '⚠️ ' + ((r && r.error) || (res && res.error) || 'اجرا ناموفق بود');
      btn.disabled = false;
      btn.textContent = '🔁 تلاش دوباره';
      lastActivitySig = null;
      refreshActivity();
    }
  });
  wrap.appendChild(btn);
  wrap.appendChild(msg);
  body.appendChild(wrap);
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
function renderMessages(events) {
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

async function refreshActivity() {
  if (!activeProjectId || !activeSessionId) return;
  const sid = activeSessionId;
  let events = [];
  try {
    events = await api('/api/messages?projectId=' + encodeURIComponent(activeProjectId) + '&sessionId=' + encodeURIComponent(sid));
  } catch (e) {
    return;
  }
  if (sid !== activeSessionId) return; // session changed mid-fetch; drop stale result
  msgCache.set(sid, events);
  const sig = events.map((e) => e.id).join(',');
  if (sig === lastActivitySig) return;
  lastActivitySig = sig;
  renderMessages(events);
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
  if (busy) return;
  const text = composer.value.trim();
  if (!text || !activeProjectId || !activeSessionId) return;
  const sid = activeSessionId;
  composer.value = '';
  autoGrow();
  lockUI(true);
  // optimistic echo so the user sees their message immediately
  lastActivitySig = null;
  renderMessages([...(msgCache.get(sid) || []), { id: 't' + Date.now(), ts: Date.now(), role: 'user', text }]);
  try {
    await api('/api/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, projectId: activeProjectId, sessionId: sid }),
    });
  } catch (e) {}
  lockUI(false);
  lastActivitySig = null;
  await Promise.all([refreshActivity(), refreshState()]);
}
sendBtn.addEventListener('click', send);

async function stop() {
  try {
    await api('/api/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: activeProjectId, sessionId: activeSessionId }),
    });
  } catch (e) {}
  lockUI(false);
  lastActivitySig = null;
  await refreshActivity();
}
$('stopBtn').addEventListener('click', stop);

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

// ---------- boot ----------
async function init() {
  await loadProjects();
  if (activeProjectId) await loadSessions();
  paintCachedBoard();
  await Promise.all([refreshActivity(), refreshState(), refreshModels()]);
  setInterval(refreshState, 5_000);
  setInterval(refreshActivity, 5_000);
  setInterval(refreshModels, 10_000);
}
init();
