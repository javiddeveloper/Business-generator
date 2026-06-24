// In-memory activity log (a ring buffer). Powers the SOLO-style chat timeline
// with events the dashboard itself originates (commands, results). Trello card
// comments are merged in at read time by the server.
const MAX = 200;
const buf = [];

// role: 'user' (you) | 'agent' (the system) | 'system' (status/errors)
function push(role, text, meta = {}) {
  const ev = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), ts: Date.now(), role, text, ...meta };
  buf.push(ev);
  if (buf.length > MAX) buf.shift();
  return ev;
}

function list() {
  return buf.slice();
}

module.exports = { push, list };
