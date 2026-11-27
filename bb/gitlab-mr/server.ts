import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { setTimeout as sleep } from 'node:timers/promises';
import { z } from 'zod';
import { hostname, mrKey, rpc, snapshot, snapshotTag, worker, type Snapshot } from './contract';

const empty = (): Snapshot => ({ links: [], candidates: [], active: null, notice: null });
const hostList = (value: string) => [...new Set(['gitlab.com', ...value.toLowerCase().split(/[\s,]+/).filter(Boolean)])];

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: worker });
  const settings = bb.settings.define({
    gitlabHosts: {
      type: 'string', label: 'Дополнительные хосты GitLab', default: '',
      description: 'Хосты через запятую или пробел, например gitlab.example.com.',
      experimental_schema: z.string().refine(value => hostList(value).every(item => hostname.safeParse(item).success)),
    },
    showSidebarBadges: {
      type: 'boolean', label: 'Показывать MR в списке тредов', default: false,
      description: 'Добавляет цветные ссылки на сохранённые MR рядом с заголовками тредов.',
    },
    refreshMinutes: {
      type: 'number', label: 'Обновление MR в открытом треде, минуты', default: 3,
      description: '0 означает проверку только при открытии треда.',
      experimental_schema: z.number().int().min(0).max(1440),
    },
  });
  const pending = new Map<string, Promise<unknown>>();
  let intervalChanged = new AbortController();
  settings.onChange(() => {
    intervalChanged.abort();
    intervalChanged = new AbortController();
  });

  function decode(value: unknown) {
    const result = snapshot.safeParse(value);
    return result.success ? result.data : empty();
  }

  async function read(threadId: string) {
    const metadata = await bb.sdk.threads.getPluginMetadata({ threadId });
    return decode(metadata.mergeRequests);
  }

  async function save(threadId: string, current: Snapshot, previous: Snapshot) {
    if (JSON.stringify(current) === JSON.stringify(previous)) return;
    await bb.sdk.threads.updatePluginMetadata({ threadId, set: { mergeRequests: current } });
    bb.rpc.experimental_invalidate([snapshotTag(threadId)]);
  }

  async function transact<T>(threadId: string, change: () => Promise<T>): Promise<T> {
    const operation = (pending.get(threadId) ?? Promise.resolve()).catch(() => {}).then(change);
    pending.set(threadId, operation);
    try {
      return await operation;
    } finally {
      if (pending.get(threadId) === operation) pending.delete(threadId);
    }
  }

  async function refresh(threadId: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const previous = await read(threadId);
    const thread = await bb.sdk.threads.get({ threadId, signal });
    const hosts = hostList((await settings.get()).gitlabHosts);
    const next: Snapshot = { ...previous, active: null, candidates: [], notice: null };
    const connections = new Map<string, Promise<boolean>>();
    function connected(hostId: string) {
      const current = connections.get(hostId);
      if (current) return current;
      const lookup = bb.sdk.hosts.get({ hostId }).then(
        row => row.status === 'connected' && row.lifecycle.phase === 'active',
        () => false,
      );
      connections.set(hostId, lookup);
      return lookup;
    }

    if (thread.environmentId) {
      try {
        const env = await bb.sdk.environments.get({ environmentId: thread.environmentId, signal });
        const { hostId, path } = env;
        if (path && hostId && await connected(hostId)) {
          const result = await host.call('discover', { path, hosts }, { hostId, signal });
          next.active = result.active;
          const candidates = result.candidates.map(mr => ({ ...mr, hostId }));
          if (candidates.length === 1) {
            const [candidate] = candidates;
            const known = previous.links.find(link => mrKey(link) === mrKey(candidate));
            next.links = [
              ...previous.links.filter(link => mrKey(link) !== mrKey(candidate)),
              { ...(known ?? candidate), hostId: candidate.hostId, stale: false },
            ];
          } else {
            const linked = new Set(previous.links.map(mrKey));
            next.candidates = candidates.filter(candidate => !linked.has(mrKey(candidate)));
          }
        }
      } catch {
        next.notice = 'Не удалось проверить текущую ветку. Проверьте доступ к GitLab и авторизацию glab.';
      }
    }

    const links: Snapshot['links'] = [];
    for (const link of next.links) {
      signal.throwIfAborted();
      try {
        if (!hosts.includes(link.hostname) || !await connected(link.hostId)) {
          links.push({ ...link, stale: true });
          continue;
        }
        const mr = { hostname: link.hostname, project: link.project, projectId: link.projectId, iid: link.iid };
        const current = await host.call('details', { mr }, { hostId: link.hostId, signal });
        links.push({ ...current, hostId: link.hostId, stale: false });
      } catch {
        links.push({ ...link, stale: true });
      }
    }
    signal.throwIfAborted();
    await save(threadId, { ...next, links }, previous);
  }

  bb.rpc.register(rpc, {
    async snapshot({ keys }) {
      if (!keys.length) return {};
      const { threads } = await bb.sdk.threads.experimental_listPluginMetadata({ threadIds: keys });
      const byThread = new Map(threads.map(({ threadId, metadata }) => [threadId, decode(metadata.mergeRequests)]));
      return Object.fromEntries(keys.map(threadId => [threadId, byThread.get(threadId) ?? empty()]));
    },
    watch: ({ keys }) => Object.fromEntries(keys.map(threadId => [threadId, true as const])),
    choose: ({ threadId, key }, { experimental_signal: signal }) => transact(threadId, async () => {
      const current = await read(threadId);
      const selected = current.candidates.find(candidate => mrKey(candidate) === key);
      if (!selected) return false;
      const { hostname, project, projectId, iid, hostId } = selected;
      const allowed = hostList((await settings.get()).gitlabHosts).includes(hostname);
      if (!allowed) return false;
      const details = await host.call('details', { mr: { hostname, project, projectId, iid } }, { hostId, signal });
      await save(threadId, {
        ...current, candidates: [], links: [...current.links, { ...details, hostId, stale: false }],
      }, current);
      return true;
    }),
  });

  bb.rpc.experimental_whileWatched('watch', async (read, signal) => {
    if (!('key' in read) || !/^thr_[a-zA-Z0-9_-]+$/.test(read.key)) return;
    const threadId = read.key;
    while (!signal.aborted) {
      try {
        await transact(threadId, () => refresh(threadId, signal));
      } catch {
        if (!signal.aborted) bb.log.warn('Не удалось обновить MR открытого треда.');
      }
      while (!signal.aborted) {
        const changed = intervalChanged.signal;
        const minutes = (await settings.get()).refreshMinutes;
        try {
          await sleep(minutes === 0 ? 2_147_483_647 : minutes * 60_000, undefined, {
            signal: AbortSignal.any([signal, changed]),
          });
          if (minutes !== 0) break;
        } catch {
          if (signal.aborted) return;
        }
      }
    }
  });
}
