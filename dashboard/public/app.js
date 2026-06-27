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
let composerMode = 'po'; // 'po' (Product Owner → tasks) | 'chat' (Q&A) | 'agent' (codes)
let pendingImagePath = null; // absolute path returned by /api/upload
let currentAutoMode = false; // when true, board tasks run via workflow → manual run disabled

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
    modelsTitle: "انتخاب مدل",
    modelsDesc: "موتور هوش مصنوعی فعال را انتخاب کن.",
    modelActive: "فعال",
    modelKindCli: "CLI",
    modelKindHttp: "API",
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
    cancel: "انصراف",
    confirmTitle: "تأیید",
    confirmOk: "تأیید",
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
    bridgeStep3: "وارد کردن API Key در تنظیمات",
    checkout: "رفتن روی برنچ",
    connectGit: "اتصال به گیت‌هاب",
    connectGitDesc: "این پوشه هنوز به گیت‌هاب متصل نیست. آدرس ریپوی گیت‌هاب را وارد کن تا کانکت و پوش بشه.",
    gitUrlPlaceholder: "owner/repo یا https://github.com/owner/repo",
    connectAndPush: "اتصال و پوش",
    modeCommand: "دستور",
    modeChat: "چت",
    modeAgent: "Agent",
    imageAttach: "تصویر دیزاین",
    imageRemove: "حذف تصویر",
    agentPushLabel: "پوش بعد از کد",
    chatToolHint: "پرسش از مدل · بدون تغییر فایل",
    modePo: "محصول",
    poToolHint: "Product Owner درخواستت را به تسک تبدیل می‌کند",
    modeHelp_po: "با Product Owner چت کن؛ او یا جواب می‌دهد یا درخواست‌ها را به تسک تبدیل می‌کند. ریپو از قبل معلوم است.",
    modeHelp_command: "دستورهای ساختاریافته: گزارش و مدل را اجرا می‌کند.",
    modeHelp_chat: "گفتگوی آزاد با مدل برای پرسش و مشورت. هیچ فایلی تغییر نمی‌کند.",
    modeHelp_agent: "مدل روی کد پروژه (برنچ فعلی) کار می‌کند: فایل می‌خواند، تغییر می‌دهد و در صورت فعال‌بودن پوش، کامیت و پوش می‌کند.",
    placeholder_po: "چی بسازیم؟ بنویس…",
    placeholder_command: "یک دستور بفرست… (‏/report / ‏/model)",
    placeholder_chat: "یک سؤال بپرس…",
    placeholder_agent: "به agent بگو روی کد چه کاری انجام دهد…",
    sendCommand: "یک دستور بفرست…",
    chatPlaceholder: "چی بسازیم؟ بنویس…",
    chatLead: "با Product Owner چت کن؛ او درخواست‌ها را به تسک تبدیل می‌کند.",
    copy: "کپی",
    copied: "کپی شد",
    execStart: "شروع اجرای خودکار",
    execStop: "توقف اجرای خودکار",
    execHintOn: "▶️ اجرای خودکار روشن است — تسک‌ها خودکار اجرا، ریویو و در develop مرج می‌شوند. اجرای دستی قفل است.",
    execHintOff: "اجرای دستی فعال است. برای سپردن کامل اجرا به سیستم، «شروع اجرای خودکار» را بزن.",
    execConfirmOn: "از این پس تسک‌های این پروژه به‌صورت خودکار اجرا، ریویو و به develop مرج می‌شوند (روی گیت‌هاب واقعی). ادامه می‌دهی؟",
    execConfirmOff: "اجرای خودکار متوقف می‌شود؛ از این پس تسک‌ها فقط دستی اجرا می‌شوند. ادامه می‌دهی؟",
    autoMode: "حالت خودکار",
    autoHintOn: "🔒 تسک‌ها خودکار توسط ورک‌فلو اجرا می‌شوند. اجرای دستی غیرفعال است.",
    autoHintOff: "اجرای دستی فعال است. برای سپردن اجرا به ورک‌فلو، روشن کن.",
    autoLocked: "🔒 حالت خودکار روشن است — اجرای دستی غیرفعال"
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
    modelsTitle: "Select Model",
    modelsDesc: "Choose the active AI engine.",
    modelActive: "Active",
    modelKindCli: "CLI",
    modelKindHttp: "API",
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
    cancel: "Cancel",
    confirmTitle: "Confirm",
    confirmOk: "Confirm",
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
    bridgeStep3: "Enter your API Key in settings",
    checkout: "Checkout",
    connectGit: "Connect to GitHub",
    connectGitDesc: "This folder is not connected to GitHub yet. Enter the GitHub repo URL to connect and push.",
    gitUrlPlaceholder: "owner/repo or https://github.com/owner/repo",
    connectAndPush: "Connect & Push",
    modeCommand: "Command",
    modeChat: "Chat",
    modeAgent: "Agent",
    imageAttach: "Design image",
    imageRemove: "Remove image",
    agentPushLabel: "Push after code",
    chatToolHint: "Ask the model — no files change",
    modePo: "Product Owner",
    poToolHint: "Product Owner turns your request into tasks",
    modeHelp_po: "Chat with the Product Owner — it answers or breaks your request into tasks. The repo is already known.",
    modeHelp_command: "Structured commands: run reports and switch models.",
    modeHelp_chat: "Free chat with the model for questions and planning. No files are changed.",
    modeHelp_agent: "The model works on your project code (current branch): reads, edits files, and commits & pushes if push is on.",
    placeholder_po: "What should we build? Type here…",
    placeholder_command: "Send a command… (/report / /model)",
    placeholder_chat: "Ask a question…",
    placeholder_agent: "Tell the agent what to do with the code…",
    sendCommand: "Send a command…",
    chatPlaceholder: "What should we build? Type here…",
    chatLead: "Chat with the Product Owner — it turns your requests into tasks.",
    copy: "Copy",
    copied: "Copied",
    execStart: "Start auto-run",
    execStop: "Stop auto-run",
    execHintOn: "▶️ Auto-run is on — tasks are executed, reviewed and merged to develop automatically. Manual run is locked.",
    execHintOff: "Manual run is on. Hit “Start auto-run” to hand execution fully to the system.",
    execConfirmOn: "From now on this project's tasks will be executed, reviewed and merged to develop automatically (on real GitHub). Continue?",
    execConfirmOff: "Auto-run will stop; from now on tasks run only manually. Continue?",
    autoMode: "Auto mode",
    autoHintOn: "🔒 Tasks run automatically via the workflow. Manual run is disabled.",
    autoHintOff: "Manual run is on. Turn on to let the workflow run tasks.",
    autoLocked: "🔒 Auto mode is on — manual run disabled"
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
let activeEngineKind = ''; // 'cli' | 'http' — agent streaming is CLI-only
let currentStreamAbort = null; // AbortController for an in-flight agent stream
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
// Compact absolute stamp shown inside each chat bubble: "MM/DD HH:MM" (localized digits).
function fmtStamp(ts) {
  const d = new Date(typeof ts === 'string' ? new Date(ts).getTime() : ts);
  const p2 = (n) => String(n).padStart(2, '0');
  return faNum(p2(d.getMonth() + 1) + '/' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()));
}
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ---------- inline SVG icons (consistent feather-style across the app) ----------
// Returns a <span> wrapper holding a stroked 24×24 SVG built from `inner` paths.
function svgIcon(inner, size = 15, cls) {
  const span = document.createElement('span');
  span.className = 'svg-ic' + (cls ? ' ' + cls : '');
  span.innerHTML =
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    inner + '</svg>';
  return span;
}

