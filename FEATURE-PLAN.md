# پلن پیاده‌سازی ۵ قابلیت جدید داشبورد

> این فایل برای اجرا در یک سشن جدید است. هر بخش = یک خواسته، با وضعیت فعلی (با فایل/خط)، شکاف، تغییرات دقیق (backend + bridge + frontend)، و راستی‌آزمایی.
> پیش‌نیاز: ابتدا `FIX-PLAN.md` (رفع crashِ `$('#id')`) اجرا و تأیید شده باشد، وگرنه هیچ‌کدام از تست‌های UI زیر قابل اجرا نیست.

## معماری فعلی (خلاصه برای سشن جدید)
- **سرور داشبورد** `dashboard/server.js` (Node خام، بدون وابستگی) روی پورت 8090؛ روی همان مک اجرا می‌شود، پس مستقیم به `git` دسترسی دارد.
- **پل مدل** `claude-bridge.js` روی پورت 8787: `POST /v1/messages` (چت ساده، `runActive`)، `POST /code-task` (agent داخل checkout + commit + push)، `GET /models`, `POST /model`.
- **lib ها:** `repo.js` (clone/status/branches روی لوکال)، `owner.js` (پارس دستور composer + خط لوله Trello)، `store.js` (پروژه/سشن/پیام روی دیسک در `data/`)، `settings.js` (secrets.env + فیلدهای تنظیمات)، `claude.js` (wrapper چت پل).
- **frontend** `dashboard/public/{index.html,app.js,styles.css}`.
- **مدل پروژه** در `store.js`: `{ id, name, repo, createdAt, updatedAt, archived }`. فیلد `repo` یا `owner/repo` گیت‌هابی است یا مسیر لوکال مطلق.
- **نکته‌ی کلیدی جریان فعلی:** کل composer از طریق `POST /api/command` → `owner.runCommand` می‌رود که فقط دستورهای ثابت (idea/fix:/feature:/model/report/...) را می‌فهمد و هر متن دیگری را با «🤷 دستور شناخته نشد» رد می‌کند ([owner.js:717](dashboard/lib/owner.js)). جریان توسعه‌ی واقعی هم همیشه از روی کارت Trello، برنچ `task/<cardId>` از `develop` می‌سازد و PR به `develop` می‌زند ([owner.js:54-161](dashboard/lib/owner.js)، [claude-bridge.js:299-355](claude-bridge.js)). یعنی مفهوم «روی برنچ انتخابیِ کاربر کار کن و روی همان پوش کن» وجود ندارد.

---

## ۱) پروژه (آفلاین/آنلاین) باید روی لوکال در مسیر مشخص موجود باشد

### وضعیت فعلی
- مسیر کلون: `WORKSPACE_DIR` (پیش‌فرض `~/.business-generator/workspaces`)، فیلد تنظیمات در [settings.js:28](dashboard/lib/settings.js)، خوانده‌شده در [repo.js:13-18](dashboard/lib/repo.js) (`workspaceRoot`).
- کلون فقط **دستی** اتفاق می‌افتد: کاربر باید تب «ریپو» را باز کند و دکمه‌ی Clone/Update را بزند ([app.js:905-923](dashboard/public/app.js) → `POST /api/clone` → [repo.js:168](dashboard/lib/repo.js)).
- پروژه‌ی لوکال (مسیر مطلق) همان مسیر را مستقیم به‌کار می‌برد ([repo.js:27-32](dashboard/lib/repo.js) `repoDir`).

### شکاف
- برای پروژه‌ی گیت‌هابی، تا وقتی کاربر دستی Clone نزند، روی دیسک وجود ندارد. خواسته: **به‌محض ساخت/انتخاب پروژه‌ی آنلاین، خودکار در `WORKSPACE_DIR` کلون شود** و وضعیت «موجود روی لوکال» همیشه صدق کند.

