import { useState } from "react";
import { experimental_useSidebarThreads, experimental_Icon as Icon, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { contract, defaults, type Watch } from "../contract";
import { checkTime } from "../time";
import { WatchAction } from "./watch-action";
import { WatchEditor } from "./watch-editor";
import { CheckWatch } from "./check-watch";
import { Marker } from "./status";
import { useSubscriptions } from "../hooks/use-subscriptions";

type Detail = { kind: "edit" | "open" | "remove"; id: string } | { kind: "create"; id?: never } | null;

function RemoveWatch({ watch, cancel, removed }: { watch: Watch; cancel(): void; removed(): void }) {
  const rpc = useRpc<typeof contract>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    setPending(true);
    setError("");
    try {
      await rpc.call("unwatch", { id: watch.id });
      removed();
    } catch (cause) {
      setError(String(cause));
      setPending(false);
    }
  }
  return <div className="mm-sheet" role="group" aria-label="Подтверждение удаления">
    <span>Удалить подписку «{watch.title || watch.channel || watch.url}»{watch.schedule ? " и её автоматизацию в BB" : ""}?</span>
    <div className="mm-actions">
      <button type="button" disabled={pending} onClick={() => void remove()}>{pending ? "Удаляем…" : "Удалить"}</button>
      <button type="button" disabled={pending} onClick={cancel}>Отмена</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </div>;
}

function FinishSetup({ watch, refresh }: { watch: Watch; refresh: () => Promise<unknown> }) {
  const rpc = useRpc<typeof contract>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function activate() {
    setBusy(true);
    setError("");
    try {
      await rpc.call("finishSetup", { id: watch.id, chat: watch.chat });
      await refresh();
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  return <div className="mm-actions">
    <button disabled={busy} onClick={() => void activate()}>{busy ? "Включаем…" : "Включить расписание"}</button>
    {error && <span role="alert">{error}</span>}
  </div>;
}

export function Subscriptions({ threadId, editId }: { threadId: string; editId?: string }) {
  const query = useSubscriptions();
  return <SubscriptionList query={query} threadId={threadId} editId={editId} />;
}

export function SubscriptionList({ query, threadId, editId, grouped = false }: { query: ReturnType<typeof useSubscriptions>; threadId?: string; editId?: string; grouped?: boolean }) {
  const nav = useBbNavigate();
  const { threads } = experimental_useSidebarThreads();
  const [detail, setDetail] = useState<Detail>(editId ? { kind: "edit", id: editId } : null);
  const [error, setError] = useState("");
  const creating = detail?.kind === "create";
  const rows = (query.data?.watches ?? []).filter(w => !threadId || w.chat === threadId);
  const colors = query.data?.colors ?? defaults;
  const names = new Map(threads.map(t => [t.id, t.displayTitle]));
  const groups = new Map<string, Watch[]>();
  for (const w of rows) {
    if (!groups.has(w.chat)) groups.set(w.chat, []);
    groups.get(w.chat)!.push(w);
  }

  function openSource(w: Watch) {
    if (nav.openUrl(w.url)) { setError(""); setDetail(null); }
    else setError("Клиент не поддерживает эту ссылку. Откройте в браузере.");
  }
  function row(w: Watch) {
    const title = w.title || w.url.split("/").pop();
    const selected = detail?.id === w.id ? detail.kind : null;
    return <div className="mm-item" key={w.id}><div className="mm-line">
      <WatchAction watch={w} className="mm-main" onEdit={() => setDetail({ kind: "edit", id: w.id })}>
        <span className="mm-title"><strong>{title}</strong><small>{w.kind === "channel" ? "Канал" : "Ветка"}</small>
          <Marker status={w.status} colors={colors} /></span>
        <span className="mm-meta">{w.channel && `#${w.channel} · `}{w.interval} мин
          {!grouped && !threadId && ` · BB: ${names.get(w.chat) ?? w.chat}`}
          {w.last_checked_at && " · Проверено " + checkTime.format(w.last_checked_at * 1000)}
          {w.paused ? " · Завершено" : !w.schedule ? " · Без расписания" : ""}</span>
        {threadId && <span className="mm-meta">{w.destination === "shared" ? "Общий сабтред сводок" : "Этот чат"}</span>}
        {w.source_problem && <span role="alert">{w.source_problem}</span>}
        {w.push_problem && <span className="mm-meta">Push ожидает доставки</span>}
      </WatchAction>
      <CheckWatch watch={w} />
      <button className="mm-icon" disabled={w.source_link_blocked} title="Открыть в Mattermost" aria-label={`Открыть в Mattermost: ${title}`}
        onClick={() => { setError(""); setDetail(selected === "open" ? null : { kind: "open", id: w.id }); }}><Icon name="ExternalLink" className="mm-action-glyph" aria-hidden /></button>
      <button className="mm-icon" title="Настроить подписку" aria-label={`Настройки: ${title}`}
        onClick={() => setDetail(selected === "edit" ? null : { kind: "edit", id: w.id })}><Icon name="Settings" className="mm-action-glyph" aria-hidden /></button>
      <button type="button" className="mm-icon" title="Удалить подписку" aria-label={`Удалить подписку: ${title}`}
        onClick={() => setDetail({ kind: "remove", id: w.id })}><Icon name="Trash2" className="mm-action-glyph" aria-hidden /></button>
    </div>
      {w.setup_pending && !w.paused && <FinishSetup watch={w} refresh={query.refetch} />}
      {selected === "remove" && <RemoveWatch watch={w} cancel={() => setDetail(null)}
        removed={() => { setDetail(null); void query.refetch(); }} />}
      {selected === "open" && <div className="mm-actions"><button onClick={() => openSource(w)}>В браузере ↗</button>
        <a href={w.url.replace(/^https:/, "mattermost:")} onClick={event => {
          if (nav.openUrl(event.currentTarget.href)) {
            event.preventDefault();
            setDetail(null);
          }
        }}>В приложении ↗</a>{error && <span role="alert">{error}</span>}</div>}
      {selected === "edit" && w.paused && <p>Наблюдение завершено · {w.rule}</p>}
      {selected === "edit" && !w.paused && <WatchEditor watch={w} close={() => { setDetail(null); void query.refetch(); }} />}
    </div>;
  }
  return <section className={threadId ? "mm-ui mm-widget" : "mm-ui"}>
    <header className="mm-create-bar">
      {threadId && <button onClick={() => nav.toPluginPanel("subscriptions", { subPath: "list" })}>Все подписки</button>}
      <button type="button" className="mm-icon" aria-label="Добавить подписку" title="Добавить подписку"
        aria-expanded={creating} disabled={creating} onClick={() => setDetail({ kind: "create" })}>
        <Icon name="Plus" className="mm-action-glyph" aria-hidden />
      </button>
    </header>
    {creating && <WatchEditor threadId={threadId} close={() => { setDetail(null); void query.refetch(); }} />}
    {query.error && <div role="alert">Ошибка загрузки подписок <button onClick={() => void query.refetch()}>Повторить</button></div>}
    {!rows.length && !creating && !query.error && <p>{query.isLoading ? "Загрузка…" : "Подписок пока нет. Нажми «+», чтобы добавить канал или ветку."}</p>}
    {grouped ? [...groups].map(([id, items]) => <details key={id} open><summary>{names.get(id) ?? id} · {items.length}</summary>{items.map(row)}</details>) : rows.map(row)}
  </section>;
}
