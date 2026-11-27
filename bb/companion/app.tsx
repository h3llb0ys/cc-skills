import { useState, type FormEvent } from "react";
import {
  definePluginApp, experimental_CollapsibleStackCard as StackCard,
  experimental_useRpcKeyedQuery as useBoardQuery, useComposer, useRpc,
} from "@get-bb/plugin-sdk/app";
import { z } from "zod";

import { action, contract } from "./contract";
import "./app.css";

const destinations = {
  rules: "Правила", knowledge: "Знания", task: "Задача", undecided: "Место уточним",
};
const plurals = new Intl.PluralRules("ru");
const words: Record<string, string> = { one: "предложение", few: "предложения", many: "предложений" };

function CompanionCard({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof contract>();
  const data = useBoardQuery({ contract, method: "board_get", keys: [threadId] }).data?.[threadId];
  const [selected, setSelected] = useState<string[] | null>(null);
  const [fold, setFold] = useState(0);
  const [adding, setAdding] = useState(false);
  const [idea, setIdea] = useState("");
  const [clearing, setClearing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const proposals = data?.proposals;
  const count = proposals?.length ?? 0;
  const applying = Boolean(data?.applying.length);
  const disabled = busy || applying;
  const currentSelection = (selected ?? data?.selected ?? []).filter(id => proposals?.some(p => p.id === id));

  if (!count || !proposals) return null;

  async function run(input: z.infer<typeof action>) {
    setBusy(true);
    setError(null);
    try {
      const next = await rpc.call("board_action", { threadId, action: input });
      if (input.kind === "add") {
        const added = next.proposals.find(p => !proposals?.some(q => q.id === p.id));
        if (added) setSelected([...currentSelection, added.id]);
        setIdea("");
        setAdding(false);
      }
      if (input.kind === "defer") {
        setSelected(next.selected);
        setFold(x => x + 1);
      }
      setClearing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить список.");
    } finally {
      setBusy(false);
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    if (!disabled && idea.trim()) void run({ kind: "add", text: idea.trim() });
  }

  return (
    <StackCard key={fold} label="Улучшения Companion"
      title={`Companion · ${count} ${words[plurals.select(count)] ?? "предложения"}`}
      icon="ListChecks" isActive={applying}>
      <div className="companion-board">
        {proposals.map(p => (
          <div className="companion-row" key={p.id}>
            <input type="checkbox" checked={currentSelection.includes(p.id)} disabled={disabled}
              aria-label={`Выбрать «${p.title}»`}
              onChange={e => {
                const checked = e.currentTarget.checked;
                setSelected(checked ? [...currentSelection, p.id] : currentSelection.filter(id => id !== p.id));
              }}/>
            <details>
              <summary>{p.title} <small>{destinations[p.destination]}</small></summary>
              <p>{p.description}</p>
            </details>
            <button type="button" disabled={disabled} aria-label={`Убрать «${p.title}»`}
              onClick={() => void run({ kind: "remove", id: p.id })}>×</button>
          </div>
        ))}
        {adding && (
          <form onSubmit={add} className="companion-actions">
            <input aria-label="Своё предложение" placeholder="Что стоит сохранить?" maxLength={280}
              autoFocus value={idea} onChange={event => setIdea(event.currentTarget.value)} disabled={disabled} />
            <button type="submit" disabled={disabled || !idea.trim()}>Добавить</button>
          </form>
        )}
        <div className="companion-actions">
          <button className="companion-primary" type="button" disabled={disabled || !currentSelection.length}
            onClick={() => void run({ kind: "apply", ids: currentSelection })}>
            {applying ? "Применяем…" : currentSelection.length ? `Применить · ${currentSelection.length}` : "Применить"}
          </button>
          <button type="button" disabled={disabled} aria-expanded={adding} onClick={() => setAdding(!adding)}>＋ Свой пункт</button>
          <button type="button" disabled={busy} onClick={() => void run({ kind: "defer", ids: currentSelection })}>Отложить</button>
          <button className="companion-clear" type="button" disabled={disabled} onClick={() => setClearing(true)}>Очистить</button>
        </div>
        {clearing && (
          <div className="companion-actions">
            <span>Убрать все оставшиеся предложения?</span>
            <button type="button" disabled={disabled} onClick={() => void run({ kind: "clear" })}>Убрать всё</button>
            <button type="button" onClick={() => setClearing(false)}>Отмена</button>
          </div>
        )}
        {(error || data?.error) && <p className="companion-error" role="status">{error || data?.error}</p>}
      </div>
    </StackCard>
  );
}

function Banner() {
  const { scope } = useComposer();
  return scope.kind === "thread" ? <CompanionCard key={scope.threadId} threadId={scope.threadId} /> : null;
}

export default definePluginApp(app => {
  app.composer.customize({
    id: "companion", scopes: ["thread"],
    banners: [{ id: "companion", chrome: "bare", component: Banner }],
  });
});
