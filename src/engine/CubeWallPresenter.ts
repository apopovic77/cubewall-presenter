import { PointerEventTypes, PointerInfo } from '@babylonjs/core/Events/pointerEvents';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { SceneController } from './SceneController';
import { CubeField } from './CubeField';
import type { CubeSelectionInfo } from './CubeField';
import type { CubeCell } from './CubeField';
import type { CubeContentOptions } from './CubeField';
import { appConfig, DOF_WORLD_TO_MM } from '../config/AppConfig';
import type { CubeWallConfig, AxisLabelAxis } from '../config/AppConfig';
import type { PresenterSettings } from '../config/PresenterSettings';
import type { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import { BillboardOverlay } from './BillboardOverlay';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Plane } from '@babylonjs/core/Maths/math.plane';
import { Axis3DLabelManager, type AxisLabelData } from './Axis3DLabelManager';
import type { CubeContentItem } from '../types/content';
import { CameraOrbitController } from './CameraOrbitController';
import { ArSessionController } from './xr/ArSessionController';
import { BillboardConnector } from './presentation/BillboardConnector';
import type { ArMenuAction, ArMenuState } from './xr/menu/ArMenuModel';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';

const DAY_MS = 24 * 60 * 60 * 1000;
function cloneBillboardState(state: BillboardDisplayState): BillboardDisplayState {
  return {
    ...state,
    content: state.content ? { ...state.content } : null,
  };
}

export interface BillboardDisplayState {
  worldPosition: Vector3;
  screenX: number;
  screenY: number;
  viewportWidth: number;
  viewportHeight: number;
  isVisible: boolean;
  cubeScreenX: number;
  cubeScreenY: number;
  frameId: number;
  contentVersion: number;
  content: {
    gridX: number;
    gridZ: number;
    colorHex: string;
    textureLabel: string;
    item: CubeContentItem | null;
  } | null;
  onRequestClose: () => void;
}