// Board column icons, keyed by column.key (replaces the old emoji column glyphs).
const COLUMN_ICONS = {
  todo: '<rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 4H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/>',
  prog: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  wait: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  review: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  owner: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
};
const COLUMN_ICON_FALLBACK = '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>';
// Card counter icons (replace 🔴 bug / 🛠️ fix glyphs).
const ICON_BUG = '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
const ICON_FIX = '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>';
// Per-engine icons for the model picker (id → svg inner).
const MODEL_ICONS = {
  'claude-pro': '<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18"/>',
  gemini: '<circle cx="12" cy="12" r="1"/><path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5z"/><path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5z"/>',
  gapgpt: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  ollama: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
};
const MODEL_ICON_FALLBACK = '<path d="M12 2a5 5 0 0 1 5 5v1a5 5 0 0 1-5 5a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5z"/><path d="M9 17v1a3 3 0 0 0 6 0v-1"/><path d="M6.3 16.8A7 7 0 0 1 5 12"/><path d="M17.7 16.8A7 7 0 0 0 19 12"/>';

// ---------- styled confirm / alert (replaces native browser dialogs) ----------
let _confirmResolve = null;
function _closeConfirm(result) {
  const ov = document.getElementById('confirmOverlay');
  if (ov) ov.hidden = true;
  const r = _confirmResolve;
  _confirmResolve = null;
  if (r) r(result);
}
// returns a Promise<boolean>; opts: { title, okLabel, cancelLabel, danger, alert }
function showConfirm(message, opts = {}) {
  return new Promise((resolve) => {
    // if a previous dialog is open, cancel it first
    if (_confirmResolve) _closeConfirm(false);
    _confirmResolve = resolve;
    const ov = document.getElementById('confirmOverlay');
    document.getElementById('confirmTitle').textContent = opts.title || t('confirmTitle');
    document.getElementById('confirmMessage').textContent = message;
    const ok = document.getElementById('confirmOk');
    ok.textContent = opts.okLabel || t('confirmOk');
    ok.classList.toggle('danger', !!opts.danger);
    const cancel = document.getElementById('confirmCancel');
    // alert mode: a single OK button, no cancel
    cancel.style.display = opts.alert ? 'none' : '';
    cancel.textContent = opts.cancelLabel || t('cancel');
    ov.hidden = false;
    ok.focus();
  });
}
const showAlert = (message, opts = {}) => showConfirm(message, { ...opts, alert: true });

