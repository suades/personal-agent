import { supabaseAdmin } from '@/lib/supabase/server';
import { llmChat, llmJson, type LLMMessage } from './llm';
import { findMatchingWorkflow, maybeSaveWorkflow, bumpWorkflowUsage } from './workflows';
import { missingConnectorsForTools, listAvailableConnectors } from './connectors';
import { braveSearch } from './tools/search';
import { openBrowser, navigate, getPageText, clickByText, fill, downloadFile } from './tools/browser';
import { sendEmail, listRecentEmails } from './tools/gmail';
import { createEvent, listUpcoming } from './tools/calendar';
import { listFolder, readTextFile, writeTextFile } from './tools/files';
import type { Task, WorkflowStep } from '@/lib/types';

interface Plan {
  tools_needed: string[];     // ['search', 'gmail', 'browser', 'files', 'calendar']
  risk: 'safe' | 'purchase' | 'irreversible' | 'data_access';
  reasoning: string;
  steps: WorkflowStep[];
}

const PURCHASE_KEYWORDS = ['buy', 'order', 'purchase', 'subscribe', 'pay ', 'payment', 'checkout', 'add to cart'];

function looksLikePurchase(text: string) {
  const lc = text.toLowerCase();
  return PURCHASE_KEYWORDS.some(k => lc.includes(k));
}

async function planTask(task: Task, availableConnectors: Set<string>): Promise<Plan> {
  const sys = `You are a planning step for an autonomous task agent.
Given a user task, output a JSON plan. Available tools:
  - search    (web search via Brave)
  - browser   (Playwright — navigate websites, click, fill forms, download files)
  - gmail     (send/read email)
  - calendar  (create/read events)
  - files     (read/write local files on the user's machine)

Currently CONNECTED tools: ${[...availableConnectors].join(', ') || 'none'}.

Output strict JSON:
{
  "tools_needed": ["..."],
  "risk": "safe" | "purchase" | "irreversible" | "data_access",
  "reasoning": "1-2 sentences",
  "steps": [ { "tool": "...", "action": "...", "args": { ... }, "notes": "..." } ]
}

Step actions you can use:
  search.query(query: string)
  browser.open()
  browser.goto(url: string)
  browser.read()
  browser.click_text(text: string)
  browser.fill(selector: string, value: string)
  browser.download(selector: string)
  gmail.send(to: string, subject: string, body: string)
  gmail.list(max?: number)
  calendar.create(summary: string, start: string, end: string, attendees?: string[])
  calendar.list(max?: number)
  files.list(folder: string)
  files.read(file: string)
  files.write(file: string, content: string)

Mark risk='purchase' for anything that spends money. Mark risk='irreversible' for destructive actions (delete files, send irrevocable messages to many people, etc).`;
  const user = JSON.stringify({ title: task.title, description: task.description });
  const messages: LLMMessage[] = [
    { role: 'system', content: sys },
    { role: 'user',   content: user },
  ];
  return await llmJson<Plan>(messages);
}

interface ExecResult { ok: boolean; output?: unknown; error?: string; }

interface BrowserHandle { close: () => Promise<void>; page: unknown; }

