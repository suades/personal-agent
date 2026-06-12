# ToDo Agent — Complete Project Bible

> **Purpose:** This document contains everything a new Claude session needs to understand, maintain, and extend this project. It covers the full architecture, every component, every optimization already made, and 20 features to build next — each with clear implementation guidance.

---

## 1. What This Project Is

An autonomous AI task agent with a Trello-like web dashboard. The user adds tasks throughout the day (prioritized High/Medium/Low), and a night agent powered by a free LLM wakes up automatically, works through them using real tools (web search, browser automation, Gmail, Calendar, local files), writes plain-English notes on what it did, and marks them done. Completed tasks expire after 10 minutes.

The agent learns workflows — if you tell it once "make flashcards in this format and push to Quizlet," it saves that procedure and never asks again.

**Target audience for this doc:** An AI coding assistant starting a fresh session with no context. Everything needed to write code is here.

---

## 2. Tech Stack

| Layer | Technology | Why This Choice | Cost |
|---|---|---|---|
| Frontend | Next.js 14 + TypeScript + Tailwind CSS | SSR, App Router, fast mobile experience | Free |
| Database | Supabase (PostgreSQL) | Real-time subscriptions, built-in auth, RLS, free tier | Free |
| Auth | Supabase Magic Link | Passwordless, locked to one email via `ALLOWED_EMAIL` constant | Free |
| Primary LLM | Groq (Llama 3.3 70B) | Fastest free inference, 30 req/min, reliable | Free |
| Fallback LLM | OpenRouter (Llama 3.3 70B) | Many model choices, auto-failover if Groq is down | Free |
| Web Search | Brave Search API | 2,000 free queries/month, good quality | Free |
| Browser Automation | Playwright (Chromium) | Full browser: navigate, click, fill forms, download files | Free |
| Email | Gmail API via Google OAuth | Send/read emails programmatically | Free |
| Calendar | Google Calendar API via OAuth | Create/read events | Free |
| File System | Node.js fs | Read/write user's local files | Free |
| Hosting | Vercel | Auto-deploy from GitHub, serverless functions, cron jobs | Free |
| Cron | Vercel Cron | Fires `/api/agent/run` nightly at 4 UTC and `/api/cleanup` every minute | Free |

**Total monthly cost: ~$0**

---

## 3. Project Structure