(function initConfirm() {
  const ov = document.getElementById('confirmOverlay');
  if (!ov) return;
  document.getElementById('confirmOk').addEventListener('click', () => _closeConfirm(true));
  document.getElementById('confirmCancel').addEventListener('click', () => _closeConfirm(false));
  ov.addEventListener('click', (e) => { if (e.target === ov) _closeConfirm(false); });
  document.addEventListener('keydown', (e) => {
    if (ov.hidden) return;
    if (e.key === 'Escape') _closeConfirm(false);
    else if (e.key === 'Enter') _closeConfirm(true);
  });
})();
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
  const active = currentProjects.find((p) => p.id === activeProjectId);
  $('projectName').textContent = active ? active.name : '—';
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
  const active = currentSessions.find((s) => s.id === activeSessionId);
  $('sessionName').textContent = active ? active.title : '—';
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
  // sync the canonical tasks file → Trello so this project always shows its own tasks
  await Promise.all([refreshActivity(), refreshState(true)]);
  if (activeMainTab === 'repo') refreshRepo();
}

async function selectSession(sid) {
  if (busy || sid === activeSessionId) return;
  activeSessionId = sid;
  localStorage.setItem(LS.sess(activeProjectId), sid);
  renderSessions(); // keep the chip label in sync when called programmatically
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
  if (!(await showConfirm(t('deleteProjectConfirm'), { danger: true, okLabel: t('delete') }))) return;
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
  if (!(await showConfirm(t('deleteChatConfirm'), { danger: true, okLabel: t('delete') }))) return;
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

// project / session names are now dialog-opening chips (lists live in modals)
$('projectSelect').addEventListener('click', openProjects);
$('sessionSelect').addEventListener('click', openSessions);
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
    if (await showConfirm(autoMsg, { danger: true, okLabel: t('delete') })) {
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
  // git connect button for local repos without a remote
  if (isLocal && r.needsGitConnect) {
    const connectWrap = el('div', 'repo-connect-wrap');
    const connectBtn = el('button', 'send', '🔗 ' + t('connectGit'));
    connectBtn.addEventListener('click', () => showGitConnectDialog(r.dir));
    connectWrap.appendChild(connectBtn);
    box.appendChild(connectWrap);
  }

  const list = el('div', 'branch-list');
  for (const b of branches) {
    const row = el('div', 'branch-row');
    const isCur = b === r.current;
    const isDef = b === r.defaultBranch;
    row.appendChild(el('span', 'branch-name' + (isCur ? ' current' : ''), b));
    if (isCur) row.appendChild(el('span', 'branch-tag cur', t('current')));
    if (isDef) row.appendChild(el('span', 'branch-tag def', t('default')));
    if (!isCur && r.cloned) {
      const coBtn = el('button', 'mini-btn', t('checkout'));
      coBtn.addEventListener('click', async () => {
        coBtn.disabled = true;
        coBtn.textContent = '…';
        try {
          const res = await api('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: activeProjectId, branch: b }),
          });
          if (res && res.ok) renderRepo(res);
          else { coBtn.disabled = false; coBtn.textContent = t('checkout'); showAlert(t('error') + (res && res.error || '')); }
        } catch (e) { coBtn.disabled = false; coBtn.textContent = t('checkout'); }
      });
      row.appendChild(coBtn);
    }
    list.appendChild(row);
  }
  box.appendChild(list);
}

