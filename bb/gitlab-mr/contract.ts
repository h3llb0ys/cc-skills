import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

const threadId = z.string().regex(/^thr_[a-zA-Z0-9_-]+$/);
const keys = z.object({ keys: z.array(threadId).max(50) });
export const hostname = z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/i);
export const projectPath = z.string().regex(/^[\w.-]+(?:\/[\w.-]+)+$/).refine(
  path => path.split('/').every(part => part !== '.' && part !== '..'),
);
export const identity = z.object({
  hostname,
  project: projectPath,
  projectId: z.number().int().positive(),
  iid: z.number().int().positive(),
});
export const mergeRequest = identity.extend({
  title: z.string(),
  branch: z.string(),
  target: z.string(),
  state: z.enum(['opened', 'closed', 'merged', 'locked']),
  pipeline: z.enum(['passed', 'warning', 'failed', 'pending', 'manual', 'canceled', 'skipped', 'none', 'unknown']),
});
export const snapshot = z.object({
  links: z.array(mergeRequest.extend({ hostId: z.string(), stale: z.boolean() })),
  candidates: z.array(mergeRequest.extend({ hostId: z.string() })),
  active: z.object({ hostname, project: projectPath, branch: z.string() }).nullable(),
  notice: z.string().nullable(),
});
export type MergeRequest = z.infer<typeof mergeRequest>;
export type Identity = z.infer<typeof identity>;
export type Snapshot = z.infer<typeof snapshot>;
export const mrKey = ({ hostname, projectId, iid }: Identity) => `${hostname}/${projectId}!${iid}`;
export const mrUrl = ({ hostname, project, iid }: Identity) => `https://${hostname}/${project}/-/merge_requests/${iid}`;

export const snapshotTag = (id: string) => `snapshot:${id}`;
export const rpc = defineRpcContract({
  snapshot: {
    input: z.object({ keys: z.array(threadId).max(200) }), output: z.record(threadId, snapshot),
    keyTags: id => [snapshotTag(id)],
  },
  watch: {
    input: keys, output: z.record(threadId, z.literal(true)),
  },
  choose: {
    input: z.object({ threadId, key: z.string().max(1024) }),
    output: z.boolean(),
  },
});

export const worker = defineRpcContract({
  discover: {
    input: z.object({ path: z.string(), hosts: z.array(hostname) }),
    output: z.object({ active: snapshot.shape.active, candidates: z.array(mergeRequest) }),
  },
  details: {
    input: z.object({ mr: identity }),
    output: mergeRequest,
  },
});
