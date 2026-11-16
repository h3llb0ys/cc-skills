import { defineRpcContract, type BbPluginApi } from '@get-bb/plugin-sdk';
import { z } from 'zod';
import { appearanceSchema, targetSchema, type Appearance } from './lib/appearance';

export const rpcContract = defineRpcContract({
 list: {input:z.null(), output:z.record(targetSchema, appearanceSchema)},
 save: {input:z.object({target:targetSchema, appearance:appearanceSchema.nullable()}), output:z.null()},
});
export default function plugin(bb: BbPluginApi) {
 let queue: Promise<unknown> = Promise.resolve();
 bb.rpc.register(rpcContract, {
  list: async () => {
   await queue;
   const keys = (await bb.storage.kv.get<string[]>('appearance-index')) ?? [];
   const rows: Record<string, Appearance> = {};
   for (const key of keys) {
    const parsed = appearanceSchema.safeParse(await bb.storage.kv.get(`appearance:${key}`));
    if (targetSchema.safeParse(key).success && parsed.success) rows[key] = parsed.data;
   }
   return rows;
  },
  save: input => {
   const job = queue.then(async () => {
    const keys = new Set((await bb.storage.kv.get<string[]>('appearance-index')) ?? []);
    if (input.appearance) {
     if (!keys.has(input.target) && keys.size >= 1000) throw new Error('Слишком много оформленных заголовков');
     await bb.storage.kv.set(`appearance:${input.target}`, input.appearance);
     keys.add(input.target);
    } else {
     await bb.storage.kv.delete(`appearance:${input.target}`);
     keys.delete(input.target);
    }
    await bb.storage.kv.set('appearance-index', [...keys]);
    bb.realtime.publish('appearance-changed', {});
    return null;
   });
   queue = job.catch(() => {});
   return job;
  },
 });
}