function showGitConnectDialog(localDir) {
  // Reuse the app's standard modal shell (overlay → modal → head/body/foot) so
  // this dialog looks and behaves like the model/settings pickers instead of the
  // old unstyled settings-overlay/settings-box (which had no CSS and broke layout).
  const overlay = el('div', 'modal-overlay');
  overlay.id = 'gitConnectOverlay';
  const modal = el('div', 'modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const head = el('div', 'modal-head');
  const htext = el('div');
  htext.appendChild(el('h2', null, '🔗 ' + t('connectGit')));
  htext.appendChild(el('p', 'modal-sub', t('connectGitDesc')));
  const closeX = el('button', 'modal-close', '✕');
  closeX.title = t('close');
  closeX.addEventListener('click', () => overlay.remove());
  head.appendChild(htext);
  head.appendChild(closeX);

  const bodyEl = el('div', 'modal-body');
  const inp = el('input', 'field-input');
  inp.placeholder = t('gitUrlPlaceholder');
  inp.dir = 'ltr';
  const errDiv = el('div', 'repo-err');
  errDiv.style.display = 'none';
  bodyEl.appendChild(inp);
  bodyEl.appendChild(errDiv);

  const foot = el('div', 'modal-foot');
  const cancelBtn = el('button', 'mini-btn', t('close'));
  cancelBtn.addEventListener('click', () => overlay.remove());
  const submitBtn = el('button', 'send', t('connectAndPush'));
  const doSubmit = async () => {
    const url = inp.value.trim();
    if (!url) return;
    submitBtn.disabled = true;
    submitBtn.textContent = t('running');
    errDiv.style.display = 'none';
    try {
      const res = await api('/api/repo/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: activeProjectId, remoteUrl: url }),
      });
      if (res && res.ok) { overlay.remove(); renderRepo(res); }
      else { errDiv.textContent = t('error') + (res && res.error || ''); errDiv.style.display = 'block'; submitBtn.disabled = false; submitBtn.textContent = t('connectAndPush'); }
    } catch (e) { errDiv.textContent = e.message; errDiv.style.display = 'block'; submitBtn.disabled = false; submitBtn.textContent = t('connectAndPush'); }
  };
  submitBtn.addEventListener('click', doSubmit);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSubmit(); });
  foot.appendChild(cancelBtn);
  foot.appendChild(submitBtn);

  modal.appendChild(head);
  modal.appendChild(bodyEl);
  modal.appendChild(foot);
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  inp.focus();
}

$('mainTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.mtab');
  if (!btn || !btn.dataset.mtab) return;
  switchMainTab(btn.dataset.mtab);
});

