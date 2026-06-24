# 🤖 Autonomous Startup with N8N

A "virtual software team": you pitch an idea in **Bale** → three workflows in **N8N** play the roles of Product Owner, Developer, and Tech Lead → code is written, tested, PR'd, and reviewed on **GitHub**. All the thinking work runs on **Claude** (Pro subscription, no API token).

## 📁 Folder Structure
```
ai-startup-n8n/
├── README.md              ← this file (start here)
├── SETUP-COMPLETE.md      ← full setup guide from scratch + technical docs + model switching
├── docker-compose.yml     ← runs N8N with all settings
├── claude-bridge.js       ← local Claude bridge (the thinking layer)
├── secrets.env            ← keys (never commit to git)
├── stacks/                ← per-platform stack (editable: backend.md/frontend.md/mobile.md)
└── workflows/
    ├── workflow-1-product-owner.json
    ├── workflow-2-developer.json
    └── workflow-3-tech-lead.json
```

## ⚡ Quick Start (5 steps)
1. **Keys**: fill in `secrets.env` (Bale, Trello, GitHub) — details in `SETUP-COMPLETE.md` section 1.
2. **Start the Claude bridge** and keep it running:
   ```
   node claude-bridge.js
   ```
3. **Bring up N8N**:
   ```
   docker compose up -d
   ```
4. At `http://localhost:5679`, Import and Activate all three `workflows/*.json` files.
5. Send an idea in Bale:
   ```
   name: project name
   repo: https://github.com/USER/REPO
   idea: description of what you want built
   ```

## 🔑 Prerequisites
Docker · Node.js 18+ · Claude Code (logged in with a Pro subscription)

## 📖 More Details
Everything — obtaining tokens, installation, configuration, the technical docs behind the flows, and how to switch models — is in **`SETUP-COMPLETE.md`**.

## 💬 Bale Messages
- Start a project: a `name:`/`repo:`/`idea:` block (one project at a time; the previous board is cleared)
- Bug report: `fix: description of the problem`
- New feature: `feature: description of the feature`
- Emergency exit: `/exit` (full stop and cleanup of the active project)
- On-demand report: `/report` (a per-task report, right now)
- Help: `/start` or `/help`
