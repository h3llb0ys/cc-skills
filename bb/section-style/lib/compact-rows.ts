import { compactThreadRow, readThreadRowLinks, readWorkspaceRowDetails, stopThreadRowEvents, threadRowLinks, threadRowColor, threadRowWorkspace, type ThreadRowLink, type WorkspaceRowDetail } from '../../shared-ui/thread-row';

const sidebarSelector = '[data-testid="app-sidebar-body"]';
const rowSelector = '[data-sidebar-rename-row]';
const titleSelector = '.bb-thread-title';
const contentAttr = 'data-section-style-compact-content';
const titleAttr = 'data-section-style-compact-title';
const actionOffset = '--section-style-compact-action-offset';
const actionWidth = '--section-style-compact-action-width';

type Menu = { button: HTMLButtonElement; popup: HTMLElement };
type Entry = {
 popupId: string; menu?: Menu;
 content: HTMLElement; title: HTMLElement; cluster: HTMLElement; signature: string;
 anchor: HTMLElement; originalTitle: string | null; hoverTitle: string | null;
};

function badge({ anchor, kind, color }: ThreadRowLink) {
 const link = anchor.cloneNode(true) as HTMLAnchorElement;
 link.removeAttribute('id');
 link.classList.add('section-style-compact-badge');
 link.dataset.kind = kind;
 if (color) link.style.setProperty('--jira-task-color', color);
 return link;
}

function createMenu(cluster: HTMLElement, popupId: string): Menu {
 const doc = cluster.ownerDocument;
 const button = doc.createElement('button');
 button.type = 'button';
 button.className = 'section-style-compact-more';
 button.title = 'Метаданные треда';
 button.setAttribute('aria-label', button.title);
 button.setAttribute('popovertarget', popupId);

 const popup = doc.createElement('div');
 popup.id = popupId;
 popup.className = 'section-style-compact-popup';
 popup.setAttribute('popover', 'auto');
 popup.setAttribute('role', 'group');
 button.addEventListener('click', () => {
  const rect = button.getBoundingClientRect();
  const win = doc.defaultView!;
  const right = Math.max(8, win.innerWidth - rect.right);
  const spaceAbove = rect.top - 12;
  const spaceBelow = win.innerHeight - rect.bottom - 12;
  const opensAbove = spaceBelow < 240 && spaceAbove > spaceBelow;
  popup.style.right = `${right}px`;
  popup.style.maxWidth = `${Math.max(0, Math.min(320, win.innerWidth - right - 8))}px`;
  popup.style.maxHeight = `${Math.max(0, Math.min(240, opensAbove ? spaceAbove : spaceBelow))}px`;
  popup.style.top = opensAbove ? '' : `${rect.bottom + 4}px`;
  popup.style.bottom = opensAbove ? `${win.innerHeight - rect.top + 4}px` : '';
 });
 cluster.append(button, popup);
 return { button, popup };
}

function fill(entry: Entry, links: ThreadRowLink[], workspace: WorkspaceRowDetail[], narrow: boolean, fullTitle: string) {
 const { cluster, popupId } = entry;
 const doc = cluster.ownerDocument;
 const focused = cluster.contains(doc.activeElement) ? doc.activeElement : null;
 const focusedUrl = focused?.closest<HTMLAnchorElement>('a')?.href;
 const first = narrow ? [] : (['jira', 'mr'] as const).flatMap(kind => {
  const link = links.find(item => item.kind === kind);
  return link ? [link] : [];
 });
 const rest = links.filter(link => !first.includes(link));
 for (const anchor of cluster.querySelectorAll(':scope > a')) anchor.remove();
 cluster.prepend(...first.map(badge));
 if (!rest.length && !workspace.length) {
  entry.menu?.button.remove();
  entry.menu?.popup.remove();
  entry.menu = undefined;
 } else {
  const { button, popup } = entry.menu ??= createMenu(cluster, popupId);
  button.textContent = rest.length ? `+${rest.length}` : '···';
  popup.replaceChildren();
  popup.removeAttribute(fullTitle ? 'aria-label' : 'aria-labelledby');
  renderMenu(popup, popupId, fullTitle, button.title, rest, workspace);
 }

 if (focused && !cluster.contains(focused)) {
  const sameLink = [...cluster.querySelectorAll<HTMLAnchorElement>('a')].find(anchor => anchor.href === focusedUrl);
  (sameLink ?? entry.menu?.button ?? entry.anchor).focus({ preventScroll: true });
 }
}

function renderMenu(popup: HTMLElement, popupId: string, fullTitle: string, fallbackLabel: string,
 links: ThreadRowLink[], workspace: WorkspaceRowDetail[]) {
 const doc = popup.ownerDocument;

 if (fullTitle) {
  const heading = doc.createElement('strong');
  heading.id = `${popupId}-title`;
  heading.className = 'section-style-compact-popup-title';
  heading.textContent = fullTitle;
  popup.setAttribute('aria-labelledby', heading.id);
  popup.append(heading);
 } else {
  popup.setAttribute('aria-label', fallbackLabel);
 }
 popup.append(...links.map(badge));
 if (workspace.length) {
  const details = doc.createElement('div');
  details.className = 'section-style-compact-workspace';
  for (const { kind, text, title, color } of workspace) {
   const line = doc.createElement('div');
   line.dataset.kind = kind;
   if (kind === 'note') {
    line.textContent = text;
   } else {
    const value = doc.createElement('span');
    value.textContent = text;
    if (title) value.title = title;
    if (color) value.style.color = color;
    line.append(kind === 'worktree' ? 'Worktree: ' : 'Ветка: ', value);
   }
   details.append(line);
  }
  popup.append(details);
 }
}

