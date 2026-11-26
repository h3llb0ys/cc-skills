export const sourceTargets = {
  web: "В браузере",
  app: "В приложении",
} as const;

export const watchActions = {
  thread: "Открыть тред BB",
  web: "Открыть в Mattermost", // Persisted value from the original web-only action.
  app: "Открыть в приложении",
  edit: "Редактировать подписку",
} as const;

export const headerModes = ["combined", "count", "important", "off"] as const;
export type HeaderMode = typeof headerModes[number];
export const headerModeLabels: Record<HeaderMode, string> = {
  combined: "Подписки и важное", count: "Счётчик подписок", important: "Только важное", off: "Скрыть",
};

export const listLayouts = ["flat", "status", "thread"] as const;
export type ListLayout = typeof listLayouts[number];
export const listLayoutLabels: Record<ListLayout, string> = {
  flat: "Список", status: "По статусам", thread: "По тредам BB",
};
