import type { CSSProperties } from 'react';
import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const palette = ['#808080', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#8b5cf6', '#ec4899'];
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable();
export const colorsSchema = z.object({ worktree: color, branch: color }).strict();
export type WorkspaceColors = z.infer<typeof colorsSchema>;

export const defaultColors: WorkspaceColors = { worktree: null, branch: null };
export const colorsTag = 'workspace-label-colors';
export const colorsRpc = defineRpcContract({
  labelColors: { input: z.null(), output: colorsSchema, tags: () => [colorsTag] },
  saveLabelColors: { input: colorsSchema.partial(), output: colorsSchema },
});

export function colorStyle(colors?: WorkspaceColors): CSSProperties | undefined {
  if (!colors?.worktree && !colors?.branch) return undefined;
  return {
    '--workspace-worktree-color': colors.worktree ?? undefined,
    '--workspace-branch-color': colors.branch ?? undefined,
  } as CSSProperties;
}
