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
  const { threads } = experimental_useSidebarThreads();
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
    setSaving(true);
    try {
      const settings: WatchSettings = { interval: Number(data.get("interval")), rule: String(data.get("rule")),
        destination: data.get("destination") === "shared" ? "shared" : "chat",
        push: String(data.get("push")).trim() || null, draft: data.has("draft"),
        until: end ? Math.floor(new Date(end).getTime() / 1000) : null };
      if (watch) await rpc.call("edit", { ...settings, id: watch.id });
      else await rpc.call("create", { ...settings, url: String(data.get("url")).trim(),
        chat: threadId || String(data.get("chat")), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      close();
    } catch (cause) { setError(String(cause)); } finally { setSaving(false); }
  }}>
    <fieldset disabled={saving} className="mm-fields">
      {!watch && <>
        <label className="wide">Ссылка на канал или ветку Mattermost<input name="url" type="url" required autoFocus /></label>
        {!threadId && <label className="wide">Тред BB<select required name="chat"
          defaultValue={targets.some(t => t.id === context.threadId) ? context.threadId! : ""}>
          <option value="">Выбери тред</option>
          {targets.map(t => <option key={t.id} value={t.id}>{t.displayTitle}{titleCounts.get(t.displayTitle)! > 1 && ` · ${t.environment?.name || t.projectId} · ${t.id}`}</option>)}
        </select>{!targets.length && <small>Открой тред BB с рабочим окружением, чтобы получать сводки.</small>}</label>}
      </>}
      <label>Интервал, минуты<input name="interval" type="number" min="1" required defaultValue={watch?.interval ?? 10} /></label>
      <label>Следить до (местное время)<input type="datetime-local" name="until" defaultValue={localDate(watch?.until ?? null)} /></label>
      <label className="wide">Куда присылать<select name="destination" defaultValue={watch?.destination ?? "chat"}>
        <option value="chat">Этот чат</option><option value="shared">Общий сабтред сводок</option>
      </select></label>
      <label className="wide">Когда сообщать<select value={presets.includes(rule) ? rule : "custom"}
        onChange={e => setRule(e.target.value === "custom" ? "" : e.target.value)}>
        {presets.map(p => <option key={p}>{p}</option>)}<option value="custom">Своё правило</option>
      </select></label>
      {presets.includes(rule) ? <input type="hidden" name="rule" value={rule} /> :
        <label className="wide">Полное правило<textarea required name="rule" value={rule} onChange={e => setRule(e.target.value)} /></label>}
      <label className="wide">Когда отправлять push<input name="push" placeholder="Выключен" defaultValue={watch?.push ?? ""} /></label>
      <label className="mm-check wide"><input type="checkbox" name="draft" defaultChecked={watch?.draft} />Добавлять черновик ответа</label>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <div className="mm-actions"><button disabled={saving || (!watch && !threadId && !targets.length)} type="submit">{saving ? "Сохраняем…" : watch ? "Сохранить" : "Создать подписку"}</button><button disabled={saving} type="button" onClick={close}>Отмена</button></div>
  </form>;
}
