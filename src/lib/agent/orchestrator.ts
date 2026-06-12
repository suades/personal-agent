import { supabaseAdmin } from '@/lib/supabase/server';
import { llmChat, llmJson, setLLMUser, type LLMMessage } from './llm';
import { findMatchingWorkflow, maybeSaveWorkflow, bumpWorkflowUsage } from './workflows';
import { missingConnectorsForTools, listAvailableConnectors } from './connectors';
import { getPreferencesBlock, extractPreferences } from './memory';
import { braveSearch } from './tools/search';
import { openBrowser, navigate, getPageText, clickByTextSafe, fill, downloadFile, pressKey, waitFor, screenshot } from './tools/browser';
import { sendEmail, listRecentEmails } from './tools/gmail';
import { createEvent, listUpcoming } from './tools/calendar';
import { listFolder, readTextFile, writeTextFile } from './tools/files';
import type { Task, WorkflowStep, AgentStep, LiveLogEntry, Priority } from '@/lib/types';

interface Plan {
  tools_needed: string[];     // ['search', 'gmail', 'browser', 'files', 'calendar']
  risk: 'safe' | 'purchase' | 'irreversible' | 'data_access';
  reasoning: string;
  confidence: number;         // 0-100 — how sure the agent is it can complete this
  confidence_reason?: string;
  steps: WorkflowStep[];
}

const CONFIDENCE_THRESHOLD = 50;  // below this → route to Needs You (Feature 9)
const MAX_RECOVERIES = 2;         // self-healing replan attempts per task (Feature 2)
const MAX_SUBTASKS = 5;           // decomposition cap (Feature 4)

const PURCHASE_KEYWORDS = ['buy', 'order', 'purchase', 'subscribe', 'pay ', 'payment', 'checkout', 'add to cart'];

function looksLikePurchase(text: string) {
  const lc = text.toLowerCase();
  return PURCHASE_KEYWORDS.some(k => lc.includes(k));
}

