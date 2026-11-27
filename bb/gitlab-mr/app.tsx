import { useEffect, useState } from 'react';
import {
  definePluginApp,
  experimental_Icon as Icon,
  experimental_InfoSection as InfoSection,
  experimental_useRpcKeyedQuery,
  useRpc,
  UrlLink,
} from '@get-bb/plugin-sdk/app';
import { mrKey, mrUrl, rpc } from './contract';
import { orderedLinks, presentation } from './presentation';
import { SidebarBadges } from './sidebar';
import './app.css';

function useWatchOpenThreads({ threadIds }: { threadIds: readonly string[] }) {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
  experimental_useRpcKeyedQuery({ contract: rpc, method: 'watch', keys: visible ? [...threadIds] : [] });
}

function MergeRequests({ threadId }: { threadId: string }) {
  const { data } = experimental_useRpcKeyedQuery({ contract: rpc, method: 'snapshot', keys: [threadId] });
  const api = useRpc<typeof rpc>();
  const [selecting, setSelecting] = useState(false);
  const [selectionError, setSelectionError] = useState(false);
  const current = data?.[threadId];
  if (!current || (!current.links.length && !current.candidates.length && !current.notice)) return null;

  const links = orderedLinks(current);
  async function choose(key: string) {
    setSelecting(true);
    setSelectionError(false);
    try {
      setSelectionError(!await api.call('choose', { threadId, key }));
    } catch {
      setSelectionError(true);
    } finally {
      setSelecting(false);
    }
  }

  return <InfoSection label="Merge requests" count={links.length}>
    <ul className="gitlab-mr-list">
      {links.map(link => {
        const status = presentation(link);
        return <li key={mrKey(link)} className="gitlab-mr-row">
          <Icon name="GitPullRequest" className="gitlab-mr-glyph" />
          <UrlLink href={mrUrl(link)} className="gitlab-mr-link" title={`${link.title} · ${link.branch} → ${link.target}`}>
            <span className="gitlab-mr-number">!{link.iid}</span>
            <span className="gitlab-mr-title">{link.title}</span>
          </UrlLink>
          <span className={`gitlab-mr-status gitlab-mr-${status.color}`} title={status.detail}>{status.label}</span>
        </li>;
      })}
    </ul>
    {current.candidates.length > 0 && <div className="gitlab-mr-notice">
      <div>У текущей ветки несколько открытых MR. Выберите нужный.</div>
      {current.candidates.map(mr => <div key={mrKey(mr)} className="gitlab-mr-row">
        <UrlLink href={mrUrl(mr)} className="gitlab-mr-link" title={`${mr.title} → ${mr.target}`}>
          <span className="gitlab-mr-number">!{mr.iid}</span>
          <span className="gitlab-mr-title">{mr.title} → {mr.target}</span>
        </UrlLink>
        <button type="button" disabled={selecting} onClick={() => void choose(mrKey(mr))}>Привязать</button>
      </div>)}
    </div>}
    {selectionError && <div className="gitlab-mr-notice" role="status">Не удалось сохранить привязку.</div>}
    {current.notice && <div className="gitlab-mr-notice">{current.notice}</div>}
  </InfoSection>;
}

export default definePluginApp(app => {
  app.slots.experimental_appOverlay({ id: 'gitlab-mr-sidebar', component: SidebarBadges });
  app.slots.experimental_threadAction({
    id: 'watch-open-thread', title: 'GitLab MR', icon: 'GitPullRequest', group: 'gitlab-mr', placement: 'header',
    useData: useWatchOpenThreads, item: () => null,
  });
  app.slots.experimental_threadInfoSection({
    id: 'gitlab-merge-requests', group: '2_changes_jira', order: 40,
    component: ({ threadId }) => <MergeRequests key={threadId} threadId={threadId} />,
  });
});
