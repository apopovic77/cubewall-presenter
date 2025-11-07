import { PointerEventTypes, PointerInfo } from '@babylonjs/core/Events/pointerEvents';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Culling/ray';
import { SceneController } from './SceneController';
import { CubeField } from './CubeField';
import type { CubeSelectionInfo } from './CubeField';
import type { CubeCell } from './CubeField';
import { appConfig, DOF_WORLD_TO_MM } from '../config/AppConfig';
import type { CubeWallConfig } from '../config/AppConfig';
import type { PresenterSettings } from '../config/PresenterSettings';
import type { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import { BillboardOverlay } from './BillboardOverlay';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Axis3DLabelManager, type AxisLabelData } from './Axis3DLabelManager';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BillboardDisplayState {
  worldPosition: Vector3;
  screenX: number;
  screenY: number;
  viewportWidth: number;
  viewportHeight: number;
  isVisible: boolean;
  cubeScreenX: number;
  cubeScreenY: number;
  content: {
    gridX: number;
    gridZ: number;
    colorHex: string;
    textureLabel: string;
  } | null;
  onRequestClose: () => void;
}

export interface AxisLabelDisplayState {
  id: string;
  label: string;
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
}

export class CubeWallPresenter {
  private readonly sceneController: SceneController;
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly cubeField: CubeField;
  private readonly config: CubeWallConfig;
  private readonly selectionChange?: (selection: CubeSelectionInfo | null) => void;
  private readonly debug?: (line: string) => void;
  private readonly billboardOverlay: BillboardOverlay;
  private readonly billboardStateChange?: (state: BillboardDisplayState | null) => void;
  private readonly axisLabelStateChange?: (labels: AxisLabelDisplayState[]) => void;
  private readonly axis3DLabelManager: Axis3DLabelManager;
  private currentBillboardInfo: CubeSelectionInfo | null = null;
  private currentBillboardCell: CubeCell | null = null;
  private sceneTime = 0;
  private disposed = false;
  private hoverInteractionEnabled = true;
  private autoSelectEnabled = false;
  private autoSelectInterval = 6;
  private autoSelectElapsed = 0;
  private axisLabelAnchors: Vector3[] = [];
  private axisLabelStartDateMs = Number.NaN;
  private readonly axisLabelDateFormatter = new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });

  private updateDepthOfFieldFocus(cell: CubeCell | null): void {
    if (!this.config.depthOfFieldEnabled || !this.config.depthOfFieldAutoFocusEnabled) return;
    const targetCell = cell ?? this.cubeField.getCurrentSelection();
    if (!targetCell) return;
    const camera = this.sceneController.getCamera();
    const distance = camera.position.subtract(targetCell.mesh.getAbsolutePosition()).length();
    const adjustedDistance = distance + this.config.depthOfFieldAutoFocusOffset;
    const sharpness = Math.max(0.1, this.config.depthOfFieldAutoFocusSharpness);
    const effectiveFStop = Math.max(0.1, this.config.depthOfFieldFStop / sharpness);
    this.config.depthOfFieldFocusDistance = adjustedDistance;
    this.config.depthOfFieldFStop = effectiveFStop;
    this.sceneController.setDepthOfFieldFocusDistance(adjustedDistance, effectiveFStop);
  }

  constructor({ canvas, config = appConfig, onSelectionChange, onDebug, onBillboardStateChange, onAxisLabelsChange }: CubeWallPresenterOptions) {
    this.config = config;
    this.sceneController = new SceneController({ canvas, config: this.config });
    this.engine = this.sceneController.getEngine();
    this.scene = this.sceneController.getScene();
    this.cubeField = new CubeField(this.scene, this.config);
    this.selectionChange = onSelectionChange;
    this.debug = onDebug;
    this.billboardStateChange = onBillboardStateChange;
    this.axisLabelStateChange = onAxisLabelsChange;
    this.setupPointerInteractions();

    this.axis3DLabelManager = new Axis3DLabelManager(this.scene);

    this.refreshAxisAnchors();
    this.updateAxisLabelStartDate();

    this.billboardOverlay = new BillboardOverlay({
      scene: this.scene,
      camera: this.sceneController.getCamera(),
      config: this.config,
      onRequestClose: () => {
        this.cubeField.selectCell(null);
        this.updateBillboard(null, false);
      },
    });

    this.emitAxisLabelsState();
    this.updateAxis3DLabels();

    // Debug camera and scene
    setTimeout(() => {
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

  private setupPointerInteractions(): void {
    let lastHoveredId: number | null = null;
    let pointerDownPos: { x: number; y: number } | null = null;

    this.scene.onPointerObservable.add((pointerInfo: PointerInfo) => {
      if (this.disposed) return;
      switch (pointerInfo.type) {
        case PointerEventTypes.POINTERMOVE: {
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
          this.handlePick(pointerInfo);
          break;
        }
        case PointerEventTypes.POINTERDOWN: {
          const event = pointerInfo.event as PointerEvent | MouseEvent;
          if ('button' in event && event.button !== 0) break;
          const pickInfo = this.resolvePickInfo(pointerInfo);
          if (pickInfo?.pickedMesh && pickInfo.pickedMesh.isPickable) {
            this.logDebug(`POINTERDOWN on ${pickInfo.pickedMesh.name}`);
            if (typeof event.preventDefault === 'function') event.preventDefault();
            if (typeof event.stopPropagation === 'function') event.stopPropagation();
            this.handlePick(pointerInfo, pickInfo);
            pointerDownPos = null;
          } else {
            this.logDebug('POINTERDOWN (no pickable mesh) - waiting for POINTERUP/tap');
            this.billboardOverlay.interruptCameraAnimation();
            pointerDownPos = 'clientX' in event && 'clientY' in event ? { x: event.clientX, y: event.clientY } : null;
          }
          break;
        }
        case PointerEventTypes.POINTERUP: {
          const event = pointerInfo.event as PointerEvent | MouseEvent;
          if ('button' in event && event.button !== 0) break;
          if (pointerDownPos && 'clientX' in event && 'clientY' in event) {
            const dx = event.clientX - pointerDownPos.x;
            const dy = event.clientY - pointerDownPos.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance <= 6) {
              this.logDebug(`POINTERUP -> treating as click (distance ${distance.toFixed(2)})`);
              this.handlePick(pointerInfo);
            } else {
              this.logDebug(`POINTERUP -> manual camera move (drag distance ${distance.toFixed(2)})`);
              this.billboardOverlay.captureCurrentCameraState();
              if (this.config.depthOfFieldEnabled && this.config.depthOfFieldAutoFocusEnabled) {
                const dof = this.sceneController.getRenderingPipeline()?.depthOfField;
                if (dof) {
                  const currentDistance = dof.focusDistance / DOF_WORLD_TO_MM;
                  this.config.depthOfFieldFocusDistance = currentDistance;
                  this.config.depthOfFieldFStop = dof.fStop;
                  this.updateDepthOfFieldFocus(null);
                }
              }
            }
          }
          pointerDownPos = null;
          break;
        }
        case PointerEventTypes.POINTERTAP: {
          this.logDebug('POINTERTAP');
          this.handlePick(pointerInfo);
          break;
        }
        default:
          break;
      }
    });
  }

  private handlePick(pointerInfo: PointerInfo, pickInfoOverride?: PickingInfo | null): void {
    const pickInfo = pickInfoOverride ?? this.resolvePickInfo(pointerInfo);
    if (!pickInfo) {
      this.logDebug('handlePick: no pick info');
      this.cubeField.selectCell(null);
      this.updateBillboard(null);
      return;
    }

    const mesh = pickInfo.pickedMesh;
    if (!mesh || !mesh.isPickable) {
      this.logDebug('handlePick: mesh missing or not pickable');
      this.cubeField.selectCell(null);
      this.updateBillboard(null);
      return;
    }

    const cell = this.cubeField.getCellFromMesh(mesh);
    if (!cell) {
      this.logDebug(`handlePick: no cube data for mesh ${mesh.name}`);
      this.cubeField.selectCell(null);
      this.updateBillboard(null);
      return;
    }

    const alreadySelected = cell.isSelected;
    this.logDebug(`handlePick: ${mesh.name} -> ${alreadySelected ? 'deselect' : 'select'}`);
    this.cubeField.selectCell(alreadySelected ? null : cell);
    if (!alreadySelected && this.hoverInteractionEnabled) {
      this.cubeField.triggerRipple(cell);
    }
    this.updateBillboard(alreadySelected ? null : cell);
    this.autoSelectElapsed = 0;
    this.updateDepthOfFieldFocus(alreadySelected ? null : cell);
  }

  private updateBillboard(cell: CubeCell | null, animate = true): void {
    if (!cell) {
      this.billboardOverlay.deselect(animate);
      this.selectionChange?.(null);
      this.billboardStateChange?.(null);
      this.currentBillboardInfo = null;
      this.currentBillboardCell = null;
      return;
    }
    const info = this.cubeField.getSelectionInfo();
    if (!info) {
      this.billboardOverlay.deselect(false);
      this.selectionChange?.(null);
      this.billboardStateChange?.(null);
      this.currentBillboardInfo = null;
      this.currentBillboardCell = null;
      return;
    }
    this.billboardOverlay.select(cell, info);
    this.selectionChange?.(info);
    this.currentBillboardInfo = info;
    this.currentBillboardCell = cell;
    this.emitHtmlBillboardState();
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
      this.billboardOverlay.update();
      this.scene.render();
    });
  }

  public applySettings(settings: PresenterSettings): void {
    const targetGridSize = Math.min(Math.max(3, Math.round(settings.gridSize)), this.config.maxGridSize);
    if (targetGridSize !== this.config.gridSize) {
      this.config.gridSize = targetGridSize;
      this.cubeField.rebuild(this.config.gridSize);
      this.updateBillboard(null, false);
      this.refreshAxisAnchors();
    }

    this.config.waveSpeed = settings.waveSpeed;
    this.config.waveAmplitudeY = settings.waveAmplitudeY;
    this.config.waveAmplitudeRot = settings.waveAmplitudeRot;
    this.hoverInteractionEnabled = settings.enableHoverInteraction;
    this.autoSelectEnabled = settings.autoSelectEnabled;
    this.autoSelectInterval = Math.max(1, settings.autoSelectInterval);
    this.autoSelectElapsed = this.autoSelectEnabled ? Math.min(this.autoSelectElapsed, this.autoSelectInterval) : 0;
    this.config.interactionRadius = settings.interactionRadius;
    this.config.interactionLift = settings.interactionLift;
    this.config.selectedCubeRotation = settings.selectedCubeRotation;
    this.config.selectedCubePopOutDistance = settings.selectedCubePopOutDistance;
    this.config.selectedCubeLift = settings.selectedCubeLift;
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
    this.config.billboard.mode = settings.billboardMode;
    this.config.billboard.htmlContent = settings.billboardHtmlContent;
    this.config.axisLabels.enabled = settings.axisLabelsEnabled;
    this.config.axisLabels.startDateIso = settings.axisLabelsStartDate;
    this.config.axisLabels.stepDays = Math.max(1, settings.axisLabelsStepDays);
    this.config.axisLabels.template = settings.axisLabelsTemplate;
    this.config.axisLabels.offset.x = settings.axisLabelsOffsetX;
    this.config.axisLabels.offset.y = settings.axisLabelsOffsetY;
    this.config.axisLabels.offset.z = settings.axisLabelsOffsetZ;
    this.updateAxisLabelStartDate();
    if (this.config.axisLabels.enabled && this.axisLabelAnchors.length === 0) {
      this.refreshAxisAnchors();
    }
    if (!this.config.axisLabels.enabled) {
      this.axisLabelStateChange?.([]);
    }

    this.sceneController.updateLightingFromConfig();
    this.sceneController.updateBackgroundFromConfig();
    this.sceneController.updateDepthOfFieldFromConfig();
    if (this.config.depthOfFieldAutoFocusEnabled) {
      this.updateDepthOfFieldFocus(null);
    }
    this.emitHtmlBillboardState();
    this.emitAxisLabelsState();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cubeField.dispose();
    this.billboardOverlay.dispose();
    this.sceneController.dispose();
    this.axisLabelStateChange?.([]);
    this.axis3DLabelManager.dispose();
  }

  private updateAutoSelection(deltaTime: number): void {
    if (!this.autoSelectEnabled) return;
    this.autoSelectElapsed += deltaTime;
    if (this.autoSelectElapsed < this.autoSelectInterval) return;
    this.autoSelectElapsed = 0;

    let cell = this.cubeField.getRandomCell(true);
    if (!cell) return;

    if (cell.isSelected) {
      const fallback = this.cubeField.getRandomCell(false);
      if (fallback) {
        cell = fallback;
      }
    }

    if (cell.isSelected) return;

    this.cubeField.selectCell(cell);
    if (this.hoverInteractionEnabled) {
      this.cubeField.triggerRipple(cell);
    }
    this.updateBillboard(cell);
    this.updateDepthOfFieldFocus(cell);
  }

  private readonly handleHtmlBillboardClose = () => {
    this.cubeField.selectCell(null);
    this.updateBillboard(null);
  };

  private emitHtmlBillboardState(): void {
    if (!this.billboardStateChange) return;
    if (this.config.billboard.mode !== 'html' || !this.currentBillboardCell || !this.currentBillboardInfo) {
      this.billboardStateChange(null);
      return;
    }

    const camera = this.sceneController.getCamera();
    const engine = this.scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    if (!canvas) {
      this.billboardStateChange(null);
      return;
    }

    const attachmentWorld = this.billboardOverlay.getAttachmentWorldPosition();
    const cubeBounds = this.currentBillboardCell.mesh.getBoundingInfo().boundingBox;
    const cubeAnchor = cubeBounds.centerWorld.clone();
    cubeAnchor.y = cubeBounds.maximumWorld.y;
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
      content: {
        gridX: this.currentBillboardInfo.gridX,
        gridZ: this.currentBillboardInfo.gridZ,
        colorHex: this.currentBillboardInfo.color.toHexString(),
        textureLabel: this.getTextureLabel(this.currentBillboardInfo.textureUrl),
      },
      onRequestClose: this.handleHtmlBillboardClose,
    };

    this.billboardStateChange(state);
  }

  private computeAxisLabelData(): AxisLabelData[] {
    if (!this.config.axisLabels.enabled || this.axisLabelAnchors.length === 0) {
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

    for (let index = 0; index < this.axisLabelAnchors.length; index += 1) {
      const anchor = this.axisLabelAnchors[index];
      const worldPosition = anchor.add(offsetVector);

      let labelText = template;
      labelText = labelText.split('{{row}}').join(index.toString());
      labelText = labelText.split('{{row1}}').join((index + 1).toString());

      let dateText = '';
      if (hasValidDate) {
        const date = new Date(startDateMs + index * this.config.axisLabels.stepDays * DAY_MS);
        if (!Number.isNaN(date.getTime())) {
          dateText = this.axisLabelDateFormatter.format(date);
        }
      }
      labelText = labelText.split('{{date}}').join(dateText);

      if (labelText.trim()) {
        labels.push({
          id: `axis-${index}`,
          text: labelText,
          worldPosition,
        });
      }
    }

    return labels;
  }

  private refreshAxisAnchors(): void {
    this.axisLabelAnchors = this.cubeField.getRowAnchors();
    this.updateAxis3DLabels();
  }

  private updateAxisLabelStartDate(): void {
    const parsed = Date.parse(this.config.axisLabels.startDateIso);
    this.axisLabelStartDateMs = Number.isNaN(parsed) ? Number.NaN : parsed;
  }

  private emitAxisLabelsState(): void {
    if (!this.axisLabelStateChange) return;

    if (!this.config.axisLabels.enabled || this.config.axisLabels.mode !== 'overlay') {
      this.axisLabelStateChange([]);
      return;
    }
    const data = this.computeAxisLabelData();
    if (!data.length) {
      this.axisLabelStateChange([]);
      return;
    }

    const engine = this.scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    if (!canvas) {
      this.axisLabelStateChange([]);
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
        screenX: rect.left + normalizedX * rect.width,
        screenY: rect.top + normalizedY * rect.height,
      });
    });

    this.axisLabelStateChange(labels);
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
