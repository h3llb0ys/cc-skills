import { useState } from "react";
import { experimental_Icon as Icon, experimental_useRpcQuery, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { contract, defaults, labels, type BoardCard, type Signal } from "../contract";
import { useSubscriptions, useWatchRefresh } from "../hooks/use-subscriptions";
import { checkTime } from "../time";
import { Marker, type Colors } from "./status";
import { SubscriptionList } from "./subscriptions";
import { WatchEditor } from "./watch-editor";
import { OpenSource, usePreferredLink } from "./open-source";
import { ReplyDraft } from "./reply-draft";

function Card({ item }: { item: BoardCard }) {
  const rpc = useRpc<typeof contract>();
  const [reply, setReply] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function read() {
    if (item.opened) return;
    try { await rpc.call("readCard", { id: item.id, revision: item.revision }); setError(""); }
    catch (err) { setError(String(err)); }
  }
  const { link, loading } = usePreferredLink(item.url, read);
  return <article className="mm-board-card">
    <div className="mm-board-title">{loading ? <span>{item.headline}</span> :
      <a className={item.opened ? "" : "mm-unread"} {...link}>{item.headline}</a>}
      <time dateTime={new Date(item.updated * 1000).toISOString()}>{checkTime.format(item.updated * 1000)}</time></div>
    {item.body && item.body !== item.headline && <p>{item.body}</p>}
    <div className="mm-board-meta"><small>{item.source}{item.author && " · " + item.author}</small><div className="mm-actions">
      {item.draft && <button aria-expanded={reply} onClick={() => { setReply(!reply); void read(); }}>
        <Icon name="Reply" aria-hidden /> Ответить</button>}
      <OpenSource watch={{ url: item.url, title: item.headline }} onOpen={read} />
    </div></div>
    {item.draft && reply && <ReplyDraft url={item.url} text={edit ?? item.draft} update={setEdit} />}
    {error && <small role="alert">{error}</small>}
  </article>;
}

const firstPage = { answer: 0, attention: 0, resolved: 0 };
function Board({ colors, subscriptions }: { colors: Colors; subscriptions?: number }) {
  const [offsets, setOffsets] = useState(firstPage);
  const query = experimental_useRpcQuery({ contract, method: "board", input: offsets });
  useWatchRefresh(query.refetch);
  const [showResolved, setShowResolved] = useState(false);
  const data = query.data;
  if (query.error) return <p role="alert">Не удалось загрузить входящие. <button onClick={() => void query.refetch()}>Повторить</button></p>;
  if (!data) return <p>Загрузка…</p>;
  if (Object.values(data).every(group => !group.total)) return <p>{subscriptions === 0
    ? "Подписок пока нет. Открой вкладку «Подписки» и нажми «+»."
    : "Пока нет вопросов, требующих внимания."}</p>;
  return <>{(Object.keys(labels) as Signal[]).map(status => {
    const { total, rows } = data[status];
    if (!total) return null;
    const heading = <><Marker status={status} colors={colors} /> <small>{total}</small></>;
    const collapsed = status === "resolved" && !showResolved;
    function page(offset: number) { setOffsets(prev => ({ ...prev, [status]: Math.max(0, offset) })); }
    return <section className="mm-board-section" key={status} aria-label={labels[status]}>
      <h3>{status === "resolved" ? <button aria-expanded={showResolved} onClick={() => setShowResolved(!showResolved)}>
        <Icon name={showResolved ? "ChevronDown" : "ChevronRight"} aria-hidden /> {heading}</button> : heading}</h3>
      {!collapsed && <>{rows.map(item => <Card key={item.id + ":" + item.revision} item={item} />)}
        <div className="mm-actions">
          {offsets[status] > 0 && <button onClick={() => page(offsets[status] - 30)}>← Новее</button>}
          {offsets[status] + rows.length < total && <button onClick={() => page(offsets[status] + rows.length)}>Ранее →</button>}
        </div></>}
    </section>;
  })}</>;
}

export function MattermostPanel({ subPath }: { subPath: string }) {
  const nav = useBbNavigate();
  const watches = useSubscriptions();
  const grouped = subPath === "threads";
  const editId = /^edit\/([a-f0-9]{20})$/.exec(subPath)?.[1];
  const editing = editId ? watches.data?.watches.find(w => w.id === editId) : undefined;
  const list = subPath === "list" || !!editId;
  const inbox = !list && !grouped;
  const last = Math.max(0, ...(watches.data?.watches ?? []).map(w => w.last_checked_at ?? 0));
  return <section className="mm-ui mm-panel mm-board">
    <header><h2>Mattermost</h2>{last > 0 && <small>Проверено {checkTime.format(last * 1000)}</small>}</header>
    <nav className="mm-tabs" aria-label="Mattermost">
      <button aria-pressed={inbox} onClick={() => nav.toPluginPanel("subscriptions")}>Входящие</button>
      <button aria-pressed={list} onClick={() => nav.toPluginPanel("subscriptions", { subPath: "list" })}>
        Подписки{watches.data && " · " + watches.data.watches.length}</button>
      <button aria-pressed={grouped} onClick={() => nav.toPluginPanel("subscriptions", { subPath: "threads" })}>По тредам BB</button>
    </nav>
    {inbox ? <Board colors={watches.data?.colors ?? defaults} subscriptions={watches.data?.watches.length} />
      : editId ? (editing && !editing.paused
        ? <WatchEditor key={editId} watch={editing} close={() => nav.toPluginPanel("subscriptions", { subPath: "list" })} />
        : <p>{watches.error ? "Не удалось загрузить подписку" : watches.isLoading ? "Загрузка…" : "Подписка недоступна для редактирования"}</p>)
      : <SubscriptionList query={watches} grouped={grouped} />}
  </section>;
}
