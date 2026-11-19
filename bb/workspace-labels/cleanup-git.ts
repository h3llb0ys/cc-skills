import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, open, readdir, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { experimental_killProcessesWithCwdUnder } from '@get-bb/plugin-sdk/host';
import type { Inspection, Target } from './cleanup-contract';

const run = promisify(execFile);
const limit = 50;

async function git(context: string[], args: string[], signal?: AbortSignal) {
  const command = run('git', ['--no-optional-locks', ...context, ...args], {
    encoding: 'buffer',
    maxBuffer: 16 * 1024 * 1024,
    signal,
  });
  const { stdout } = await command;
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(stdout);
  } catch {
    throw new Error('Git вернул имя или текст вне UTF-8. Очистка остановлена.');
  }
}

async function pathExists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw error;
  }
}

async function resolveBase(context: string[], base: string, signal?: AbortSignal) {
  const refs = base.startsWith('refs/')
    ? [base].filter(ref => /^refs\/(heads|remotes)\//.test(ref))
    : [`refs/remotes/${base}`, `refs/heads/${base}`, `refs/remotes/origin/${base}`];
  for (const ref of refs) {
    try {
      await git(context, ['rev-parse', '--verify', ref], signal);
      return ref;
    } catch (error) {
      if (signal?.aborted || (error as { code?: unknown }).code !== 128) throw error;
    }
  }
  throw new Error(`Локальная копия целевой ветки ${base} недоступна.`);
}

async function worktreeLocation(target: string, signal?: AbortSignal) {
  const result = await git(['-C', target], ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-dir', '--git-common-dir'], signal);
  const [root, gitDir, commonDir] = result.trimEnd().split('\n');
  if (!root || !gitDir || !commonDir || gitDir === commonDir) {
    throw new Error('Очистка доступна для отдельного Git worktree.');
  }
  const path = await realpath(root);
  if (await realpath(target) !== path) throw new Error('Путь Git worktree изменился.');
  return { root, path, gitDir, commonDir };
}

async function worktreeId(gitDir: string) {
  const directory = await lstat(gitDir, { bigint: true });
  return `${directory.dev}:${directory.ino}:${directory.birthtimeNs}`;
}

async function originDefaultBranch(context: string[], signal?: AbortSignal) {
  const head = await git(context, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], signal).catch(error => {
    if (!signal?.aborted && (error as { code?: unknown }).code === 1) return '';
    throw error;
  });
  return /^refs\/remotes\/origin\/(.+)$/.exec(head.trim())?.[1];
}

export async function identifyWorktree(input: { repo: string; path: string; baseBranch: string; expectedBranch?: string }, signal?: AbortSignal) {
  if (!isAbsolute(input.repo) || !isAbsolute(input.path)) throw new Error('Укажите абсолютные пути репозитория и worktree.');
  const source = ['-C', input.repo];
  const [location, sourceGitDir, ref] = await Promise.all([
    worktreeLocation(input.path, signal),
    git(source, ['rev-parse', '--path-format=absolute', '--git-common-dir'], signal),
    git(['-C', input.path], ['symbolic-ref', 'HEAD'], signal),
  ]);
  const commonDir = await realpath(location.commonDir);
  if (commonDir !== await realpath(sourceGitDir.trimEnd())) {
    throw new Error('Worktree принадлежит другому репозиторию.');
  }
  const branch = ref.trim().slice('refs/heads/'.length);
  if (input.expectedBranch !== undefined && input.expectedBranch !== branch) {
    throw new Error(`Ветка worktree изменилась: ожидалась ${input.expectedBranch}, сейчас ${branch}.`);
  }
  const remoteDefault = await originDefaultBranch(source, signal);
  const defaultBranch = remoteDefault ??
    (await resolveBase(source, 'main', signal).catch(error => {
      if (signal?.aborted) throw error;
      return resolveBase(source, 'master', signal);
    })).replace(/^refs\/(?:heads|remotes\/origin)\//, '');
  if (branch === 'main' || branch === defaultBranch || (!remoteDefault && branch === 'master')) {
    throw new Error(`Ветка ${branch} защищена.`);
  }
  let baseRef = (await git(source, [
    'rev-parse', '--symbolic-full-name', '--verify', '--end-of-options', input.baseBranch,
  ], signal)).trim();
  if (!/^refs\/(heads|remotes)\//.test(baseRef)) {
    await git(source, ['rev-parse', '--verify', '--end-of-options', `${input.baseBranch}^{commit}`], signal);
    baseRef = await resolveBase(source, defaultBranch, signal);
  }
  return {
    path: location.path,
    gitDir: commonDir,
    worktreeId: await worktreeId(location.gitDir),
    branch, defaultBranch, baseBranch: baseRef,
  };
}

export async function worktreeState(path: string, expected: Target['expected'], signal?: AbortSignal) {
  try {
    if (!await pathExists(path)) return 'removed' as const;
    const { gitDir, commonDir } = await worktreeLocation(path, signal);
    if (expected) {
      const ref = await git(['-C', path], ['symbolic-ref', 'HEAD'], signal);
      if (ref.trim() !== `refs/heads/${expected.branch}` || await realpath(commonDir) !== expected.gitDir ||
          await worktreeId(gitDir) !== expected.worktreeId) return 'unavailable' as const;
    }
    return 'available' as const;
  } catch {
    return 'unavailable' as const;
  }
}

export async function inspectWorktree(target: Target, signal?: AbortSignal): Promise<Inspection> {
  const context = ['-C', target.path];
  const [{ root, path, gitDir, commonDir }, branchName, head, status, ignored, staged, index] = await Promise.all([
    worktreeLocation(target.path, signal),
    git(context, ['branch', '--show-current'], signal),
    git(context, ['rev-parse', 'HEAD'], signal),
    git(context, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'], signal),
    git(context, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard'], signal),
    git(context, ['diff', '--cached', '--raw', '--no-abbrev', '-z', '--no-renames'], signal),
    git(context, ['ls-files', '-v', '--stage', '-z'], signal),
  ]);
  if (await pathExists(join(gitDir, 'locked'))) throw new Error('Git worktree заблокирован.');
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'BISECT_START', 'sequencer', 'rebase-apply', 'rebase-merge']) {
    if (await pathExists(join(gitDir, marker))) {
      throw new Error(`Операция Git ещё не завершена (${marker}). Очистка остановлена.`);
    }
  }
  if (target.managed && await pathExists(join(root, '.bb-env-teardown.sh'))) {
    throw new Error('У worktree есть .bb-env-teardown.sh. Для запуска этого скрипта используйте штатную архивацию BB.');
  }
  const branch = branchName.trim() || null;
  const [repository, checkoutId] = await Promise.all([realpath(commonDir), worktreeId(gitDir)]);
  const expected = target.expected;
  if (expected && (branch !== expected.branch || repository !== expected.gitDir || checkoutId !== expected.worktreeId)) {
    throw new Error('Привязанный worktree или его ветка изменились. Очистка остановлена.');
  }
  const remoteDefault = await originDefaultBranch(context, signal);
  if (branch === 'main' || branch === target.defaultBranch || branch === remoteDefault ||
      (expected && !remoteDefault && branch === 'master')) {
    throw new Error(`Ветка ${branch} защищена.`);
  }
  for (const entry of index.split('\0')) {
    const tag = entry[0] ?? '';
    const path = entry.slice(entry.indexOf('\t') + 1);
    if (entry.startsWith('160000 ', 2)) {
      const entries = await readdir(join(root, path)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
        throw error;
      });
      if (entries.length) throw new Error(`Git submodule ${path} содержит файлы. Очистка остановлена.`);
    }
    if (/[a-zS]/.test(tag) && await pathExists(join(root, path))) {
      const flag = tag.toUpperCase() === 'S' ? 'skip-worktree' : 'assume-unchanged';
      throw new Error(`Git исключает ${path} из проверки изменений (${flag}). Очистка остановлена.`);
    }
  }
  const isOwnRef = (ref: string) => branch !== null &&
    (ref === `refs/heads/${branch}` || (ref.startsWith('refs/remotes/') && ref.endsWith('/' + branch)));
  let baseRef = await resolveBase(context, target.baseBranch === branch ? target.defaultBranch : target.baseBranch, signal);
  if (isOwnRef(baseRef)) baseRef = await resolveBase(context, target.defaultBranch, signal);
  if (isOwnRef(baseRef)) throw new Error('Нужна целевая ветка, отличная от очищаемой ветки.');
  const commitRange = `${baseRef}..${head.trim()}`;
  const [unmerged, log] = await Promise.all([
    git(context, ['rev-list', '--topo-order', commitRange], signal),
    git(context, ['log', '--no-color', '-n', String(limit), '--format=%h %s', commitRange], signal),
  ]);
  const entries = status.split('\0');
  entries.pop();
  const files: string[] = [];
  const pathsToCheck: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    pathsToCheck.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) {
      const from = entries[++i]!;
      pathsToCheck.push(from);
      files.push(`${entry} ← ${from}`);
    } else {
      files.push(entry);
    }
  }
  for (const path of ignored.split('\0').filter(Boolean)) {
    pathsToCheck.push(path);
    files.push(`!! ${path}`);
  }
  for (const path of pathsToCheck) {
    if (path.endsWith('/') && await pathExists(join(root, path, '.git'))) {
      throw new Error(`В worktree есть вложенный Git репозиторий ${path}. Очистка остановлена.`);
    }
  }
  const fileVersions = [];
  for (let offset = 0; offset < pathsToCheck.length; offset += 100) {
    const versions = await Promise.all(pathsToCheck.slice(offset, offset + 100).map(async path => {
      try {
        const stat = await lstat(join(root, path), { bigint: true });
        return [stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return null;
      }
    }));
    fileVersions.push(...versions);
  }
  const result = {
    path, gitDir: repository, worktreeId: checkoutId, branch, head: head.trim(), baseRef,
    files: files.slice(0, limit), fileCount: files.length,
    commits: log.trimEnd().split('\n').filter(Boolean),
    unmergedCount: unmerged.split('\n').filter(Boolean).length,
    unmergedFingerprint: createHash('sha256').update(unmerged).digest('hex'),
  };
  return {
    ...result,
    fingerprint: createHash('sha256').update(JSON.stringify([result, status, staged, fileVersions])).digest('hex'),
  };
}

