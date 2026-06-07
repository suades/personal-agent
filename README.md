# ToDo Agent

Drop tasks. Agent does them at night. Free.

A Trello-style task dashboard where an AI agent (DeepSeek R1 via OpenRouter) wakes up nightly, works through your priority queue, uses tools (Gmail, Calendar, web search, Playwright browser automation, local files), and leaves you plain-English notes. Tasks that need confirmation (purchases, missing credentials) move to a "Needs You" tab with one-click approve/skip.

**The agent learns your workflows.** Run a task once with a specific format/pipeline (e.g. read notes folder → format flashcards → push to Quizlet), and next time it recognizes a similar task it runs the saved steps without asking.

## Quick start

See [`SETUP.md`](./SETUP.md) — 15 minutes from clone to running.

## Stack

- Next.js 14 + TypeScript + Tailwind
- Supabase (Postgres + Auth + Realtime)
- DeepSeek R1 via OpenRouter (free LLM)
- Playwright (browser automation)
- Brave Search API
- Gmail + Google Calendar APIs
- Vercel (hosting + cron jobs)

All free tier. Total monthly cost target: **$0**.

## Design doc

See [`docs/superpowers/specs/2026-06-06-autonomous-task-agent-design.md`](./docs/superpowers/specs/2026-06-06-autonomous-task-agent-design.md) — full architecture, 7 competitors analyzed, 6 success metrics, 50-task implementation breakdown.

## Project structure

```
src/
  app/                      Next.js routes
    page.tsx                Dashboard (3 tabs)
    login/                  Magic link login
    auth/callback/          OAuth callback
    settings/               Connector management
    workflows/              View saved workflows
    api/
      agent/run/            Night agent endpoint (Vercel Cron)
      cleanup/              Expire done tasks
      connectors/google/    Gmail + Calendar OAuth
  components/               UI components
  lib/
    supabase/               DB client + server helpers
    agent/
      orchestrator.ts       The main agent loop
      llm.ts                OpenRouter client
      workflows.ts          Save & retrieve learned workflows
      connectors.ts         Tool availability
      tools/                search, browser, gmail, calendar, files
supabase/migrations/        DB schema
scripts/                    Local agent runner
docs/                       Design spec
```
