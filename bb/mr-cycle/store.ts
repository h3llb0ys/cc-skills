import type { BbPluginApi } from "@get-bb/plugin-sdk";

import { cycleTag } from "./contract";
import { cycleSchema, type Cycle } from "./model";

const KEY = "cycle";
const LIST_BATCH = 200;

export interface CycleStore {
  read(threadId: string): Promise<Cycle | null>;
  readMany(threadIds: readonly string[]): Promise<Record<string, Cycle | null>>;
  write(threadId: string, cycle: Cycle): Promise<void>;
  clear(threadId: string): Promise<void>;
}

// Unreadable state (an older or hand-edited namespace) shows as no cycle rather than an error.
const parse = (metadata: Record<string, unknown>): Cycle | null => cycleSchema.safeParse(metadata[KEY]).data ?? null;

export function metadataStore(bb: BbPluginApi): CycleStore {
  const threads = bb.sdk.threads;

  return {
    async read(threadId) {
      return parse(await threads.getPluginMetadata({ threadId }));
    },
    async readMany(threadIds) {
      const result: Record<string, Cycle | null> = Object.fromEntries(threadIds.map((id) => [id, null]));
      for (let start = 0; start < threadIds.length; start += LIST_BATCH) {
        const batch = threadIds.slice(start, start + LIST_BATCH);
        const { threads: rows } = await threads.experimental_listPluginMetadata({ threadIds: batch });
        rows.forEach((row) => (result[row.threadId] = parse(row.metadata)));
      }

      return result;
    },
    async write(threadId, cycle) {
      await threads.updatePluginMetadata({ threadId, set: { [KEY]: cycle } });
      bb.rpc.experimental_invalidate([cycleTag(threadId)]);
    },
    async clear(threadId) {
      await threads.updatePluginMetadata({ threadId, remove: [KEY] });
      bb.rpc.experimental_invalidate([cycleTag(threadId)]);
    },
  };
}
