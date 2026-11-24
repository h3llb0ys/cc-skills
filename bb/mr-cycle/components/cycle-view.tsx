import { type CSSProperties } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";

import { STAGES, SUBSTEPS, progress, type Cycle, type Stage } from "../model";
import { useCompactView } from "../hooks/use-compact-view";

// Theme tokens from violet to orange, so custom themes recolor the cycle.
const PALETTE = ["--pr-merged", "--file-accent", "--success", "--attention", "--warning"];

export function stageColor(index: number): string {
  const position = (index / (STAGES.length - 1)) * (PALETTE.length - 1);
  const from = Math.floor(position);
  const to = Math.min(from + 1, PALETTE.length - 1);
  const weight = Math.round((1 - (position - from)) * 100);

  return `color-mix(in oklch, var(${PALETTE[from]}) ${weight}%, var(${PALETTE[to]}))`;
}

export function percent(cycle: Cycle): number {
  const { done, total } = progress(cycle);

  return Math.round((done / total) * 100);
}

export function heading(cycle: Cycle): string {
  return cycle.title === undefined ? "MR cycle" : `MR cycle · ${cycle.title}`;
}

export function caption(cycle: Cycle): string {
  const { done, total, current, complete } = progress(cycle);
  if (complete || current === null) return "цикл завершён · ничего не закоммичено";

  return `${done}/${total} · этап ${current}: ${STAGES[current]}`;
}

function summaryLine(cycle: Cycle): string {
  return `${cycle.iteration > 1 ? `итерация ${cycle.iteration} · ` : ""}${caption(cycle)}`;
}

function percentGradient(cycle: Cycle): CSSProperties {
  const { current } = progress(cycle);

  return { backgroundImage: `linear-gradient(90deg, ${stageColor(0)}, ${stageColor(current ?? STAGES.length - 1)})` };
}

function ProgressBar({ cycle, thin = false }: { cycle: Cycle; thin?: boolean }) {
  return (
    <div className={`flex ${thin ? "h-1.5 gap-0.5" : "h-2.5 gap-[3px]"}`} role="presentation">
      {cycle.stages.map((stage, i) => (
        <span
          key={i}
          className={`flex-1 rounded-sm transition-colors duration-500 ${stage.status === "running" ? "animate-pulse" : ""}`}
          style={{ background: stage.status === "pending" ? "var(--muted)" : stageColor(i) }}
        />
      ))}
    </div>
  );
}

function StageBox({ stage, index }: { stage: Stage; index: number }) {
  const color = stageColor(index);
  if (stage.status === "running") {
    return (
      <span
        className="size-4 animate-spin rounded-full border-[1.5px]"
        style={{ borderColor: color, borderTopColor: "transparent" }}
      />
    );
  }
  if (stage.status === "pending") return <span className="size-4 rounded border-[1.5px] border-border" />;

  return (
    <span className="grid size-4 place-items-center rounded text-xs font-bold text-background" style={{ background: color }}>
      {stage.status === "done" ? <Icon name="Check" className="size-3" /> : "–"}
    </span>
  );
}

function Substeps({ stage, index }: { stage: Stage; index: number }) {
  const substeps = SUBSTEPS[index];
  if (substeps === undefined || stage.status === "pending") return null;

  return (
    <div className="col-start-3 col-end-5 flex gap-2.5 text-xs text-muted-foreground">
      {substeps.map(({ key, label }) => {
        const done = stage.status === "done" || stage.substeps.includes(key);

        return (
          <span key={key} className={done ? "text-foreground" : ""}>
            {done ? "☑" : "☐"} {label}
          </span>
        );
      })}
    </div>
  );
}

function StageRow({ stage, index }: { stage: Stage; index: number }) {
  const muted = stage.status === "pending" || stage.status === "skipped";

  return (
    <li
      className={`grid grid-cols-[16px_16px_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 rounded-md px-1.5 py-1 text-[13px] ${
        stage.status === "running" ? "bg-muted/60" : ""
      }`}
    >
      <span className="font-mono text-[11px] text-muted-foreground">{index}</span>
      <StageBox stage={stage} index={index} />
      <span className={`max-w-[11.5rem] truncate whitespace-nowrap ${muted ? "text-muted-foreground" : ""}`}>
        {STAGES[index]}
        {stage.runs > 1 ? (
          <span className="ml-1.5 rounded bg-muted px-1 text-[10px] text-muted-foreground" title={`повторов: ${stage.runs - 1}`}>
            ↺ {stage.runs - 1}
          </span>
        ) : null}
      </span>
      <span className="min-w-0 truncate text-right text-xs text-muted-foreground" title={stage.note}>
        {stage.note}
      </span>
      <Substeps stage={stage} index={index} />
    </li>
  );
}