export interface BillboardScreenMetrics {
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export interface AxisLabelDisplayState {
  id: string;
  label: string;
  axis: AxisLabelAxis;
  screenX: number;
  screenY: number;
}

export interface CubeWallPresenterOptions {
  canvas: HTMLCanvasElement;
  config?: CubeWallConfig;
  onSelectionChange?: (selection: CubeSelectionInfo | null) => void;
  onDebug?: (line: string) => void;
  onBillboardStateChange?: (state: BillboardDisplayState | null) => void;
  onAxisLabelsChange?: (labels: AxisLabelDisplayState[]) => void;
  onCameraSettingsChange?: (update: Partial<PresenterSettings>) => void;
  /** AR menu actions that the host maps to the same handlers as its keyboard shortcuts. */
  onArMenuAction?: (action: ArMenuAction) => void;
}

export class CubeWallPresenter {
  private readonly sceneController: SceneController;
  private readonly arController: ArSessionController;
  private readonly connector: BillboardConnector;
  private readonly arMenuAction?: (action: ArMenuAction) => void;
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly cubeField: CubeField;
  private readonly canvasElement: HTMLCanvasElement;
  private readonly config: CubeWallConfig;
  private readonly selectionChange?: (selection: CubeSelectionInfo | null) => void;
  private readonly debug?: (line: string) => void;
  private readonly billboardOverlay: BillboardOverlay;
  private readonly billboardStateChange?: (state: BillboardDisplayState | null) => void;
  private readonly axisLabelStateChange?: (labels: AxisLabelDisplayState[]) => void;
  private readonly cameraSettingsChange?: (update: Partial<PresenterSettings>) => void;
  private readonly axis3DLabelManager: Axis3DLabelManager;
  private readonly cameraController: CameraOrbitController;
  private autoSequence: CubeCell[] = [];
  private autoSequenceIndex = 0;
  private billboardContentVersion = 0;
  private currentBillboardInfo: CubeSelectionInfo | null = null;
  private currentBillboardCell: CubeCell | null = null;
  private currentSelectionNormalWorld: Vector3 | null = null;
  private billboardFrameId = 0;
  private sceneTime = 0;
  private disposed = false;
  private debugProbeTimer: ReturnType<typeof setTimeout> | null = null;
  private hoverInteractionEnabled = true;
  private autoSelectEnabled = false;
  private autoSelectInterval = 6;
  private autoSelectElapsed = 0;
  private contentItems: CubeContentItem[] = [];
  private contentOptionsSnapshot: Partial<CubeContentOptions> | undefined;
  private axisLabelStartDateMs = Number.NaN;
  private readonly axisLabelDateFormatter = new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });
  private physicsActive = false;
  private physicsMode: 'off' | 'classic' | 'anchor' = 'off';
  private physicsDragCandidate: { cell: CubeCell; startX: number; startY: number } | null = null;
  private activePhysicsDrag: { cell: CubeCell } | null = null;
  private skipNextPhysicsClick = false;
  private savedHoverInteraction = true;
  private savedAutoSelect = false;
  private billboardScreenMetrics: BillboardScreenMetrics | null = null;
  private pendingDofUpdateFrames = 0;
  private readonly forceDofFrames = 6;
  private wheelListener: ((event: WheelEvent) => void) | null = null;
  private pendingWheelSyncFrames = 0;
  private lastAxisCameraPos = new Vector3(Number.NaN, Number.NaN, Number.NaN);
  private lastAxisCameraTarget = new Vector3(Number.NaN, Number.NaN, Number.NaN);
  private axisLabelsDirty = true;
  private lastEmittedBillboard: BillboardDisplayState | null = null;

  public updateBillboardScreenMetrics(metrics: BillboardScreenMetrics | null): void {
    const prev = this.billboardScreenMetrics;
    const same =
      (prev === null && metrics === null) ||
      (prev !== null &&
        metrics !== null &&
        Math.abs(prev.left - metrics.left) < 0.5 &&
        Math.abs(prev.top - metrics.top) < 0.5 &&
        Math.abs(prev.width - metrics.width) < 0.5 &&
        Math.abs(prev.height - metrics.height) < 0.5);
    if (same) {
      return;
    }
    this.billboardScreenMetrics = metrics;
    if (this.currentBillboardCell && this.currentBillboardInfo) {
      this.emitHtmlBillboardState();
    }
    this.axisLabelsDirty = true;
  }

  private syncRelativeCameraSettings(): void {
    if (!this.currentBillboardCell) return;
    const anchor = this.currentBillboardCell.mesh.getAbsolutePosition().clone();
    const normal =
      this.currentSelectionNormalWorld ??
      this.cubeField.getLiftNormalWorld(this.currentBillboardCell);
    const capture = this.cameraController.captureRelativeOffset(anchor, normal);
    this.config.camera.relativeOffset.x = capture.offset.x;
    this.config.camera.relativeOffset.y = capture.offset.y;
    this.config.camera.relativeOffset.z = capture.offset.z;
    this.config.camera.relativeLookAtOffset.x = capture.lookAtOffset.x;
    this.config.camera.relativeLookAtOffset.y = capture.lookAtOffset.y;
    this.config.camera.relativeLookAtOffset.z = capture.lookAtOffset.z;
    const radius = this.sceneController.getCamera().radius;
    if (Number.isFinite(radius)) {
      this.config.camera.radius = radius;
    }
    this.cameraController.setManualOverride(false);
    this.cameraSettingsChange?.({
      cameraRelativeOffsetX: capture.offset.x,
      cameraRelativeOffsetY: capture.offset.y,
      cameraRelativeOffsetZ: capture.offset.z,
      cameraRelativeLookAtOffsetX: capture.lookAtOffset.x,
      cameraRelativeLookAtOffsetY: capture.lookAtOffset.y,
      cameraRelativeLookAtOffsetZ: capture.lookAtOffset.z,
      cameraRadius: radius,
    });
  }

  public async triggerPhysicsDrop(): Promise<void> {
    if (this.physicsMode === 'off') {
      this.savedHoverInteraction = this.hoverInteractionEnabled;
      this.savedAutoSelect = this.autoSelectEnabled;
      this.cubeField.selectCell(null);
      this.updateBillboard(null, { animate: false, reason: 'system' });
      this.selectionChange?.(null);
      this.billboardStateChange?.(null);
      this.physicsActive = true;
      this.physicsMode = 'classic';
      this.autoSelectEnabled = false;
      this.hoverInteractionEnabled = false;
      this.physicsDragCandidate = null;
      this.activePhysicsDrag = null;
      this.skipNextPhysicsClick = false;
      await this.cubeField.enablePhysics('classic');
      // F3 may have been pressed again while Havok was loading.
      const modeAfterLoad = this.physicsMode as 'off' | 'classic' | 'anchor';
      if (modeAfterLoad === 'anchor') this.cubeField.setPhysicsMode('anchor');
      this.debug?.('[Physics] Mode: classic (F3 -> anchor, F3 -> off)');
      return;
    }

    if (this.physicsMode === 'classic') {
      this.physicsMode = 'anchor';
      this.cubeField.setPhysicsMode('anchor');
      this.debug?.('[Physics] Mode: anchor (cubes hold the layout, F7 morphs them)');
      return;
    }

    // physicsMode === 'anchor'
    this.physicsMode = 'off';
    this.physicsActive = false;
    this.cubeField.disablePhysics();
    this.hoverInteractionEnabled = this.savedHoverInteraction;
    this.autoSelectEnabled = this.savedAutoSelect;
    this.autoSelectElapsed = 0;
    this.physicsDragCandidate = null;
    this.activePhysicsDrag = null;
    this.skipNextPhysicsClick = false;
    this.refreshAxisAnchors();
    this.debug?.('[Physics] Mode: off');
  }

  /**
   * AR leaves out the glass text tiles (one HTML texture and mesh each, too heavy
   * for a headset); in tile mode the tiles are rebuilt on entering and leaving.
   */
  private onArStateChange(active: boolean): void {
    this.cubeField.setTileCaptionsSuppressed(active);
    if (this.config.geometryMode === 'tile' && this.contentItems.length > 0) {
      void this.setContent(this.contentItems.slice(), this.contentOptionsSnapshot);
    }
  }

  /** Debug/inspection: mean world position of all cubes. */
  public debugFieldCentroid(): { x: number; y: number; z: number; spread: number } {
    const cells = this.cubeField.getAllCells();
    const sum = Vector3.Zero();
    cells.forEach((cell) => sum.addInPlace(cell.mesh.getAbsolutePosition()));
    const mean = sum.scale(1 / Math.max(1, cells.length));
    const spread = cells.reduce((acc, cell) => acc + Vector3.Distance(cell.mesh.getAbsolutePosition(), mean), 0) / Math.max(1, cells.length);
    return { x: mean.x, y: mean.y, z: mean.z, spread };
  }

  public getPhysicsMode(): 'off' | 'classic' | 'anchor' {
    return this.physicsMode;
  }

  public isPhysicsActive(): boolean {
    return this.physicsMode !== 'off';
  }

  public markAxisLabelsDirty(): void {
    this.axisLabelsDirty = true;
  }

  private updateDepthOfFieldFocus(cell: CubeCell | null, cameraPos?: Vector3): void {
    if (!this.config.depthOfFieldEnabled || !this.config.depthOfFieldAutoFocusEnabled) return;
    const targetCell = cell ?? this.cubeField.getCurrentSelection() ?? this.cubeField.getCenterCell();
    if (!targetCell) return;
    const camera = this.sceneController.getCamera();
    const referencePos = cameraPos ?? camera.position;
    const distance = referencePos.subtract(targetCell.mesh.getAbsolutePosition()).length();
    const adjustedDistance = distance + this.config.depthOfFieldAutoFocusOffset;
    const sharpness = Math.max(0.1, this.config.depthOfFieldAutoFocusSharpness);
    const effectiveFStop = Math.max(0.1, this.config.depthOfFieldFStop / sharpness);
    // Only the focus distance is tracked in config; the f-stop stays the user's base
    // value, otherwise dividing by `sharpness` every frame would compound.
    this.config.depthOfFieldFocusDistance = adjustedDistance;
    this.sceneController.setDepthOfFieldFocusDistance(adjustedDistance, effectiveFStop);
  }

  constructor({
    canvas,
    config = appConfig,
    onSelectionChange,
    onDebug,
    onBillboardStateChange,
    onAxisLabelsChange,
    onCameraSettingsChange,
    onArMenuAction,
  }: CubeWallPresenterOptions) {
    this.arMenuAction = onArMenuAction;
    this.config = config;
    this.canvasElement = canvas;
    this.sceneController = new SceneController({ canvas, config: this.config });
    this.engine = this.sceneController.getEngine();
    this.scene = this.sceneController.getScene();
    this.cubeField = new CubeField(this.scene, this.config);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const presenter = this;
    this.connector = new BillboardConnector(this.scene, this.config, {
      getCamera: () => this.sceneController.getCamera(),
      get screenMetrics() {
        return presenter.billboardScreenMetrics;
      },
      get currentCell() {
        return presenter.currentBillboardCell;
      },
    });
    this.arController = new ArSessionController(this.scene, this.cubeField.getRootNode(), {
      setPassthrough: (active) => this.sceneController.setPassthrough(active),
      isSelectable: (mesh) => this.cubeField.getCellFromMesh(mesh) !== null,
      onSelect: (mesh) => this.selectFromAr(mesh),
      findCubeNear: (point, margin) => this.findCubeNear(point, margin),
      grabCube: (mesh) => this.grabCubeFromAr(mesh),
      holdCube: (mesh, world) => {
        const cell = this.cubeField.getCellFromMesh(mesh);
        if (cell) this.cubeField.holdCube(cell, world);
      },
      releaseCube: (mesh, velocity) => {
        const cell = this.cubeField.getCellFromMesh(mesh);
        if (cell) this.cubeField.releaseCube(cell, velocity);
      },
      getMenuState: () => this.getArMenuState(),
      onStateChange: (active) => this.onArStateChange(active),
      onMenuAction: (action) => this.arMenuAction?.(action),
    });
    this.selectionChange = onSelectionChange;
    this.debug = onDebug;
    this.billboardStateChange = onBillboardStateChange;
    this.axisLabelStateChange = onAxisLabelsChange;
    this.cameraSettingsChange = onCameraSettingsChange;
    this.cameraController = new CameraOrbitController(this.sceneController.getCamera(), this.config);
    this.cameraController.onFocusSettled = () => {
      this.syncRelativeCameraSettings();
      if (this.config.depthOfFieldEnabled && this.config.depthOfFieldAutoFocusEnabled) {
        const cameraPos = this.sceneController.getCamera().position.clone();
        this.updateDepthOfFieldFocus(this.currentBillboardCell, cameraPos);
        this.pendingDofUpdateFrames = this.forceDofFrames;
      }
    };
    this.setupPointerInteractions();
    this.setupWheelCapture();

    this.axis3DLabelManager = new Axis3DLabelManager(this.scene);
    this.refreshAutoSequence();

    this.refreshAxisAnchors();
    this.updateAxisLabelStartDate();

    this.billboardOverlay = new BillboardOverlay({
      scene: this.scene,
      config: this.config,
      onRequestClose: () => {
        this.cubeField.selectCell(null);
        this.updateBillboard(null, { animate: false, reason: 'manual' });
      },
    });

    this.emitAxisLabelsState();
    this.updateAxis3DLabels();

    // Debug camera and scene
    this.debugProbeTimer = setTimeout(() => {
      this.debugProbeTimer = null;
      if (this.disposed) return;
      const camera = this.sceneController.getCamera();
      this.logDebug(`Camera: pos=${camera.position.toString()} target=${camera.target.toString()} radius=${camera.radius} alpha=${camera.alpha} beta=${camera.beta}`);
      this.logDebug(`Scene ready: ${this.scene.meshes.length} meshes, activeCamera=${this.scene.activeCamera?.name}`);
      
      // Test picking at canvas center after a short delay
      const canvasElement = this.engine.getRenderingCanvas();
      if (canvasElement) {
        const centerX = canvasElement.width / 2;
        const centerY = canvasElement.height / 2;
        const testPick = this.scene.pick(centerX, centerY, (mesh) => mesh.isPickable);
        this.logDebug(`Test pick at canvas center (${Math.round(centerX)}, ${Math.round(centerY)}): ${testPick?.hit ? testPick.pickedMesh?.name : 'MISS'} distance=${testPick?.distance?.toFixed(2)}`);
        
        // Try picking with a ray from camera
        const ray = this.scene.createPickingRay(centerX, centerY, null, camera);
        this.logDebug(`Ray from camera: origin=${ray.origin.toString()} direction=${ray.direction.toString()}`);
      }
    }, 100);
  }

  private setManualCameraOverride(active: boolean): void {
    this.cameraController.setManualOverride(active);
  }

  private setupWheelCapture(): void {
    this.wheelListener = () => {
      this.setManualCameraOverride(true);
      this.cameraController.captureCurrentCameraState();
      this.pendingWheelSyncFrames = 2;
    };
    this.canvasElement.addEventListener('wheel', this.wheelListener, { passive: true });
  }

  private setupPointerInteractions(): void {
    let lastHoveredId: number | null = null;
    let pointerDownInfo: { x: number; y: number; shouldTriggerClick: boolean; button: number } | null = null;
    let pendingPick: { cell: CubeCell; meshName?: string } | null = null;
    let pointerClickHandled = false;

    this.scene.onPointerObservable.add((pointerInfo: PointerInfo) => {
      if (this.disposed) return;
      // In AR, XR controllers synthesize pointer events without screen coordinates;
      // selection and grabbing come from ArSessionController, only hover ripples stay.
      if (this.arController.isActive && pointerInfo.type !== PointerEventTypes.POINTERMOVE) return;
      switch (pointerInfo.type) {
        case PointerEventTypes.POINTERMOVE: {
          const moveEvent = pointerInfo.event as PointerEvent | MouseEvent | null;
          if (
            moveEvent &&
            pointerDownInfo &&
            'clientX' in moveEvent &&
            'clientY' in moveEvent &&
            (moveEvent.buttons & 1)
          ) {
            const dx = moveEvent.clientX - pointerDownInfo.x;
            const dy = moveEvent.clientY - pointerDownInfo.y;
            if (Math.sqrt(dx * dx + dy * dy) > 6) {
              pointerDownInfo.shouldTriggerClick = false;
            this.setManualCameraOverride(true);
            this.cameraController.interruptAnimation();
            this.logDebug(
              `[Pointer] Drag detected (dx=${dx.toFixed(2)}, dy=${dy.toFixed(2)}). Manual override engaged.`,
            );
            }
          }
          if (this.physicsActive) {
            if (!this.arController.isActive) this.handlePhysicsPointerMove(pointerInfo);
            break;
          }
          if (!this.hoverInteractionEnabled) {
            lastHoveredId = null;
            break;
          }
          const pickInfo = this.resolvePickInfo(pointerInfo, true);
          const mesh = pickInfo?.pickedMesh ?? null;
          if (!mesh || !mesh.isPickable) {
            lastHoveredId = null;
            break;
          }
          if (mesh.uniqueId === lastHoveredId) break;
          lastHoveredId = mesh.uniqueId;
          const cell = this.cubeField.getCellFromMesh(mesh);
          if (cell && !cell.isSelected) {
            this.cubeField.triggerRipple(cell);
          }
          break;
        }
        case PointerEventTypes.POINTERPICK: {
          this.logDebug('POINTERPICK');
          // In AR, selection comes from the XR 'select' event (see selectFromAr).
          if (this.arController.isActive) break;
          if (pointerDownInfo && pendingPick) {
            break;
          }
          this.handlePick(pointerInfo);
          break;
        }
        case PointerEventTypes.POINTERDOWN: {
          const event = pointerInfo.event as PointerEvent | MouseEvent;
          const button = 'button' in event ? event.button ?? 0 : 0;
          if (button !== 0 && button !== 1 && button !== 2) break;
          pointerClickHandled = false;
          if ('clientX' in event && 'clientY' in event) {
            pointerDownInfo = {
              x: event.clientX,
              y: event.clientY,
              shouldTriggerClick: button === 0,
              button,
            };
          } else {
            pointerDownInfo = null;
          }
          if (button !== 0) {
            this.cameraController.interruptAnimation();
            this.setManualCameraOverride(true);
            this.logDebug('[Pointer] Non-left button down -> manual override');
            break;
          }
          const pickInfo = this.resolvePickInfo(pointerInfo);
          if (pickInfo?.pickedMesh && pickInfo.pickedMesh.isPickable) {
            const cell = this.cubeField.getCellFromMesh(pickInfo.pickedMesh);
            if (!cell) {
              this.logDebug(`POINTERDOWN -> no cube data for mesh ${pickInfo.pickedMesh.name}`);
              break;
            }
            if (typeof event.preventDefault === 'function') event.preventDefault();
            if (typeof event.stopPropagation === 'function') event.stopPropagation();
            if (this.physicsActive) {
              const startX = 'clientX' in event ? event.clientX : 0;
              const startY = 'clientY' in event ? event.clientY : 0;
              this.physicsDragCandidate = { cell, startX, startY };
              this.activePhysicsDrag = null;
              this.skipNextPhysicsClick = false;
              this.logDebug(`POINTERDOWN physics candidate -> ${pickInfo.pickedMesh.name}`);
              pendingPick = null;
            } else {
              this.logDebug(`POINTERDOWN on ${pickInfo.pickedMesh.name}`);
              this.physicsDragCandidate = null;
              this.activePhysicsDrag = null;
              this.skipNextPhysicsClick = false;
              pendingPick = { cell, meshName: pickInfo.pickedMesh.name };
            }
          } else {
            this.logDebug('POINTERDOWN (no pickable mesh) - waiting for POINTERUP/tap');
            this.physicsDragCandidate = null;
            this.skipNextPhysicsClick = false;
            pendingPick = null;
          }
          break;
        }
        case PointerEventTypes.POINTERUP: {
          const event = pointerInfo.event as PointerEvent | MouseEvent;
          const button = 'button' in event ? event.button ?? 0 : 0;
          if (button !== 0 && button !== 1 && button !== 2) break;
          if (this.physicsActive) {
            if (this.activePhysicsDrag) {
              this.finishActivePhysicsDrag();
              this.skipNextPhysicsClick = true;
            } else if (this.physicsDragCandidate && !this.skipNextPhysicsClick) {
              this.skipNextPhysicsClick = true;
              this.applySelection(this.physicsDragCandidate.cell);
            }
            this.physicsDragCandidate = null;
            pointerDownInfo = null;
            pendingPick = null;
            break;
          }
          if (pointerDownInfo && pointerDownInfo.button !== 0) {
            this.setManualCameraOverride(true);
            this.syncRelativeCameraSettings();
            this.logDebug('[Pointer] PointerUp non-left -> manual override stays');
            pointerDownInfo = null;
            pendingPick = null;
            break;
          }
          if (pointerDownInfo && pointerDownInfo.button === 0 && 'clientX' in event && 'clientY' in event) {
            const dx = event.clientX - pointerDownInfo.x;
            const dy = event.clientY - pointerDownInfo.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance <= 6) {
              this.logDebug(`POINTERUP -> treating as click (distance ${distance.toFixed(2)})`);
              if (pointerDownInfo.shouldTriggerClick) {
                if (pendingPick) {
                  this.applySelection(pendingPick.cell, pendingPick.meshName);
                } else {
              this.handlePick(pointerInfo);
                }
                pointerClickHandled = true;
              }
            } else {
              this.logDebug(`POINTERUP -> manual camera move (drag distance ${distance.toFixed(2)})`);
              this.setManualCameraOverride(true);
              this.cameraController.captureCurrentCameraState();
              this.syncRelativeCameraSettings();
        this.syncRelativeCameraSettings();
              if (this.config.depthOfFieldEnabled && this.config.depthOfFieldAutoFocusEnabled) {
                const dof = this.sceneController.getRenderingPipeline()?.depthOfField;
                if (dof) {
                  const currentDistance = dof.focusDistance / DOF_WORLD_TO_MM;
                  this.config.depthOfFieldFocusDistance = currentDistance;
                  this.config.depthOfFieldFStop = dof.fStop;
                  this.updateDepthOfFieldFocus(null);
                }
              }
              this.syncRelativeCameraSettings();
              pointerClickHandled = true;
            }
          }
          pointerDownInfo = null;
          pendingPick = null;
          break;
        }
        case PointerEventTypes.POINTERTAP: {
          this.logDebug('POINTERTAP');
          if (this.arController.isActive) break;
          if (pointerClickHandled) {
            pointerClickHandled = false;
            pendingPick = null;
            break;
          }
          if (this.physicsActive) {
            if (this.skipNextPhysicsClick) {
              this.skipNextPhysicsClick = false;
              break;
            }
          }
          this.handlePick(pointerInfo);
          if (this.physicsActive) {
            this.skipNextPhysicsClick = false;
          }
          break;
        }
        default:
          break;
      }
    });
  }

  private handlePhysicsPointerMove(pointerInfo: PointerInfo): void {
    if (!this.physicsActive) return;
    const event = pointerInfo.event as PointerEvent | MouseEvent | null;
    if (!event) return;
    const buttons = 'buttons' in event ? event.buttons ?? 0 : 0;

    if (this.activePhysicsDrag) {
      if (buttons === 0) {
        this.finishActivePhysicsDrag();
      } else {
        this.updateActivePhysicsDrag(pointerInfo);
      }
      this.skipNextPhysicsClick = true;
      return;
    }

    if (!this.physicsDragCandidate) {
      return;
    }

    if (buttons === 0) {
      return;
    }

    if (!('clientX' in event) || !('clientY' in event)) {
      return;
    }

    const dx = event.clientX - this.physicsDragCandidate.startX;
    const dy = event.clientY - this.physicsDragCandidate.startY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= 6) {
      return;
    }

    const cell = this.physicsDragCandidate.cell;
    this.startPhysicsDrag(cell);
    this.activePhysicsDrag = { cell };
    this.physicsDragCandidate = null;
    this.skipNextPhysicsClick = true;
    this.updateActivePhysicsDrag(pointerInfo);
  }

  private startPhysicsDrag(cell: CubeCell): void {
    this.logDebug(`physics drag start -> cube_${cell.gridX}_${cell.gridZ}`);
    this.cubeField.selectCell(null);
    this.updateBillboard(null, { animate: false, reason: 'manual' });
    this.cubeField.beginPhysicsDrag(cell);
  }

  private updateActivePhysicsDrag(pointerInfo: PointerInfo): void {
    if (!this.activePhysicsDrag) return;
    const dragCell = this.activePhysicsDrag.cell;
    const point = this.getGroundIntersection(pointerInfo);
    if (!point) return;
    this.cubeField.updatePhysicsDrag(dragCell, point);
  }

  private finishActivePhysicsDrag(): void {
    if (!this.activePhysicsDrag) return;
    this.cubeField.endPhysicsDrag(this.activePhysicsDrag.cell);
    this.logDebug(`physics drag end -> cube_${this.activePhysicsDrag.cell.gridX}_${this.activePhysicsDrag.cell.gridZ}`);
    this.activePhysicsDrag = null;
  }

  private getGroundIntersection(pointerInfo: PointerInfo): Vector3 | null {
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas) return null;
    const event = pointerInfo.event as PointerEvent | MouseEvent | null;
    if (!event) return null;

    let x = 0;
    let y = 0;
    if ('offsetX' in event && typeof event.offsetX === 'number' && typeof event.offsetY === 'number') {
      x = event.offsetX;
      y = event.offsetY;
    } else if ('clientX' in event && 'clientY' in event) {
      const rect = canvas.getBoundingClientRect();
      x = event.clientX - rect.left;
      y = event.clientY - rect.top;
    } else {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const scaledX = x * scaleX;
    const scaledY = y * scaleY;

    const camera = this.sceneController.getCamera();
    const ray = this.scene.createPickingRay(scaledX, scaledY, Matrix.Identity(), camera);
    const groundHeight = this.cubeField.getPhysicsGroundWorldY();
    const plane = Plane.FromPositionAndNormal(new Vector3(0, groundHeight, 0), Vector3.Up());
    const distance = ray.intersectsPlane(plane);
    if (distance === null) {
      return null;
    }
    return ray.origin.add(ray.direction.scale(distance));
  }

  private handlePick(pointerInfo: PointerInfo, pickInfoOverride?: PickingInfo | null): void {
    const pickInfo = pickInfoOverride ?? this.resolvePickInfo(pointerInfo);
    if (!pickInfo) {
      this.logDebug('handlePick: no pick info');
      this.cubeField.selectCell(null);
      this.updateBillboard(null, { reason: 'manual' });
      return;
    }

    const mesh = pickInfo.pickedMesh;
    if (!mesh || !mesh.isPickable) {
      this.logDebug('handlePick: mesh missing or not pickable');
      this.cubeField.selectCell(null);
      this.updateBillboard(null, { reason: 'manual' });
      return;
    }

    const cell = this.cubeField.getCellFromMesh(mesh);
    if (!cell) {
      this.logDebug(`handlePick: no cube data for mesh ${mesh.name}`);
      this.cubeField.selectCell(null);
      this.updateBillboard(null, { reason: 'manual' });
      return;
    }
    this.applySelection(cell, mesh.name);
    }

  /** True when the browser can start an immersive-AR session (e.g. Meta Quest). */
  public static isArSupported(): Promise<boolean> {
    return ArSessionController.isSupportedAsync();
  }

  public isArActive(): boolean {
    return this.arController.isActive;
  }

  public prepareAr(): Promise<void> {
    return this.arController.prepare();
  }

  /** Starts AR with passthrough. Must be called from a user gesture. */
  public enterAr(): Promise<void> {
    return this.arController.enter();
  }

  public exitAr(): Promise<void> {
    return this.arController.exit();
  }

  /**
   * Nearest cube whose surface is within `margin` metres of a world point; the
   * cube is approximated by a sphere slightly larger than its half side.
   */
  private findCubeNear(point: Vector3, margin: number): AbstractMesh | null {
    let best: AbstractMesh | null = null;
    let bestGap = margin;
    for (const cell of this.cubeField.getAllCells()) {
      const mesh = cell.mesh;
      if (!mesh.isEnabled() || !mesh.isPickable) continue;
      const sphere = mesh.getBoundingInfo().boundingSphere;
      const gap = Vector3.Distance(point, sphere.centerWorld) - sphere.radiusWorld * 0.7;
      if (gap <= bestGap) {
        bestGap = gap;
        best = mesh;
      }
    }
    return best;
  }

  private grabCubeFromAr(mesh: AbstractMesh): void {
    const cell = this.cubeField.getCellFromMesh(mesh);
    if (!cell) return;
    if (this.cubeField.getCurrentSelection() === cell) {
      this.cubeField.selectCell(null);
      this.updateBillboard(null, { animate: false, reason: 'manual' });
    }
    this.cubeField.grabCube(cell);
  }

  private getArMenuState(): ArMenuState {
    return {
      layoutMode: this.config.layout.mode,
      autoRotate: this.cubeField.isFieldAutoRotating(),
      wavePosition: this.config.wavePositionEnabled,
      waveRotation: this.config.waveRotationEnabled,
      physicsMode: this.physicsMode,
    };
  }

  /** Call after state shown on the AR menu changed outside it (settings, shortcuts). */
  public refreshArMenu(): void {
    this.arController.refreshMenu();
  }

  private selectFromAr(mesh: AbstractMesh): void {
    const cell = this.cubeField.getCellFromMesh(mesh);
    if (!cell) return;
    this.applySelection(cell, mesh.name);
  }

  private applySelection(cell: CubeCell, meshName?: string): void {
    const alreadySelected = cell.isSelected;
    this.logDebug(`handlePick: ${meshName ?? cell.mesh.name} -> ${alreadySelected ? 'deselect' : 'select'}`);
    if (alreadySelected) {
      this.commitSelection(null, { animateCamera: true, reason: 'manual' });
      return;
    }
    const triggerRipple = this.hoverInteractionEnabled && !this.physicsActive;
    this.commitSelection(cell, {
      triggerRipple,
      animateCamera: true,
      reason: 'auto',
    });
  }

  private commitSelection(
    target: CubeCell | null,
    options: {
      triggerRipple?: boolean;
      animateCamera?: boolean;
      reason?: 'manual' | 'auto';
    } = {},
  ): void {
    const triggerRipple = options.triggerRipple ?? false;
    const animateCamera = options.animateCamera ?? true;
    const reason = options.reason ?? 'manual';
    const manualActive = this.cameraController.isManualOverrideActive();

    if (!target) {
      this.cubeField.selectCell(null);
      const shouldAnimateBillboard = animateCamera && (!manualActive || reason === 'auto');
      this.updateBillboard(null, { animate: shouldAnimateBillboard, reason });
      const cameraPos = this.sceneController.getCamera().position.clone();
      this.updateDepthOfFieldFocus(null, cameraPos);
      this.currentSelectionNormalWorld = null;
      return;
    }

    this.cubeField.selectCell(target);
    if (triggerRipple) {
      this.cubeField.triggerRipple(target);
    }
    this.currentSelectionNormalWorld = this.cubeField.getLiftNormalWorld(target);
    this.updateBillboard(target, { reason });
    this.autoSelectElapsed = 0;
    const cameraPos = this.sceneController.getCamera().position.clone();
    this.updateDepthOfFieldFocus(target, cameraPos);
    const shouldAnimateCamera =
      this.config.selectionCameraFollowEnabled &&
      animateCamera &&
      (!manualActive || reason === 'auto');
    this.logDebug(
      `[Camera] commitSelection -> reason=${reason} manualActive=${manualActive} animate=${animateCamera} follow=${this.config.selectionCameraFollowEnabled} shouldAnimate=${shouldAnimateCamera}`,
    );
    if (shouldAnimateCamera) {
      if (manualActive && reason === 'auto') {
        this.setManualCameraOverride(false);
      }
      const anchor = target.mesh.getAbsolutePosition().clone();
      const normal =
        this.currentSelectionNormalWorld ?? this.cubeField.getLiftNormalWorld(target);
      this.cameraController.focusOnTarget(anchor, {
        mode: this.config.camera.orbitMode,
        animate: true,
        followMode: this.config.camera.followMode,
        normal,
      });
    }
  }

  private updateBillboard(
    cell: CubeCell | null,
    options?: { animate?: boolean; reason?: 'manual' | 'auto' | 'system' },
  ): void {
    const animate = options?.animate ?? true;
    const reason = options?.reason ?? 'system';
    const manualActive = this.cameraController.isManualOverrideActive();
    this.arController.showContent(cell?.content ?? null);

    if (!cell) {
      this.billboardOverlay.deselect(animate);
      this.selectionChange?.(null);
      this.billboardStateChange?.(null);
      this.connector.hide();
      this.currentBillboardInfo = null;
      this.currentBillboardCell = null;
      this.currentSelectionNormalWorld = null;
      this.billboardScreenMetrics = null;
      if (this.config.selectionCameraFollowEnabled && !manualActive) {
        this.cameraController.focusOnOverview(animate);
        if (this.config.depthOfFieldEnabled && this.config.depthOfFieldAutoFocusEnabled) {
          const cameraPos = this.sceneController.getCamera().position.clone();
          this.updateDepthOfFieldFocus(null, cameraPos);
        }
      }
      if (!this.config.depthOfFieldAutoFocusEnabled && !manualActive) {
        this.cameraController.setManualOverride(true);
      }
      return;
    }
    const info = this.cubeField.getSelectionInfo();
    if (!info) {
      this.billboardOverlay.deselect(false);
      this.selectionChange?.(null);
      this.billboardStateChange?.(null);
      this.connector.hide();
      this.currentBillboardInfo = null;
      this.currentBillboardCell = null;
      return;
    }
    const prevInfo = this.currentBillboardInfo;
    const contentChanged =
      !prevInfo ||
      this.currentBillboardCell !== cell ||
      prevInfo.gridX !== info.gridX ||
      prevInfo.gridZ !== info.gridZ ||
      prevInfo.textureUrl !== info.textureUrl ||
      (prevInfo.content?.id ?? null) !== (info.content?.id ?? null);
    if (contentChanged) {
      this.billboardContentVersion += 1;
    }
    if (manualActive && this.currentBillboardCell !== cell && reason !== 'manual') {
      this.setManualCameraOverride(false);
    }
    this.billboardScreenMetrics = null;
    this.billboardOverlay.select(cell, info);
    this.selectionChange?.(info);
    this.currentBillboardInfo = info;
    this.currentBillboardCell = cell;
    this.emitHtmlBillboardState();
  }

  private refreshAutoSequence(): void {
    this.autoSequence = this.cubeField.getAllCells();
    this.autoSequenceIndex = 0;
  }

  private getNextAutoSequenceCell(): CubeCell | null {
    if (this.autoSequence.length === 0) {
      this.refreshAutoSequence();
    }
    const total = this.autoSequence.length;
    if (total === 0) return null;
    let attempts = 0;
    while (attempts < total) {
      const candidate = this.autoSequence[this.autoSequenceIndex % total];
      this.autoSequenceIndex = (this.autoSequenceIndex + 1) % total;
      attempts += 1;
      if (!candidate) continue;
      if (candidate.mesh.isDisposed()) continue;
      if (candidate.isSelected) continue;
      return candidate;
    }
    this.refreshAutoSequence();
    const refreshedTotal = this.autoSequence.length;
    attempts = 0;
    while (attempts < refreshedTotal) {
      const candidate = this.autoSequence[this.autoSequenceIndex % refreshedTotal];
      this.autoSequenceIndex = (this.autoSequenceIndex + 1) % refreshedTotal;
      attempts += 1;
      if (!candidate) continue;
      if (candidate.mesh.isDisposed()) continue;
      if (candidate.isSelected) continue;
      return candidate;
    }
    return null;
  }

  private performAutoSelection(cell: CubeCell): void {
    const triggerRipple = this.hoverInteractionEnabled && !this.physicsActive;
    this.commitSelection(cell, {
      triggerRipple,
      animateCamera: true,
      reason: 'auto',
    });
  }

  private resolvePickInfo(pointerInfo: PointerInfo, silent = false): PickingInfo | null {
    if (pointerInfo.pickInfo?.hit && pointerInfo.pickInfo.pickedMesh) {
      return pointerInfo.pickInfo;
    }
    
    const canvas = this.engine.getRenderingCanvas();
    if (!canvas) return null;
    
    const event = pointerInfo.event as PointerEvent | MouseEvent | null;
    if (!event) return null;
    
    // Get coordinates relative to canvas
    let x = 0;
    let y = 0;
    
      if ('offsetX' in event && typeof event.offsetX === 'number' && typeof event.offsetY === 'number') {
      x = event.offsetX;
      y = event.offsetY;
    } else if ('clientX' in event && 'clientY' in event) {
      const rect = canvas.getBoundingClientRect();
      x = event.clientX - rect.left;
      y = event.clientY - rect.top;
    } else {
      return null;
    }
    
    // Scale coordinates to canvas internal resolution
        const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const scaledX = x * scaleX;
    const scaledY = y * scaleY;
    
    // Try picking with scaled coordinates
    const pickResult = this.scene.pick(scaledX, scaledY, (mesh) => mesh.isPickable);
    
        if (!silent) {
      const pickableMeshes = this.scene.meshes.filter((m) => m.isPickable);
      this.logDebug(`pick(${Math.round(x)}, ${Math.round(y)}) scaled to (${Math.round(scaledX)}, ${Math.round(scaledY)}) => ${pickResult?.pickedMesh?.name ?? 'none'} [${pickableMeshes.length} pickable, canvas ${canvas.width}x${canvas.height}, display ${Math.round(rect.width)}x${Math.round(rect.height)}]`);
    }

    if (pickResult && pickResult.hit && pickResult.pickedMesh) {
      return pickResult;
    }

    const camera = this.sceneController.getCamera();
    const ray = this.scene.createPickingRay(scaledX, scaledY, Matrix.Identity(), camera);
    const rayPick = this.scene.pickWithRay(ray, (mesh) => mesh.isPickable);

    if (!silent) {
      this.logDebug(`ray pick => ${rayPick?.pickedMesh?.name ?? 'none'}`);
    }

    if (rayPick && rayPick.hit && rayPick.pickedMesh) {
      return rayPick;
    }

    // fallback: try center of canvas or selection direction
    const fallbackCanvas = this.engine.getRenderingCanvas();
    if (!fallbackCanvas) return null;
    const centerPick = this.scene.pick(fallbackCanvas.width / 2, fallbackCanvas.height / 2, (mesh) => mesh.isPickable);
    if (centerPick && centerPick.hit && centerPick.pickedMesh) {
      return centerPick;
    }
    return null;
  }

  private logDebug(line: string): void {
    if (!this.debug) return;
    this.debug(line);
  }

  public async setContent(items: CubeContentItem[], options?: Partial<CubeContentOptions>): Promise<void> {
    console.info('[CubeWallPresenter] setContent', {
      items: items.length,
      hasOptions: Boolean(options),
    });
    this.contentItems = items;
    this.contentOptionsSnapshot = options
      ? {
          ...options,
          layout: options.layout ? { ...options.layout } : options.layout,
        }
      : undefined;
    await this.cubeField.setContent(items, options);
    if (this.currentBillboardCell) {
      this.updateBillboard(this.currentBillboardCell, { animate: false, reason: 'system' });
    } else {
      this.emitHtmlBillboardState();
    }
  }

  public randomizeFieldOrientation(): void {
    this.cubeField.randomizeFieldOrientation();
    this.logDebug('[Field] Randomized orientation');
  }

  public resetCameraToDefaults(): void {
    this.pendingWheelSyncFrames = 0;
    this.setManualCameraOverride(false);
    if (this.config.selectionCameraFollowEnabled && this.currentBillboardCell) {
      const anchor = this.currentBillboardCell.mesh.getAbsolutePosition().clone();
      this.currentSelectionNormalWorld = this.cubeField.getLiftNormalWorld(this.currentBillboardCell);
      this.cameraController.focusOnTarget(anchor, {
        mode: this.config.camera.orbitMode,
        animate: true,
        followMode: this.config.camera.followMode,
        normal: this.currentSelectionNormalWorld,
      });
    } else {
      this.currentSelectionNormalWorld = null;
      this.cameraController.focusOnOverview(true);
    }
    this.syncRelativeCameraSettings();
  }

  public triggerLineWaveField(): void {
    const started = this.cubeField.startLineWaveField();
    if (started) {
      this.logDebug('[Field] Morphing to Wave Line');
    } else {
      this.logDebug('[Field] Wave Line already active');
    }
  }

  public toggleFieldAutoRotation(): void {
    const active = this.cubeField.toggleFieldAutoRotation();
    this.logDebug(active ? '[Field] Auto-rotation enabled' : '[Field] Auto-rotation disabled');
  }

  public startFieldMorph(): void {
    const result = this.cubeField.startFieldMorph();
    if (!result) {
      this.logDebug('[Field] Morph request ignored (already morphing or no alternate field)');
      return;
    }
    this.logDebug(`[Field] Morphing ${result.current} → ${result.next}`);
  }

  public captureCameraRelativeOffset(): { offset: Vector3; lookAtOffset: Vector3 } | null {
    const selection = this.currentBillboardCell ?? this.cubeField.getCurrentSelection();
    if (!selection) {
      this.logDebug('[Camera] Capture relative offset ignored (no selection).');
      return null;
    }
    const anchor = selection.mesh.getAbsolutePosition().clone();
    const normal =
      this.currentSelectionNormalWorld ?? this.cubeField.getLiftNormalWorld(selection);
    const capture = this.cameraController.captureRelativeOffset(anchor, normal);
    this.config.camera.relativeOffset.x = capture.offset.x;
    this.config.camera.relativeOffset.y = capture.offset.y;
    this.config.camera.relativeOffset.z = capture.offset.z;
    this.config.camera.relativeLookAtOffset.x = capture.lookAtOffset.x;
    this.config.camera.relativeLookAtOffset.y = capture.lookAtOffset.y;
    this.config.camera.relativeLookAtOffset.z = capture.lookAtOffset.z;
    const radius = this.sceneController.getCamera().radius;
    if (Number.isFinite(radius)) {
      this.config.camera.radius = radius;
    }
    const currentCell = this.currentBillboardCell ?? this.cubeField.getCurrentSelection();
    if (currentCell) {
      const anchorPos = currentCell.mesh.getAbsolutePosition().clone();
      const toCamera = this.sceneController.getCamera().position.subtract(anchorPos);
      const distance = toCamera.length();
      if (Number.isFinite(distance)) {
        this.config.camera.flyToRadiusFactor = distance / this.config.cubeSize;
      }
    }
    this.cameraController.setManualOverride(false);
    this.cameraSettingsChange?.({
      cameraRelativeOffsetX: capture.offset.x,
      cameraRelativeOffsetY: capture.offset.y,
      cameraRelativeOffsetZ: capture.offset.z,
      cameraRelativeLookAtOffsetX: capture.lookAtOffset.x,
      cameraRelativeLookAtOffsetY: capture.lookAtOffset.y,
      cameraRelativeLookAtOffsetZ: capture.lookAtOffset.z,
      cameraRadius: this.config.camera.radius,
      flyToRadiusFactor: this.config.camera.flyToRadiusFactor,
    });
    return capture;
  }

  public start(): void {
    this.engine.runRenderLoop(() => {
      if (this.disposed) return;
      let deltaTime = this.engine.getDeltaTime() / 1000;
      if (deltaTime > 0.2) {
        deltaTime = 0.016;
        this.sceneTime = 0;
      }
      this.sceneTime += deltaTime * this.config.waveSpeed;
      this.cubeField.update(deltaTime, this.sceneTime);
      this.updateAutoSelection(deltaTime);
      if (this.config.selectionCameraFollowEnabled && this.config.camera.followMode === 'continuous') {
        const followCell = this.currentBillboardCell ?? this.cubeField.getCurrentSelection();
        if (followCell) {
          this.cameraController.updateContinuousTarget(
            followCell.mesh.getAbsolutePosition(),
            this.currentSelectionNormalWorld ?? undefined,
          );
        }
      }
      this.cameraController.update(deltaTime);
      if (this.pendingWheelSyncFrames > 0) {
        this.pendingWheelSyncFrames -= 1;
        if (this.pendingWheelSyncFrames === 0) {
          this.syncRelativeCameraSettings();
        }
      }
      if (this.config.depthOfFieldEnabled && this.config.depthOfFieldAutoFocusEnabled && this.currentBillboardCell) {
        const cameraPos = this.sceneController.getCamera().position.clone();
        this.updateDepthOfFieldFocus(this.currentBillboardCell, cameraPos);
        if (this.pendingDofUpdateFrames > 0) {
          this.pendingDofUpdateFrames -= 1;
        }
      }
      this.billboardOverlay.update();
      if (this.config.billboard.mode === 'html' && this.currentBillboardCell && this.currentBillboardInfo) {
        this.emitHtmlBillboardState();
      }
      const camera = this.sceneController.getCamera();
      const cameraPos = camera.position;
      const cameraTarget = camera.target;
      if (
        !Number.isFinite(this.lastAxisCameraPos.x) ||
        Vector3.DistanceSquared(this.lastAxisCameraPos, cameraPos) > 1e-4 ||
        Vector3.DistanceSquared(this.lastAxisCameraTarget, cameraTarget) > 1e-4
      ) {
        this.lastAxisCameraPos.copyFrom(cameraPos);
        this.lastAxisCameraTarget.copyFrom(cameraTarget);
        this.axisLabelsDirty = true;
      }
      if (
        this.axisLabelsDirty &&
        this.config.axisLabels.enabled &&
        this.config.axisLabels.mode === 'overlay'
      ) {
        this.emitAxisLabelsState();
      }
      this.connector.updateFade(deltaTime);
      this.scene.render();
    });
  }

  public selectNextCube(forceFirst?: boolean): void {
    let cell: CubeCell | null;
    if (forceFirst) {
      const allCells: CubeCell[] = this.cubeField.getAllCells();
      cell = allCells.find((candidate: CubeCell) => !candidate.isSelected) ?? allCells[0] ?? null;
    } else {
      cell = this.getNextAutoSequenceCell();
      if (!cell) {
        cell = this.cubeField.getRandomCell(true);
      }
    }
    if (!cell) {
      this.logDebug('[AutoSelect] No cubes available.');
      return;
    }
    if (cell.isSelected) {
      const fallback = this.cubeField.getRandomCell(false);
      if (fallback) {
        cell = fallback;
      } else {
        return;
      }
    }
    this.autoSelectElapsed = 0;
    this.performAutoSelection(cell);
  }

  public selectRandomCube(): void {
    const cell = this.cubeField.getRandomCell(true);
    if (!cell) {
      this.logDebug('[AutoSelect] No cubes available for random selection.');
      return;
    }
    this.autoSelectElapsed = 0;
    this.performAutoSelection(cell);
  }

  public debugAxisSummary(): void {
    const snapshot = this.cubeField.getAxisValuesSnapshot();
    const rows = snapshot.rows
      .map((info, index) => {
        const base = this.formatDateLabelFromInput(info.label) || `Zeile ${index + 1}.`;
        const plus = this.formatPlusSuffix(info.count);
        return `${base}${plus}`.trim();
      })
      .filter((value) => value.length > 0);
    const columns = snapshot.columns
      .map((info, index) => {
        const base = info.label ?? `Spalte ${index + 1}`;
        const plus = this.formatPlusSuffix(info.count);
        return `${base}${plus}`.trim();
      })
      .filter((value) => value.length > 0);
    this.logDebug(
      `[AxisSummary] rows (first 10): ${rows.slice(0, 10).join(' | ') || '—'}`,
    );
    this.logDebug(
      `[AxisSummary] columns (first 10): ${columns.slice(0, 10).join(' | ') || '—'}`,
    );
  }

  private formatDateLabelFromInput(input: string | number | null | undefined): string {
    if (input === null || input === undefined) {
      return '';
    }
    const date =
      typeof input === 'number'
        ? new Date(input)
        : new Date(input);
    if (!Number.isNaN(date.getTime())) {
      const formatted = this.axisLabelDateFormatter.format(date);
      return formatted.endsWith('.') ? formatted : `${formatted}.`;
    }
    if (typeof input === 'string' && input.length > 0) {
      return input.endsWith('.') ? input : `${input}.`;
    }
    return '';
  }

  private formatPlusSuffix(count: number): string {
    if (!Number.isFinite(count) || count <= 0) {
      return '';
    }
    const capped = Math.min(count, 12);
    const icons = Array.from({ length: capped }, () => '(+)').join('');
    const overflow = count > capped ? ` (+${count - capped})` : '';
    return `  ${icons}${overflow}`;
  }

  public applySettings(settings: PresenterSettings): void {
    this.logDebug(
      `[Camera] applySettings start manualOverride=${this.cameraController.isManualOverrideActive()}`,
    );
    const previousGeometryMode = this.config.geometryMode;
    const previousTileDepth = this.config.tileDepth;
    const previousTileAspectMode = this.config.tileAspectMode;
    const previousOrientation = this.config.baseOrientation;
    const previousWavePosition = this.config.wavePositionEnabled;
    const previousWaveRotation = this.config.waveRotationEnabled;
    const previousTileCaptions = this.config.tiles.captionsEnabled;
    const targetGridSize = Math.min(Math.max(3, Math.round(settings.gridSize)), this.config.maxGridSize);
    if (targetGridSize !== this.config.gridSize) {
      this.config.gridSize = targetGridSize;
      this.cubeField.rebuild(this.config.gridSize);
      this.refreshAutoSequence();
      this.updateBillboard(null, { animate: false, reason: 'system' });
      this.refreshAxisAnchors();
    }

    this.config.waveSpeed = settings.waveSpeed;
    this.config.wavePositionEnabled = settings.wavePositionEnabled;
    this.config.waveRotationEnabled = settings.waveRotationEnabled;
    this.config.waveAmplitudeY = settings.waveAmplitudeY;
    this.config.waveFrequencyY = settings.waveFrequencyY;
    this.config.wavePhaseSpread = settings.wavePhaseSpread;
    this.config.waveAmplitudeRot = settings.waveAmplitudeRot;
    this.config.waveFrequencyRot = settings.waveFrequencyRot;
    this.config.fieldAnimationSpeed = Math.max(0, settings.fieldAnimationSpeed);
    this.config.fieldGlobalScale = Math.max(0.1, settings.fieldGlobalScale);
    this.hoverInteractionEnabled = settings.enableHoverInteraction;
    this.autoSelectEnabled = settings.autoSelectEnabled;
    this.autoSelectInterval = Math.max(1, settings.autoSelectInterval);
    this.autoSelectElapsed = this.autoSelectEnabled ? Math.min(this.autoSelectElapsed, this.autoSelectInterval) : 0;
    this.config.interactionRadius = settings.interactionRadius;
    this.config.interactionLift = settings.interactionLift;
    this.config.selectedCubeRotation = settings.selectedCubeRotation;
    this.config.selectedCubePopOutDistance = settings.selectedCubePopOutDistance;
    this.config.selectedCubeLift = settings.selectedCubeLift;
    this.config.selectedCubeNormalDirection = settings.selectedCubeNormalDirection;
    this.config.slowAutorotateEnabled = settings.slowAutorotateEnabled;
    this.config.slowAutorotateSpeed = settings.slowAutorotateSpeed;
    this.config.selectionCameraFollowEnabled = settings.selectionCameraFollowEnabled;
    this.config.camera.radius = settings.cameraRadius;
    this.config.camera.flyToRadiusFactor = settings.flyToRadiusFactor;
    this.config.camera.lerpSpeedFactor = settings.cameraLerpSpeed;
    this.config.camera.useCustomView = settings.useCustomCamera;
    this.config.camera.offset.x = settings.cameraOffsetX;
    this.config.camera.offset.y = settings.cameraOffsetY;
    this.config.camera.offset.z = settings.cameraOffsetZ;
    this.config.camera.lookAtOffset.x = settings.cameraLookAtOffsetX;
    this.config.camera.lookAtOffset.y = settings.cameraLookAtOffsetY;
    this.config.camera.lookAtOffset.z = settings.cameraLookAtOffsetZ;
    this.config.camera.animationSpeedFactor = settings.cameraAnimationSpeed;
    this.config.camera.orbitMode = settings.cameraOrbitMode;
    this.config.camera.followMode = settings.cameraFollowMode;
    this.config.camera.relativeOffset.x = settings.cameraRelativeOffsetX;
    this.config.camera.relativeOffset.y = settings.cameraRelativeOffsetY;
    this.config.camera.relativeOffset.z = settings.cameraRelativeOffsetZ;
    this.config.camera.relativeLookAtOffset.x = settings.cameraRelativeLookAtOffsetX;
    this.config.camera.relativeLookAtOffset.y = settings.cameraRelativeLookAtOffsetY;
    this.config.camera.relativeLookAtOffset.z = settings.cameraRelativeLookAtOffsetZ;
    this.config.camera.autoOrbitEnabled = settings.cameraAutoOrbitEnabled;
    this.config.camera.autoOrbitSpeed = settings.cameraAutoOrbitSpeed;
    this.config.physicsSelectedRotationMode = settings.physicsSelectedRotationMode;
    this.config.physicsSelectedRotationSpeed = settings.physicsSelectedRotationSpeed;
    this.config.physicsLiftSpeed = settings.physicsLiftSpeed;
    this.config.geometryMode = settings.geometryMode;
    this.config.tileDepth = settings.tileDepth;
    this.config.tileAspectMode = settings.tileAspectMode;
    this.config.baseOrientation = settings.baseOrientation;
    this.config.tiles.captionsEnabled = settings.tileCaptionsEnabled;
    this.config.tiles.text.tileWidth = settings.textTileWidth;
    this.config.tiles.text.verticalGap = settings.textTileVerticalGap;
    this.config.tiles.text.glassAlpha = settings.textTileGlassAlpha;
    this.config.masonry.columnCount = Math.max(1, Math.round(settings.masonryColumnCount));
    this.config.masonry.columnSpacing = settings.masonryColumnSpacing;
    this.config.masonry.rowSpacing = settings.masonryRowSpacing;
    this.config.ambientLightIntensity = settings.ambientLightIntensity;
    this.config.ambientLightColorHex = settings.ambientLightColorHex;
    this.config.directionalLightIntensity = settings.directionalLightIntensity;
    this.config.directionalLightColorHex = settings.directionalLightColorHex;
    this.config.directionalLightDirection.x = settings.directionalLightDirectionX;
    this.config.directionalLightDirection.y = settings.directionalLightDirectionY;
    this.config.directionalLightDirection.z = settings.directionalLightDirectionZ;
    this.config.fillLightEnabled = settings.fillLightEnabled;
    this.config.fillLightIntensity = settings.fillLightIntensity;
    this.config.fillLightColorHex = settings.fillLightColorHex;
    this.config.fillLightDirection.x = settings.fillLightDirectionX;
    this.config.fillLightDirection.y = settings.fillLightDirectionY;
    this.config.fillLightDirection.z = settings.fillLightDirectionZ;
    this.config.background.type = settings.backgroundType;
    this.config.background.solidColorHex = settings.backgroundSolidHex;
    this.config.background.gradientTopHex = settings.backgroundGradientTopHex;
    this.config.background.gradientBottomHex = settings.backgroundGradientBottomHex;
    this.config.billboard.heightOffset = settings.billboardHeightOffset;
    this.config.billboard.distance = settings.billboardDistance;
    this.config.billboard.angleDegrees = settings.billboardAngleDegrees;
    this.config.textureUvLayout = settings.textureUvLayout;
    const uvLayout = (() => {
      switch (settings.textureUvLayout) {
        case 'mirrorTopAndAlternatingSides':
          return { sidePattern: 'alternating' as const, mirrorTopBottom: true };
        case 'uniformSides':
        case 'standard':
        default:
          return { sidePattern: 'uniform' as const, mirrorTopBottom: false };
      }
    })();
    const { sidePattern, mirrorTopBottom } = uvLayout;
    this.config.textureSidePattern = sidePattern;
    this.config.textureMirrorTopBottom = mirrorTopBottom;
    this.config.billboard.mode = settings.billboardMode;
    this.config.billboard.htmlContent = settings.billboardHtmlContent;
    this.config.billboard.connectorMode = settings.billboardConnectorMode;
    this.config.billboard.connectorThicknessPx = settings.billboardConnectorThicknessPx;
    this.config.billboard.connectorFeatherPx = settings.billboardConnectorFeatherPx;
    this.config.axisLabels.enabled = settings.axisLabelsEnabled;
    this.config.axisLabels.startDateIso = settings.axisLabelsStartDate;
    this.config.axisLabels.stepDays = Math.max(1, settings.axisLabelsStepDays);
    this.config.axisLabels.template = settings.axisLabelsTemplate;
    this.config.axisLabels.offset.x = settings.axisLabelsOffsetX;
    this.config.axisLabels.offset.y = settings.axisLabelsOffsetY;
    this.config.axisLabels.offset.z = settings.axisLabelsOffsetZ;
    this.updateAxisLabelStartDate();
    if (this.config.axisLabels.enabled) {
      this.refreshAxisAnchors();
    } else {
      this.axisLabelStateChange?.([]);
      this.axis3DLabelManager.update([], this.sceneController.getCamera().position);
    }

    this.axisLabelsDirty = true;
    this.sceneController.updateLightingFromConfig();
    this.sceneController.updateBackgroundFromConfig();
    this.sceneController.updateDepthOfFieldFromConfig();
    if (this.config.depthOfFieldAutoFocusEnabled) {
      this.updateDepthOfFieldFocus(null);
    }
    this.cameraController.applySettings(settings);
    this.logDebug(
      '[Camera] applySettings end',
    );
    this.cubeField.updateTextureUvLayout({
      layout: settings.textureUvLayout,
      sidePattern,
      mirrorTopBottom,
    });
    this.emitHtmlBillboardState();
    this.emitAxisLabelsState();

    if (
      previousGeometryMode !== this.config.geometryMode ||
      previousTileDepth !== this.config.tileDepth ||
      previousTileAspectMode !== this.config.tileAspectMode ||
      previousOrientation !== this.config.baseOrientation
    ) {
      this.cubeField.applyGeometrySettings();
    }

    if (
      previousWavePosition !== this.config.wavePositionEnabled ||
      previousWaveRotation !== this.config.waveRotationEnabled
    ) {
      this.cubeField.requestLayoutRefresh();
    }

    if (
      this.config.geometryMode === 'tile' &&
      (previousGeometryMode !== this.config.geometryMode ||
        previousTileCaptions !== this.config.tiles.captionsEnabled) &&
      this.contentItems.length > 0
    ) {
      const snapshot = this.contentOptionsSnapshot
        ? {
            ...this.contentOptionsSnapshot,
            layout: this.contentOptionsSnapshot.layout ? { ...this.contentOptionsSnapshot.layout } : undefined,
          }
        : undefined;
      void this.setContent(this.contentItems.slice(), snapshot);
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.debugProbeTimer) {
      clearTimeout(this.debugProbeTimer);
      this.debugProbeTimer = null;
    }
    if (this.wheelListener) {
      this.canvasElement.removeEventListener('wheel', this.wheelListener);
      this.wheelListener = null;
    }
    this.connector.dispose();
    this.arController.dispose();
    this.cubeField.dispose();
    this.billboardOverlay.dispose();
    this.sceneController.dispose();
    this.axisLabelStateChange?.([]);
    this.axis3DLabelManager.dispose();
  }

  private updateAutoSelection(deltaTime: number): void {
    if (!this.autoSelectEnabled || this.physicsActive) return;
    this.autoSelectElapsed += deltaTime;
    if (this.autoSelectElapsed < this.autoSelectInterval) return;
    this.autoSelectElapsed = 0;

    let cell = this.getNextAutoSequenceCell();
    if (!cell) {
      cell = this.cubeField.getRandomCell(true);
    }
    if (!cell || cell.isSelected) return;

    this.performAutoSelection(cell);
  }

  private readonly handleHtmlBillboardClose = () => {
    this.cubeField.selectCell(null);
    this.updateBillboard(null, { reason: 'manual' });
  };

  private emitHtmlBillboardState(): void {
    if (!this.billboardStateChange) return;
    if (this.config.billboard.mode !== 'html' || !this.currentBillboardCell || !this.currentBillboardInfo) {
      this.billboardStateChange(null);
      this.connector.hide();
      this.lastEmittedBillboard = null;
      return;
    }

    const camera = this.sceneController.getCamera();
    const engine = this.scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    if (!canvas) {
      this.billboardStateChange(null);
      this.connector.hide();
      return;
    }

    const attachmentWorld = this.billboardOverlay.getAttachmentWorldPosition();
    const cubeAnchor = this.currentBillboardCell.mesh.getAbsolutePosition().clone();
    const worldPosition = attachmentWorld.clone();

    const renderWidth = engine.getRenderWidth();
    const renderHeight = engine.getRenderHeight();
    const viewport = camera.viewport.toGlobal(renderWidth, renderHeight);
    const transform = camera.getTransformationMatrix();
    const overlayProjected = Vector3.Project(attachmentWorld, Matrix.Identity(), transform, viewport);
    const cubeProjected = Vector3.Project(cubeAnchor, Matrix.Identity(), transform, viewport);

    const rect = canvas.getBoundingClientRect();
    const normalizedOverlayX = (overlayProjected.x - viewport.x) / viewport.width;
    const normalizedOverlayY = (overlayProjected.y - viewport.y) / viewport.height;
    const normalizedCubeX = (cubeProjected.x - viewport.x) / viewport.width;
    const normalizedCubeY = (cubeProjected.y - viewport.y) / viewport.height;
    const screenX = rect.left + normalizedOverlayX * rect.width;
    const screenY = rect.top + normalizedOverlayY * rect.height;
    const cubeScreenX = rect.left + normalizedCubeX * rect.width;
    const cubeScreenY = rect.top + normalizedCubeY * rect.height;
    const isVisible =
      overlayProjected.z >= 0 && overlayProjected.z <= 1 &&
      cubeProjected.z >= 0 && cubeProjected.z <= 1 &&
      normalizedOverlayX >= 0 && normalizedOverlayX <= 1 &&
      normalizedOverlayY >= 0 && normalizedOverlayY <= 1;

    const state: BillboardDisplayState = {
      worldPosition,
      screenX,
      screenY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      isVisible,
      cubeScreenX,
      cubeScreenY,
      frameId: this.billboardFrameId++,
      contentVersion: this.billboardContentVersion,
      content: {
        gridX: this.currentBillboardInfo.gridX,
        gridZ: this.currentBillboardInfo.gridZ,
        colorHex: this.currentBillboardInfo.color.toHexString(),
        textureLabel: this.getTextureLabel(this.currentBillboardInfo.textureUrl),
        item: this.currentBillboardCell.content ?? null,
      },
      onRequestClose: this.handleHtmlBillboardClose,
    };

    const last = this.lastEmittedBillboard;
    const unchanged =
      last &&
      last.content?.gridX === state.content?.gridX &&
      last.content?.gridZ === state.content?.gridZ &&
      last.contentVersion === state.contentVersion &&
      last.isVisible === state.isVisible &&
      Math.abs(last.screenX - state.screenX) < 0.5 &&
      Math.abs(last.screenY - state.screenY) < 0.5 &&
      Math.abs(last.cubeScreenX - state.cubeScreenX) < 0.5 &&
      Math.abs(last.cubeScreenY - state.cubeScreenY) < 0.5 &&
      last.viewportWidth === state.viewportWidth &&
      last.viewportHeight === state.viewportHeight;

    if (!unchanged) {
      const emittedState = cloneBillboardState(state);
      this.lastEmittedBillboard = emittedState;
      this.billboardStateChange(emittedState);
    }
    this.connector.update(state, cubeAnchor, attachmentWorld, rect);
  }

  private getAxisLabelAxes(): AxisLabelAxis[] {
    const recommended = this.cubeField.getRecommendedAxisLabelAxes();
    const axes = this.config.axisLabels.axes;
    if (Array.isArray(axes) && axes.length > 0) {
      const normalized = axes
        .map((axis) => (axis === 'columns' ? 'columns' : 'rows'))
        .filter((axis, index, arr) => arr.indexOf(axis) === index) as AxisLabelAxis[];
      if (recommended.length === 0) {
        return normalized;
      }
      const filtered = normalized.filter((axis) => recommended.includes(axis));
      if (filtered.length > 0) {
        return filtered;
      }
    }
    if (recommended.length > 0) {
      return recommended;
    }
    return ['rows'];
  }

  private computeAxisLabelData(): AxisLabelData[] {
    if (!this.config.axisLabels.enabled) {
      return [];
    }

    const offsetVector = new Vector3(
      this.config.axisLabels.offset.x,
      this.config.axisLabels.offset.y,
      this.config.axisLabels.offset.z,
    );

    const template = this.config.axisLabels.template || '{{row1}}';
    const startDateMs = this.axisLabelStartDateMs;
    const hasValidDate = Number.isFinite(startDateMs);

    const labels: AxisLabelData[] = [];

    const axes = this.getAxisLabelAxes();

    axes.forEach((axis) => {
      const anchors = this.cubeField.getAxisAnchors(axis);
      anchors.forEach((anchor, index) => {
        const worldPosition = anchor.add(offsetVector);

        let labelText = template;
        labelText = labelText.split('{{axis}}').join(axis);
        const axisInfo = this.cubeField.getAxisValueInfo(axis, index);
        const axisValueLabel = axisInfo?.label ?? '';
        labelText = labelText.split('{{value}}').join(axisValueLabel);

        if (axis === 'rows') {
          const count = axisInfo?.count ?? 0;
          const formattedFromTimestamp = this.formatDateLabelFromInput(axisInfo?.timestamp);
          const formattedFromLabel = this.formatDateLabelFromInput(axisInfo?.label ?? null);
          const formattedFromValue = this.formatDateLabelFromInput(axisValueLabel);
          let baseLabel =
            formattedFromTimestamp ||
            formattedFromLabel ||
            formattedFromValue;
          if (!baseLabel && hasValidDate) {
            const fallbackDate = startDateMs + index * this.config.axisLabels.stepDays * DAY_MS;
            baseLabel = this.formatDateLabelFromInput(fallbackDate);
          }
          if (!baseLabel) {
            baseLabel = `Zeile ${index + 1}.`;
          }
          const plusSuffix = this.formatPlusSuffix(count);
          labelText = `${baseLabel}${plusSuffix}`.trim();
        } else {
          labelText = labelText.split('{{col}}').join(index.toString());
          labelText = labelText.split('{{col1}}').join((index + 1).toString());
          labelText = labelText.split('{{row}}').join('');
          labelText = labelText.split('{{row1}}').join('');
          labelText = labelText.split('{{date}}').join('');
          const plusSuffix = this.formatPlusSuffix(axisInfo?.count ?? 0);
          if (plusSuffix) {
            const trimmed = labelText.trim();
            labelText = trimmed ? `${trimmed}${plusSuffix}` : plusSuffix.trim();
          }
        }

        if (labelText.trim()) {
          labels.push({
            id: `axis-${axis}-${index}`,
            axis,
            text: labelText,
            worldPosition,
          });
        }
      });
    });

    return labels;
  }

  private refreshAxisAnchors(): void {
    this.updateAxis3DLabels();
    this.axisLabelsDirty = true;
  }

  private updateAxisLabelStartDate(): void {
    const parsed = Date.parse(this.config.axisLabels.startDateIso);
    this.axisLabelStartDateMs = Number.isNaN(parsed) ? Number.NaN : parsed;
  }

  private emitAxisLabelsState(): void {
    if (!this.axisLabelStateChange) return;

    if (!this.config.axisLabels.enabled || this.config.axisLabels.mode !== 'overlay') {
      this.axisLabelStateChange([]);
      this.axisLabelsDirty = false;
      return;
    }
    const data = this.computeAxisLabelData();
    if (!data.length) {
      this.axisLabelStateChange([]);
      this.axisLabelsDirty = false;
      return;
    }

    const engine = this.scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    if (!canvas) {
      this.axisLabelStateChange([]);
      this.axisLabelsDirty = false;
      return;
    }

    const camera = this.sceneController.getCamera();
    const transform = camera.getTransformationMatrix();
    const viewport = camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight());
    const rect = canvas.getBoundingClientRect();

    const labels: AxisLabelDisplayState[] = [];

    data.forEach((label) => {
      const projected = Vector3.Project(label.worldPosition, Matrix.Identity(), transform, viewport);
      if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || projected.z < 0 || projected.z > 1) {
        return;
      }
      const normalizedX = (projected.x - viewport.x) / viewport.width;
      const normalizedY = (projected.y - viewport.y) / viewport.height;
      if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) {
        return;
      }
      labels.push({
        id: label.id,
        label: label.text,
        axis: label.axis,
        screenX: rect.left + normalizedX * rect.width,
        screenY: rect.top + normalizedY * rect.height,
      });
    });

    this.axisLabelStateChange(labels);
    this.axisLabelsDirty = false;
  }

  private updateAxis3DLabels(): void {
    if (!this.config.axisLabels.enabled || this.config.axisLabels.mode !== '3d') {
      this.axis3DLabelManager.update([], this.sceneController.getCamera().position);
      return;
    }

    const data = this.computeAxisLabelData();
    this.axis3DLabelManager.update(data, this.sceneController.getCamera().position);
  }

  private getTextureLabel(url: string | null): string {
    if (!url) return '—';
    try {
      const parsed = new URL(url);
      const path = parsed.pathname.split('/').filter(Boolean).pop();
      return path ?? url;
    } catch {
      const parts = url.split('/');
      return parts.pop() || url;
    }
  }
}
