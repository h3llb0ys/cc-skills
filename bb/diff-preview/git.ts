import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const gitPluginId = "bb--git";

const targetSchema = z.union([
  z.object({ type: z.literal("uncommitted") }),
  z.object({ type: z.literal("branch_committed"), mergeBaseBranch: z.string() }),
]);

export type GitTarget = z.infer<typeof targetSchema>;

const patchEntry = z.object({
  path: z.string(),
  patch: z.string(),
  truncated: z.boolean(),
});
const unavailable = z.object({ outcome: z.enum(["not_applicable", "unavailable"]) });

const workspaceSchema = z.object({
  workingTree: z.object({ fileCount: z.number() }),
  mergeBase: z.object({ mergeBaseBranch: z.string(), fileCount: z.number() }).nullable(),
});

export const gitRpc = defineRpcContract({
  status: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(z.string(), z.union([
      z.object({ outcome: z.literal("available"), workspace: workspaceSchema }),
      unavailable,
      z.object({ outcome: z.literal("failed") }),
    ])),
    keyTags: (key) => [`status:${key}`],
  },
  files: {
    input: z.object({
      environmentId: z.string(),
      target: targetSchema,
      ignoreWhitespace: z.boolean(),
    }),
    output: z.union([
      z.object({
        outcome: z.literal("available"),
        files: z.array(z.object({
          path: z.string(),
          revision: z.string(),
          binary: z.boolean(),
          loadMode: z.enum(["auto", "on_demand", "too_large"]),
        })),
        initialPatches: z.array(patchEntry),
      }),
      unavailable,
    ]),
    tags: ({ environmentId }) => [`files:${environmentId}`],
  },
  patches: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(z.string(), z.union([
      z.object({ outcome: z.literal("available"), patch: patchEntry }),
      unavailable,
    ])),
    keyTags: () => [],
  },
});

export function selectTarget(workspace: z.infer<typeof workspaceSchema>): GitTarget | null {
  if (workspace.workingTree.fileCount > 0) return { type: "uncommitted" };
  if (!workspace.mergeBase || workspace.mergeBase.fileCount === 0) return null;
  return { type: "branch_committed", mergeBaseBranch: workspace.mergeBase.mergeBaseBranch };
}

export function patchKey(environmentId: string, target: GitTarget, path: string, revision: string) {
  return JSON.stringify([environmentId, target, false, path, revision]);
}
