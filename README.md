# 🤖 استارتاپ خودگردان با N8N

یک «تیم نرم‌افزاری مجازی»: در **بله** ایده می‌دهی → سه ورک‌فلو در **N8N** نقش Product Owner، Developer و Tech Lead را بازی می‌کنند → کد در **GitHub** نوشته، تست‌گرفته، PR و ریویو می‌شود. کل کار فکری روی **Claude** (اشتراک Pro، بدون توکن API).

## 📁 ساختار فولدر
```
ai-startup-n8n/
├── README.md              ← همین فایل (شروع از اینجا)
├── SETUP-COMPLETE.md      ← راهنمای کامل ستاپ از صفر + مستند فنی + تعویض مدل
├── docker-compose.yml     ← اجرای N8N با همه‌ی تنظیمات
├── claude-bridge.js       ← پل محلی Claude (لایه‌ی فکری)
├── secrets.env            ← کلیدها (هرگز در گیت commit نکن)
├── stacks/                ← استک هر پلتفرم (قابل ویرایش: backend.md/frontend.md/mobile.md)
└── workflows/
    ├── workflow-1-product-owner.json
    ├── workflow-2-developer.json
    └── workflow-3-tech-lead.json
```

## ⚡ شروع سریع (۵ قدم)
1. **کلیدها**: `secrets.env` را پر کن (بله، Trello، GitHub) — جزئیات در `SETUP-COMPLETE.md` بخش ۱.
2. **پل Claude** را روشن کن و باز نگه‌دار:
   ```
   node claude-bridge.js
   ```
3. **N8N** را بالا بیاور:
   ```
   docker compose up -d
   ```
4. در `http://localhost:5679` هر سه فایل `workflows/*.json` را Import و Active کن.
5. در بله ایده بفرست:
   ```
   name: نام پروژه
   repo: https://github.com/USER/REPO
   idea: شرح چیزی که می‌خوای ساخته بشه
   ```

## 🔑 پیش‌نیازها
Docker · Node.js ۱۸+ · Claude Code (با اشتراک Pro لاگین‌شده)

## 📖 جزئیات بیشتر
همه‌چیز — گرفتن توکن‌ها، نصب، تنظیم، مستند فنی پشت فلوها، و نحوه‌ی تعویض مدل — در **`SETUP-COMPLETE.md`** آمده.

## 💬 پیام‌های بله
- شروع پروژه: بلوک `name:`/`repo:`/`idea:` (یک پروژه در هر زمان؛ برد قبلش پاک می‌شود)
- گزارش باگ: `fix: شرح مشکل`
- قابلیت جدید: `feature: شرح قابلیت`
- خروج اضطراری: `/exit` (توقف کامل و پاک‌سازی پروژه‌ی فعال)
- گزارش لحظه‌ای: `/report` (گزارش به ازای هر تسک، همان لحظه)
- راهنما: `/start` یا `/help`
