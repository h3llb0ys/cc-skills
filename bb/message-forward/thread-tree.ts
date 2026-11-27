import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";

type ThreadNode = {
  thread: PluginSidebarThread;
  children: ThreadNode[];
};

type ThreadRow = {
  thread: PluginSidebarThread;
  rootProjectId: string;
  rootProjectName: string;
  otherProjectName?: string;
  depth: number;
  hasChildren: boolean;
};

export function getThreadRows(
  threads: readonly PluginSidebarThread[],
  projects: readonly PluginSidebarProject[],
  { sourceId, search, expanded, rootLimit }: {
    sourceId: string;
    search: string;
    expanded: ReadonlySet<string>;
    rootLimit: number;
  },
): { rows: ThreadRow[]; hasMore: boolean } {
  const projectNames = new Map(projects.map(project => [project.id, project.name]));
  const nodes = new Map<string, ThreadNode>();
  const rootsByProject = new Map<string, ThreadNode[]>();

  const visible = threads
    .filter(thread => !thread.isHidden && !thread.isArchived)
    .sort((left, right) => right.updatedAt - left.updatedAt);
  for (const thread of visible) nodes.set(thread.id, { thread, children: [] });

  for (const node of nodes.values()) {
    const { parentThreadId, projectId } = node.thread;
    const parent = parentThreadId ? nodes.get(parentThreadId) : undefined;
    if (parent && parent !== node) {
      parent.children.push(node);
      continue;
    }

    const roots = rootsByProject.get(projectId);
    if (roots) roots.push(node);
    else rootsByProject.set(projectId, [node]);
  }

  function projectName(projectId: string) {
    return projectNames.get(projectId) ?? "Проект";
  }

  function matchingTree(node: ThreadNode): ThreadNode | null {
    const children = node.children
      .map(matchingTree)
      .filter(child => child !== null);
    const matches = node.thread.id !== sourceId &&
      (node.thread.displayTitle + " " + projectName(node.thread.projectId)).toLowerCase().includes(search);
    return matches || children.length > 0 ? { thread: node.thread, children } : null;
  }

  const rows: ThreadRow[] = [];
  function visit(node: ThreadNode, rootProjectId: string, depth: number) {
    const hasChildren = node.children.length > 0;
    const { thread } = node;
    rows.push({
      thread,
      rootProjectId,
      rootProjectName: projectName(rootProjectId),
      otherProjectName: thread.projectId === rootProjectId ? undefined : projectName(thread.projectId),
      depth,
      hasChildren,
    });
    if (search || expanded.has(node.thread.id)) {
      for (const child of node.children) visit(child, rootProjectId, depth + 1);
    }
  }

  let shownRoots = 0;
  for (const [projectId, roots] of rootsByProject) {
    for (const root of roots) {
      const tree = matchingTree(root);
      if (!tree) continue;
      if (shownRoots === rootLimit) return { rows, hasMore: true };
      shownRoots += 1;
      visit(tree, projectId, 0);
    }
  }
  return { rows, hasMore: false };
}
