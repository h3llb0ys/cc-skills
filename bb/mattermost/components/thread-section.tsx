import { experimental_Icon as Icon, experimental_InfoSection as InfoSection, useSettings } from "@get-bb/plugin-sdk/app";
import { Marker } from "./status";
import { useSubscriptions } from "../hooks/use-subscriptions";
import { checkTime } from "../time";

function ThreadSubscriptions({ threadId, info }: { threadId: string; info?: boolean }) {
  const query = useSubscriptions();
  if (!query.data) return null;
  const { watches, colors } = query.data;
  const rows = watches.filter(w => w.chat === threadId);
  if (!rows.length) return null;
  const links = <div className="mm-ui mm-context" aria-label="Подписки Mattermost этого треда">
    {rows.map(w => {
      const title = w.title || w.channel || w.url.split("/").pop();
      const issue = w.source_problem || (w.paused ? "Наблюдение завершено" : !w.schedule ? "Без расписания" : "");
      return <div key={w.id} className="mm-context-item">
        <div className="mm-context-title">
          <span aria-label={w.kind === "channel" ? "Канал" : "Ветка"}>{w.kind === "channel" ? "#" : "↳"}</span>
          <span className="mm-context-name" title={title}>{title}</span>
          {!w.source_problem && <a href={w.url} target="_blank" rel="noopener noreferrer" title="Открыть в Mattermost" aria-label={`Открыть в Mattermost: ${title}`}>
            <Icon name="ExternalLink" className="mm-action-glyph" aria-hidden />
          </a>}
        </div>
        <div className="mm-context-meta">
          <Marker status={w.status} colors={colors} />
          {w.last_checked_at === undefined ? <span>Время проверки пока неизвестно</span> :
            <time dateTime={new Date(w.last_checked_at * 1000).toISOString()}>Проверено {checkTime.format(w.last_checked_at * 1000)}</time>}
        </div>
        {issue && <small>{issue}</small>}
      </div>;
    })}
  </div>;
  return info ? <InfoSection label="Mattermost">{links}</InfoSection> : links;
}

export function ThreadSection({ threadId, info }: { threadId: string; info?: boolean }) {
  const settings = useSettings();
  if (settings.isLoading || settings.values?.showThreadSubscriptions === false) return null;
  return <ThreadSubscriptions key={threadId} threadId={threadId} info={info} />;
}
