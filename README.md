# Cubewall Presenter

A 3D wall of cubes (Babylon.js 8 + Havok, React 19, Vite) that presents content items, for example the Koralmbahn press events, as textured cubes with a billboard for the selected item.

Live: https://cubewall.arkturian.com

## Content

The provider is chosen by `VITE_CUBE_CONTENT_PROVIDER` (`.env.production`):

| Provider | Source |
|---|---|
| `eventcrawler` (production) | EventCrawler v2, `GET /api/v1/events/?project_slug=…` at `VITE_EVENTCRAWLER_API_URL` |
| `koralmbahn` | legacy landesmuseum-api (`/admin/candidates`), **offline** |
| `default` | no content |

The eventcrawler project is `VITE_EVENTCRAWLER_PROJECT_SLUG` (default `default` = Koralmbahn), overridable per page with `?project=<slug>` (e.g. `?project=defence`).

## Settings store

`server/settingsServer.mjs` is a small Express store for presenter settings, served under `/settings` (nginx → `127.0.0.1:5001`, systemd unit `cubewall-settings.service` on arkturian).

- CORS is limited to `ALLOWED_ORIGINS` (default: production origin and `http://localhost:5173`).
- When `SETTINGS_WRITE_TOKEN` is set, writes need the header `X-Settings-Token`. The client sends the value stored in `localStorage['cwSettingsToken']`.
- Writes are serialized and atomic.
- The client writes debounced (800 ms), and only if the session started from the server's settings. Dev sessions (`npm run dev`) read production settings but never write them unless `VITE_SETTINGS_API_URL` points to another store.

## Development

```bash
npm ci
npm run dev             # Vite dev server
npm run settings-server # local settings store on :5001
npm run build
npm run lint
```

## Deployment

`./devops push "msg"` on `dev`, `./devops release` to production. The `Build & Deploy` workflow runs on the self-hosted arkserver runner. It SSHes to arkturian, builds in `/var/code/cubewall-presenter`, rsyncs `dist/` to `/var/www/cubewall/site`, and restarts `cubewall-settings.service`.
