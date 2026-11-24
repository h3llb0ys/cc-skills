import type { BbPluginApi } from '@get-bb/plugin-sdk';
import { createHash } from 'node:crypto';
import { worktreeHistoryTag, worktreeTag, type LinkedWorktree } from './cleanup/contract';

export type HistoryEntry = {
  key: string;
  path: string;
  hostId: string;
  branch: string | null;
  repository: string | null;
  sourceId: string;
  sourceTitle: string | null;
  binding: LinkedWorktree | null;
  removed: boolean;
};

type StoredEntry = Pick<HistoryEntry, 'path' | 'hostId' | 'branch' | 'repository' | 'sourceTitle' | 'binding'>;
type HistoryRow = { sourceId: string; key: string; data: string; removed: 0 | 1 };

export const worktreeKey = (worktree: Pick<LinkedWorktree, 'hostId' | 'gitDir' | 'worktreeId'>) => createHash('sha256').update(JSON.stringify([
  worktree.hostId, worktree.gitDir, worktree.worktreeId,
])).digest('hex');

function decode({ key, sourceId, data, removed }: HistoryRow): HistoryEntry {
  return { ...(JSON.parse(data) as StoredEntry), key, sourceId, removed: removed === 1 };
}

export function createWorktreeHistory(bb: BbPluginApi) {
  let initialized = false;
  function database() {
    const db = bb.storage.database();
    if (!initialized) {
      bb.storage.migrate(db, [`
        CREATE TABLE worktree_history (
          sequence INTEGER PRIMARY KEY,
          source_id TEXT NOT NULL,
          checkout_key TEXT NOT NULL,
          data TEXT NOT NULL,
          linked_at INTEGER NOT NULL,
          removed INTEGER NOT NULL DEFAULT 0,
          UNIQUE (source_id, checkout_key)
        );
      `, `
        CREATE TABLE worktree_history_scope (
          scope_id TEXT NOT NULL,
          source_id TEXT NOT NULL,
          checkout_key TEXT NOT NULL,
          PRIMARY KEY (scope_id, source_id, checkout_key)
        );
      `, 'CREATE INDEX worktree_history_checkout ON worktree_history (checkout_key)']);
      initialized = true;
    }
    return db;
  }

  function remember(sourceId: string, scopeIds: string[], key: string, entry: StoredEntry, linkedAt?: number) {
    const db = database();
    db.transaction(() => {
      const scope = db.prepare('INSERT OR IGNORE INTO worktree_history_scope VALUES (?, ?, ?)');
      for (const scopeId of [sourceId, ...scopeIds]) scope.run(scopeId, sourceId, key);
      db.prepare(`
        INSERT INTO worktree_history (source_id, checkout_key, data, linked_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (source_id, checkout_key) DO UPDATE SET
          data = excluded.data, linked_at = max(worktree_history.linked_at, excluded.linked_at)
        WHERE worktree_history.removed = 0 OR ?
      `).run(sourceId, key, JSON.stringify(entry), linkedAt ?? 0, entry.binding === null ? 1 : 0);
    })();
  }

  function linked(sourceId: string, sourceTitle: string | null, scopes: string[], binding: LinkedWorktree, linkedAt?: number) {
    // Git common directories use the host's path separators, which may differ from the server's.
    const gitPath = binding.gitDir.split(/[\\/]/).filter(Boolean);
    const repository = gitPath.at(-1) === '.git' ? gitPath.at(-2) ?? null : gitPath.at(-1) ?? null;
    remember(sourceId, scopes, worktreeKey(binding), {
      ...binding, repository, sourceTitle, binding,
    }, linkedAt);
  }

  function list(scopeId: string, descendantIds: string[] = []): HistoryEntry[] {
    const rows = database().prepare(`
      SELECT source_id AS sourceId, checkout_key AS key, data, removed
      FROM worktree_history AS history
      WHERE source_id IN (SELECT value FROM json_each(?))
        OR EXISTS (SELECT 1 FROM worktree_history_scope AS scope
          WHERE scope.scope_id = ? AND scope.source_id = history.source_id AND scope.checkout_key = history.checkout_key)
      ORDER BY linked_at DESC, sequence DESC
    `).all(JSON.stringify(descendantIds), scopeId) as HistoryRow[];
    return rows.map(decode);
  }

  function owners(key: string): string[] {
    return database().prepare('SELECT source_id FROM worktree_history WHERE checkout_key = ? AND removed = 0')
      .pluck().all(key) as string[];
  }

  function markRemoved(key: string) {
    const sourceIds = owners(key);
    database().prepare('UPDATE worktree_history SET removed = 1 WHERE checkout_key = ?').run(key);
    bb.rpc.experimental_invalidate([worktreeHistoryTag, ...sourceIds.map(worktreeTag)]);
  }

  function restoreNative(key: string) {
    database().prepare('UPDATE worktree_history SET removed = 0 WHERE checkout_key = ? AND removed = 1').run(key);
  }

  function isRemoved(binding: LinkedWorktree) {
    return Boolean(database().prepare('SELECT 1 FROM worktree_history WHERE checkout_key = ? AND removed = 1')
      .get(worktreeKey(binding)));
  }

  return { remember, linked, list, owners, markRemoved, restoreNative, isRemoved };
}
