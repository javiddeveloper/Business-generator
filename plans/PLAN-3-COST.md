# پلن ۳: Cost Tracking

## هدف
هزینه‌ی هر call به مدل را ثبت و نمایش بده. در هر bubble: «claude · $0.003». در dashboard: «این پروژه تا الان $X.XX هزینه داشته».

## زمینه
- Claude CLI: JSON output از قبل `total_cost_usd` دارد — در `claude-bridge.js` خط ~۲۹۱: `cost: r.total_cost_usd` — ولی جایی ذخیره نمی‌شود
- GapGPT: OpenAI-compatible، response شامل `usage.prompt_tokens` و `usage.completion_tokens` است
- Gemini CLI: رایگان، فقط شمارش call
- هزینه‌ها باید per-project قابل مشاهده باشند

## فایل‌های تغییرپذیر
- `claude-bridge.js` — استخراج cost از هر مدل
- `dashboard/lib/cost.js` — ماژول جدید برای ذخیره و خواندن
- `dashboard/server.js` — ذخیره cost بعد از هر call + endpoint جدید
- `dashboard/public/app.js` — نمایش در bubble و تب
- `dashboard/public/index.html` — تب جدید «هزینه»
- `dashboard/public/styles.css` — style badge هزینه

---

## تغییرات دقیق

### ۱. `claude-bridge.js`

#### ۱.۱ در `runHttp` — استخراج usage از GapGPT

در تابع `runHttp`، بعد از گرفتن `text` از response:

```js
const text = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
// Extract token usage for cost tracking
const usage = (j && j.usage) || {};
const promptTokens = usage.prompt_tokens || 0;
const completionTokens = usage.completion_tokens || 0;
// gpt-4o pricing: $2.5/1M input, $10/1M output (approximate)
const costUsd = (promptTokens * 2.5 + completionTokens * 10) / 1_000_000;
return { text, promptTokens, completionTokens, costUsd };
```

#### ۱.۲ در `runCli` — استخراج cost از Claude

در `child.on('close')` برای Claude (وقتی `bin !== 'gemini'`):

```js
try {
  const r = JSON.parse(out);
  if (r.is_error || r.error) return resolve({ error: r.result || r.error || r.subtype || 'unknown engine error' });
  return resolve({ 
    text: r.result || r.text || r.response || r.output || out,
    costUsd: r.total_cost_usd || 0,
    durationMs: r.duration_ms || 0,
  });
} catch (e) {
  return resolve({ text: out || err });
}
```

#### ۱.۳ در `/v1/messages` handler — برگرداندن cost

در response موفق، `costUsd` را اضافه کن:

```js
res.writeHead(200, { 'Content-Type': 'application/json' });
res.end(JSON.stringify({ 
  content: [{ type: 'text', text: result.text || '' }],
  engine: result.engine || activeId(),
  costUsd: result.costUsd || 0,
  usedFallback: !!result.usedFallback,
}));
```

#### ۱.۴ در `/agent` handler — برگرداندن cost

```js
return sendJson(res, 200, { 
  ok: true, branch, pushed, filesChanged, summary,
  engine: agent.engine || engine.id,
  costUsd: agent.cost || 0,
});
```

---

### ۲. فایل جدید `dashboard/lib/cost.js`

```js
// Cost log: records every AI call with engine, cost, tokens, project, session.
// Stored in data/cost-log.json (global, all projects).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LOG_FILE = path.join(ROOT, 'data', 'cost-log.json');
const MAX_ENTRIES = 10_000;

function readLog() {
  try { return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch { return []; }
}

function writeLog(entries) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    const tmp = LOG_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(entries));
    fs.renameSync(tmp, LOG_FILE);
  } catch (e) {}
}

// Record one call.
// entry: { engine, costUsd, promptTokens, completionTokens, projectId, sessionId, type }
// type: 'chat' | 'agent' | 'code-task' | 'ask' | 'po'
function record(entry) {
  const entries = readLog();
  entries.push({ ts: Date.now(), ...entry });
  // Cap log size
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  writeLog(entries);
}

// Aggregated stats.
function stats({ projectId, since } = {}) {
  const all = readLog();
  const filtered = all.filter(e => {
    if (since && e.ts < since) return false;
    if (projectId && e.projectId !== projectId) return false;
    return true;
  });

  const total = filtered.reduce((s, e) => s + (e.costUsd || 0), 0);
  const byEngine = {};
  const byProject = {};

  for (const e of filtered) {
    const eng = e.engine || 'unknown';
    byEngine[eng] = (byEngine[eng] || 0) + (e.costUsd || 0);
    if (e.projectId) {
      byProject[e.projectId] = (byProject[e.projectId] || 0) + (e.costUsd || 0);
    }
  }

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayCost = filtered
    .filter(e => e.ts >= todayStart.getTime())
    .reduce((s, e) => s + (e.costUsd || 0), 0);

  return { total, todayCost, byEngine, byProject, callCount: filtered.length };
}

// Last N entries (newest first), optionally filtered by projectId.
function recent(limit = 50, projectId) {
  const all = readLog();
  const filtered = projectId ? all.filter(e => e.projectId === projectId) : all;
  return filtered.slice(-limit).reverse();
}

module.exports = { record, stats, recent };
```

