# Autonomous AI Task Agent — Design Spec
**Date:** 2026-06-06
**Status:** Approved for implementation

---

## 1. What We're Building (Plain English)

A personal command center you open on your phone or laptop. You drop tasks in throughout the day — "email my landlord," "find the cheapest flight to Miami in July," "download that report from the company portal." You set a priority (High / Medium / Low) and forget about it.

At night, an AI agent wakes up, reads your list, and works through tasks from highest to lowest priority. It connects to whatever tools it needs — Gmail to send emails, a browser to search the web or download files, your calendar to schedule things. If it hits something risky (a purchase) or something it doesn't have access to yet (needs a password or a new service connection), it pauses that task, moves it to the **"Needs You"** tab, and sends you a notification. Everything else it handles silently and leaves you a plain-English note explaining exactly what it did.

Completed tasks live in the **Done** tab with the agent's notes for 10 minutes, then quietly disappear.

---

## 2. The Dashboard (3 Tabs)

### Tab 1 — Queue
- All tasks you've added, sorted by priority (High → Medium → Low)
- Within the same priority, sorted by time added (oldest first)
- Each task card shows: title, priority badge, time added, optional description
- You can drag to reorder within a priority tier
- "Add Task" button always visible — opens a simple form: title, description, priority selector
- Tasks can be deleted or edited before the agent picks them up

### Tab 2 — Needs You (In Progress)
- Tasks the agent started but paused because it needs your input
- Each card shows: task title, the agent's note explaining WHY it stopped (e.g. "This task involves a purchase of ~$34. Approve?"), and two buttons: **Approve** / **Skip**
- Approving sends the agent back to finish the task (agent retries on next run or immediately)
- Skipping moves the task to Done with a "Skipped by user" note
- A push notification (or email) is sent to you whenever something lands here

### Tab 3 — Done
- Tasks the agent completed, with a full note from the agent (what it did, what it sent, what it found, any links)
- Cards are timestamped
- Each card auto-deletes exactly 10 minutes after the agent marked it complete
- A countdown timer is visible on each card ("Expires in 7m 32s")
- You cannot move tasks back from Done — they are read-only

---

## 3. Full Technical Architecture

```
YOUR PHONE / LAPTOP (any browser)
           │
           ▼
┌──────────────────────────┐
│     Next.js Frontend     │  Hosted on Vercel (free tier)
│  - 3-tab dashboard UI    │  URL: yourdomain.vercel.app
│  - Real-time updates     │  Accessible from any device
│  - Auth (magic link)     │
└────────────┬─────────────┘
             │ reads/writes via Supabase client
             ▼
┌──────────────────────────┐
│   Supabase (PostgreSQL)  │  Free tier — 500MB storage
│  - tasks table           │  Real-time subscriptions push
│  - notes table           │  updates to dashboard instantly
│  - credentials table     │  (no refresh needed)
│  - agent_runs table      │
└────────────┬─────────────┘
             │ Vercel Cron triggers nightly
             ▼
┌──────────────────────────┐
│      Night Agent         │  Serverless function on Vercel
│  (Orchestrator)          │  Runs nightly at 11:00 PM (user's timezone)
│  - Reads queue           │  Uses DeepSeek R1 via OpenRouter (free tier)
│  - Plans tool usage      │
│  - Executes tasks        │
│  - Writes notes back     │
└────────────┬─────────────┘
             │ uses tools dynamically
             ▼
┌──────────────────────────────────────────────────────────┐
│                        Tool Belt                         │
│                                                          │
│  WEB SEARCH      Brave Search API (free, 2k/mo)         │
│  EMAIL           Gmail API via OAuth (free)              │
│  BROWSER         Playwright — navigate, click, download  │
│  CALENDAR        Google Calendar API (free)              │
│  FILES           Node.js fs + cloud storage              │
│  NOTIFICATIONS   Email or push via Supabase Edge Fn      │
│  [FUTURE]        Slack, WhatsApp, Notion, GitHub...      │
└──────────────────────────────────────────────────────────┘
```

### Data Flow — What Happens Each Night

