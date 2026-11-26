import { groupWatches } from "../group-watches";
import { useMemo, type ReactNode } from "react";
import { createPortal } from "react-dom";
import * as Popover from "@radix-ui/react-popover";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import { defaults, labels, type Watch } from "../contract";
import { useHeaderMode } from "../hooks/use-header-mode";
import { useSidebarRows } from "../hooks/sidebar-rows";
import { useSubscriptions } from "../hooks/use-subscriptions";
import type { HeaderMode } from "../settings";
import { checkTime } from "../time";
import { PauseGlyph, PauseWatch, type DemoPause } from "./pause-watch";
import { WatchMarker, type Colors } from "./status";

export type SidebarWatch = Pick<Watch, "id" | "status" | "paused" | "suspended" | "last_checked_at"> & { schedule?: string | null; name: string; problem?: string };
const priority = ["answer", "problem", "attention"] as const;
type Alert = typeof priority[number];
function hasAlert(w: SidebarWatch, alert: Alert) {
  return !w.paused && !w.suspended && (alert === "problem" ? Boolean(w.problem) : w.status === alert);
}

function Badge({ label, watches, colors, children, demo }: {
  label: string; watches: SidebarWatch[]; colors: Colors; children: ReactNode; demo?: DemoPause;
}) {
  return <Popover.Root><Popover.Trigger asChild><button type="button" title={label} aria-label={label}
    onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
    onDoubleClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>{children}</button></Popover.Trigger>
    <Popover.Portal><Popover.Content className="mm-ui mm-badge-details" aria-label={label} side="right" align="start"
      sideOffset={5} collisionPadding={8}><ul>{watches.map(w => <li key={w.id} data-suspended={!!w.suspended && !w.paused}><strong>{w.name}</strong>
        {w.paused ? <small>Наблюдение завершено</small> : <><WatchMarker watch={w} colors={colors} />
          {!w.suspended && w.problem && <small>{w.problem}</small>}</>}
        <PauseWatch watch={w} name={w.name} demo={demo} />
        {!!w.last_checked_at && <small>Проверено {checkTime.format(w.last_checked_at * 1000)}</small>}
      </li>)}</ul></Popover.Content></Popover.Portal>
  </Popover.Root>;
}

export function SidebarBadges({ mode, watches, colors, demo }: { demo?: DemoPause; mode: HeaderMode; watches: SidebarWatch[]; colors: Colors }) {
  const count = mode === "count" || mode === "combined";
  const alert = mode === "important" || mode === "combined" ? priority.find(a => watches.some(w => hasAlert(w, a))) : undefined;
  if (!watches.length || (!count && !alert)) return null;
  const matches = alert ? watches.filter(w => hasAlert(w, alert)) : [];
  const allSuspended = watches.every(w => w.suspended && !w.paused);
  return <span className="mm-row-badges">
    {count && <Badge label={(allSuspended ? "Mattermost · На паузе · " : "Mattermost · ") + watches.length} watches={watches} colors={colors} demo={demo}>
      {allSuspended ? <PauseGlyph /> : <Icon name="MessageSquare" aria-hidden />}{watches.length}</Badge>}
    {alert && <Badge key={alert} label={(alert === "problem" ? "Сбой подписки" : labels[alert]) + " · " + matches.length}
      watches={matches} colors={colors} demo={demo}><i style={{ backgroundColor: alert === "problem" ? "var(--warning,#f59e0b)" : colors[alert] ?? defaults[alert] }} />
      {matches.length}</Badge>}
  </span>;
}

function SidebarSubscriptions({ mode }: { mode: HeaderMode }) {
  const { data } = useSubscriptions();
  const rows = useSidebarRows();
  const byThread = useMemo(() => {
    const watches = (data?.watches ?? []).map(w => ({
      ...w, name: w.title || w.channel || w.url,
      problem: w.source_problem || w.dispatch_problem || w.delivery_problem || w.push_problem ||
        (!w.schedule ? "Расписание не включено" : undefined),
    }));
    return groupWatches(watches);
  }, [data]);
  return <>{rows.map(({ threadId, title, key }) => {
    const watches = byThread.get(threadId);
    return watches && data ? createPortal(<SidebarBadges mode={mode} watches={watches} colors={data.colors} />,
      title, key) : null;
  })}</>;
}
export function SidebarOverlay() {
  const { data: mode } = useHeaderMode();
  return mode && mode !== "off" ? <SidebarSubscriptions mode={mode} /> : null;
}
