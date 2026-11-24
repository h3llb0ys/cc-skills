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