1. Vercel Cron fires at 11:00 PM
2. Night Agent fetches all tasks with status `queued`, ordered by priority then created_at
3. For each task:
   a. Agent reads the task title + description
   b. Agent decides which tools it needs (reasoning step)
   c. Agent executes using those tools
   d. If blocked (purchase detected, missing credential): sets status → `needs_confirmation`, writes a note explaining why, triggers notification
   e. If successful: sets status → `done`, writes a detailed note, sets `expires_at` = now + 10 minutes
4. A cleanup function runs every minute to delete rows where `expires_at` has passed

### Tool Selection Logic (How the Agent Decides)

The agent uses a simple reasoning prompt before acting on each task:
- Does this task involve sending a message? → Gmail, Slack
- Does this task involve looking something up? → Brave Search, Playwright
- Does this task involve downloading a file? → Playwright (full browser)
- Does this task involve spending money? → Pause, ask user
- Does this task require a service I haven't connected yet? → Pause, list what's needed

New tools/services get added as MCPs (Model Context Protocol connectors). The agent checks the list of available connectors at runtime — if it needs Gmail and Gmail is connected, it uses it. If not, it adds the task to "Needs You" with setup instructions for you.

---

## 3b. Workflow Memory (Learning From You)

The agent remembers how you like things done.

**The use case:** You say *"Read the notes in my ML folder on the Desktop, write flashcards in the format `term, definition\n term, definition\n term, definition`, then push them to Quizlet."*

The agent does it once. From then on, when you just say *"Make flashcards from my history folder"*, it knows:
- Read the source notes
- Use the same `term, definition\n` format
- Push to Quizlet via browser automation

**How it works:**
- After every successful task, the agent abstracts the steps into a reusable workflow and saves it to the `workflows` table
- Each workflow has a name (e.g. "make_flashcards"), trigger keywords (e.g. "flashcards", "study cards"), a parameter schema (e.g. `source_folder`), and an ordered list of steps (read files → format → push to Quizlet)
- When a new task comes in, the agent first searches workflows for a match. If found, it fills in the parameters and runs the saved steps — no questions asked
- If the user explicitly says "actually, this time use a different format," the agent creates a new variant workflow rather than overwriting

**You always control:** A "Workflows" page lists every saved workflow. You can rename, edit, or delete any of them.

---

## 4. Database Schema

```sql
-- Tasks (the core)
CREATE TABLE tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  description   TEXT,
  priority      TEXT CHECK (priority IN ('high', 'medium', 'low')) DEFAULT 'medium',
  status        TEXT CHECK (status IN ('queued', 'needs_confirmation', 'done', 'skipped')) DEFAULT 'queued',
  agent_note    TEXT,               -- What the agent did / why it stopped
  confirmation_prompt TEXT,         -- The question shown in "Needs You" tab
  created_at    TIMESTAMPTZ DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ         -- Set to completed_at + 10 min when done
);

-- Agent run logs (for debugging and transparency)
CREATE TABLE agent_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at  TIMESTAMPTZ DEFAULT now(),
  ended_at    TIMESTAMPTZ,
  tasks_completed INT DEFAULT 0,
  tasks_paused    INT DEFAULT 0,
  log         TEXT                  -- Full run log for debugging
);

-- Connected services (what tools the agent can use)
CREATE TABLE connectors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,        -- 'gmail', 'calendar', 'brave_search'
  status      TEXT CHECK (status IN ('connected', 'needs_setup')),
  config      JSONB,                -- Encrypted tokens, API keys
  added_at    TIMESTAMPTZ DEFAULT now()
);

-- Saved workflows (agent remembers how user likes things done)
CREATE TABLE workflows (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,         -- e.g. 'make_flashcards'
  description   TEXT,
  trigger_keywords TEXT[],              -- ['flashcards', 'study cards', 'quizlet']
  parameters    JSONB,                  -- {source_folder: 'string'}
  steps         JSONB NOT NULL,         -- ordered list of step objects
  created_at    TIMESTAMPTZ DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  use_count     INT DEFAULT 0
);
```

---

## 5. Authentication

- **Magic link login** (passwordless) via Supabase Auth
- You enter your email → you get a link → you're in
- No password to remember, works on any device
- Single-user for now (just you) — no multi-user complexity

---

## 6. Adding New Connectors (How the Agent Grows)