async function getNegativeFeedback(userId: string): Promise<string> {
  const supabase = supabaseAdmin();
  const { data } = await supabase
    .from('tasks')
    .select('title, description, user_feedback')
    .eq('user_id', userId)
    .eq('rating', -1)
    .not('user_feedback', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(5);

  if (!data || data.length === 0) return '';

  return '\n\nIMPORTANT - LEARN FROM PAST MISTAKES:\nThe user gave negative feedback on these past tasks. Avoid making the same mistakes:\n' +
    data.map(t => `- Task: "${t.title}"\n  Feedback: "${t.user_feedback}"`).join('\n');
}

// ────────────────────────────────────────────────────────────────
// Real-time streaming (Feature 1)
// ────────────────────────────────────────────────────────────────

type LiveLogger = (type: LiveLogEntry['type'], message: string, taskId?: string) => Promise<void>;

function makeLiveLogger(runId: string): LiveLogger {
  const supabase = supabaseAdmin();
  const entries: LiveLogEntry[] = [];
  return async (type, message, taskId) => {
    entries.push({ ts: new Date().toISOString(), type, message, ...(taskId ? { task_id: taskId } : {}) });
    try {
      await supabase.from('agent_runs').update({ live_log: entries }).eq('id', runId);
    } catch { /* streaming is best-effort */ }
  };
}

// ────────────────────────────────────────────────────────────────
// Planning
// ────────────────────────────────────────────────────────────────

const STEP_REFERENCE = `Step actions you can use:
  search.query(query: string)
  browser.open()
  browser.goto(url: string)
  browser.read()
  browser.click_text(text: string)               // visible button/link text
  browser.fill(selector: string, value: string)   // selector can be CSS, label, or placeholder
  browser.press(key: string)                      // e.g. "Enter" to submit a search box
  browser.wait(target: string, timeoutMs?: number) // wait for CSS selector or visible text
  browser.download(selector: string)
  gmail.send(to: string, subject: string, body: string)
  gmail.list(max?: number)
  calendar.create(summary: string, start: string, end: string, attendees?: string[])
  calendar.list(max?: number)
  files.list(folder: string)
  files.read(file: string)
  files.write(file: string, content: string)

IMPORTANT formatting rules for each step:
  - "tool" must be exactly one of: search, browser, gmail, calendar, files
  - "action" MUST be the FULL qualified name like "search.query", "browser.fill", "gmail.send" — NOT just "fill" or "query".
  - Use ONLY the actions listed above. Do not invent new ones.`;

async function planTask(task: Task, availableConnectors: Set<string>, feedbackStr: string, prefsBlock: string): Promise<Plan> {
  const today = new Date().toISOString().slice(0, 10);
  const sys = `You are a planning step for an autonomous task agent.
Today's date: ${today}. Resolve all relative dates ("next month", "a weekend in July") to concrete future dates.
Given a user task, output a JSON plan. Available tools:
  - search    (web search via Brave)
  - browser   (Playwright — navigate websites, click, fill forms, download files)
  - gmail     (send/read email)
  - calendar  (create/read events)
  - files     (read/write local files on the user's machine)

Currently CONNECTED tools: ${[...availableConnectors].join(', ') || 'none'}.

TOOL USAGE GUIDELINES:
- Rely on your internal knowledge first for general concepts, career advice, coding questions, and conceptual comparisons.
- DO NOT use the search or browser tools unless the user explicitly asks to search the web, or if you need real-time data not in your training data.
- If you can complete the task using only the files tool and your internal knowledge, do so directly without making external web requests.

WEB RESEARCH PLAYBOOK — follow this exactly for any find/research/compare/price-check task:
1. Lead with search.query to find current data and the right pages.
2. Navigate with browser.goto using DIRECT URLs that encode the whole query — from search results or known URL patterns:
   - Google search: https://www.google.com/search?q=cheap+flights+seattle+to+portland+july
   - Kayak flights: https://www.kayak.com/flights/SEA-PDX/2026-07-10/2026-07-12 (airport codes + ISO dates)
   - Google Flights: https://www.google.com/travel/flights?q=flights%20from%20Seattle%20to%20Portland%20on%202026-07-10
3. Call browser.read after EVERY goto — that page text is your data.
4. NEVER fill multi-field search forms (origin/destination boxes, date pickers, autocomplete widgets) — they do not work under automation. Encode everything in the URL instead.
5. NEVER invent CSS selectors or data-test-ids — you cannot know a site's internals. Selectors are only allowed when a previous browser.read proved they exist; otherwise target visible text.
6. Do NOT add browser.wait after browser.goto — navigation already waits for the page to settle.
7. If a site fails or blocks automation, goto a DIFFERENT site rather than retrying the same one.
8. A research task ends at reading + reporting findings. Never proceed to booking/checkout/payment unless the task explicitly says to buy.

Output strict JSON:
{
  "tools_needed": ["..."],
  "risk": "safe" | "purchase" | "irreversible" | "data_access",
  "reasoning": "1-2 sentences",
  "confidence": 0-100,
  "confidence_reason": "1 sentence: why this confidence level",
  "steps": [ { "tool": "...", "action": "...", "args": { ... }, "notes": "..." } ]
}

CONFIDENCE: Rate how likely you are to complete this task correctly. Consider: task clarity,
whether the needed tools are connected, and how fragile the steps are (multi-page browser
flows are fragile; search + summarize is reliable). Be honest — below 50 the task is routed
to the user for guidance instead of executed.

${STEP_REFERENCE}

Mark risk='purchase' for anything that spends money. Mark risk='irreversible' for destructive actions (delete files, send irrevocable messages to many people, etc).${prefsBlock}${feedbackStr}`;
  const user = JSON.stringify({ title: task.title, description: task.description });
  const messages: LLMMessage[] = [
    { role: 'system', content: sys },
    { role: 'user',   content: user },
  ];
  const plan = await llmJson<Plan>(messages, { purpose: 'plan' });
  if (typeof plan.confidence !== 'number' || Number.isNaN(plan.confidence)) plan.confidence = 70;
  plan.confidence = Math.max(0, Math.min(100, Math.round(plan.confidence)));
  return plan;
}

// ────────────────────────────────────────────────────────────────
// Task decomposition (Feature 4)
// ────────────────────────────────────────────────────────────────

interface SubtaskSpec { title: string; description: string | null; }

async function decomposeTask(task: Task): Promise<SubtaskSpec[] | null> {
  const msgs: LLMMessage[] = [
    { role: 'system', content:
        'You decide whether a task is genuinely multi-part and should be split into subtasks for an ' +
        'autonomous agent. Split ONLY when the task clearly contains multiple distinct deliverables ' +
        '(e.g. "Plan my trip to Japan" → research flights, find hotels, build itinerary). ' +
        'Simple or single-deliverable tasks must NOT be split. Research/lookup/comparison tasks that ' +
        'a few web searches and page reads can answer (e.g. "find a cheap flight", "compare laptop ' +
        'prices") must NOT be split — they run best as one task.\n' +
        `Output strict JSON: {"decompose": boolean, "subtasks": [{"title": "...", "description": "..."}]} ` +
        `with 2-${MAX_SUBTASKS} subtasks when decompose=true. Each subtask must stand alone — include ` +
        'all context it needs in its description, in execution order.' },
    { role: 'user', content: JSON.stringify({ title: task.title, description: task.description }) },
  ];
  try {
    const out = await llmJson<{ decompose: boolean; subtasks?: SubtaskSpec[] }>(msgs, { purpose: 'decompose' });
    if (!out.decompose || !out.subtasks || out.subtasks.length < 2) return null;
    return out.subtasks.slice(0, MAX_SUBTASKS).map(s => ({
      title: String(s.title ?? '').slice(0, 200),
      description: s.description ? String(s.description) : null,
    })).filter(s => s.title);
  } catch { return null; }
}

// ────────────────────────────────────────────────────────────────
// Self-healing recovery (Feature 2)
// ────────────────────────────────────────────────────────────────

interface Recovery { can_recover: boolean; explanation: string; steps: WorkflowStep[]; }

async function attemptRecovery(
  task: Task,
  executed: AgentStep[],
  failedStep: WorkflowStep,
  error: string,
  remaining: WorkflowStep[],
  pageContext: string,
  feedbackStr: string,
  prefsBlock: string,
): Promise<Recovery | null> {
  const msgs: LLMMessage[] = [
    { role: 'system', content:
        'A step in an autonomous agent plan failed. Reflect on the error and produce an ALTERNATIVE ' +
        'approach for the remaining work — do not just repeat the failed step verbatim. ' +
        'Examples: a click failed → search for a direct URL instead; a selector was wrong → use the ' +
        'visible text shown in the page context; a site blocked us → try a different site.\n' +
        'Output strict JSON: {"can_recover": boolean, "explanation": "1-2 sentences", "steps": [...]} ' +
        'where steps REPLACE the failed step and everything after it. Output {"can_recover": false, ...} ' +
        'only if no alternative could plausibly work.\n\n' +
        'RECOVERY RULES:\n' +
        '- Prefer SWITCHING STRATEGY: a browser.goto with the query encoded in the URL (search engine ' +
        'or site URL pattern) beats retrying clicks and form fills.\n' +
        '- Target only visible text that actually appears in current_page_text — NEVER invent CSS ' +
        'selectors or data-test-ids.\n' +
        '- Never fill multi-field search forms or date pickers; never add browser.wait steps.\n' +
        '- If the site appears broken or is blocking automation, use a different site.\n\n' +
        STEP_REFERENCE + prefsBlock + feedbackStr },
    { role: 'user', content: JSON.stringify({
        task: { title: task.title, description: task.description },
        executed_so_far: executed.map(s => ({ action: s.action, args: s.args, ok: s.ok, url: s.url })),
        failed_step: failedStep,
        error,
        remaining_steps: remaining,
        current_page_text: pageContext.slice(0, 2000) || undefined,
      }) },
  ];
  try {
    const out = await llmJson<Recovery>(msgs, { purpose: 'recovery' });
    if (!out.can_recover || !Array.isArray(out.steps) || out.steps.length === 0) return out.can_recover === false ? out : null;
    return out;
  } catch { return null; }
}

// ────────────────────────────────────────────────────────────────
// Step execution
// ────────────────────────────────────────────────────────────────

interface ExecResult { ok: boolean; output?: unknown; error?: string; }

interface BrowserHandle { close: () => Promise<void>; page: unknown; }

/** Normalize action names — LLMs often output variations like "query" instead of "search.query" */
function normalizeAction(action: string, tool?: string): string {
  const map: Record<string, string> = {
    'query': 'search.query',
    'search': 'search.query',
    'web_search': 'search.query',
    'brave_search': 'search.query',
    'open': 'browser.open',
    'open_browser': 'browser.open',
    'launch': 'browser.open',
    'goto': 'browser.goto',
    'navigate': 'browser.goto',
    'visit': 'browser.goto',
    'browse': 'browser.goto',
    'read': 'browser.read',
    'read_page': 'browser.read',
    'get_text': 'browser.read',
    'extract': 'browser.read',
    'click': 'browser.click_text',
    'click_text': 'browser.click_text',
    'tap': 'browser.click_text',
    'fill': 'browser.fill',
    'fill_form': 'browser.fill',
    'type': 'browser.fill',
    'input': 'browser.fill',
    'enter': 'browser.fill',
    'download': 'browser.download',
    'download_file': 'browser.download',
    'press': 'browser.press',
    'press_key': 'browser.press',
    'submit': 'browser.press',
    'wait': 'browser.wait',
    'wait_for': 'browser.wait',
    'send_email': 'gmail.send',
    'send': 'gmail.send',
    'email': 'gmail.send',
    'mail': 'gmail.send',
    'list_emails': 'gmail.list',
    'read_emails': 'gmail.list',
    'inbox': 'gmail.list',
    'create_event': 'calendar.create',
    'add_event': 'calendar.create',
    'schedule': 'calendar.create',
    'list_events': 'calendar.list',
    'upcoming': 'calendar.list',
    'list_folder': 'files.list',
    'list_files': 'files.list',
    'ls': 'files.list',
    'read_file': 'files.read',
    'cat': 'files.read',
    'write_file': 'files.write',
    'save': 'files.write',
    'save_file': 'files.write',
  };

  if (map[action]) return map[action];

  // If action already qualified (contains a dot), pass through
  if (action.includes('.')) return action;

  // Combine tool + action if tool given (e.g. tool="browser", action="fill" -> "browser.fill")
  if (tool) {
    const combined = `${tool}.${action}`;
    if (map[combined]) return map[combined];
    return combined;
  }

  return action;
}

async function executeStep(step: WorkflowStep, ctx: { userId: string; browser?: BrowserHandle }): Promise<ExecResult> {
  try {
    const a = step.args ?? {};
    step.action = normalizeAction(step.action, step.tool);
    switch (step.action) {
      case 'search.query': {
        const r = await braveSearch(String(a.query));
        return { ok: true, output: r };
      }
      case 'browser.open': {
        if (!ctx.browser) ctx.browser = await openBrowser();
        return { ok: true };
      }
      case 'browser.goto': {
        if (!ctx.browser) ctx.browser = await openBrowser();
        await navigate((ctx.browser as { page: Parameters<typeof navigate>[0] }).page, String(a.url));
        return { ok: true };
      }
      case 'browser.read': {
        if (!ctx.browser) return { ok: false, error: 'browser not open' };
        const text = await getPageText((ctx.browser as { page: Parameters<typeof getPageText>[0] }).page);
        return { ok: true, output: text.slice(0, 5000) };
      }
      case 'browser.click_text': {
        if (!ctx.browser) return { ok: false, error: 'browser not open' };
        await clickByTextSafe((ctx.browser as { page: Parameters<typeof clickByTextSafe>[0] }).page, String(a.text));
        return { ok: true };
      }
      case 'browser.fill': {
        if (!ctx.browser) return { ok: false, error: 'browser not open' };
        await fill((ctx.browser as { page: Parameters<typeof fill>[0] }).page, String(a.selector), String(a.value));
        return { ok: true };
      }
      case 'browser.press': {
        if (!ctx.browser) return { ok: false, error: 'browser not open' };
        await pressKey((ctx.browser as { page: Parameters<typeof pressKey>[0] }).page, String(a.key ?? 'Enter'));
        return { ok: true };
      }
      case 'browser.wait': {
        if (!ctx.browser) return { ok: false, error: 'browser not open' };
        const target = String(a.target ?? a.text ?? a.selector ?? '');
        try {
          await waitFor(
            (ctx.browser as { page: Parameters<typeof waitFor>[0] }).page,
            target,
            (a.timeoutMs as number) ?? 10000,
          );
          return { ok: true };
        } catch {
          // Waits are advisory: goto/click already wait for page stability, so a
          // missed selector usually means the LLM guessed it wrong — not that the
          // page failed to load. Don't kill the task over it.
          return { ok: true, output: `wait for "${target}" timed out — continued anyway` };
        }
      }
      case 'browser.download': {
        if (!ctx.browser) return { ok: false, error: 'browser not open' };
        const f = await downloadFile((ctx.browser as { page: Parameters<typeof downloadFile>[0] }).page, String(a.selector));
        return { ok: true, output: { savedTo: f } };
      }
      case 'gmail.send': {
        const r = await sendEmail(ctx.userId, { to: String(a.to), subject: String(a.subject), body: String(a.body) });
        return { ok: true, output: r };
      }
      case 'gmail.list': {
        const r = await listRecentEmails(ctx.userId, (a.max as number) ?? 10);
        return { ok: true, output: r };
      }
      case 'calendar.create': {
        const r = await createEvent(ctx.userId, {
          summary: String(a.summary), start: String(a.start), end: String(a.end),
          attendees: (a.attendees as string[]) ?? [],
        });
        return { ok: true, output: r };
      }
      case 'calendar.list': {
        const r = await listUpcoming(ctx.userId, (a.max as number) ?? 10);
        return { ok: true, output: r };
      }
      case 'files.list': {
        const r = await listFolder(String(a.folder));
        return { ok: true, output: r };
      }
      case 'files.read': {
        const r = await readTextFile(String(a.file));
        return { ok: true, output: r.slice(0, 10000) };
      }
      case 'files.write': {
        const r = await writeTextFile(String(a.file), String(a.content));
        return { ok: true, output: { savedTo: r } };
      }
      default:
        return { ok: false, error: `Unknown action: ${step.action}` };
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ────────────────────────────────────────────────────────────────
// Screenshots (Feature 15)
// ────────────────────────────────────────────────────────────────

const SCREENSHOT_ACTIONS = new Set(['browser.goto', 'browser.click_text', 'browser.press']);

async function captureStepScreenshot(userId: string, taskId: string, idx: number, browser: BrowserHandle): Promise<string | undefined> {
  try {
    const buf = await screenshot(browser.page as Parameters<typeof screenshot>[0]);
    const supabase = supabaseAdmin();
    const path = `${userId}/${taskId}/${Date.now()}-step${idx}.jpg`;
    const { error } = await supabase.storage.from('screenshots').upload(path, buf, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (error) { console.warn('[screenshot] upload failed:', error.message); return undefined; }
    return supabase.storage.from('screenshots').getPublicUrl(path).data.publicUrl;
  } catch (e) {
    console.warn('[screenshot] skipped:', (e as Error).message.slice(0, 120));
    return undefined;
  }
}

// ────────────────────────────────────────────────────────────────
// Summaries — detailed notes with citations
// ────────────────────────────────────────────────────────────────

interface StepOutput { action: string; ok: boolean; url?: string; output?: string; error?: string; }

async function summarizeForUser(task: Task, stepOutputs: StepOutput[]): Promise<string> {
  const msgs: LLMMessage[] = [
    { role: 'system', content:
        'You write the completion report for a task an autonomous agent just finished. ' +
        'The user did not watch the agent work — this report is everything they will see, so be ' +
        'thorough and specific. Use this markdown structure:\n\n' +
        '**What I did** — 2-4 sentences narrating the approach.\n' +
        '**Key findings** — bulleted list of the concrete results: names, prices, dates, counts, ' +
        'recipient emails, filenames. Pull real details out of the step outputs; never be vague ' +
        'where the data shows specifics.\n' +
        '**Sources** — bulleted list of EVERY url from the steps as markdown links with descriptive ' +
        'labels, e.g. - [Amazon — wireless mouse results](https://...). Skip this section only if ' +
        'no URLs were visited.\n' +
        '**Next steps** — 1-2 bullets suggesting what the user might do with the result. Omit if obvious.\n\n' +
        'Rules: cite URLs exactly as they appear in the steps — never invent or shorten them. ' +
        'Do NOT mention internal errors, retries, or tool mechanics. Plain language, no fluff.' },
    { role: 'user', content: JSON.stringify({
        task: { title: task.title, description: task.description },
        steps: stepOutputs,
      }) },
  ];
  try { return (await llmChat(msgs, { temperature: 0.4, purpose: 'summarize' })).trim(); }
  catch { return 'Task completed.'; }
}

async function summarizeParent(parent: Task, children: Task[]): Promise<string> {
  const msgs: LLMMessage[] = [
    { role: 'system', content:
        'You combine the completion reports of several subtasks into one report for the parent task. ' +
        'Structure: **Overview** (2-3 sentences), then one bold heading per subtask with its key ' +
        'results condensed to 1-3 bullets, then **Sources** with every markdown link from the ' +
        'subtask reports (deduplicated, exact URLs). Plain language.' },
    { role: 'user', content: JSON.stringify({
        parent: { title: parent.title, description: parent.description },
        subtasks: children.map(c => ({ title: c.title, status: c.status, report: c.agent_note })),
      }) },
  ];
  try { return (await llmChat(msgs, { temperature: 0.4, purpose: 'summarize' })).trim(); }
  catch {
    return children.map(c => `**${c.title}** — ${c.status}\n${c.agent_note ?? ''}`).join('\n\n');
  }
}

// ────────────────────────────────────────────────────────────────
// Single-task pipeline
// ────────────────────────────────────────────────────────────────

interface TaskDeps {
  userId: string;
  available: Set<string>;
  feedbackStr: string;
  prefsBlock: string;
  live: LiveLogger;
  log: string[];
}

type TaskOutcome = 'completed' | 'paused' | 'failed';

async function processSingleTask(task: Task, deps: TaskDeps): Promise<TaskOutcome> {
  const supabase = supabaseAdmin();
  const { userId, available, feedbackStr, prefsBlock, live, log } = deps;

  // 1. workflow match?
  await live('planning', `Planning "${task.title}"…`, task.id);
  const match = await findMatchingWorkflow(userId, task, feedbackStr);
  let plan: Plan;
  if (match) {
    log.push(`  matched workflow: ${match.workflow.name}`);
    await live('planning', `Using saved workflow "${match.workflow.name}"`, task.id);
    // substitute parameters into steps
    const steps = JSON.parse(
      JSON.stringify(match.workflow.steps).replace(/\{\{(\w+)\}\}/g, (_m, k) => String(match.parameters[k] ?? ''))
    );
    plan = { tools_needed: [], risk: 'safe', reasoning: `Using saved workflow ${match.workflow.name}`, confidence: 90, steps };
    await bumpWorkflowUsage(match.workflow.id);
  } else {
    plan = await planTask(task, available, feedbackStr, prefsBlock);
    await live('planning', `Plan ready: ${plan.steps.length} steps (confidence ${plan.confidence}%) — ${plan.reasoning}`, task.id);
  }

  // 2. confidence gate (Feature 9)
  if (plan.confidence < CONFIDENCE_THRESHOLD) {
    await supabase.from('tasks').update({
      status: 'needs_confirmation',
      agent_confidence: plan.confidence,
      confirmation_prompt:
        `I'm only ${plan.confidence}% confident I can do this correctly.\n\n` +
        `${plan.confidence_reason ?? plan.reasoning}\n\n` +
        `Add more detail to the task, or approve to let me try anyway.`,
    }).eq('id', task.id);
    log.push(`  paused: low confidence (${plan.confidence})`);
    await live('info', `Paused "${task.title}" — confidence ${plan.confidence}% is below ${CONFIDENCE_THRESHOLD}%`, task.id);
    return 'paused';
  }

  // 3. risk check
  const taskText = `${task.title} ${task.description ?? ''}`;
  if (plan.risk === 'purchase' || plan.risk === 'irreversible' || looksLikePurchase(taskText)) {
    const prompt = `This task involves a ${plan.risk === 'irreversible' ? 'destructive/irreversible action' : 'purchase or payment'}.\n\nPlan: ${plan.reasoning}\n\nApprove to proceed.`;
    await supabase.from('tasks').update({
      status: 'needs_confirmation',
      confirmation_prompt: prompt,
      agent_confidence: plan.confidence,
    }).eq('id', task.id);
    log.push('  paused: risk-flagged');
    await live('info', `Paused "${task.title}" — needs approval (${plan.risk})`, task.id);
    return 'paused';
  }

  // 4. missing connectors?
  const missing = await missingConnectorsForTools(userId, plan.tools_needed);
  if (missing.length > 0) {
    await supabase.from('tasks').update({
      status: 'needs_confirmation',
      confirmation_prompt: `I need access to: ${missing.join(', ')}. Open the Settings page and connect them, then approve.`,
      agent_confidence: plan.confidence,
    }).eq('id', task.id);
    log.push(`  paused: missing connectors ${missing.join(',')}`);
    await live('info', `Paused "${task.title}" — missing connectors: ${missing.join(', ')}`, task.id);
    return 'paused';
  }

  // 5. execute with self-healing recovery (Feature 2)
  const ctx: { userId: string; browser?: BrowserHandle } = { userId };
  const agent_steps: AgentStep[] = [];
  const fullOutputs: StepOutput[] = [];
  let remaining: WorkflowStep[] = [...plan.steps];
  let recoveriesLeft = MAX_RECOVERIES;
  let success = true;
  let lastError = '';
  let lastFailedStep: WorkflowStep | null = null;

  try {
    while (remaining.length > 0) {
      const step = remaining.shift()!;
      await live('tool_call', `→ ${normalizeAction(step.action, step.tool)}${step.args ? ' ' + JSON.stringify(step.args).slice(0, 120) : ''}`, task.id);
      const r = await executeStep(step, ctx);

      let url: string | undefined;
      try {
        if (ctx.browser && ctx.browser.page) url = (ctx.browser.page as { url: () => string }).url();
      } catch { /* page may be mid-navigation */ }
      if (url === 'about:blank') url = undefined;

      // screenshot after successful page-changing browser steps (Feature 15)
      let screenshot_url: string | undefined;
      if (r.ok && ctx.browser && SCREENSHOT_ACTIONS.has(step.action)) {
        screenshot_url = await captureStepScreenshot(userId, task.id, agent_steps.length, ctx.browser);
      }

      const outputStr = r.output !== undefined ? String(JSON.stringify(r.output)) : undefined;
      agent_steps.push({
        action: step.action,
        args: step.args,
        ok: r.ok,
        output_snippet: outputStr?.slice(0, 400),
        error: r.error,
        url,
        screenshot_url,
      });
      fullOutputs.push({ action: step.action, ok: r.ok, url, output: outputStr?.slice(0, 1200), error: r.error });

      if (r.ok) {
        await live('result', `✓ ${step.action}${url ? ` — ${url}` : ''}`, task.id);
        continue;
      }

      // step failed → self-healing loop
      lastError = r.error ?? 'unknown error';
      lastFailedStep = step;
      log.push(`  step failed: ${step.action}: ${lastError}`);
      await live('error', `✗ ${step.action} failed: ${lastError.slice(0, 200)}`, task.id);

      if (recoveriesLeft <= 0) { success = false; break; }
      recoveriesLeft--;

      await live('planning', `Reflecting on the failure and replanning… (${MAX_RECOVERIES - recoveriesLeft}/${MAX_RECOVERIES})`, task.id);
      let pageContext = '';
      try {
        if (ctx.browser) pageContext = await getPageText(ctx.browser.page as Parameters<typeof getPageText>[0]);
      } catch { /* page unreadable — recover without context */ }

      const recovery = await attemptRecovery(task, agent_steps, step, lastError, remaining, pageContext, feedbackStr, prefsBlock);
      if (!recovery || !recovery.can_recover || recovery.steps.length === 0) {
        log.push('  recovery: not possible');
        await live('error', 'No viable alternative approach found.', task.id);
        success = false;
        break;
      }

      agent_steps.push({
        action: 'agent.replan',
        args: {},
        ok: true,
        recovered: true,
        note: recovery.explanation,
      });
      log.push(`  recovery: ${recovery.explanation}`);
      await live('planning', `Self-healing: ${recovery.explanation}`, task.id);
      remaining = [...recovery.steps];
    }
  } finally {
    if (ctx.browser) await ctx.browser.close().catch(() => {});
  }

  if (success) {
    const note = await summarizeForUser(task, fullOutputs);
    await supabase.from('tasks').update({
      status: 'done',
      agent_note: note,
      agent_steps,
      agent_confidence: plan.confidence,
    }).eq('id', task.id);
    await maybeSaveWorkflow(userId, task, plan.steps);
    await extractPreferences(userId, task, agent_steps);
    log.push('  ✓ completed');
    await live('result', `✓ Completed "${task.title}"`, task.id);
    return 'completed';
  }

  const detailedNote = `Failed at step: ${lastFailedStep?.action ?? '?'}\nError: ${lastError}\n\nFull plan was:\n${plan.steps.map((s, i) => `${i + 1}. ${s.action}(${JSON.stringify(s.args ?? {})})`).join('\n')}`;
  await supabase.from('tasks').update({
    status: 'needs_confirmation',
    confirmation_prompt: `Error during execution:\n\n${lastError}\n\nStep: ${lastFailedStep?.action ?? '?'}\n\nI tried ${MAX_RECOVERIES - recoveriesLeft} alternative approach(es) before giving up. Approve to retry, or skip.`,
    agent_note: detailedNote,
    agent_steps,
    agent_confidence: plan.confidence,
  }).eq('id', task.id);
  await live('error', `Failed "${task.title}" after exhausting recovery attempts`, task.id);
  return 'failed';
}

/**
 * Settle a decomposed parent from its children's fresh states: all done → parent
 * done with a combined report; otherwise → Needs You, where the dashboard nests
 * the stalled subtasks inside the parent card.
 */
async function finalizeParent(parentId: string, deps: TaskDeps): Promise<TaskOutcome | null> {
  const supabase = supabaseAdmin();
  const { data: parentRow } = await supabase.from('tasks').select('*').eq('id', parentId).maybeSingle();
  const parent = parentRow as Task | null;
  if (!parent || parent.status === 'done' || parent.status === 'skipped') return null;

  const { data: childRows } = await supabase.from('tasks').select('*').eq('parent_task_id', parentId).order('sort_index');
  const children = (childRows ?? []) as Task[];
  if (children.length === 0) return null;

  // skipped children count as settled — the user opted out of that piece
  const settled = (c: Task) => c.status === 'done' || c.status === 'skipped';
  if (children.every(settled)) {
    if (children.every(c => c.status === 'skipped')) {
      await supabase.from('tasks').update({ status: 'skipped', agent_note: 'All subtasks were skipped.' }).eq('id', parentId);
      deps.log.push(`  parent skipped: ${parent.title} (all subtasks skipped)`);
      return null;
    }
    const note = await summarizeParent(parent, children);
    await supabase.from('tasks').update({ status: 'done', agent_note: note }).eq('id', parentId);
    deps.log.push(`  ✓ parent completed: ${parent.title} (${children.length} subtasks)`);
    await deps.live('result', `✓ Completed "${parent.title}" (${children.length} subtasks settled)`, parentId);
    return 'completed';
  }

  const stalled = children.filter(c => !settled(c));
  await supabase.from('tasks').update({
    status: 'needs_confirmation',
    confirmation_prompt:
      `${children.length - stalled.length} of ${children.length} subtasks are done. Still waiting on:\n` +
      stalled.map(c => `- ${c.title} (${c.status.replace('_', ' ')})`).join('\n') +
      `\n\nResolve the subtasks below — add guidance and approve, or skip them — and I'll wrap this up next run.`,
  }).eq('id', parentId);
  deps.log.push(`  parent paused: ${parent.title} — ${stalled.length} subtask(s) incomplete`);
  await deps.live('info', `"${parent.title}" waiting on ${stalled.length} subtask(s)`, parentId);
  return 'paused';
}

// ────────────────────────────────────────────────────────────────
// Main entry — run the agent for one user
// ────────────────────────────────────────────────────────────────

export async function runAgentForUser(userId: string): Promise<{ completed: number; paused: number; failed: number; runId: string }> {
  const supabase = supabaseAdmin();

  // status='running' + live_log power the dashboard's real-time view (Feature 1).
  // Falls back to a bare insert if migration 003 hasn't been applied yet.
  let { data: run } = await supabase.from('agent_runs')
    .insert({ user_id: userId, status: 'running', live_log: [] }).select().single();
  if (!run) {
    ({ data: run } = await supabase.from('agent_runs').insert({ user_id: userId }).select().single());
  }
  const runId = run!.id as string;
  const live = makeLiveLogger(runId);

  setLLMUser(userId);

  // crash recovery: a previous run may have died leaving tasks stuck in_progress
  await supabase.from('tasks').update({ status: 'queued' })
    .eq('user_id', userId).eq('status', 'in_progress');

  const { data: queued } = await supabase
    .from('tasks').select('*')
    .eq('user_id', userId).eq('status', 'queued')
    .order('priority', { ascending: true }).order('created_at');

  const tasks = (queued ?? []) as Task[];
  // re-sort by priority weight
  const weight: Record<string, number> = { high: 0, medium: 1, low: 2 };
  tasks.sort((a, b) => weight[a.priority] - weight[b.priority]);

  const available = await listAvailableConnectors(userId);
  const feedbackStr = await getNegativeFeedback(userId);
  const prefsBlock = await getPreferencesBlock(userId);

  let completed = 0, paused = 0, failed = 0;
  const log: string[] = [];
  const deps: TaskDeps = { userId, available, feedbackStr, prefsBlock, live, log };
  const tally = (o: TaskOutcome) => {
    if (o === 'completed') completed++;
    else if (o === 'paused') paused++;
    else failed++;
  };

  await live('info', `Run started — ${tasks.length} task(s) in queue`);

  // Parents whose children run inside this loop — finalized after the loop so
  // every approved child has had its chance to execute first.
  const parentsToFinalize = new Set<string>();

  for (const task of tasks) {
    log.push(`\n--- Task: ${task.title}`);
    try {
      if (task.parent_task_id) {
        // a subtask (newly approved or still queued) — run it, settle its parent later
        tally(await processSingleTask(task, deps));
        parentsToFinalize.add(task.parent_task_id);
        continue;
      }

      const { count } = await supabase.from('tasks')
        .select('id', { count: 'exact', head: true }).eq('parent_task_id', task.id);

      if (count) {
        // Already-decomposed parent (e.g. re-approved after stalling). NEVER execute
        // the parent itself — its queued children run in this same loop.
        await supabase.from('tasks').update({ status: 'in_progress' }).eq('id', task.id);
        parentsToFinalize.add(task.id);
        log.push(`  parent of ${count} existing subtasks — finalizing after children run`);
        continue;
      }

      // Decomposition check (Feature 4)
      const subtasks = await decomposeTask(task);
      if (!subtasks) {
        tally(await processSingleTask(task, deps));
        continue;
      }

      log.push(`  decomposed into ${subtasks.length} subtasks`);
      await live('planning', `Breaking "${task.title}" into ${subtasks.length} subtasks`, task.id);

      const { data: inserted } = await supabase.from('tasks').insert(
        subtasks.map((s, i) => ({
          user_id: userId,
          title: s.title,
          description: s.description,
          priority: task.priority as Priority,
          status: 'queued',
          parent_task_id: task.id,
          sort_index: i,
        }))
      ).select();
      await supabase.from('tasks').update({ status: 'in_progress' }).eq('id', task.id);

      for (const child of (inserted ?? []) as Task[]) {
        log.push(`\n--- Subtask: ${child.title}`);
        tally(await processSingleTask(child, deps));
      }
      const outcome = await finalizeParent(task.id, deps);
      if (outcome) tally(outcome);
    } catch (e) {
      log.push(`  exception: ${(e as Error).message}`);
      failed++;
      await live('error', `Unexpected error on "${task.title}": ${(e as Error).message.slice(0, 200)}`, task.id);
      await supabase.from('tasks').update({
        status: 'needs_confirmation',
        confirmation_prompt: `Unexpected error: ${(e as Error).message}. Approve to retry.`,
      }).eq('id', task.id);
    }
  }

  for (const parentId of parentsToFinalize) {
    try {
      const outcome = await finalizeParent(parentId, deps);
      if (outcome) tally(outcome);
    } catch (e) {
      log.push(`  parent finalize error: ${(e as Error).message}`);
    }
  }

  await live('info', `Run finished — ${completed} completed, ${paused} paused, ${failed} failed`);
  await supabase.from('agent_runs').update({
    ended_at: new Date().toISOString(),
    tasks_completed: completed,
    tasks_paused: paused,
    tasks_failed: failed,
    log: log.join('\n'),
    success: failed === 0,
    status: failed === 0 ? 'completed' : 'failed',
  }).eq('id', runId);

  setLLMUser(null);
  return { completed, paused, failed, runId };
}
