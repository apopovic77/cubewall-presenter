import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { SceneController } from './SceneController';
import { CubeField } from './CubeField';
import type { CubeSelectionInfo } from './CubeField';
import type { CubeCell } from './CubeField';
import type { CubeContentOptions } from './CubeField';
import { appConfig } from '../config/AppConfig';
import type { CubeWallConfig, AxisLabelAxis } from '../config/AppConfig';
import type { PresenterSettings } from '../config/PresenterSettings';
import { BillboardOverlay } from './BillboardOverlay';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import type { CubeContentItem } from '../types/content';
import { CameraOrbitController } from './CameraOrbitController';
import { ArSessionController } from './xr/ArSessionController';
import { BillboardConnector } from './presentation/BillboardConnector';
import { AxisLabelController } from './presentation/AxisLabelController';
import { AutoSelectionTimer } from './selection/AutoSelectionTimer';
import { PointerInteractionController } from './input/PointerInteractionController';
import type { ArMenuAction, ArMenuState } from './xr/menu/ArMenuModel';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';

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
  private readonly axisLabels: AxisLabelController;
  private readonly autoSelection = new AutoSelectionTimer();
  private readonly pointer: PointerInteractionController;
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
  private readonly cameraSettingsChange?: (update: Partial<PresenterSettings>) => void;
  private readonly cameraController: CameraOrbitController;
  private billboardContentVersion = 0;
  private currentBillboardInfo: CubeSelectionInfo | null = null;
  private currentBillboardCell: CubeCell | null = null;
  private currentSelectionNormalWorld: Vector3 | null = null;
  private billboardFrameId = 0;
  private sceneTime = 0;
  private disposed = false;
  private debugProbeTimer: ReturnType<typeof setTimeout> | null = null;
  private hoverInteractionEnabled = true;
  private contentItems: CubeContentItem[] = [];
  private contentOptionsSnapshot: Partial<CubeContentOptions> | undefined;
  private physicsActive = false;
  private physicsMode: 'off' | 'classic' | 'anchor' = 'off';
  private savedHoverInteraction = true;
  private billboardScreenMetrics: BillboardScreenMetrics | null = null;
  private pendingDofUpdateFrames = 0;
  private readonly forceDofFrames = 6;
  private pendingWheelSyncFrames = 0;
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
    this.axisLabels.markDirty();
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
      this.cubeField.selectCell(null);
      this.updateBillboard(null, { animate: false, reason: 'system' });
      this.selectionChange?.(null);
      this.billboardStateChange?.(null);
      this.physicsActive = true;
      this.physicsMode = 'classic';
      this.autoSelection.setSuspended(true);
      this.hoverInteractionEnabled = false;
      this.pointer.resetPhysicsDrag();
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
    this.autoSelection.setSuspended(false);
    this.pointer.resetPhysicsDrag();
    this.axisLabels.refreshAnchors();
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
    this.axisLabels.markDirty();
  }

  public debugAxisSummary(): void {
    this.axisLabels.debugSummary();
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
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const host = this;
    this.pointer = new PointerInteractionController(this.scene, this.canvasElement, {
      cubeField: this.cubeField,
      cameraController: this.cameraController,
      getCamera: () => this.sceneController.getCamera(),
      isDisposed: () => host.disposed,
      isArActive: () => host.arController.isActive,
      isPhysicsActive: () => host.physicsActive,
      isHoverEnabled: () => host.hoverInteractionEnabled,
      applySelection: (cell, meshName) => this.applySelection(cell, meshName),
      clearSelection: (animate) => {
        this.cubeField.selectCell(null);
        this.updateBillboard(null, { animate, reason: 'manual' });
      },
      setManualCameraOverride: (active) => this.setManualCameraOverride(active),
      syncRelativeCameraSettings: () => this.syncRelativeCameraSettings(),
      refocusDepthOfField: () => this.updateDepthOfFieldFocus(null),
      onWheel: () => {
        this.pendingWheelSyncFrames = 2;
      },
      logDebug: (line) => this.logDebug(line),
    });

    this.axisLabels = new AxisLabelController({
      scene: this.scene,
      config: this.config,
      cubeField: this.cubeField,
      getCamera: () => this.sceneController.getCamera(),
      onLabelsChange: onAxisLabelsChange,
      debug: (line) => this.logDebug(line),
    });
    this.autoSelection.setCells(this.cubeField.getAllCells());

    this.axisLabels.refreshAnchors();
    this.axisLabels.updateStartDate();

    this.billboardOverlay = new BillboardOverlay({
      scene: this.scene,
      config: this.config,
      onRequestClose: () => {
        this.cubeField.selectCell(null);
        this.updateBillboard(null, { animate: false, reason: 'manual' });
      },
    });

    this.axisLabels.emitState();
    this.axisLabels.update3DLabels();

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
    this.autoSelection.restart();
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

  private performAutoSelection(cell: CubeCell): void {
    const triggerRipple = this.hoverInteractionEnabled && !this.physicsActive;
    this.commitSelection(cell, {
      triggerRipple,
      animateCamera: true,
      reason: 'auto',
    });
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
      // Kiosk mode: the next cube is due every few seconds (not while physics runs).
      const autoCell = this.physicsActive
        ? null
        : this.autoSelection.update(
            deltaTime,
            () => this.cubeField.getAllCells(),
            () => this.cubeField.getRandomCell(true),
          );
      if (autoCell) this.performAutoSelection(autoCell);
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
      this.axisLabels.frame();
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
      cell = this.autoSelection.next(() => this.cubeField.getAllCells());
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
    this.autoSelection.restart();
    this.performAutoSelection(cell);
  }

  public selectRandomCube(): void {
    const cell = this.cubeField.getRandomCell(true);
    if (!cell) {
      this.logDebug('[AutoSelect] No cubes available for random selection.');
      return;
    }
    this.autoSelection.restart();
    this.performAutoSelection(cell);
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
      this.autoSelection.setCells(this.cubeField.getAllCells());
      this.updateBillboard(null, { animate: false, reason: 'system' });
      this.axisLabels.refreshAnchors();
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
    this.autoSelection.configure(settings.autoSelectEnabled, settings.autoSelectInterval);
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
    this.axisLabels.applySettings();
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
    this.axisLabels.emitState();

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
    this.pointer.dispose();
    this.connector.dispose();
    this.arController.dispose();
    this.cubeField.dispose();
    this.billboardOverlay.dispose();
    this.sceneController.dispose();
    this.axisLabels.dispose();
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
