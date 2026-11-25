---
name: diff-preview
description: Configure and troubleshoot Git diff previews in BB's changed-files list and file links in chat.
---

# Diff Preview

The Diff Preview plugin shows the Git patch for a file in the native **Changed files** list above the composer. Hover or focus the row to open the preview, and use Escape to dismiss it. Clicking the row uses BB's usual file action.

Use **Settings → Installed plugins → Diff Preview** to configure it. The settings also work through the BB CLI:

```sh
bb plugin config diff-preview set enabled true
bb plugin config diff-preview set fileLinks true
bb plugin config diff-preview set delay "500 ms"
bb plugin config diff-preview set placement "Over the list"
bb plugin config diff-preview set lineNumbers true
```

The other delays are `250 ms` and `800 ms`. The other placement is `Above the list`.

The preview reads patches from the bundled Git plugin for the current workspace or branch comparison. Check that Git is enabled and **Show Git changes above the composer** is on if the list is missing. Use the normal file action or the **Diff** tab for large or unavailable patches.

File links in chat use the current text file on the thread’s host. A line link highlights the target in an excerpt of up to 15 lines.