// ---------- state / board ----------
async function refreshState(sync) {
  if (!activeProjectId) return;
  let s;
  try {
    // sync=1 → server reads this project's canonical tasks file and (re)creates
    // any missing Trello cards before building the board (used on project switch).
    s = await api('/api/state?projectId=' + encodeURIComponent(activeProjectId) + (sync ? '&sync=1' : ''));
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

  // auto mode: reflect the project's stored flag on the Play/Stop button + hint
  currentAutoMode = !!(s.project && s.project.autoMode);
  renderExecButton();

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

// ---------- model picker (modal, styled like the other pickers) ----------
let modelsData = { models: [], active: '' };

function modelIcon(id, size = 15) {
  return svgIcon(MODEL_ICONS[id] || MODEL_ICON_FALLBACK, size, 'model-ic-svg');
}

async function refreshModels() {
  let data;
  try {
    data = await api('/api/models');
  } catch (e) {
    return;
  }
  modelsData = data || { models: [], active: '' };
  const am = (modelsData.models || []).find((m) => m.id === modelsData.active);
  activeEngineKind = am ? am.kind : '';
  // update the header chip (icon + name)
  const icon = $('modelPickIcon');
  const name = $('modelPickName');
  if (icon) { icon.innerHTML = ''; icon.appendChild(modelIcon(am ? am.id : '', 14)); }
  if (name) name.textContent = am ? am.label : '—';
  // if the modal is open, keep its list in sync
  if (!$('modelOverlay').hidden) renderModelList();
}

function renderModelList() {
  const list = $('modelList');
  if (!list) return;
  list.innerHTML = '';
  const models = modelsData.models || [];
  if (!models.length) {
    list.appendChild(el('div', 'empty', t('bridgeOffline')));
    return;
  }
  for (const m of models) {
    const active = m.id === modelsData.active;
    const row = el('button', 'model-row' + (active ? ' active' : ''));
    row.type = 'button';
    const ic = modelIcon(m.id, 18);
    row.appendChild(ic);
    const info = el('div', 'model-row-info');
    info.appendChild(el('span', 'model-row-name', m.label));
    info.appendChild(el('span', 'model-row-kind', m.kind === 'cli' ? t('modelKindCli') : t('modelKindHttp')));
    row.appendChild(info);
    if (active) {
      const badge = el('span', 'model-row-badge');
      badge.appendChild(svgIcon('<polyline points="20 6 9 17 4 12"/>', 13));
      badge.appendChild(el('span', null, t('modelActive')));
      row.appendChild(badge);
    }
    row.addEventListener('click', () => selectModel(m.id));
    list.appendChild(row);
  }
}

async function selectModel(id) {
  if (id === modelsData.active) { closeModelModal(); return; }
  modelsData.active = id; // optimistic
  renderModelList();
  try {
    await api('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  } catch (err) {}
  closeModelModal();
  await refreshModels();
  refreshState();
}

function openModelModal() {
  renderModelList();
  $('modelOverlay').hidden = false;
}
function closeModelModal() {
  $('modelOverlay').hidden = true;
}
$('modelPick').addEventListener('click', openModelModal);
$('modelClose').addEventListener('click', closeModelModal);
$('modelOverlay').addEventListener('click', (e) => { if (e.target === $('modelOverlay')) closeModelModal(); });

function renderBoard(columns) {
  const board = $('board');
  board.innerHTML = '';
  let total = 0;
  for (const col of columns) {
    total += col.cards.length;
    const c = el('div', 'column');
    const head = el('div', 'col-head');
    const headLabel = el('span', 'col-head-label');
    headLabel.appendChild(svgIcon(COLUMN_ICONS[col.key] || COLUMN_ICON_FALLBACK, 15, 'col-ic col-ic-' + col.key));
    headLabel.appendChild(el('span', null, col.name));
    head.appendChild(headLabel);
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
      if (card.bugs) {
        const cb = el('span', 'counter bug');
        cb.appendChild(svgIcon(ICON_BUG, 12));
        cb.appendChild(el('span', null, faNum(card.bugs)));
        meta.appendChild(cb);
      }
      if (card.fixes) {
        const cf = el('span', 'counter fix');
        cf.appendChild(svgIcon(ICON_FIX, 12));
        cf.appendChild(el('span', null, faNum(card.fixes)));
        meta.appendChild(cf);
      }
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

  // Auto mode: the workflow runs tasks — manual run is locked.
  if (currentAutoMode) {
    btn.disabled = true;
    btn.classList.add('locked');
    btn.innerHTML = '';
    btn.appendChild(el('span', 'lock-ico', '🔒'));
    btn.appendChild(document.createTextNode(' ' + cfg.label));
    msg.textContent = t('autoLocked');
    wrap.appendChild(btn);
    wrap.appendChild(msg);
    body.appendChild(wrap);
    return;
  }

  btn.addEventListener('click', async () => {
    if (!(await showConfirm(cfg.confirm))) return;
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
// true while a reply is being typed out, so the background poll doesn't repaint
// the timeline mid-animation (which is what made the typewriter look broken).
let animating = false;

// A ChatGPT-style copy button that copies `getText()` to the clipboard.
function makeCopyBtn(getText) {
  const btn = el('button', 'copy-btn');
  btn.type = 'button';
  btn.title = t('copy');
  btn.innerHTML =
    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
    '<span class="copy-lbl">' + t('copy') + '</span>';
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(getText());
      btn.classList.add('done');
      btn.querySelector('.copy-lbl').textContent = t('copied');
      setTimeout(() => { btn.classList.remove('done'); const l = btn.querySelector('.copy-lbl'); if (l) l.textContent = t('copy'); }, 1400);
    } catch (err) {}
  });
  return btn;
}

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

    const bubble = el('div', 'bubble');
    bubble.setAttribute('dir', 'auto');
    // role + timestamp live inside the bubble now (compact, frees vertical space)
    const meta = el('div', 'bubble-meta');
    meta.appendChild(el('span', 'meta-who', ROLE_LABEL[ev.role] ? ROLE_LABEL[ev.role]() : t('system')));
    bubble.appendChild(meta);
    if (ev.card) bubble.appendChild(el('span', 'card-ref', t('cardRef') + ev.card + (ev.column ? ' · ' + ev.column : '')));
    if (ev.text) {
      const md = el('div', 'md-body');
      md.innerHTML = typeof marked !== 'undefined'
        ? marked.parse(ev.text, { breaks: true, gfm: true })
        : ev.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
      md.querySelectorAll('pre').forEach(pre => {
        const btn = document.createElement('button');
        btn.className = 'code-copy-btn';
        btn.textContent = 'copy';
        btn.onclick = () => {
          const code = pre.querySelector('code');
          navigator.clipboard.writeText(code ? code.innerText : pre.innerText);
          btn.textContent = 'copied!';
          setTimeout(() => { btn.textContent = 'copy'; }, 1500);
        };
        pre.appendChild(btn);
      });
      bubble.appendChild(md);
    }
    // copy button on model/system replies (not on the user's own messages)
    if (ev.role !== 'user' && ev.text) bubble.appendChild(makeCopyBtn(() => ev.text));
    const tm = el('div', 'bubble-time', fmtStamp(ev.ts));
    tm.title = timeAgo(ev.ts);
    bubble.appendChild(tm);
    m.appendChild(bubble);
    tl.appendChild(m);
  }
  if (atBottom) tl.scrollTop = tl.scrollHeight;
}

async function refreshActivity() {
  if (!activeProjectId || !activeSessionId) return;
  if (animating) return; // don't repaint mid-typewriter
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

// Show an animated "model is responding" bubble at the end of the timeline.
function showTypingBubble() {
  const tl = $('timeline');
  const m = el('div', 'msg agent', '');
  m.id = 'typingBubble';
  const bubble = el('div', 'bubble');
  const meta = el('div', 'bubble-meta');
  meta.appendChild(el('span', 'meta-who', t('system')));
  bubble.appendChild(meta);
  const dots = el('div', 'typing-dots');
  dots.appendChild(el('span')); dots.appendChild(el('span')); dots.appendChild(el('span'));
  bubble.appendChild(dots);
  m.appendChild(bubble);
  tl.appendChild(m);
  tl.scrollTop = tl.scrollHeight;
}
function removeTypingBubble() {
  const b = $('typingBubble');
  if (b) b.remove();
}

// Reveal `text` into a fresh agent bubble.
//
// The old char-by-char typewriter (a 18ms setInterval re-slicing a growing
// string and forcing layout ~200×) locked the UI for seconds and, on bigger
// replies, read as a freeze with nothing visible until it finished. We now
// render the markdown in a single paint with a short CSS fade-in instead — the
// "is thinking" phase is already covered by the typing-dots bubble during the
// network wait. Kept async so callers can `await` it unchanged.
function typeOutReply(text) {
  return new Promise((resolve) => {
    const tl = $('timeline');
    const atBottom = tl.scrollHeight - tl.scrollTop - tl.clientHeight < 100;
    const m = el('div', 'msg agent');
    const bubble = el('div', 'bubble reply-in');
    bubble.setAttribute('dir', 'auto');
    const meta = el('div', 'bubble-meta');
    meta.appendChild(el('span', 'meta-who', t('system')));
    bubble.appendChild(meta);
    const full = String(text || '');
    const md = el('div', 'md-body');
    md.setAttribute('dir', 'auto');
    md.innerHTML = typeof marked !== 'undefined'
      ? marked.parse(full, { breaks: true, gfm: true })
      : full.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    md.querySelectorAll('pre').forEach((pre) => {
      const btn = document.createElement('button');
      btn.className = 'code-copy-btn';
      btn.textContent = 'copy';
      btn.onclick = () => {
        const code = pre.querySelector('code');
        navigator.clipboard.writeText(code ? code.innerText : pre.innerText);
        btn.textContent = 'copied!';
        setTimeout(() => { btn.textContent = 'copy'; }, 1500);
      };
      pre.appendChild(btn);
    });
    bubble.appendChild(md);
    bubble.appendChild(makeCopyBtn(() => full));
    bubble.appendChild(el('div', 'bubble-time', fmtStamp(Date.now())));
    m.appendChild(bubble);
    tl.appendChild(m);
    if (atBottom) tl.scrollTop = tl.scrollHeight;
    resolve();
  });
}

// Parse one raw SSE event block into { event, data } (mirror of the server's).
function parseClientSse(raw) {
  let event = 'message', dataStr = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
  }
  let data = {};
  try { data = JSON.parse(dataStr); } catch (e) {}
  return { event, data };
}

// Stream a mode=agent run into a live terminal bubble, then swap it for the
// markdown summary once `done` arrives. Persistence happens server-side, so the
// trailing refreshActivity() repaint reconciles with the stored messages.
async function streamAgent({ task, sid, push, imagePath }) {
  const tl = $('timeline');
  const m = el('div', 'msg agent');
  const bubble = el('div', 'bubble term-live');
  bubble.setAttribute('dir', 'ltr');
  const meta = el('div', 'bubble-meta');
  meta.appendChild(el('span', 'meta-who', t('system')));
  bubble.appendChild(meta);
  const term = el('div', 'term-body');
  bubble.appendChild(term);
  const caret = el('span', 'type-caret');
  bubble.appendChild(caret);
  bubble.appendChild(el('div', 'bubble-time', fmtStamp(Date.now())));
  m.appendChild(bubble);
  tl.appendChild(m);
  tl.scrollTop = tl.scrollHeight;

  const appendLines = (text) => {
    const atBottom = tl.scrollHeight - tl.scrollTop - tl.clientHeight < 120;
    for (const ln of String(text).split('\n')) {
      const line = el('div', 'term-line', ln);
      line.setAttribute('dir', 'auto');
      term.appendChild(line);
    }
    if (atBottom) tl.scrollTop = tl.scrollHeight;
  };

  const ac = new AbortController();
  currentStreamAbort = ac;
  let doneData = null, errMsg = '';
  try {
    const resp = await fetch('/api/agent-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, projectId: activeProjectId, sessionId: sid, push, imagePath }),
      signal: ac.signal,
    });
    if (!resp.ok || !resp.body) {
      const j = await resp.json().catch(() => ({}));
      errMsg = j.error || ('stream error ' + resp.status);
    } else {
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const ev = parseClientSse(buf.slice(0, idx));
          buf = buf.slice(idx + 2);
          if (ev.event === 'chunk') appendLines(ev.data.text || '');
          else if (ev.event === 'done') doneData = ev.data;
          else if (ev.event === 'error') errMsg = ev.data.error || 'error';
        }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') errMsg = e.message || 'stream error';
  }
  currentStreamAbort = null;
  caret.remove();

  if (doneData && (doneData.summary || '').trim()) {
    // Swap the live terminal for the rendered markdown summary.
    m.remove();
    await typeOutReply(doneData.summary);
  } else if (errMsg) {
    appendLines('⚠️ ' + errMsg);
    bubble.classList.add('term-error');
  }
}

async function send() {
  if (busy) return;
  const text = composer.value.trim();
  if (!text || !activeProjectId || !activeSessionId) return;
  const sid = activeSessionId;
  const imgPath = pendingImagePath;
  composer.value = '';
  autoGrow();
  clearImagePreview();
  lockUI(true);
  lastActivitySig = null;
  renderMessages([...(msgCache.get(sid) || []), { id: 't' + Date.now(), ts: Date.now(), role: 'user', text }]);

  // Slash power-commands always run through the command pipeline regardless of mode.
  const isCommand = /^\/(report|finish|done|models?|model|help|start)\b/.test(text);
  const mode = isCommand ? 'command' : composerMode;

  // loading state after every prompt
  showTypingBubble();

  // Real-time streaming for agent mode (CLI engines only). The terminal bubble
  // shows the agent's output live; non-CLI engines fall through to /api/agent.
  if (mode === 'agent' && activeEngineKind === 'cli') {
    removeTypingBubble();
    const push = !$('agentPush') || $('agentPush').checked;
    try { await streamAgent({ task: text, sid, push, imagePath: imgPath }); } catch (e) {}
    lockUI(false);
    lastActivitySig = null;
    await Promise.all([refreshActivity(), refreshState()]);
    return;
  }

  let res = null;
  try {
    if (mode === 'po') {
      // Product Owner: answers and/or breaks the request into tasks
      res = await api('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, projectId: activeProjectId, sessionId: sid }),
      });
    } else if (mode === 'chat') {
      // free Q&A with the model — no files change
      res = await api('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, projectId: activeProjectId, sessionId: sid, imagePath: imgPath }),
      });
    } else if (mode === 'agent') {
      // the model works on the project's code (current branch)
      const push = !$('agentPush') || $('agentPush').checked;
      res = await api('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: text, projectId: activeProjectId, sessionId: sid, push, imagePath: imgPath }),
      });
    } else {
      await api('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, projectId: activeProjectId, sessionId: sid }),
      });
    }
  } catch (e) {}

  removeTypingBubble();

  if (mode !== 'command') {
    const replyText = (res && (res.reply || res.summary)) || (res && res.error ? t('error') + res.error : '');
    if (replyText) await typeOutReply(replyText);
  }

  lockUI(false);
  lastActivitySig = null;
  await Promise.all([refreshActivity(), refreshState()]);
}
sendBtn.addEventListener('click', send);

