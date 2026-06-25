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
let currentLang = 'fa'; // default to Persian

// Translation system
const translations = {
  fa: {
    brandTitle: "مرکز فرماندهی",
    brandSub: "استارتاپ خودگردان · n8n + Claude",
    selectProject: "انتخاب پروژه",
    newProject: "پروژه جدید",
    tasks: "تسک",
    bugs: "باگ",
    fixes: "فیکس",
    activeModel: "مدل فعال",
    systemStatus: "وضعیت سیستم",
    bridgeOffline: "پل خاموش است",
    bridgeNotReady: "پل آماده نیست",
    bridgeReady: "پل آماده است",
    settings: "تنظیمات",
    activity: "فعالیت‌ها",
    live: "زنده",
    selectSession: "انتخاب جلسه",
    newChat: "چت جدید",
    waitingActivity: "در انتظار فعالیت…",
    newIdea: "ایده جدید",
    sendCommand: "یک دستور بفرست… (ایده / fix: / feature: / ‏/report / ‏/exit)",
    enterToSend: "Enter برای ارسال · Shift+Enter خط جدید",
    board: "برد",
    pullRequests: "پول‌ریکوئست‌ها",
    repository: "ریپازیتوری",
    open: "باز",
    closed: "بسته",
    failed: "خطادار",
    all: "همه",
    noPRs: "پول‌ریکوئست بازی نیست.",
    projectNotFound: "پروژه‌ای انتخاب نشده",
    loadingRepo: "در حال بارگذاری…",
    repoError: "خطا در دریافت اطلاعات ریپازیتوری",
    folderMissing: "پوشه‌ای پیدا نشد",
    localFolderMissing: "پوشهٔ محلی پیدا نشد",
    cloneFolderMissing: "پوشهٔ کلون پیدا نشد",
    pathDoesNotExist: "مسیر موجود نیست",
    reclone: "کلون مجدد",
    deleteProject: "حذف پروژه",
    repoLocal: "پروژه محلی",
    repoCloned: "کلون‌شده روی این سیستم",
    repoNotCloned: "هنوز کلون نشده",
    update: "به‌روزرسانی",
    clone: "کلون",
    branches: "شاخه‌ها",
    current: "فعلی",
    default: "پیش‌فرض",
    viewOnTrello: "مشاهده در ترلو",
    approvedAndMerged: "✅ این تسک تأیید و مرج شده است",
    waitingBackend: "⏳ منتظر آماده‌شدن API بک‌اند است. ابتدا تسک‌های backend را اجرا کن.",
    runTechLeadReview: "🏗️ ریویوی Tech Lead (مرج یا برگشت برای اصلاح)",
    runAgentTask: "▶ اجرای این تسک با agent (کلون + کد + PR)",
    techLeadConfirm: "Tech Lead این PR را بررسی می‌کند: اگر CI سبز و کد سالم بود مرج، وگرنه برای اصلاح به «در صف» برمی‌گردد. ادامه؟",
    agentConfirm: "agent این تسک را کلون می‌کند، کد می‌نویسد و یک PR به develop می‌سازد. ادامه؟",
    running: "⏳ در حال اجرا…",
    prMade: "✅ PR #",
    files: " فایل)",
    viewPR: "مشاهده PR",
    reviewMerged: "✅ تأیید و مرج شد در develop. کارت به «تمام‌شده» رفت.",
    reviewApproved: "✅ تأیید شد ولی مرج خودکار نشد — دستی merge کن.",
    reviewChanges: "🔧 نیاز به اصلاح. کارت به «در صف» برگشت (دفعهٔ بعد در حالت fix).",
    reviewCiFailed: "❌ CI رد شد. PR بسته و کارت برای فیکس به «در صف» برگشت.",
    reviewConflict: "⚠️ کانفلیکت با develop. PR بسته و کارت برگشت.",
    reviewWaitCi: "⏳ CI هنوز در حال اجراست؛ کمی بعد دوباره بزن.",
    done: "✅ انجام شد",
    retry: "🔁 تلاش دوباره",
    error: "⚠️ ",
    failedToRun: "اجرا ناموفق بود",
    pullRequest: "پول‌ریکوئست گیت‌هاب",
    merged: "merged",
    base: "به",
    head: "از",
    viewGitHub: "GitHub",
    description: "توضیحات",
    changedFiles: "فایل‌های تغییریافته",
    reviews: "ریویوها",
    comments: "نظرات",
    trelloCard: "تسک ترلو",
    labels: "برچسب‌ها",
    noContent: "محتوایی ثبت نشده",
    projects: "پروژه‌ها",
    newProjectPlaceholder: "نام پروژه",
    create: "ساخت",
    githubRemotePlaceholder: "آدرس گیت‌هاب (owner/repo)",
    localPathPlaceholder: "یا مسیر محلی سیستم (مثل D:\\ یا /...)",
    browse: "Browse",
    selectFolder: "انتخاب پوشه از سیستم",
    projectsDesc: "پروژهٔ جدید بساز، یا پروژه‌های موجود را تغییر نام بده / حذف کن.",
    rename: "تغییر نام",
    delete: "حذف",
    deleteProjectConfirm: "این پروژه و همه‌ی چت‌هایش حذف شود؟",
    chats: "چت‌ها",
    newChatPlaceholder: "عنوان چت (اختیاری)",
    chatsDesc: "چت جدید بساز، یا چت‌های این پروژه را مدیریت کن.",
    deleteChatConfirm: "این چت حذف شود؟",
    welcome: "به مرکز فرماندهی خوش آمدید 👋",
    tokensTab: "Tokens",
    stacksTab: "Stacks",
    rolesTab: "Roles",
    tokensDesc: "کلیدها و توکن‌ها را اینجا وارد کن. در secrets.env ذخیره می‌شوند.",
    stacksDesc: "تخصص‌های هر دامنه را ویرایش کن. در پوشه stacks/ ذخیره می‌شوند.",
    rolesDesc: "وظایف و دستورالعمل‌های هر نقش را ویرایش کن. در پوشه roles/ ذخیره می‌شوند.",
    saving: "در حال ذخیره…",
    save: "ذخیره",
    saved: "✅ ذخیره شد",
    saveError: "خطا در ذخیره",
    fillRequired: "لطفاً فیلدهای ستاره‌دار را پر کن (",
    fillRequiredEnd: " مانده).",
    close: "بستن",
    stopped: "⏹️ متوقف شد",
    system: "سیستم",
    you: "تو",
    approved: "تأیید",
    changes: "درخواست تغییر",
    comment: "نظر",
    secondsAgo: " ثانیه پیش",
    minutesAgo: " دقیقه پیش",
    hoursAgo: " ساعت پیش",
    daysAgo: " روز پیش",
    ago: " پیش",
    and: " و ",
    cardRef: "↳ ",
    column: " ستون",
    chatMain: "چت اصلی",
    bridgeHelpTitle: "راه‌اندازی پل",
    bridgeHelpDesc: "راهنمای راه‌اندازی پل‌های مختلف",
    bridgeClaudeTab: "Claude",
    bridgeAnthropicTab: "Anthropic",
    bridgeOpenAiTab: "OpenAI",
    bridgeClaudeTitle: "راه‌اندازی Claude",
    bridgeClaudeDesc: "برای استفاده از Claude، مراحل زیر را دنبال کنید:",
    bridgeAnthropicTitle: "راه‌اندازی Anthropic",
    bridgeAnthropicDesc: "برای استفاده از Anthropic:",
    bridgeOpenAiTitle: "راه‌اندازی OpenAI",
    bridgeOpenAiDesc: "برای استفاده از OpenAI:",
    bridgeStep1: "ایجاد حساب کاربری در Anthropic",
    bridgeStep2: "دریافت API Key",
    bridgeStep3: "وارد کردن API Key در تنظیمات"
  },
  en: {
    brandTitle: "Command Center",
    brandSub: "Autonomous Startup · n8n + Claude",
    selectProject: "Select Project",
    newProject: "New Project",
    tasks: "Tasks",
    bugs: "Bugs",
    fixes: "Fixes",
    activeModel: "Active Model",
    systemStatus: "System Status",
    bridgeOffline: "Bridge is offline",
    bridgeNotReady: "Bridge is not ready",
    bridgeReady: "Bridge is ready",
    settings: "Settings",
    activity: "Activity",
    live: "Live",
    selectSession: "Chat Session",
    newChat: "New Chat",
    waitingActivity: "Waiting for activity…",
    newIdea: "New Idea",
    sendCommand: "Send a command… (idea / fix: / feature: / /report / /exit)",
    enterToSend: "Enter to send · Shift+Enter new line",
    board: "Board",
    pullRequests: "Pull Requests",
    repository: "Repository",
    open: "Open",
    closed: "Closed",
    failed: "Failed",
    all: "All",
    noPRs: "No pull requests.",
    projectNotFound: "No project selected.",
    loadingRepo: "Loading…",
    repoError: "Error loading repository info.",
    folderMissing: "Folder not found",
    localFolderMissing: "Local folder not found",
    cloneFolderMissing: "Clone folder not found",
    pathDoesNotExist: "Path does not exist.",
    reclone: "Re-clone",
    deleteProject: "Delete Project",
    repoLocal: "Local Project",
    repoCloned: "Cloned on this system",
    repoNotCloned: "Not yet cloned",
    update: "Update",
    clone: "Clone",
    branches: "Branches",
    current: "Current",
    default: "Default",
    viewOnTrello: "View on Trello",
    approvedAndMerged: "✅ This task has been approved and merged.",
    waitingBackend: "⏳ Waiting for backend API to be ready. Run backend tasks first.",
    runTechLeadReview: "🏗️ Tech Lead Review (merge or send back for fixes)",
    runAgentTask: "▶ Run this task with agent (clone + code + PR)",
    techLeadConfirm: "Tech Lead will review this PR: if CI is green and code is good, it will merge; otherwise, it will go back to 'To Do' for fixes. Continue?",
    agentConfirm: "Agent will clone this task, write code, and create a PR to develop. Continue?",
    running: "⏳ Running…",
    prMade: "✅ PR #",
    files: " files)",
    viewPR: "View PR",
    reviewMerged: "✅ Approved and merged into develop. Card moved to 'Done'.",
    reviewApproved: "✅ Approved but auto-merge failed — merge manually.",
    reviewChanges: "🔧 Changes needed. Card moved back to 'To Do' (next time in fix mode).",
    reviewCiFailed: "❌ CI failed. PR closed and card moved back to 'To Do' for fixes.",
    reviewConflict: "⚠️ Conflict with develop. PR closed and card moved back.",
    reviewWaitCi: "⏳ CI is still running; try again later.",
    done: "✅ Done",
    retry: "🔁 Retry",
    error: "⚠️ ",
    failedToRun: "Failed to run",
    pullRequest: "GitHub Pull Request",
    merged: "merged",
    base: "to",
    head: "from",
    viewGitHub: "GitHub",
    description: "Description",
    changedFiles: "Changed Files",
    reviews: "Reviews",
    comments: "Comments",
    trelloCard: "Trello Card",
    labels: "Labels",
    noContent: "No content saved.",
    projects: "Projects",
    newProjectPlaceholder: "Project Name",
    create: "Create",
    githubRemotePlaceholder: "GitHub address (owner/repo)",
    localPathPlaceholder: "Or local system path (e.g., D:\\ or /...)",
    browse: "Browse",
    selectFolder: "Select folder from system",
    projectsDesc: "Create a new project, or rename/delete existing projects.",
    rename: "Rename",
    delete: "Delete",
    deleteProjectConfirm: "Delete this project and all its chats?",
    chats: "Chats",
    newChatPlaceholder: "Chat title (optional)",
    chatsDesc: "Create a new chat, or manage chats for this project.",
    deleteChatConfirm: "Delete this chat?",
    welcome: "Welcome to Command Center 👋",
    tokensTab: "Tokens",
    stacksTab: "Stacks",
    rolesTab: "Roles",
    tokensDesc: "Enter your keys and tokens here. Saved in secrets.env.",
    stacksDesc: "Edit stack specializations. Saved in stacks/ folder.",
    rolesDesc: "Edit role instructions. Saved in roles/ folder.",
    saving: "Saving…",
    save: "Save",
    saved: "✅ Saved",
    saveError: "Error saving",
    fillRequired: "Please fill the required fields (",
    fillRequiredEnd: " remaining).",
    close: "Close",
    stopped: "⏹️ Stopped",
    system: "System",
    you: "You",
    approved: "Approved",
    changes: "Changes",
    comment: "Comment",
    secondsAgo: " seconds ago",
    minutesAgo: " minutes ago",
    hoursAgo: " hours ago",
    daysAgo: " days ago",
    ago: " ago",
    and: " and ",
    cardRef: "↳ ",
    column: " column",
    chatMain: "Main Chat",
    bridgeHelpTitle: "Bridge Setup",
    bridgeHelpDesc: "Guide to set up different bridges",
    bridgeClaudeTab: "Claude",
    bridgeAnthropicTab: "Anthropic",
    bridgeOpenAiTab: "OpenAI",
    bridgeClaudeTitle: "Claude Setup",
    bridgeClaudeDesc: "To use Claude, follow these steps:",
    bridgeAnthropicTitle: "Anthropic Setup",
    bridgeAnthropicDesc: "To use Anthropic:",
    bridgeOpenAiTitle: "OpenAI Setup",
    bridgeOpenAiDesc: "To use OpenAI:",
    bridgeStep1: "Create an account on Anthropic",
    bridgeStep2: "Get your API Key",
    bridgeStep3: "Enter your API Key in settings"
  }
};