### تغییرات
1. **backend — auto-clone هنگام ساخت پروژه:** در [server.js:322-325](dashboard/server.js) (روت `POST /api/projects`) بعد از `store.createProject`، اگر `repo` یک slug گیت‌هابی است (نه مسیر لوکال) و هنوز کلون نشده، یک کلون **غیرمسدودکننده** آغاز شود:
   - تشخیص لوکال‌بودن با همان regex موجود `^([a-zA-Z]:[/\\]|\\\\|\/|~)` ([repo.js:23](dashboard/lib/repo.js)).
   - `repo.clone(project.repo).catch(()=>{})` را بدون `await` صدا بزن تا پاسخ ساخت پروژه کند نشود؛ نتیجه را در تب ریپو با polling فعلی می‌بینیم.
2. **backend — auto-clone تنبل هنگام خواندن وضعیت:** در [server.js:361-366](dashboard/server.js) (روت `GET /api/repo`)، اگر پروژه گیت‌هابی است و `status.cloned === false` و `folderMissing` نیست، یک فلگ `autoCloning:true` برگردان و کلون پس‌زمینه را trigger کن (با یک Set برای جلوگیری از کلون موازی روی یک repo).
3. **frontend — نمایش وضعیت:** در `renderRepo` ([app.js:795](dashboard/public/app.js)) اگر `r.autoCloning` بود، به‌جای دکمه‌ی Clone یک نوار «در حال کلون خودکار…» نشان بده و هر ۳ ثانیه `refreshRepo` را تا `cloned===true` تکرار کن.
4. **اختیاری ولی توصیه‌شده:** نمایش مسیر لوکالِ مطلق پروژه به‌صورت ثابت در هدر تب ریپو (همین حالا `r.dir` در [app.js:902](dashboard/public/app.js) رندر می‌شود — فقط مطمئن شو همیشه دیده شود).

### راستی‌آزمایی
- پروژه‌ی جدید با `owner/repo` بساز → بدون باز کردن تب ریپو، چند ثانیه بعد پوشه زیر `WORKSPACE_DIR/owner__repo/.git` ساخته شده باشد.
- تنظیمات → `WORKSPACE_DIR` را عوض کن → پروژه‌ی گیت‌هابی جدید در مسیر جدید کلون شود.
- پروژه‌ی لوکال (مسیر مطلق) → بدون کلون، همان مسیر به‌عنوان `dir` استفاده شود.

---

## ۲) پروژه‌ی لوکالِ بدون گیت → دیالوگ گرفتن آدرس گیت برای پوش

### وضعیت فعلی
- اگر مسیر لوکال `.git` نداشته باشد، `status` لیست برنچ خالی برمی‌گرداند و frontend پیام «مخزن git نیست» نشان می‌دهد ([repo.js:107-146](dashboard/lib/repo.js)، [app.js:933-936](dashboard/public/app.js)).
- هیچ راهی برای «اتصال به گیت» (init + remote + push) وجود ندارد.

### شکاف — کاملاً جدید
نیاز به: تشخیص «لوکال و بدون remote»، یک دیالوگ شبیه تنظیمات برای گرفتن URL گیت‌هاب، و backend برای `git init` + `git remote add` + first push.

### تغییرات
1. **backend — تشخیص remote در status:** در [repo.js:107](dashboard/lib/repo.js) (`status`) برای مسیر لوکال، علاوه بر `cloned`، فیلدهای زیر را اضافه کن:
   - `hasGit` = آیا `.git` وجود دارد (`fs.existsSync(path.join(dir,'.git'))`).
   - `hasRemote` = آیا `remote.origin.url` ست شده (از `readGitRemote(dir)` موجود در [repo.js:98](dashboard/lib/repo.js)).
   - `needsGitConnect` = `isLocalPath && (!hasGit || !hasRemote)`.
