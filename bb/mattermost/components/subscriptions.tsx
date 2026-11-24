import { useState } from "react";
import { experimental_useSidebarThreads, experimental_Icon as Icon, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { ColorPalette } from "../../shared-ui/color-palette";
import { contract, defaults, labels, type Signal, type Watch } from "../contract";
import { type Colors, Marker } from "./status";
import { useSubscriptions } from "../hooks/use-subscriptions";

type Detail = { kind: "edit" | "open" | "remove"; id: string } | null;

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

export function Subscriptions({ threadId }: { threadId?: string }) {
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