// Helper function to get translation
const t = (key) => translations[currentLang][key] || key;

// Function to set language and update UI
function setLanguage(lang) {
  currentLang = lang;
  localStorage.setItem('mc_lang', lang);

  // Update html dir and lang attributes
  document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;

  // Update body font
  document.body.style.fontFamily = lang === 'fa' 
    ? "'Vazirmatn', system-ui, sans-serif" 
    : "'Inter', system-ui, sans-serif";

  // Update language buttons
  $('langFa').classList.toggle('active', lang === 'fa');
  $('langEn').classList.toggle('active', lang === 'en');

  // Update all translatable elements
  updateTranslations();
  
  // Re-render dynamic content
  if (lastState) {
    renderBoard(lastState.columns);
  }
  paintCachedBoard();
  if (activeSessionId) {
    paintCachedSession();
  }
  refreshModels();
}

// Function to update all translatable elements
function updateTranslations() {
  // Update elements with data-i18n attributes
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });

  // Update elements with data-i18n-placeholder attributes
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });

  // Update elements with data-i18n-title attributes
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key);
  });

  // Update title
  document.title = currentLang === 'fa' 
    ? "⚡ مرکز فرماندهی — استارتاپ خودگردان"
    : "⚡ Command Center — Autonomous Startup";
}

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
  lang: 'mc_lang'
};

