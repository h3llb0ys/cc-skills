import { useCallback, useEffect, useState, useId } from "react";
import { createPortal } from "react-dom";
import {
  definePluginApp,
  useRpc,
  useRealtime,
  useRealtimeConnectionState,
  experimental_useProviders,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useSidebarNavigation,
  experimental_useSidebarNavigationSplit,
  experimental_SidebarNavigationIcon as NavIcon,
  experimental_Icon as Icon,
  type ExperimentalSidebarNavigationItem,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import {
  optionsSchema,
  remaining,
  selectedWindows,
  visibleRows,
  type Options,
  type Row,
  type Snapshot,
} from "./model";
import "./app.css";
function useLimits() {
  const rpc = useRpc<typeof rpcContract>();
  const [options, setOptions] = useState<Options>(optionsSchema.parse({}));
  const [snapshot, setSnapshot] = useState<Snapshot>({
    rows: [],
    updatedAt: null,
    error: null,
  });
  const [error, setError] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const connection = useRealtimeConnectionState();
  const [revision, setRevision] = useState(0);
  useRealtime("options-changed", () => setRevision((n) => n + 1));
  useEffect(() => {
    let live = true;
    void rpc
      .call("options", null)
      .then((v) => {
        if (live) {
          setOptions(v);
          setLoaded(true);
          setOptionsError("");
        }
      })
      .catch(() => {
        if (live) setOptionsError("Не удалось загрузить настройки");
      });
    return () => {
      live = false;
    };
  }, [rpc, revision, connection]);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await rpc.call("snapshot", null);
        if (live) {
          setSnapshot(value);
          setError("");
        }
      } catch {
        if (live) setError("Нет связи с плагином");
      } finally {
        if (live)
          timer = setTimeout(poll, Math.min(options.refreshSeconds, 30) * 1000);
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [rpc, options.refreshSeconds, connection]);
  const save = useCallback(
    async (value: Options) => {
      await rpc.call("save", value);
      setOptions(value);
    },
    [rpc],
  );
  return { options, snapshot, error: optionsError || error, save, loaded };
}
const statusText: Record<Row["status"], string> = {
  ok: "Данные получены",
  error: "Провайдер не вернул лимиты",
  expired: "Вход истёк",
  unauthenticated: "Требуется вход",
  not_installed: "Не установлен",
};
function Ring({
  row,
  options,
  updatedAt,
  error,
}: {
  row: Row;
  options: Options;
  updatedAt: number | null;
  error: string | null;
}) {
  const { providers } = experimental_useProviders();
  const provider = providers.find((p) => p.id === row.id);
  const name = provider?.displayName ?? row.id;
  const windows = selectedWindows(row, options);
  const tooltipId = useId();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const values = windows.map((w) => remaining(w));
  const stale = Boolean(error) || values.some((v) => v === null);
  const label = `${name}: ${row.status === "ok" ? windows.map((w, i) => `${w.label}: ${values[i] === null ? "ожидаем обновления" : `${Math.round(values[i]!)}% осталось`}`).join(", ") : statusText[row.status]}`;
  return (
    <>
      <button
        className="pl-ring"
        style={{ width: options.iconSize, height: options.iconSize }}
        aria-label={label}
        aria-describedby={anchor ? tooltipId : undefined}
        onMouseEnter={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setAnchor(null)}
        onFocus={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
        onBlur={() => setAnchor(null)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setAnchor(null);
        }}
        onClick={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
      >
        <svg viewBox="0 0 48 48" aria-hidden="true">
          {(windows.length ? windows : [null]).map((w, i) => {
            const radius =
              21 - i * Math.min(4, 10 / Math.max(1, windows.length - 1));
            const value = w ? remaining(w) : null;
            const color =
              value === null
                ? "#888"
                : value <= 10
                  ? "#f87171"
                  : value <= 25
                    ? "#fbbf24"
                    : i === 0
                      ? "#a3b6c7"
                      : "#42c9b0";
            return (
              <g key={w?.label ?? "unknown"}>
                <circle
                  cx="24"
                  cy="24"
                  r={radius}
                  fill="none"
                  stroke="currentColor"
                  opacity=".16"
                  strokeWidth="2.5"
                />
                {value !== null && (
                  <circle
                    cx="24"
                    cy="24"
                    r={radius}
                    fill="none"
                    stroke={color}
                    opacity={stale ? 0.45 : 1}
                    strokeWidth="2.5"
                    pathLength="100"
                    strokeDasharray={`${value} 100`}
                    transform="rotate(-90 24 24)"
                    strokeLinecap="round"
                  />
                )}
              </g>
            );
          })}
        </svg>
        <ProviderIcon
          providerKind="agent"
          provider={provider ?? { id: row.id }}
          className="pl-provider-icon"
        />
        {(stale || row.status !== "ok") && (
          <span className="pl-warning">!</span>
        )}
      </button>
      {anchor &&
        createPortal(
          <div
            className="pl-tooltip"
            data-bb-plugin="provider-limits"
            role="tooltip"
            id={tooltipId}
            style={{
              left: anchor.right + 12,
              top: Math.max(8, Math.min(anchor.top, window.innerHeight - 260)),
            }}
          >
            <strong>{name}</strong>
            {row.plan && <span className="pl-muted">{row.plan}</span>}
            {windows.map((w, i) => (
              <div className="pl-window" key={w.label}>
                <b>{w.label}</b>
                <span>
                  {values[i] === null
                    ? "Ожидаем обновления после сброса"
                    : `Осталось ${Math.round(values[i]!)}% · использовано ${Math.round(w.usedPercent)}%`}
                </span>
                <span className="pl-muted">
                  Сброс:{" "}
                  {w.resetsAt
                    ? new Date(w.resetsAt).toLocaleString()
                    : "время не предоставлено"}
                </span>
              </div>
            ))}
            {row.status !== "ok" && <p>{statusText[row.status]}</p>}
            {error && <p>{error}</p>}
            <small className="pl-muted">
              Обновлено:{" "}
              {updatedAt
                ? new Date(updatedAt).toLocaleTimeString()
                : "ещё нет данных"}
            </small>
          </div>,
          document.body,
        )}
    </>
  );
}
function NavButton({ item }: { item: ExperimentalSidebarNavigationItem }) {
  const { actions, activeItemId, isShortcutModifierHeld } =
    experimental_useSidebarNavigation();
  const split = experimental_useSidebarNavigationSplit(item.id);
  const label = item.badge ? `${item.label}, ${item.badge.label}` : item.label;
  return (
    <button
      className="pl-nav-button"
      title={label}
      aria-label={label}
      aria-current={item.id === activeItemId ? "page" : undefined}
      disabled={item.isDisabled || item.isLoading}
      {...split.splitProps}
      onClick={(e) =>
        actions.activate(item.id, {
          target: e.metaKey || e.ctrlKey ? "split" : "current",
        })
      }
    >
      <NavIcon icon={item.icon} />
      {item.badge && <span className="pl-dot" />}
      {isShortcutModifierHeld && item.shortcut && (
        <small>{item.shortcut.label}</small>
      )}
    </button>
  );
}
function Header() {
  const { items } = experimental_useSidebarNavigation();
  const item = items.find((i) => i.id === "__bb__/new-thread");
  return item ? (
    <div className="pl-header" data-bb-plugin="provider-limits">
      <NavButton item={item} />
    </div>
  ) : null;
}
function Rail() {
  const { items, actions, isHomeActive } = experimental_useSidebarNavigation();
  const { options, snapshot, error } = useLimits();
  const [overflow, setOverflow] = useState(false);
  return (
    <div className="pl-rail" data-bb-plugin="provider-limits">
      <div className="pl-nav">
        <button
          className="pl-nav-button"
          title="Главная"
          aria-label="Главная"
          aria-current={isHomeActive ? "page" : undefined}
          onClick={() => actions.goHome()}
        >
          <Icon name="Home" />
        </button>
        {items
          .filter((i) => i.isVisible && i.id !== "__bb__/new-thread")
          .map((i) => (
            <NavButton key={i.id} item={i} />
          ))}
        <button
          className="pl-nav-button"
          title="Ещё"
          aria-label="Ещё"
          aria-expanded={overflow}
          onClick={() => setOverflow(!overflow)}
        >
          <Icon name="Ellipsis" />
        </button>
        {overflow && (
          <div className="pl-overflow">
            {items
              .filter((i) => !i.isVisible)
              .map((i) => (
                <NavButton key={i.id} item={i} />
              ))}
            <button
              className="pl-nav-button"
              title="Настроить навигацию"
              aria-label="Настроить навигацию"
              onClick={() => {
                setOverflow(false);
                actions.openCustomize();
              }}
            >
              <Icon name="SlidersHorizontal" />
            </button>
          </div>
        )}
      </div>
      <div className="pl-rings" aria-label="Лимиты провайдеров">
        {visibleRows(snapshot.rows, options).map((row) => (
          <Ring
            key={row.id}
            row={row}
            options={options}
            updatedAt={snapshot.updatedAt}
            error={error || snapshot.error}
          />
        ))}
        {(error || snapshot.error) && (
          <span className="pl-status" title={error || snapshot.error || ""}>
            !
          </span>
        )}
      </div>
    </div>
  );
}
function Settings() {
  const { options, snapshot, error, save, loaded } = useLimits();
  const [dirty, setDirty] = useState(false);
  const { providers } = experimental_useProviders();
  const [draft, setDraft] = useState(options);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(options);
  }, [options, dirty]);
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
          setDirty(false);
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
      <fieldset
        className="pl-settings-fields"
        disabled={!loaded || busy}
        onChange={() => {
          setDirty(true);
          setMessage("");
        }}
      >
        <p>
          Иконки находятся над настройками в левой панели. Если их нет: Settings
          → Appearance → Navigation → Provider Limits.
        </p>
        <label>
          Общий интервал обновления, минут{" "}
          <input
            type="number"
            min="0.5"
            step="0.5"
            max="1440"
            required
            value={draft.refreshSeconds / 60}
            onChange={(e) =>
              setDraft({
                ...draft,
                refreshSeconds: Number(e.target.value) * 60,
              })
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
            onChange={(e) =>
              setDraft({ ...draft, iconSize: Number(e.target.value) })
            }
          />
          <output>{draft.iconSize}</output>
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.onlyAuthenticated}
            onChange={(e) =>
              setDraft({ ...draft, onlyAuthenticated: e.target.checked })
            }
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
            setDraft({
              ...draft,
              providers: { ...draft.providers, [id]: value },
            });
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
                  : "BB не предоставил лимиты для этого провайдера"}
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
export default definePluginApp((app) => {
  app.slots.experimental_sidebarNavigation({
    id: "rail",
    title: "Provider Limits",
    description: "Навигация с остатками лимитов провайдеров",
    placement: "rail",
    component: Rail,
    headerComponent: Header,
  });
  app.slots.settingsSection({
    id: "limits",
    title: "Лимиты провайдеров",
    component: Settings,
  });
});
