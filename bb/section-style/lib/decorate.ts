import { iconData, type Appearance, type Target } from './appearance';

export const editEvent = 'section-style:edit';
const roots = '[data-sidebar-section-id], [data-sidebar-project-id]';
function heading(root: HTMLElement): {title:HTMLElement; target:Target} | null {
 const section = root.dataset.sidebarSectionId;
 const project = root.dataset.sidebarProjectId;
 const title = [...root.querySelectorAll<HTMLElement>('span.truncate')].find(node => {
  if (!node.parentElement?.classList.contains('text-left')) return false;
  return node.closest(roots) === root;
 });
 const id = section ?? project;
 if (!id || !title || root.querySelector('[data-sidebar-rename-editor]')?.contains(title)) return null;
 return {title, target:{key:`${section !== undefined?'section':'project'}:${id}`, name:title.textContent?.trim() ?? ''}};
}
export function getHeadingDefaultFontSize(doc: Document, key: string): number | undefined {
 for (const root of doc.querySelectorAll<HTMLElement>(roots)) {
  const found=heading(root);
  if(found?.target.key!==key || !found.title.parentElement)continue;
  // The native heading size is inherited from its label container.
  const size=Number.parseFloat(doc.defaultView!.getComputedStyle(found.title.parentElement).fontSize);
  if(Number.isFinite(size)&&size>0)return size;
 }
 return undefined;
}
export function decorateHeaders(doc: Document) {
 let data: Record<string, Appearance> = {};
 let disposed = false;
 let queued = false;
 let active: {target:Target; trigger:HTMLElement} | null = null;
 const decorated = new Set<HTMLElement>();
 const menuItems = new Set<HTMLElement>();
 const style = doc.createElement('style');
 style.dataset.sectionStyle = '';
 style.textContent = `
 .bb-heading-appearance { color:var(--heading-appearance-color)!important; }
 .bb-heading-appearance-font { font-size:var(--heading-appearance-font-size)!important; }
 .bb-heading-appearance-icon { position:relative; padding-inline-start:20px; }
 .bb-heading-appearance-icon::before { content:var(--heading-appearance-emoji, ''); position:absolute; inset-inline-start:0; top:50%; transform:translateY(-50%); width:14px; height:14px; line-height:14px; font-size:14px; text-align:center; pointer-events:none; }
 .bb-heading-appearance-symbol::before { background:currentColor; mask:var(--heading-appearance-symbol) center/contain no-repeat; }
 [data-section-style-menu] { width:100%; text-align:start; cursor:pointer; }
 [data-section-style-menu]:hover, [data-section-style-menu]:focus-visible { background:var(--accent); color:var(--accent-foreground); outline:none; }
 `;
 doc.head.append(style);
 function clear(title: HTMLElement) {
  title.classList.remove('bb-heading-appearance','bb-heading-appearance-icon','bb-heading-appearance-symbol','bb-heading-appearance-font');
  for (const key of ['color','emoji','symbol','font-size']) title.style.removeProperty(`--heading-appearance-${key}`);
  decorated.delete(title);
 }
 function paint(title: HTMLElement, value?: Appearance) {
  if (!value || (!value.color && !value.icon && !value.emoji && value.fontSize==null)) { if (decorated.has(title)) clear(title); return; }
  decorated.add(title);
  const toggle = (name:string, on:boolean) => { if (title.classList.contains(name) !== on) title.classList.toggle(name,on); };
  const property = (key:string, value:string) => { if (title.style.getPropertyValue(key) !== value) title.style.setProperty(key,value); };
  toggle('bb-heading-appearance',true);
  toggle('bb-heading-appearance-font',value.fontSize!=null);
  if(value.fontSize!=null) property('--heading-appearance-font-size',`${value.fontSize}px`);
  else if(title.style.getPropertyValue('--heading-appearance-font-size')) title.style.removeProperty('--heading-appearance-font-size');
  toggle('bb-heading-appearance-icon',!!(value.icon || value.emoji));
  toggle('bb-heading-appearance-symbol',!!value.icon);
  property('--heading-appearance-color', value.color ?? 'inherit');
  property('--heading-appearance-symbol', value.icon ? iconData(value.icon) : 'none');
  property('--heading-appearance-emoji', JSON.stringify(value.emoji ?? ''));
 }
 function refresh() {
  queued = false;
  if (disposed) return;
  const live = new Set<HTMLElement>();
  for (const root of doc.querySelectorAll<HTMLElement>(roots)) {
   const found = heading(root); if (!found) continue;
   live.add(found.title); paint(found.title, data[found.target.key]);
  }
  for (const title of decorated) if (!live.has(title)) clear(title);
  for (const item of menuItems) if (!item.isConnected) menuItems.delete(item);
  if (!active || !active.trigger.isConnected) return;
  const menuId = active.trigger.getAttribute('aria-controls');
  const menu = menuId ? doc.getElementById(menuId) : null;
  if (!menu || menu.getAttribute('role') !== 'menu' || menu.dataset.state !== 'open') return;
  if (menu.querySelector('[data-section-style-menu]')) return;
  const item = doc.createElement('button');
  item.type='button'; item.role='menuitem'; item.tabIndex=0; item.dataset.sectionStyleMenu='';
  const sample = menu.querySelector<HTMLElement>('[role="menuitem"]');
  item.className = sample?.className ?? '';
  item.textContent='Оформление…';
  const target = {...active.target};
  item.addEventListener('click', event => {
   event.preventDefault(); event.stopPropagation();
   menu.dispatchEvent(new doc.defaultView!.KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));
   doc.defaultView!.requestAnimationFrame(() => { if (!disposed) doc.defaultView!.dispatchEvent(new doc.defaultView!.CustomEvent(editEvent,{detail:target})); });
  });
  menu.prepend(item); menuItems.add(item);
 }
 function schedule() { if (!queued && !disposed) { queued=true; doc.defaultView!.queueMicrotask(refresh); } }
 function track(event: Event) {
  const node = event.target;
  if (!(node instanceof doc.defaultView!.Element)) return;
  if (node.closest('[role="menu"]')) return;
  active=null;
  const root = node.closest<HTMLElement>(roots);
  if (!root || node.closest('[data-sidebar-thread-id]')) return;
  const found=heading(root);
  if (!found) return;
  const row = found.title.closest('[data-sidebar-rename-row]');
  if (!row?.contains(node)) return;
  // In a top-level section the container includes its threads; require the header itself.
  if (node !== row && node.closest('[data-sidebar-rename-row]') !== row) return;
  const trigger = node.closest<HTMLElement>('button[aria-haspopup="menu"]');
  if (trigger) active={target:found.target,trigger};
 }
 function keyboard(event: KeyboardEvent) {
  const menu = (event.target as Element | null)?.closest?.('[role="menu"]');
  const own = menu?.querySelector<HTMLElement>('[data-section-style-menu]');
  if (!menu || !own) {
   if (['Enter',' ','ArrowDown','ArrowUp'].includes(event.key)) track(event);
   return;
  }
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(item => item.closest('[role="menu"]') === menu && item.getAttribute('aria-disabled') !== 'true');
  const index = items.indexOf(doc.activeElement as HTMLElement);
  let focus: HTMLElement | undefined;
  if (event.key === 'End') focus = items.at(-1);
  if (event.key === 'Home') focus = items[0];
  if (event.key === 'ArrowDown') focus = items[(index + 1) % items.length];
  if (event.key === 'ArrowUp') focus = items[(index - 1 + items.length) % items.length];
  if (event.target === own && (event.key === 'Enter' || event.key === ' ')) {
   event.preventDefault(); event.stopImmediatePropagation(); own.click(); return;
  }
  if (focus) { event.preventDefault(); event.stopImmediatePropagation(); focus.focus(); }
 }
 doc.addEventListener('keydown',keyboard,true);
 doc.addEventListener('pointerdown',track,true);
 doc.addEventListener('click',track,true);
 doc.addEventListener('contextmenu',track,true);
 const observer = new doc.defaultView!.MutationObserver(records => {
  const menuId=active?.trigger.getAttribute('aria-controls');
  const menu=menuId?doc.getElementById(menuId):null;
  const relevant=records.some(record=>{
   if(record.attributeName==='data-sidebar-section-id'||record.attributeName==='data-sidebar-project-id')return true;
   const target=record.target instanceof doc.defaultView!.Element ? record.target : record.target.parentElement;
   if(target?.closest(roots) || (menu&&target&&menu.contains(target)))return true;
   return [...record.addedNodes,...record.removedNodes].some(node=>{
    if(!(node instanceof doc.defaultView!.Element))return false;
    return node.matches(roots)||!!node.querySelector(roots)||(menu!==null&&node.contains(menu))
     || (node.matches('[role="menu"]')&&!!node.querySelector('[data-section-style-menu]'));
   });
  });
  if(relevant)schedule();
 });
 observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','aria-controls','data-sidebar-section-id','data-sidebar-project-id','data-state']});
 refresh();
 return {
  update(next:Record<string,Appearance>) { data=next; refresh(); },
  dispose() {
   disposed=true; observer.disconnect();
   doc.removeEventListener('keydown',keyboard,true);
   for (const name of ['pointerdown','click','contextmenu']) doc.removeEventListener(name,track,true);
   for (const title of decorated) clear(title);
   for (const item of menuItems) item.remove();
   menuItems.clear(); style.remove();
  },
 };
}