async function executeStep(step: WorkflowStep, ctx: { userId: string; browser?: BrowserHandle }): Promise<ExecResult> {
  try {
    const a = step.args ?? {};
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
        await clickByText((ctx.browser as { page: Parameters<typeof clickByText>[0] }).page, String(a.text));
        return { ok: true };
      }
      case 'browser.fill': {
        if (!ctx.browser) return { ok: false, error: 'browser not open' };
        await fill((ctx.browser as { page: Parameters<typeof fill>[0] }).page, String(a.selector), String(a.value));
        return { ok: true };
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

async function summarizeForUser(task: Task, executedSteps: WorkflowStep[], results: ExecResult[]): Promise<string> {
  const msgs: LLMMessage[] = [
    { role: 'system', content:
        'You write a short plain-English note (3-5 sentences) summarizing what was done for a task. ' +
        'Be specific: include recipient emails, URLs, filenames, counts. Do NOT include API errors or internal details.' },
    { role: 'user', content: JSON.stringify({ task: { title: task.title }, executedSteps, results: results.map(r => ({ ok: r.ok, output: r.output })) }) },
  ];
  try { return (await llmChat(msgs, { temperature: 0.4 })).trim(); }
  catch { return 'Task completed.'; }
}

export async function runAgentForUser(userId: string): Promise<{ completed: number; paused: number; failed: number; runId: string }> {
  const supabase = supabaseAdmin();

  const { data: run } = await supabase.from('agent_runs').insert({ user_id: userId }).select().single();
  const runId = run!.id as string;

  const { data: queued } = await supabase
    .from('tasks').select('*')
    .eq('user_id', userId).eq('status', 'queued')
    .order('priority', { ascending: true }).order('created_at');

  const tasks = (queued ?? []) as Task[];
  // re-sort by priority weight
  const weight: Record<string, number> = { high: 0, medium: 1, low: 2 };
  tasks.sort((a, b) => weight[a.priority] - weight[b.priority]);

  const available = await listAvailableConnectors(userId);

  let completed = 0, paused = 0, failed = 0;
  const log: string[] = [];

  for (const task of tasks) {
    log.push(`\n--- Task: ${task.title}`);
    try {
      // 1. workflow match?
      const match = await findMatchingWorkflow(userId, task);
      let plan: Plan;
      if (match) {
        log.push(`  matched workflow: ${match.workflow.name}`);
        // substitute parameters into steps
        const steps = JSON.parse(
          JSON.stringify(match.workflow.steps).replace(/\{\{(\w+)\}\}/g, (_m, k) => String(match.parameters[k] ?? ''))
        );
        plan = { tools_needed: [], risk: 'safe', reasoning: `Using saved workflow ${match.workflow.name}`, steps };
        await bumpWorkflowUsage(match.workflow.id);
      } else {
        plan = await planTask(task, available);
      }

      // 2. risk check
      const taskText = `${task.title} ${task.description ?? ''}`;
      if (plan.risk === 'purchase' || plan.risk === 'irreversible' || looksLikePurchase(taskText)) {
        const prompt = `This task involves a ${plan.risk === 'irreversible' ? 'destructive/irreversible action' : 'purchase or payment'}.\n\nPlan: ${plan.reasoning}\n\nApprove to proceed.`;
        await supabase.from('tasks').update({
          status: 'needs_confirmation',
          confirmation_prompt: prompt,
        }).eq('id', task.id);
        paused++; log.push('  paused: risk-flagged');
        continue;
      }

      // 3. missing connectors?
      const missing = await missingConnectorsForTools(userId, plan.tools_needed);
      if (missing.length > 0) {
        await supabase.from('tasks').update({
          status: 'needs_confirmation',
          confirmation_prompt: `I need access to: ${missing.join(', ')}. Open the Settings page and connect them, then approve.`,
        }).eq('id', task.id);
        paused++; log.push(`  paused: missing connectors ${missing.join(',')}`);
        continue;
      }

      // 4. execute
      const ctx: { userId: string; browser?: BrowserHandle } = { userId };
      const results: ExecResult[] = [];
      let success = true;
      for (const step of plan.steps) {
        const r = await executeStep(step, ctx);
        results.push(r);
        if (!r.ok) { success = false; log.push(`  step failed: ${step.action}: ${r.error}`); break; }
      }
      if (ctx.browser) await ctx.browser.close();

      if (success) {
        const note = await summarizeForUser(task, plan.steps, results);
        await supabase.from('tasks').update({ status: 'done', agent_note: note }).eq('id', task.id);
        await maybeSaveWorkflow(userId, task, plan.steps);
        completed++; log.push('  ✓ completed');
      } else {
        await supabase.from('tasks').update({
          status: 'needs_confirmation',
          confirmation_prompt: 'Hit an error executing. Tap approve to retry, or skip.',
          agent_note: results.find(r => !r.ok)?.error ?? 'Unknown failure',
        }).eq('id', task.id);
        failed++;
      }
    } catch (e) {
      log.push(`  exception: ${(e as Error).message}`);
      failed++;
      await supabase.from('tasks').update({
        status: 'needs_confirmation',
        confirmation_prompt: `Unexpected error: ${(e as Error).message}. Approve to retry.`,
      }).eq('id', task.id);
    }
  }

  await supabase.from('agent_runs').update({
    ended_at: new Date().toISOString(),
    tasks_completed: completed,
    tasks_paused: paused,
    tasks_failed: failed,
    log: log.join('\n'),
    success: failed === 0,
  }).eq('id', runId);

  return { completed, paused, failed, runId };
}
