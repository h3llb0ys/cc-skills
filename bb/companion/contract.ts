import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

import { MAX_PROPOSALS, proposal } from "./model";

const threadId = z.string().min(1).max(100);
export const tag = (id: string) => `companion:${id}`;
export const action = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("apply"), ids: z.array(z.string().uuid()).min(1).max(MAX_PROPOSALS) }),
  z.object({ kind: z.literal("remove"), id: z.string().uuid() }),
  z.object({ kind: z.literal("clear") }),
  z.object({ kind: z.literal("add"), text: z.string().trim().min(1).max(280) }),
  z.object({ kind: z.literal("defer"), ids: z.array(z.string().uuid()).max(MAX_PROPOSALS) }),
]);
export const board = z.object({
  proposals: z.array(proposal),
  applying: z.array(z.string()),
  selected: z.array(z.string()),
  error: z.string().nullable(),
});
export const contract = defineRpcContract({
  board_get: {
    input: z.object({ keys: z.array(threadId).max(20) }),
    output: z.record(z.string(), board),
    keyTags: id => [tag(id)],
  },
  board_action: {
    input: z.object({ threadId, action }),
    output: board,
  },
});
