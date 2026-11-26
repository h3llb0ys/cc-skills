import { experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { contract, defaults, type Watch } from "../contract";
import { useColors } from "../hooks/use-colors";
import { listLayouts, listLayoutLabels } from "../settings";
import { SidebarWatchList, useListLayout } from "./panel-sidebar";

const sample: Watch = { id: "question", chat: "qa", owner: "demo", url: "https://mattermost.example/team/pl/question",
  title: "Авторизация GET /api/v1/offers", kind: "thread", status: "answer", paused: false, draft: true, rule: "",
  last_checked_at: 1795692900, interval: 5, schedule: null, until: null, timezone: "UTC", push: null };
const examples: Watch[] = [sample,
  { ...sample, id: "channel", title: "qna-team-promo-prgrow", kind: "channel", status: "normal" },
  { ...sample, id: "release", chat: "duty", title: "Релиз промокодов", status: "attention" },
  { ...sample, id: "support", chat: "duty", title: "promo-support", kind: "channel", suspended: true }];
const names = new Map([["qa", "Вопросы-ответы"], ["duty", "Дежурство промо"]]);

export function ListLayoutSettings() {
  const mode = useListLayout();
  const colors = useColors();
  const change = experimental_useRpcMutation({ contract, method: "setListLayout",
    optimistic: (layout, cache) => cache.update("listLayout", null, () => layout) });
  if (!mode.data) return mode.error ? <p role="alert">Не удалось загрузить настройку. <button onClick={() => void mode.refetch()}>Повторить</button></p> : null;
  return <section className="mm-ui">
    <p>Вид левой панели при открытом Mattermost.</p>
    <div className="mm-tabs" role="group" aria-label="Вид списка подписок">
      {listLayouts.map(layout => <button type="button" key={layout} aria-pressed={mode.data === layout} disabled={change.isPending}
        onClick={() => { void change.mutate(layout).catch(() => { /* Shown below. */ }); }}>{listLayoutLabels[layout]}</button>)}
    </div>
    <div className="mm-list-preview" aria-label="Предпросмотр списка подписок">
      <SidebarWatchList layout={mode.data} watches={examples} names={names} colors={colors.data ?? defaults} />
    </div>
    {change.error && <p role="alert">Не удалось сохранить вид списка. {change.error.message}</p>}
  </section>;
}
