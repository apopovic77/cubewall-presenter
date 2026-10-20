# cubewall-presenter — notes for coding agents

Read `docs/architecture.md` before changing engine code.

- New behaviour goes into a focused class (see the folder table there), not into `CubeField.ts` or `CubeWallPresenter.ts`. No class beyond ~400 lines.
- Extracted classes get a small host interface instead of a reference to their owner.
- Engine config is written only by `src/config/applySettingsToConfig.ts` (from settings) or by the class owning the runtime value. `App.tsx` never writes `appConfig`.
- User actions: add to `ControlAction` / `ArMenuAction`, handle in `runAction` (App.tsx); keyboard, control panel and AR menu share it.
- Before committing engine changes, run the regression check in the README and compare with the previous run.
- Releases: `./devops push "msg"` on `dev`, `./devops release` for production.