// ---------- composer mode switching + image upload ----------
function clearImagePreview() {
  pendingImagePath = null;
  const prev = $('imagePreview');
  if (prev) { prev.hidden = true; prev.innerHTML = ''; }
}

function setComposerMode(mode) {
  composerMode = mode;
  document.querySelectorAll('#modeSwitch .mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('#composerTools .ctool').forEach((c) => { c.hidden = c.dataset.ctool !== mode; });
  $('modeHelp').textContent = t('modeHelp_' + mode);
  composer.placeholder = t('placeholder_' + mode);
  // image is only carried in chat & agent modes
  if (mode === 'po') clearImagePreview();
}

async function uploadImage(file) {
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = (e) => r(e.target.result); fr.readAsDataURL(file); });
  let res;
  try {
    res = await api('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: activeProjectId, ext, data: dataUrl }),
    });
  } catch (e) { return; }
  if (!res || !res.ok) return;
  pendingImagePath = res.path;
  const prev = $('imagePreview');
  prev.innerHTML = '';
  const img = el('img', 'img-thumb');
  img.src = dataUrl;
  const meta = el('span', 'img-name', file.name);
  const rm = el('button', 'img-remove', '✕');
  rm.title = t('imageRemove');
  rm.addEventListener('click', clearImagePreview);
  prev.appendChild(img);
  prev.appendChild(meta);
  prev.appendChild(rm);
  prev.hidden = false;
}

