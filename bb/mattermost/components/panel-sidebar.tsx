import { experimental_useRpcQuery, experimental_useSidebarThreads, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { contract, defaults, labels, type Watch } from "../contract";
import { useSubscriptions } from "../hooks/use-subscriptions";
import type { ListLayout } from "../settings";
import { checkTime } from "../time";
import { PauseGlyph } from "./pause-watch";
import { WatchAction } from "./watch-action";
import type { Colors } from "./status";

export function useListLayout() {
  return experimental_useRpcQuery({ contract, method: "listLayout", input: null });
}

const states = { answer: labels.answer, attention: labels.attention, normal: "Без сигнала", resolved: labels.resolved,
  suspended: "На паузе", ended: "Завершено" };
function state(w: Watch) { return w.paused ? "ended" : w.suspended ? "suspended" : w.status; }
function title(w: Watch) { return w.title || w.channel || w.url; }

type ListProps = { watches: Watch[]; layout: ListLayout; names: Map<string, string>; colors: Colors; onEdit?(id: string): void };

export function SidebarWatchList({ watches, layout, names, colors, onEdit }: ListProps) {
  const ordered = [...watches].sort((a, b) => title(a).localeCompare(title(b), "ru") || a.id.localeCompare(b.id));
  function row(w: Watch) {
    const status = state(w);
    const color = status === "answer" || status === "attention" || status === "resolved" ? colors[status] ?? defaults[status] : null;
    const stamp = w.last_checked_at ? checkTime.format(w.last_checked_at * 1000) : "Ещё не проверено";
    const thread = names.get(w.chat) || w.chat;
    const content = <>
      <span className="mm-list-kind" aria-label={w.kind === "channel" ? "Канал" : "Ветка"}>{w.kind === "channel" ? "#" : "↳"}</span>
      <span className="mm-list-text"><strong>{title(w)}</strong><small>{layout === "thread" ? states[status] : thread} · {stamp}</small></span>
      <span className="mm-list-indicator" aria-label={states[status]} title={states[status]}>
        {color && <i style={{ backgroundColor: color }} />}{status === "suspended" && <PauseGlyph />}
      </span>
    </>;
    return <li key={w.id} data-muted={status === "suspended" || status === "ended"}>
      {onEdit ? <WatchAction watch={w} className="mm-list-row" onEdit={() => onEdit(w.id)}>{content}</WatchAction>
        : <div className="mm-list-row">{content}</div>}
    </li>;
  }
  const groups = new Map<string, Watch[]>();
  if (layout !== "flat") {
    for (const w of ordered) {
      const key = layout === "thread" ? w.chat : state(w);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(w);
    }
  }
  const keys = layout === "status" ? Object.keys(states).filter(k => groups.has(k))
    : [...groups.keys()].sort((a, b) => (names.get(a) || a).localeCompare(names.get(b) || b, "ru"));
  return <section className="mm-watch-list" aria-label="Подписки Mattermost">
    <header><strong>Подписки</strong><small>{watches.length}</small></header>
    {!watches.length && <p>Подписок пока нет. Открой вкладку «Подписки» и нажми «+».</p>}
    {layout === "flat" ? <ul>{ordered.map(row)}</ul> : keys.map(key => {
      const items = groups.get(key)!;
      const label = layout === "status" ? states[state(items[0])] : names.get(key) || key;
      return <details open key={layout + key}><summary>{label} <small>· {items.length}</small></summary>
        <ul>{items.map(row)}</ul></details>;
    })}
  </section>;
}

export function PanelSidebar() {
  const query = useSubscriptions();
  const mode = useListLayout();
  const { threads } = experimental_useSidebarThreads();
  const nav = useBbNavigate();
  if (query.error || mode.error) return <p role="alert">Не удалось загрузить список. <button onClick={() => {
    void query.refetch(); void mode.refetch();
  }}>Повторить</button></p>;
  if (!query.data || !mode.data) return <small>Загрузка подписок…</small>;
  return <SidebarWatchList layout={mode.data} watches={query.data.watches} colors={query.data.colors}
    names={new Map(threads.map(t => [t.id, t.displayTitle]))}
    onEdit={id => nav.toPluginPanel("subscriptions", { subPath: "edit/" + id })} />;
}
