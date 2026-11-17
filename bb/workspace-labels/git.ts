import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

// Public Git fields consumed here; BB batches and invalidates this keyed read.
export const git = defineRpcContract({
  status: {
    input: z.object({ keys: z.array(z.string().min(1)).min(1).max(200) }),
    output: z.record(z.string(), z.object({
      outcome: z.string(),
      workspace: z.object({
        branch: z.object({ currentBranch: z.string().nullable(), defaultBranch: z.string().optional() }),
        checkout: z.object({ kind: z.string(), headSha: z.string().nullable().optional() }),
      }).optional(),
    })),
  },
});
export type GitStatus = z.infer<typeof git.status.output>[string];
