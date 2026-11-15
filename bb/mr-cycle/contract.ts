import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { cycleSchema } from "./model";

export const cycleTag = (threadId: string) => `cycle:${threadId}`;

// Shared by server.ts and app.tsx: the frontend needs the runtime contract for keyed reads.
export const rpcContract = defineRpcContract({
  cycle_get: {
    input: z.object({ keys: z.array(z.string()).max(2000) }),
    output: z.record(z.string(), cycleSchema.nullable()),
    keyTags: (key) => [cycleTag(key)],
  },
  cycle_dismiss: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({ ok: z.literal(true) }),
  },
});
