// Host rows sit outside the plugin root, so this stylesheet is owned by the content script.
export const inlineStyle = `
/* Applied only after the complete title, task links and label have been
   measured. React and the Jira plugin keep owning their existing nodes. */
.workspace-labels-inline-content.workspace-labels-inline-content {
  flex-wrap: nowrap !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}
.workspace-labels-inline-title {
  flex-basis: auto !important;
  flex-grow: 1;
  order: 0;
}
.workspace-labels-inline-line {
  flex: 0 0 auto !important;
  padding-left: 0 !important;
  margin-top: 0 !important;
  order: 2;
}
.workspace-labels-inline-content.workspace-labels-inline-content > [data-jira-task-links] {
  flex-basis: auto !important;
  flex-wrap: nowrap !important;
  padding-left: 0 !important;
  order: 1;
}

`;