// ---------- helpers ----------
const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const faNum = (n) => currentLang === 'fa' ? String(n).replace(/\d/g, (d) => FA_DIGITS[d]) : String(n);

function timeAgo(ts) {
  const s = Math.floor((Date.now() - (typeof ts === 'string' ? new Date(ts).getTime() : ts)) / 1000);
  if (s < 60) return faNum(s) + (currentLang === 'fa' ? ' ثانیه' : t('secondsAgo'));
  if (s < 3600) return faNum(Math.floor(s / 60)) + (currentLang === 'fa' ? ' دقیقه' : t('minutesAgo'));
  if (s < 86400) return faNum(Math.floor(s / 3600)) + (currentLang === 'fa' ? ' ساعت' : t('hoursAgo'));
  return faNum(Math.floor(s / 86400)) + (currentLang === 'fa' ? ' روز' : t('daysAgo'));
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const ROLE_LABEL = { 
  user: () => t('you'), 
  agent: () => t('system'), 
  system: () => t('system') 
};

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
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t('chatMain') }),
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

// ---------- projects modal (create / rename / delete) ----------
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
    ren.title = t('rename');
    ren.addEventListener('click', () => inlineRename(main, p.name, async (val) => {
      await api('/api/projects/' + p.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: val }) });
      await loadProjects(); renderProjectsList();
    }));
    acts.appendChild(ren);
    const del = el('button', 'mini-btn danger', '🗑');
    del.title = t('delete');
    del.disabled = currentProjects.length <= 1;
    del.addEventListener('click', () => deleteProject(p.id));
    acts.appendChild(del);
    row.appendChild(acts);
    box.appendChild(row);
  }
}

function extractGithubSlug(raw) {
  let s = raw.trim().replace(/\.git$/, '');
  const idx = s.toLowerCase().indexOf('github.com/');
  if (idx !== -1) s = s.slice(idx + 'github.com/'.length);
  const parts = s.split('/').filter(Boolean);
  if (parts.length > 2 && /^[~.]|^(Desktop|Documents|Users|home)$/i.test(parts[0])) {
    const last = parts[parts.length - 1];
    if (last.includes('__')) { const [o, ...r] = last.split('__'); return o + '/' + r.join('-'); }
    return last;
  }
  return parts.length >= 2 ? parts[0] + '/' + parts[1] : s;
}

