# Section Style

Small appearance controls for BB's existing **Thread list**. Give a section or
project heading an outline icon, a title color and an optional font size. No replacement sidebar,
new grouping, sorting, folders, or automatic thread moves.

## Use

Open a heading's actions menu → **Оформление…**. Pick one of 80 outline icons, search by Russian or English name, and choose a preset or custom color. **Сохранить** applies it;
**Отмена** leaves it unchanged; **Сбросить** removes this heading's override.
The same editor is available under Settings → Plugins → Section Style.
The editor loads saved choices before allowing changes; a failed load offers Retry.

The font-size slider sets each heading to 10–18 px with a live dialog preview.
**Размер по умолчанию** restores BB’s font size without resetting the icon or color.
Existing saved choices keep BB’s original font size until you adjust the slider.

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
npm ci --prefix ../shared-ui
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
