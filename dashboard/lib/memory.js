// Chained project memory — engine-independent context that travels across
// bridge switches (claude ↔ gemini ↔ aider/GapGPT).
//
// The memory lives as a plain markdown file (`.agent-memory.md`) at the root of
// the project's checkout. Because it's just text we prepend to every prompt and
// a file the agent can Read, whichever engine is active picks up the same
// accumulated context — switching the active bridge no longer loses the thread.
//
// It is the same file the auto-runner updates on stop (generateProgressReport),
// so manual agent/chat turns and the automatic loop share one running memory.
const fs = require('fs');
const path = require('path');

const FILE = '.agent-memory.md';
const MAX_BYTES = 24 * 1024; // keep the prompt cheap; trim oldest when over

function memoryPath(dir) {
  return path.join(dir, FILE);
}

function read(dir) {
  if (!dir) return '';
  try {
    return fs.readFileSync(memoryPath(dir), 'utf8');
  } catch (e) {
    return '';
  }
}

// Make sure the local memory file is never committed into the user's repo.
function ensureExclude(dir) {
  try {
    const ex = path.join(dir, '.git', 'info', 'exclude');
    if (!fs.existsSync(path.dirname(ex))) return; // not a git checkout
    let cur = '';
    try { cur = fs.readFileSync(ex, 'utf8'); } catch (e) {}
    if (!cur.split('\n').some((l) => l.trim() === FILE)) {
      fs.appendFileSync(ex, (cur && !cur.endsWith('\n') ? '\n' : '') + FILE + '\n');
    }
  } catch (e) {}
}

function write(dir, text) {
  if (!dir) return;
  try {
    let body = String(text || '');
    if (Buffer.byteLength(body, 'utf8') > MAX_BYTES) {
      body = body.slice(-MAX_BYTES); // keep the most recent tail
    }
    fs.writeFileSync(memoryPath(dir), body);
    ensureExclude(dir);
  } catch (e) {}
}

// Overwrite the memory with a fresh snapshot (used by the stop/progress report).
function sync(dir, text) {
  if (!dir || !text) return;
  const header = '# حافظه‌ی پروژه (به‌روزرسانی خودکار هنگام توقف)\n\n';
  write(dir, header + String(text).trim() + '\n');
}

// Append a short, timestamped entry — the running chain of "what happened".
function append(dir, label, note) {
  if (!dir || !note) return;
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const entry = '\n## ' + stamp + ' · ' + (label || 'note') + '\n' + String(note).trim() + '\n';
  const cur = read(dir);
  write(dir, (cur ? cur.trimEnd() + '\n' : '# حافظه‌ی پروژه\n') + entry);
}

// Prompt-prependable block: hands the current memory to whichever engine runs,
// and asks it to keep the file current so the chain survives a bridge switch.
function contextBlock(dir) {
  const cur = read(dir).trim();
  const head =
    '🧠 حافظه‌ی زنجیروار پروژه — این متن از فایل `' + FILE + '` در ریشه‌ی پروژه آمده و مستقل از موتور (claude/gemini/...) است. ' +
    'اول آن را بخوان تا کار را منسجم ادامه دهی، و در پایانِ کار خلاصه‌ی تغییرات/تصمیم‌ها را در همان فایل به‌روزرسانی کن.';
  if (!cur) {
    return '\n\n' + head + '\n(فایل حافظه هنوز خالی است؛ این اولین گام است.)\n';
  }
  return '\n\n' + head + '\n\n--- محتوای فعلی حافظه ---\n' + cur + '\n--- پایان حافظه ---\n';
}

module.exports = { memoryPath, read, write, sync, append, contextBlock, ensureExclude, FILE };
