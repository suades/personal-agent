# ToDo Agent — Project Handoff

## What this is
An autonomous AI task agent with a Trello-like dashboard. User adds tasks (prioritized), a night agent (LLM) runs through them using tools (search, browser automation, Gmail, Calendar, files), writes notes on what it did, and marks them done. Completed tasks expire after 10 days (set by the
`set_task_expiry` trigger; `/api/cleanup` deletes them once past `expires_at`). The agent learns workflows (saves repeatable procedures for next time).

## Tech stack
- **Frontend:** Next.js 14 + TypeScript + Tailwind CSS
- **Database:** Supabase (PostgreSQL + Auth + Realtime)
- **LLM:** Groq (primary, Llama 3.3 70B) → OpenRouter (fallback)
- **Browser automation:** Playwright
- **Search:** Brave Search API
- **Email/Calendar:** Gmail + Google Calendar via OAuth
- **Hosting:** Vercel (free tier)
- **Cron:** Vercel Cron → hits `/api/agent/run` nightly at 4 UTC

## Key files
- `src/lib/agent/orchestrator.ts` — the main agent loop. Plans tasks via LLM, dispatches tool calls, handles errors.
- `src/lib/agent/llm.ts` — LLM client with Groq primary + OpenRouter fallback. Auto-retries across providers.
- `src/lib/agent/workflows.ts` — workflow learning: saves reusable procedures after task success, matches on future tasks.
- `src/lib/agent/connectors.ts` — manages which tools are available (Gmail connected? Calendar connected?).
- `src/lib/agent/tools/` — individual tool implementations (search, browser, gmail, calendar, files).
- `src/app/api/agent/run/route.ts` — the cron entry point.
- `src/components/Dashboard.tsx` — main UI with 3-tab layout.
- `supabase/migrations/001_init.sql` — full DB schema (already applied).

## Environment
All secrets in `.env.local` (gitignored). Key ones:
- `GROQ_API_KEY` — primary LLM (Groq free tier)
- `OPENROUTER_API_KEY` — fallback LLM
- `SUPABASE_SERVICE_ROLE_KEY` — agent uses this for server-side DB writes (bypasses RLS)
- `BRAVE_SEARCH_API_KEY` — web search
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — not yet configured (needed for Gmail/Calendar)

## Current state (as of handoff)
- ✅ Dashboard UI works (login, 3 tabs, add tasks, real-time)
- ✅ Night agent runs via `npm run agent:run`
- ✅ Groq integration working
- ✅ Action name normalization added (LLM outputs like "query" map to "search.query")
- ✅ Error messages now show detailed step + error info in the dashboard
- ✅ **Batch 2 (2026-06-12)**: real-time agent streaming, self-healing recovery, task
  decomposition, confidence scoring, LLM token/cost analytics, semantic workflow matching,
  NL task input + voice, agent memory/preferences, browser screenshots, frontend overhaul,
  rich markdown agent reports with citations — see "Batch 2 Architectural Decisions" below
- ⚠️ Migration `003_batch2_features.sql` must be applied in the Supabase SQL editor before
  running the agent (new columns, llm_calls/preferences tables, screenshots bucket)
- ⚠️ Playwright browser automation: works locally but won't work on Vercel serverless (needs browserless.io or a VPS)
- ❌ Google OAuth not yet configured (user needs to set up in Google Cloud Console — see SETUP.md step 7)
- ❌ Not yet deployed to Vercel

## Known issues / next steps
1. **Playwright on Vercel:** Need to swap `chromium.launch()` → `chromium.connect(BROWSERLESS_WS_URL)` for production. See `src/lib/agent/tools/browser.ts`.
2. **Token refresh for Google APIs:** The OAuth callback stores `access_token` + `refresh_token` but there's no auto-refresh when the access token expires (1 hour). Add a refresh check in `src/lib/agent/tools/gmail.ts` and `calendar.ts`.
3. **LLM output variations:** The normalizeAction map in `orchestrator.ts` catches common variants but the LLM may still produce unexpected action names. The system prompt in `planTask()` guides it, but edge cases will come up — add to the map as discovered.
4. **Workflow matching precision:** The keyword-based workflow matching is basic. If the user accumulates many workflows, it may match incorrectly. Consider embedding-based similarity in the future.

