import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { z } from 'zod';
import { hostname, mergeRequest, projectPath, type Identity, type MergeRequest } from './contract';

const exec = promisify(execFile);
const rawMr = z.object({
  iid: z.number().int().positive(),
  title: z.string(),
  source_branch: z.string(),
  target_branch: z.string(),
  state: mergeRequest.shape.state,
  source_project_id: z.number().nullable().optional(),
  target_project_id: z.number().int().positive(),
  web_url: z.string(),
  head_pipeline: z.object({
    status: z.string(),
    detailed_status: z.object({ group: z.string().optional(), icon: z.string().optional() }).nullish(),
  }).nullish(),
});

function parseRemote(remote: string) {
  const ssh = /^(?:[^@/]+@)?([^:/]+):([^/].*)$/.exec(remote);
  let host: string;
  let path: string;
  if (ssh && !remote.includes('://')) {
    [, host, path] = ssh;
  } else {
    const url = URL.parse(remote);
    if (!url || !['https:', 'ssh:'].includes(url.protocol) || url.port || url.search || url.hash) return null;
    host = url.hostname;
    path = url.pathname;
  }
  const parsedHost = hostname.safeParse(host.toLowerCase());
  const project = projectPath.safeParse(path.replace(/^\//, '').replace(/\.git$/, ''));
  return parsedHost.success && project.success ? { hostname: parsedHost.data, project: project.data } : null;
}

function summarize(repo: Pick<Identity, 'hostname' | 'project'>, raw: z.infer<typeof rawMr>): MergeRequest {
  const head = raw.head_pipeline;
  let pipeline: MergeRequest['pipeline'] = head === null ? 'none' : 'unknown';
  switch (head?.status) {
    case 'success':
      pipeline = head.detailed_status?.group === 'success-with-warnings' ||
        head.detailed_status?.icon === 'status_warning' ? 'warning' : 'passed';
      break;
    case 'failed': case 'canceled': case 'skipped': case 'manual':
      pipeline = head.status;
      break;
    case 'blocked':
      pipeline = 'manual';
      break;
    case 'created': case 'pending': case 'running': case 'preparing': case 'scheduled':
    case 'waiting_for_resource': case 'waiting_for_callback': case 'canceling':
      pipeline = 'pending';
      break;
  }
  const url = URL.parse(raw.web_url);
  const suffix = `/-/merge_requests/${raw.iid}`;
  const canonicalPath = url?.origin === `https://${repo.hostname}` && url.pathname.endsWith(suffix)
    ? projectPath.safeParse(url.pathname.slice(1, -suffix.length)) : null;
  return {
    ...repo, project: canonicalPath?.success ? canonicalPath.data : repo.project,
    projectId: raw.target_project_id, iid: raw.iid, title: raw.title, branch: raw.source_branch,
    target: raw.target_branch, state: raw.state, pipeline,
  };
}

async function git(path: string, args: string[], signal: AbortSignal) {
  const { stdout } = await exec('git', args, { cwd: path, signal, timeout: 5_000, maxBuffer: 64 * 1024 });
  return stdout.trim();
}

async function symbolicValue(path: string, args: string[], signal: AbortSignal) {
  try {
    return await git(path, args, signal);
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return null;
    throw error;
  }
}

async function readGitLab(host: string, endpoint: string, signal: AbortSignal, paginate = false): Promise<unknown> {
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, GLAB_NO_PROMPT: '1', GITLAB_HOST: host };
    // Use glab's credentials and API configuration for the selected host.
    for (const key of [
      'GITLAB_TOKEN', 'GITLAB_ACCESS_TOKEN', 'OAUTH_TOKEN', 'CI_JOB_TOKEN', 'GLAB_ENABLE_CI_AUTOLOGIN',
      'GITLAB_REPO', 'GITLAB_URI', 'GITLAB_URL', 'GITLAB_API_HOST', 'GITLAB_SUBFOLDER',
      'GLAB_API_PROTOCOL', 'API_PROTOCOL', 'GLAB_DEBUG_HTTP',
    ]) delete env[key];
    const { stdout } = await exec('glab', [
      'api', '--method', 'GET', '--hostname', host, ...(paginate ? ['--paginate'] : []), endpoint,
    ], {
      cwd: tmpdir(), signal, timeout: 15_000, maxBuffer: 4 * 1024 * 1024,
      env,
    });
    return JSON.parse(stdout);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('glab недоступен на машине окружения.');
    throw new Error('GitLab не ответил на запрос. Проверьте доступ и авторизацию glab.');
  }
}

export async function discover({ path, hosts }: { path: string; hosts: string[] }, signal: AbortSignal) {
  try {
    if (await git(path, ['rev-parse', '--is-inside-work-tree'], signal) !== 'true') {
      return { active: null, candidates: [] };
    }
  } catch (error) {
    if ((error as { code?: unknown }).code === 128) return { active: null, candidates: [] };
    throw error;
  }
  const ref = await symbolicValue(path, ['symbolic-ref', '--quiet', 'HEAD'], signal);
  if (!ref?.startsWith('refs/heads/')) return { active: null, candidates: [] };
  const branch = ref.slice('refs/heads/'.length);
  const remotes = (await git(path, ['remote'], signal)).split('\n').filter(Boolean);
  const pushRemote = await symbolicValue(path, ['config', '--get', `branch.${branch}.pushRemote`], signal) ||
    await symbolicValue(path, ['config', '--get', 'remote.pushDefault'], signal);
  const upstream = pushRemote ? null
    : await symbolicValue(path, ['config', '--get', `branch.${branch}.remote`], signal);
  const remote = pushRemote || (upstream === '.' ? null : upstream) ||
    (remotes.length === 1 ? remotes[0] : 'origin');
  if (!remotes.includes(remote)) return { active: null, candidates: [] };
  const repo = parseRemote(await git(path, ['remote', 'get-url', '--push', '--', remote], signal));
  if (!repo || !hosts.includes(repo.hostname)) return { active: null, candidates: [] };
  const endpoint = `projects/${encodeURIComponent(repo.project)}/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}&per_page=100`;
  const open = z.array(rawMr).parse(await readGitLab(repo.hostname, endpoint, signal, true));
  const candidates = open.filter(mr => mr.source_branch === branch && mr.source_project_id === mr.target_project_id)
    .map(mr => summarize(repo, mr));
  return { active: { ...repo, project: candidates[0]?.project ?? repo.project, branch }, candidates };
}

export async function details(mr: Identity, signal: AbortSignal) {
  const endpoint = `projects/${mr.projectId}/merge_requests/${mr.iid}`;
  const result = rawMr.parse(await readGitLab(mr.hostname, endpoint, signal));
  if (result.iid !== mr.iid || result.target_project_id !== mr.projectId) throw new Error('GitLab вернул другой MR.');
  return summarize(mr, result);
}
