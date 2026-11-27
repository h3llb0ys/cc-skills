const sidebarSelector = '[data-testid="app-sidebar-body"]';
const headerSelector = '[data-testid="app-sidebar-top-reserve-row"] [data-testid="sidebar-header-slot"]';
const threadListSelector = '[data-sidebar-visibility-group], [data-sidebar-sticky-group]';
const rowSelector = '[data-sidebar-rename-row]';
const threadLinkSelector = 'a[data-sidebar-thread-id]';
const openToggleSelector = 'button[data-sidebar-rename-anchor][aria-expanded="true"][aria-label^="Collapse "]:enabled';
const overflowSelector = '[data-sidebar-overflow]';

const lucideLicense = `Lucide list-chevrons-down-up and chevrons-down-up
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

const controls = [
 { label: 'Свернуть только треды', includeSections: false, icon: 'M3 5h8M3 12h8M3 19h8m4-14 3 3 3-3m-6 14 3-3 3 3' },
 { label: 'Свернуть секции и треды', includeSections: true, icon: 'm7 20 5-5 5 5M7 4l5 5 5-5' },
];

function collapseRows(sidebar: HTMLElement, includeSections: boolean) {
 const threads: HTMLButtonElement[] = [];
 const sections: HTMLButtonElement[] = [];
 for (const button of sidebar.querySelectorAll<HTMLButtonElement>(openToggleSelector)) {
  if (button.closest(overflowSelector)) continue;
  const label = button.getAttribute('aria-label')!;
  if (label.endsWith(' section')) {
   if (includeSections) sections.push(button);
  } else if (label.endsWith(' threads')) {
   const row = button.closest(rowSelector);
   const threadLink = row?.querySelector(threadLinkSelector);
   if (threadLink && threadLink.closest(rowSelector) === row) threads.push(button);
  }
 }

 // An outer toggle can unmount the descendants, so invoke the inner toggles first.
 for (const button of [...threads.reverse(), ...sections.reverse()]) {
  if (sidebar.contains(button) && button.matches(openToggleSelector)) button.click();
 }
}

export function mountSidebarCollapse(doc: Document) {
 const group = doc.createElement('div');
 group.dataset.sectionStyleCollapse = '';
 group.setAttribute('role', 'group');
 group.setAttribute('aria-label', 'Сворачивание списка тредов');
 // BB strips source comments from the frontend bundle.
 group.append(doc.createComment(lucideLicense));

 let sidebar: HTMLElement | null = null;
 for (const { label, includeSections, icon } of controls) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icon}"></path></svg>`;
  button.addEventListener('click', () => {
   if (sidebar?.contains(group)) collapseRows(sidebar, includeSections);
  });
  group.append(button);
 }

 function refresh() {
  sidebar = doc.querySelector<HTMLElement>(sidebarSelector);
  const header = sidebar?.querySelector(headerSelector);
  if (!header || !sidebar?.querySelector(threadListSelector)) {
   group.remove();
  } else if (group.parentElement !== header) {
   header.append(group);
  }
 }

 const observer = new doc.defaultView!.MutationObserver(records => {
  const current = sidebar;
  if (!current?.isConnected || records.some(record => current.contains(record.target))) refresh();
 });
 observer.observe(doc.body, { childList: true, subtree: true });
 refresh();
 return () => {
  observer.disconnect();
  sidebar = null;
  group.remove();
 };
}
