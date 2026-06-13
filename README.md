# Personal Agent

**Drop tasks. An AI agent does them while you sleep.**

A Trello-style dashboard where you queue prioritized tasks, and an LLM-powered agent works
through them autonomously using real tools — web search, browser automation, Gmail, Calendar,
and local files. It writes plain-English reports with cited links, learns repeatable workflows,
recovers from its own mistakes, and asks for help only when it genuinely needs it.

Built to run entirely on free tiers. Target cost: **$0/month**.

---

## Features

- **Autonomous task execution** — dynamic tool selection across search, Playwright browser
  automation, Gmail, Google Calendar, and the local file system.
- **Real-time streaming** — watch the agent plan and act live (`Planning… → Searching… → Found 3…`).
- **Self-healing recovery** — when a step fails, the agent reflects, replans, and tries a
  different approach (up to twice) before asking you.
- **Task decomposition** — big tasks ("plan my trip") split into ordered subtasks nested under a
  parent card.
- **Confidence scoring** — the agent rates each plan 0–100 and routes low-confidence tasks to you.
- **Workflow learning** — do something once and it saves the procedure, matched later by
  embedding similarity (with keyword fallback).
- **Agent memory** — learns your preferences ("prefers Amazon", "ML notes are in ~/Desktop/ML")
  and applies them on future tasks.
- **Natural-language + voice input** — type or dictate "cheap flight to Miami next month, urgent"
  and it fills in the task for you.
- **LLM observability** — every model call is logged (tokens, latency, est. cost) with an
  `/analytics` dashboard.
- **Negative-feedback learning** — thumbs-down with a note and the agent avoids that mistake next time.
- **Responsive UI** — tabbed on mobile, a 3-column board on desktop, with light animations.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind CSS |
| Database / Auth / Realtime | Supabase (PostgreSQL + RLS) |
| LLM | Groq (Llama 3.3 70B) primary → OpenRouter fallback |
| Embeddings (optional) | Google Gemini or Jina (free tiers) |
| Browser automation | Playwright (Chromium) |
| Web search | Brave Search API |
| Email / Calendar (optional) | Gmail + Google Calendar via OAuth |
| Hosting / Cron | Vercel |

---

## Quick start (local)

### 1. Prerequisites
- Node.js 18+
- A free [Supabase](https://supabase.com) project
- A free [Groq API key](https://console.groq.com) (and/or [OpenRouter](https://openrouter.ai))
- A free [Brave Search API key](https://brave.com/search/api/)

### 2. Clone and install
```bash
git clone https://github.com/<you>/personal-agent.git
cd personal-agent
npm install
npx playwright install chromium
```

### 3. Create the database
Open your Supabase project → **SQL Editor**, paste the entire contents of
[`supabase/schema.sql`](supabase/schema.sql), and click **Run**. This creates every table, the
row-level-security policies, the done-task expiry trigger, and the screenshots storage bucket.

### 4. Configure environment
```bash
cp .env.example .env.local
```
Fill in `.env.local`. The minimum to boot and run the agent:

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (the `service_role` secret — keep it private) |
| `NEXT_PUBLIC_ALLOWED_EMAIL` | the one email allowed to sign in (your own) |
| `GROQ_API_KEY` | console.groq.com |
| `BRAVE_SEARCH_API_KEY` | brave.com/search/api |
| `CRON_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

Optional: `OPENROUTER_API_KEY` (LLM fallback), `GEMINI_API_KEY` or `JINA_API_KEY` (semantic
workflow matching), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (Gmail + Calendar tools).

> **Access lock:** auth is restricted to `NEXT_PUBLIC_ALLOWED_EMAIL`. If you leave it blank,
> nobody can sign in. To support multiple users, turn `ALLOWED_EMAIL` in `src/lib/constants.ts`
> into a list and adjust the equality checks.

### 5. Run
```bash
npm run dev          # dashboard at http://localhost:3000
```
Sign in with the magic link sent to your allowed email, add a task (try *"Find the cheapest
weekend flight from Seattle to Portland in July"*), then run the agent on demand:
```bash
npm run agent:run    # processes the queue once, in your terminal
```
Refresh the dashboard — the task moves to **Done** (with a cited report) or **Needs You**.

---

## Deploy to Vercel

1. Push to GitHub (see below), then go to [vercel.com](https://vercel.com) → **Add New Project**
   → import the repo.
2. Under **Environment Variables**, add every key from your `.env.local`.
3. **Deploy.** Copy the resulting URL (e.g. `https://personal-agent-xxx.vercel.app`).
4. In **Supabase → Authentication → URL Configuration**, add that URL to **Site URL** and
   **Redirect URLs**.
5. If you use Google OAuth, add `https://your-url.vercel.app/api/connectors/google/callback` to
   the authorized redirect URIs in Google Cloud Console.

[`vercel.json`](vercel.json) schedules the cron jobs: `/api/agent/run` nightly at 04:00 UTC and
`/api/cleanup` to remove expired done tasks.

> **⚠️ Playwright on Vercel:** serverless functions can't run a bundled Chromium, so
> browser-automation tasks won't work on Vercel as-is. Options: (a) connect Playwright to a hosted
> browser like [browserless.io](https://browserless.io) — swap `chromium.launch()` for
> `chromium.connect(wsUrl)` in `src/lib/agent/tools/browser.ts`; (b) run the agent on a small VPS;
> or (c) deploy only the dashboard to Vercel and run `npm run agent:run` locally. Search,
> file, Gmail, and Calendar tools work fine on Vercel either way.

---

## Push to GitHub

With the [GitHub CLI](https://cli.github.com):
```bash
gh repo create personal-agent --public --source=. --remote=origin --push
```
---

## Commands

```bash
npm run dev          # local dashboard
npm run agent:run    # run the agent against the queue once
npm run build        # production build (typecheck + compile)
```

---

## License

[MIT](LICENSE).
