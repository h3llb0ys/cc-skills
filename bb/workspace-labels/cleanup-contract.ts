import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const actionSchema = z.enum(['archive', 'delete']);
const worktreeIdentitySchema = z.object({
  gitDir: z.string().min(1),
  worktreeId: z.string().min(1),
  branch: z.string().min(1),
});
export const linkedWorktreeSchema = worktreeIdentitySchema.extend({
  path: z.string().min(1),
  hostId: z.string().min(1),
  defaultBranch: z.string().min(1),
  baseBranch: z.string().min(1),
});
export type LinkedWorktree = z.infer<typeof linkedWorktreeSchema>;
export const worktreeTag = (threadId: string) => `linked-worktree:${threadId}`;

export const targetSchema = z.object({
  path: z.string().min(1),
  defaultBranch: z.string().min(1),
  baseBranch: z.string().min(1),
  managed: z.boolean().optional(),
  expected: worktreeIdentitySchema.optional(),
});
export const inspectionSchema = z.object({
  path: z.string(),
  gitDir: z.string(),
  branch: z.string(),
  head: z.string(),
  baseRef: z.string(),
  files: z.array(z.string()),
  fileCount: z.number().int().nonnegative(),
  commits: z.array(z.string()),
  unmergedCount: z.number().int().nonnegative(),
  unmergedFingerprint: z.string(),
  fingerprint: z.string(),
});
export type Target = z.infer<typeof targetSchema>;
export type Inspection = z.infer<typeof inspectionSchema>;
export type CleanupAction = z.infer<typeof actionSchema>;

export const hostCleanup = defineRpcContract({
  identify: {
    input: z.object({
      repo: z.string().min(1), path: z.string().min(1), baseBranch: z.string().min(1),
      expectedBranch: z.string().min(1).optional(),
    }),
    output: linkedWorktreeSchema.omit({ hostId: true }),
    experimental_retryable: true,
  },
  worktreePathsInUse: {
    input: z.object({ path: z.string(), candidates: z.array(z.string()).max(200) }),
    output: z.array(z.string()),
    experimental_retryable: true,
  },
  inspect: { input: targetSchema, output: inspectionSchema, experimental_retryable: true },
  removeCheckout: {
    input: z.object({ target: targetSchema, inspection: inspectionSchema, force: z.boolean() }),
    output: z.boolean(),
  },
  removeBranch: {
    input: z.object({ inspection: inspectionSchema, force: z.boolean() }),
    output: z.boolean(),
  },
});

const request = z.object({ threadId: z.string(), action: actionSchema });
const preview = z.object({
  path: z.string(),
  title: z.string(),
  inspection: inspectionSchema,
  token: z.string(),
});
const outcome = z.object({
  state: z.enum(['done', 'failed']),
  message: z.string(),
});
export type Preview = z.infer<typeof preview>;

export const cleanupRpc = defineRpcContract({
  linkedWorktrees: {
    input: z.object({ keys: z.array(z.string().min(1)).min(1).max(200) }),
    output: z.record(z.string(), linkedWorktreeSchema),
    keyTags: key => [worktreeTag(key)],
  },
  prepare: { input: request, output: preview },
  execute: {
    input: request.extend({
      token: z.string(),
      discardFiles: z.boolean(),
      discardCommits: z.boolean(),
      confirmDelete: z.boolean(),
    }),
    output: outcome,
  },
});
