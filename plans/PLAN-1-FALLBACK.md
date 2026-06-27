# پلن ۱: Auto-Fallback مدل

## هدف
اگر مدل فعال در bridge خطا بدهد (rate-limit، timeout، crash)، سیستم خودکار مدل بعدی را امتحان کند بدون اینکه کاربر دستی سوییچ کند.

## زمینه
پروژه یک bridge دارد در `claude-bridge.js` که روی port 8787 اجرا می‌شود.
سه مدل تعریف شده:
- `claude-pro`: CLI، bin=`claude`
- `gemini-antigravity`: CLI، bin=`gemini`  
- `gapgpt`: HTTP، OpenAI-compatible

الان اگر مدل فعال خطا بدهد → `{ error: '...' }` برمی‌گردد و کار می‌ایستد.

## فایل‌های تغییرپذیر
- `claude-bridge.js` — تمام تغییرات اصلی اینجاست
- `dashboard/server.js` — فقط log fallback در console
- `dashboard/public/app.js` — نمایش badge «fallback» روی bubble
- `dashboard/public/styles.css` — style badge

---

## تغییرات دقیق

### ۱. `claude-bridge.js`

#### ۱.۱ تابع جدید `runWithFallback` برای `/v1/messages`

بعد از تابع `runActive` (خط ~۱۵۳) این تابع را اضافه کن:

```js
// Try the active model first; on error (not user-abort) try remaining models in order.
async function runWithFallback(prompt, maxTokens) {
  const activeId = activeModel().id;
  const order = [activeId, ...MODELS.map(m => m.id).filter(id => id !== activeId)];
  
  let lastError = '';
  const failedEngines = [];

  for (const modelId of order) {
    const entry = MODELS.find(m => m.id === modelId);
    if (!entry) continue;
    
    const result = entry.kind === 'http'
      ? await runHttp(entry, prompt, maxTokens)
      : await runCli(entry.bin, entry.model, prompt);
    
    if (!result.error) {
      const usedFallback = modelId !== activeId;
      return { ...result, engine: modelId, usedFallback, failedEngines: usedFallback ? failedEngines : [] };
    }
    
    // User abort — don't retry
    if (/aborted|abort/i.test(result.error)) return result;
    
    lastError = result.error;
    failedEngines.push(modelId);
    console.warn(`[fallback] ${modelId} failed: ${result.error.slice(0, 120)} — trying next`);
  }
  
  return { error: lastError || 'all engines failed', failedEngines };
}
```

#### ۱.۲ در handler `/v1/messages`

در انتهای handler (حدود خط ~۵۳۲)، خط `const result = await runActive(prompt, maxTokens);` را به این تغییر بده:

```js
const result = await runWithFallback(prompt, maxTokens);
```

و در response، اگر `usedFallback` بود آن را هم برگردان:

```js
if (result.error) {
  console.error('[bridge] fallback exhausted:', result.error);
  res.writeHead(502, { 'Content-Type': 'application/json' });
  return res.end(JSON.stringify({ 
    content: [{ type: 'text', text: '' }], 
    error: { type: 'engine_error', message: result.error },
    failedEngines: result.failedEngines || []
  }));
}
res.writeHead(200, { 'Content-Type': 'application/json' });
res.end(JSON.stringify({ 
  content: [{ type: 'text', text: result.text || '' }],
  engine: result.engine || activeId(),
  usedFallback: !!result.usedFallback,
  failedEngines: result.failedEngines || []
}));
```

#### ۱.۳ تابع `runEngineWithFallback` برای `/agent`

برای agent فقط CLI engineها (claude و gemini) fallback می‌دهند — gapgpt به Aider نیاز دارد که ممکن است نصب نباشد.

بعد از تابع `runEngineInDir` اضافه کن:

