// Shared markup contract between independently bundled sidebar plugins.
export type ThreadLinkKind = 'jira' | 'mr';

export const threadRowLinks = 'data-bb-thread-row-links';
export const threadRowColor = 'data-bb-thread-row-color';
export const threadRowWorkspace = 'data-bb-thread-row-workspace';
export const compactThreadRow = 'data-bb-compact-thread-row';

export function threadRowLinkGroup(kind: ThreadLinkKind) {
  return { [threadRowLinks]: kind };
}

export function stopThreadRowEvents(node: HTMLElement) {
  for (const type of ['click', 'dblclick', 'pointerdown', 'keydown']) {
    node.addEventListener(type, event => event.stopPropagation());
  }
}

export function createThreadRowLink(doc: Document, href: string, title: string, ariaLabel = title) {
  const link = doc.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = title;
  link.setAttribute('aria-label', ariaLabel);
  stopThreadRowEvents(link);
  return link;
}

export type WorkspaceRowDetail = {
  kind: 'worktree' | 'branch' | 'note';
  text: string;
  title?: string;
  color?: string | null;
};

export function workspaceRowDetails(details: WorkspaceRowDetail[]) {
  return { [threadRowWorkspace]: JSON.stringify(details) };
}

export function readWorkspaceRowDetails(content: Element): WorkspaceRowDetail[] {
  const data = content.querySelector(`[${threadRowWorkspace}]`)?.getAttribute(threadRowWorkspace);
  if (!data) return [];
  try {
    const details: unknown = JSON.parse(data);
    if (!Array.isArray(details)) return [];
    return details.filter((item): item is WorkspaceRowDetail =>
      item && ['worktree', 'branch', 'note'].includes(item.kind) && typeof item.text === 'string' &&
      (item.title === undefined || typeof item.title === 'string') &&
      (item.color == null || typeof item.color === 'string'));
  } catch {
    return [{ kind: 'note', text: data }];
  }
}

export type ThreadRowLink = { kind: ThreadLinkKind; anchor: HTMLAnchorElement; color: string };

export function readThreadRowLinks(content: Element): ThreadRowLink[] {
  const links: ThreadRowLink[] = [];
  for (const group of content.querySelectorAll(`[${threadRowLinks}]`)) {
    const kind = group.getAttribute(threadRowLinks);
    if (kind !== 'jira' && kind !== 'mr') continue;
    const color = group.getAttribute(threadRowColor) ?? '';
    for (const anchor of group.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      if (anchor.protocol === 'https:') links.push({ kind, anchor, color });
    }
  }
  return links;
}