```
ToDoAgent/
├── CLAUDE.md                           # AI assistant handoff doc (read by Claude automatically)
├── SETUP.md                            # Morning setup checklist for human
├── README.md
├── .env.local                          # All secrets (gitignored)
├── .env.example                        # Template
├── vercel.json                         # Cron config
├── package.json
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
│
├── docs/
│   ├── PROJECT_BIBLE.md                # ← THIS FILE
│   └── superpowers/specs/
│       └── 2026-06-06-autonomous-task-agent-design.md  # Original design spec
│
├── supabase/migrations/
│   ├── 001_init.sql                    # Core schema: tasks, agent_runs, connectors, workflows
│   └── 002_agent_steps_feedback.sql    # Added: agent_steps JSONB, user_feedback TEXT
│
├── scripts/
│   └── run-agent-local.ts              # `npm run agent:run` — test agent locally
│
└── src/
    ├── app/
    │   ├── layout.tsx                  # Root layout (dark theme, meta)
    │   ├── page.tsx                    # Dashboard (redirects to /login if no session)
    │   ├── globals.css                 # Tailwind + priority badge colors
    │   ├── login/page.tsx              # Magic link login (locked to ALLOWED_EMAIL)
    │   ├── auth/callback/route.ts      # Supabase auth callback
    │   ├── settings/
    │   │   ├── page.tsx                # Server component: fetches connectors
    │   │   └── SettingsClient.tsx      # Client: shows Gmail/Calendar connect buttons
    │   ├── workflows/
    │   │   ├── page.tsx                # Server: fetches workflows
    │   │   └── WorkflowsClient.tsx     # Client: lists workflows with delete
    │   └── api/
    │       ├── agent/run/route.ts      # Cron entry point — runs agent for all users with queued tasks
    │       ├── cleanup/route.ts        # Deletes expired done tasks
    │       └── connectors/google/
    │           ├── start/route.ts      # Initiates Google OAuth flow
    │           └── callback/route.ts   # Receives OAuth code, stores tokens
    │
    ├── components/
    │   ├── Dashboard.tsx               # Main layout: header, metrics bar, tab bar, content
    │   ├── TabBar.tsx                  # Queue / Needs You / Done tabs with counts
    │   ├── TaskCard.tsx                # Reusable card: priority badge, title, expandable description, step log
    │   ├── QueueTab.tsx                # Tasks grouped by priority, delete button
    │   ├── NeedsYouTab.tsx             # Confirmation cards: approve/skip, feedback flag, agent note display
    │   ├── DoneTab.tsx                 # Completed tasks with notes, citations, countdown, 👍/👎 + feedback
    │   ├── AddTaskModal.tsx            # Bottom-sheet modal: title, description, priority selector
    │   ├── MetricsBar.tsx              # "Last run" status + "X done · ~Ym saved this week"
    │   └── LinkifyText.tsx             # Renders markdown links and raw URLs as clickable <a> tags
    │
    └── lib/
        ├── constants.ts                # ALLOWED_EMAIL = 'suadesai17@gmail.com'
        ├── types.ts                    # Task, Workflow, WorkflowStep, Connector, AgentRun, AgentStep
        ├── supabase/
        │   ├── client.ts               # Browser-side Supabase client
        │   └── server.ts               # Server-side client + supabaseAdmin() (service role, bypasses RLS)
        └── agent/
            ├── orchestrator.ts         # THE BRAIN — plans, executes, logs, saves workflows
            ├── llm.ts                  # Groq primary → OpenRouter fallback, auto-retry
            ├── workflows.ts            # findMatchingWorkflow, maybeSaveWorkflow, bumpWorkflowUsage
            ├── connectors.ts           # Tracks which tools are available per user
            └── tools/
                ├── search.ts           # braveSearch(query) → SearchResult[]
                ├── browser.ts          # Playwright: open, navigate, read, click, fill, press, wait, download
                ├── gmail.ts            # sendEmail, listRecentEmails (via Google OAuth)
                ├── calendar.ts         # createEvent, listUpcoming (via Google OAuth)
                └── files.ts            # listFolder, readTextFile, writeTextFile (local fs)
```

---

## 4. Database Schema

### Tables (all have RLS enabled, policies restrict to `user_id = auth.uid()`)

**`tasks`** — the core entity
```sql
id                   UUID PK
user_id              UUID FK → auth.users
title                TEXT NOT NULL
description          TEXT
priority             TEXT ('high' | 'medium' | 'low')
status               TEXT ('queued' | 'needs_confirmation' | 'done' | 'skipped')
agent_note           TEXT           -- plain-English summary of what the agent did
agent_steps          JSONB          -- structured array of AgentStep objects (action, args, ok, url, error)
confirmation_prompt  TEXT           -- shown in Needs You tab (why agent paused)
user_feedback        TEXT           -- written feedback when user clicks 👎
sort_index           INT DEFAULT 0
rating               SMALLINT       -- 1 = 👍, -1 = 👎
approval_needed_flag BOOLEAN        -- user flagged "this didn't need my approval"
created_at           TIMESTAMPTZ
completed_at         TIMESTAMPTZ    -- set by trigger when status → done
expires_at           TIMESTAMPTZ    -- set by trigger to completed_at + 10 min
```

**`agent_runs`** — one row per nightly run
```sql
id              UUID PK
user_id         UUID FK
started_at      TIMESTAMPTZ
ended_at        TIMESTAMPTZ
tasks_completed INT
tasks_paused    INT
tasks_failed    INT
log             TEXT     -- full execution log
success         BOOLEAN
```

**`connectors`** — which services the agent can use
```sql
id       UUID PK
user_id  UUID FK
name     TEXT         -- 'gmail', 'calendar', 'brave_search'
status   TEXT         -- 'connected' | 'needs_setup'
config   JSONB        -- { access_token, refresh_token, expiry }
UNIQUE(user_id, name)
```

