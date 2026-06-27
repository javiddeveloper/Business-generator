// File-based persistence for projects, chat sessions, messages and the per-project
// board (tasks) cache. Zero-dependency: plain fs + crypto.randomUUID. This is the
// single source of truth on disk, so chats / project names / tasks survive restarts
// and project switches. Everything lives under <repo>/data (gitignored).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, 'data');
const PROJECTS_FILE = path.join(DATA, 'projects.json');

const id = () => crypto.randomUUID();
const now = () => Date.now();
// normalize github repo input to "owner/name" (drops scheme + .git)
// OR preserve absolute local paths starting with '/', 'C:\', '~', etc.
const normRepo = (u) => {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^([a-zA-Z]:[/\\]|\\\\|\/|~)/.test(s)) return s;
  return s.replace(/\.git$/, '').replace(/^https?:\/\/github\.com\//i, '').replace(/^github\.com\//i, '');
};

// ---- low-level json io (atomic write: tmp + rename) ----------------------
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

const projectDir = (pid) => path.join(DATA, 'projects', pid);
const sessionsFile = (pid) => path.join(projectDir(pid), 'sessions.json');
const messagesFile = (pid, sid) => path.join(projectDir(pid), 'messages', sid + '.json');
const boardFile = (pid) => path.join(projectDir(pid), 'board.json');
const tasksFile = (pid) => path.join(projectDir(pid), 'tasks.json');
const reportFile = (pid) => path.join(projectDir(pid), 'report.json');

// ---- projects ------------------------------------------------------------
function listProjects() {
  return readJson(PROJECTS_FILE, []).filter((p) => !p.archived);
}
function getProject(pid) {
  return readJson(PROJECTS_FILE, []).find((p) => p.id === pid) || null;
}
function createProject(name, repo) {
  const all = readJson(PROJECTS_FILE, []);
  const p = { id: id(), name: String(name || '').trim() || 'پروژه‌ی بی‌نام', repo: normRepo(repo), createdAt: now(), updatedAt: now(), archived: false };
  all.push(p);
  writeJson(PROJECTS_FILE, all);
  // every project starts with one chat so the UI is never empty
  createSession(p.id, 'چت اصلی');
  return p;
}
function updateProject(pid, patch) {
  const all = readJson(PROJECTS_FILE, []);
  const p = all.find((x) => x.id === pid);
  if (!p) return null;
  if (patch.name != null) p.name = String(patch.name).trim() || p.name;
  if (patch.repo != null) p.repo = normRepo(patch.repo);
  if (patch.archived != null) p.archived = !!patch.archived;
  if (patch.branch != null) p.branch = String(patch.branch).trim() || p.branch;
  if (patch.autoMode != null) p.autoMode = !!patch.autoMode;
  p.updatedAt = now();
  writeJson(PROJECTS_FILE, all);
  return p;
}

// ---- sessions ------------------------------------------------------------
function listSessions(pid) {
  return readJson(sessionsFile(pid), []);
}
function createSession(pid, title) {
  const all = readJson(sessionsFile(pid), []);
  const s = { id: id(), title: String(title || '').trim() || 'چت ' + (all.length + 1), createdAt: now(), updatedAt: now() };
  all.push(s);
  writeJson(sessionsFile(pid), all);
  writeJson(messagesFile(pid, s.id), []);
  return s;
}
function updateSession(pid, sid, patch) {
  const all = readJson(sessionsFile(pid), []);
  const s = all.find((x) => x.id === sid);
  if (!s) return null;
  if (patch.title != null) s.title = String(patch.title).trim() || s.title;
  s.updatedAt = now();
  writeJson(sessionsFile(pid), all);
  return s;
}
function deleteSession(pid, sid) {
  const all = readJson(sessionsFile(pid), []).filter((x) => x.id !== sid);
  writeJson(sessionsFile(pid), all);
  try { fs.unlinkSync(messagesFile(pid, sid)); } catch {}
  return true;
}
function touchSession(pid, sid) {
  const all = readJson(sessionsFile(pid), []);
  const s = all.find((x) => x.id === sid);
  if (s) { s.updatedAt = now(); writeJson(sessionsFile(pid), all); }
}

// ---- messages ------------------------------------------------------------
function readMessages(pid, sid) {
  return readJson(messagesFile(pid, sid), []);
}
function appendMessage(pid, sid, ev) {
  const all = readJson(messagesFile(pid, sid), []);
  const full = { id: ev.id || (now() + '-' + Math.random().toString(36).slice(2, 7)), ts: ev.ts || now(), ...ev };
  all.push(full);
  if (all.length > 500) all.splice(0, all.length - 500); // cap history per session
  writeJson(messagesFile(pid, sid), all);
  touchSession(pid, sid);
  return full;
}

// ---- board (tasks) cache -------------------------------------------------
function readBoard(pid) {
  return readJson(boardFile(pid), null);
}
function writeBoard(pid, snapshot) {
  writeJson(boardFile(pid), { ...snapshot, ts: now() });
}

// ---- tasks (canonical, per project) --------------------------------------
// The project's own task list is the source of truth on disk. Trello is kept
// in sync from this file (cards are recreated on a project switch if missing),
// so each project always shows its own tasks even on a fresh/shared board.
// Shape: [{ id, cardId, title, desc, track, complexity, column, createdAt }]
function readTasks(pid) {
  return readJson(tasksFile(pid), []);
}
function writeTasks(pid, tasks) {
  writeJson(tasksFile(pid), Array.isArray(tasks) ? tasks : []);
}
function addTask(pid, task) {
  const all = readTasks(pid);
  const full = {
    id: task.id || id(),
    cardId: task.cardId || null,
    title: String(task.title || '').trim(),
    desc: task.desc || '',
    track: task.track || 'backend',
    complexity: task.complexity || 'medium',
    column: task.column || 'todo',
    createdAt: now(),
  };
  all.push(full);
  writeTasks(pid, all);
  return full;
}
function updateTask(pid, taskId, patch) {
  const all = readTasks(pid);
  const tk = all.find((x) => x.id === taskId);
  if (!tk) return null;
  Object.assign(tk, patch);
  writeTasks(pid, all);
  return tk;
}

// ---- progress report (per project) --------------------------------------
// Written by the Product Owner when auto-run is stopped ("how far did we get,
// what's left"); read back by the Developer/Tech-Lead on the next run so work
// continues with full context. Shape: { text, ts }.
function readReport(pid) {
  return readJson(reportFile(pid), null);
}
function writeReport(pid, report) {
  writeJson(reportFile(pid), { text: String((report && report.text) || ''), ts: now() });
}

// ---- bootstrap -----------------------------------------------------------
// Guarantee at least one project exists so the UI has something to open.
function bootstrap(defaultRepo) {
  const all = readJson(PROJECTS_FILE, []);
  if (all.length) return listProjects();
  const repo = String(defaultRepo || '').trim();
  const name = repo ? repo.split('/').pop() : 'پروژه‌ی پیش‌فرض';
  createProject(name, repo);
  return listProjects();
}

module.exports = {
  DATA,
  listProjects, getProject, createProject, updateProject,
  listSessions, createSession, updateSession, deleteSession,
  readMessages, appendMessage,
  readBoard, writeBoard,
  readTasks, writeTasks, addTask, updateTask,
  readReport, writeReport,
  bootstrap,
};
