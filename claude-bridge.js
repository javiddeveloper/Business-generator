// پل محلی Claude Code → سازگار با API آنتروپیک
// از اشتراک Claude Code/Pro استفاده می‌کند، نه از توکن API.
// اجرا روی خودِ مک (جایی که claude code نصب و لاگین است):
//   node claude-bridge.js
// n8n از داخل داکر با http://host.docker.internal:8787/v1/messages صدایش می‌زند.

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 8787;

http.createServer((req, res) => {
  // سرو فایل‌های قابل‌شخصی‌سازی برای n8n — چون n8n اجازه‌ی require('fs') ندارد،
  // محتوای stacks/*.md و roles/*.md را از همین‌جا (روی مک) می‌خواند:
  //   GET /stack/backend   |   GET /role/tech-lead
  if (req.method === 'GET' && req.url && (req.url.indexOf('/stack') === 0 || req.url.indexOf('/role') === 0)) {
    const isRole = req.url.indexOf('/role') === 0;
    const dir = isRole ? 'roles' : 'stacks';
    const allow = isRole ? /(product-owner|developer|tech-lead)/ : /(backend|frontend|mobile)/;
    const m = req.url.match(allow);
    let text = '';
    if (m) { try { text = fs.readFileSync(path.join(__dirname, dir, m[1] + '.md'), 'utf8'); } catch (e) { text = ''; } }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(text);
  }
  if (req.method !== 'POST') { res.writeHead(405); return res.end('POST only'); }

  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    // از بدنه‌ی استایل آنتروپیک (messages) یا {prompt} متن را دربیاور
    let prompt = '';
    try {
      const j = JSON.parse(body || '{}');
      if (Array.isArray(j.messages) && j.messages.length) {
        prompt = j.messages.map(m => (typeof m.content === 'string'
          ? m.content
          : (Array.isArray(m.content) ? m.content.map(p => p.text || '').join('\n') : ''))).join('\n');
      } else if (j.prompt) {
        prompt = j.prompt;
      } else {
        prompt = body;
      }
    } catch (e) { prompt = body; }

    // claude code در حالت print + خروجی json
    // برای تعویض مدل: متغیر محیطی CLAUDE_MODEL را ست کن (مثلاً sonnet یا opus)
    const args = ['-p', '--output-format', 'json'];
    if (process.env.CLAUDE_MODEL) { args.push('--model', process.env.CLAUDE_MODEL); }
    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '', err = '';
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));

    child.on('error', (e) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text: 'bridge error: ' + e.message }] }));
    });

    child.on('close', () => {
      let text = '';
      try {
        const r = JSON.parse(out);
        text = r.result || r.text || out;   // فیلد result خروجی claude -p
      } catch (e) {
        text = out || err;
      }
      // پاسخ را دقیقاً مثل API آنتروپیک برگردان تا نودهای n8n بدون تغییر کار کنند
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ content: [{ type: 'text', text }] }));
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}).listen(PORT, () => console.log('Claude bridge روی http://localhost:' + PORT + ' آماده است'));
