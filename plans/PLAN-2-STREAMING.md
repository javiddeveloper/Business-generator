# پلن ۲: Streaming Real-time

## هدف
وقتی کاربر در mode=agent دستور می‌دهد، به‌جای انتظار ۵-۱۵ دقیقه و دریافت یک پاسخ یک‌جا، خروجی agent خط‌به‌خط در یک bubble زنده نمایش داده شود.

## زمینه
پروژه یک bridge دارد در `claude-bridge.js` که agent را spawn می‌کند و منتظر پایان process می‌ماند.
Frontend در `app.js` یک تابع `typeOutReply` دارد که یک animation typewriter شبیه‌سازی می‌کند — این برای mode=chat کافی است ولی برای agent که واقعاً دارد کد می‌نویسد، streaming واقعی باید باشد.

روش انتخابی: **Server-Sent Events (SSE)** — یک‌طرفه، بدون dependency، از همان HTTP port 8090 کار می‌کند.

## فایل‌های تغییرپذیر
- `claude-bridge.js`
- `dashboard/server.js`
- `dashboard/public/app.js`
- `dashboard/public/styles.css`

---

## تغییرات دقیق

### ۱. `claude-bridge.js`

#### ۱.۱ تابع `runAgentInDirStreaming`

این تابع مثل `runAgentInDir` است ولی به‌جای resolve کردن در پایان، هر chunk از stdout را از طریق callback می‌فرستد.

بعد از تابع `runAgentInDir` اضافه کن:

```js
// Like runAgentInDir but calls onChunk(text) for each stdout chunk.
// Resolves with the final { ok, summary, filesChanged, ... } on close.
function runAgentInDirStreaming(bin, model, prompt, cwd, readonly, onChunk) {
  return new Promise((resolve) => {
    const baseArgs = agentArgs(bin, model, readonly);
    const args = bin === 'gemini' ? ['--prompt', prompt, ...baseArgs] : baseArgs;
    const child = spawn(bin, args, { 
      cwd, 
      stdio: bin === 'gemini' ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'], 
      env: childEnv 
    });
    
    let out = '', err = '', done = false;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => { 
      try { child.kill('SIGKILL'); } catch (e) {} 
      finish({ error: 'agent timed out after ' + Math.round(AGENT_TIMEOUT_MS / 60000) + 'm' }); 
    }, AGENT_TIMEOUT_MS);
    
    child.stdout.on('data', (d) => {
      const chunk = d.toString();
      out += chunk;
      // Stream raw text chunks — caller shows them live
      if (onChunk) {
        try { onChunk(chunk); } catch (e) {}
      }
    });
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => finish({ error: 'engine "' + bin + '" not runnable: ' + e.message }));
    child.on('close', (code) => {
      if (bin === 'gemini') {
        if (code !== 0 && !out.trim()) return finish({ error: (err || 'gemini exited ' + code).slice(0, 600) });
        return finish({ summary: String(out || err).slice(0, 4000) });
      }
      try {
        const r = JSON.parse(out);
        if (r.is_error || r.error) return finish({ error: r.result || r.error || r.subtype || 'agent error' });
        return finish({ summary: String(r.result || r.text || r.output || '').slice(0, 4000), durationMs: r.duration_ms, cost: r.total_cost_usd });
      } catch (e) {
        if (code !== 0) return finish({ error: (err || out || 'agent exited ' + code).slice(0, 600) });
        return finish({ summary: String(out).slice(0, 4000) });
      }
    });
    
    if (bin !== 'gemini') {
      child.stdin.write(prompt);
      child.stdin.end();
    }
  });
}
```

#### ۱.۲ endpoint جدید `/agent-stream`

بعد از handler `/agent` (حدود خط ~۴۹۵) اضافه کن:

