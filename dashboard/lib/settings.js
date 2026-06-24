// Read/write secrets.env from the dashboard, plus the field metadata that
// drives the Settings panel and the first-run onboarding.
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '..', 'secrets.env');

// Field definitions (order = render order). Persian labels for the UI.
const FIELDS = [
  // Trello
  { key: 'TRELLO_KEY', label: 'کلید API ترلو', group: 'Trello', required: true, secret: true, hint: 'trello.com/app-key' },
  { key: 'TRELLO_TOKEN', label: 'توکن ترلو', group: 'Trello', required: true, secret: true },
  { key: 'TRELLO_BOARD_ID', label: 'شناسه برد', group: 'Trello', required: true },
  { key: 'TRELLO_LIST_TODO', label: 'لیست To Do', group: 'Trello', required: true },
  { key: 'TRELLO_LIST_INPROGRESS', label: 'لیست In Progress', group: 'Trello', required: true },
  { key: 'TRELLO_LIST_WAITING', label: 'لیست Waiting API', group: 'Trello', required: true },
  { key: 'TRELLO_LIST_INREVIEW', label: 'لیست In Review', group: 'Trello', required: true },
  { key: 'TRELLO_LIST_OWNER', label: 'لیست Owner Review', group: 'Trello', required: true },
  // Bale
  { key: 'BALE_BOT_TOKEN', label: 'توکن ربات بله', group: 'بله', required: true, secret: true },
  { key: 'OWNER_CHAT', label: 'chat id شما', group: 'بله', required: true },
  // GitHub
  { key: 'GITHUB_TOKEN', label: 'توکن گیت‌هاب (repo + workflow)', group: 'گیت‌هاب', required: true, secret: true },
  // GapGPT (optional model provider — only needed if you switch to the GapGPT engine)
  { key: 'GAPGPT_API_KEY', label: 'کلید API گپ‌جی‌پی‌تی', group: 'GapGPT', required: false, secret: true, hint: 'فقط برای موتور GapGPT' },
  { key: 'GAPGPT_BASE_URL', label: 'آدرس پایه (اختیاری)', group: 'GapGPT', required: false, hint: 'پیش‌فرض: https://api.gapgpt.app/v1' },
];

const REQUIRED = FIELDS.filter((f) => f.required).map((f) => f.key);

function parseFile() {
  const out = {};
  let raw = '';
  try {
    raw = fs.readFileSync(ENV_PATH, 'utf8');
  } catch (e) {
    return out;
  }
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

function isConfigured(values) {
  const v = values || parseFile();
  return REQUIRED.every((k) => v[k] && String(v[k]).trim());
}

// Merge new values over existing and rewrite secrets.env (grouped + comments).
// Unknown keys already in the file are preserved at the bottom.
function write(newValues) {
  const cur = parseFile();
  const merged = { ...cur };
  for (const [k, v] of Object.entries(newValues || {})) {
    if (v == null) continue;
    merged[k] = String(v).trim();
  }

  const known = new Set(FIELDS.map((f) => f.key));
  const byGroup = {};
  for (const f of FIELDS) (byGroup[f.group] = byGroup[f.group] || []).push(f.key);

  let body = '# Managed by the dashboard Settings panel. Never commit this file.\n';
  for (const [group, keys] of Object.entries(byGroup)) {
    body += '\n# ---------- ' + group + ' ----------\n';
    for (const k of keys) body += k + '=' + (merged[k] || '') + '\n';
  }
  const extras = Object.keys(merged).filter((k) => !known.has(k));
  if (extras.length) {
    body += '\n# ---------- other ----------\n';
    for (const k of extras) body += k + '=' + (merged[k] || '') + '\n';
  }
  fs.writeFileSync(ENV_PATH, body);
  return merged;
}

module.exports = { ENV_PATH, FIELDS, REQUIRED, parseFile, isConfigured, write };