## Commands
- `npm run dev` — local dashboard at localhost:3000
- `npm run agent:run` — run the night agent manually (for testing)
- `npm run build` — production build (typecheck + compile)

## Architecture diagram
```
User (phone/laptop) → Next.js on Vercel → Supabase (tasks DB + auth + realtime)
                                         ↕
                                    Night Agent (Vercel Cron or local)
                                         ↕
                              Groq LLM (planning + summarizing)
                                         ↕
                        Tools: Brave Search | Playwright | Gmail | Calendar | Files
```

## Design spec
Full spec with competitors, success metrics, and 50-task breakdown:
`docs/superpowers/specs/2026-06-06-autonomous-task-agent-design.md`

## Recent Architectural Decisions (Batch 1 Features)

1. **Structured Step Logging & Citations (`agent_steps` JSONB)**:
   - **Decision**: Added an `agent_steps` JSONB column to `tasks` rather than creating a separate `task_steps` table.
   - **Why**: Simpler to manage since this is a single-user app and steps are always fetched alongside the task. Avoids joins.
   - **Where it could go wrong**: If we ever want to do complex analytics on agent actions (e.g. "how many times did the agent click 'Buy' across all tasks?"), querying inside a JSONB array is harder than a normalized table.
   - **Citations implementation**: The `orchestrator` natively hooks into Playwright's `page.url()` after each browser action and saves it to `agent_steps`. This avoids LLM hallucinations, ensuring citations are 100% accurate.

2. **Negative Feedback Learning (`user_feedback` TEXT)**:
   - **Decision**: Added a `user_feedback` column to `tasks`. When the user clicks 👎, they provide text feedback. The orchestrator pulls the 5 most recent negative feedbacks and includes them in the `planTask` system prompt.
   - **Why**: Enables the agent to learn from its mistakes on future tasks.
   - **Where it could go wrong**: If the user accumulates a lot of negative feedback, injecting all of it into the prompt uses up token limits and might confuse the LLM. Capping it at the 5 most recent prevents context bloat, but means the agent might "forget" older mistakes.
   - **Workflow Matching**: Modified `findMatchingWorkflow` to also receive this feedback string. The LLM evaluates if an existing saved workflow violates the negative feedback, preventing it from executing bad workflows.

3. **Restricting Access (Auth Lock)**:
   - **Decision**: Kept Supabase Magic Link auth but restricted it to a single `ALLOWED_EMAIL` in `src/lib/constants.ts`, sourced from the `NEXT_PUBLIC_ALLOWED_EMAIL` env var.
   - **Why**: More secure than building custom password auth. You get Supabase RLS and real-time subscriptions for free.
   - **Implementation**: The restriction exists in two places. 1) Client-side on `/login` (prevents sending the email at all). 2) Server-side in `layout.tsx`/`page.tsx` (checks session email and forces sign out).

4. **Countdown Fix**:
   - **Decision**: Modified `fmtCountdown` in `DoneTab.tsx` to return `"Expired"` instead of `"expiring..."`. The UI conditionally renders the `Expires in` prefix.

## Batch 2 Architectural Decisions (2026-06-12)

Spec: `docs/superpowers/specs/2026-06-12-batch2-agent-intelligence-design.md`.
Migration: `supabase/migrations/003_batch2_features.sql` (apply before running the agent).

1. **Real-time streaming (F1)** — `agent_runs.status` ('running'|'completed'|'failed') +
   `live_log JSONB`. The orchestrator's `makeLiveLogger()` rewrites the whole array on each
   event (fine for one user). The dashboard's existing realtime subscription refetches the
   latest run; `AgentLiveView.tsx` renders the feed while status is 'running'.