**`workflows`** — learned procedures
```sql
id               UUID PK
user_id          UUID FK
name             TEXT           -- 'make_flashcards'
description      TEXT
trigger_keywords TEXT[]         -- ['flashcards', 'study cards']
parameters       JSONB          -- { source_folder: 'string' }
steps            JSONB          -- ordered WorkflowStep array with {{parameter}} placeholders
use_count        INT
last_used_at     TIMESTAMPTZ
```

### Triggers
- `set_task_expiry`: BEFORE UPDATE on tasks — when status changes to 'done', sets `completed_at = now()` and `expires_at = now() + 10 minutes`

### Migrations
- `001_init.sql` — creates all 4 tables, indexes, RLS policies, and the expiry trigger
- `002_agent_steps_feedback.sql` — adds `agent_steps JSONB` and `user_feedback TEXT` to tasks

---

## 5. How the Agent Works (Orchestrator Deep Dive)

File: `src/lib/agent/orchestrator.ts`

### Execution flow for each task:

```
1. FETCH all queued tasks, sorted by priority (high → medium → low)
2. LOAD negative feedback (last 5 thumbs-down tasks with written feedback)
3. For EACH task:
   a. WORKFLOW MATCH — search saved workflows by trigger keyword overlap
      - If match found: LLM confirms relevance + extracts parameters
      - Substitute {{params}} into workflow steps → use as plan
   b. LLM PLANNING — if no workflow match:
      - System prompt lists available tools + their actions
      - LLM outputs JSON: { tools_needed, risk, reasoning, steps[] }
   c. RISK CHECK — if plan.risk is 'purchase' or 'irreversible', or task text contains purchase keywords:
      → move to needs_confirmation, write prompt explaining why
   d. CONNECTOR CHECK — if plan needs tools that aren't connected:
      → move to needs_confirmation, tell user to connect them
   e. EXECUTE STEPS sequentially:
      - Each step goes through normalizeAction() to handle LLM output variants
      - Browser steps capture page.url() after execution for citations
      - Results stored as AgentStep objects in agent_steps JSONB
   f. ON SUCCESS:
      - LLM summarizes execution into plain-English note
      - Task marked 'done', agent_note + agent_steps saved
      - maybeSaveWorkflow() asks LLM if this procedure is reusable → saves workflow
   g. ON FAILURE:
      - Detailed error stored (which step, what error, full plan)
      - Task moved to needs_confirmation with specific error message
```

### Action Normalization

The LLM often outputs bare action names like `"query"` or `"click"` instead of the full qualified `"search.query"` or `"browser.click_text"`. The `normalizeAction()` function maps 40+ common variants to their correct qualified names. It also handles `tool + action` combination (e.g. tool="browser", action="fill" → "browser.fill").

### Negative Feedback Loop

The `getNegativeFeedback()` function queries the 5 most recent tasks where the user gave a 👎 + written feedback. This feedback string is injected into both:
1. The `planTask()` system prompt — so the LLM avoids repeating mistakes
2. The `findMatchingWorkflow()` call — so the LLM can reject workflows that violate feedback

---

## 6. How the LLM Client Works

File: `src/lib/agent/llm.ts`

### Provider Chain
1. **Groq** (primary) — `api.groq.com`, model `llama-3.3-70b-versatile`, 30 req/min free
2. **OpenRouter** (fallback) — `openrouter.ai`, model `meta-llama/llama-3.3-70b-instruct:free`

If Groq fails (rate limit, downtime), it automatically tries OpenRouter. If both fail, throws.

### JSON Extraction
`llmJson<T>()` handles messy LLM output:
1. Requests JSON mode via `response_format: { type: 'json_object' }`
2. Strips code fences (` ```json ... ``` `)
3. Falls back to regex extraction of first `{ ... }` block
4. Parses and returns typed object

---

## 7. Browser Automation (Playwright)

File: `src/lib/agent/tools/browser.ts`

### Optimizations Already Implemented

1. **Realistic User Agent** — sets a Chrome 131 UA string so sites don't block the bot
2. **Viewport** — 1280×800, matches a real laptop
3. **Stable State Waiting** — `waitForStableState()` waits for `domcontentloaded` + `networkidle` + 300ms buffer after every navigation. Catches SPA client-side routing.
4. **Retry on Context Destruction** — `getPageText()` retries up to 3× with exponential backoff if execution context is destroyed mid-navigation
5. **Robust Click Strategies** — `clickByText()` tries 4 strategies in order:
   - `getByRole('button', { name })` — semantic, most reliable
   - `getByRole('link', { name })` — for links
   - `getByText().locator('visible=true')` — visible text match only
   - `getByText().scrollIntoViewIfNeeded() + force click` — last resort