let nextPopupId = 0;

export function mountCompactRows(doc: Document, preview?: HTMLElement) {
 const win = doc.defaultView!;
 const rows = new Map<HTMLElement, Entry>();
 let sidebar: HTMLElement | null = null;
 let frame = 0;
 const resize = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(schedule) : undefined;

 function remove(row: HTMLElement, entry: Entry) {
  resize?.unobserve(entry.content);
  resize?.unobserve(entry.cluster);
  row.style.removeProperty(actionOffset);
  row.style.removeProperty(actionWidth);
  row.removeAttribute(compactThreadRow);
  entry.content.removeAttribute(contentAttr);
  entry.title.removeAttribute(titleAttr);
  entry.cluster.remove();
  if (entry.hoverTitle !== null && entry.anchor.title === entry.hoverTitle) {
   if (entry.originalTitle === null) entry.anchor.removeAttribute('title');
   else entry.anchor.title = entry.originalTitle;
  }
  rows.delete(row);
 }

 function refresh() {
  frame = 0;
  const current = preview ?? doc.querySelector<HTMLElement>(sidebarSelector);
  if (sidebar !== current) sidebar?.removeAttribute('data-section-style-compact');
  sidebar = current;
  sidebar?.setAttribute('data-section-style-compact', '');
  const visited = new Set<HTMLElement>();
  const anchorSelector = preview ? '[data-compact-preview-anchor]' : 'a[data-sidebar-thread-id]';
  for (const anchor of sidebar?.querySelectorAll<HTMLElement>(anchorSelector) ?? []) {
   const row = anchor.closest<HTMLElement>(preview ? '[data-compact-preview-row]' : rowSelector);
   const content = anchor.parentElement;
   const heading = content?.querySelector<HTMLElement>(titleSelector);
   const title = heading?.parentElement;
   if (!row || !content || !heading || !title || !title.parentElement) continue;

   let entry = rows.get(row);
   if (entry && (entry.content !== content || entry.title !== title || entry.anchor !== anchor)) {
    remove(row, entry);
    entry = undefined;
   }
   if (!entry) {
    const cluster = doc.createElement('span');
    cluster.className = 'section-style-compact-links';
    if (preview) cluster.addEventListener('click', event => {
     if ((event.target as Element).closest('a')) event.preventDefault();
    });
    stopThreadRowEvents(cluster);
    rows.set(row, entry = {
     content, title, cluster, signature: '', popupId: `section-style-metadata-${++nextPopupId}`, anchor, originalTitle: anchor.getAttribute('title'), hoverTitle: null,
    });
    resize?.observe(content);
    resize?.observe(cluster);
   }
   visited.add(row);
   if (!row.hasAttribute(compactThreadRow)) row.setAttribute(compactThreadRow, '');
   if (!content.hasAttribute(contentAttr)) content.setAttribute(contentAttr, '');
   if (!title.hasAttribute(titleAttr)) title.setAttribute(titleAttr, '');
   if (entry.cluster.parentElement !== title.parentElement) title.after(entry.cluster);

   const fullTitle = heading.title || heading.textContent?.trim() || '';
   // BB's clickable overlay receives pointer events over the title text.
   if (anchor.title !== fullTitle) {
    if (anchor.title !== entry.hoverTitle) entry.originalTitle = anchor.getAttribute('title');
    anchor.title = fullTitle;
    entry.hoverTitle = fullTitle;
   }

   const links = readThreadRowLinks(content);
   const workspace = readWorkspaceRowDetails(content);
   const narrow = content.clientWidth > 0 && content.clientWidth < 230;
   const signature = JSON.stringify([links.map(link => [link.kind, link.color, link.anchor.outerHTML]), workspace, narrow, fullTitle]);
   if (signature !== entry.signature) {
    entry.signature = signature;
    fill(entry, links, workspace, narrow, fullTitle);
   }
   const trailing = row.querySelector<HTMLElement>(':scope > [data-sidebar-thread-trailing]');
   const actions = trailing?.querySelector<HTMLElement>('.bb-sidebar-hover-actions');
   const offset = entry.cluster.offsetWidth + (trailing?.offsetWidth ?? 0) + 8;
   for (const [property, pixels] of [[actionOffset, offset], [actionWidth, actions?.offsetWidth ?? 0]] as const) {
    const value = `${pixels}px`;
    if (row.style.getPropertyValue(property) !== value) row.style.setProperty(property, value);
   }
  }
  for (const [row, entry] of rows) if (!visited.has(row)) remove(row, entry);
 }

 function schedule() {
  if (!frame) frame = win.requestAnimationFrame(refresh);
 }

 const observer = new win.MutationObserver(records => {
  if (!sidebar?.isConnected || records.some(record => sidebar?.contains(record.target))) schedule();
 });
 observer.observe(preview ?? doc.body, { subtree: true, childList: true, characterData: true, attributes: true,
  attributeFilter: ['href', 'title', threadRowLinks, threadRowColor, threadRowWorkspace] });
 refresh();

 return () => {
  observer.disconnect();
  resize?.disconnect();
  win.cancelAnimationFrame(frame);
  sidebar?.removeAttribute('data-section-style-compact');
  for (const [row, entry] of rows) remove(row, entry);
 };
}