2. **backend — endpoint جدید `POST /api/repo/connect`** در `server.js` (کنار `/api/clone`):
   - ورودی: `{ projectId, remoteUrl }`.
   - تابع جدید در `repo.js`: `async function connectGit(localPath, remoteUrl)`:
     - اعتبارسنجی: `localPath` باید مسیر لوکال موجود باشد؛ `remoteUrl` باید گیت‌هابی معتبر باشد (از `parseRemoteSlug` در [repo.js:85](dashboard/lib/repo.js) استفاده کن).
     - اگر `.git` نیست: `git -C dir init` سپس `git -C dir add -A` و `git -C dir commit -m "initial commit"` (با ست‌کردن user.name/email مثل [repo.js:189-190](dashboard/lib/repo.js)؛ اگر چیزی برای commit نبود رد شو).
     - `git -C dir remote add origin <authUrl>` (از `buildAuthUrl` با توکن — [repo.js:35](dashboard/lib/repo.js)). اگر origin از قبل بود `remote set-url`.
     - تشخیص نام برنچ فعلی، سپس `git -C dir push -u origin HEAD`.
     - خروجی redact شده (توکن لو نرود — `redact` در [repo.js:41](dashboard/lib/repo.js)).
   - بعد از موفقیت، `store.updateProject(pid, { repo })` را **تغییر نده** (مسیر لوکال باقی می‌ماند)؛ فقط `githubRepo` از `.git/config` در `status` بعدی خودکار پیدا می‌شود ([repo.js:129-131](dashboard/lib/repo.js)).
3. **frontend — دیالوگ اتصال گیت:** در `renderRepo` ([app.js:882-892](dashboard/public/app.js)، شاخه‌ی `isLocal`) وقتی `r.needsGitConnect===true`:
   - یک دکمه «اتصال به گیت‌هاب» نشان بده.
   - کلیک → یک modal سبک (می‌تواند از همان الگوی `settingsOverlay` در [index.html:247](dashboard/public/index.html) کپی شود) با یک input برای URL (`owner/repo` یا URL کامل) + دکمه‌ی «اتصال و پوش».
   - submit → `POST /api/repo/connect` → روی موفقیت `renderRepo` دوباره.
   - i18n: کلیدهای فارسی/انگلیسی جدید در شیء ترجمه‌ی [app.js:1-220](dashboard/public/app.js) (مثل `connectGit`, `connectGitDesc`, `gitUrlPlaceholder`, `connectAndPush`).

### راستی‌آزمایی
- یک پوشه‌ی لوکالِ بدون `.git` به‌عنوان پروژه بساز → تب ریپو دکمه‌ی «اتصال به گیت‌هاب» بدهد.
- یک repo خالی روی گیت‌هاب بساز، URLش را بده → بعد از اتصال، روی گیت‌هاب کامیت اولیه دیده شود و تب ریپو برنچ‌ها + `githubRepo` را نشان دهد.
- پوشه‌ی لوکالِ با `.git` ولی بدون remote → فقط remote add + push شود (init نشود).

---

## ۳) دیدن همه برنچ‌ها + checkout روی هرکدام + پوشِ تسک‌ها روی همان برنچ

### وضعیت فعلی
- برنچ‌ها فقط **نمایش** داده می‌شوند (read-only) — حلقه‌ی رندر در [app.js:938-948](dashboard/public/app.js)؛ `current`/`default` تگ می‌خورند ولی دکمه‌ی checkout نیست.
- backend برنچ‌ها را از کلون لوکال می‌خواند ([repo.js:73-82](dashboard/lib/repo.js) `localBranches`، شامل `current`).
- جریان agent **برنچ کاربر را نادیده می‌گیرد**: همیشه `task/<cardId>` از `origin/develop` می‌سازد و PR به `develop` می‌زند ([owner.js:69](dashboard/lib/owner.js)، [claude-bridge.js:294-329](claude-bridge.js)).

### شکاف
الف) checkout یک برنچ.  ب) ذخیره‌ی «برنچ فعالِ پروژه».  ج) اینکه وقتی تسک/چت‌ـ agent اجرا شد، روی **همان برنچ انتخابی** کار و push کند (نه `task/<cardId>` → develop).

