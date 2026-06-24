# Autonomous Startup with N8N — Full Setup Guide from Scratch

This document is everything you need to set up the system from scratch. The system is a "virtual software team": you pitch an idea in the **Bale** messenger, and three workflows in **N8N** play the roles of Product Owner, Developer, and Tech Lead — they write the code on **GitHub**, run tests, open PRs, and review them. All the thinking work runs on **Claude** (via a Pro subscription and a local bridge) — without any paid API token.

Contents:
- Section 1: Tokens and keys you need to gather
- Section 2: Installing prerequisites
- Section 3: Configuring the flows and how to use them
- Section 4: Technical docs — exactly what happens behind the flows

---

## Section 1 — Tokens and Keys You Need to Gather

All of these values are stored in a single `secrets.env` file next to the project. **Never commit this file to git.**

| Key | Where from | Description |
|------|--------|-------|
| `BALE_BOT_TOKEN` | BotFather bot in Bale | Create a bot (`/newbot`), grab the token |
| `OWNER_CHAT` | Bale getUpdates method | your own chat id (explained below) |
| `TRELLO_KEY` | trello.com/app-key | API key |
| `TRELLO_TOKEN` | authorize link (below) | write-access token (not the Secret) |
| `TRELLO_BOARD_ID` | board URL | board id |
| `TRELLO_LIST_TODO` and 4 other lists | lists API | the ids of the five columns |
| `GITHUB_TOKEN` | GitHub → Tokens (classic) | classic token with `repo` scope |

> **Note:** You no longer need `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` — the entire thinking layer runs on Claude Code (Pro subscription) via the local bridge.

### Getting the Bale token and chat id
1. In Bale, open the **BotFather** bot → `/newbot` → give a name and username → grab the token → `BALE_BOT_TOKEN`.
2. Send a message to your own bot (e.g. `/start`).
3. Open this address in a browser (insert your own token): `https://tapi.bale.ai/bot<TOKEN>/getUpdates`
4. In the JSON response, look for `chat.id` → `OWNER_CHAT`.

### Getting the Trello token and ids
1. Create a board with **five lists**: `To Do`, `In Progress`, `Waiting API`, `In Review`, `Owner Review`.
2. Grab `TRELLO_KEY` from <https://trello.com/app-key>.
3. Create the token with this address (insert your own Key) and click Allow:
   `https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&key=<KEY>`
4. Board id: open the board, grab the short id from the URL (e.g. `trello.com/b/<BOARD_ID>/...`).
5. List ids: open this address and grab the id of each list:
   `https://api.trello.com/1/boards/<BOARD_ID>/lists?fields=name,id&key=<KEY>&token=<TOKEN>`

### Getting the GitHub token
GitHub → Settings → Developer settings → **Tokens (classic)** → Generate new token → check only **`repo`** → create → `GITHUB_TOKEN`.
(A classic token is more reliable than a fine-grained one because it grants git push, Contents, and PRs all at once.)

### Sample `secrets.env` file
```
# Bale
BALE_BOT_TOKEN=...
OWNER_CHAT=...
# Trello
TRELLO_KEY=...
TRELLO_TOKEN=...
TRELLO_BOARD_ID=...
TRELLO_LIST_TODO=...
TRELLO_LIST_INPROGRESS=...
TRELLO_LIST_WAITING=...
TRELLO_LIST_INREVIEW=...
TRELLO_LIST_OWNER=...
# GitHub
GITHUB_TOKEN=ghp_...
```

---

## Section 2 — Installing Prerequisites

On the same Mac/system where you run N8N:

### 1) Docker
Install Docker Desktop (docker.com). N8N runs inside a container.

### 2) Node.js (version 18 or higher)
Required to run the "Claude bridge".
```
node -v        # must be ≥ 18
# if not: brew install node  or from nodejs.org
```

