import { useState } from "react";
import { experimental_useRpcQuery, useBbNavigate, useComposer, useRpc } from "@get-bb/plugin-sdk/app";
import { contract, defaults, type Summary } from "../contract";
import { Marker } from "./status";
import { useSubscriptions, useWatchRefresh } from "../hooks/use-subscriptions";
import { checkTime } from "../time";
import { SummaryContent, type OpenSummary } from "./summary-content";
import { WatchProgress } from "./watch-progress";
import { Board } from "./board";
import { useWidgetLayout } from "./widget-layout";
import { SubscriptionList } from "./subscriptions";

function Inbox({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof contract>();
  const nav = useBbNavigate();
  const watches = useSubscriptions();
  const layout = useWidgetLayout();
  const [page, setPage] = useState<"history" | "subscriptions" | "incoming">("subscriptions");
  const [cursors, setCursors] = useState<number[]>([]);
  const before = cursors[cursors.length - 1];
  const feed = experimental_useRpcQuery({ contract, method: "inbox", input: before ? { chat: threadId, before } : { chat: threadId } });
  useWatchRefresh(feed.refetch);
  const [detail, setDetail] = useState<OpenSummary | null>(null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const all = watches.data?.watches ?? [];
  const own = all.filter(w => w.chat === threadId);
  const suspended = own.filter(w => w.suspended && !w.paused);
  const data = feed.data;
  if (!own.length && !data?.rows.length && !before && !watches.error && !feed.error) return null;
  const colors = watches.data?.colors ?? defaults;
  const last = Math.max(0, ...own.map(w => w.last_checked_at ?? 0));
  function navigate(next: typeof page) {
    setDetail(null); setPage(next); setCursors([]); setError("");
  }
  async function open(id: number) {
    setLoading(true); setError("");
    try {
      const item = await rpc.call("openSummary", { chat: threadId, id });
      setDetail(item);
      await feed.refetch();
    } catch (cause) { setError(String(cause)); }
    finally { setLoading(false); }
  }
  const source = detail && all.find(w => w.id === detail.watch_id);
  function meta(s: Summary) {
    return <div className="mm-event-meta"><Marker status={s.status} colors={colors} />
      <span>{s.source} · {checkTime.format(s.created * 1000)}{all.some(w => w.id === s.watch_id && w.suspended && !w.paused) && " · Источник на паузе"}</span></div>;
  }
  return <section className="mm-ui mm-widget mm-inbox" aria-label="Сводки Mattermost">
    <header><div><strong>Mattermost</strong> {own.length === 1
      ? <small><WatchProgress watch={own[0]} /> · {own[0].paused ? "Завершено" : suspended.length ? "На паузе" : own[0].interval + " мин"}</small>
      : last > 0 && <small>Последнее чтение {checkTime.format(last * 1000)}
        {suspended.length > 0 && " · На паузе: " + suspended.length}
        {own.some(w => w.processing_pending) && " · Есть подписки в обработке"}</small>}</div>
      <nav aria-label="Mattermost в этом треде">
        <button aria-pressed={page === "subscriptions"} disabled={loading} onClick={() => navigate("subscriptions")}>Подписки · {own.length}</button>
        <button aria-pressed={page === "incoming"} disabled={loading} onClick={() => navigate("incoming")}>Входящие</button>
        <button aria-pressed={page === "history"} disabled={loading} onClick={() => navigate("history")}>История сводок</button>
      </nav></header>
    {error && <p role="alert">{error}</p>}
    {(watches.error || feed.error) && <p role="alert">Не удалось обновить данные. <button onClick={() => { void watches.refetch(); void feed.refetch(); }}>Повторить</button></p>}
    {detail ? <article className="mm-event">{meta(detail)}<strong>{detail.headline}</strong>
      <SummaryContent detail={detail} source={source ?? undefined} draft={edits[detail.id]}
        update={text => setEdits({ ...edits, [detail.id]: text })} />
      <button onClick={() => setDetail(null)}>← Назад</button>
    </article> : page === "subscriptions" ? <SubscriptionList query={watches} layout={layout.data ?? "context"} threadId={threadId} onOpenSummary={id => { navigate("history"); return open(id); }} /> : page === "incoming" ?
      <Board colors={colors} subscriptions={own.length} chat={threadId} /> : <>
      {!!data?.unread && <small>Непрочитано: {data.unread}</small>}
      {data?.child && <button onClick={() => nav.toThread(data.child!)}>Открыть сабтред сводок ↗</button>}
      {data?.rows.map(s => <button className="mm-history-row" key={s.id} disabled={loading} onClick={() => void open(s.id)}>
        <strong>{s.headline}</strong>{!s.opened && <small> · Новое</small>}{meta(s)}</button>)}
      {data && !data.rows.length && <p>Здесь появятся сводки по подпискам этого чата.</p>}
      <div className="mm-actions">{cursors.length > 0 && <button onClick={() => setCursors(cursors.slice(0, -1))}>← Новее</button>}
        {data?.more && <button onClick={() => setCursors([...cursors, data.rows[data.rows.length - 1].id])}>Ранее →</button>}</div>
    </>}
  </section>;
}

export function Widget() {
  const { scope } = useComposer();
  return scope.kind === "thread" ? <Inbox key={scope.threadId} threadId={scope.threadId} /> : null;
}