2. **Self-healing recovery (F2)** — on step failure the orchestrator calls `attemptRecovery()`
   (max 2 per task): LLM sees the error, executed steps, remaining plan, and current page text,
   then emits replacement steps. A synthetic `agent.replan` step with `recovered: true` is
   logged so the UI shows a "self-healed" badge.
   **Web research reliability**: `planTask()` and the recovery prompt carry a "web research
   playbook" — lead with search.query, navigate via direct URLs that encode the query (Kayak
   `/flights/SEA-PDX/date/date`, Google `search?q=`), browser.read after every goto, NEVER fill
   multi-field forms or invent CSS selectors, switch sites on failure. The planner prompt also
   includes today's date so relative dates resolve. `browser.wait` failures are non-fatal
   (advisory — navigation already waits for stability), and `waitFor()` now recognizes
   `tag[attr=...]` strings as selectors.
3. **Task decomposition (F4)** — `tasks.parent_task_id` self-FK. Top-level tasks get a
   decomposition check (LLM; research/lookup tasks are explicitly NOT split); children run in
   order while the parent sits `in_progress`, then `finalizeParent()` settles the parent
   (all children done/skipped → done with combined summary; otherwise → Needs You). A parent
   that already has children is NEVER executed itself — it's only finalized after its queued
   children run (this was a bug: re-approved parents used to execute their own plan). Skipped
   children count as settled. Stale `in_progress` tasks reset to `queued` at run start.
   **UI**: subtasks never appear (or count) standalone in Needs You / Done — they nest inside
   the parent's card. Each stalled subtask gets its own guidance box + Approve/Skip; the
   parent's "Approve all" re-queues parent + pending children. Approving with guidance appends
   `[User guidance]: ...` to the task description so the planner sees it next run.
4. **Confidence (F9)** — plan JSON includes `confidence` 0-100; below 50 routes to Needs You.
   Stored in `tasks.agent_confidence`; workflow-matched plans get a fixed 90.
5. **LLM observability (F7)** — `callProvider()` logs every call (tokens from `usage`, latency,
   est. cost from a static price map) to `llm_calls`, fire-and-forget. Attribution via
   module-level `setLLMUser()` instead of threading userId everywhere. `/analytics` renders
   hand-rolled SVG charts (no chart dependency).
6. **Semantic workflows (F10)** — `workflows.embedding JSONB` (number[]; no pgvector — cosine
   in JS over a tiny list). Provider: Gemini (`GEMINI_API_KEY`) or Jina (`JINA_API_KEY`) free
   tiers via `embeddings.ts`; no key → silent fallback to the old keyword matching. Embeddings
   are computed lazily for pre-existing workflows and persisted.
7. **NL task input (F12)** — `nlu.ts` + `POST /api/tasks/parse` (session-auth +
   ALLOWED_EMAIL). AddTaskModal "Smart" mode parses freeform text into the form for review;
   voice dictation via browser-native Web Speech API (feature-detected).
8. **Agent memory (F13)** — `preferences` table (UNIQUE user_id+key). `memory.ts` extracts
   preferences after each completed task; top 20 injected into plan + recovery prompts.
   `/preferences` page lets the user add/edit/forget them.
9. **Screenshots (F15)** — public `screenshots` storage bucket. JPEG (q60) captured after
   successful goto/click/press steps, stored as `AgentStep.screenshot_url`, rendered as a
   thumbnail strip in `StepsList.tsx`. Upload failures are swallowed (screenshots are nice-to-have).
10. **Rich agent reports** — `summarizeForUser()` now demands structured markdown (What I did /
    Key findings / Sources / Next steps) with exact-URL citations; `LinkifyText.tsx` is a tiny
    markdown renderer (links, bold, bullets) — no markdown dependency.
11. **Frontend** — no new npm deps: Tailwind keyframes + CSS animations, `prefers-reduced-motion`
    respected, sticky blurred header, mobile ⋯ menu, safe-area insets, priority edge cards,
    shared `StepsList.tsx`. Queue tab shows `in_progress` tasks and nests subtasks under parents.
    **Responsive layout switch**: < lg = tabbed mobile layout (FAB, bottom-sheet modal with drag
    handle, max-h-[85dvh]); lg+ = Trello-style 3-column board (Queue / Needs You / Done side by
    side, sticky column headers, "+ New task" in the header instead of the FAB). Mobile-specific
    fixes: `viewportFit: 'cover'` in layout.tsx (safe-area insets need it on iOS) and a 16px
    input font floor under 640px (prevents iOS focus auto-zoom).
