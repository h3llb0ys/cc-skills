# Section Style

Small appearance controls for BB's existing **Thread list**. Give a section or
project heading an outline icon and a title color. No replacement sidebar,
new grouping, sorting, folders, or automatic thread moves.

## Use

Open a heading's actions menu → **Оформление…**. Pick one of 16 outline icons, then choose a preset or custom color. **Сохранить** applies it;
**Отмена** leaves it unchanged; **Сбросить** removes this heading's override.
The same editor is available under Settings → Plugins → Section Style.

Colors affect only the label and its icon. An icon reserves 20 px inside the label;
row heights, outer padding, vertical gaps, controls, and thread indentation stay
as supplied by BB. With no icon, the label retains its original width. The plugin
does not rename projects or sections. Settings follow stable IDs through renames
and sync across BB clients via plugin storage and realtime updates.

## Install from this checkout

```sh
cd bb/section-style
npm ci --include=dev
bb plugin build
bb plugin install .
```

Requires BB 0.49+ and SDK 0.6.132+. Disable the plugin to restore the original
appearance; saved choices are retained until removal.

## Development and boundaries

```sh
npm run typecheck
npm test
bb plugin build
```

Uses public SDK RPC, KV storage, realtime, settings and app overlay slots. BB has
no heading-decoration or heading-menu extension slot, so a content script enhances
only the standard Thread list's DOM. Other sidebar providers are unsupported.
A BB update that changes these DOM attributes may require adapting the selectors;
the editor remains accessible in plugin settings. All owned styles, menu entries,
listeners and observers are removed on unload. No remote services or assets.