### 3) Claude Code (the thinking layer — free with Pro)
```
npm install -g @anthropic-ai/claude-code@latest
claude            # run once, then /login → "Log in with Claude account" (Pro subscription)
claude -p "test" --output-format json   # should respond
```
> You need a **Claude Pro/Max** subscription. The free plan has no Claude Code. This section replaces the API token.

---

## Section 3 — Configuring the Flows and How to Use Them

### Step 1: Files
Folder structure:
```
ai-startup-n8n/
├── README.md
├── SETUP-COMPLETE.md      (this file)
├── docker-compose.yml
├── claude-bridge.js
├── secrets.env            (keys — do not commit to git)
├── stacks/                 (per-platform stack — editable by you)
│   ├── backend.md
│   ├── frontend.md
│   └── mobile.md
└── workflows/
    ├── workflow-1-product-owner.json
    ├── workflow-2-developer.json
    └── workflow-3-tech-lead.json
```

> **Configurable stack:** the technology for each platform is defined in `stacks/backend.md`, `stacks/frontend.md`, and `stacks/mobile.md`. Whatever text you write in these files is passed verbatim as instructions to the Developer/CI. Because n8n v2 does not allow `require('fs')` in a Code node, these files are served via **`claude-bridge.js`**: the bridge on the Mac exposes a `GET /stack/<track>` route that returns the contents of `stacks/<track>.md` (next to `claude-bridge.js` itself), and the workflows read it over HTTP (`http://host.docker.internal:8787/stack/...`). To change the stack (e.g. switch mobile from KMP to native Android), just edit that file — since it's read at runtime, there's no need to restart N8N (only `claude-bridge.js` must be running). If a file is missing, it falls back to the built-in default. No Docker mount or `NODE_FUNCTION_ALLOW_BUILTIN` setting is needed.

### Step 2: Start the Claude bridge (and keep it running)
In a separate terminal:
```
cd path/to/project
node claude-bridge.js      # should say: Claude bridge ready on http://localhost:8787
```
This bridge is a local server that mimics the shape of the Anthropic API but, behind the scenes, calls `claude -p` (Pro subscription). N8N connects to it from inside Docker via `http://host.docker.internal:8787`.

### Step 3: Bring up N8N
```
docker compose up -d
docker exec startup-n8n printenv TRELLO_KEY   # should print the key (means env was loaded)
```
Then go to `http://localhost:5679`.

Key points in `docker-compose.yml` (all preconfigured):
- `env_file: secrets.env` → keys are injected into the container.
- `extra_hosts: host.docker.internal:host-gateway` → access to the bridge on the host.
- `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` → allows using `$env` in nodes (without this, every node throws an "access to env vars denied" error).
- `N8N_RUNNERS_TASK_TIMEOUT=1800` → a 30-minute cap for Code nodes (because Claude is slow).

### Step 4: Import and Activate the workflows
In N8N: top menu → **Import from File** → all three files from the `workflows/` folder → then **Activate** all three.

### Step 5: Usage — the messages you send in Bale

**Start a new project (structured format):**
```
name: project name
repo: https://github.com/USER/REPO
link: https://reference.com   (optional)
idea: full description of what you want built
```
- Create the repo **empty in advance** on GitHub yourself; the system builds `main`+`develop`, the monorepo structure, and the CI file on its own.
- You can say website only, backend only, or mobile only — the system tasks out only those parts and picks the columns intelligently.

**Bug report:** `fix: the login button doesn't work`
**New feature:** `feature: add search`

`fix:` and `feature:` add a task to the same active project (the board is not cleared).

### The cycle you'll see
1. Bale says "Preparing…" and then sends the list of tasks.
2. Cards appear in Trello.
3. Every few minutes a task gets coded, a PR is opened against `develop`, and Bale reports "sent for review".
4. If the tests (CI) are green and the code is correct, the Tech Lead **merges** the PR into `develop` itself (squash), the task branch is deleted, the card moves to Owner Review (i.e. Done), and Bale reports "merged into develop".
5. If the automatic merge fails for any reason (e.g. branch protection), Bale reports "approved but auto-merge failed" and you merge manually.

