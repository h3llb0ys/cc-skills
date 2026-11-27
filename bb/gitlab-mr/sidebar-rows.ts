import { mrUrl, type Snapshot } from './contract';
import { orderedLinks, presentation } from './presentation';

export function decorateSidebar(doc: Document, onKeys: (keys: string[]) => void) {
  const view = doc.defaultView!;
  const owned = new Map<Element, { badges: HTMLElement; signature: string }>();
  let data: Record<string, Snapshot> = {};
  let previousKeys = '';
  let frame: number | undefined;

  function sync() {
    const keys = new Set<string>();
    const present = new Set<Element>();
    for (const anchor of doc.querySelectorAll<HTMLElement>('[data-sidebar-thread-id]')) {
      const threadId = anchor.dataset.sidebarThreadId;
      const content = anchor.parentElement;
      const title = content?.querySelector('.bb-thread-title')?.parentElement;
      if (!threadId || !content || !title || !anchor.closest('[data-sidebar-rename-row]')) continue;
      keys.add(threadId);
      const snapshot = data[threadId];
      if (!snapshot?.links.length) continue;
      present.add(anchor);

      const inline = snapshot.links.length === 1;
      const parent = inline ? title : content;
      const links = orderedLinks(snapshot);
      const signature = JSON.stringify(links);
      let entry = owned.get(anchor);
      if (!entry || entry.signature !== signature) {
        entry?.badges.remove();
        const badges = doc.createElement('span');
        badges.dataset.gitlabMrBadges = inline ? 'inline' : 'stacked';
        badges.setAttribute('aria-label', 'Merge requests');
        for (const link of links) {
          const status = presentation(link);
          const badge = doc.createElement('a');
          badge.className = `gitlab-mr-sidebar-badge gitlab-mr-${status.color}`;
          badge.href = mrUrl(link);
          badge.target = '_blank';
          badge.rel = 'noopener noreferrer';
          badge.title = `!${link.iid} · ${link.title} · ${status.detail}`;
          badge.setAttribute('aria-label', badge.title);
          const icon = doc.createElement('span');
          icon.className = 'gitlab-mr-sidebar-icon';
          icon.setAttribute('aria-hidden', 'true');
          badge.append(icon, `!${link.iid}`);
          for (const event of ['click', 'dblclick', 'pointerdown', 'keydown']) {
            badge.addEventListener(event, event => event.stopPropagation());
          }
          badges.append(badge);
        }
        entry = { badges, signature };
        owned.set(anchor, entry);
      }

      const { badges } = entry;
      const jira = parent.querySelector(':scope > [data-jira-task-links]');
      if (badges.parentElement !== parent) {
        if (jira) jira.after(badges);
        else parent.append(badges);
      } else if (jira && (badges.compareDocumentPosition(jira) & view.Node.DOCUMENT_POSITION_FOLLOWING)) {
        // Jira may resolve its own data after the MR badges have rendered.
        jira.after(badges);
      }
    }

    for (const [anchor, { badges }] of owned) {
      if (present.has(anchor)) continue;
      badges.remove();
      owned.delete(anchor);
    }
    const ids = [...keys].sort();
    const signature = JSON.stringify(ids);
    if (signature !== previousKeys) {
      previousKeys = signature;
      onKeys(ids);
    }
  }

  const observer = new view.MutationObserver(() => {
    frame ??= view.requestAnimationFrame(() => {
      frame = undefined;
      sync();
    });
  });
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-sidebar-thread-id'] });
  sync();

  return {
    update(next: Record<string, Snapshot>) {
      data = next;
      sync();
    },
    dispose() {
      observer.disconnect();
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      for (const { badges } of owned.values()) badges.remove();
      owned.clear();
    },
  };
}
