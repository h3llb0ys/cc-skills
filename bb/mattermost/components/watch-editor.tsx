import { useState } from "react";
import { experimental_useSidebarThreads, useBbContext, useRpc } from "@get-bb/plugin-sdk/app";
import { contract, type Watch, type WatchSettings } from "../contract";

function localDate(seconds: number | null) {
  if (seconds === null) return "";
  const date = new Date(seconds * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function WatchEditor({ watch, threadId, close }: { watch?: Watch; threadId?: string; close(): void }) {
  const rpc = useRpc<typeof contract>();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { status, threads } = experimental_useSidebarThreads();
  const currentChat = watch?.chat || threadId;
  const context = useBbContext();
  const targets = threads.filter(t => !t.isArchived && !t.isHidden && t.environment?.id);
  const titleCounts = new Map<string, number>();
  for (const t of targets) titleCounts.set(t.displayTitle, (titleCounts.get(t.displayTitle) ?? 0) + 1);
  const [rule, setRule] = useState(watch?.rule ?? "Все новые сообщения");
  const presets = ["Все новые сообщения", "Ждут моего ответа", "Блокеры и решения"];
  return <form aria-label={watch ? "Настройки подписки" : "Новая подписка"} className="mm-sheet" onSubmit={async event => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const end = String(data.get("until"));
    setError("");
    setSaving(true);
    try {
      const settings: WatchSettings = { interval: Number(data.get("interval")), rule: String(data.get("rule")),
        destination: data.has("shared") ? "shared" : "chat",
        push: String(data.get("push")).trim() || null, draft: data.has("draft"),
        until: end ? Math.floor(new Date(end).getTime() / 1000) : null };
      const chat = String(data.get("chat") || "");
      if (watch) await rpc.call("edit", { ...settings, id: watch.id, ...(chat !== watch.chat && { chat }) });
      else await rpc.call("create", { ...settings, url: String(data.get("url")).trim(),
        chat, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      close();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setSaving(false); }
  }}>
    <fieldset disabled={saving} className="mm-fields">
      {!watch && <label className="wide">Ссылка на канал или ветку Mattermost<input name="url" type="url" required autoFocus /></label>}
      <label>Интервал, минуты<input name="interval" type="number" min="1" required defaultValue={watch?.interval ?? 10} /></label>
      <label>Следить до (местное время)<input type="datetime-local" name="until" defaultValue={localDate(watch?.until ?? null)} /></label>
      <label className="wide">Куда присылать<select name="chat" required
        defaultValue={currentChat || (targets.some(t => t.id === context.threadId) ? context.threadId! : "")}>
        {!currentChat && <option value="">Выбери тред BB</option>}
        {currentChat && !targets.some(t => t.id === currentChat) && <option value={currentChat}>{currentChat}</option>}
        {targets.map(t => <option key={t.id} value={t.id}>{t.displayTitle}{titleCounts.get(t.displayTitle)! > 1 && ` · ${t.environment?.name || t.projectId} · ${t.id}`}</option>)}
      </select></label>
      {status === "error" && <small className="wide" role="alert">Не удалось загрузить список тредов BB.</small>}
      {status === "loading" && <small className="wide" role="status">Загружаем треды BB…</small>}
      {status === "ready" && !targets.length && !currentChat && <small className="wide">Открой тред BB с рабочим окружением, чтобы получать сводки.</small>}
      <label className="mm-check wide"><input type="checkbox" name="shared" defaultChecked={watch?.destination === "shared"} />В общий сабтред сводок выбранного треда</label>
      <label className="wide">Когда сообщать<select value={presets.includes(rule) ? rule : "custom"}
        onChange={e => setRule(e.target.value === "custom" ? "" : e.target.value)}>
        {presets.map(p => <option key={p}>{p}</option>)}<option value="custom">Своё правило</option>
      </select></label>
      {presets.includes(rule) ? <input type="hidden" name="rule" value={rule} /> :
        <label className="wide">Полное правило<textarea required name="rule" value={rule} onChange={e => setRule(e.target.value)} /></label>}
      <label className="wide">Когда отправлять push<input name="push" placeholder="Выключен" defaultValue={watch?.push ?? ""} /></label>
      <label className="mm-check wide"><input type="checkbox" name="draft" defaultChecked={watch?.draft} />Добавлять черновик ответа</label>
    </fieldset>
    {saving && !watch && <p role="status">Читаем сообщения из Mattermost, затем включаем проверки в BB.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="mm-actions"><button disabled={saving || (!watch && !threadId && !targets.length)} type="submit">{saving ? (watch ? "Сохраняем…" : "Подключаем…") : watch ? "Сохранить" : "Создать подписку"}</button><button disabled={saving} type="button" onClick={close}>Отмена</button></div>
  </form>;
}
