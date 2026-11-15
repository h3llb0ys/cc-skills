import { z } from 'zod';
export const bindingSchema = z.object({
  keys: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*-[1-9]\d*$/)).max(20),
  revision: z.number().int().nonnegative(), reason: z.string().max(500), updatedAt: z.number(),
});
export type Binding = z.infer<typeof bindingSchema>;
export class BindingStore {
  private tail: Promise<unknown> = Promise.resolve();
  private kv: { get(key: string): Promise<unknown>; set(key: string, value: Binding): Promise<unknown> };
  constructor(kv: { get(key: string): Promise<unknown>; set(key: string, value: Binding): Promise<unknown> }) { this.kv = kv; }
  async read(threadId: string): Promise<Binding> {
    return bindingSchema.parse(await this.kv.get(`binding:${threadId}`) ?? { keys: [], revision: 0, reason: '', updatedAt: 0 });
  }
  save(threadId: string, expectedRevision: number, keys: string[], reason: string): Promise<Binding> {
    const result = this.tail.then(async () => {
      const current = await this.read(threadId);
      if (current.revision !== expectedRevision) throw new Error('Jira binding changed. Read the current state and reconcile with the latest user instruction; do not blindly retry.');
      const next = bindingSchema.parse({ keys, reason, revision: current.revision + 1, updatedAt: Date.now() });
      await this.kv.set(`binding:${threadId}`, next);
      return next;
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}
