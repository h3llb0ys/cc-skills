import { cliCommand, defineCli, type BbPluginApi } from '@get-bb/plugin-sdk';
import { createHash } from 'node:crypto';
import { cleanupRpc, hostCleanup, linkedWorktreeSchema, worktreeHistoryTag, worktreeTag, type CleanupAction, type CleanupRequestInput, type LinkedWorktree, type WorktreeRow } from './contract';
import { createWorktreeHistory, worktreeKey as bindingKey, type HistoryEntry } from '../worktree-history';

type ListedThread = Awaited<ReturnType<BbPluginApi['sdk']['threads']['list']>>[number];
type HistoryThread = Pick<ListedThread, 'id' | 'title' | 'environmentId'>;

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const isWorking = (thread: ListedThread) => (thread.status !== 'idle' && thread.status !== 'error') ||
  (thread.activity?.activeBackgroundAgentCount ?? 0) > 0 ||
  (thread.activity?.activeBackgroundCommandCount ?? 0) > 0 ||
  (thread.activity?.activeWorkflowCount ?? 0) > 0;

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
  const busyThreads = new Set<string>();
  const busyWorktrees = new Set<string>();
  const readBinding = (value: unknown) => linkedWorktreeSchema.safeParse(value).data;
  const history = createWorktreeHistory(bb);

  async function ancestors(threadId: string) {
    const { threads } = await bb.sdk.threads.experimental_listAncestors({ threadIds: [threadId] });
    return threads[0]?.ancestorIds ?? [];
  }

  async function rememberNative(thread: HistoryThread, scopes: string[]) {
    if (!thread.environmentId) return;
    const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    if (!environment.isWorktree || !environment.path) return;
    const key = 'native:' + environment.id;
    history.remember(thread.id, scopes, key, {
      path: environment.path,
      hostId: environment.hostId,
      branch: environment.branchName,
      repository: null,
      sourceTitle: thread.title,
      binding: null,
    }, environment.createdAt);
    return environment.status === 'ready' ? key : undefined;
  }

  async function rememberThread(thread: HistoryThread, formerParent?: string | null) {
    const scopes = await ancestors(thread.id);
    if (formerParent) scopes.push(formerParent, ...await ancestors(formerParent));
    const binding = readBinding((await bb.sdk.threads.getPluginMetadata({ threadId: thread.id })).worktree);
    if (binding) history.linked(thread.id, thread.title, scopes, binding);
    await rememberNative(thread, scopes);
    bb.rpc.experimental_invalidate([worktreeHistoryTag]);
  }
  bb.events.on('thread.created', ({ thread }) => rememberThread(thread));
  bb.events.on('thread.active', ({ thread }) => rememberThread(thread));
  bb.events.on('thread.idle', () => bb.rpc.experimental_invalidate([worktreeHistoryTag]));
  bb.events.on('thread.archived', ({ thread }) => rememberThread(thread));
  bb.events.on('experimental_thread.parentChanged', ({ thread, previousParentThreadId }) =>
    rememberThread(thread, previousParentThreadId));
  bb.events.on('experimental_environment.removed', ({ removal }) => {
    if (removal.providerOwnedPath) history.markRemoved('native:' + removal.environmentId);
    else bb.rpc.experimental_invalidate([worktreeHistoryTag]);
  });

  async function linkedWorktrees(keys: string[]) {
    const entries: Record<string, LinkedWorktree> = {};
    for (let offset = 0; offset < keys.length; offset += 200) {
      const { threads } = await bb.sdk.threads.experimental_listPluginMetadata({ threadIds: keys.slice(offset, offset + 200) });
      for (const { threadId, metadata } of threads) {
        const worktree = readBinding(metadata.worktree);
        if (worktree && !history.isRemoved(worktree)) entries[threadId] = worktree;
      }
    }
    return entries;
  }

  bb.cli.register(defineCli({
    name: 'workspace-tools',
    summary: 'Связывает созданный Git worktree с текущим тредом BB.',
    commands: {
      link: cliCommand({
        summary: 'Зарегистрировать worktree текущего треда.',
        positionals: [
          { name: 'repo', description: 'Абсолютный путь репозитория', required: true },
          { name: 'path', description: 'Абсолютный путь worktree', required: true },
          { name: 'base', description: 'Целевая ветка', required: true },
        ],
        options: { branch: { type: 'string', description: 'Ветка, проверенная при создании worktree' } },
        async run({ positionals: { repo, path, base }, options: { branch } }, context) {
          const { threadId, signal } = context;
          if (!threadId || busyThreads.has(threadId)) throw new Error('Текущий тред BB недоступен для привязки.');
          const thread = await bb.sdk.threads.get({ threadId, signal });
          if (!thread.environmentId) throw new Error('У треда нет рабочего окружения.');
          const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId, signal });
          const { hostId } = environment;
          if (!hostId) throw new Error('Не удалось определить машину треда.');
          const worktree = await host.call('identify', { repo, path, baseBranch: base, expectedBranch: branch }, { hostId, signal });
          if (environment.isWorktree) {
            if (environment.path === worktree.path) return { exitCode: 0, stdout: worktree.path };
            throw new Error('У треда уже есть собственный Git worktree.');
          }
          const key = JSON.stringify([hostId, worktree.path]);
          if (busyThreads.has(threadId) || busyWorktrees.has(key)) {
            throw new Error('Выполняется привязка или очистка worktree.');
          }
          busyThreads.add(threadId);
          busyWorktrees.add(key);
          try {
            const binding = { ...worktree, hostId };
            if (history.isRemoved(binding)) throw new Error('Worktree уже удалён.');
            const scopes = await ancestors(threadId);
            const previous = readBinding((await bb.sdk.threads.getPluginMetadata({ threadId })).worktree);
            if (previous) history.linked(threadId, thread.title, scopes, previous);
            await bb.sdk.threads.updatePluginMetadata({ threadId, set: { worktree: binding } });
            history.linked(threadId, thread.title, scopes, binding, Date.now());
            bb.rpc.experimental_invalidate([worktreeTag(threadId), worktreeHistoryTag]);
            return { exitCode: 0, stdout: worktree.path };
          } finally {
            busyWorktrees.delete(key);
            busyThreads.delete(threadId);
          }
        },
      }),
    },
  }));
  bb.experimental_hooks.on('message.dispatch', ({ thread, environment }) => {
    const environmentId = environment?.id ?? thread.environmentId;
    if (busyThreads.has(thread.id) || (environmentId && busyEnvironments.has(environmentId))) {
      return { action: 'reject', message: 'В окружении выполняется очистка worktree.' };
    }
    return { action: 'proceed' };
  });

  async function verifyWorktreeUnused(hostId: string, path: string, threadId: string | undefined, linked: boolean) {
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
    const otherBindings = await linkedWorktrees(threads.filter(thread => threadId
      ? thread.id !== threadId : isWorking(thread)).map(thread => thread.id));
    for (const worktree of Object.values(otherBindings)) {
      if (worktree.hostId === hostId) pathsInUse.add(worktree.path);
    }
    if (linked) {
      for (const environment of environments) {
        if ((environment.managed || (!threadId && environment.isWorktree)) &&
            environment.status !== 'destroyed' && environment.path) pathsInUse.add(environment.path);
      }
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
    await verifyWorktreeOwnersIdle([threadId]);
    const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    const { hostId } = environment;
    const binding = environment.isWorktree ? undefined
      : readBinding((await bb.sdk.threads.getPluginMetadata({ threadId })).worktree);
    const path = binding?.path ?? environment.path;
    const defaultBranch = binding?.defaultBranch ?? environment.defaultBranch;
    if (!path || !hostId || !defaultBranch || (!environment.isWorktree && !binding) ||
        (binding && history.isRemoved(binding)) ||
        (binding && binding.hostId !== hostId) || environment.status !== 'ready') {
      throw new Error('У треда нет доступного Git worktree для очистки.');
    }
    if (!binding && environment.managed && environment.environmentProviderId !== 'git-worktree') {
      throw new Error('Тип этого управляемого окружения не поддерживает очистку.');
    }
    const linked = binding !== undefined;
    await verifyWorktreeUnused(hostId, path, threadId, linked);
    await verifyNoRelatedThreads(threadId, action);
    const target = {
      path, defaultBranch, expected: binding && {
        gitDir: binding.gitDir, worktreeId: binding.worktreeId, branch: binding.branch,
      },
      managed: !linked && environment.managed,
      baseBranch: binding?.baseBranch ?? environment.mergeBaseBranch ?? environment.baseBranch ?? defaultBranch,
    };
    const inspection = await host.call('inspect', target, { hostId });
    const checkoutKey = bindingKey({ hostId, gitDir: inspection.gitDir, worktreeId: inspection.worktreeId });
    await verifyWorktreeOwnersIdle(history.owners(checkoutKey).filter(id => id !== threadId));
    const token = createHash('sha256').update(JSON.stringify([
      threadId, action, thread.archivedAt, environment.id, hostId, target, inspection.fingerprint,
    ])).digest('hex');
    return {
      environment, target, inspection, token, path, hostId, linked, binding, checkoutKey,
      title: thread.title ?? threadId,
      archivedAt: thread.archivedAt,
    };
  }

  async function descendants(threadId: string) {
    const { threads: tree } = await bb.sdk.threads.experimental_listDescendants({
      threadIds: [threadId], includeArchived: true, includeHidden: true,
    });
    return tree[0]?.descendantIds ?? [];
  }

  async function worktreeHistory(threadId: string): Promise<WorktreeRow[]> {
    const ids = [threadId, ...await descendants(threadId)];
    const currentThreads: ListedThread[] = [];
    const readyNative = new Set<string>();
    for (let offset = 0; offset < ids.length; offset += 200) {
      const threadIds = ids.slice(offset, offset + 200);
      const [threads, currentBindings] = await Promise.all([
        bb.sdk.threads.list({ threadIds, includeHidden: true, limit: 200 }),
        linkedWorktrees(threadIds),
      ]);
      currentThreads.push(...threads);
      await Promise.all(threads.map(async thread => {
        const binding = currentBindings[thread.id];
        if (binding) history.linked(thread.id, thread.title, [threadId], binding);
        const key = await rememberNative(thread, [threadId]).catch(error => {
          bb.log.warn(`Не удалось прочитать окружение треда ${thread.id}: ${errorText(error)}`);
        });
        if (key) readyNative.add(key);
      }));
    }
    const entries = new Map<string, HistoryEntry>();
    for (const entry of history.list(threadId, ids)) {
      if (!entries.has(entry.key)) entries.set(entry.key, entry);
    }
    const byHost = new Map<string, HistoryEntry[]>();
    for (const entry of entries.values()) {
      if (entry.removed && !readyNative.has(entry.key)) continue;
      const group = byHost.get(entry.hostId) ?? [];
      if (!byHost.has(entry.hostId)) byHost.set(entry.hostId, group);
      group.push(entry);
    }
    const states = new Map<string, WorktreeRow['state']>();
    await Promise.all([...byHost].map(async ([hostId, group]) => {
      for (let offset = 0; offset < group.length; offset += 50) {
        const result: Record<string, WorktreeRow['state']> = await host.call('worktreeStates', {
          paths: group.slice(offset, offset + 50).map(({ key, path, binding }) => ({
            key, path, expected: binding ?? undefined,
          })),
        }, { hostId, timeoutMs: 5_000 }).catch(() => ({}));
        for (const [key, state] of Object.entries(result)) states.set(key, state);
      }
    }));
    const nativePaths = new Set([...entries.values()].filter(entry => !entry.binding && states.get(entry.key) === 'available')
      .map(entry => JSON.stringify([entry.hostId, entry.path])));
    const visiblePaths = new Set<string>();
    const running = new Set(currentThreads.filter(thread => thread.archivedAt === null && isWorking(thread)).map(thread => thread.id));
    return [...entries.values()].flatMap(entry => {
      const state = states.get(entry.key) ?? (entry.removed && !readyNative.has(entry.key) ? 'removed' : 'unavailable');
      if (entry.removed && readyNative.has(entry.key) && state === 'available') history.restoreNative(entry.key);
      if (state === 'available') {
        const location = JSON.stringify([entry.hostId, entry.path]);
        if (visiblePaths.has(location) || (entry.binding && nativePaths.has(location))) return [];
        visiblePaths.add(location);
      }
      const blockedReason = !entry.binding ? 'Worktree используется как окружение BB.'
        : history.owners(entry.key).some(id => running.has(id)) ? 'Дождитесь окончания работы треда.' : null;
      const { key, path, branch, repository, sourceId, sourceTitle } = entry;
      return [{ key, path, branch, repository, sourceId, sourceTitle, state, blockedReason }];
    });
  }

  type WorktreeRequest = Extract<CleanupRequestInput, { action: 'worktree' }>;
  async function prepareWorktree(request: WorktreeRequest) {
    const entry = history.list(request.threadId, await descendants(request.threadId)).find(row => row.key === request.worktreeKey);
    if (!entry?.binding || entry.removed) throw new Error('Для этого worktree очистка недоступна.');
    const { path, hostId, defaultBranch, baseBranch } = entry.binding;
    const target = { path, defaultBranch, baseBranch, expected: entry.binding };
    const inspection = await host.call('inspect', target, { hostId });
    const token = createHash('sha256').update(JSON.stringify([request.threadId, entry.key, target, inspection.fingerprint]))
      .digest('hex');
    return { entry, target, inspection, token };
  }

  async function verifyWorktreeOwnersIdle(ownerIds: string[]) {
    for (let offset = 0; offset < ownerIds.length; offset += 200) {
      const threads = await bb.sdk.threads.list({
        threadIds: ownerIds.slice(offset, offset + 200), archived: false, includeHidden: true, limit: 200,
      });
      if (threads.some(isWorking)) {
        throw new Error('Дождитесь окончания работы треда перед очисткой.');
      }
    }
  }

  bb.rpc.register(cleanupRpc, {
    worktreeHistory: ({ threadId }) => worktreeHistory(threadId),
    linkedWorktrees: ({ keys }) => linkedWorktrees(keys),
    async prepare(request) {
      if (request.action === 'worktree') {
        const { entry, inspection, token } = await prepareWorktree(request);
        await verifyWorktreeOwnersIdle(history.owners(entry.key));
        await verifyWorktreeUnused(entry.hostId, entry.path, undefined, true);
        return { path: entry.path, title: entry.repository ?? 'Worktree', inspection, token };
      }
      const { path, title, inspection, token } = await prepare(request.threadId, request.action);
      return { path, title, inspection, token };
    },
    async execute(input) {
      if (input.action === 'worktree') {
        const { entry, target, inspection, token } = await prepareWorktree(input);
        if (token !== input.token) throw new Error('Состояние изменилось. Откройте действие очистки заново.');
        if ((inspection.fileCount && !input.discardFiles) || (inspection.unmergedCount && !input.discardCommits)) {
          throw new Error('Требуется подтверждение удаления.');
        }
        const { hostId, path } = entry;
        const key = JSON.stringify([hostId, path]);
        const owners = history.owners(entry.key);
        if (busyWorktrees.has(key) || owners.some(id => busyThreads.has(id))) {
          throw new Error('Выполняется привязка или очистка worktree.');
        }
        busyWorktrees.add(key);
        for (const id of owners) busyThreads.add(id);
        try {
          await verifyWorktreeUnused(hostId, path, undefined, true);
          await verifyWorktreeOwnersIdle(owners);
          await host.call('removeCheckout', { target, inspection, force: input.discardFiles }, { hostId, timeoutMs: 120_000 });
          try {
            history.markRemoved(entry.key);
          } catch (error) {
            return { state: 'failed' as const, message: `Worktree удалён, ветка сохранена. Не удалось обновить историю. ${errorText(error)}` };
          }
          try {
            await host.call('removeBranch', { inspection, force: input.discardCommits }, { hostId });
          } catch (error) {
            return { state: 'failed' as const, message: `Worktree удалён. Удаление локальной ветки ${inspection.branch} не подтверждено. ${errorText(error)}` };
          }
          return { state: 'done' as const, message: 'Worktree и локальная ветка удалены.' };
        } finally {
          for (const id of owners) busyThreads.delete(id);
          busyWorktrees.delete(key);
        }
      }
      const { threadId, action } = input;
      const thread = await bb.sdk.threads.get({ threadId });
      const environmentId = thread.environmentId;
      if (!environmentId || busyThreads.has(threadId)) throw new Error('Операция очистки уже выполняется или окружение недоступно.');
      busyThreads.add(threadId);
      let worktreeKey: string | undefined;
      let lockedEnvironment = false;
      let removedBinding: LinkedWorktree | undefined;
      let removedCheckoutKey: string | undefined;
      let deletedThread = false;
      let otherOwners: string[] = [];
      try {
        const current = await prepare(threadId, action);
        if (environmentId !== current.environment.id || input.token !== current.token) {
          throw new Error('Состояние изменилось. Откройте действие очистки заново.');
        }
        const { inspection, hostId, target, linked } = current;
        const owners = history.owners(current.checkoutKey).filter(id => id !== threadId);
        const key = JSON.stringify([hostId, inspection.path]);
        if (busyWorktrees.has(key) || (!linked && busyEnvironments.has(environmentId)) || owners.some(id => busyThreads.has(id))) {
          throw new Error('В окружении уже выполняется очистка worktree.');
        }
        otherOwners = owners;
        for (const id of otherOwners) busyThreads.add(id);
        busyWorktrees.add(key);
        worktreeKey = key;
        if (!linked) {
          busyEnvironments.add(environmentId);
          lockedEnvironment = true;
        }
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
          if (linked) {
            const latestBinding = readBinding((await bb.sdk.threads.getPluginMetadata({ threadId })).worktree);
            if (JSON.stringify(latestBinding) !== JSON.stringify(current.binding)) {
              throw new Error('Привязка worktree изменилась.');
            }
          }
        };
        try {
          await verifyWorktreeUnused(hostId, target.path, threadId, linked);
          if (current.binding) history.linked(threadId, current.title, await ancestors(threadId), current.binding);
          else await rememberNative(thread, await ancestors(threadId));
          await verifyThreadState();
          await verifyWorktreeOwnersIdle([threadId, ...otherOwners]);
          await host.call('removeCheckout', { target, inspection, force: input.discardFiles }, { hostId, timeoutMs: 120_000 });
          removedBinding = current.binding;
          removedCheckoutKey = current.checkoutKey;
        } catch (error) {
          return { state: 'failed' as const, message: `Тред сохранён. Удаление worktree не подтверждено. ${errorText(error)}` };
        }
        try {
          await verifyNoRelatedThreads(threadId, action);
          await verifyThreadState();
          if (action === 'delete') {
            await bb.sdk.threads.delete({ threadId, childThreadsConfirmed: false });
            deletedThread = true;
          } else if (current.archivedAt === null) {
            const result = await bb.sdk.threads.archive({ threadId });
            if (!result.archivedThreadIds.includes(threadId)) throw new Error('BB не подтвердил архивацию треда.');
          }
        } catch (error) {
          const state = inspection.branch ? 'Worktree удалён, ветка сохранена.' : 'Worktree удалён.';
          return { state: 'failed' as const, message: `${state} Не удалось подтвердить закрытие треда. Проверьте его состояние в BB. ${errorText(error)}` };
        }
        if (inspection.branch === null) return { state: 'done' as const, message: 'Worktree удалён.' };
        try {
          await host.call('removeBranch', { inspection, force: input.discardCommits }, { hostId });
        } catch (error) {
          return { state: 'failed' as const, message: `Worktree удалён. Удаление локальной ветки ${inspection.branch} не подтверждено. ${errorText(error)}` };
        }
        return { state: 'done' as const, message: 'Worktree и локальная ветка удалены.' };
      } finally {
        if (removedBinding && !deletedThread) {
          try {
            const currentBinding = readBinding((await bb.sdk.threads.getPluginMetadata({ threadId })).worktree);
            if (JSON.stringify(currentBinding) === JSON.stringify(removedBinding)) {
              await bb.sdk.threads.updatePluginMetadata({ threadId, remove: ['worktree'] });
              bb.rpc.experimental_invalidate([worktreeTag(threadId)]);
            }
          } catch (error) {
            bb.log.warn(`Не удалось убрать привязку удалённого worktree у треда ${threadId}: ${errorText(error)}`);
          }
        }
        if (lockedEnvironment) busyEnvironments.delete(environmentId);
        if (worktreeKey) busyWorktrees.delete(worktreeKey);
        busyThreads.delete(threadId);
        for (const id of otherOwners) busyThreads.delete(id);
        if (removedCheckoutKey) {
          try {
            history.markRemoved(removedCheckoutKey);
          } catch (error) {
            bb.log.warn(`Не удалось обновить историю worktree: ${errorText(error)}`);
          }
        } else if (worktreeKey) bb.rpc.experimental_invalidate([worktreeHistoryTag]);
      }
    },
  });
}
