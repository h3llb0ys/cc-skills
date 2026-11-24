import { inlineStyle } from './inline-style';

type Row = { content: HTMLElement; title: HTMLElement; line: HTMLElement };
const classes = { content: 'workspace-labels-inline-content', title: 'workspace-labels-inline-title', line: 'workspace-labels-inline-line' };

// Keep a small margin for fractional pixels / font rasterization. An inline
// layout must fit in full, rather than truncating the title to make it fit.
export function fitsInline(available: number, required: number) {
  return available > 0 && required > 0 && required + 2 <= available;
}

export function adaptiveRows(doc: Document) {
  const win = doc.defaultView!;
  const owned = new Map<HTMLElement, Row>();
  const observed = new Set<Element>();
  let frame = 0;
  let disposed = false;
  const style = doc.createElement('style');
  style.dataset.workspaceLabelsInlineStyle = '';
  style.textContent = inlineStyle;
  doc.head.append(style);
  const measure = doc.createElement('div');
  measure.dataset.workspaceLabelsMeasure = '';
  measure.setAttribute('aria-hidden', 'true');
  measure.inert = true;
  measure.style.cssText = 'position:fixed;left:-100000px;top:0;width:max-content;max-width:none;visibility:hidden;pointer-events:none;contain:layout style;';
  doc.body.append(measure);

  function set(row: Row, inline: boolean) {
    row.content.classList.toggle(classes.content, inline);
    row.title.classList.toggle(classes.title, inline);
    row.line.classList.toggle(classes.line, inline);
  }
  function naturalWidth(row: Row) {
    const clone = row.content.cloneNode(true) as HTMLElement;
    for (const element of clone.querySelectorAll('[data-sidebar-thread-id], [id]')) {
      element.removeAttribute('data-sidebar-thread-id');
      element.removeAttribute('id');
    }
    const title = clone.children[Array.from(row.content.children).indexOf(row.title)] as HTMLElement;
    const line = clone.children[Array.from(row.content.children).indexOf(row.line)] as HTMLElement;
    set({ content: clone, title, line }, true);
    const computed = win.getComputedStyle(row.content);
    measure.style.font = computed.font;
    measure.style.letterSpacing = computed.letterSpacing;
    clone.style.setProperty('width', 'max-content', 'important');
    clone.style.setProperty('max-width', 'none', 'important');
    clone.style.setProperty('flex', 'none', 'important');
    // Match the live row's hover-action reservation even though the measuring
    // copy is not inside the same hover/selection ancestors.
    clone.style.setProperty('padding-right', computed.paddingRight, 'important');
    clone.style.setProperty('padding-left', computed.paddingLeft, 'important');
    measure.append(clone);
    const width = clone.getBoundingClientRect().width;
    clone.remove();
    return width;
  }
  function refresh() {
    frame = 0;
    if (disposed) return;
    const next = new Set<HTMLElement>();
    const watch = new Set<Element>();
    for (const label of doc.querySelectorAll<HTMLElement>('.workspace-labels[data-workspace-auto-inline="true"]')) {
      if (measure.contains(label)) continue;
      const native = label.closest<HTMLElement>('[data-sidebar-rename-row]');
      const anchor = native?.querySelector<HTMLElement>('[data-sidebar-thread-id]');
      const content = anchor?.parentElement;
      const heading = content?.querySelector<HTMLElement>('.bb-thread-title');
      const metadata = label.closest<HTMLElement>('[data-thread-row-metadata]');
      const line = metadata?.parentElement;
      let title = heading;
      while (title?.parentElement && title.parentElement !== content) title = title.parentElement;
      if (!native || !content || !title || !line || line.parentElement !== content || !line.contains(label)) continue;
      const row: Row = { content, title, line };
      const previous = owned.get(content);
      if (previous && (previous.title !== title || previous.line !== line)) set(previous, false);
      owned.set(content, row);
      next.add(content);
      watch.add(content);
      watch.add(label);
      // Preserve an explicitly chosen two-line details view. Other metadata
      // contributions keep their own space and behavior on the native line.
      const otherMetadata = Array.from(metadata!.children).some(child => !child.contains(label) &&
        (child.textContent?.trim() || child.childElementCount > 0));
      const allowed = label.querySelectorAll('[data-workspace-kind]').length === 1 && !otherMetadata;
      const available = content.getBoundingClientRect().width;
      set(row, allowed && fitsInline(available, naturalWidth(row)));
    }
    for (const [content, row] of owned) {
      if (!next.has(content)) { set(row, false); owned.delete(content); }
    }
    for (const element of observed) if (!watch.has(element)) { resize?.unobserve(element); observed.delete(element); }
    for (const element of watch) if (!observed.has(element)) { resize?.observe(element); observed.add(element); }
  }
  function schedule() {
    if (!frame && !disposed) frame = win.requestAnimationFrame(refresh);
  }
  const resize = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(schedule) : null;
  const mutations = new win.MutationObserver(records => {
    if (records.some(record => {
      const target = record.target instanceof win.Element ? record.target : record.target.parentElement;
      if (!target || measure.contains(target)) return false;
      return target === doc.documentElement || target === doc.body || !!target.closest('[data-sidebar-rename-row]') ||
        [...record.addedNodes, ...record.removedNodes].some(node => node instanceof win.Element &&
          !measure.contains(node) && (node.matches('.workspace-labels') || node.querySelector('.workspace-labels')));
    })) schedule();
  });
  mutations.observe(doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'style', 'data-workspace-auto-inline', 'data-sidebar-thread-id'] });
  win.addEventListener('resize', schedule);
  doc.fonts?.addEventListener('loadingdone', schedule);
  void doc.fonts?.ready.then(schedule);
  schedule();
  return () => {
    disposed = true;
    win.cancelAnimationFrame(frame);
    mutations.disconnect();
    resize?.disconnect();
    win.removeEventListener('resize', schedule);
    doc.fonts?.removeEventListener('loadingdone', schedule);
    for (const row of owned.values()) set(row, false);
    owned.clear();
    observed.clear();
    measure.remove();
    style.remove();
  };
}
