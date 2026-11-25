import { useState } from "react";
import { OpenSource } from "./open-source";
import { WatchAction } from "./watch-action";
import { WatchEditor } from "./watch-editor";
import { experimental_InfoSection as InfoSection, useSettings } from "@get-bb/plugin-sdk/app";
import { Marker } from "./status";
import { useSubscriptions } from "../hooks/use-subscriptions";
import { WatchProgress } from "./watch-progress";

function ThreadSubscriptions({ threadId, info }: { threadId: string; info?: boolean }) {
  const [editId, setEditId] = useState<string | null>(null);
  const query = useSubscriptions();
  if (!query.data) return null;
  const { watches, colors } = query.data;
  const rows = watches.filter(w => w.chat === threadId);
  if (!rows.length) return null;
  const links = <div className="mm-ui mm-context" aria-label="Подписки Mattermost этого треда">
    {rows.map(w => {
      const title = w.title || w.channel || w.url.split("/").pop();
      const issue = w.source_problem || w.dispatch_problem || w.delivery_problem || (w.paused ? "Наблюдение завершено" : !w.schedule ? "Без расписания" : "");
      return <div key={w.id} className="mm-context-item">
        <div className="mm-context-title">
          <span aria-label={w.kind === "channel" ? "Канал" : "Ветка"}>{w.kind === "channel" ? "#" : "↳"}</span>
          <WatchAction className="mm-context-name" watch={w} onEdit={() => setEditId(w.id)}>{title}</WatchAction>
          <OpenSource watch={w} />
        </div>
        <div className="mm-context-meta">
          <Marker status={w.status} colors={colors} />
          <WatchProgress watch={w} />
        </div>
        {issue && <small>{issue}</small>}
        {editId === w.id && !w.paused && <WatchEditor watch={w} close={() => setEditId(null)} />}
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
