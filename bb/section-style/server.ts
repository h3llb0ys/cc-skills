import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { appearanceSchema, targetSchema, type Appearance } from './lib/appearance';

const appearancesSchema = z.record(targetSchema, appearanceSchema).refine(rows => Object.keys(rows).length <= 1000, 'Слишком много оформленных заголовков');
export const rpcContract = defineRpcContract({
 list: {input:z.null(), output:appearancesSchema},
 save: {input:z.object({target:targetSchema, appearance:appearanceSchema.nullable()}), output:z.null()},
});
export default function plugin(bb: BbPluginApi) {
 bb.settings.define({
  compactRows: {
   type: 'boolean', label: 'Компактные строки', default: false,
   description: 'Шевроны слева, Jira и MR справа, остальные ссылки и worktree в меню строки.',
  },
 });
 let queue: Promise<unknown> = Promise.resolve();
 async function read(): Promise<Record<string,Appearance>> {
  const stored = await bb.storage.kv.get('appearances');
  if (stored !== undefined && stored !== null) return appearancesSchema.parse(stored);
  // Read the original storage format until the first successful atomic save.
  const keys = z.array(targetSchema).max(1000).parse((await bb.storage.kv.get('appearance-index')) ?? []);
  const rows: Record<string,Appearance> = {};
  for (const key of keys) {
   const stored = await bb.storage.kv.get(`appearance:${key}`);
   if (stored !== undefined && stored !== null) rows[key] = appearanceSchema.parse(stored);
  }
  return rows;
 }
 bb.rpc.register(rpcContract, {
  list: async () => {await queue;return read();},
  save: input => {
   const job = queue.then(async () => {
    const rows = await read();
    if (input.appearance) rows[input.target] = input.appearance;
    else delete rows[input.target];
    const next = appearancesSchema.parse(rows);
    // A single KV write keeps additions, resets and their index atomic.
    await bb.storage.kv.set('appearances',next);
    bb.realtime.publish('appearance-changed', {});
    return null;
   });
   queue = job.catch(() => {});
   return job;
  },
 });
}