### تغییرات
1. **store — برنچ فعال پروژه:** در [store.js:63-73](dashboard/lib/store.js) (`updateProject`) اجازه‌ی فیلد جدید `branch` را بده (مثل `name`). مدل پروژه → `{ ..., branch }`.
2. **backend — endpoint checkout `POST /api/checkout`** در `server.js`:
   - ورودی `{ projectId, branch }`.
   - تابع `repo.checkout(repoOrPath, branch)` جدید در `repo.js`:
     - `dir = repoDir(slug)`؛ باید `.git` داشته باشد.
     - `git -C dir fetch origin` (اگر remote دارد، بهتر است؛ best-effort).
     - `git -C dir checkout <branch>`؛ اگر برنچ لوکال نبود ولی `origin/<branch>` بود: `git -C dir checkout -B <branch> origin/<branch>`.
     - خروجی: `status(repo)` تازه (تا `current` به‌روز شود).
   - بعد از موفقیت `store.updateProject(pid, { branch })`.
3. **frontend — دکمه checkout:** در حلقه‌ی [app.js:938-948](dashboard/public/app.js) برای هر برنچی که `!isCur` است یک دکمه‌ی کوچک «checkout» اضافه کن → `POST /api/checkout` → `renderRepo(res)`. برنچ جاری با تگ `current` می‌ماند.
4. **اجرای تسک روی برنچ انتخابی (هسته‌ی خواسته) — دو گزینه:**
   - **گزینه‌ی A (کم‌ریسک، توصیه‌شده برای شروع):** یک حالت «direct» در پل اضافه کن که روی برنچ فعلیِ checkoutشده کار و push کند، بدون PR/Trello. (به بخش ۴ گره می‌خورد چون مسیر چت آزاد → agent هم همین را می‌خواهد.) جزئیات:
     - **bridge — endpoint `POST /agent`** در `claude-bridge.js` (الگوبرداری از `handleCodeTask` در [claude-bridge.js:299](claude-bridge.js) ولی ساده‌تر):
       ورودی `{ dir, task, push:boolean, commitMessage, imagePath? }`.
       - `dir` را مستقیم استفاده کن (پروژه از قبل لوکال موجود است — خواسته‌ی ۱). **`ensureWorkspace`/checkout `develop` را صدا نزن** تا برنچ فعلی کاربر دست‌نخورده بماند.
       - `runEngineInDir(engine, prompt, dir)` ([claude-bridge.js:241](claude-bridge.js)) را اجرا کن.
       - اگر `push===true`: `git add -A` → اگر تغییری بود `commit` → `git push origin HEAD` (روی همان برنچ جاری). خروجی `{ ok, branch:<current>, filesChanged, pushed }`.
     - **dashboard — endpoint `POST /api/agent`** که `dir` پروژه را از `repo.status` می‌گیرد و به پل forward می‌کند، و خروجی agent را با `store.appendMessage` در سشن ذخیره می‌کند (مثل `withRun` در [server.js:62](dashboard/server.js)).
   - **گزینه‌ی B (تغییر جریان موجود):** در `owner.runCodeTask` ([owner.js:54](dashboard/lib/owner.js)) و `handleCodeTask` ([claude-bridge.js:299](claude-bridge.js))، به‌جای `branch = 'task/'+cardId` و base `develop`، اگر پروژه `branch` دارد از همان استفاده کن و PR را اختیاری کن. این تغییر بزرگ‌تر است و رفتار Trello/PR را عوض می‌کند — فقط اگر کاربر صراحتاً جریان Trello را هم می‌خواهد روی برنچ انتخابی ببرد.
   - **توصیه:** گزینه‌ی A را پیاده کن (با خواسته‌های ۴ و ۵ هم‌خوان است)؛ گزینه‌ی B را به‌عنوان فاز بعدی علامت بزن.

### راستی‌آزمایی
- تب ریپو → کنار هر برنچ دکمه‌ی checkout → بزن → `current` به آن برنچ منتقل شود و `git -C dir branch` تأیید کند.
- یک تسک/چتِ agent اجرا کن (گزینه A) → کامیت روی **همان برنچ جاری** بنشیند و `git push` روی همان برنچ origin برود (نه develop، نه `task/...`).

---

## ۴) چت آزاد و پاسخ مدل

