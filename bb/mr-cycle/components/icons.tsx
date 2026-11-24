export const CYCLE_ICON = "mr-cycle/checklist";

export function ChecklistIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="m3 6 2 2 3-3M3 13l2 2 3-3M12 6h9M12 13h9M12 20h9M4 20h3" strokeLinejoin="round" />
    </svg>
  );
}