---

## Section 4 — Technical Docs: What Happens Behind the Flows

### Overall architecture
```
Bale (you)  ──getUpdates──►  WF1 Product Owner ──► Trello (tasks) + GitHub (bootstrap repo)
                                                         │
                                                         ▼
                                   WF2 Developer ──► Claude (code+tests) ──► GitHub (branch/commit/PR to develop)
                                                         │
                                                         ▼
                                   WF3 Tech Lead ──► CI + conflict + review ──► Trello + Bale
                                                         │
                                                         ▼
                                          auto-merge into develop (squash)
```
Four external components: **Bale** (your interface), **Trello** (status board / work queue), **GitHub** (code + CI), and **the Claude bridge** (the brain). All three workflows run on **polling** (not webhooks) because N8N is on localhost and external services can't reach it with a webhook.

### The model layer
All the thinking decisions — judging whether an idea is valid, breaking it into tasks, writing code and tests, writing docs, and reviewing — are made by Claude via the local bridge. The bridge (`claude-bridge.js`) takes an Anthropic-style request, feeds its text to `claude -p --output-format json`, and returns the response back in the `{content:[{text}]}` shape. This way the N8N nodes think they're talking to the Anthropic API, but in reality the Pro subscription is being spent.

### Persisting project info (data model)
Since each project has its own repo and the three workflows are separate, project info is stored in **the description of each Trello card**; a footer like this:
```
---
repo: USER/REPO
project: project name
ref: reference link (optional)
```
WF2 and WF3 read this footer from the card to know which repo to work on. Each card's name is also in the form `[track][complexity] title` (track is one of backend/frontend/mobile), which is used for routing.

