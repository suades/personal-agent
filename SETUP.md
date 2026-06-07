# ToDo Agent — Morning Setup (15 min)

The whole codebase is built. You just need to wire the live services. **Do these in order.**

> 🔒 **Security first:** Rotate the Supabase personal access token you shared with me (`sbp_...`). Go to Supabase Dashboard → Account → Access Tokens → revoke it. You don't need it for anything in this project — only for tooling.

---

## 1. Apply the database schema (1 min)

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project → **SQL Editor**
2. Open the file `supabase/migrations/001_init.sql` in this repo
3. Copy-paste the entire contents into the SQL editor
4. Click **Run**. You should see "Success. No rows returned."

This creates the `tasks`, `agent_runs`, `connectors`, and `workflows` tables plus row-level security policies.

---

## 2. Get the Supabase service role key (1 min)

The night agent needs server-side write access (bypasses RLS).

1. Supabase Dashboard → **Settings** → **API**
2. Copy the **`service_role`** secret key (NOT the publishable one)
3. Paste it into `.env.local`:
   ```
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
   ```

---

## 3. Generate two random secrets (30 sec)

```bash
# CRON_SECRET (protects /api/agent/run from public abuse)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# CONNECTOR_ENCRYPTION_KEY (for future use)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste both into `.env.local`, replacing the `replace_with_...` placeholders.

---

## 4. Install dependencies (3 min)

```bash
npm install
npx playwright install chromium
```

---

## 5. Run locally to test (1 min)

```bash
npm run dev
```

Open http://localhost:3000. You'll see the login screen. Enter your email — Supabase emails you a magic link.

Once logged in, add a task like "Find me the cheapest USB-C cable on Amazon" and set it as High priority.

---

## 6. Test the agent end-to-end (2 min)

In a separate terminal:

```bash
npm run agent:run
```

This runs the night agent on demand. Watch the output. Then refresh the dashboard — your task should have moved to Done or Needs You.

---

## 7. Set up Google OAuth (for Gmail + Calendar) — 5 min

The agent can't send emails until you authorize Google access.

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (name it "ToDo Agent")
3. **APIs & Services → Library** → enable **Gmail API** and **Google Calendar API**
4. **APIs & Services → OAuth consent screen** → choose **External**, fill in app name + your email, save (no need to publish)
5. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Web application**
   - Authorized redirect URIs: add `http://localhost:3000/api/connectors/google/callback` (and later your Vercel URL)
6. Copy the **Client ID** and **Client Secret** into `.env.local`:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
7. Restart `npm run dev`, go to `/settings`, click "Connect" next to Gmail and Calendar.

---

## 8. Deploy to Vercel (3 min)

1. Push the repo to GitHub:
   ```bash
   git add .
   git commit -m "Initial build"
   gh repo create todo-agent --private --source=. --push
   ```
2. Go to [Vercel Dashboard](https://vercel.com) → **Add New Project** → import your GitHub repo
3. In the deploy config, paste **all** environment variables from `.env.local` into Vercel's env vars UI
4. Click **Deploy**
5. Once deployed, copy the URL (e.g. `https://todo-agent-xxx.vercel.app`)
6. Add that URL to:
   - **Supabase**: Dashboard → Authentication → URL Configuration → add to Site URL + Redirect URLs
   - **Google Cloud**: Credentials → your OAuth client → add `https://your-vercel-url.vercel.app/api/connectors/google/callback` to Authorized redirect URIs

Vercel Cron will fire `/api/agent/run` daily at 4:00 AM UTC (configurable in `vercel.json`). The `/api/cleanup` endpoint fires every minute to expire done tasks.

---

## 9. Phone access

Just open the Vercel URL on your phone. Add to home screen for an app-like experience. Sign in with the same magic link flow — works on any device.

---

## ⚠️ Important notes about Playwright on Vercel

**Vercel's serverless functions cannot run Playwright out of the box** (no Chromium binary). For browser-automation tasks to actually work in production, you have three options:

1. **Easiest (recommended):** Use [browserless.io](https://browserless.io) — they host Chromium and Playwright connects via WebSocket. Free tier covers 1000 sessions/month. Swap `chromium.launch()` to `chromium.connect(browserlessWsUrl)` in `src/lib/agent/tools/browser.ts`.
2. **Cheap VPS:** Rent a $5/mo DigitalOcean droplet, run the agent there via a cron job (the agent code is portable — same `runAgentForUser` works in any Node env).
3. **Run agent locally:** Keep `npm run agent:run` and use Vercel only for the dashboard. The agent runs whenever your machine is awake. (Loses "agent runs while you sleep" if your machine is off.)

For the first version, option 1 is the move. Sign up for browserless, paste the WS URL into `.env.local` as `BROWSERLESS_WS_URL`, and we'll wire it up — or do option 2 for full control.

---

## Trying it out — the flashcards example

Add a task with this exact description:

> Read the notes in `~/Desktop/ML` then write flashcards in the format: `term, definition` (one per line). Save to `~/Desktop/ML/flashcards.csv` and push to Quizlet.

After it runs:
- Go to `/workflows` — you'll see a saved workflow like `make_flashcards`
- Next time you say "make flashcards from my history folder", the agent reads the workflow, fills in the new folder, and runs the same exact pipeline without asking about format

---

## Success metric targets (from the spec)

| Metric | Target |
|---|---|
| Task completion rate | ≥ 75% |
| False confirmation rate | ≤ 10% |
| Agent note quality (👍 rate) | ≥ 85% |
| Nightly run reliability | ≥ 98% |
| Time saved per week | ≥ 60 min |
| Tool success rate | ≥ 95% |

These all show up live on the dashboard's metrics bar as you use it.

---

That's it. Total active time: ~15 minutes. Then the agent works for you every night. ✨