export async function removeCheckout(target: Target, inspection: Inspection, force: boolean, signal?: AbortSignal) {
  const recheck = async () => {
    const current = await inspectWorktree(target, signal);
    if (current.fingerprint !== inspection.fingerprint) throw new Error('Состояние изменилось. Проверьте worktree повторно.');
    if (current.fileCount && !force) throw new Error('Для удаления изменённых файлов нужно подтверждение.');
    return current;
  };
  const current = await recheck();
  if (target.managed) {
    await experimental_killProcessesWithCwdUnder({ directories: [current.path] });
    await recheck();
  }
  const args = ['worktree', 'remove'];
  if (current.fileCount) args.push('--force');
  await git(['--git-dir', current.gitDir], [...args, '--', current.path], signal);
  return true;
}

async function deletePreparedRef(
  context: string[], commands: string[], verifyCheckout: () => Promise<void>, signal?: AbortSignal,
) {
  const child = spawn('git', ['--no-optional-locks', ...context, 'update-ref', '--stdin'], { signal });
  const stdout = createInterface({ input: child.stdout });
  const replies = stdout[Symbol.asyncIterator]();
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', data => { stderr = (stderr + data).slice(-8192); });
  child.stdin.on('error', () => { /* The exit status reports Git write failures. */ });
  const result = new Promise<string | null>(resolve => {
    child.once('error', error => resolve(error.message));
    child.once('close', code => resolve(code === 0 ? null : stderr.trim() || 'Не удалось завершить транзакцию Git.'));
  });

  try {
    child.stdin.write(['start', ...commands, 'prepare', ''].join('\n'));
    const started = await replies.next();
    const prepared = await replies.next();
    if (started.value !== 'start: ok' || prepared.value !== 'prepare: ok') {
      child.stdin.end();
      throw new Error(await result ?? 'Git не подготовил удаление ветки.');
    }
    await verifyCheckout();
    child.stdin.end('commit\n');
    const error = await result;
    if (error) throw new Error(error);
  } finally {
    if (!child.stdin.writableEnded) child.stdin.end('abort\n');
    stdout.close();
    await result;
  }
}

