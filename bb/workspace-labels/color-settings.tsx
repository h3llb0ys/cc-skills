import { experimental_useRpcQuery, useRpc } from '@get-bb/plugin-sdk/app';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { colorsRpc, defaultColors, palette, type WorkspaceColors } from './colors';

export function useWorkspaceColors() {
  return experimental_useRpcQuery({ contract: colorsRpc, method: 'labelColors', input: null });
}

function Palette({ title, color, pending, onChange }: {
  title: string;
  color: string | null;
  pending: boolean;
  onChange: (color: string | null) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const pickerColor = color ?? '#808080';
  useEffect(() => {
    const input = picker.current;
    if (!input) return;
    // The native change event fires when the picker commits the color.
    const commit = () => onChange(input.value);
    input.addEventListener('change', commit);
    return () => input.removeEventListener('change', commit);
  }, [onChange]);
  useEffect(() => {
    if (picker.current) picker.current.value = pickerColor;
  }, [pickerColor]);

  return <fieldset className="workspace-colors" disabled={pending} aria-busy={pending}>
    <legend>{title}</legend>
    <div className="workspace-color-options">
      <button className="workspace-color-button" type="button" aria-pressed={color === null}
        onClick={() => onChange(null)}>По умолчанию</button>
      {palette.map(swatch => (
        <button key={swatch} className="workspace-color-swatch" type="button"
          aria-label={swatch} aria-pressed={color?.toLowerCase() === swatch}
          style={{ backgroundColor: swatch }} onClick={() => onChange(swatch)}/>
      ))}
      <label className="workspace-color-button">
        <input type="color" aria-label={`Свой цвет для подписи «${title}»`} defaultValue={pickerColor} ref={picker}/>
        Свой
      </label>
    </div>
  </fieldset>;
}

function ColorEditor({ saved, refetch, preview }: {
  saved: WorkspaceColors;
  refetch: () => Promise<void>;
  preview: (colors: WorkspaceColors) => ReactNode;
}) {
  const { call } = useRpc<typeof colorsRpc>();
  const [pending, setPending] = useState<Partial<WorkspaceColors>>({});
  const colors = { ...saved, ...pending };
  const [error, setError] = useState('');

  async function save(kind: keyof WorkspaceColors, color: string | null) {
    if (pending[kind] !== undefined || color === saved[kind]) return;
    setPending(current => ({ ...current, [kind]: color }));
    setError('');
    try {
      await call('saveLabelColors', { [kind]: color });
      await refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(current => {
        const next = { ...current };
        delete next[kind];
        return next;
      });
    }
  }

  return <>
    <div className="workspace-color-fields">
      <Palette title="Worktree" color={colors.worktree} pending={pending.worktree !== undefined}
        onChange={value => void save('worktree', value)}/>
      <Palette title="Ветка" color={colors.branch} pending={pending.branch !== undefined}
        onChange={value => void save('branch', value)}/>
      {error && <p role="alert">Не удалось сохранить цвета. {error}</p>}
    </div>
    {preview(colors)}
  </>;
}

export function WorkspaceColorSettings({ preview }: { preview: (colors: WorkspaceColors) => ReactNode }) {
  const query = useWorkspaceColors();
  if (query.error) {
    return <><p role="alert">Не удалось загрузить цвета. <button type="button" onClick={() => void query.refetch()}>Повторить</button></p>
      {preview(query.data ?? defaultColors)}</>;
  }
  if (!query.data) return <>{preview(defaultColors)}</>;
  return <ColorEditor saved={query.data} refetch={query.refetch} preview={preview}/>;
}
