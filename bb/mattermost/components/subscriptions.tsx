import * as Menu from "@radix-ui/react-dropdown-menu";
import type { WidgetLayout } from "../settings";
import { CompactLine, WidgetRows } from "./widget-layout";
import { groupWatches } from "../group-watches";
import { useAsyncAction } from "../hooks/use-async-action";
import { useEffect, useState } from "react";
import { experimental_useSidebarThreads, experimental_Icon as Icon, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { contract, defaults, type Watch } from "../contract";
import { WatchAction } from "./watch-action";
import { WatchEditor } from "./watch-editor";
import { OpenSource } from "./open-source";
import { WatchResult } from "./check-watch";
import { PauseWatch } from "./pause-watch";
import { WatchMarker } from "./status";
import type { useSubscriptions } from "../hooks/use-subscriptions";

type Detail = { kind: "edit" | "remove"; id: string } | { kind: "create"; id?: never } | null;

function RemoveWatch({ watch, cancel, removed }: { watch: Watch; cancel(): void; removed(): void }) {
  const rpc = useRpc<typeof contract>();
  const { run: remove, busy: pending, error } = useAsyncAction(async () => {
    await rpc.call("unwatch", { id: watch.id });
    removed();
  });
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
  const { run: activate, busy, error } = useAsyncAction(async () => {
    await rpc.call("finishSetup", { id: watch.id, chat: watch.chat });
    await refresh();
  });
  return <div className="mm-actions">
    <button disabled={busy} onClick={() => void activate()}>{busy ? "Включаем…" : "Включить расписание"}</button>
    {error && <span role="alert">{error}</span>}
  </div>;
}

export function SubscriptionList({ query, threadId, layout, grouped = false }: { query: ReturnType<typeof useSubscriptions>; threadId?: string; grouped?: boolean; layout?: WidgetLayout }) {
  const nav = useBbNavigate();
  const { threads } = experimental_useSidebarThreads();
  const [detail, setDetail] = useState<Detail>(null);
  const creating = detail?.kind === "create";
  const rows = (query.data?.watches ?? []).filter(w => !threadId || w.chat === threadId);
  const colors = query.data?.colors ?? defaults;
  const names = new Map(threads.map(t => [t.id, t.displayTitle]));

  function row(w: Watch) {
    return <WatchRow key={w.id} w={w} detail={detail} setDetail={setDetail} threadId={threadId}
      layout={layout} grouped={grouped} names={names} colors={colors} refresh={query.refetch} />;
  }
  return <section className="mm-ui">
    <header className="mm-create-bar">
      {threadId && <button className="mm-all-watches" onClick={() => nav.toPluginPanel("subscriptions", { subPath: "list" })}>Все подписки</button>}
      <button type="button" className="mm-icon" aria-label="Добавить подписку" title="Добавить подписку"
        aria-expanded={creating} disabled={creating} onClick={() => setDetail({ kind: "create" })}>
        <Icon name="Plus" className="mm-action-glyph" aria-hidden />
      </button>
    </header>
    {creating && <WatchEditor threadId={threadId} close={() => { setDetail(null); void query.refetch(); }} />}
    {query.error && <div role="alert">Ошибка загрузки подписок <button onClick={() => void query.refetch()}>Повторить</button></div>}
    {!rows.length && !creating && !query.error && <p>{query.isLoading ? "Загрузка…" : "Подписок пока нет. Нажми «+», чтобы добавить канал или ветку."}</p>}
    {layout ? <WidgetRows rows={rows} layout={layout} row={row} /> : grouped ? [...groupWatches(rows)].map(([id, items]) => <details key={id} open><summary>{names.get(id) ?? id} · {items.length}</summary>{items.map(row)}</details>) : rows.map(row)}
  </section>;
}


function WatchRow({ layout, w, detail, setDetail, colors, threadId, grouped, names, refresh }: {
  layout?: WidgetLayout; w: Watch; detail: Detail; setDetail(value: Detail): void; colors: Record<keyof typeof defaults, string | null>;
  threadId?: string; grouped: boolean; names: Map<string, string>; refresh(): Promise<unknown>;
}) {
  const rpc = useRpc<typeof contract>();
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 5000);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  const check = useAsyncAction(async () => {
    setFeedback("");
    try {
      const result = await rpc.call("check", { id: w.id });
      await refresh();
      const outcomes = { busy: "Проверка уже идёт", reviewing: "Идёт разбор", quiet: "Изменений нет" };
      setFeedback(result.outcome === "failed" ? result.problem || "Проверка не удалась" : outcomes[result.outcome]);
    } catch (err) { setFeedback(String(err)); }
  });
  const checkStatus = check.busy ? "Проверяем…" : feedback;
  const title = w.title || w.url.split("/").pop();
  const selected = detail?.id === w.id ? detail.kind : null;
  const edit = () => setDetail({ kind: "edit", id: w.id });
  return <div className={layout ? "mm-compact" : "mm-item"} data-suspended={!!w.suspended && !w.paused} key={w.id}>{layout ? <CompactLine w={w} layout={layout} colors={colors} feedback={checkStatus}
    title={<WatchAction watch={w} className="mm-main mm-compact-name" onEdit={edit}><span title={title}>{title}</span></WatchAction>}
    actions={<><PauseWatch watch={w} name={title || w.url} /><OpenSource watch={w} />
      <Menu.Root modal={false}><Menu.Trigger asChild><button className="mm-more" aria-label={"Действия: " + title}>···</button></Menu.Trigger>
        <Menu.Portal><Menu.Content className="mm-open-menu mm-actions-menu" align="end" sideOffset={4}>
          <Menu.Item disabled={check.busy || w.paused || w.suspended} onSelect={() => void check.run()}>Проверить сейчас</Menu.Item>
          <Menu.Item onSelect={edit}>Настроить подписку</Menu.Item>
          <Menu.Item onSelect={() => setDetail({ kind: "remove", id: w.id })}>Удалить подписку</Menu.Item>
        </Menu.Content></Menu.Portal></Menu.Root></>} /> : <><div className="mm-line">
    <WatchAction watch={w} className="mm-main" onEdit={() => setDetail({ kind: "edit", id: w.id })}>
      <span className="mm-title"><strong title={title}>{title}</strong><small>{w.kind === "channel" ? "Канал" : "Ветка"}</small>
        {!w.suspended && <WatchMarker watch={w} colors={colors} />}</span>
      <span className="mm-meta">{w.channel && (w.kind !== "channel" || title !== w.channel) && `#${w.channel} · `}{w.interval} мин
        {!grouped && !threadId && ` · BB: ${names.get(w.chat) ?? w.chat}`}</span>
      {threadId && <span className="mm-meta">{w.destination === "shared" ? "Общий сабтред сводок" : "Этот чат"}</span>}
      {!w.suspended && w.push_problem && <span className="mm-meta">Push ожидает доставки</span>}
    </WatchAction>
    <button type="button" className="mm-icon" title="Проверить сейчас" aria-label={`Проверить сейчас: ${title}`}
      disabled={check.busy || w.suspended || w.paused} onClick={() => void check.run()}>
      <Icon name="RefreshCw" aria-hidden /></button>
    <PauseWatch watch={w} name={title || w.url} />
    <OpenSource watch={w} />
    <button className="mm-icon" title="Настроить подписку" aria-label={`Настройки: ${title}`}
      onClick={() => setDetail(selected === "edit" ? null : { kind: "edit", id: w.id })}>
      <svg viewBox="0 0 24 24" className="mm-action-glyph" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden="true">
        <path d="M3 7h18M3 17h18" />
        <circle cx="9" cy="7" r="2.5" /><circle cx="15" cy="17" r="2.5" />
      </svg>
    </button>
    <button type="button" className="mm-icon" title="Удалить подписку" aria-label={`Удалить подписку: ${title}`}
      onClick={() => setDetail({ kind: "remove", id: w.id })}><Icon name="Trash2" className="mm-action-glyph" aria-hidden /></button>
  </div>
    <WatchResult key={w.chat} watch={w} feedback={checkStatus} /></>}
    {w.setup_pending && !w.paused && <FinishSetup watch={w} refresh={refresh} />}
    {selected === "remove" && <RemoveWatch watch={w} cancel={() => setDetail(null)}
      removed={() => { setDetail(null); void refresh(); }} />}
    {selected === "edit" && w.paused && <p>Наблюдение завершено · {w.rule}</p>}
    {selected === "edit" && !w.paused && <WatchEditor watch={w} close={() => { setDetail(null); void refresh(); }} />}
  </div>;
}
