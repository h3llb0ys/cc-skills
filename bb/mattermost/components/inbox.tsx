import { useState } from "react";
import { experimental_useRpcQuery, useBbNavigate, useComposer, useRpc } from "@get-bb/plugin-sdk/app";
import { contract, defaults, type Summary } from "../contract";
import { Marker } from "./status";
import { useSubscriptions, useWatchRefresh } from "../hooks/use-subscriptions";
import { checkTime } from "../time";
import { ReplyDraft } from "./reply-draft";
import { WatchProgress } from "./watch-progress";
import { WatchAction } from "./watch-action";
import { Subscriptions } from "./subscriptions";

type OpenSummary = Summary & { body: string; draft: string };

function SummaryBody({ body }: { body: string }) {
  return <p className="mm-summary-body">{body.split(/(https:\/\/[^\s<>)\]]+)/g).map((part, i) =>
    part.startsWith("https://") ? <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a> : part
  )}</p>;
}

function Inbox({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof contract>();
  const nav = useBbNavigate();
  const watches = useSubscriptions();
  const [page, setPage] = useState<"widget" | "history" | "subscriptions">("widget");
  const [editId, setEditId] = useState<string>();
  const [cursors, setCursors] = useState<number[]>([]);
  const before = cursors[cursors.length - 1];
  const feed = experimental_useRpcQuery({ contract, method: "inbox", input: before ? { chat: threadId, before } : { chat: threadId } });
  useWatchRefresh(feed.refetch);
  const [detail, setDetail] = useState<OpenSummary | null>(null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const own = (watches.data?.watches ?? []).filter(w => w.chat === threadId);
  const data = feed.data;
  if (!own.length && !data?.rows.length && !before && !watches.error && !feed.error) return null;
  const colors = watches.data?.colors ?? defaults;
  const last = Math.max(0, ...own.map(w => w.last_checked_at ?? 0));
  function navigate(next: typeof page) {
    setEditId(undefined); setDetail(null); setPage(next); setCursors([]); setError("");
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
  const latest = data?.latest;
  function meta(s: Summary) {
    return <div className="mm-event-meta"><Marker status={s.status} colors={colors} />
      <span>{s.source} · {checkTime.format(s.created * 1000)}</span></div>;
  }
  return <section className="mm-ui mm-widget mm-inbox" aria-label="Сводки Mattermost">
    <header><div><strong>Mattermost</strong> {own.length === 1
      ? <small><WatchProgress watch={own[0]} /> · {own[0].interval} мин</small>
      : last > 0 && <small>Последнее чтение {checkTime.format(last * 1000)}
        {own.some(w => w.processing_pending) && " · Есть подписки в обработке"}</small>}</div>
      <nav>{(page !== "widget" || detail) && <button disabled={loading} onClick={() => navigate("widget")}>Виджет</button>}
        <button aria-pressed={page === "history" && !detail} disabled={loading} onClick={() => navigate("history")}>Сводки{data?.unread ? " · " + data.unread : ""}</button>
        <button aria-pressed={page === "subscriptions" && !detail} disabled={loading} onClick={() => navigate("subscriptions")}>Подписки · {own.length}</button>
      </nav></header>
    {error && <p role="alert">{error}</p>}
    {(watches.error || feed.error) && <p role="alert">Не удалось обновить данные. <button onClick={() => { void watches.refetch(); void feed.refetch(); }}>Повторить</button></p>}
    {detail ? <article className="mm-event">{meta(detail)}<strong>{detail.headline}</strong>
      <SummaryBody body={detail.body} />
      <a href={detail.url} target="_blank" rel="noopener noreferrer">В Mattermost ↗</a>
      {detail.draft && <details><summary>Черновик ответа</summary>
        <ReplyDraft url={detail.url} text={edits[detail.id] ?? detail.draft}
          update={text => setEdits({ ...edits, [detail.id]: text })} />
      </details>}
      <button onClick={() => setDetail(null)}>← Назад</button>
    </article> : page === "subscriptions" ? <Subscriptions threadId={threadId} editId={editId} /> : page === "history" ? <>
      {data?.child && <button onClick={() => nav.toThread(data.child!)}>Открыть сабтред сводок ↗</button>}
      {data?.rows.map(s => <button className="mm-history-row" key={s.id} disabled={loading} onClick={() => void open(s.id)}>
        <strong>{s.headline}</strong>{!s.opened && <small> · Новое</small>}{meta(s)}</button>)}
      {data && !data.rows.length && <p>Здесь появятся сводки по подпискам этого чата.</p>}
      <div className="mm-actions">{cursors.length > 0 && <button onClick={() => setCursors(cursors.slice(0, -1))}>← Новее</button>}
        {data?.more && <button onClick={() => setCursors([...cursors, data.rows[data.rows.length - 1].id])}>Ранее →</button>}</div>
    </> : latest ? <article className="mm-event">{meta(latest)}<strong>{latest.headline}</strong><div className="mm-actions">
      <button className="mm-primary" disabled={loading} onClick={() => void open(latest.id)}>Открыть сводку →</button>
      <a href={latest.url} target="_blank" rel="noopener noreferrer">В Mattermost ↗</a>
    </div></article> : data && <small>{data.rows.length ? "Все сводки просмотрены" : "Ждём первую сводку"}
      {!data.rows.length && own.length === 1 &&
        <> · <WatchAction watch={own[0]} onEdit={() => { navigate("subscriptions"); setEditId(own[0].id); }}>
          {own[0].title || own[0].channel || own[0].url}</WatchAction></>}</small>}
  </section>;
}

export function Widget() {
  const { scope } = useComposer();
  return scope.kind === "thread" ? <Inbox key={scope.threadId} threadId={scope.threadId} /> : null;
}
