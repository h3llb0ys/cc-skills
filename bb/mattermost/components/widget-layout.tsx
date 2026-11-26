import { useState, type ReactNode } from "react";
import { experimental_Icon as Icon, experimental_useRpcQuery, experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { contract, defaults, labels, type Watch } from "../contract";
import { widgetLayouts, widgetLabels, type WidgetLayout } from "../settings";
import { useColors } from "../hooks/use-colors";
import { watchProblem, type Colors } from "./status";
import { checkTime } from "../time";

export function useWidgetLayout() {
  return experimental_useRpcQuery({ contract, method: "widgetLayout", input: null });
}

export function WidgetRows({ rows, layout, row }: { rows: Watch[]; layout: WidgetLayout; row(w: Watch): ReactNode }) {
  if (layout !== "channel") return <>{rows.map(row)}</>;
  const groups = new Map<string, Watch[]>();
  for (const w of rows) {
    const name = w.channel || (w.kind === "channel" && w.title);
    const key = name ? w.url.replace(/\/(pl|channels)\/[^/]+\/?$/, "") + "/" + name : w.id;
    const group = groups.get(key) ?? [];
    group.push(w);
    groups.set(key, group);
  }
  return <>{Array.from(groups, ([key, items]) => {
    if (items.length === 1 && (items[0].kind === "channel" || !items[0].channel)) return row(items[0]);
    return <ChannelGroup key={key} items={items} row={row} />;
  })}</>;
}

function ChannelGroup({ items, row }: { items: Watch[]; row(w: Watch): ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  const channel = items.find(w => w.kind === "channel");
  const name = items[0].channel || channel?.title;
  return <div className="mm-channel-group"><div className="mm-channel-head">
    <button aria-expanded={expanded} aria-label={(expanded ? "Свернуть " : "Развернуть ") + name}
      onClick={() => setExpanded(!expanded)}><Icon name={expanded ? "ChevronDown" : "ChevronRight"} /></button>
    {channel ? row(channel) : <strong>#{name}</strong>}</div>
    {expanded && items.filter(w => w !== channel).map(row)}</div>;
}

const clock = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });

export function CompactLine({ w, colors, layout, title, actions, feedback }: {
  w: Watch; colors: Colors; layout: WidgetLayout; title: ReactNode; actions: ReactNode; feedback?: string;
}) {
  const active = !w.suspended && !w.paused;
  const signal = active && w.status && w.status !== "normal" ? w.status : null;
  const error = active && watchProblem(w);
  const note = error || (signal && signal !== "resolved" && labels[signal]);
  const dot = error ? "var(--destructive)" : signal ? colors[signal] ?? defaults[signal] : undefined;
  const when = w.last_checked_at ? new Date(w.last_checked_at * 1000) : null;
  return <><div className="mm-compact-line">
    <span className="mm-compact-kind" title={w.kind === "channel" ? "Канал" : "Ветка"}>{w.kind === "channel" ? "#" : "↳"}</span>
    {title}
    {dot && <i className="mm-compact-dot" role="img" aria-label={error || labels[signal!]} title={error || labels[signal!]} style={{ background: dot }} />}
    <small role="status" title={feedback || (when ? checkTime.format(when) : undefined)}>{feedback || (w.paused ? "Завершено" : w.suspended ? "На паузе" : when ? clock.format(when) : "—")}</small>
    {actions}</div>
    {layout === "context" && note && <div className="mm-compact-note"><span title={note}>{note}</span></div>}</>;
}

export function WidgetCount({ rows }: { rows: Watch[] }) {
  const important = rows.filter(w => !w.suspended && !w.paused && (w.status === "answer" || w.status === "attention"
    || watchProblem(w) || !w.schedule)).length;
  return <span className="mm-widget-count"><strong>Mattermost · {rows.length}</strong>
    <small>{important ? "Важных: " + important : "Важных нет"}</small></span>;
}

const channel = "qna-team-promo-prgrow";
const sample: Watch = { id: "example", chat: "", owner: "", url: "https://example.org/team/channels/" + channel,
  channel, title: channel, kind: "channel", status: "attention", rule: "", interval: 10, draft: false,
  last_checked_at: 1795703460, schedule: "sample-job", paused: false, push: null, until: null, timezone: "UTC",
  latest_summary: { id: 1, created: 1795703460, opened: false } };
const examples: Watch[] = [{ ...sample, id: "question", kind: "thread", status: "normal", url: "https://example.org/team/pl/question",
  title: "Как получить количество промокодов?", latest_summary: undefined }, sample];

export function WidgetLayoutSettings() {
  const mode = useWidgetLayout();
  const colors = useColors();
  const change = experimental_useRpcMutation({ contract, method: "setWidgetLayout",
    optimistic: (layout, cache) => cache.update("widgetLayout", null, () => layout) });
  if (!mode.data) return mode.error ? <button onClick={() => void mode.refetch()}>Повторить загрузку вида виджета</button> : null;
  const layout = mode.data;
  return <section className="mm-ui"><div className="mm-fields mm-widget-options">
    <label><select aria-label="Виджет в треде" value={layout} disabled={change.isPending}
      onChange={e => void change.mutate(e.currentTarget.value as WidgetLayout).catch(() => {})}>
      {widgetLayouts.map(value => <option key={value} value={value}>{widgetLabels[value]}</option>)}
    </select></label>
    </div>
    <div className="mm-list-preview" aria-label="Предпросмотр виджета">{layout === "off" ? <small>Виджет скрыт</small> : <WidgetRows layout={layout} rows={examples} row={w =>
      <div className="mm-compact" key={w.id}><CompactLine w={w} colors={colors.data ?? defaults} layout={layout}
        title={<span className="mm-compact-name">{w.title}</span>}
        actions={<span aria-hidden className="mm-demo-actions"><Icon name="Globe" /><Icon name="ChevronDown" /> ···</span>} /></div>} />}</div>
    {change.error && <p role="alert">{change.error.message}</p>}</section>;
}
