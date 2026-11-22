# Match alerts (Vetro Shard for Samsung TVs)

Standalone project, split from the Notification Center repository. It follows one football team on a live-score provider and shows **goals, kick-off, half-time and
full-time** as the native Samsung banner on top of whatever is running, through the **Notification Center** Shard
(https://github.com/mclaudiopt/tv-notification-center), which must be installed on the same TV with its companion app (version 0.2.1 or newer).

## What exists (v0.1.1)
- `index.js` (Shard, plain **ES5**, Node 4.4 compatible), `ui.html` (panel, no `<form>`: the Vetro frame has no `allow-forms`), `manifest.json` (`id: match-alerts`, no `exec`).
- Providers, chosen in the panel: **ESPN** public scoreboard (no key, live-tested on a real goal) and **API-Football** (own key, 100 requests/day, written but **never run**).
  A provider is one `match(config, callback)` function in `index.js` returning `{id,state,desc,clock,date,home,away}`.
- Events: goal (banner 30 s by default), opponent goal, disallowed goal, kick-off, half-time, full-time. First sight of a match only sets a baseline (no banner for the current score).
- Banners are sent with `POST http://127.0.0.1:8099/plugins/notification-center/api/notify` (see that project's `docs/API.md`).

## Open
- More events (cards, substitutions, penalties, extra time), scorer and minute in the banner, kick-off reminders, several teams, other sports, a next-matches list.
- Test API-Football with a real key; other providers (GOAL API, TheSportsDB) are not implemented.
- Cast integration (goal banners on every TV) with the Cast project.

## Build, install, test
- Tooling: Vetro's `vetro-plugin.cjs` (github.com/andrearicci93/vetro, `app/scripts/`): `check <folder>`, `pack <folder>` (delete an old `.vplugin` from the folder first).
- Install on a TV with Developer mode: `POST http://<TV-IP>:8099/plugins/install` with the bundle as body and header `X-Vetro-Sha256: <sha256 of the file>`, then `POST /plugins/match-alerts/enable`.
- Shard limits: ES5, <= 20 files, <= 512 KB, text only, no downloaded code, no `eval`. Keep sources ASCII (`\u` escapes, `String.fromCharCode`).
- Panel buttons show a spinner then a green or red flash (`act()` in `ui.html`).

## Related projects
Notification Center: github.com/mclaudiopt/tv-notification-center. Cast (one notification to every TV): github.com/mclaudiopt/tv-cast. No personal data (IPs, keys) in this repository.
