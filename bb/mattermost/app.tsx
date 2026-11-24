import { useEffect, useRef, useState } from "react";
import {
  definePluginApp, experimental_useRpcQuery, experimental_useSidebarThreads,
  experimental_Icon as Icon, experimental_InfoSection as InfoSection, useBbNavigate, useComposer, useRealtime, useRpc, useSettings,
} from "@get-bb/plugin-sdk/app";
import { ColorPalette } from "../shared-ui/color-palette";
import "../shared-ui/color-palette.css";
import { contract, defaults, labels, type Signal, type Watch, type Summary } from "./contract";
import "./app.css";

type Colors = Record<Signal, string | null>;
type Detail = { kind: "edit" | "open" | "remove"; id: string } | null;

function Marker({ status, colors }: { status: Watch["status"]; colors: Colors }) {
  return !status || status === "normal" ? null : <span className="mm-marker">
    <i style={{ backgroundColor: colors[status] ?? defaults[status] }} />{labels[status]}
  </span>;
}

function MessageStatus({ attributes }: { attributes: Readonly<Record<string, string>> }) {
  const query = experimental_useRpcQuery({ contract, method: "colors", input: null });
  useRealtime("colors", () => { void query.refetch(); });
  const status = attributes.status;
  if (status !== "answer" && status !== "attention" && status !== "resolved") return null;
  return <span className="mm-ui"><Marker status={status} colors={query.data ?? defaults} /></span>;
}

