// Central config, built from secrets.env via settings.js. The exported `config`
// object keeps a stable reference and is mutated in place by reload(), so other
// modules read fresh values after the Settings panel saves (no restart needed).
const settings = require('./settings');

const config = {};

function reload() {
  const v = settings.parseFile();
  config.trello = {
    key: v.TRELLO_KEY,
    token: v.TRELLO_TOKEN,
    board: v.TRELLO_BOARD_ID,
    lists: {
      todo: v.TRELLO_LIST_TODO,
      prog: v.TRELLO_LIST_INPROGRESS,
      wait: v.TRELLO_LIST_WAITING,
      review: v.TRELLO_LIST_INREVIEW,
      owner: v.TRELLO_LIST_OWNER,
    },
  };
  config.github = { token: v.GITHUB_TOKEN };
  config.bale = { token: v.BALE_BOT_TOKEN, ownerChat: v.OWNER_CHAT };
  config.bridge = process.env.CLAUDE_BRIDGE || 'http://localhost:8787';
  config.port = Number(process.env.DASH_PORT || 8090);
  config.configured = settings.isConfigured(v);
  return config;
}

reload();

// Persian column metadata (order = left→right; with RTL the first sits on the right).
const COLUMNS = [
  { key: 'todo', name: 'در صف', emoji: '📋' },
  { key: 'prog', name: 'در حال انجام', emoji: '⚙️' },
  { key: 'wait', name: 'منتظر API', emoji: '⏳' },
  { key: 'review', name: 'در حال ریویو', emoji: '👀' },
  { key: 'owner', name: 'تمام‌شده', emoji: '✅' },
];

module.exports = { config, reload, COLUMNS };