6. **Safe Click with Navigation Detection** — `clickByTextSafe()` detects if URL changed after click and waits for page to stabilize
7. **Robust Fill** — `fill()` tries 5 strategies: raw CSS selector, getByLabel, getByPlaceholder, getByRole textbox, getByRole searchbox
8. **Key Press + Navigation Wait** — `pressKey()` detects if Enter triggered a form submission and waits for navigation
9. **Wait Helper** — `waitFor()` auto-detects CSS selectors vs text content
10. **URL Normalization** — `navigate()` prepends `https://` if scheme missing

### Known Limitation
Playwright cannot run on Vercel serverless. Production options:
- **browserless.io** — WebSocket connection, free tier 1000 sessions/mo. Swap `chromium.launch()` → `chromium.connect(ws://...)`
- **VPS** — $5/mo DigitalOcean droplet running the agent code
- **Local** — `npm run agent:run` on your machine

---

## 8. Workflow Learning System

File: `src/lib/agent/workflows.ts`

### How It Works

**Saving (after successful task):**
1. `maybeSaveWorkflow()` sends the task + executed steps to the LLM
2. LLM decides if the procedure is generalizable
3. If yes: outputs name, trigger_keywords, parameters (with {{placeholders}}), steps
4. Upserts by name — existing workflow with same name gets updated

**Matching (before planning):**
1. `findMatchingWorkflow()` scores all user workflows by trigger keyword overlap with task text
2. Best match sent to LLM for confirmation + parameter extraction
3. LLM also checks if the workflow violates any negative feedback
4. If confirmed: parameters substituted into step templates, used as plan

---

## 9. Dashboard UI

### 3-Tab Layout
- **Queue** — tasks grouped by priority (high/medium/low sections), each with delete button. Empty state with "Add your first task" CTA.
- **Needs You** — confirmation cards showing: task title, agent's explanation of why it stopped, approve/skip buttons, "this didn't need my approval" feedback link, agent note with step details
- **Done** — completed tasks with: plain-English agent note (with clickable links via LinkifyText), expandable step-by-step execution log with URLs, countdown timer to expiry, 👍/👎 rating (👎 opens text feedback modal)

### Real-Time Updates
Dashboard subscribes to Supabase Realtime on the `tasks` and `agent_runs` tables. Any change triggers a full refetch — no polling, no refresh needed.

### Auth
- Magic link login via Supabase Auth
- Locked to `ALLOWED_EMAIL` constant (`suadesai17@gmail.com`) in `src/lib/constants.ts`
- Enforcement: client-side on login page (prevents sending link) + server-side in `page.tsx` (checks session email, forces sign out if mismatch)

### Other Pages
- `/settings` — shows connected tools (Gmail, Calendar, Search, Playwright) with Connect/Reconnect buttons
- `/workflows` — lists all saved workflows with trigger keywords, use count, expandable step JSON, delete button

---

## 10. Environment Variables

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://hoorfobebqxmyzgfmlai.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=eyJ...      # Server-side agent writes (bypasses RLS)

# LLM (Groq primary, OpenRouter fallback)
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free

# Tools
BRAVE_SEARCH_API_KEY=BSA...

# Security
CRON_SECRET=<random 64-char hex>      # Protects /api/agent/run from public access
CONNECTOR_ENCRYPTION_KEY=<random 64-char hex>  # Future: encrypt stored tokens