function localDate(seconds: number | null) {
  if (seconds === null) return "";
  const date = new Date(seconds * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function WatchEditor({ watch, close }: { watch: Watch; close(): void }) {
  const rpc = useRpc<typeof contract>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [rule, setRule] = useState(watch.rule);
  const presets = ["Все новые сообщения", "Ждут моего ответа", "Блокеры и решения"];
  return <form className="mm-sheet" onSubmit={async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const end = String(data.get("until"));
    setSaving(true);
    try {
      await rpc.call("edit", { id: watch.id, interval: Number(data.get("interval")), rule: String(data.get("rule")),
        destination: data.get("destination") === "shared" ? "shared" : "chat",
        push: String(data.get("push")).trim() || null, draft: data.has("draft"),
        until: end ? Math.floor(new Date(end).getTime() / 1000) : null });
      close();
    } catch (cause) { setError(String(cause)); } finally { setSaving(false); }
  }}>
    <div className="mm-fields">
      <label>Интервал, минуты<input name="interval" type="number" min="1" required defaultValue={watch.interval} /></label>
      <label>Следить до (местное время)<input type="datetime-local" name="until" defaultValue={localDate(watch.until)} /></label>
      <label className="wide">Куда присылать<select name="destination" defaultValue={watch.destination ?? "chat"}>
        <option value="chat">Этот чат</option><option value="shared">Общий сабтред сводок</option>
      </select></label>
      <label className="wide">Когда сообщать<select value={presets.includes(rule) ? rule : "custom"}
        onChange={e => setRule(e.target.value === "custom" ? "" : e.target.value)}>
        {presets.map(p => <option key={p}>{p}</option>)}<option value="custom">Своё правило</option>
      </select></label>
      {presets.includes(rule) ? <input type="hidden" name="rule" value={rule} /> :
        <label className="wide">Полное правило<textarea required name="rule" value={rule} onChange={e => setRule(e.target.value)} /></label>}
      <label className="wide">Когда отправлять push<input name="push" placeholder="Выключен" defaultValue={watch.push ?? ""} /></label>
      <label className="mm-check wide"><input type="checkbox" name="draft" defaultChecked={watch.draft} />Добавлять черновик ответа</label>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="mm-actions"><button disabled={saving} type="submit">Сохранить</button><button type="button" onClick={close}>Отмена</button></div>
  </form>;
}

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

function Palette({ colors }: { colors: Colors }) {
  const rpc = useRpc<typeof contract>();
  const [selected, select] = useState<Signal>("answer");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return <div className="mm-sheet"><div className="mm-tabs" aria-label="Цвет статуса">
    {(Object.keys(labels) as Signal[]).map(s => <button key={s} aria-pressed={s === selected} onClick={() => select(s)}>
      <Marker status={s} colors={colors} /></button>)}
  </div><fieldset disabled={busy}><ColorPalette color={colors[selected]} commitCustomColor onChange={async color => {
    setBusy(true);
    try { await rpc.call("color", { status: selected, color }); setError(""); }
    catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  }} /></fieldset>{error && <p role="alert">{error}</p>}</div>;
}

function useSubscriptions() {
  const query = experimental_useRpcQuery({ contract, method: "list", input: null });
  useWatchRefresh(query.refetch);
  return query;
}

function useWatchRefresh(refetch: () => Promise<unknown>) {
  const refresh = useRef(refetch);
  refresh.current = refetch;
  useRealtime("changed", () => { void refresh.current(); });
  useEffect(() => {
    const poll = () => { if (!document.hidden) void refresh.current(); };
    const id = window.setInterval(poll, 30000);
    document.addEventListener("visibilitychange", poll);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", poll); };
  }, []);
}

function Subscriptions({ threadId }: { threadId?: string }) {
  const nav = useBbNavigate();
  const { threads } = experimental_useSidebarThreads();
  const query = useSubscriptions();
  const [grouped, setGrouped] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [detail, setDetail] = useState<Detail>(null);
  const [error, setError] = useState("");
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
      <button className="mm-main" onClick={() => threadId ? setDetail({ kind: "edit", id: w.id }) : nav.toThread(w.chat)} title={threadId ? "Настроить подписку" : `Открыть BB · ${names.get(w.chat) ?? w.chat}`}>
        <span className="mm-title"><strong>{title}</strong><small>{w.kind === "channel" ? "Канал" : "Ветка"}</small>
          <Marker status={w.status} colors={colors} /></span>
        <span className="mm-meta">{w.channel && `#${w.channel} · `}{w.interval} мин
          {!grouped && !threadId && ` · BB: ${names.get(w.chat) ?? w.chat}`}
          {w.paused ? " · Завершено" : !w.schedule ? " · Без расписания" : ""}</span>
        {threadId && <span className="mm-meta">{w.destination === "shared" ? "Общий сабтред сводок" : "Этот чат"}</span>}
        {w.source_problem && <span role="alert">{w.source_problem}</span>}
        {w.push_problem && <span className="mm-meta">Push ожидает доставки</span>}
      </button>
      <button className="mm-icon" disabled={!!w.source_problem} title="Открыть в Mattermost" aria-label={`Открыть в Mattermost: ${title}`}
        onClick={() => { setError(""); setDetail(selected === "open" ? null : { kind: "open", id: w.id }); }}><Icon name="ExternalLink" className="mm-action-glyph" aria-hidden /></button>
      <button className="mm-icon" title="Настроить подписку" aria-label={`Настройки: ${title}`}
        onClick={() => setDetail(selected === "edit" ? null : { kind: "edit", id: w.id })}><Icon name="Settings" className="mm-action-glyph" aria-hidden /></button>
      <button type="button" className="mm-icon" title="Удалить подписку" aria-label={`Удалить подписку: ${title}`}
        onClick={() => setDetail({ kind: "remove", id: w.id })}><Icon name="Trash2" className="mm-action-glyph" aria-hidden /></button>
    </div>
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
  return <section className={threadId ? "mm-ui mm-widget" : "mm-ui mm-panel"}>
    <header>{threadId ? <button onClick={() => nav.toPluginPanel("subscriptions")}>Все подписки</button>
      : <><h2>Подписки Mattermost</h2><button aria-expanded={paletteOpen} onClick={() => setPaletteOpen(!paletteOpen)}>Цвета</button></>}
    </header>
    {query.error && <div role="alert">Ошибка загрузки подписок <button onClick={() => void query.refetch()}>Повторить</button></div>}
    <>
      {!threadId && <div className="mm-tabs"><button aria-pressed={!grouped} onClick={() => setGrouped(false)}>Список подписок</button>
        <button aria-pressed={grouped} onClick={() => setGrouped(true)}>По тредам BB</button></div>}
      {paletteOpen && <Palette colors={colors} />}
      {!rows.length && !query.error && <p>{query.isLoading ? "Загрузка…" : "Подписок пока нет. Отправьте в BB-тред ссылку Mattermost и напишите «следи»."}</p>}
      {grouped ? [...groups].map(([id, items]) => <details key={id} open><summary>{names.get(id) ?? id} · {items.length}</summary>{items.map(row)}</details>) : rows.map(row)}
    </>
  </section>;
}

const checkTime = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function ThreadSubscriptions({ threadId, info }: { threadId: string; info?: boolean }) {
  const query = useSubscriptions();
  if (!query.data) return null;
  const { watches, colors } = query.data;
  const rows = watches.filter(w => w.chat === threadId);
  if (!rows.length) return null;
  const links = <div className="mm-ui mm-context" aria-label="Подписки Mattermost этого треда">
    {rows.map(w => {
      const title = w.title || w.channel || w.url.split("/").pop();
      const issue = w.source_problem || (w.paused ? "Наблюдение завершено" : !w.schedule ? "Без расписания" : "");
      return <div key={w.id} className="mm-context-item">
        <div className="mm-context-title">
          <span aria-label={w.kind === "channel" ? "Канал" : "Ветка"}>{w.kind === "channel" ? "#" : "↳"}</span>
          <span className="mm-context-name" title={title}>{title}</span>
          {!w.source_problem && <a href={w.url} target="_blank" rel="noopener noreferrer" title="Открыть в Mattermost" aria-label={`Открыть в Mattermost: ${title}`}>
            <Icon name="ExternalLink" className="mm-action-glyph" aria-hidden />
          </a>}
        </div>
        <div className="mm-context-meta">
          <Marker status={w.status} colors={colors} />
          {w.last_checked_at === undefined ? <span>Время проверки пока неизвестно</span> :
            <time dateTime={new Date(w.last_checked_at * 1000).toISOString()}>Проверено {checkTime.format(w.last_checked_at * 1000)}</time>}
        </div>
        {issue && <small>{issue}</small>}
      </div>;
    })}
  </div>;
  return info ? <InfoSection label="Mattermost">{links}</InfoSection> : links;
}

function ThreadSection({ threadId, info }: { threadId: string; info?: boolean }) {
  const settings = useSettings();
  if (settings.isLoading || settings.values?.showThreadSubscriptions === false) return null;
  return <ThreadSubscriptions key={threadId} threadId={threadId} info={info} />;
}

function ConnectionSettings() {
  const rpc = useRpc<typeof contract>();
  const connection = experimental_useRpcQuery({ contract, method: "connection", input: null });
  const [editedUrl, setUrl] = useState<string | null>(null);
  const [cookie, setCookie] = useState("");
  const [pending, setPending] = useState<"save" | "test" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const url = editedUrl ?? connection.data?.url ?? "";
  const reuse = !!connection.data?.hasCookie && url.trim().replace(/\/+$/, "") === connection.data.url;
  async function submit(action: "save" | "test") {
    setPending(action);
    setError("");
    setMessage("");
    try {
      if (action === "test") {
        const result = await rpc.call("testConnection", { url, cookie });
        setMessage("Соединение установлено · @" + result.username);
      } else {
        const result = await rpc.call("saveConnection", { url, cookie });
        setUrl(result.url);
        setCookie("");
        await connection.refetch();
        setMessage("Подключение сохранено");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось выполнить запрос");
    } finally { setPending(null); }
  }
  if (connection.error && !connection.data) return <div role="alert">Не удалось загрузить настройки подключения. <button onClick={() => void connection.refetch()}>Повторить</button></div>;
  if (!connection.data) return <p>Загрузка настроек…</p>;
  return <form className="mm-ui mm-sheet" onSubmit={e => { e.preventDefault(); void submit("save"); }}>
    {connection.data.needsRepair && <p role="alert">Проверьте настройки подключения. Введите адрес сервера и cookie заново.</p>}
    <fieldset disabled={pending !== null} className="mm-fields">
      <label className="wide">Адрес сервера Mattermost<input type="url" required value={url} placeholder="https://mattermost.example.org"
        onChange={e => { setUrl(e.target.value); setMessage(""); setError(""); }} /></label>
      <label className="wide">Cookie<input type="password" autoComplete="new-password" spellCheck={false}
        placeholder={reuse ? "Сохранена · введите новую для замены" : "MMAUTHTOKEN=…"} value={cookie}
        onChange={e => { setCookie(e.target.value); setMessage(""); setError(""); }} /></label>
      <div className="mm-actions wide"><button type="submit" disabled={!url.trim() || (!cookie.trim() && !reuse)}>Сохранить</button>
        <button type="button" disabled={!url.trim() || (!cookie.trim() && !reuse)} onClick={() => void submit("test")}>
          {pending === "test" ? "Проверяем…" : "Проверить соединение"}</button></div>
    </fieldset>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </form>;
}

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
  const latest = data?.latest;
  function meta(s: Summary) {
    return <div className="mm-event-meta"><Marker status={s.status} colors={colors} />
      <span>{s.source} · {checkTime.format(s.created * 1000)}</span></div>;
  }
  return <section className="mm-ui mm-widget mm-inbox" aria-label="Сводки Mattermost">
    <header><div><strong>Mattermost</strong> {last > 0 && <small title="Последняя успешная проверка подписок треда">
      Проверено {checkTime.format(last * 1000)}</small>}{own.length === 1 && <small> · {own[0].interval} мин</small>}</div>
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
        <textarea aria-label="Черновик ответа" value={edits[detail.id] ?? detail.draft}
          onChange={e => setEdits({ ...edits, [detail.id]: e.target.value })} />
      </details>}
      <button onClick={() => setDetail(null)}>← Назад</button>
    </article> : page === "subscriptions" ? <Subscriptions threadId={threadId} /> : page === "history" ? <>
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
      {!data.rows.length && own.length === 1 && !own[0].source_problem &&
        <> · <a href={own[0].url} target="_blank" rel="noopener noreferrer">{own[0].title || "Открыть в Mattermost"} ↗</a></>}</small>}
  </section>;
}

function Widget() {
  const { scope } = useComposer();
  return scope.kind === "thread" ? <Inbox key={scope.threadId} threadId={scope.threadId} /> : null;
}
export default definePluginApp(app => {
  app.slots.settingsSection({ id: "connection", title: "Подключение к Mattermost", component: ConnectionSettings });
  app.slots.experimental_threadContextCardSection({
    id: "subscriptions", title: "Mattermost", group: "2_changes_mattermost", component: ThreadSection,
  });
  app.slots.experimental_threadInfoSection({
    id: "subscriptions", group: "2_changes_mattermost", component: props => <ThreadSection {...props} info />,
  });
  app.slots.messageDirective({ id: "mattermost-status", component: MessageStatus });
  app.slots.navPanel({ id: "subscriptions", path: "subscriptions", title: "Mattermost", icon: "MessageSquare", component: () => <Subscriptions /> });
  app.composer.customize({ id: "subscriptions", scopes: ["thread"], banners: [{ id: "watch", chrome: "bare", component: Widget }] });
});