When the agent hits a task that needs a service it doesn't have:
1. It moves the task to "Needs You" with a message like: *"To do this I need access to your Gmail. Click here to connect it."*
2. You click the link → go through a one-time OAuth flow (like signing into Google)
3. The token is stored encrypted in the `connectors` table
4. Next run, the agent can use Gmail automatically

This is how you "teach" the agent new abilities over time without touching any code. Each connector is a plug-in.

**Connectors planned for v1:**
- Brave Search (web search — API key, no OAuth)
- Gmail (send/read email — Google OAuth)
- Google Calendar (create/read events — Google OAuth)
- Playwright (browser automation — built-in, no auth needed)

**Connectors for future versions:**
- Slack, WhatsApp, Notion, GitHub, Amazon, Spotify, Twitter/X

---

## 7. Competitors

### Direct Competitors

| Product | What It Does | Why It Falls Short |
|---|---|---|
| **Trello** | Visual task boards with cards and columns | No AI. You do all the work. It's just a pretty list. |
| **Notion AI** | Notes + AI writing assistant inside Notion | AI helps you write, not execute. It won't send emails or browse the web for you. |
| **Zapier / Make** | Automates workflows between apps | Powerful but rigid — you must pre-define every workflow. It can't reason about a new task it's never seen. |
| **AutoGPT / AgentGPT** | AI agent that runs tasks | No structured UI, no priority queue, no scheduled runs, no mobile dashboard. Experimental and hard to use. |
| **Hermes Agent** | Desktop AI with computer control | You have to be sitting there watching it. No scheduling, no phone access, no task queue. General-purpose chat, not a task manager. |
| **Lindy AI** | AI assistant that handles tasks | Subscription-based ($$$), limited free tier, closed ecosystem. |
| **Taskade** | AI-enhanced task manager | AI helps organize tasks, doesn't execute them autonomously. |

### Why This Project Is Better

1. **It actually does the work, automatically.** Not "here's a suggested reply" — it sends the email. Not "here are some flights" — it finds the cheapest one and gives you a booking link or confirms. Most competitors stop at assisting; this one executes.

2. **Zero-maintenance scheduling.** You add tasks whenever, the agent runs at night. You wake up to results. No other product in this space does scheduled, autonomous, multi-tool execution with a clean mobile-friendly UI.

3. **It learns your tool stack.** Add Gmail once, it always has Gmail. Add Slack, it always has Slack. The agent grows with you without you touching code.

4. **Free to run.** Every competitor in this space (Lindy, AutoGPT hosted, Zapier) charges $20–100/month. This runs on free tiers with only pennies of LLM cost.

5. **Designed for trust, not blind automation.** The "Needs You" tab isn't a failure state — it's the system being honest. It tells you exactly why it stopped and gives you one-click approval. No other tool has this UX pattern.

---

## 8. Success Metrics

These are the numbers that tell you whether the agent is actually good — not just working, but *useful*.

### Metric 1 — Task Completion Rate
**What it is:** Out of all tasks the agent attempted, how many did it finish without needing your help?
**How to measure:** `tasks with status 'done'` ÷ `total tasks attempted` × 100
**Target to be great:** **≥ 75%** completion without confirmation
**Where to see it:** Agent run log in Supabase, surfaced on a small stats bar in the dashboard

### Metric 2 — False Confirmation Rate
**What it is:** How often the agent asks you to confirm something it should have been able to handle on its own. (The agent being overly cautious wastes your time.)
**How to measure:** Manual tagging — after you approve something in "Needs You", you can flag "this didn't need my approval." Track the ratio over time.
**Target to be great:** **≤ 10%** of confirmations are unnecessary
**Where to see it:** Small feedback button on each "Needs You" card: "Did this really need my approval? Yes / No"

### Metric 3 — Agent Note Quality
**What it is:** After the agent runs, did it leave a clear, useful note explaining what it did? A bad agent says "Task completed." A great agent says "Sent email to john@example.com at 11:14 PM. Subject: Meeting Tomorrow. Attached the PDF from your Downloads folder."
**How to measure:** You rate each completed task note 👍 / 👎
**Target to be great:** **≥ 85%** thumbs-up rating
**Where to see it:** Thumbs up/down on each Done card, stored in Supabase

