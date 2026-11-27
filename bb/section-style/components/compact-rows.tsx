import { useEffect, useRef } from 'react';
import { useSettings } from '@get-bb/plugin-sdk/app';
import { threadRowLinkGroup, workspaceRowDetails } from '../../shared-ui/thread-row';
import { mountCompactRows } from '../lib/compact-rows';

export function CompactRows() {
 const { values } = useSettings();
 const enabled = values?.compactRows === true;
 useEffect(() => enabled ? mountCompactRows(document) : undefined, [enabled]);
 return null;
}

export function CompactRowsPreview() {
 const ref = useRef<HTMLDivElement>(null);
 useEffect(() => {
  const preview = ref.current;
  return preview ? mountCompactRows(preview.ownerDocument, preview) : undefined;
 }, []);

 return <div ref={ref} className="section-style-compact-preview">
  <div data-compact-preview-row style={{ width: '100%' }}>
   <span>
    <span data-compact-preview-anchor hidden />
    <span><span className="bb-thread-title">Реализация консьюмера AuthEvent</span></span>
    <button type="button" data-sidebar-rename-anchor aria-expanded="false" aria-label="Expand preview threads"
     tabIndex={-1} style={{ background: 'transparent', border: 0, color: 'inherit' }}>›</button>
    <span {...threadRowLinkGroup('jira')}>
     <a href="https://example.com/AFT-1346">AFT-1346</a>
     <a href="https://example.com/AFT-863">AFT-863</a>
    </span>
    <span {...threadRowLinkGroup('mr')}>
     <a href="https://example.com/mr/629">!629</a>
     <a href="https://example.com/mr/628">!628</a>
    </span>
    <span {...workspaceRowDetails([
     { kind: 'worktree', text: 'fraudcore/AFT-1346-auth-event-consumer' },
     { kind: 'branch', text: 'feature/AFT-1346-session-event-id' },
    ])} />
   </span>
  </div>
 </div>;
}
