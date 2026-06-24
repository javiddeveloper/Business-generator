// Calls the local Claude bridge (Pro subscription). Same contract the n8n nodes use.
const { config } = require('./env');

async function claude(prompt, maxTokens = 3000) {
  const res = await fetch(config.bridge + '/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (j && j.error) throw new Error('bridge: ' + (j.error.message || 'claude error'));
  return (j.content && j.content[0] && j.content[0].text) || '';
}

// Is the bridge up and is claude actually able to answer (logged in)?
async function bridgeHealth() {
  try {
    const res = await fetch(config.bridge + '/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'ping: reply with the single word ok' }] }),
    });
    const j = await res.json().catch(() => ({}));
    if (j && j.error) return { online: true, ready: false, detail: j.error.message };
    const txt = (j.content && j.content[0] && j.content[0].text) || '';
    return { online: true, ready: !!txt.trim(), detail: txt.slice(0, 80) };
  } catch (e) {
    return { online: false, ready: false, detail: e.message };
  }
}

// Tolerant JSON extraction from a model reply.
function jparse(t) {
  let s = String(t || '')
    .replace(/```json|```/g, '')
    .trim();
  try {
    return JSON.parse(s);
  } catch (e) {}
  const a = s.indexOf('{'),
    b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(s.slice(a, b + 1));
    } catch (e) {}
  }
  const c = s.indexOf('['),
    d = s.lastIndexOf(']');
  if (c >= 0 && d > c) {
    try {
      return JSON.parse(s.slice(c, d + 1));
    } catch (e) {}
  }
  return null;
}

module.exports = { claude, bridgeHealth, jparse };