### Metric 4 — Nightly Run Reliability
**What it is:** Does the agent actually wake up every night and run without crashing?
**How to measure:** The `agent_runs` table logs every run. Count successful runs ÷ scheduled runs.
**Target to be great:** **≥ 98%** uptime (no more than ~1 failed run per 2 months)
**Where to see it:** A small indicator on the dashboard: "Last run: last night at 11:02 PM ✅"

### Metric 5 — Time Saved Per Week
**What it is:** The whole point. How many minutes of work did you not have to do because the agent did it?
**How to measure:** Estimate 5 minutes per completed task (conservative). Track `tasks_completed` per week. `weekly_tasks × 5 = minutes saved`.
**Target to be great:** **≥ 60 minutes saved per week** (12+ tasks completed autonomously)
**Where to see it:** Weekly summary card on dashboard: "This week the agent saved you ~1h 20m"

### Metric 6 — Tool Success Rate
**What it is:** When the agent tries to use a tool (Gmail, Playwright, Brave Search), does the tool actually work?
**How to measure:** Log each tool call as success or failure in the agent run log. `successful_tool_calls ÷ total_tool_calls × 100`
**Target to be great:** **≥ 95%** tool success rate
**Where to see it:** Agent run log detail page (debugging view)

### Summary Table

| Metric | How to Measure | Great = |
|---|---|---|
| Task Completion Rate | done ÷ attempted | ≥ 75% |
| False Confirmation Rate | flagged ÷ total confirmations | ≤ 10% |
| Agent Note Quality | 👍 ÷ total ratings | ≥ 85% |
| Nightly Run Reliability | successful runs ÷ scheduled | ≥ 98% |
| Time Saved / Week | tasks × 5 min | ≥ 60 min |
| Tool Success Rate | successful calls ÷ total calls | ≥ 95% |

---

## 9. Full Task Breakdown for Implementation

Every task below is atomic — an AI agent or developer can pick up any single task and complete it independently.

### Phase 1 — Project Scaffolding
1. Initialize Next.js 14 app with TypeScript and Tailwind CSS
2. Connect project to Vercel, set up automatic deployments from GitHub
3. Create Supabase project, configure environment variables in Vercel
4. Run database migrations to create `tasks`, `agent_runs`, and `connectors` tables
5. Enable Supabase real-time on the `tasks` table
6. Set up Supabase Auth with magic link (email OTP)
7. Create login page — email input, "Send magic link" button, confirmation screen
8. Create auth middleware to protect all dashboard routes

### Phase 2 — Dashboard UI
9. Build the root layout with a 3-tab navigation bar (Queue / Needs You / Done)
10. Build the Queue tab — fetches tasks with status `queued`, renders them sorted by priority then created_at
11. Build the task card component — shows title, priority badge (color-coded), time added, description (collapsed by default)
12. Build the "Add Task" modal — form with title (required), description (optional), priority selector (High/Medium/Low), submit button
13. Build drag-to-reorder within priority tiers on the Queue tab (updates order in DB)
14. Build the "Needs You" tab — fetches tasks with status `needs_confirmation`, renders confirmation prompt, Approve / Skip buttons
15. Build the "Done" tab — fetches tasks with status `done`, renders agent note, countdown timer to expiry
16. Wire real-time Supabase subscriptions so all three tabs update instantly without refresh
17. Build the "Last run" status bar at the bottom of the dashboard (timestamp + success/fail indicator)
18. Build the task expiry cleanup — a Supabase Edge Function that runs every minute and deletes done tasks past their `expires_at`
19. Make the dashboard fully responsive for mobile (phone-first layout)
20. Add empty states for each tab ("No tasks queued yet — add one above", etc.)

### Phase 3 — Night Agent Core
21. Create the Vercel Cron job configuration — fires daily at 11:00 PM UTC
22. Create the `/api/agent/run` serverless function — the entry point the cron calls
23. Write the task fetcher — queries Supabase for all `queued` tasks ordered by priority then created_at
24. Integrate OpenRouter API client with DeepSeek R1 as the default model
25. Write the task reasoning prompt — given a task title and description, the agent outputs: what tools it needs, what steps it will take, any risks it sees
26. Write the task executor loop — iterates tasks, runs reasoning, dispatches to tool handlers, writes results back
27. Write the purchase/risk detector — scans agent reasoning output for signals like "buy", "order", "pay", "subscribe" and flags for confirmation
28. Write the missing-connector detector — checks required tools against the `connectors` table, flags tasks needing unconnected services
29. Write the agent note formatter — takes raw execution output and formats it into a clean, plain-English summary
30. Write the agent run logger — creates an `agent_runs` row at start, updates it at end with counts and full log