---

### ۳. `dashboard/server.js`

#### ۳.۱ import در ابتدا

```js
const cost = require('./lib/cost');
```

#### ۳.۲ در handler `/api/chat` — ثبت cost

بعد از دریافت result از `owner.runOwnerChat`:

```js
const result = await withRun(body.projectId, body.sessionId, effectiveRepo, () => owner.runOwnerChat(text));
// Cost tracking: owner.runOwnerChat calls claude() internally — we log what the bridge returned
// The bridge response includes costUsd if available
// For now, estimate from activity
return sendJson(res, 200, { ok: true, reply: result.reply, tasksCreated: result.tasksCreated });
```

**نکته:** برای `/api/chat` و `/api/ask` هزینه در bridge ثبت می‌شود و از طریق response برمی‌گردد. باید `claude()` در `dashboard/lib/claude.js` را به‌روز کنیم.

#### ۳.۳ `dashboard/lib/claude.js` — برگرداندن cost

در تابع `claude`، بعد از گرفتن response:

```js
const j = await res.json().catch(() => ({}));
if (j && j.error) throw new Error('bridge: ' + (j.error.message || 'claude error'));
const text = (j.content && j.content[0] && j.content[0].text) || '';
// Return cost info alongside text (callers can ignore it)
return text; // برای backward compatibility فعلاً فقط text برمی‌گردد
```

برای ثبت cost، یک تابع جداگانه:

```js
async function claudeWithCost(prompt, maxTokens = 3000, signal) {
  signal = signal || ((activity.ctx() || {}).signal);
  let res;
  try {
    res = await fetch(config.bridge + '/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: 'claude-opus-4-8',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (e) {
    if (e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''))) throw e;
    throw new Error('اتصال به پل مدل برقرار نشد (claude-bridge.js را اجرا/بررسی کن).');
  }
  const j = await res.json().catch(() => ({}));
  if (j && j.error) throw new Error('bridge: ' + (j.error.message || 'claude error'));
  return {
    text: (j.content && j.content[0] && j.content[0].text) || '',
    costUsd: j.costUsd || 0,
    engine: j.engine || 'claude-pro',
  };
}

module.exports = { claude, claudeWithCost, bridgeHealth, jparse };
```

#### ۳.۴ در handler `/api/agent` — ثبت cost

بعد از دریافت result از bridge:

```js
const result = await r.json();
// Record cost
if (result && (result.costUsd || result.engine)) {
  cost.record({
    engine: result.engine || 'unknown',
    costUsd: result.costUsd || 0,
    projectId: body.projectId,
    sessionId: body.sessionId,
    type: 'agent',
  });
}
```

#### ۳.۵ endpoint جدید `GET /api/costs`

```js
if (p === '/api/costs' && req.method === 'GET') {
  const pid = u.searchParams.get('projectId') || undefined;
  const period = u.searchParams.get('period') || 'all'; // 'today' | 'week' | 'all'
  
  const since = period === 'today'
    ? (() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); })()
    : period === 'week'
    ? Date.now() - 7 * 24 * 60 * 60 * 1000
    : 0;
  
  return sendJson(res, 200, {
    stats: cost.stats({ projectId: pid, since }),
    recent: cost.recent(20, pid),
  });
}
```

---

### ۴. `dashboard/public/app.js`

#### ۴.۱ نمایش هزینه در هر bubble

در `renderMessages`, بعد از ساخت bubble برای role=agent، اگر `ev.costUsd` داشت badge اضافه کن:

