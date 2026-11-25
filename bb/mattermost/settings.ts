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