(function initComposer() {
  $('modeSwitch').addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (btn && btn.dataset.mode) setComposerMode(btn.dataset.mode);
  });
  const fileInput = $('imageFileInput');
  if (fileInput) {
    document.querySelectorAll('.img-trigger').forEach((b) => b.addEventListener('click', () => fileInput.click()));
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (file) await uploadImage(file);
    });
  }
  setComposerMode('po');
})();

// ---------- Play / Stop: automatic task execution ----------
// Reflect the project's autoMode on the Play/Stop button (icon, label, hint).
function renderExecButton() {
  const btn = $('execToggle');
  if (!btn) return;
  const on = currentAutoMode;
  btn.classList.toggle('running', on);
  $('execIco').innerHTML = on
    ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>'
    : '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
  $('execLabel').textContent = on ? t('execStop') : t('execStart');
  $('autoHint').textContent = on ? t('execHintOn') : t('execHintOff');
}

(function initExecToggle() {
  const btn = $('execToggle');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!activeProjectId) return;
    const turningOn = !currentAutoMode;
    // confirm dialog: tell the user execution becomes automatic / manual
    if (!(await showConfirm(turningOn ? t('execConfirmOn') : t('execConfirmOff'), { title: turningOn ? t('execStart') : t('execStop') }))) return;
    currentAutoMode = turningOn;
    renderExecButton();
    try {
      await api('/api/projects/' + encodeURIComponent(activeProjectId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoMode: turningOn }),
      });
    } catch (e) {}
    // re-render the board so the manual run buttons lock/unlock immediately
    if (lastState && lastState.columns) renderBoard(lastState.columns);

    // On STOP: the Product Owner writes a progress report ("how far / what's left").
    // It's stored per project so the Developer/Tech-Lead read it on the next Start.
    if (!turningOn && activeSessionId) {
      lockUI(true);
      showTypingBubble();
      let rep = null;
      try {
        rep = await api('/api/po-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: activeProjectId, sessionId: activeSessionId }),
        });
      } catch (e) {}
      removeTypingBubble();
      const txt = (rep && rep.report) || (rep && rep.error ? t('error') + rep.error : '');
      if (txt) await typeOutReply(txt);
      lockUI(false);
      lastActivitySig = null;
      await refreshActivity();
    }
  });
})();

async function stop() {
  // Abort a live agent stream locally too (so the reader unwinds immediately).
  if (currentStreamAbort) { try { currentStreamAbort.abort(); } catch (e) {} }
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
      // Tokens changed → bring the panel back up with the new tokens: refresh the
      // model picker and re-read projects / sessions / latest history from scratch.
      msgCache.clear();
      lastActivitySig = null;
      await loadProjects();
      if (activeProjectId) await loadSessions();
      await Promise.all([refreshModels(), refreshActivity(), refreshState(true)]);
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
  $('bridgeHelpOllama').style.display = tab === 'ollama' ? 'flex' : 'none';
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