```js
// Streaming agent: same as /agent but sends SSE chunks while the agent runs.
// Client receives: data: {"chunk":"..."}\n\n  then  data: {"done":true,...}\n\n
if (req.method === 'POST' && p === '/agent-stream') {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    let input;
    try { input = JSON.parse(body || '{}'); } catch (e) { 
      res.writeHead(400, { 'Content-Type': 'application/json' }); 
      return res.end(JSON.stringify({ ok: false, error: 'invalid JSON' })); 
    }
    
    const dir = String(input.dir || '').trim();
    const task = String(input.task || '').trim();
    if (!dir || !task) { 
      res.writeHead(400, { 'Content-Type': 'application/json' }); 
      return res.end(JSON.stringify({ ok: false, error: 'dir و task لازم است' })); 
    }
    if (!fs.existsSync(path.join(dir, '.git'))) { 
      res.writeHead(400, { 'Content-Type': 'application/json' }); 
      return res.end(JSON.stringify({ ok: false, error: 'dir باید مخزن git باشد' })); 
    }
    
    const engine = activeModel();
    if (engine.kind !== 'cli') {
      res.writeHead(409, { 'Content-Type': 'application/json' }); 
      return res.end(JSON.stringify({ ok: false, error: 'streaming فقط برای CLI engineها (claude/gemini) کار می‌کند' }));
    }
    
    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    
    const send = (obj) => {
      try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {}
    };
    
    // Handle image
    let fullTask = task;
    if (input.imagePath && fs.existsSync(input.imagePath)) {
      let imgRef = input.imagePath;
      try {
        const designDir = path.join(dir, '.design');
        fs.mkdirSync(designDir, { recursive: true });
        const dest = path.join(designDir, path.basename(input.imagePath));
        fs.copyFileSync(input.imagePath, dest);
        imgRef = dest;
        const excludeFile = path.join(dir, '.git', 'info', 'exclude');
        let ex = '';
        try { ex = fs.readFileSync(excludeFile, 'utf8'); } catch {}
        if (!/^\.design\/?$/m.test(ex)) fs.appendFileSync(excludeFile, '\n.design/\n');
      } catch (e) {}
      fullTask += '\n\nیک تصویر دیزاین در مسیر ' + imgRef + ' وجود دارد؛ با ابزار Read آن را بخوان و دقیقاً بر اساس همان دیزاین پیاده‌سازی کن.';
    }
    
    const readonly = !!input.readonly;
    
    // Run agent with streaming
    const agent = await runAgentInDirStreaming(engine.bin, engine.model, fullTask, dir, readonly, (chunk) => {
      send({ chunk });
    });
    
    if (agent.error) {
      send({ done: true, ok: false, error: agent.error });
      return res.end();
    }
    
    // Git: commit + push if needed
    let branch = '';
    const curB = await git(['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD']);
    branch = curB.out.trim();
    
    let pushed = false;
    let filesChanged = [];
    if (!readonly && input.push !== false) {
      await git(['-C', dir, 'add', '-A']);
      const staged = await git(['-C', dir, 'diff', '--cached', '--name-only']);
      filesChanged = staged.out.split('\n').map((s) => s.trim()).filter(Boolean);
      if (filesChanged.length) {
        const msg = (input.commitMessage || 'agent: ' + task.slice(0, 80)).slice(0, 200);
        await git(['-C', dir, 'commit', '-m', msg]);
        const pushR = await git(['-C', dir, 'push', 'origin', 'HEAD']);
        pushed = pushR.code === 0;
      }
    }
    
    send({ done: true, ok: true, branch, pushed, filesChanged, summary: agent.summary || '', cost: agent.cost });
    res.end();
    console.log('[agent-stream] dir=' + dir + ' branch=' + branch + ' pushed=' + pushed + ' files=' + filesChanged.length);
  });
  return;
}
```

---

### ۲. `dashboard/server.js`

#### ۲.۱ endpoint جدید `/api/agent-stream`

بعد از handler `/api/agent` (حدود خط ~۵۴۳) اضافه کن:

```js
if (p === '/api/agent-stream' && req.method === 'POST') {
  const body = JSON.parse((await readBody(req)) || '{}');
  const task = (body.task || '').trim();
  if (!task) return sendJson(res, 400, { error: 'task لازم است' });
  
  const project = body.projectId ? store.getProject(body.projectId) : null;
  if (!project) return sendJson(res, 400, { ok: false, error: 'پروژه پیدا نشد' });
  
  const sid = body.sessionId;
  if (sid) store.appendMessage(body.projectId, sid, { role: 'user', text: task });
  
  const st = await repo.status(project.repo);
  if (!st.cloned) return sendJson(res, 200, { ok: false, error: 'مخزن هنوز کلون نشده' });
  
  const push = body.push !== false;
  const imagePath = body.imagePath || null;
  const taskWithMemory = task + memory.contextBlock(st.dir);
  
  // SSE pass-through headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  
  const sendSSE = (obj) => {
    try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {}
  };
  
  let finalResult = null;
  
  try {
    // Fetch bridge SSE stream and proxy it
    const ctrl = new AbortController();
    if (sid) running.set(sid, ctrl);
    
    const bridgeRes = await fetch(config.bridge + '/agent-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({ dir: st.dir, task: taskWithMemory, push, commitMessage: body.commitMessage, imagePath }),
    });
    
    if (!bridgeRes.body) {
      sendSSE({ done: true, ok: false, error: 'bridge did not return a stream' });
      res.end();
      return;
    }
    
    const reader = bridgeRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      
      // Parse SSE lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep incomplete line
      
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.done) {
            finalResult = event;
          }
          // Forward every event to the client
          sendSSE(event);
        } catch (e) {}
      }
    }
    
    if (sid) running.delete(sid);
    
  } catch (e) {
    const isAbortErr = e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''));
    const msg = isAbortErr ? 'stopped' : /fetch failed/i.test(e.message || '') ? 'اتصال به پل مدل برقرار نشد.' : e.message;
    sendSSE({ done: true, ok: false, error: msg });
    if (sid) {
      running.delete(sid);
      store.appendMessage(body.projectId, sid, { role: 'system', text: '⚠️ ' + msg });
    }
    res.end();
    return;
  }
  
  // Save final message and update memory
  if (finalResult && sid) {
    const summary = finalResult.summary || '';
    store.appendMessage(body.projectId, sid, { role: 'agent', text: summary });
    memory.append(st.dir, finalResult.ok ? 'agent' : 'agent (خطا)',
      'تسک: ' + task.slice(0, 200) +
      (finalResult.filesChanged && finalResult.filesChanged.length ? '\nفایل‌ها: ' + finalResult.filesChanged.slice(0, 20).join('، ') : '') +
      '\nنتیجه: ' + summary.slice(0, 400));
  }
  
  res.end();
  return;
}
```

---

### ۳. `dashboard/public/app.js`

#### ۳.۱ تابع جدید `streamAgentCall`

این تابع را قبل از `send()` اضافه کن:

```js
// Streams agent output into a live bubble. Returns final result object.
async function streamAgentCall(params) {
  const { task, projectId, sessionId, push, imagePath } = params;
  
  const tl = $('timeline');
  
  // Create live bubble
  const m = el('div', 'msg agent stream-live');
  const who = el('div', 'who');
  who.appendChild(el('span', null, 'Agent'));
  who.appendChild(el('span', null, ' · streaming…'));
  m.appendChild(who);
  
  const bubble = el('div', 'bubble stream-bubble');
  bubble.setAttribute('dir', 'ltr'); // code output is LTR
  const pre = el('pre', 'stream-output');
  bubble.appendChild(pre);
  m.appendChild(bubble);
  tl.appendChild(m);
  tl.scrollTop = tl.scrollHeight;
  
  return new Promise((resolve) => {
    const url = '/api/agent-stream';
    
    // Use fetch with ReadableStream
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, projectId, sessionId, push, imagePath }),
    }).then(async (res) => {
      if (!res.body) {
        m.remove();
        resolve({ ok: false, error: 'no stream' });
        return;
      }
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let finalResult = null;
      const atBottom = () => tl.scrollHeight - tl.scrollTop - tl.clientHeight < 120;
      
      while (true) {
        let readResult;
        try { readResult = await reader.read(); } catch (e) { break; }
        const { done, value } = readResult;
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.chunk) {
              fullText += event.chunk;
              // Show last 3000 chars to avoid huge DOM
              pre.textContent = fullText.length > 3000 ? '…' + fullText.slice(-3000) : fullText;
              if (atBottom()) tl.scrollTop = tl.scrollHeight;
            }
            if (event.done) {
              finalResult = event;
            }
          } catch (e) {}
        }
      }
      
      // Finalize bubble
      m.classList.remove('stream-live');
      who.querySelector('span:last-child').textContent = ' · ' + timeAgo(Date.now());
      
      if (finalResult && finalResult.ok && finalResult.summary) {
        // Replace raw stream with clean markdown summary
        bubble.innerHTML = '';
        const md = el('div', 'md-body');
        md.setAttribute('dir', 'auto');
        md.innerHTML = typeof marked !== 'undefined'
          ? marked.parse(finalResult.summary, { breaks: true, gfm: true })
          : finalResult.summary.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
        bubble.appendChild(md);
        bubble.appendChild(makeCopyBtn(() => finalResult.summary));
        
        if (finalResult.filesChanged && finalResult.filesChanged.length) {
          const info = el('div', 'stream-meta');
          info.textContent = '📁 ' + finalResult.filesChanged.length + ' فایل · ' + (finalResult.pushed ? '✅ push شد' : 'push نشد');
          bubble.appendChild(info);
        }
      } else if (finalResult && !finalResult.ok) {
        bubble.innerHTML = '';
        const err = el('div', 'md-body');
        err.textContent = '⚠️ ' + (finalResult.error || 'خطای نامشخص');
        bubble.appendChild(err);
      }
      
      if (atBottom()) tl.scrollTop = tl.scrollHeight;
      resolve(finalResult || { ok: false, error: 'stream ended without done event' });
    }).catch((e) => {
      m.remove();
      resolve({ ok: false, error: e.message });
    });
  });
}
```