# Google OAuth (not yet configured)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Optional
RESEND_API_KEY=                       # For email notifications
```

---

## 11. Commands

```bash
npm run dev          # Local dashboard at localhost:3000
npm run agent:run    # Run the night agent manually (for testing)
npm run build        # Production build (typecheck + compile)
```

---

## 12. Current State & Known Issues

### Working
- Dashboard UI (3 tabs, add tasks, real-time updates, mobile responsive)
- Night agent execution via `npm run agent:run`
- Groq LLM with OpenRouter fallback
- Brave Search integration
- Playwright browser automation (local only)
- Action normalization (40+ LLM output variants handled)
- Structured step logging with URL citations
- Negative feedback learning (last 5 thumbs-down injected into planner)
- Workflow learning + keyword matching + LLM confirmation
- Auth locked to single email
- Detailed error messages in Needs You tab

### Not Yet Working
- Google OAuth (needs Google Cloud Console setup by user)
- Vercel deployment (not yet pushed/connected)
- Playwright on Vercel (needs browserless.io or VPS)
- Token refresh for Google APIs (tokens expire after 1 hour, no auto-refresh)

### Known Quirks
- The LLM may still output unexpected action names not in the normalize map — add new ones as discovered
- Workflow keyword matching can produce false positives if many workflows accumulate — embedding-based similarity would fix this
- Done tab re-renders every second for countdown timers (the Dashboard component forces a `setTasks` spread every 1s)

---

## 13. Features to Build Next

### Priority Tier 1 — "That's a real AI agent" (Show-stoppers for demos)

#### Feature 1: Real-Time Agent Streaming
**What:** While the agent runs, stream its reasoning + actions live to the dashboard. User opens the app and watches: "Planning... → Searching Amazon... → Found 3 options... → Clicking cheapest..."
**Why impressive:** Shows you understand real-time systems + agent observability. Every production LLM system needs this.
**Implementation:**
- Add a `status` field to `agent_runs`: 'running' | 'completed' | 'failed'
- Add a `live_log` JSONB column to `agent_runs` — array of `{ timestamp, message, type: 'planning' | 'tool_call' | 'result' | 'error' }`
- In the orchestrator, after each step, append to `live_log` via Supabase update
- Dashboard subscribes to `agent_runs` realtime changes, renders a live activity feed
- Add a "Watch Agent" button that opens a full-screen view of the current run
**Files to modify:** `orchestrator.ts`, `agent_runs` schema, new `AgentLiveView.tsx` component, `Dashboard.tsx`

#### Feature 2: Self-Healing Error Recovery
**What:** When a step fails, the agent doesn't just stop — it reflects on the error, replans, and tries a different approach. "Click failed? Let me try searching for a direct link instead."
**Why impressive:** This is a core pattern in production agent systems (ReAct, reflexion). Shows you understand agent reliability engineering.
**Implementation:**
- After a step fails, instead of immediately marking as failed, enter a "recovery loop" (max 2 retries)
- Send the error + original plan + available context to the LLM with a recovery prompt: "Step X failed with error Y. The page currently shows Z. Suggest an alternative approach."
- LLM outputs a revised plan for the remaining steps
- Execute the revised plan
- Log both the original failure and the recovery attempt in `agent_steps`
**Files to modify:** `orchestrator.ts` (add recovery loop around step execution)

#### Feature 3: Human-in-the-Loop Mid-Task Intervention
**What:** While the agent is running, you can push a message to it mid-execution from the dashboard. "Actually, search for USB-C not Lightning." The agent reads the interruption, adjusts, continues.
**Why impressive:** Bidirectional human-agent collaboration is cutting-edge. Most agents are fire-and-forget.
**Implementation:**
- Add an `interventions` table: `{ id, task_id, message, created_at, consumed_at }`
- In the orchestrator, between each step, check for unconsumed interventions for the current task
- If found, re-plan remaining steps with the intervention context injected
- Dashboard shows a "Send Message" input on the currently running task card
**Files to modify:** New migration, `orchestrator.ts`, `NeedsYouTab.tsx` or new `RunningTab.tsx`

#### Feature 4: Intelligent Task Decomposition
**What:** When you add "Plan my trip to Japan," the agent breaks it into subtasks: research flights → find hotels → create itinerary → book restaurants. Each becomes a card in Queue, linked to a parent.
**Why impressive:** Hierarchical planning is a key AI agent capability.
**Implementation:**
- Add `parent_task_id UUID` column to tasks (self-referential FK)
- Before planning, run a "decomposition check" prompt: "Does this task need to be broken into subtasks? If yes, output the subtasks."
- If decomposed: create child tasks in DB, mark parent as 'in_progress', execute children sequentially
- When all children done, mark parent done with a combined summary
- UI: show subtask cards indented under their parent in Queue tab
**Files to modify:** `tasks` schema, `orchestrator.ts`, `QueueTab.tsx`, `TaskCard.tsx`

---

### Priority Tier 2 — "This person understands ML systems" (Technical depth)

#### Feature 5: RAG over Local Files
**What:** Before planning, the agent embeds your local files into a vector store. "Summarize my ML notes" → retrieves relevant chunks → plans based on actual content.
**Why impressive:** RAG is the #1 most-asked-about AI pattern. Building it from scratch shows deep understanding.
**Implementation:**
- Use Groq or a local model for embeddings (or `@xenova/transformers` in-browser)
- On-demand indexing: when a task references files, read them, chunk (500 tokens each), embed, store vectors in a `file_embeddings` table
- Before planning, semantic search for relevant chunks, inject top-5 into the planner prompt
- Cache embeddings — only re-embed if file modified_at changed
**Files to modify:** New `tools/rag.ts`, new migration for `file_embeddings` table, `orchestrator.ts`

#### Feature 6: Agent Evaluation Framework
**What:** An automated test suite that runs the agent against 20+ synthetic tasks and scores: did it pick the right tools? Did it produce correct output? Did it hallucinate?
**Why impressive:** This is what real ML teams build. Shows you think about quality, not just features.
**Implementation:**
- Create `evals/` directory with test cases as JSON: `{ task, expected_tools, expected_output_contains, expected_risk }`
- Script that runs the orchestrator in dry-run mode (mock tool execution, real LLM planning)
- Score each dimension: tool selection accuracy, plan quality, risk detection, output relevance
- Output a scorecard: `{ overall: 85%, tool_selection: 90%, risk_detection: 100%, ... }`
- Run evals on every prompt change to detect regressions
**Files to create:** `evals/test-cases.json`, `evals/run-evals.ts`, `evals/scorer.ts`

#### Feature 7: Token & Cost Tracking Dashboard
**What:** Log every LLM call: model, tokens in/out, latency, cost. Show charts: tokens/day, latency trend, model usage breakdown.
**Why impressive:** Standard MLOps observability. Shows you think about production concerns.
**Implementation:**
- Wrap `callProvider()` in `llm.ts` to capture: start time, end time, token counts (from response `usage` field), model name
- Store in new `llm_calls` table: `{ id, model, tokens_in, tokens_out, latency_ms, cost_usd, created_at }`
- New `/analytics` page with charts (use a simple SVG chart or recharts)
- Show: total tokens this week, avg latency, cost breakdown by model, calls per task
**Files to modify:** `llm.ts`, new migration, new `/analytics` page

#### Feature 8: Prompt Optimization (A/B Testing)
**What:** A/B test system prompt variants. Version A vs B, measure success rate over 50 tasks, pick the winner.
**Why impressive:** Shows you understand that prompts are hyperparameters to be tuned, not static strings.
**Implementation:**
- `prompt_versions` table: `{ id, name, system_prompt, active, success_rate, sample_count }`
- Orchestrator randomly selects between active prompt versions (weighted by Thompson sampling or simple round-robin)
- After task completes, update the version's success_rate
- Admin UI to add/deactivate versions and see performance comparison
**Files to modify:** `orchestrator.ts`, new migration, new `/prompts` admin page

---

### Priority Tier 3 — "This person ships production AI" (Polish)

#### Feature 9: Confidence Scoring
**What:** Before executing, the agent rates its confidence (0–100%) and explains why. Low confidence → auto-routes to Needs You.
**Implementation:**
- Add a confidence-estimation step after planning: "Rate your confidence 0-100 and explain. Consider: task clarity, tool availability, past failures on similar tasks."
- Store confidence in `tasks.agent_confidence INT`
- If confidence < 50, move to needs_confirmation with the explanation
- Show confidence badge on task cards
**Files to modify:** `orchestrator.ts`, tasks schema, `TaskCard.tsx`

#### Feature 10: Semantic Workflow Matching (Embeddings)
**What:** Replace keyword matching with embedding similarity. "Make study cards" matches "create flashcards."
**Implementation:**
- Embed workflow trigger descriptions and task text using same embedding model as RAG
- Compute cosine similarity, threshold at 0.75
- Falls back to keyword matching if embedding service unavailable
**Files to modify:** `workflows.ts`, reuse embedding infrastructure from RAG feature

#### Feature 11: Scheduled & Recurring Tasks
**What:** "Check my email for invoices every Monday" runs automatically every week.
**Implementation:**
- Add `recurrence_cron TEXT` and `next_run_at TIMESTAMPTZ` to tasks
- The nightly agent creates instances of recurring tasks when `next_run_at` has passed
- UI: add a "Repeat" dropdown to AddTaskModal (once / daily / weekly / monthly / custom cron)
**Files to modify:** Tasks schema, `AddTaskModal.tsx`, `orchestrator.ts`

#### Feature 12: Natural Language Task Input
**What:** Instead of title + description + priority form, just type: "Find me a cheap flight to Miami next month — high priority"
**Implementation:**
- Add an NLU parser that extracts: title, description, priority, deadline, recurrence from freeform text
- Use the LLM with a simple extraction prompt
- Auto-fill the AddTaskModal or create directly
- Voice input via Web Speech API (browser-native, no cost)
**Files to modify:** New `lib/agent/nlu.ts`, `AddTaskModal.tsx`

#### Feature 13: Agent Memory & Preferences
**What:** The agent remembers: "User prefers Amazon over eBay," "User's ML folder is at ~/Desktop/ML."
**Implementation:**
- New `preferences` table: `{ id, user_id, key, value, source_task_id, created_at }`
- After each task, LLM extracts any preferences revealed (implicit or explicit)
- Before planning, inject relevant preferences into the system prompt
- UI: `/preferences` page to view and edit
**Files to modify:** New migration, `orchestrator.ts`, new page

#### Feature 14: Weekly Digest Email
**What:** Every Sunday, the agent emails a summary: tasks completed, time saved, success trends, top workflows.
**Implementation:**
- New cron endpoint `/api/digest` running weekly
- Queries `agent_runs` and `tasks` for the week's data
- LLM generates a natural-language summary
- Sends via Gmail API (or Resend as fallback)
**Files to modify:** New API route, `vercel.json` cron entry

#### Feature 15: Multi-Step Browser Autonomy with Screenshots
**What:** The agent takes screenshots during browser tasks and includes them in the notes. "Here's what I found on Amazon" with an actual screenshot.
**Implementation:**
- `page.screenshot({ type: 'png' })` after key browser steps
- Upload to Supabase Storage (free tier: 1GB)
- Include image URLs in agent_steps and render in DoneTab
**Files to modify:** `browser.ts`, `orchestrator.ts`, `DoneTab.tsx`, Supabase Storage setup

---

### Priority Tier 4 — Stretch Goals

#### Feature 16: Multi-Agent Orchestration
**What:** Complex tasks get decomposed across specialized sub-agents: a "researcher" agent, a "writer" agent, a "reviewer" agent that work in sequence.
**Implementation:** Create agent role presets with specialized system prompts. Orchestrator dispatches subtasks to the appropriate role. Results pass between agents in a pipeline.

#### Feature 17: Webhook Integration
**What:** External services can trigger tasks. Receive an email → auto-create a task. GitHub issue assigned to you → auto-create a task.
**Implementation:** New `/api/webhooks/:source` endpoint. Parser per source type. Auto-creates tasks with appropriate priority.

#### Feature 18: Mobile Push Notifications
**What:** When a task moves to "Needs You," push a notification to your phone.
**Implementation:** Web Push API (free, browser-native). Register service worker, store push subscription in DB, send via `web-push` npm package when task status changes.

#### Feature 19: Collaborative Mode
**What:** Share your dashboard with a teammate. They can add tasks too.
**Implementation:** Add `shared_with UUID[]` to tasks or create a `team_members` table. Extend RLS policies. Add invite flow.

#### Feature 20: Export & API
**What:** Public API for your task agent. POST a task via curl, get results via webhook.
**Implementation:** New `/api/v1/tasks` CRUD endpoint with API key auth. Webhook callback URL stored per task.

---

## 14. Implementation Order Recommendation

Build in this order for maximum demo impact at each stage:

```
Phase 1 (Week 1): Core Polish
  → Feature 7  (Token tracking — low effort, high credibility)
  → Feature 9  (Confidence scoring — small change, big UX win)
  → Feature 12 (NL input — makes demos way smoother)

