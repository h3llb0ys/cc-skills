import { useState } from "react";
import { experimental_useProviders } from "@get-bb/plugin-sdk/app";
import { optionsSchema, statusText, type Options } from "../model";
import { useLimits } from "../hooks/use-limits";

export function Settings() {
  const { options, snapshot, error, save, loaded } = useLimits();
  const { providers } = experimental_useProviders();
  const [edits, setEdits] = useState<Options>();
  const draft = edits ?? options;
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  function edit(patch: Partial<Options>) {
    setEdits({ ...draft, ...patch });
    setMessage("");
  }
  const ids = [
    ...new Set([
      ...snapshot.rows.map((r) => r.id),
      ...providers.filter((p) => p.available).map((p) => p.id),
    ]),
  ];
  return (
    <form
      className="pl-settings"
      data-bb-plugin="provider-limits"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!loaded || busy) return;
        setBusy(true);
        try {
          await save(optionsSchema.parse(draft));
          setEdits(undefined);
          setMessage("Сохранено");
        } catch {
          setMessage(
            "Не удалось сохранить настройки. Проверьте значения и соединение.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset className="pl-settings-fields" disabled={!loaded || busy}>
        <p>
          Иконки находятся над настройками в левой панели. Если их нет: Settings
          → Appearance → Navigation → Provider Limits.
        </p>
        <label>
          Общий интервал обновления, минут{" "}
          <input
            type="number"
            min="0.5"
            step="any"
            max="1440"
            required
            value={draft.refreshSeconds / 60}
            onChange={(e) =>
              edit({ refreshSeconds: Math.round(Number(e.target.value) * 60) })
            }
          />
        </label>
        <label>
          Размер иконок с кольцами, px
          <input
            type="range"
            min="28"
            max="44"
            step="1"
            value={draft.iconSize}
            onChange={(e) => edit({ iconSize: Number(e.target.value) })}
          />
          <output>{draft.iconSize}</output>
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.onlyAuthenticated}
            onChange={(e) => edit({ onlyAuthenticated: e.target.checked })}
          />{" "}
          Только провайдеры с подтверждённым входом и доступными лимитами
        </label>
        <p className="pl-muted">
          У Claude внешнее кольцо — недельный лимит, внутреннее — текущая
          сессия, если выбраны оба периода. У остальных провайдеров порядок
          соответствует ответу BB. Кольца показывают остаток от 100% до 0%.
          Данные относятся к машине сервера BB.
        </p>
        {ids.map((id) => {
          const row = snapshot.rows.find((r) => r.id === id);
          const current = draft.providers[id] ?? {
            enabled: true,
            windows: null,
          };
          const update = (value: typeof current) =>
            edit({ providers: { ...draft.providers, [id]: value } });
          return (
            <fieldset key={id}>
              <legend>
                {providers.find((p) => p.id === id)?.displayName ?? id}
              </legend>
              <label>
                <input
                  type="checkbox"
                  checked={current.enabled}
                  onChange={(e) =>
                    update({ ...current, enabled: e.target.checked })
                  }
                />{" "}
                Показывать провайдера
              </label>
              <p className="pl-muted">
                {row
                  ? statusText[row.status]
                  : "Лимиты для этого провайдера недоступны"}
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={current.windows === null}
                  onChange={(e) =>
                    update({
                      ...current,
                      windows: e.target.checked
                        ? null
                        : (row?.windows.map((w) => w.label) ?? []),
                    })
                  }
                />{" "}
                Все периоды автоматически
              </label>
              {row?.windows.map((w) => (
                <label key={w.label}>
                  <input
                    type="checkbox"
                    checked={
                      current.windows === null ||
                      current.windows.includes(w.label)
                    }
                    onChange={(e) => {
                      const labels =
                        current.windows ?? row.windows.map((w) => w.label);
                      update({
                        ...current,
                        windows: e.target.checked
                          ? [...labels, w.label]
                          : labels.filter((l) => l !== w.label),
                      });
                    }}
                  />
                  {w.label}
                </label>
              ))}
            </fieldset>
          );
        })}
        <button type="submit" disabled={busy}>
          {busy ? "Сохранение…" : "Сохранить"}
        </button>
      </fieldset>
      <span role="status">{!loaded ? "Загрузка настроек…" : message}</span>
      {(error || snapshot.error) && (
        <p role="alert">{error || snapshot.error}</p>
      )}
    </form>
  );
}
