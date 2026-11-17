---
name: workspace-labels
description: Choose how Workspace Labels shows branches and worktrees below thread titles.
---

Workspace Labels uses BB's standard thread row metadata slot. Its `layout` setting
is `subtitle` (default), `badges`, or `details`. Change it with
`bb plugin config workspace-labels set layout <value>`. The change is live.

`autoInline` defaults to true. On the standard BB list, a single label shares the
title line only when the full title, all Jira links, label, and action reservation
fit. It reacts to resizing and changes to text/tasks. Two-label details and other
metadata contributions keep the native line. Use
`bb plugin config workspace-labels set autoInline false` to always place it below.

The plugin settings include a live preview using fictional thread titles,
branches and DEMO task badges. Its width slider changes only the preview.

`hideMain` (default false, UI label "Скрывать main") hides the repository's default
branch label, falling back to the name `main` when Git data is unavailable. It
preserves worktree names and applies to the preview too. Use
`bb plugin config workspace-labels set hideMain true` to enable it.

Requires `threadRowMetadata` and `showRowMetadata` enabled in BB, and the Git plugin
for live branches. A worktree's folder and current branch are in the tooltip.
Jira bindings remain managed by Jira Thread Links, independently of this layout;
never infer task ownership from a shared worktree or change bindings for a label.
