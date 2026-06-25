// Activity log. Each command runs inside an AsyncLocalStorage context that names
// the active {projectId, sessionId, repo}; activity.push() then persists events to
// that session's file via the store. This lets owner.js keep calling push() with no
// signature change while events land in the right chat. Without a context (rare:
// background work) it falls back to a small in-memory ring buffer.
const { AsyncLocalStorage } = require('node:async_hooks');
const store = require('./store');

const als = new AsyncLocalStorage();

// fallback buffer for pushes that happen outside any session context
const MAX = 200;
const buf = [];

function ctx() {
  return als.getStore() || null;
}

// run fn with an active {projectId, sessionId, repo} context
function run(context, fn) {
  return als.run(context || {}, fn);
}

// role: 'user' (you) | 'agent' (the system) | 'system' (status/errors)
function push(role, text, meta = {}) {
  const ev = { id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), ts: Date.now(), role, text, ...meta };
  const c = ctx();
  if (c && c.projectId && c.sessionId) {
    try { return store.appendMessage(c.projectId, c.sessionId, ev); } catch {}
  }
  buf.push(ev);
  if (buf.length > MAX) buf.shift();
  return ev;
}

function list() {
  return buf.slice();
}

module.exports = { push, list, run, ctx };