```js
// Agent fallback: try active engine, then other CLI engines on error.
// GapGPT (http) is only tried if it was the active engine (user chose it explicitly).
async function runEngineWithFallback(activeEngine, prompt, cwd, readonly) {
  const cliEngines = MODELS.filter(m => m.kind === 'cli').map(m => m.id);
  
  // Build order: active first, then other CLI engines
  let order;
  if (activeEngine.kind === 'cli') {
    order = [activeEngine.id, ...cliEngines.filter(id => id !== activeEngine.id)];
  } else {
    // http engine (gapgpt) was active — try it first, then CLIs as fallback
    order = [activeEngine.id, ...cliEngines];
  }
  
  const failedEngines = [];
  let lastError = '';

  for (const modelId of order) {
    const entry = MODELS.find(m => m.id === modelId);
    if (!entry) continue;
    
    const result = await runEngineInDir(entry, prompt, cwd, readonly);
    
    if (!result.error) {
      const usedFallback = modelId !== activeEngine.id;
      return { ...result, engine: modelId, usedFallback, failedEngines: usedFallback ? failedEngines : [] };
    }
    
    // User abort or "not agent-capable" — don't retry
    if (/aborted|abort|not agent/i.test(result.error)) return result;
    // Timeout on this engine — try next
    if (/timed out/i.test(result.error)) {
      lastError = result.error;
      failedEngines.push(modelId);
      console.warn(`[fallback] agent ${modelId} timed out — trying next`);
      continue;
    }
    
    lastError = result.error;
    failedEngines.push(modelId);
    console.warn(`[fallback] agent ${modelId} failed: ${result.error.slice(0, 120)} — trying next`);
  }
  
  return { error: lastError || 'all agent engines failed', failedEngines };
}
```

#### ۱.۴ در handler `/agent`

خط `const agent = await runEngineInDir(engine, fullTask, dir, readonly);` را به این تغییر بده:

```js
const agent = await runEngineWithFallback(engine, fullTask, dir, readonly);
```

و در response `engine` و `usedFallback` را اضافه کن:

```js
return sendJson(res, 200, { 
  ok: true, branch, pushed, filesChanged, summary,
  engine: agent.engine || engine.id,
  usedFallback: !!agent.usedFallback,
  failedEngines: agent.failedEngines || []
});
```

#### ۱.۵ در handler `/code-task`

در `handleCodeTask`، خط `const agent = await runEngineInDir(engine, task, dir);` را به این تغییر بده:

```js
const agent = await runEngineWithFallback(engine, task, dir, false);
```

---

### ۲. `dashboard/server.js`

در handler `/api/agent` (بعد از دریافت result از bridge)، اگر `result.usedFallback` بود log بزن:

```js
const result = await r.json();
if (result.usedFallback) {
  console.log(`[agent] fallback used: ${result.failedEngines?.join(',')} → ${result.engine}`);
}
```

در response به frontend، فیلدهای `engine` و `usedFallback` را pass کن (اگر result دارد آن‌ها را برگردانند).

---

### ۳. `dashboard/public/app.js`

در تابع `typeOutReply` یا جایی که bubble نهایی ساخته می‌شود، بعد از ساخت bubble اگر `usedFallback` بود یک badge اضافه کن.

ابتدا `send()` را بررسی کن — برای mode=`chat` و `po`، اگر `res.usedFallback` بود badge نمایش بده.

در تابع `send()`، بعد از `removeTypingBubble()` و قبل از `typeOutReply`:

```js
// Show fallback notice if model switched automatically
if (res && res.usedFallback && res.engine) {
  const tl = $('timeline');
  const notice = el('div', 'fallback-notice');
  notice.textContent = `⚡ fallback: ${res.failedEngines?.join(', ')} → ${res.engine}`;
  tl.appendChild(notice);
}
```

---

### ۴. `dashboard/public/styles.css`

اضافه کن:

```css
.fallback-notice {
  font-size: 10px;
  color: var(--text-muted, #64748b);
  text-align: center;
  padding: 4px 0;
  direction: ltr;
  font-family: monospace;
}
```

---

## تست کردن

۱. `model-state.json` را باز کن و `active` را به یک مدل اشتباه تغییر بده (مثلاً `"broken-model"`)
۲. یک پیام در chat بفرست
۳. انتظار: در console bridge باید `[fallback] broken-model failed` دیده شود و پاسخ از مدل بعدی برگردد
۴. `model-state.json` را به حالت اول برگردان

## نکته‌های مهم
- `AbortError` (STOP button) هرگز retry نمی‌شود
- timeout در agent (پیش‌فرض ۲۰ دقیقه) باعث retry می‌شود
- "engine not agent-capable" باعث retry نمی‌شود
- فقط CLI engines برای `/agent` و `/code-task` fallback می‌دهند (نه gapgpt مگر اینکه active بود)