### Trello columns (statuses)
- **To Do**: ready for development.
- **In Progress**: a temporary lock during coding (so it isn't picked up twice).
- **Waiting API**: frontend/mobile tasks waiting for the backend's API docs to be ready. *If the project has no backend, this column is not used at all.*
- **In Review**: PR opened, waiting for Tech Lead review.
- **Owner Review**: approved and merged into develop (Done). If the auto-merge didn't happen, it means it's waiting for your manual merge.

### WF1 — Product Owner (trigger: every 1 minute)
1. **Receive and classify messages**: uses getUpdates to fetch new Bale messages (keeps the offset in static data so messages aren't reprocessed). Detects the message type: `fix:`, `feature:`, or a structured idea. Messages without a `name:`/`repo:`/`idea:` key are ignored.
2. **Product Owner (core logic)**:
   - For `fix`/`feature`: reads the active project's repo from the existing cards, creates a task with Claude, and adds it to To Do.
   - For a new idea:
     - **Single-project gate**: if the board has active tasks, the idea is rejected (one project at a time).
     - **Board cleanup**: all columns are emptied.
     - **Validation**: Claude judges whether the idea is real or just test text.
     - **Repo bootstrap**: ensures `main` exists, builds the monorepo structure (`backend/ frontend/ mobile/ docs/api/`), and generates and commits the `.github/workflows/ci.yml` file **dynamically with Claude based on the `stacks/` files** (build + test per part; if generation fails, it falls back to the built-in default CI). Then it creates the `develop` branch from `main`. A "CI set up" report is also sent in Bale.
     - **Task generation**: Claude breaks the idea into atomic tasks (only the needed parts), each with a track and complexity, plus one test task per part.
     - **Smart column selection**: if the project has a backend → backend goes in To Do and the rest in Waiting API. If there's no backend → everything goes straight to To Do.
     - The task list is sent in Bale.
   - **Commands**: `/start` or `/help` sends the usage guide. `/exit` (or `/stop`) is the emergency exit: all board cards are cleared so all three workflows stop (idle) and the active project fully halts. `/report` sends a per-task on-demand report right there (the same logic as the daily report, but on-demand and for the chat that requested it).
3. **Daily report** (cron trigger at 9 AM): reports **per task** — the task's topic, status and progress, the bugs it had, and how they were fixed. Data source: the card's name/description and its comments (it counts 🔴 bug comments and 🛠️ fix comments). If the report gets long, it's automatically split into chunks in Bale.

### WF2 — Developer (trigger: every 5 minutes)
1. Fetches the To Do list and sorts **backend first**; picks the first card and moves it to In Progress (lock).
   - **Bug-fix mode**: if the branch `task/<cardId>` already exists (meaning the card was created before and came back from review/CI), the Developer enters "fix mode": it reads the card's latest Trello comments (the error log) and the current code on the branch, and tells Claude to **fix the bug rather than rewrite from scratch**. It then commits on the same branch and opens a fresh PR.
2. Reads the repo and track from the card. For frontend/mobile, it reads the `docs/api/API.md` doc from `develop` and injects it into the prompt.
3. **Code generation**: Claude — with the stack instructions read from `claude-bridge.js` via a `GET /stack/<track>` request (the contents of `stacks/<track>.md`), falling back to the built-in default if unavailable — plus the requirement "all files under the package folder" and "at least 3 unit tests", returns an array of files (`{path, content}`).
4. **gitflow**: creates the `task/<cardId>` branch from **develop**, commits the files, and opens a **PR to develop**.
5. **Docs**: Claude generates a Markdown doc and commits it to `docs/<track>/<cardId>.md`. For backend, it additionally consolidates the doc into `docs/api/API.md` (the same one frontend/mobile read).
6. **Releasing dependencies**: after the last backend task finishes, the Waiting API cards are moved to To Do.
7. The card moves to In Review and a "sent for review" notification arrives in Bale.

### WF3 — Tech Lead (trigger: every 5 minutes)
For each card in In Review:
1. Finds the corresponding PR: fetches all open PRs to develop and picks the one whose `head.ref === task/<cardId>` (a robust method; replaces the previous fragile filter that sometimes failed to find the PR and skipped the review).
2. **Conflict**: if the PR conflicts with develop (`mergeable_state=dirty`) → Bale notification + close the PR + **comment on the Trello card + red "bug" label** + move the card back to To Do.
3. **CI (mandatory gate)**: no PR is reviewed or merged without CI passing. The GitHub Actions status on the latest commit is read:
   - No check has arrived yet → this round is skipped (waits); if the PR stays without CI for more than 20 minutes, a "CI didn't run" warning appears in Bale (but it is never approved/merged without CI).
   - Running → this round is skipped.
   - Failed (build or test) → Bale notification + close the PR + **the error log (from the output and annotations of the failed checks) as a comment on the Trello card + red label** + move the card back to To Do for a fix.
   - Green → continue to review.
4. **Code review**: Claude evaluates the diff against the task and the stack standard:
   - `APPROVE` → record an approving review + **auto-merge the PR into develop (squash)** + delete the task branch + move the card to Owner Review + a "merged" notification. If the auto-merge fails (e.g. branch protection), it falls back to a "merge manually" notification.
   - `REQUEST_CHANGES` → close the PR + **comment on the Trello card with the review text + red "bug" label** + move the card back to To Do + a correction notification. (On the final APPROVE, the red label is removed from the card.)

### CI / GitHub Actions
The `.github/workflows/ci.yml` file is built **dynamically by Claude based on the `stacks/` files** during bootstrap and runs on every **PR to develop**; three jobs (backend/frontend/mobile), each of which runs build and test only if its folder exists. Because CI is built from those same stacks, if you change a stack (e.g. `mobile.md`), CI in the next project is also generated automatically in sync with it. WF3 never approves/merges until CI is green, and on failure it puts the error log on the Trello card so the Developer can fix it in fix mode.

### gitflow
- `main`: the stable branch.
- `develop`: the integration branch; all PRs come here.
- `task/<cardId>`: each task's branch, forked from develop and PR'd to develop.
- the final merge to develop is done automatically by the Tech Lead (squash), provided CI is green and the review is approved; if you want to keep human control, set branch protection on develop in GitHub so the auto-merge is rejected and the system falls back to a manual merge.

### Resilience and debugging
- All HTTP calls inside Code nodes are guarded with try/catch.
- A resilient parser (`jparse`) extracts JSON from within the text even if Claude returns a little extra text.
- If a task isn't generated, the raw model response is shown in Bale.
- The Bale offset is stored in static data so a message isn't processed twice.

### Limitations and notes
- **The bridge must stay running**; if `claude-bridge.js` shuts down, the thinking layer stops working.
- **Slowness**: each step calls one or more `claude -p`; each task may take several minutes (which is why the timeout is 30 minutes).
- **Pro quota**: high volume may hit the Pro subscription's usage limit.
- **CI loop**: if a task's code keeps failing CI, that same task keeps getting rebuilt; you can steer it manually with `fix:`.
- **Security**: keep all tokens only in `secrets.env`, never commit them to git, and rotate them if they ever leak.

---

## Switching Models (if you want to change the model)

You have three options:

### Option 1 — Change the Claude model (the simplest)
The thinking layer is on Claude Code. To change the Claude model (e.g. from Opus to Sonnet for speed/cost):

**Method A — environment variable on the bridge:** the bridge (`claude-bridge.js`) reads the `CLAUDE_MODEL` variable. When running the bridge:
```
CLAUDE_MODEL=sonnet node claude-bridge.js
# or opus, haiku, or a full id like claude-sonnet-4-6
```
**Method B — inside Claude Code:** open `claude` in a terminal, run `/model`, and pick the model; the bridge uses that same one.

> The `model` field that the N8N nodes send (claude-opus-4-8) is **ignored** by the bridge; the actual model is determined by Claude Code. So you only need to configure the bridge/Claude Code — no need to touch the workflows.

### Option 2 — Switch back to a cloud API (Gemini / OpenAI / Anthropic API)
If you want to use a real API instead of the bridge:
1. In all three workflows, inside the Code nodes there's a constant like this:
   ```
   const CLAUDE_BRIDGE='http://host.docker.internal:8787/v1/messages';
   ```
   Change it to the target API's address, and modify the `claude(...)` function in that node so it builds/reads that API's body and response.
2. Put the API key in `secrets.env` (e.g. `GEMINI_API_KEY`) and use it in the header/query inside the `claude()` function.
3. Adapt the response shape: the function must return the generated text (for Anthropic: `content[0].text`, for Gemini: `candidates[0].content.parts[0].text`, for OpenAI: `choices[0].message.content`).

Since all the logic is in the Code node, you only change that `claude()` function in all three workflows and the rest stays untouched.

### Option 3 — Model tiering (a cheap model for simple work)
If you want simple work (task/doc generation) done with a cheaper model and complex code with a stronger model, add a `model` parameter to that same `claude()` function and pass the appropriate model on each call (e.g. task generation → sonnet, code generation → opus). This is optional and meant for cost/speed optimization.

---

## Frequently Used Commands

| Task | Command |
|-----|-------|
| Start the bridge | `node claude-bridge.js` |
| Bring up N8N | `docker compose up -d` |
| Rebuild with new settings | `docker compose up -d --force-recreate` |
| View N8N logs | `docker compose logs -n 50 startup-n8n` |
| Test the Bale connection | `docker exec startup-n8n sh -c 'wget -qO- https://tapi.bale.ai/bot$BALE_BOT_TOKEN/getUpdates; echo'` |
| Fully clear the Trello board | the archiveAllCards script (in the usage guide) |