#### ۳.۲ در `send()` — mode=agent را به streaming تغییر بده

در `send()`، بخش `else if (mode === 'agent')` را پیدا کن:

```js
} else if (mode === 'agent') {
  // the model works on the project's code (current branch)
  const push = !$('agentPush') || $('agentPush').checked;
  res = await api('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: text, projectId: activeProjectId, sessionId: sid, push, imagePath: imgPath }),
  });
}
```

به این تغییر بده:

```js
} else if (mode === 'agent') {
  const push = !$('agentPush') || $('agentPush').checked;
  removeTypingBubble(); // streaming دارد bubble خودش را می‌سازد
  // استفاده از streaming — bubble زنده
  res = await streamAgentCall({ 
    task: text, 
    projectId: activeProjectId, 
    sessionId: sid, 
    push, 
    imagePath: imgPath 
  });
  lockUI(false);
  lastActivitySig = null;
  return; // خروج زودهنگام — streaming خودش پیام را ذخیره کرده
}
```

**نکته مهم:** بعد از `return` در mode=agent، کد `removeTypingBubble()` و `typeOutReply()` که بعد از if/else هستند اجرا نمی‌شوند — این درست است چون streaming خودش bubble را مدیریت می‌کند.

---

### ۴. `dashboard/public/styles.css`

اضافه کن:

```css
/* Streaming bubble */
.msg.stream-live .who span:last-child {
  animation: blink 1s step-end infinite;
}
@keyframes blink { 50% { opacity: 0; } }

.stream-bubble {
  font-family: monospace;
  font-size: 11px;
  background: var(--surface-2, #0f172a);
  border-radius: 6px;
  padding: 10px;
  max-height: 400px;
  overflow-y: auto;
}

.stream-output {
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text-secondary, #94a3b8);
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
}

.stream-meta {
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border, #334155);
  direction: rtl;
}
```

---

## تست کردن

۱. یک پروژه با مخزن کلون‌شده باز کن
۲. mode=agent انتخاب کن
۳. دستور ساده‌ای بفرست: «یک فایل README.md بساز»
۴. انتظار: یک bubble terminal-style باز می‌شود و خروجی agent خط‌به‌خط نمایش داده می‌شود
۵. بعد از پایان: bubble به markdown summary تبدیل می‌شود

## محدودیت‌ها
- Streaming فقط برای mode=agent کار می‌کند
- اگر bridge CLI engine نداشته باشد (gapgpt active بود)، fallback به `/api/agent` بدون streaming
- auto-runner (Play button) از `/api/code-task` استفاده می‌کند، نه streaming — این عمداً همین‌طور است