function Checks({ cycle }: { cycle: Cycle }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
      {Object.entries(cycle.checks).map(([name, status]) => (
        <span
          key={name}
          className={`rounded px-2 py-0.5 font-mono text-[11px] ${
            status === "ok" ? "bg-muted text-foreground" : "bg-destructive/15 text-destructive"
          }`}
        >
          {status === "ok" ? "✓" : "✗"} {name}
        </span>
      ))}
      <span className="ml-auto text-[11px] text-muted-foreground">🔒 не закоммичено</span>
    </div>
  );
}

function CheckDots({ cycle }: { cycle: Cycle }) {
  const checks = Object.entries(cycle.checks);
  if (checks.length === 0) return null;
  const label = checks.map(([name, status]) => `${name} ${status}`).join(" · ");

  return (
    <span className="flex shrink-0 gap-1" role="img" aria-label={label} title={label}>
      {checks.map(([name, status]) => (
        <span
          key={name}
          className="size-1.5 rounded-full"
          style={{ background: status === "ok" ? "var(--success)" : "var(--destructive)" }}
        />
      ))}
    </span>
  );
}

function Header({ cycle, compact, onToggle }: { cycle: Cycle; compact: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
      <span className="min-w-0 flex-1 truncate" title={cycle.title}>
        {cycle.title}
      </span>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!compact}
        aria-label={compact ? "Развернуть MR cycle" : "Свернуть MR cycle"}
        title={compact ? "Развернуть" : "Свернуть"}
        className="grid size-5 shrink-0 place-items-center rounded hover:bg-muted hover:text-foreground"
      >
        {compact ? "▸" : "▾"}
      </button>
    </div>
  );
}

function Percent({ cycle, className }: { cycle: Cycle; className: string }) {
  return (
    <span className={`bg-clip-text font-bold tracking-tight text-transparent ${className}`} style={percentGradient(cycle)}>
      {percent(cycle)}%
    </span>
  );
}

function CompactBody({ cycle }: { cycle: Cycle }) {
  return (
    <>
      <div className="mt-0.5 flex items-center gap-2">
        <Percent cycle={cycle} className="text-lg" />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summaryLine(cycle)}</span>
        <CheckDots cycle={cycle} />
      </div>
      <div className="mt-1.5">
        <ProgressBar cycle={cycle} thin />
      </div>
    </>
  );
}

function FullBody({ cycle }: { cycle: Cycle }) {
  return (
    <>
      <div className="mb-2 flex items-baseline gap-2.5">
        <Percent cycle={cycle} className="text-3xl" />
        <span className="min-w-0 truncate text-xs text-muted-foreground">{summaryLine(cycle)}</span>
      </div>
      <ProgressBar cycle={cycle} />
      <ol className="mt-3">
        {cycle.stages.map((stage, i) => (
          <StageRow key={i} stage={stage} index={i} />
        ))}
      </ol>
      <Checks cycle={cycle} />
    </>
  );
}

export function CycleView({ cycle }: { cycle: Cycle }) {
  const [compact, toggle] = useCompactView();

  return (
    <div className="text-foreground">
      <Header cycle={cycle} compact={compact} onToggle={toggle} />
      {compact ? <CompactBody cycle={cycle} /> : <FullBody cycle={cycle} />}
    </div>
  );
}

export function ProgressRing({ cycle }: { cycle: Cycle }) {
  const { current, complete } = progress(cycle);
  const color = complete ? "var(--success)" : stageColor(current ?? 0);

  return (
    <span
      className="inline-block size-3 shrink-0 rounded-full"
      style={{
        background: `conic-gradient(${color} ${percent(cycle) * 3.6}deg, var(--muted) 0)`,
        mask: "radial-gradient(circle, transparent 3px, #000 3.5px)",
      }}
    />
  );
}
