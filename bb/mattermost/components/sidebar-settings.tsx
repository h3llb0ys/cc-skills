import { useState } from "react";
import { experimental_useRpcMutation } from "@get-bb/plugin-sdk/app";
import { contract, defaults } from "../contract";
import { useColors } from "../hooks/use-colors";
import { useHeaderMode } from "../hooks/use-header-mode";
import { headerModes, headerModeLabels } from "../settings";
import { SidebarBadges, type SidebarWatch } from "./sidebar-badges";

const examples: Record<string, SidebarWatch[]> = {
  "Ждут ответа": [
    { id: "qa", name: "#qna-team-promo", status: "answer", paused: false },
    { id: "release", name: "Ветка · Релиз", status: "attention", paused: false },
    { id: "team", name: "#promo-support", status: "normal", paused: false },
  ],
  "Всё спокойно": [{ id: "qa", name: "#qna-team-promo", status: "resolved", paused: false }],
  "Есть сбой": [{ id: "qa", name: "#qna-team-promo", status: "normal", paused: false, problem: "Сессия истекла" }],
  "Нет подписок": [],
};

export function SidebarSettings() {
  const query = useHeaderMode();
  const colors = useColors();
  const change = experimental_useRpcMutation({
    contract, method: "setHeaderMode",
    optimistic: (mode, cache) => cache.update("headerMode", null, () => mode),
  });
  const [scenario, setScenario] = useState("Ждут ответа");
  const mode = query.data;
  if (!mode) return query.error ? <p role="alert">Не удалось загрузить режим. <button onClick={() => void query.refetch()}>Повторить</button></p> : null;
  return <div className="mm-ui mm-sidebar-settings">
    <div className="mm-fields"><label>Рядом с названием треда
      <select value={mode} disabled={change.isPending} onChange={e => {
        const next = headerModes.find(key => key === e.target.value);
        if (next) void change.mutate(next).catch(() => { /* Displayed below via change.error. */ });
      }}>
        {headerModes.map(key => <option key={key} value={key}>{headerModeLabels[key]}</option>)}
      </select></label>
      <label>Сценарий для примера<select value={scenario} onChange={e => setScenario(e.target.value)}>
        {Object.keys(examples).map(name => <option key={name}>{name}</option>)}
      </select></label></div>
    <div className="mm-sidebar-preview" aria-label="Предпросмотр строки сайдбара"><strong>Вопросы команды промо</strong>
      <SidebarBadges key={mode + scenario} mode={mode} watches={examples[scenario]!} colors={colors.data ?? defaults} />
    </div>
    {change.error && <p role="alert">Не удалось сохранить режим. {change.error.message}</p>}
    {query.error && <p role="alert">Не удалось обновить режим. <button onClick={() => void query.refetch()}>Повторить</button></p>}
  </div>;
}
