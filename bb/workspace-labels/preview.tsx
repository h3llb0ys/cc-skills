import { useLayoutEffect, useRef, useState } from 'react';
import { fitsInline } from './adaptive';
import type { Environment, Layout } from './labels';
import { WorkspaceMetadata } from './metadata';

type Example = { title: string; environment: Environment; tasks: string[] };
const examples: Example[] = [
  { title: 'Обновить каталог', environment: { path: '/projects/catalog', name: null, branchName: 'main', isWorktree: false }, tasks: [] },
  { title: 'Проверить скидки', environment: { path: '/worktrees/discount-rules', name: null, branchName: 'feature/discount-rules', isWorktree: true }, tasks: ['DEMO-42', 'DEMO-57'] },
  { title: 'Проверить карточку товара', environment: { path: '/projects/catalog', name: null, branchName: 'feature/product-card', isWorktree: false }, tasks: ['DEMO-81'] },
];

function ExampleContents({ example, layout }: { example: Example; layout: Layout }) {
  const { title, environment, tasks } = example;
  const taskBadges = tasks.map(task => <span key={task} className="workspace-preview-task">{task}</span>);
  return <>
    <span className="workspace-preview-title-line">
      <svg className="workspace-preview-thread-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M20 11.5a8 8 0 0 1-8 8H4l1.6-3.2A8 8 0 1 1 20 11.5Z"/><path d="M8 9h8M8 13h5"/></svg>
      <span className="workspace-preview-title">{title}</span>
      {tasks.length === 1 && <span className="workspace-preview-tasks">{taskBadges}</span>}
    </span>
    {tasks.length > 1 && <span className="workspace-preview-tasks workspace-preview-many">{taskBadges}</span>}
    <span className="workspace-preview-metadata"><WorkspaceMetadata environment={environment} layout={layout} autoInline={false}
      status={{ outcome: 'available', workspace: { branch: { currentBranch: environment.branchName }, checkout: { kind: 'branch' } } }}/></span>
  </>;
}

function ExampleRow({ example, layout, autoInline }: { example: Example; layout: Layout; autoInline: boolean }) {
  const row = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [inline, setInline] = useState(false);
  useLayoutEffect(() => {
    const container = row.current!;
    const natural = measure.current!;
    const update = () => setInline(autoInline && !(layout === 'details' && example.environment.isWorktree) &&
      fitsInline(container.clientWidth, natural.getBoundingClientRect().width));
    const observer = new ResizeObserver(update);
    observer.observe(container);
    observer.observe(natural);
    update();
    return () => observer.disconnect();
  }, [autoInline, layout, example]);
  return <div className="workspace-preview-example">
    <div ref={measure} className="workspace-preview-row workspace-preview-inline workspace-preview-measure" aria-hidden="true">
      <ExampleContents example={example} layout={layout}/>
    </div>
    <div ref={row} className={`workspace-preview-row${inline ? ' workspace-preview-inline' : ''}`}>
      <ExampleContents example={example} layout={layout}/>
    </div>
  </div>;
}

export function LayoutPreview({ layout, autoInline }: { layout: Layout; autoInline: boolean }) {
  const [width, setWidth] = useState(340);
  return <div className="workspace-preview">
    <p className="workspace-preview-description">Условные треды и задачи. Пример обновляется при изменении настроек.</p>
    <label className="workspace-preview-width">Ширина примера <input type="range" min="240" max="480" step="10" value={width}
      onChange={event => setWidth(Number(event.target.value))}/><output>{width} px</output></label>
    <div className="workspace-preview-sidebar" style={{ width }} aria-label="Пример списка тредов">
      <div className="workspace-preview-heading">Треды</div>
      {examples.map(example => <ExampleRow key={example.title} example={example} layout={layout} autoInline={autoInline}/>)}
    </div>
    <p className="workspace-preview-description">{autoInline
      ? 'Если всё помещается, подпись появится рядом с заголовком. Если места мало — снизу.'
      : 'Подпись окружения всегда находится под заголовком.'}</p>
  </div>;
}
