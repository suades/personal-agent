# Batch 2 — Agent Intelligence + Frontend Overhaul (Design)

**Date:** 2026-06-12
**Scope (user-requested):** PROJECT_BIBLE Features 2, 4, 7, 10, 12, 13, 15 + Features 1 and 9 (added
for demo/resume value) + frontend overhaul (web/mobile usability, light animations) + much richer
agent notes with links and citations.

---

## 1. Database — `supabase/migrations/003_batch2_features.sql`

| Change | Feature |
|---|---|
| `agent_runs.status TEXT` ('running' \| 'completed' \| 'failed') | F1 streaming |
| `agent_runs.live_log JSONB DEFAULT '[]'` — array of `{ ts, type, message, task_id? }` | F1 streaming |
| `tasks.parent_task_id UUID` self-FK + index | F4 decomposition |
| `tasks.agent_confidence INT` | F9 confidence |
| `tasks.status` CHECK gains `'in_progress'` (parent while children run / task while agent works) | F4 + F1 |
| New `llm_calls` table: provider, model, purpose, tokens_in/out, latency_ms, cost_usd, ok | F7 tracking |
| New `preferences` table: key, value, source_task_id, UNIQUE(user_id, key) | F13 memory |
| `workflows.embedding JSONB` (number[] — no pgvector; cosine in JS, N is tiny) | F10 semantic |
| `screenshots` public storage bucket | F15 screenshots |

RLS on new tables: owner-only (`user_id = auth.uid()`); agent writes via service role.

## 2. Backend

- **`llm.ts` (F7):** every provider call is timed; `usage` from the response is logged to `llm_calls`
  fire-and-forget. A module-level `setLLMUser(userId)` provides attribution (single-user app — no
  need to thread userId through every call). Optional `purpose` opt tags calls (plan / summarize /
  recovery / nlu / memory / workflow / decompose). Cost computed from a static per-model price map
  (Groq Llama 3.3 70B: $0.59/$0.79 per M; free OpenRouter model: $0) — "what this would cost."
- **`embeddings.ts` (new, F10):** `embedText()` → Gemini `text-embedding-004` if `GEMINI_API_KEY`,
  else Jina v3 if `JINA_API_KEY`, else `null`. `cosineSim()`. Callers degrade gracefully.
- **`workflows.ts` (F10):** match = semantic similarity (threshold 0.75) when embeddings available,
  else existing keyword overlap. Workflow embeddings computed lazily and persisted on first use and
  on save. LLM confirmation step unchanged.
- **`nlu.ts` + `POST /api/tasks/parse` (F12):** LLM extracts `{ title, description, priority }`
  from freeform text. Route is session-authenticated + ALLOWED_EMAIL-guarded; client inserts the
  task itself (RLS applies). Voice input via browser-native Web Speech API in the modal.
- **`memory.ts` (new, F13):** after each completed task the LLM extracts durable preferences
  ("prefers Amazon", "ML folder is ~/Desktop/ML") → upsert into `preferences`. Top 20 injected into
  planning + recovery prompts.
- **`browser.ts` (F15):** `screenshot(page)` → JPEG buffer (quality 60, keeps storage small).
- **`orchestrator.ts` (the big one):**
  - **F1:** run starts with `status='running'`; `logLive()` appends `{ts,type,message,task_id}` to
    `live_log` after every plan/tool/result/error; run ends 'completed'/'failed'. Stale
    `in_progress` tasks are reset to `queued` at run start (crash recovery).
  - **F4:** top-level tasks (no `parent_task_id`) get a decomposition check first. If the LLM
    splits the task (2–5 subtasks), children are inserted with `parent_task_id`, parent goes
    `in_progress`, children execute in order, then the parent gets a combined summary → `done`
    (or `needs_confirmation` if any child stalled). Children are never re-decomposed.
  - **F9:** the plan JSON now includes `confidence` (0–100) + reasoning; < 50 routes to Needs You
    with the explanation. Stored in `tasks.agent_confidence`, shown as a badge.
  - **F2:** step failure no longer aborts. Up to 2 recovery attempts per task: LLM gets the error,
    executed steps, remaining plan, and current page text → revised remaining steps. A synthetic
    `agent.replan` step is logged so the UI can show "self-healed."
  - **F15:** after successful page-changing browser steps (goto/click/press), capture screenshot →
    upload to `screenshots/{userId}/{taskId}/` → public URL stored in `AgentStep.screenshot_url`.
  - **Richer notes:** the summarizer now produces structured markdown (What I did / Key findings /
    Sources as markdown links / Suggested next steps), receives up to 1200 chars of output per step
    (DB snippet stays short), and must cite every URL visited.

## 3. Frontend overhaul (no new deps — CSS/Tailwind animations, SVG charts)

- **Design system:** keyframes (fade-in-up, slide-up, pulse, shimmer), priority left-border cards,
  sticky blurred header, safe-area insets, `prefers-reduced-motion` respected.
- **Dashboard:** live "Agent is working" banner + expandable activity feed (`AgentLiveView.tsx`)
  driven by `agent_runs.live_log` realtime; nav gains Analytics + Preferences.
- **TaskCard:** colored priority edge, chevron rotation, hover lift, confidence badge, subtask chip.
- **QueueTab:** subtasks render indented under their parent; `in_progress` parents show a spinner.
- **DoneTab / NeedsYouTab:** shared `StepsList` timeline (tool icons, numbered, "self-healed" badge,
  screenshot thumbnails, clickable source URLs), markdown-rendered agent notes.
- **AddTaskModal:** "Smart" mode (default) — one box, optional 🎤 voice dictation, LLM parse with
  editable preview; "Manual" mode keeps the old form. Bottom-sheet slide-up on mobile.
- **`/analytics` (F7):** stat cards (calls, tokens, avg latency, est. cost) + 14-day SVG bar chart +
  per-purpose/model breakdowns.
- **`/preferences` (F13):** list/add/edit/delete learned preferences.
- **LinkifyText → lightweight markdown:** links, **bold**, bullets, headings-as-bold, line breaks.

## 4. Out of scope / explicitly not done

- pgvector, RAG (F5), evals (F6), prompt A/B (F8), recurring tasks (F11), digest email (F14).
- Framer Motion — plain CSS is enough for "nothing crazy."
- Embeddings work without any new key (falls back to keywords); `GEMINI_API_KEY` or `JINA_API_KEY`
  enables semantic matching.

## 5. Verification

`npm run build` (typecheck + compile) must pass. Migration 003 must be applied in the Supabase SQL
editor before the new columns are used (agent code tolerates a missing screenshots bucket).
