# ToDo Agent — Project Handoff

## What this is
An autonomous AI task agent with a Trello-like dashboard. User adds tasks (prioritized), a night agent (LLM) runs through them using tools (search, browser automation, Gmail, Calendar, files), writes notes on what it did, and marks them done. Completed tasks expire in 10 minutes. The agent learns workflows (saves repeatable procedures for next time).

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