async function createProjectFromModal() {
  const name = $('newProjName').value.trim();
  if (!name) { $('newProjName').focus(); return; }
  let repo = $('newProjRepoLocal').value.trim();
  if (!repo) {
    const raw = $('newProjRepoRemote').value.trim();
    repo = raw ? extractGithubSlug(raw) : '';
    if (repo !== raw) $('newProjRepoRemote').value = repo; // show corrected value
  }
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

async function deleteProject(pid, { force = false } = {}) {
  if (!force && currentProjects.length <= 1) return;
  if (!confirm(t('deleteProjectConfirm'))) return;
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

// ---------- sessions (chats) modal ----------
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
    ren.title = t('rename');
    ren.addEventListener('click', () => inlineRename(main, s.title, async (val) => {
      await api('/api/sessions/' + s.id + '?projectId=' + encodeURIComponent(activeProjectId), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: val }),
      });
      await loadSessions(); renderSessionsList();
    }));
    acts.appendChild(ren);
    const del = el('button', 'mini-btn danger', '🗑');
    del.title = t('delete');
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
  if (!confirm(t('deleteChatConfirm'))) return;
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
  const btnText = $('browseLocalBtn').querySelector('span');
  if (btnText) btnText.textContent = t('running');
  else $('browseLocalBtn').textContent = t('running');
  try {
    const res = await api('/api/browse', { method: 'POST' });
    if (res && res.path) {
      $('newProjRepoLocal').value = res.path;
    } else if (!res || (!res.path && !res.cancelled)) {
      // osascript failed or unavailable — fall back to in-browser picker
      await openFolderPicker();
    }
  } catch (e) {
    await openFolderPicker();
  }
  $('browseLocalBtn').disabled = false;
  if (btnText) btnText.textContent = t('browse');
  else $('browseLocalBtn').innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span data-i18n="browse">${t('browse')}</span>`;
});
projectsOverlay.addEventListener('click', (e) => { if (e.target === projectsOverlay) closeProjects(); });
sessionsOverlay.addEventListener('click', (e) => { if (e.target === sessionsOverlay) closeSessions(); });

// ---------- in-browser folder picker ----------
let folderPickerCurrentPath = '';

async function loadFolderPicker(dirPath) {
  const list = $('folderPickerList');
  const pathLabel = $('folderPickerPath');
  list.innerHTML = '<div style="padding:8px 12px; opacity:0.5; font-size:12px;">در حال بارگذاری…</div>';
  try {
    const res = await api('/api/ls?path=' + encodeURIComponent(dirPath));
    if (!res || !res.ok) {
      list.innerHTML = `<div style="padding:8px 12px; opacity:0.5; font-size:12px;">خطا: ${res && res.error || 'دسترسی ممکن نیست'}</div>`;
      return;
    }
    folderPickerCurrentPath = res.current;
    pathLabel.textContent = res.current;
    $('folderPickerPath').title = res.current;
    $('folderPickerUp').disabled = !res.parent;
    list.innerHTML = '';
    if (res.dirs.length === 0) {
      list.innerHTML = '<div style="padding:8px 12px; opacity:0.5; font-size:12px;">زیرپوشه‌ای پیدا نشد</div>';
    }
    for (const d of res.dirs) {
      const row = document.createElement('button');
      row.className = 'manage-name';
      row.style.cssText = 'width:100%; text-align:left; direction:ltr; padding:6px 12px; font-size:13px; border-radius:0;';
      row.textContent = '📁 ' + d.name;
      row.addEventListener('click', () => loadFolderPicker(d.path));
      list.appendChild(row);
    }
  } catch (e) {
    list.innerHTML = `<div style="padding:8px 12px; opacity:0.5; font-size:12px;">خطا در اتصال</div>`;
  }
}

async function openFolderPicker() {
  $('folderPicker').style.display = 'block';
  const startPath = $('newProjRepoLocal').value.trim() || '~';
  await loadFolderPicker(startPath);
}

$('folderPickerUp').addEventListener('click', async () => {
  const res = await api('/api/ls?path=' + encodeURIComponent(folderPickerCurrentPath));
  if (res && res.parent) await loadFolderPicker(res.parent);
});
$('folderPickerClose').addEventListener('click', () => { $('folderPicker').style.display = 'none'; });
$('folderPickerSelect').addEventListener('click', () => {
  if (folderPickerCurrentPath) $('newProjRepoLocal').value = folderPickerCurrentPath;
  $('folderPicker').style.display = 'none';
});

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
  if (!activeProjectId) { box.innerHTML = ''; box.appendChild(el('div', 'empty', t('projectNotFound'))); return; }
  box.innerHTML = '';
  box.appendChild(el('div', 'empty', t('loadingRepo')));
  let r;
  try {
    r = await api('/api/repo?projectId=' + encodeURIComponent(activeProjectId));
  } catch (e) {
    box.innerHTML = ''; box.appendChild(el('div', 'empty', t('repoError'))); return;
  }
  renderRepo(r);
}

async function renderRepo(r) {
  const box = $('repoView');
  box.innerHTML = '';
  if (!r || !r.ok) {
    const errWrap = el('div', 'repo-folder-missing');
    errWrap.style.flexDirection = 'column';
    errWrap.style.gap = '10px';
    if (r && r.errorType === 'empty') {
      errWrap.appendChild(el('div', 'repo-folder-missing-msg', '⚠️ این پروژه هیچ مسیر یا ریپویی ندارد.'));
      const hint = el('div', 'repo-folder-missing-msg');
      hint.style.fontSize = '12px';
      hint.style.opacity = '0.7';
      hint.textContent = 'از بخش «پروژه‌ها» پروژه را ویرایش کنید و مسیر محلی یا آدرس گیت‌هاب را وارد کنید.';
      errWrap.appendChild(hint);
    } else if (r && r.errorType === 'invalid-path') {
      errWrap.appendChild(el('div', 'repo-folder-missing-msg', '⚠️ ' + (r.error || t('folderMissing'))));
    } else {
      errWrap.appendChild(el('div', 'repo-folder-missing-msg', '⚠️ ' + ((r && r.error) || t('folderMissing'))));
    }
    box.appendChild(errWrap);
    $('branchCount').textContent = faNum(0);
    return;
  }

  const isLocal = r.isLocalPath;

  // ---- folder was deleted by the user after cloning ----
  if (r.folderMissing) {
    const autoMsg = (isLocal ? (t('localFolderMissing') || 'Local folder not found') : (t('cloneFolderMissing') || 'Cloned folder not found'))
      + '\n' + (t('pathDoesNotExist') || 'The path no longer exists.')
      + '\n\n' + (t('deleteProjectConfirm') || 'Remove this project from the list?');
    if (confirm(autoMsg)) {
      await deleteProject(activeProjectId, { force: true });
      if (currentProjects.length === 0) {
        const def = await api('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'My Project' }) });
        if (def && def.id) { await loadProjects(); renderProjectsList(); await selectProject(def.id); }
      }
      return;
    }
    const warn = el('div', 'repo-folder-missing');
    warn.innerHTML = '<span class="repo-folder-missing-icon">⚠️</span>';
    const msg = el('div', 'repo-folder-missing-msg');
    msg.appendChild(el('strong', null, isLocal ? t('localFolderMissing') : t('cloneFolderMissing')));
    msg.appendChild(el('p', null, t('pathDoesNotExist')));
    warn.appendChild(msg);

    const acts = el('div', 'repo-folder-missing-actions');

    if (!isLocal) {
      const reCloneBtn = el('button', 'send', t('reclone'));
      reCloneBtn.addEventListener('click', async () => {
        reCloneBtn.disabled = true;
        reCloneBtn.textContent = t('running');
        let res;
        try {
          res = await api('/api/clone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: activeProjectId }) });
        } catch (e) { res = { ok: false, error: e.message }; }
        if (res && res.ok) renderRepo(res);
        else {
          reCloneBtn.disabled = false;
          reCloneBtn.textContent = t('reclone');
          const err = el('div', 'repo-err', t('error') + ((res && res.error) || t('failedToRun')));
          box.appendChild(err);
        }
      });
      acts.appendChild(reCloneBtn);
    }

    const delBtn = el('button', 'mini-btn danger', t('deleteProject'));
    delBtn.addEventListener('click', async () => {
      await deleteProject(activeProjectId, { force: true });
      if (currentProjects.length === 0) {
        const def = await api('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'My Project' }) });
        if (def && def.id) { await loadProjects(); renderProjectsList(); await selectProject(def.id); }
      }
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
    if (r.githubRepo) {
      const title = el('a', 'repo-title', r.githubRepo);
      title.href = 'https://github.com/' + r.githubRepo;
      title.target = '_blank';
      info.appendChild(title);
    } else {
      info.appendChild(el('span', 'repo-title', r.repo));
    }
    const st = el('span', 'repo-status ok', '✅ ' + t('repoLocal'));
    info.appendChild(st);
  } else {
    const title = el('a', 'repo-title', r.repo);
    title.href = 'https://github.com/' + r.repo;
    title.target = '_blank';
    info.appendChild(title);
    const st = el('span', 'repo-status ' + (r.cloned ? 'ok' : 'warn'), r.cloned ? '✅ ' + t('repoCloned') : '⬇️ ' + t('repoNotCloned'));
    info.appendChild(st);
  }

  if (r.dir) info.appendChild(el('span', 'repo-dir', r.dir));
  head.appendChild(info);

  if (!isLocal) {
    const cloneBtn = el('button', 'send', r.cloned ? t('update') : t('clone'));
    cloneBtn.addEventListener('click', async () => {
      cloneBtn.disabled = true;
      cloneBtn.textContent = t('running');
      let res;
      try {
        res = await api('/api/clone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: activeProjectId }) });
      } catch (e) { res = { ok: false, error: e.message }; }
      if (res && res.ok) renderRepo(res);
      else {
        cloneBtn.disabled = false;
        cloneBtn.textContent = r.cloned ? t('update') : t('clone');
        const err = el('div', 'repo-err', t('error') + ((res && res.error) || t('failedToRun')));
        box.appendChild(err);
      }
    });
    head.appendChild(cloneBtn);
  }

  box.appendChild(head);

  // branches
  const branches = r.branches || [];
  $('branchCount').textContent = faNum(branches.length);
  if (r.branchesError) box.appendChild(el('div', 'repo-err', t('error') + r.branchesError));
  const bhead = el('div', 'repo-section-title', '🌿 ' + t('branches') + ' (' + faNum(branches.length) + ')');
  box.appendChild(bhead);
  if (!branches.length) {
    const msg = isLocal ? (t('noGitRepo') || 'No git repository / no branches') : t('folderMissing');
    box.appendChild(el('div', 'empty', msg));
    return;
  }
  const list = el('div', 'branch-list');
  for (const b of branches) {
    const row = el('div', 'branch-row');
    const isCur = b === r.current;
    const isDef = b === r.defaultBranch;
    row.appendChild(el('span', 'branch-name' + (isCur ? ' current' : ''), b));
    if (isCur) row.appendChild(el('span', 'branch-tag cur', t('current')));
    if (isDef) row.appendChild(el('span', 'branch-tag def', t('default')));
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
    setHealth('bad', t('bridgeOffline'));
    return;
  }

  if (!firstRunHandled && s.system && s.system.configured === false) {
    firstRunHandled = true;
    openSettings(true);
  }

  // project repo link (the chip itself holds the switcher, so only touch the link)
  const link = $('projectRepoLink');
  currentRepo = normRepo((s.project && s.project.repo) || '') || null;
  const isLocal = currentRepo && /^([a-zA-Z]:[\/\\]|\\\\|\/|~)/.test(currentRepo);

  if (currentRepo) {
    if (isLocal) {
      link.textContent = t('repoLocal');
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
  if (!b.online) setHealth('bad', t('bridgeOffline'));
  else if (!b.ready) setHealth('warn', t('bridgeNotReady'));
  else setHealth('ok', t('bridgeReady'));

  // keep the UI locked if the active session has a command running (survives reload)
  const sessionBusy = Array.isArray(s.running) && s.running.indexOf(activeSessionId) >= 0;
  if (sessionBusy && !busy) lockUI(true);
  else if (!sessionBusy && busy) lockUI(false);

  renderBoard(s.columns);
  lastState = s;
  // cache the board snapshot for an instant paint on the next project switch
  try { localStorage.setItem(LS.board(activeProjectId), JSON.stringify({ columns: s.columns, totals: s.totals })); } catch {}
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
const CI_LABELS = { success: '✅', failure: '❌', running: '⏳', none: '—', unknown: '?' };
const CI_TEXT = { 
  fa: { success: 'سبز', failure: 'قرمز', running: 'در حال اجرا', none: 'بدون CI', unknown: 'نامشخص' },
  en: { success: 'Success', failure: 'Failed', running: 'Running', none: 'No CI', unknown: 'Unknown' }
};

async function refreshPRs() {
  const list = $('prList');
  if (!currentRepo) {
    list.innerHTML = '';
    list.appendChild(el('div', 'empty', t('projectNotFound')));
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
    list.appendChild(el('div', 'empty', t('noPRs')));
    return;
  }
  for (const pr of prs) {
    const row = el('div', 'pr clickable');
    row.addEventListener('click', () => openPRDetail(currentRepo, pr.number, pr.title));
    row.appendChild(el('span', 'num', '#' + faNum(pr.number)));
    const a = el('span', 'pr-title', pr.title);
    a.setAttribute('dir', 'auto');
    row.appendChild(a);
    const stCls = pr.merged ? 'merged' : pr.state === 'open' ? 'open' : 'closed';
    const stTxt = pr.merged ? t('merged') : (pr.state === 'open' ? t('open') : t('closed'));
    row.appendChild(el('span', 'state ' + stCls, stTxt));
    row.appendChild(el('span', 'ci ' + pr.ci.state, CI_LABELS[pr.ci.state] + ' ' + (currentLang === 'fa' ? CI_TEXT.fa[pr.ci.state] : CI_TEXT.en[pr.ci.state])));
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
  $('detailTitle').textContent = title.replace(/^\[[^\]]*\]\[[^\]]*\](\[[^\]]*\])?\s*/, '');
  $('detailMeta').textContent = meta || '';
  $('detailBody').innerHTML = '<div class="empty" data-i18n="loadingRepo">' + t('loadingRepo') + '</div>';
  detailOverlay.hidden = false;
}

async function openCardDetail(cardId, cardName, colKey) {
  openDetailModal(cardName, t('trelloCard'));
  let data;
  try {
    data = await api('/api/card-detail?id=' + encodeURIComponent(cardId));
  } catch (e) {
    $('detailBody').innerHTML = '<div class="empty">' + t('repoError') + '</div>';
    return;
  }
  const body = $('detailBody');
  body.innerHTML = '';

  if (data.url) {
    const link = el('a', 'detail-link', t('viewOnTrello'));
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
    row.appendChild(el('span', 'detail-key', t('labels')));
    const tags = el('div', 'detail-tags');
    data.labels.forEach((l) => tags.appendChild(el('span', 'tag cx', l)));
    row.appendChild(tags);
    body.appendChild(row);
  }

  if (data.desc && data.desc.trim()) {
    body.appendChild(el('div', 'detail-section-title', t('description')));
    const desc = el('div', 'detail-text');
    desc.textContent = data.desc;
    desc.setAttribute('dir', 'auto');
    body.appendChild(desc);
  }

  if (data.comments && data.comments.length) {
    body.appendChild(el('div', 'detail-section-title', t('comments') + ' (' + faNum(data.comments.length) + ')'));
    for (const c of data.comments) {
      const cm = el('div', 'detail-comment');
      const who = el('div', 'detail-comment-who', (c.author || '—') + (c.ts ? ' · ' + timeAgo(c.ts) : ''));
      const txt = el('div', 'detail-comment-text', c.text || '');
      txt.setAttribute('dir', 'auto');
      cm.appendChild(who);
      cm.appendChild(txt);
      body.appendChild(cm);
    }
  }

  if (!data.desc && (!data.comments || !data.comments.length)) {
    body.appendChild(el('div', 'empty', t('noContent')));
  }
}

function renderCardAction(body, cardId, colKey) {
  const wrap = el('div', 'detail-run');

  if (colKey === 'owner') {
    wrap.appendChild(el('div', 'run-task-msg ok', t('approvedAndMerged')));
    body.appendChild(wrap);
    return;
  }
  if (colKey === 'wait') {
    wrap.appendChild(el('div', 'run-task-msg', t('waitingBackend')));
    body.appendChild(wrap);
    return;
  }

  const isReview = colKey === 'review';
  const cfg = isReview
    ? { endpoint: '/api/review', label: t('runTechLeadReview'),
        confirm: t('techLeadConfirm') }
    : { endpoint: '/api/code-task', label: t('runAgentTask'),
        confirm: t('agentConfirm') };

  const btn = el('button', 'run-task-btn', cfg.label);
  const msg = el('div', 'run-task-msg');
  btn.addEventListener('click', async () => {
    if (!confirm(cfg.confirm)) return;
    btn.disabled = true;
    btn.textContent = t('running');
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
        msg.innerHTML = t('prMade') + faNum(r.pr) + ' (' + faNum(r.files || 0) + t('files');
        const a = el('a', 'detail-link', t('viewPR'));
        a.href = r.url; a.target = '_blank';
        msg.appendChild(a);
      } else {
        const REV = {
          merged: t('reviewMerged'),
          approved: t('reviewApproved'),
          changes: t('reviewChanges'),
          ciFail: t('reviewCiFailed'),
          conflict: t('reviewConflict'),
          waitCI: t('reviewWaitCi'),
        };
        msg.textContent = REV[r.status] || t('done');
        if (r.status === 'changes' || r.status === 'ciFail' || r.status === 'conflict') msg.className = 'run-task-msg err';
        if (r.status === 'waitCI') { msg.className = 'run-task-msg'; done = false; }
      }
      if (done) btn.textContent = t('done');
      else { btn.disabled = false; btn.textContent = cfg.label; }
      lastActivitySig = null;
      refreshActivity(); refreshState();
      if (activeMainTab === 'prs') refreshPRs();
    } else {
      msg.className = 'run-task-msg err';
      msg.textContent = t('error') + ((r && r.error) || (res && res.error) || t('failedToRun'));
      btn.disabled = false;
      btn.textContent = t('retry');
      lastActivitySig = null;
      refreshActivity();
    }
  });
  wrap.appendChild(btn);
  wrap.appendChild(msg);
  body.appendChild(wrap);
}

async function openPRDetail(repo, number, title) {
  openDetailModal('#' + number + ' · ' + title, t('pullRequest'));
  let data;
  try {
    data = await api('/api/pr-detail?repo=' + encodeURIComponent(repo) + '&number=' + number);
  } catch (e) {
    $('detailBody').innerHTML = '<div class="empty">' + t('repoError') + '</div>';
    return;
  }
  const body = $('detailBody');
  body.innerHTML = '';

  // header row
  const hrow = el('div', 'detail-header-row');
  const stCls = data.merged ? 'merged' : data.state === 'open' ? 'open' : 'closed';
  const stTxt = data.merged ? t('merged') : (data.state === 'open' ? t('open') : t('closed'));
  hrow.appendChild(el('span', 'state ' + stCls, stTxt));
  hrow.appendChild(el('span', 'detail-branch', data.head + ' ' + t('head') + ' ' + t('base') + ' ' + data.base));
  if (data.author) hrow.appendChild(el('span', 'detail-author', '👤 ' + data.author));
  if (data.created_at) hrow.appendChild(el('span', 'detail-age', timeAgo(data.created_at)));
  const link = el('a', 'detail-link', t('viewGitHub'));
  link.href = data.url;
  link.target = '_blank';
  hrow.appendChild(link);
  body.appendChild(hrow);

  if (data.body && data.body.trim()) {
    body.appendChild(el('div', 'detail-section-title', t('description')));
    const desc = el('div', 'detail-text');
    desc.textContent = data.body;
    desc.setAttribute('dir', 'auto');
    body.appendChild(desc);
  }

  if (data.files && data.files.length) {
    body.appendChild(el('div', 'detail-section-title', t('changedFiles') + ' (' + faNum(data.files.length) + ')'));
    const ftable = el('div', 'detail-files');
    for (const f of data.files) {
      const fr = el('div', 'detail-file-row');
      fr.appendChild(el('span', 'detail-filename', f.filename));
      fr.appendChild(el('span', 'detail-add', '+' + faNum(f.additions)));
      fr.appendChild(el('span', 'detail-del', '-' + faNum(f.deletions)));
      ftable.appendChild(fr);
    }
    body.appendChild(ftable);
  }

  if (data.reviews && data.reviews.length) {
    body.appendChild(el('div', 'detail-section-title', t('reviews') + ' (' + faNum(data.reviews.length) + ')'));
    for (const r of data.reviews) {
      const rv = el('div', 'detail-comment');
      const REVIEW_STATE = { APPROVED: '✅ ' + t('approved'), CHANGES_REQUESTED: '🔴 ' + t('changes'), COMMENTED: '💬 ' + t('comment'), DISMISSED: '⛔ ' + t('closed') };
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
    body.appendChild(el('div', 'detail-section-title', t('comments') + ' (' + faNum(data.comments.length) + ')'));
    for (const c of data.comments) {
      const cm = el('div', 'detail-comment');
      const who = el('div', 'detail-comment-who', (c.author || '—') + (c.ts ? ' · ' + timeAgo(c.ts) : ''));
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
    tl.appendChild(el('div', 'empty', t('waitingActivity')));
    return;
  }
  for (const ev of events) {
    const m = el('div', 'msg ' + (ev.role || 'agent'));
    const who = el('div', 'who');
    who.appendChild(el('span', null, ROLE_LABEL[ev.role] ? ROLE_LABEL[ev.role]() : t('system')));
    who.appendChild(el('span', null, ' · ' + timeAgo(ev.ts)));
    m.appendChild(who);

    const bubble = el('div', 'bubble');
    bubble.setAttribute('dir', 'auto');
    if (ev.card) bubble.appendChild(el('span', 'card-ref', t('cardRef') + ev.card + (ev.column ? ' · ' + ev.column : '')));
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
    tokens: t('tokensDesc'),
    stacks: t('stacksDesc'),
    roles: t('rolesDesc'),
  };
  $('settingsSub').innerHTML = subMap[tab];
}

async function loadStacksPanel() {
  let data;
  try { data = await api('/api/stacks'); } catch { return; }
  const panel = $('settingsStacks');
  panel.innerHTML = '';
  const LABELS = { 'backend.md': '⚙️ Backend', 'frontend.md': '🖥️ Frontend', 'mobile.md': '📱 Mobile' };
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
  const LABELS = { 'developer.md': '👨‍💻 Developer', 'tech-lead.md': '🏗️ Tech Lead', 'product-owner.md': '🎯 Product Owner' };
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
  $('settingsTitle').textContent = firstRun ? t('welcome') : t('settings');

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
    if (f.hint) label.appendChild(el('span', 'hint', ' · ' + f.hint));
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
  st.textContent = t('saving');
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
        st.textContent = t('fillRequired') + faNum(missing) + t('fillRequiredEnd');
        st.className = 'save-state err';
        return;
      }
      const res = await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });
      if (!res.ok) { st.textContent = t('saveError'); st.className = 'save-state err'; return; }
      await refreshState();
    } else {
      const panelId = activeSettingsTab === 'stacks' ? 'settingsStacks' : 'settingsRoles';
      const endpoint = '/api/' + activeSettingsTab;
      const editors = [...$(panelId).querySelectorAll('textarea.md-editor')];
      const values = {};
      for (const ta of editors) values[ta.dataset.file] = ta.value;
      const res = await api(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) });
      if (!res.ok) { st.textContent = t('saveError'); st.className = 'save-state err'; return; }
    }
    st.textContent = t('saved');
    st.className = 'save-state ok';
    setTimeout(closeSettings, 700);
  } catch (e) {
    st.textContent = t('saveError') + ': ' + e.message;
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

// ---------- language switch buttons ----------
$('langFa').addEventListener('click', () => setLanguage('fa'));
$('langEn').addEventListener('click', () => setLanguage('en'));

// ---------- bridge help modal ----------
let activeBridgeTab = 'claude';

async function openBridgeHelp() {
  $('bridgeHelpOverlay').hidden = false;
  switchBridgeTab('claude');
  initBridgeHelpInteractions();
  try {
    const s = await api('/api/settings');
    if (s && s.rootDir) {
      $('bridgeHelpOverlay').querySelectorAll('.bh-bridge-run code').forEach(el => {
        el.textContent = 'cd ' + s.rootDir + '\nnode claude-bridge.js';
      });
    }
  } catch (e) {}
}

let _bhInited = false;
function initBridgeHelpInteractions() {
  if (_bhInited) return;
  _bhInited = true;

  // OS tab switching inside bridge help panels
  $('bridgeHelpOverlay').addEventListener('click', (e) => {
    const tab = e.target.closest('.bh-os-tab');
    if (tab) {
      const group = tab.closest('[data-group]') ? tab.closest('[data-group]').dataset.group
        : tab.parentElement.dataset.group;
      const os = tab.dataset.os;
      // toggle tabs
      $('bridgeHelpOverlay').querySelectorAll(`.bh-os-tab[data-group="${group}"], .bh-os-tabs[data-group="${group}"] .bh-os-tab`).forEach(b => {
        b.classList.toggle('active', b.dataset.os === os);
      });
      // toggle panels
      $('bridgeHelpOverlay').querySelectorAll(`.bh-os-panel[data-group="${group}"]`).forEach(p => {
        p.classList.toggle('active', p.dataset.os === os);
      });
    }

    // copy buttons
    const copyBtn = e.target.closest('.bh-copy');
    if (copyBtn) {
      const code = copyBtn.previousElementSibling?.textContent || '';
      navigator.clipboard.writeText(code.trim()).then(() => {
        const orig = copyBtn.textContent;
        copyBtn.textContent = '✓';
        setTimeout(() => { copyBtn.textContent = orig; }, 1200);
      });
    }
  });
}

function closeBridgeHelp() {
  $('bridgeHelpOverlay').hidden = true;
}

function switchBridgeTab(tab) {
  activeBridgeTab = tab;
  [...$('bridgeHelpTabs').querySelectorAll('.stab')].forEach((b) => {
    b.classList.toggle('active', b.dataset.btab === tab);
  });
  $('bridgeHelpClaude').style.display = tab === 'claude' ? 'flex' : 'none';
  $('bridgeHelpAnthropic').style.display = tab === 'anthropic' ? 'flex' : 'none';
  $('bridgeHelpOpenAi').style.display = tab === 'openai' ? 'flex' : 'none';
}

$('health').addEventListener('click', openBridgeHelp);
$('bridgeHelpClose').addEventListener('click', closeBridgeHelp);
$('bridgeHelpDoneBtn').addEventListener('click', closeBridgeHelp);
$('bridgeHelpTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.stab');
  if (!btn) return;
  switchBridgeTab(btn.dataset.btab);
});
$('bridgeHelpOverlay').addEventListener('click', (e) => {
  if (e.target === $('bridgeHelpOverlay')) closeBridgeHelp();
});

// ---------- boot ----------
async function init() {
  // Load saved language first
  const savedLang = localStorage.getItem(LS.lang);
  if (savedLang) {
    currentLang = savedLang;
  }
  
  // Initialize language UI
  document.documentElement.dir = currentLang === 'fa' ? 'rtl' : 'ltr';
  document.documentElement.lang = currentLang;
  document.body.style.fontFamily = currentLang === 'fa' 
    ? "'Vazirmatn', system-ui, sans-serif" 
    : "'Inter', system-ui, sans-serif";
  $('langFa').classList.toggle('active', currentLang === 'fa');
  $('langEn').classList.toggle('active', currentLang === 'en');
  updateTranslations();

  await loadProjects();
  if (activeProjectId) await loadSessions();
  paintCachedBoard();
  await Promise.all([refreshActivity(), refreshState(), refreshModels()]);
  setInterval(refreshState, 5000);
  setInterval(refreshActivity, 5000);
  setInterval(refreshModels, 10000);
}
init();