### Phase 4 — Tool Integrations
31. Integrate Brave Search API — function that takes a query string, returns top 5 results with titles and URLs
32. Integrate Playwright — headless browser function that can navigate to a URL, click elements, fill forms, download files, return page content
33. Integrate Gmail API — OAuth setup, function to send email (to, subject, body), function to read latest N emails
34. Integrate Google Calendar API — function to create event (title, date, time, attendees), function to list upcoming events
35. Build the connector registry — a map of connector name → handler function, loaded dynamically at agent runtime
36. Build the connector setup flow in the UI — a settings page showing all connectors and their status (connected / needs setup), with "Connect" buttons that trigger OAuth

### Phase 5 — Notifications
37. Build email notification — when a task moves to `needs_confirmation`, send an email to the user (via Gmail API or Resend free tier) with the task title and confirmation prompt
38. Add a notification settings page — user can set their email for notifications, and optionally a preferred notification time

### Phase 6 — Metrics & Transparency
39. Build the metrics bar — small stats section on the dashboard showing: completion rate this week, time saved this week, last run status
40. Add 👍 / 👎 rating buttons to Done tab cards, store ratings in Supabase
41. Add "Did this really need my approval?" feedback on Needs You cards, store in Supabase
42. Build the agent run detail view — click "Last run" to see full log of what the agent did, which tools it used, what succeeded/failed

### Phase 7 — Polish & Security
43. Encrypt all connector credentials (API keys, OAuth tokens) before storing in Supabase using a server-side secret
44. Add rate limiting to the `/api/agent/run` endpoint (max 1 run per hour, prevents abuse)
45. Add error boundaries to all UI components so a crash in one tab doesn't break the whole dashboard
46. Write end-to-end test: add a task → agent run → verify task moves to Done with a note
47. Set up Vercel preview deployments so every GitHub push gets its own test URL
48. Add a manual "Run agent now" button (for testing) — visible only in development mode or behind a secret URL
49. Final mobile QA pass — test on iOS Safari and Android Chrome
50. Deploy to production, set custom domain (optional), verify cron is firing correctly

---

## 10. Tech Stack Summary

| Layer | Technology | Cost |
|---|---|---|
| Frontend | Next.js 14 + TypeScript + Tailwind | Free |
| Hosting | Vercel (free tier) | Free |
| Database | Supabase PostgreSQL | Free |
| Real-time | Supabase Realtime | Free |
| Auth | Supabase Auth (magic link) | Free |
| LLM | DeepSeek R1 via OpenRouter | Free tier |
| Web Search | Brave Search API | Free (2k/mo) |
| Browser Automation | Playwright (open source) | Free |
| Email | Gmail API via OAuth | Free |
| Calendar | Google Calendar API | Free |
| Cron Jobs | Vercel Cron | Free |
| Notifications | Resend (free tier, 100/day) | Free |
| **Total** | | **~$0/mo** |

---

## 11. What Makes This Resume-Worthy

This project demonstrates skills that are rare in combination:

- **Full-stack development** — Next.js, TypeScript, PostgreSQL, real-time subscriptions
- **AI agent orchestration** — LLM reasoning loop, dynamic tool selection, multi-step execution
- **API integrations** — OAuth flows, Gmail, Calendar, third-party APIs
- **Browser automation** — Playwright for headless web interaction and file downloads
- **Serverless architecture** — Vercel functions, cron jobs, edge functions
- **Product thinking** — UX for trust (the confirmation flow), metrics design, expiry UX

**Resume description:**
> "Built an autonomous AI task agent with a real-time web dashboard. Implements nightly LLM-driven task execution using DeepSeek R1 via OpenRouter, with dynamic tool selection across Gmail, web search, and browser automation (Playwright). Features a priority queue, smart confirmation workflow for sensitive actions, and a live metrics system. Stack: Next.js, Supabase, Vercel, TypeScript."
