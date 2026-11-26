import { useState } from "react";
import { experimental_Icon as Icon, useComposer } from "@get-bb/plugin-sdk/app";
import { useSubscriptions } from "../hooks/use-subscriptions";
import type { WidgetLayout } from "../settings";
import { useWidgetLayout, WidgetCount } from "./widget-layout";
import { SubscriptionList } from "./subscriptions";

function ThreadSubscriptions({ threadId, layout }: { threadId: string; layout: WidgetLayout }) {
  const key = "mattermost:widget:expanded:" + threadId;
  const [expanded, setExpanded] = useState(() => {
    try {
      const saved = window.localStorage.getItem(key);
      return saved !== "false";
    } catch { return true; }
  });
  function toggle() {
    setExpanded(!expanded);
    try { window.localStorage.setItem(key, String(!expanded)); } catch { /* Keep the choice for this session. */ }
  }
  const query = useSubscriptions();
  const own = query.data?.watches.filter(w => w.chat === threadId) ?? [];
  if (!own.length) return query.error ? <button onClick={() => void query.refetch()}>Повторить загрузку подписок Mattermost</button> : null;
  return <section className="mm-ui mm-widget mm-stack">
    <button className="mm-stack-toggle" type="button" aria-expanded={expanded} onClick={toggle}>
      <Icon name={expanded ? "ChevronDown" : "ChevronRight"} aria-hidden /><WidgetCount rows={own} />
    </button>
    <div hidden={!expanded}><SubscriptionList query={query} threadId={threadId} layout={layout} /></div>
  </section>;
}

export function Widget() {
  const { scope } = useComposer();
  const layout = useWidgetLayout();
  if (scope.kind !== "thread" || !layout.data || layout.data === "off") return null;
  return <ThreadSubscriptions key={scope.threadId} threadId={scope.threadId} layout={layout.data} />;
}