### وضعیت فعلی
- composer → `POST /api/command` → `owner.runCommand` فقط دستور می‌فهمد؛ متن آزاد = «دستور شناخته نشد» ([owner.js:688-718](dashboard/lib/owner.js)).
- پل از قبل چت می‌تواند: `POST /v1/messages` → `runActive` ([claude-bridge.js:418-446](claude-bridge.js))؛ و `claude.js` wrapper آن است.

### شکاف
- مسیر «چت آزاد» از composer وجود ندارد. باید متنِ غیردستور به مدل برود و پاسخ در سشن ذخیره و رندر شود.

### تغییرات — دو حالت پیشنهادی (با یک toggle در composer)
1. **حالت چت ساده (پرسش/پاسخ، بدون تغییر فایل):**
   - **backend — `POST /api/chat`** در `server.js`: ورودی `{ projectId, sessionId, text }`.
     - `store.appendMessage(pid,sid,{role:'user',text})`.
     - فراخوانی `claude(text, maxTokens)` از [claude.js](dashboard/lib/claude.js) (که به `config.bridge` می‌زند).
     - `store.appendMessage(pid,sid,{role:'agent',text:reply})` و برگرداندن پاسخ.
   - این مسیر برای پرسش‌های عمومی/برنامه‌ریزی است و فایلی را تغییر نمی‌دهد.
2. **حالت agent (چت که روی repo عمل می‌کند):** همان `POST /api/agent` از بخش ۳ (گزینه A) — متن کاربر را به‌عنوان `task` به checkout می‌فرستد، با `push` اختیاری.
3. **frontend — مسیر دادن متن composer:** در `send()` ([app.js:1439-1460](dashboard/public/app.js)) منطق تشخیص:
   - اگر متن با الگوی دستور شروع شد (`idea`/`fix:`/`feature:`/`/...`) → مثل الان `POST /api/command`.
   - وگرنه → بسته به یک toggle «چت / agent» (یک کلید کوچک کنار `sendBtn` در [index.html:112-119](dashboard/public/index.html))، به `POST /api/chat` یا `POST /api/agent` برود.
   - اکوی خوش‌بینانه‌ی پیام کاربر از قبل هست ([app.js:1449](dashboard/public/app.js))؛ فقط بعد از پاسخ `refreshActivity` صدا زده شود (هست).
4. **placeholder/راهنما:** متن placeholder در [index.html:108](dashboard/public/index.html) و `quick` chips را به‌روزرسانی کن تا حالت چت آزاد هم معلوم باشد.

### راستی‌آزمایی
- در composer یک جمله‌ی آزاد بنویس (مثلاً «این پروژه چی کار می‌کنه؟») → پاسخ مدل در تایم‌لاین سشن بیاید و در `data/.../messages/<sid>.json` ذخیره شود.
- دستورهای قبلی (`fix:`، `/report`) همچنان مثل قبل کار کنند (regress نکند).

---

## ۵) آپلود عکس دیزاین

### وضعیت فعلی
- هیچ ورودی فایلی نیست؛ composer فقط `textarea` است ([index.html:102-121](dashboard/public/index.html)).
- پل فقط متن می‌گیرد؛ `runActive`/`runCli` متن از stdin می‌دهند ([claude-bridge.js:81-104](claude-bridge.js)).
- **اهرم مهم:** agent ‌CLI داخل checkout ابزار `Read` دارد و می‌تواند فایل عکس روی دیسک را بخواند ([claude-bridge.js:184](claude-bridge.js) — `--allowedTools Read ...`). پس ساده‌ترین مسیر vision = **ذخیره‌ی عکس روی دیسک و دادن مسیرش به agent تا با Read بخواندش** (نیازی به تغییر پروتکل API نیست).

### تغییرات
1. **frontend — انتخاب/کشیدن عکس:**
   - یک `<input type="file" accept="image/*">` مخفی + دکمه‌ی گیره کنار `sendBtn` ([index.html:112-119](dashboard/public/index.html))، و drag-drop روی `composerBox`.
   - پیش‌نمایش thumbnail بالای composer + امکان حذف.
   - هنگام `send`، فایل را به‌صورت base64 (یا `multipart/form-data`) همراه متن بفرست.
