import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { createHash } from 'node:crypto';
import { cleanupRpc, hostCleanup, type CleanupAction } from './cleanup-contract';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

async function listAll<T>(read: (offset: number, limit: number) => Promise<T[]>) {
  const result: T[] = [];
  const limit = 200;
  for (let offset = 0; ; offset += limit) {
    const page = await read(offset, limit);
    result.push(...page);
    if (page.length < limit) return result;
  }
}

export function registerCleanup(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostCleanup });
  const busyEnvironments = new Set<string>();
  bb.experimental_hooks.on('message.dispatch', ({ thread, environment }) => {
    const environmentId = environment?.id ?? thread.environmentId;
    if (environmentId && busyEnvironments.has(environmentId)) {
      return { action: 'reject', message: 'В окружении выполняется очистка worktree.' };
    }
    return { action: 'proceed' };
  });

  async function verifyWorktreeUnused(hostId: string, path: string, threadId?: string) {
    const [environments, threads, pluginInventory] = await Promise.all([
      listAll((offset, limit) => bb.sdk.environments.list({ hostId, offset, limit })),
      listAll((offset, limit) => bb.sdk.threads.list({ hostId, archived: false, includeHidden: true, offset, limit })),
      bb.sdk.plugins.list(),
    ]);
    const pluginPaths = pluginInventory.plugins.filter(plugin => plugin.source.startsWith('path:')).map(plugin => plugin.rootDir);
    for (let offset = 0; offset < pluginPaths.length; offset += 200) {
      const matches = await host.call('worktreePathsInUse', { path, candidates: pluginPaths.slice(offset, offset + 200) }, { hostId });
      if (matches.length) throw new Error(`В worktree находится источник установленного плагина BB: ${matches[0]}.`);
    }
    const environmentIds = new Set(threads.filter(thread => thread.id !== threadId).map(thread => thread.environmentId));
    const environmentsById = new Map(environments.map(environment => [environment.id, environment]));
    const pathsInUse = new Set<string>();
    for (const environmentId of environmentIds) {
      if (!environmentId) continue;
      const environment = environmentsById.get(environmentId) ?? await bb.sdk.environments.get({ environmentId });
      if (environment.status !== 'destroyed' && environment.path) pathsInUse.add(environment.path);
    }
    const candidates = [...pathsInUse];
    for (let offset = 0; offset < candidates.length; offset += 200) {
      const matches = await host.call('worktreePathsInUse', { path, candidates: candidates.slice(offset, offset + 200) }, { hostId });
      if (matches.length) throw new Error('Этот worktree используется другим активным тредом.');
    }
  }

  async function verifyNoRelatedThreads(threadId: string, action: CleanupAction) {
    const related = new Map<string, { id: string; archivedAt: number | null }[]>();
    const threads = await listAll((offset, limit) => bb.sdk.threads.list({ includeHidden: true, offset, limit }));
    for (const thread of threads) {
      const owners = new Set([
        thread.parentThreadId,
        thread.lifecycleOwnerThreadId,
        thread.visibility === 'hidden' ? thread.sourceThreadId : null,
      ]);
      for (const owner of owners) {
        if (!owner) continue;
        const dependents = related.get(owner) ?? [];
        dependents.push(thread);
        related.set(owner, dependents);
      }
    }
    const visited = new Set([threadId]);
    const pending = [threadId];
    while (pending.length) {
      for (const dependent of related.get(pending.pop()!) ?? []) {
        if (visited.has(dependent.id)) continue;
        if (action === 'delete' || dependent.archivedAt === null) {
          throw new Error('Действие затронет связанные треды. Сначала завершите их отдельно.');
        }
        visited.add(dependent.id);
        pending.push(dependent.id);
      }
    }
  }

  async function prepare(threadId: string, action: CleanupAction) {
    const thread = await bb.sdk.threads.get({ threadId });
    if (!thread.environmentId) throw new Error('У треда нет рабочего окружения.');
    if (thread.status !== 'idle' && thread.status !== 'error') {
      throw new Error('Дождитесь окончания работы треда перед очисткой.');
    }
    const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    const { path, hostId, defaultBranch } = environment;
    if (!path || !hostId || !environment.isWorktree || !defaultBranch || environment.status !== 'ready') {
      throw new Error('Для очистки нужен доступный Git worktree с известной основной веткой.');
    }
    if (environment.managed && environment.environmentProviderId !== 'git-worktree') {
      throw new Error('Тип этого управляемого окружения не поддерживает очистку.');
    }
    await verifyWorktreeUnused(hostId, path, threadId);
    await verifyNoRelatedThreads(threadId, action);
    const target = {
      path, defaultBranch, managed: environment.managed,
      baseBranch: environment.mergeBaseBranch ?? environment.baseBranch ?? defaultBranch,
    };
    const inspection = await host.call('inspect', target, { hostId });
    const token = createHash('sha256').update(JSON.stringify([
      threadId, action, thread.archivedAt, environment.id, hostId, target, inspection.fingerprint,
    ])).digest('hex');
    return {
      environment, target, inspection, token, path, hostId,
      title: thread.title ?? threadId,
      archivedAt: thread.archivedAt,
    };
  }

  bb.rpc.register(cleanupRpc, {
    async prepare({ threadId, action }) {
      const { path, title, inspection, token } = await prepare(threadId, action);
      return { path, title, inspection, token };
    },
    async execute(input) {
      const { threadId, action } = input;
      const thread = await bb.sdk.threads.get({ threadId });
      const environmentId = thread.environmentId;
      if (!environmentId || busyEnvironments.has(environmentId)) throw new Error('Операция очистки уже выполняется или окружение недоступно.');
      busyEnvironments.add(environmentId);
      try {
        const current = await prepare(threadId, action);
        if (environmentId !== current.environment.id || input.token !== current.token) {
          throw new Error('Состояние изменилось. Откройте действие очистки заново.');
        }
        const { inspection, hostId, target } = current;
        if ((inspection.fileCount && !input.discardFiles) ||
            (inspection.unmergedCount && !input.discardCommits) ||
            (action === 'delete' && !input.confirmDelete)) {
          throw new Error('Требуется подтверждение удаления.');
        }
        const verifyThreadState = async () => {
          const latest = await bb.sdk.threads.get({ threadId });
          if (latest.environmentId !== environmentId || latest.archivedAt !== current.archivedAt ||
              (latest.status !== 'idle' && latest.status !== 'error')) {
            throw new Error('Состояние треда изменилось.');
          }
        };
        try {
          await verifyWorktreeUnused(hostId, target.path, threadId);
          await verifyThreadState();
          await host.call('removeCheckout', { target, inspection, force: input.discardFiles }, { hostId, timeoutMs: 120_000 });
        } catch (error) {
          return { state: 'failed' as const, message: `Тред сохранён. Удаление worktree не подтверждено. ${errorText(error)}` };
        }
        try {
          await verifyNoRelatedThreads(threadId, action);
          await verifyThreadState();
          if (action === 'delete') {
            await bb.sdk.threads.delete({ threadId, childThreadsConfirmed: false });
          } else if (current.archivedAt === null) {
            const result = await bb.sdk.threads.archive({ threadId });
            if (!result.archivedThreadIds.includes(threadId)) throw new Error('BB не подтвердил архивацию треда.');
          }
        } catch (error) {
          return { state: 'failed' as const, message: `Worktree удалён, ветка сохранена. Не удалось подтвердить закрытие треда. Проверьте его состояние в BB. ${errorText(error)}` };
        }
        try {
          await host.call('removeBranch', { inspection, force: input.discardCommits }, { hostId });
        } catch (error) {
          return { state: 'failed' as const, message: `Worktree удалён. Удаление локальной ветки ${inspection.branch} не подтверждено. ${errorText(error)}` };
        }
        return { state: 'done' as const, message: 'Worktree и локальная ветка удалены.' };
      } finally {
        busyEnvironments.delete(environmentId);
      }
    },
  });
}
