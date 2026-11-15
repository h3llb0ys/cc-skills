import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { normalizeKeys, changeKeys } from './lib/bindings';
import { BindingStore, bindingSchema } from './lib/store';

const threadIdSchema = z.string().regex(/^thr_[a-z0-9]+$/);
const issueSchema = z.object({ key: z.string().regex(/^[A-Z][A-Z0-9_]*-[1-9]\d*$/), summary: z.string().max(1000), url: z.string().url().refine(url => new URL(url).protocol === 'https:') });
const cachedIssueSchema = z.object({ issue: issueSchema, checkedAt: z.number() });
const viewSchema = bindingSchema.extend({ issues: z.array(issueSchema), prefix: z.string() });
const editSchema = z.object({ threadId: threadIdSchema, expectedRevision: z.number().int().nonnegative(), operation: z.enum(['add','remove','replace']), keys: z.array(z.string().max(100)).max(20), reason: z.string().min(1).max(500) });
export const rpcContract = defineRpcContract({
 list: { input: z.object({ threadIds: z.array(threadIdSchema).max(200) }), output: z.record(z.string(), viewSchema) },
 edit: { input: editSchema, output: viewSchema },
 refresh: { input: z.object({threadId: threadIdSchema}), output: viewSchema },
});
export default function plugin(bb: BbPluginApi) {
 const settings = bb.settings.define({
   projectPrefixes: { type: 'string', label: 'Jira prefixes by BB project', description: 'JSON map of BB project ID to Jira prefix. Bare numbers are accepted only for configured projects.', default: '{}', experimental_schema: z.string().refine(value => { try { z.record(z.string(), z.string().regex(/^[A-Z][A-Z0-9_]*$/)).parse(JSON.parse(value)); return true; } catch { return false; } }, 'Use a JSON map, e.g. {"proj_example":"AFT"}') },
 });
 const store = new BindingStore(bb.storage.kv);
 const issueCache = new Map<string, z.infer<typeof cachedIssueSchema>>();
 async function prefix(threadId: string) {
   const thread = await bb.sdk.threads.get({ threadId });
   const map = JSON.parse((await settings.get()).projectPrefixes) as Record<string,string>;
   return map[thread.projectId] ?? '';
 }
 async function lookup(key: string, force = false) {
   const stored = issueCache.get(key) ?? await bb.storage.kv.get(`issue:${key}`);
   const cached = cachedIssueSchema.safeParse(stored).data;
   const legacy = issueSchema.safeParse(stored).data;
   if (!force && cached && Date.now() - cached.checkedAt < 60 * 60 * 1000) return cached.issue;
   try {
     const detail = await bb.sdk.plugins.callRpc({ pluginId: 'jira-boards', method: 'issue', input: { key }, outputSchema: z.object({ issue: issueSchema }) });
     if (detail.issue.key !== key) throw new Error(`Jira returned a different key for ${key}; use ${detail.issue.key}.`);
     const entry = { issue: detail.issue, checkedAt: Date.now() };
     issueCache.set(key, entry);
     await bb.storage.kv.set(`issue:${key}`, entry);
     return entry.issue;
   } catch (error) {
     // A read should retain saved badges during an outage. Explicit refresh
     // reports the failure; retry ordinary reads after a short cooldown.
     const fallback = cached?.issue ?? legacy;
     if (force || !fallback) throw error;
     issueCache.set(key, { issue: fallback, checkedAt: Date.now() - 55 * 60 * 1000 });
     return fallback;
   }
 }
 async function view(threadId: string) {
   const binding = await store.read(threadId);
   return { ...binding, issues: await Promise.all(binding.keys.map(key => lookup(key))), prefix: await prefix(threadId) };
 }
 async function edit(input: z.infer<typeof editSchema>) {
   const current = await store.read(input.threadId);
   if (current.revision !== input.expectedRevision) throw new Error('Jira binding changed. Read it again before editing.');
   const keys = normalizeKeys(input.keys, await prefix(input.threadId));
   const next = changeKeys(current.keys, input.operation, keys);
   if (next.length > 20) throw new Error('At most 20 active Jira tasks per thread.');
   await Promise.all(next.map(key => lookup(key)));
   await store.save(input.threadId, input.expectedRevision, next, input.reason);
   bb.realtime.publish('bindings-changed', { threadId: input.threadId });
   return view(input.threadId);
 }
 bb.rpc.register(rpcContract, {
   list: async ({ threadIds }) => Object.fromEntries(await Promise.all([...new Set(threadIds)].map(async id => [id, await view(id)]))),
   edit,
   refresh: async ({threadId}) => {
     const binding = await store.read(threadId);
     await Promise.all(binding.keys.map(key => lookup(key, true)));
     bb.realtime.publish('bindings-changed', {threadId});
     return view(threadId);
   },
 });
 bb.agents.registerTool({
   name: 'jira_thread_tasks',
   description: 'Read or change the CURRENT thread’s active Jira task set. Read first to get revision. Update only from user intent to work on, add, finish, or switch tasks; incidental references and Jira reads do not establish a binding. Does not change Jira tickets.',
   parameters: z.object({ operation: z.enum(['read','add','remove','replace']), keys: z.array(z.string().max(100)).max(20).default([]), expectedRevision: z.number().int().nonnegative().optional(), reason: z.string().max(500).optional() }),
   execute: async (input, ctx) => {
     if (input.operation === 'read') return JSON.stringify(await view(ctx.threadId));
     if (input.expectedRevision === undefined || !input.reason) throw new Error('Read the binding first; provide expectedRevision and the user instruction as reason.');
     return JSON.stringify(await edit({ threadId: ctx.threadId, operation: input.operation, keys: input.keys, expectedRevision: input.expectedRevision, reason: input.reason }));
   },
 });
 bb.agents.contributeInstructions(() => `Keep this thread's active Jira task badges accurate with jira_thread_tasks. When the user clearly asks to work on/read a specific task or adds, finishes, replaces tasks, first read the binding, then apply their intent. Support multiple simultaneous tasks. A read of a related issue, quoted examples, logs, comparison or passing mention never changes the binding. Bare numbers require the configured project prefix returned by read; otherwise use an explicit key confirmed in the conversation. Ambiguous task switches preserve the current set. If revision is 0 and this is an existing conversation, infer its currently active tasks from actual user work requests in the available conversation; never from examples. If revision is nonzero, do not restore old tasks after a manual edit. Empty set with nonzero revision is an intentional removal. On revision conflict reread and respect the newer edit; do not blindly overwrite it. Use the jira-thread-links skill for details. Updating these local badges is authorized when the user's task intent is clear; it does not change Jira.`);
}
