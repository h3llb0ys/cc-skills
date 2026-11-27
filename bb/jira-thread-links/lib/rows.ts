import { createThreadRowLink, threadRowColor, threadRowLinks } from '../../shared-ui/thread-row';

export type TaskLink = { key: string; summary: string; url: string };
export function decorateRows(doc: Document) {
 let data: Record<string, TaskLink[]> = {};
 const owned = new Map<Element, { signature: string; links: HTMLElement; title: Element; row: Element; content: Element }>();
 let disposed = false;
 let color: string | null = null;
 const style = doc.createElement('style');
 style.textContent = `
 .jira-task-title-single { display:flex!important; flex:1!important; min-width:0; gap:6px; }
 .jira-task-title-single > .bb-thread-title { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; }
 [data-jira-task-links] { position:relative; z-index:32; pointer-events:auto; display:inline-flex; gap:6px; flex-shrink:0; align-items:center; font-size:11px; line-height:18px; }
 [data-jira-task-link] { color:var(--jira-task-color,var(--muted-foreground)); text-decoration:none; border-radius:4px; padding:0 3px; background:color-mix(in srgb, currentColor 7%, transparent); }
 [data-jira-task-link]:hover { color:var(--jira-task-color,var(--foreground)); text-decoration:underline; }
 [data-jira-task-link]:focus-visible { outline:2px solid currentColor; outline-offset:2px; }
 .jira-task-row-multiple { height:auto!important; min-height:var(--bb-sidebar-row-height, 28px)!important; }
 .jira-task-content-multiple { flex-wrap:wrap!important; padding-top:4px; padding-bottom:4px; }
 .jira-task-content-multiple > [data-jira-task-links] { flex-basis:100%; flex-wrap:wrap; padding-left:22px; }
 `;
 doc.head.append(style);
 function applyColor(links: HTMLElement) {
   if (color) {
     links.style.setProperty('--jira-task-color', color);
     links.setAttribute(threadRowColor, color);
   } else {
     links.style.removeProperty('--jira-task-color');
     links.removeAttribute(threadRowColor);
   }
 }
 function remove(anchor: Element) {
   const old = owned.get(anchor); if (!old) return;
   old.links.remove(); old.title.classList.remove('jira-task-title-single');
   old.row.classList.remove('jira-task-row-multiple'); old.content.classList.remove('jira-task-content-multiple'); owned.delete(anchor);
 }
 function refresh() {
   if (disposed) return;
   for (const anchor of owned.keys()) if (!anchor.isConnected) remove(anchor);
   for (const anchor of doc.querySelectorAll<HTMLElement>('[data-sidebar-thread-id]')) {
     const content = anchor.parentElement;
     const title = content?.querySelector('.bb-thread-title')?.parentElement;
     const row = anchor.closest('[data-sidebar-rename-row]');
     const tasks = (data[anchor.dataset.sidebarThreadId ?? ''] ?? []).filter(task => { try { return new URL(task.url).protocol === 'https:'; } catch { return false; } });
     const signature = JSON.stringify(tasks);
     const old = owned.get(anchor);
     if (old?.signature === signature && old.title === title && old.row === row && old.content === content &&
         old.links.parentElement === (tasks.length === 1 ? title : content)) {
       // React can rewrite the host's className when selection/status changes.
       // Add only missing classes so our MutationObserver does not loop.
       if (tasks.length === 1 && !old.title.classList.contains('jira-task-title-single')) old.title.classList.add('jira-task-title-single');
       if (tasks.length > 1) {
         if (!old.row.classList.contains('jira-task-row-multiple')) old.row.classList.add('jira-task-row-multiple');
         if (!old.content.classList.contains('jira-task-content-multiple')) old.content.classList.add('jira-task-content-multiple');
       }
       continue;
     }
     remove(anchor);
     if (!tasks.length || !content || !title || !row) continue;
     const links = doc.createElement('span'); links.dataset.jiraTaskLinks = ''; links.setAttribute(threadRowLinks, 'jira');
     applyColor(links);
     links.setAttribute('aria-label', 'Актуальные задачи Jira');
     for (const task of tasks) {
       const title = `${task.key} · ${task.summary}`;
       const link = createThreadRowLink(doc, task.url, title, `${title} — открыть Jira`);
       link.dataset.jiraTaskLink = task.key;
       link.textContent = task.key;
       links.append(link);
     }
     if (tasks.length === 1) { title.classList.add('jira-task-title-single'); title.append(links); }
     else { row.classList.add('jira-task-row-multiple'); content.classList.add('jira-task-content-multiple'); content.append(links); }
     owned.set(anchor, { signature, links, title, row, content });
   }
 }
 const observer = new doc.defaultView!.MutationObserver(refresh);
 observer.observe(doc.body, { childList:true, subtree:true, attributes:true, attributeFilter:['data-sidebar-thread-id','class'] });
 return {
   setColor(next: string | null) {
     color = next && /^#[0-9a-fA-F]{6}$/.test(next) ? next : null;
     for (const {links} of owned.values()) applyColor(links);
   },
   update(next: Record<string, TaskLink[]>) { data = next; refresh(); },
   dispose() { disposed=true; observer.disconnect(); for (const anchor of owned.keys()) remove(anchor); style.remove(); },
 };
}
