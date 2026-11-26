import { useState, useId } from "react";
import { createPortal } from "react-dom";
import { experimental_useProviders, experimental_ProviderIcon as ProviderIcon } from "@get-bb/plugin-sdk/app";
import { remaining, selectedWindows, statusText, type Options, type Row } from "../model";

export function Ring({
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
  const now = Date.now();
  const windows = selectedWindows(row, options).map((window) => ({
    ...window,
    value: remaining(window, now),
  }));
  const tooltipId = useId();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const stale = Boolean(error) || row.status === "error" ||
    windows.some(({ value }) => value === null);
  const summary = windows.map(({ label, value }) =>
    `${label}: ${value === null ? "ожидаем обновления" : `${Math.round(value)}% осталось`}`,
  );
  if (row.status !== "ok") summary.push(statusText[row.status]);
  const lastUpdate = row.observedAt ?? updatedAt;
  return (
    <>
      <button
        className="pl-ring"
        style={{ width: options.iconSize, height: options.iconSize }}
        aria-label={`${name}: ${summary.join(", ")}`}
        aria-describedby={anchor ? tooltipId : undefined}
        onMouseEnter={(e) => setAnchor(e.currentTarget.getBoundingClientRect())}
        onMouseLeave={(e) => {
          if (!(e.relatedTarget instanceof Node &&
              document.getElementById(tooltipId)?.contains(e.relatedTarget))) {
            setAnchor(null);
          }
        }}
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
            const value = w?.value ?? null;
            const color = value !== null && value <= 10 ? "#f87171"
              : value !== null && value <= 25 ? "#fbbf24"
              : i === 0 ? "#a3b6c7" : "#42c9b0";
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
            style={{ left: anchor.right }}
            onMouseLeave={() => setAnchor(null)}
            ref={(tooltip) => {
              if (tooltip) {
                const bottom = window.innerHeight - tooltip.offsetHeight - 8;
                tooltip.style.top = `${Math.max(8, Math.min(anchor.top, bottom))}px`;
              }
            }}
          >
            <strong>{name}</strong>
            {row.plan && <span className="pl-muted">{row.plan}</span>}
            {windows.map((w) => (
              <div className="pl-window" key={w.label}>
                <b>{w.label}</b>
                <span>
                  {w.value === null
                    ? "Ожидаем обновления после сброса"
                    : `Осталось ${Math.round(w.value)}% · использовано ${Math.round(w.usedPercent)}%`}
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
              {lastUpdate
                ? new Date(lastUpdate).toLocaleTimeString()
                : "ещё нет данных"}
            </small>
          </div>,
          document.body,
        )}
    </>
  );
}
