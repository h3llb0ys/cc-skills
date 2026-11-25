import { useEffect, useState } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { Watch } from "../contract";
import { useHeaderMode } from "../hooks/use-header-mode";
import { useSubscriptions } from "../hooks/use-subscriptions";
import type { HeaderMode } from "../settings";
import { checkTime } from "../time";
import { Marker, type Colors } from "./status";

export type HeaderWatch = Pick<Watch, "id" | "status" | "paused" | "last_checked_at"> & { name: string; problem?: string };
const priority = ["answer", "problem", "attention"] as const;
type Alert = typeof priority[number];

function hasAlert(watch: HeaderWatch, alert: Alert) {
  return !watch.paused && (alert === "problem" ? Boolean(watch.problem) : watch.status === alert);
}

export function HeaderBadges({ mode, watches, colors }: { mode: HeaderMode; watches: HeaderWatch[]; colors: Colors }) {
  const [expanded, setExpanded] = useState<Alert | "all" | null>(null);
  const showCount = mode === "count" || mode === "combined";
  const alert = mode === "important" || mode === "combined"
    ? priority.find(kind => watches.some(w => hasAlert(w, kind))) : undefined;
  const expandedAvailable = watches.length > 0 && (expanded === "all" ? showCount : expanded === alert);
  useEffect(() => {
    if (expanded && !expandedAvailable) setExpanded(null);
  }, [expanded, expandedAvailable]);
  if (!watches.length || (!showCount && !alert)) return null;
  const matches = alert ? watches.filter(w => hasAlert(w, alert)) : [];
  const visible = expanded === "all" && showCount ? watches : expanded && expanded === alert ? matches : [];
  function toggle(key: Alert | "all") { setExpanded(current => current === key ? null : key); }
  return <div className="mm-ui mm-header">
    {showCount && <button type="button" aria-expanded={expanded === "all"} onClick={() => toggle("all")}>
      <Icon name="MessageSquare" className="mm-action-glyph" aria-hidden /> Mattermost · {watches.length}
    </button>}
    {alert && <button type="button" aria-expanded={expanded === alert} onClick={() => toggle(alert)}>
      {alert === "problem" ? <span className="mm-marker mm-check-problem"><i />Сбой подписки</span>
        : <Marker status={alert} colors={colors} />} · {matches.length}
    </button>}
    {visible.length > 0 && <ul aria-label={expanded === "all" ? "Подписки треда" : "Важные подписки"}>
      {visible.map(w => <li key={w.id}><strong>{w.name}</strong>
        {w.paused ? <small>Наблюдение завершено</small> : <>
          <Marker status={w.status} colors={colors} />{w.problem && <small>{w.problem}</small>}
        </>}
        {w.last_checked_at !== undefined && w.last_checked_at > 0 && <small>Проверено {checkTime.format(w.last_checked_at * 1000)}</small>}
      </li>)}
    </ul>}
  </div>;
}

function ThreadHeaderWatches({ threadId, mode }: { threadId: string; mode: HeaderMode }) {
  const { data } = useSubscriptions();
  if (!data) return null;
  const watches = data.watches.filter(w => w.chat === threadId).map(w => ({
    ...w, name: w.title || w.channel || w.url,
    problem: w.source_problem || w.dispatch_problem || w.delivery_problem || w.push_problem ||
      (!w.schedule ? "Расписание не включено" : undefined),
  }));
  return <HeaderBadges key={mode} mode={mode} watches={watches} colors={data.colors} />;
}

export function ThreadHeader({ threadId }: { threadId: string }) {
  const { data: mode } = useHeaderMode();
  return mode && mode !== "off" ? <ThreadHeaderWatches key={threadId} threadId={threadId} mode={mode} /> : null;
}