2. **backend — endpoint آپلود `POST /api/upload`** در `server.js`:
   - بدنه را بخوان (برای base64 ساده‌تر است چون سرور بدون وابستگی است و `readBody` متن می‌خواند — [server.js:203](dashboard/server.js))، در `data/uploads/<projectId>/<uuid>.<ext>` ذخیره کن.
   - خروجی: `{ ok, path:<absolutePath> }`.
   - محدودیت اندازه (مثلاً ۱۰MB) و whitelist پسوند (png/jpg/jpeg/webp).
3. **اتصال به agent:** در `POST /api/agent` (بخش ۳/۴) فیلد `imagePath` را بپذیر؛ در ساخت prompt برای agent، خط زیر را اضافه کن:
   - «یک تصویر دیزاین در مسیر `<imagePath>` هست؛ با ابزار Read آن را بررسی کن و طبق آن پیاده‌سازی کن.»
   - برای اینکه agent اجازه‌ی Read خارج از checkout را داشته باشد، بهتر است عکس را **داخل پوشه‌ی پروژه** (مثلاً `<dir>/.design/`) کپی کنی تا داخل working tree و در دسترس Read باشد (و در `.gitignore` پروژه استثنا شود یا commit نشود).
4. **چت ساده + عکس (اختیاری):** `runActive` فقط متن است؛ اگر بخواهی در حالت چت ساده هم عکس را تحلیل کند، یا (الف) همان مسیر agent+Read را استفاده کن، یا (ب) `claude-bridge.js` را توسعه بده تا content آرایه‌ای با `{type:'image', source:{...}}` را به CLI پاس دهد — این بزرگ‌تر است؛ فاز بعدی.

### راستی‌آزمایی
- یک PNG دیزاین را در composer بکش/آپلود کن → thumbnail دیده شود → ارسال کن.
- فایل در `data/uploads/...` ذخیره شود و در پوشه‌ی پروژه کپی شود.
- agent در پاسخ نشان دهد که عکس را Read کرده و بر اساس آن کد/توضیح تولید کرده.

---

## ترتیب پیشنهادی اجرا
1. **خواسته ۱** (auto-clone) — پایه‌ی بقیه است؛ تضمین می‌کند پروژه همیشه لوکال موجود است.
2. **خواسته ۳-checkout** (store.branch + `/api/checkout` + دکمه) — کوچک و مستقل.
3. **خواسته ۴ + ۳-agent** با هم: `POST /agent` در پل و `POST /api/agent` + `POST /api/chat` در سرور + مسیر‌دهی composer. (هسته‌ی «کار/پوش روی برنچ انتخابی» و «چت آزاد».)
4. **خواسته ۵** (آپلود عکس) روی همان مسیر agent سوار شود.
5. **خواسته ۲** (اتصال گیتِ پروژه‌ی لوکال) — مستقل؛ هر زمان.

## نکات و ریسک‌ها
- **توکن لو نرود:** در هر دستور git جدید حتماً از `redact` ([repo.js:41](dashboard/lib/repo.js)، [claude-bridge.js:153](claude-bridge.js)) استفاده شود.
- **قفل per-repo:** عملیات نوشتنی هم‌زمان روی یک checkout با `withRepoLock` ([claude-bridge.js:273](claude-bridge.js)) و `running` map در سرور ([server.js:61](server.js)) هماهنگ شود تا تداخل نشود.
- **agent فقط CLI/Aider:** موتورهای HTTP خالص (GapGPT بدون Aider) agent نیستند ([claude-bridge.js:308-311](claude-bridge.js))؛ برای چت ساده مشکلی نیست ولی برای `/agent` همان گارد فعلی را نگه دار.
- **headless/remote:** Browse و auto-clone فقط روی همان مکِ کاربر معنی دارند (مثل نکته‌ی FIX-PLAN).
