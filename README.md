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

## Rendering, physics, AR

- **Thin instances:** cubes and image tiles are drawn by one thin-instanced box with a 4096 px texture atlas (`src/engine/instancing/CubeInstanceRenderer.ts`). The per-cell meshes remain as invisible proxies (layer mask 0) for layouts, animation, physics and picking; the selected cube is drawn by its own mesh with a 1024 px texture. Glass caption tiles keep their own mesh (left out in AR).
- **Physics** (`src/engine/physics/FieldPhysics.ts`, F3 cycles off → drop → anchor → off): Havok bodies live in field space (the field root's parent space), on their own nodes; meshes follow the bodies after each step. In anchor mode a morph (F7) steers the cubes into the new form by velocity.
- **AR** (`src/engine/xr/`): "In AR ansehen" appears in browsers with `immersive-ar` (Meta Quest). The field is re-parented under a scaled anchor in front of the viewer. Grip, or trigger/pinch past the cubes, moves it; two hands scale and turn it; trigger/pinch on a cube selects it. Menu: palm-up of the left hand (hand tracking) or X/Y on the left controller; operated by ray + pinch/trigger or an index-finger poke. Layout follows the CloudV2 AR hand menu (content post #5509). Keyboard shortcuts and menu share one action handler in `App.tsx`.

## Architecture

See [`docs/architecture.md`](docs/architecture.md) (class diagram, folder responsibilities, rules for changes).

## Regression check

Behaviour-preserving changes are verified with a headless run against `vite preview` with `?debug` (exposes the presenter as `window.__cubewall`): load, click and next-cube selection, morph without physics, physics drop / anchor with morph, wave toggle, axis layout, masonry tiles and back to cubes, textures loaded. Run it with `npm run build && npx vite preview --port 4179 &` and `npm run regression` (`tools/regression.mjs`, Chrome path via `CHROME_PATH`). It uses the real GPU (`--use-angle=metal`); the software GPU renders a few frames per second and stretches every time-based step.

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