export async function removeLocalBranch(inspection: Inspection, force: boolean, signal?: AbortSignal) {
  const { gitDir, branch, baseRef, head } = inspection;
  if (branch === null) return true;
  const context = ['--git-dir', gitDir];
  const verifyBranchProtection = async () => {
    if (branch === 'main' || branch === await originDefaultBranch(context, signal)) {
      throw new Error(`Ветка ${branch} защищена.`);
    }
  };
  await verifyBranchProtection();
  const ref = `refs/heads/${branch}`;
  const actual = await git(context, ['for-each-ref', '--format=%(refname) %(objectname)', ref], signal);
  const tip = actual.split('\n').find(line => line.startsWith(`${ref} `))?.slice(ref.length + 1);
  if (!tip) return true;
  if (tip !== head) throw new Error('Ветка изменилась. Локальная ветка сохранена.');
  const base = (await git(context, ['rev-parse', '--verify', baseRef], signal)).trim();
  const unmerged = await git(context, ['rev-list', '--topo-order', `${base}..${head}`], signal);
  if (unmerged) {
    if (!force || inspection.unmergedCount === 0) throw new Error('Для удаления невлитых коммитов нужно подтверждение.');
    if (createHash('sha256').update(unmerged).digest('hex') !== inspection.unmergedFingerprint) {
      throw new Error('Набор невлитых коммитов изменился. Локальная ветка сохранена.');
    }
  }
  const mainHeadPath = join(gitDir, 'HEAD');
  const mainHead = await lstat(mainHeadPath, { bigint: true });
  const mainRef = await git(context, ['symbolic-ref', '--quiet', 'HEAD'], signal).catch(error => {
    if (!signal?.aborted && (error as { code?: unknown }).code === 1) return '';
    throw error;
  });
  const gitLocksMainHead = mainRef.trim() === baseRef;
  const verifyCheckout = async () => {
    const worktrees = await git(context, ['worktree', 'list', '--porcelain', '-z'], signal);
    if (worktrees.split('\0').includes(`branch ${ref}`)) {
      throw new Error('Ветка открыта в другом worktree. Локальная ветка сохранена.');
    }
  };
  const format = await git(context, ['config', '--local', '--get', 'extensions.refStorage'], signal).catch(error => {
    if (!signal?.aborted && (error as { code?: unknown }).code === 1) return 'files';
    throw error;
  });
  if (format.trim() !== 'files') throw new Error('Автоматическое удаление ветки требует файлового хранилища ссылок Git.');
  const adminRoot = join(gitDir, 'worktrees');
  const entries = await readdir(adminRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const locks: string[] = [];
  try {
    // Git uses these locks to serialize checkout in the main and linked worktrees.
    const adminDirectories = entries.filter(entry => entry.isDirectory()).map(entry => join(adminRoot, entry.name));
    if (!gitLocksMainHead) adminDirectories.unshift(gitDir);
    for (const directory of adminDirectories) {
      const lock = join(directory, 'HEAD.lock');
      const handle = await open(lock, 'wx');
      locks.push(lock);
      await handle.close();
    }
    await verifyCheckout();
    await deletePreparedRef(context, [
      `verify ${baseRef} ${base}`,
      'option no-deref',
      `delete ${ref} ${head}`,
    ], async () => {
      await verifyBranchProtection();
      // The files backend locks main HEAD itself when its referent is verified.
      if (gitLocksMainHead) {
        const current = await lstat(mainHeadPath, { bigint: true });
        if (current.ino !== mainHead.ino || current.mtimeNs !== mainHead.mtimeNs ||
            !await pathExists(mainHeadPath + '.lock')) {
          throw new Error('Основной checkout изменился. Локальная ветка сохранена.');
        }
      }
      await verifyCheckout();
    }, signal);
    try {
      await verifyCheckout();
    } catch (error) {
      // A worktree registered during commit may have an entirely new HEAD.
      await git(context, ['update-ref', '--no-deref', ref, head, '0'.repeat(head.length)], signal);
      throw error;
    }
  } finally {
    await Promise.all(locks.map(lock => unlink(lock)));
  }
  return true;
}
