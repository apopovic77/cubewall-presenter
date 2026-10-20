# Architecture

The cube wall is a Babylon.js scene driven by a React shell. React owns settings, content loading and HTML overlays; everything 3D lives under `src/engine/`.

## Layers

```mermaid
graph TB
  App["App.tsx<br/>settings state, content loading, actions"] --> Stage["CanvasStage"]
  Stage --> Presenter["CubeWallPresenter<br/>facade: selection, billboard, camera, physics mode"]
  Presenter --> Field["CubeField<br/>cells, layout, selection, physics bridge"]
  Presenter --> Scene["SceneController<br/>engine, lights, background, depth of field"]
  Presenter --> Xr["ArSessionController<br/>WebXR AR session"]
  App -. "settings" .-> Map["applySettingsToConfig"]
  Map -. "the only writer" .-> Config[("CubeWallConfig")]
```

`App` never writes the engine config. Settings flow one way: React state → `presenter.applySettings(settings)` → `applySettingsToConfig(settings, config)` (`src/config/applySettingsToConfig.ts`). User actions (keyboard, control panel, AR menu) share one handler, `runAction` in `App.tsx`.

## Classes

```mermaid
classDiagram
  class CubeWallPresenter {
    applySettings(settings)
    setContent(items, options)
    triggerPhysicsDrop()
    enterAr()
  }
  class CubeField {
    rebuild(gridSize)
    setContent(items, options)
    selectCell(cell)
    update(dt, time)
  }
  class FieldLayoutEngine {
    sampleAll(count, time)
    startMorphTo(index, seconds)
  }
  class FieldDefinition {
    <<interface>>
    sample(index, time, context, target)
  }
  class ContentAssigner
  class CubeTextureLoader
  class FallbackImageSource
  class CubeAnimator
  class CellGeometry
  class TileSet
  class CubeInstanceRenderer
  class FieldPhysics
  class PointerInteractionController
  class AutoSelectionTimer
  class AxisLabelController
  class BillboardConnector
  class ArSessionController
  class ArMenuController
  class SceneController
  class CameraOrbitController

  CubeWallPresenter --> CubeField
  CubeWallPresenter --> SceneController
  CubeWallPresenter --> CameraOrbitController
  CubeWallPresenter --> PointerInteractionController
  CubeWallPresenter --> AutoSelectionTimer
  CubeWallPresenter --> AxisLabelController
  CubeWallPresenter --> BillboardConnector
  CubeWallPresenter --> ArSessionController
  ArSessionController --> ArMenuController
  CubeField --> FieldLayoutEngine
  FieldLayoutEngine --> FieldDefinition
  CubeField --> ContentAssigner
  CubeField --> CubeTextureLoader
  CubeTextureLoader --> FallbackImageSource
  CubeField --> CubeAnimator
  CubeField --> CellGeometry
  CubeField --> TileSet
  CubeField --> CubeInstanceRenderer
  CubeField --> FieldPhysics
```

| Folder | Responsibility |
|---|---|
| `layouts/` | `FieldLayoutEngine` and one `FieldDefinition` per shape (grid, line, masonry, spiral, sphere, helix, chaos): index → position, cross-fade between two shapes |
| `content/` | `ContentAssigner`: which item goes onto which grid cell (matrix / axis grouping) |
| `cubes/` | per-cell work: `CubeTextureLoader` (atlas, detail texture, UVs, aspect crop), `FallbackImageSource`, `CubeAnimator` (motion without physics), `CellGeometry` (orientation, tile scale), face UV tables |
| `tiles/` | tile mode: `TileSet` (descriptors, footprints), glass caption tiles, tile materials |
| `instancing/` | `CubeInstanceRenderer`: all cubes / image tiles as thin instances with one texture atlas; the cell meshes are invisible proxies |
| `physics/` | `FieldPhysics`: Havok in field space (unaffected by the AR anchor); attractor to the layout, hold in hand, throw |
| `input/` | `PointerInteractionController`: mouse / touch (hover, click vs. camera drag, physics drag, wheel) |
| `selection/` | `AutoSelectionTimer`: kiosk auto-selection |
| `presentation/` | `AxisLabelController` (row / column labels), `BillboardConnector` (line to the HTML billboard) |
| `xr/` | `ArSessionController` (AR session, placement, grabbing, finger touch), `menu/` (AR hand menu: model, paint, panel, controller) |

## Collaboration pattern

Extracted classes do not reach back into their owner. They get either plain values in the constructor or a small **host interface** listing exactly what they may read or call (`CubeTextureHost`, `PointerInteractionHost`, `BillboardConnectorHost`, `ArSessionHooks`). That interface is the contract; if a class needs more, extend the interface deliberately.

## Rules for changes

1. **Design first.** For a new feature, sketch the classes (Mermaid in this file) before writing code. Decide which existing class owns it, or create a new one.
2. **No class grows past ~400 lines.** `CubeField` and `CubeWallPresenter` are facades (~1100 lines each, still too big); new behaviour goes into a focused class next to them, never into them.
3. **One writer per state.** Engine config is written only by `applySettingsToConfig` (settings) and by the class that owns a runtime value (e.g. `CubeField.setContent` sets `config.layout`). React state is the source for settings.
4. **Same action, one path.** New user actions are added to `ControlAction` / `ArMenuAction` and handled in `runAction`; keyboard, control panel and AR menu call it.
5. **Behaviour-preserving refactors are verified** with the regression run (layout, morph, physics modes, tiles, selection, textures) before committing; see `README.md`.

## Transitions: activation front and slot claiming

`engine/transition/` holds the pieces of a shape change; `FieldLayoutEngine` runs them.

```mermaid
classDiagram
  class FieldLayoutEngine {
    startTransition(target, time, options)
    sampleAll(count, time)
    slotOf: element → slot
  }
  class FieldTransition {
    from: positions at start
    slots: element → target slot
    delays: start time per element
    sampleToRef(index, target, out)
  }
  class ActivationFront {
    <<interface>>
    delays(positions)
  }
  class SphereFront
  class PlaneFront
  class ImmediateFront
  class assignSlots {
    <<function>>
  }
  FieldLayoutEngine --> FieldTransition
  FieldLayoutEngine ..> assignSlots
  FieldLayoutEngine ..> ActivationFront
  ActivationFront <|.. SphereFront
  ActivationFront <|.. PlaneFront
  ActivationFront <|.. ImmediateFront
```

- **Start:** a transition begins from where the elements are (mesh poses), so an interrupted morph continues smoothly instead of jumping back.
- **Activation front:** decides when each element starts, like an activation volume in a VFX simulation. A sphere or plane enters on the viewer's side (camera, or the head in AR) and crosses the field in `morphFrontSweepSeconds`; each element then travels `morphTravelSeconds` with its own ease. `none` starts everything at once.
- **Slot claiming:** in free-form shapes (sphere, spiral, helix, chaos) every element claims the nearest free slot, in activation order, through a uniform grid of the slots (≈15 ms for 625 elements; 20–40 % shorter paths from the grid). Ordered shapes (grid, line, masonry) keep the index order, because rows and columns carry meaning (publishing days).
- **Physics:** the per-element target flows into `FieldPhysics` as the attractor, so fronts work in both physics modes as well.
- **Next:** a GPU backend can evaluate the same `FieldTransition` data in the vertex shader (per-instance from-position, slot and delay; fields and fronts as GLSL), for scenes without physics and with far more elements. Picking, grabbing and physics keep needing CPU positions.
