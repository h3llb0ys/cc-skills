---
name: provider-limits
description: Inspect or configure the Provider Limits sidebar rings in BB.
---

Read current settings using `bb plugin rpc call provider-limits options --json` and the cached, sanitized snapshot using `bb plugin rpc call provider-limits snapshot --json`.

Settings are under Plugins → Provider Limits. `save` RPC accepts `{refreshSeconds:30..86400, iconSize:28..44, onlyAuthenticated:boolean, providers:Record<providerId,{enabled:boolean,windows:string[]|null}>}`. Read before modifying; preserve other providers. Use `--input-file` with JSON. `null` windows means all reported periods, an empty array means none. Window names come from the snapshot, never invent them.

Select `provider-limits/rail` in `sidebar.navigationProvider` to show rings. The plugin uses server-host quota data; it cannot infer missing limits or auth from CLI installation alone. Expired reset dates await new data, and errors are not zero remaining.

For Antigravity CLI (`acp-antigravity-cli`), the plugin can read Gemini quota windows from `agy -p /usage --output-format json` on the BB server when the SDK does not report that provider. This requires `agy` and an existing CLI login.

The UI displays refresh intervals in minutes; RPC storage remains in seconds. Defaults: 1800 seconds (30 minutes), iconSize 36 px.
