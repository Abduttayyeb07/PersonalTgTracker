# Personal Tracker — Telegram Bot

A multi-user Telegram bot for tracking **personal & professional** tasks with reminders and a **daily morning digest**. Think self-hosted Todoist/Skeddy, in chat.

- **Hybrid input** — type tasks in natural language (`Pay rent tomorrow 10am #personal !p1`) *or* use guided buttons (`/add`).
- **Categories** ("tabs") — Personal / Professional / custom, filterable.
- **Reminders** — one-off and recurring (daily/weekly/monthly), delivered at the due time.
- **Daily digest** — a morning summary of the day's tasks at your chosen hour (default 9am, your timezone).
- **Optional AI** — Amazon Bedrock parses free text when enabled, with automatic fallback to the built-in deterministic parser. Strict guardrails keep the model to pure extraction.
- **Multi-user** — each Telegram user gets isolated data.

## Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 22 + TypeScript |
| Bot framework | [grammY](https://grammy.dev) |
| Database | PostgreSQL + [Drizzle ORM](https://orm.drizzle.team) |
| NL date parsing | chrono-node (fallback) + Amazon Bedrock (optional) |
| Deploy | Docker Compose (bot + postgres) |

## Quick start (Docker — recommended for the server)

1. Create your bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. `cp .env.example .env` and fill in `BOT_TOKEN` (and Bedrock keys if using AI).
3. Generate the initial migration (one-time, needs Node locally):
   ```bash
   npm install
   npm run db:generate
   ```
4. Launch:
   ```bash
   docker compose up -d --build
   ```
   The bot container runs migrations on boot, then starts. Reminders keep firing as long as the container is up.

## Local dev (no Docker)

```bash
npm install
# point DATABASE_URL at a local postgres (host=localhost)
npm run db:generate   # create migration SQL from the schema
npm run db:migrate    # apply it
npm run dev           # hot-reload
```

## Commands

| Command | What it does |
|---|---|
| `/board` | Priority board — tasks grouped into **Critical · Important · Normal · Low** |
| `/add` | Guided add via buttons |
| just type | Natural-language quick add |
| `/today` `/week` `/all` `/overdue` | List views |
| `/task_<id>` | Open a task card (Done / Snooze / Edit / Delete) |
| `/whoami` | Your profile & private Telegram ID |
| `/timezone` | Set your IANA timezone (needed for correct reminder + digest times) |
| `/digest` | Set the digest hour (0–23) or turn it off |
| `/menu` `/help` | Menu / help |

## Weekly Update

For company weekly reports. Log rough notes through the week, then get a polished summary.

| Command | What it does |
|---|---|
| `/log <note>` | Log a piece of work to the current week (or `/log` alone to enter log mode) |
| `/weeklog` | View this week's raw notes |
| `/weekly` | Generate the **Weekly Update** from your notes |

The generated update comes with buttons:
- **✅ Approve & clear** — accept it and wipe this week's log
- **🔄 Regenerate** — try again
- **🛠 Technical / 💼 Business** — toggle detail level

**Auto-reset:** every **Sunday 23:59 (your timezone)** the bot generates the update, sends it to you, and clears the week so a fresh one begins. If the bot was offline at that moment, it catches up on next start (it targets the most recently *ended* week, never your ongoing one).

The summary is produced by Bedrock using your fixed prompt (heading "Weekly Update", action-verb bullets, business-friendly by default). If Bedrock is disabled it falls back to a plain bulleted list. See [src/services/weekly.ts](src/services/weekly.ts) and the prompt in [src/services/bedrock.ts](src/services/bedrock.ts).

## Privacy & the daily reset

- **Isolation:** every task is keyed to your Telegram user ID; a query can only ever return your own rows. `/whoami` shows the ID your data lives under.
- **Daily reset:** at local midnight the bot purges *finished* and *past one-off* tasks so each day starts clean — while **preserving recurring reminders** (daily/weekly/monthly) and any task dated today or later. Adjust the rule in `cleanupUserDay` ([src/services/store.ts](src/services/store.ts)) if you want different behaviour.

## Natural-language syntax

- `#work` / `#personal` / `#anything` → category (auto-creates custom ones)
- `!p1`..`!p4` → priority
- Dates: `tomorrow 9am`, `friday 3pm`, `every monday`, `25 dec`, `this weekend`

## Amazon Bedrock (optional AI)

Set in `.env`:

```
ENABLE_BEDROCK_API=true
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_BEDROCK_REGION=eu-central-1
AWS_BEDROCK_MODEL=qwen.qwen3-32b-v1:0
```

**Guardrails baked in:** the model is used only as a read-only extraction function (temperature 0, ~400 max tokens). It is instructed to ignore any instructions inside your note, never execute anything, and emit a single JSON object; every returned field is then re-validated and clamped in code. Any deviation → automatic fallback to the deterministic parser. For real least-privilege, give the IAM user **only** `bedrock:InvokeModel` on that one model.

> ⚠️ Never commit `.env`. If credentials are ever exposed, rotate them in IAM immediately.

## Data model

`users` (timezone, digest & reset bookkeeping) · `categories` (the tabs) · `tasks` (title, notes, due/remind time, priority, status, recurrence) · `week_entries` (weekly work log, keyed by ISO week). See [src/db/schema.ts](src/db/schema.ts).