Phase 2 (Week 2): Agent Intelligence
  → Feature 2  (Self-healing — makes agent actually reliable)
  → Feature 4  (Task decomposition — handles complex tasks)
  → Feature 11 (Recurring tasks — practical daily value)

Phase 3 (Week 3): ML Engineering Depth
  → Feature 1  (Real-time streaming — the "wow" demo moment)
  → Feature 5  (RAG — the resume keyword everyone asks about)
  → Feature 6  (Evals — shows ML engineering maturity)

Phase 4 (Week 4): Polish & Differentiation
  → Feature 10 (Semantic workflow matching — replaces fragile keywords)
  → Feature 13 (Agent memory — personalizes over time)
  → Feature 14 (Weekly digest — shows product thinking)
  → Feature 8  (Prompt A/B testing — shows MLOps thinking)
```

---

## 15. Resume Description

> **Autonomous AI Task Agent** — Built a full-stack AI agent platform with a real-time Trello-style dashboard. Users queue prioritized tasks; a nightly LLM-powered agent executes them autonomously using dynamic tool selection across web search, browser automation (Playwright), Gmail, Google Calendar, and local file system. Features include: workflow learning with semantic matching, self-healing error recovery, structured execution logging with URL citations, confidence-calibrated escalation routing, negative feedback learning, RAG-powered file understanding, prompt A/B testing, and LLM observability with token/cost tracking. Stack: Next.js 14, TypeScript, Supabase (PostgreSQL + Realtime + Auth + RLS), Groq/OpenRouter (Llama 3.3 70B), Playwright, Vercel. Cost: $0/month on free tiers.

---

## 16. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     USER (Phone / Laptop)                   │
│                  Opens dashboard in any browser              │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  Next.js on Vercel (Free)                   │
│                                                             │
│  /              → Dashboard (3 tabs, real-time)             │
│  /login         → Magic link auth (locked to 1 email)       │
│  /settings      → Connector management (Gmail, Calendar)    │
│  /workflows     → View/delete learned workflows             │
│  /api/agent/run → Cron entry (nightly at 4 UTC)             │
│  /api/cleanup   → Expire done tasks (every minute)          │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│              Supabase (PostgreSQL + Realtime)                │
│                                                             │
│  tasks       — the priority queue + results + feedback       │
│  agent_runs  — nightly run logs                              │
│  connectors  — which services are connected                  │
│  workflows   — learned reusable procedures                   │
│                                                             │
│  Real-time subscriptions push changes to dashboard instantly │
│  RLS ensures each user only sees their own data              │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    NIGHT AGENT (Orchestrator)                │
│                                                             │
│  1. Fetch queued tasks (priority order)                      │
│  2. Load negative feedback from past failures                │
│  3. For each task:                                           │
│     a. Check for matching workflow                           │
│     b. LLM plans which tools to use                          │
│     c. Risk check (purchases → pause)                        │
│     d. Connector check (missing tools → pause)               │
│     e. Execute steps sequentially                            │
│     f. Save notes + citations + maybe save workflow          │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                         LLM LAYER                           │
│                                                             │
│  Groq (primary) ──→ OpenRouter (fallback)                   │
│  Llama 3.3 70B       Llama 3.3 70B                          │
│  30 req/min free     Free tier (rate-limited)               │
│                                                             │
│  Auto-retry across providers on failure                      │
│  JSON extraction with code-fence stripping                   │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                        TOOL BELT                            │
│                                                             │
│  🔍 Brave Search    — braveSearch(query) → results          │
│  🌐 Playwright      — navigate, click, fill, download       │
│  📧 Gmail API       — sendEmail, listRecentEmails           │
│  📅 Calendar API    — createEvent, listUpcoming             │
│  📁 Local Files     — readTextFile, writeTextFile, list     │
│                                                             │
│  Each tool is a standalone module in src/lib/agent/tools/   │
│  Connectors table tracks which are available per user        │
└─────────────────────────────────────────────────────────────┘
```
