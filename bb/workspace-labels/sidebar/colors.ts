import type { CSSProperties } from 'react';
import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

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