```js
// Cost badge on agent messages
if (ev.role === 'agent' && ev.costUsd != null && ev.costUsd > 0) {
  const badge = el('span', 'cost-badge');
  badge.textContent = (ev.engine || 'ai') + ' · $' + ev.costUsd.toFixed(4);
  bubble.appendChild(badge);
} else if (ev.role === 'agent' && ev.engine === 'gemini-antigravity') {
  const badge = el('span', 'cost-badge free');
  badge.textContent = 'gemini · رایگان';
  bubble.appendChild(badge);
}
```

#### ۴.۲ تابع `loadCostTab`

```js
async function loadCostTab() {
  const panel = $('costTabContent');
  if (!panel) return;
  panel.innerHTML = '<div class="loading">در حال بارگذاری…</div>';
  
  try {
    const pid = activeProjectId;
    const data = await api('/api/costs' + (pid ? '?projectId=' + encodeURIComponent(pid) : ''));
    const s = data.stats;
    
    panel.innerHTML = `
      <div class="cost-summary">
        <div class="cost-row"><span>امروز</span><span class="cost-val">$${s.todayCost.toFixed(4)}</span></div>
        <div class="cost-row"><span>کل</span><span class="cost-val">$${s.total.toFixed(4)}</span></div>
        <div class="cost-row"><span>تعداد call</span><span class="cost-val">${s.callCount}</span></div>
      </div>
      <div class="cost-by-engine">
        ${Object.entries(s.byEngine).map(([eng, c]) =>
          `<div class="cost-row"><span>${eng}</span><span class="cost-val">${c === 0 ? 'رایگان' : '$' + c.toFixed(4)}</span></div>`
        ).join('')}
      </div>
      <div class="cost-headline">
        این پروژه تا الان با $${(s.byProject[pid] || 0).toFixed(3)} ساخته شده
      </div>
    `;
  } catch (e) {
    panel.innerHTML = '<div class="error">خطا در بارگذاری</div>';
  }
}
```

#### ۴.۳ فعال کردن تب

وقتی تب «هزینه» کلیک شد، `loadCostTab()` را صدا بزن.

---

### ۵. `dashboard/public/index.html`

در بخش Settings modal، یک تب جدید اضافه کن:

```html
<button class="tab-btn" data-tab="cost">💰 هزینه</button>
```

و panel آن:

```html
<div id="costTabContent" class="tab-panel" data-for="cost"></div>
```

---

### ۶. `dashboard/public/styles.css`

```css
/* Cost badge in bubbles */
.cost-badge {
  display: inline-block;
  font-size: 10px;
  font-family: monospace;
  color: var(--text-muted, #64748b);
  margin-top: 6px;
  direction: ltr;
}
.cost-badge.free { color: #22c55e; }

/* Cost tab */
.cost-summary, .cost-by-engine {
  background: var(--surface-2, #0f172a);
  border: 1px solid var(--border, #334155);
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 10px;
}
.cost-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0;
  font-size: 12px;
  border-bottom: 1px solid var(--border, #1e293b);
}
.cost-row:last-child { border-bottom: none; }
.cost-val {
  font-family: monospace;
  font-weight: 600;
  color: var(--text-primary, #f1f5f9);
  direction: ltr;
}
.cost-headline {
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
  text-align: center;
  padding: 8px;
  font-style: italic;
}
```

---

## ترتیب پیاده‌سازی

۱. ابتدا `cost.js` را بساز
۲. `claude-bridge.js` را به‌روز کن (استخراج cost)
۳. `server.js` را به‌روز کن (ثبت + endpoint)
۴. frontend را به‌روز کن (badge + تب)

## تست کردن

۱. یک پیام چت بفرست
۲. در console server باید cost لاگ شود
۳. `data/cost-log.json` باید ساخته شود
۴. در Settings → هزینه باید اطلاعات نمایش داده شود
۵. روی bubble agent باید badge `claude · $0.00XX` دیده شود

## نکته‌های مهم
- `cost-log.json` بیشتر از ۱۰٬۰۰۰ رکورد نگه نمی‌دارد
- قیمت gpt-4o در GapGPT تقریبی است — از pricing رسمی OpenAI استفاده شده
- اگر bridge cost برنگرداند، فیلد `costUsd=0` ثبت می‌شود (call ثبت می‌شود ولی هزینه صفر)
- cost در store messages ذخیره **نمی‌شود** — فقط در `cost-log.json` — چون این یک log جداگانه است
