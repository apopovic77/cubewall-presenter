import { PointerEventTypes, PointerInfo } from '@babylonjs/core/Events/pointerEvents';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Ray } from '@babylonjs/core/Culling/ray';
import type { Camera } from '@babylonjs/core/Cameras/camera';
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
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';
import { Axis3DLabelManager, type AxisLabelData } from './Axis3DLabelManager';
import type { CubeContentItem } from '../types/content';
import { CameraOrbitController } from './CameraOrbitController';
import { BILLBOARD_FADE_SECONDS } from '../config/BillboardConstants';

const DAY_MS = 24 * 60 * 60 * 1000;
const CONNECTOR_SHADER_NAME = 'htmlConnectorLine';
let connectorShaderRegistered = false;

function ensureConnectorShader(): void {
  if (connectorShaderRegistered) return;
  Effect.ShadersStore[`${CONNECTOR_SHADER_NAME}VertexShader`] = `
    precision highp float;

    attribute vec3 position;

    uniform vec3 start;
    uniform vec3 end;
    uniform float radius;
    uniform mat4 view;
    uniform mat4 projection;
    uniform vec3 cameraPosition;

    varying float vEdge;

    void main(void) {
      vec3 line = end - start;
      float lengthLine = max(length(line), 1e-6);
      vec3 forward = line / lengthLine;

      vec3 lineCenter = start + line * 0.5;
      vec3 cameraVector = normalize(cameraPosition - lineCenter);
      vec3 right = normalize(cross(cameraVector, forward));
      if (length(right) < 1e-4) {
        right = normalize(abs(forward.y) < 0.999 ? cross(vec3(0.0, 1.0, 0.0), forward) : cross(vec3(1.0, 0.0, 0.0), forward));
      }
      vec3 up = normalize(cross(forward, right));

      float offset = position.x;
      float along = position.y;
      vec3 worldPos = start + forward * along * lengthLine + right * offset * radius;

      gl_Position = projection * view * vec4(worldPos, 1.0);
      vEdge = abs(offset);
    }
  `;

  Effect.ShadersStore[`${CONNECTOR_SHADER_NAME}FragmentShader`] = `
    precision highp float;

    uniform vec3 color;
    uniform float feather;
    uniform float opacity;

    varying float vEdge;

    void main(void) {
      float edge = smoothstep(1.0 - feather, 1.0, vEdge);
      float alpha = (1.0 - edge) * opacity;
      if (alpha <= 0.004) {
        discard;
      }
      gl_FragColor = vec4(color, alpha);
    }
  `;
  connectorShaderRegistered = true;
}

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
}

export class CubeWallPresenter {
  private readonly sceneController: SceneController;
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
  private htmlConnectorMesh: Mesh | null = null;
  private htmlConnectorMaterial: ShaderMaterial | null = null;
  private htmlConnectorTube: Mesh | null = null;
  private htmlConnectorTubeMaterial: StandardMaterial | null = null;
  private readonly htmlConnectorColor = new Color3(0.3, 0.7, 1.0);
  private billboardScreenMetrics: BillboardScreenMetrics | null = null;
  private connectorCurrentAlpha = 0;
  private connectorTargetAlpha = 0;
  private readonly connectorFadeSpeed = BILLBOARD_FADE_SECONDS > 0 ? 1 / BILLBOARD_FADE_SECONDS : 1;
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
      await this.sceneController.enablePhysicsAsync();
      this.cubeField.enablePhysicsDrop();
      this.cubeField.setPhysicsAnchorsEnabled(false);
      this.debug?.('[Physics] Mode: classic (F3 -> anchor, F3 -> off)');
      return;
    }

    if (this.physicsMode === 'classic') {
      this.physicsMode = 'anchor';
      this.cubeField.setPhysicsAnchorsEnabled(true);
      this.debug?.('[Physics] Mode: anchor (morph will use anchors)');
      return;
    }

    // physicsMode === 'anchor'
    this.physicsMode = 'off';
    this.physicsActive = false;
    this.cubeField.setPhysicsAnchorsEnabled(false);
    this.cubeField.disablePhysicsDrop();
    this.sceneController.disablePhysics();
    this.hoverInteractionEnabled = this.savedHoverInteraction;
    this.autoSelectEnabled = this.savedAutoSelect;
    this.autoSelectElapsed = 0;
    this.physicsDragCandidate = null;
    this.activePhysicsDrag = null;
    this.skipNextPhysicsClick = false;
    this.refreshAxisAnchors();
    this.debug?.('[Physics] Mode: off');
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
    this.config.depthOfFieldFocusDistance = adjustedDistance;
    this.config.depthOfFieldFStop = effectiveFStop;
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
  }: CubeWallPresenterOptions) {
    this.config = config;
    this.canvasElement = canvas;
    this.sceneController = new SceneController({ canvas, config: this.config });
    this.engine = this.sceneController.getEngine();
    this.scene = this.sceneController.getScene();
    this.cubeField = new CubeField(this.scene, this.config);
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
            this.handlePhysicsPointerMove(pointerInfo);
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
    const groundHeight = this.sceneController.getPhysicsGroundHeight();
    point.y = groundHeight + this.config.cubeSize * 0.5;
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
    const groundHeight = this.sceneController.getPhysicsGroundHeight();
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

    if (!cell) {
      this.billboardOverlay.deselect(animate);
      this.selectionChange?.(null);
      this.billboardStateChange?.(null);
      this.hideHtmlConnectorLine();
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
      this.hideHtmlConnectorLine();
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
      this.updateConnectorFade(deltaTime);
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
    if (this.wheelListener) {
      this.canvasElement.removeEventListener('wheel', this.wheelListener);
      this.wheelListener = null;
    }
    this.disposeHtmlConnectorResources();
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
      this.hideHtmlConnectorLine();
      this.lastEmittedBillboard = null;
      return;
    }

    const camera = this.sceneController.getCamera();
    const engine = this.scene.getEngine();
    const canvas = engine.getRenderingCanvas();
    if (!canvas) {
      this.billboardStateChange(null);
      this.hideHtmlConnectorLine();
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
    this.updateHtmlConnectorLine(state, cubeAnchor, attachmentWorld, rect);
  }

  private hideHtmlConnectorLine(): void {
    this.setConnectorTargetAlpha(0);
  }

  private setConnectorTargetAlpha(target: number): void {
    const clamped = Math.min(Math.max(target, 0), 1);
    this.connectorTargetAlpha = clamped;
    if (clamped === 0 && this.connectorCurrentAlpha === 0) {
      this.applyConnectorAlpha();
    }
  }

  private applyConnectorAlpha(): void {
    const alpha = Math.min(Math.max(this.connectorCurrentAlpha, 0), 1);
    if (this.htmlConnectorMaterial) {
      this.htmlConnectorMaterial.setFloat('opacity', alpha);
    }
    if (this.htmlConnectorTubeMaterial) {
      this.htmlConnectorTubeMaterial.alpha = alpha;
      this.htmlConnectorTubeMaterial.diffuseColor.copyFrom(this.htmlConnectorColor);
      this.htmlConnectorTubeMaterial.emissiveColor.copyFrom(this.htmlConnectorColor);
      this.htmlConnectorTubeMaterial.emissiveColor.scaleInPlace(Math.max(alpha, 0) * 0.8);
    }
    const visible = alpha > 0.002;
    if (this.htmlConnectorMesh) {
      this.htmlConnectorMesh.isVisible = visible;
      this.htmlConnectorMesh.setEnabled(visible);
    }
    if (this.htmlConnectorTube) {
      this.htmlConnectorTube.visibility = alpha;
      this.htmlConnectorTube.isVisible = visible;
      this.htmlConnectorTube.setEnabled(visible);
    }
  }

  private updateConnectorFade(deltaTime: number): void {
    if (!this.htmlConnectorMesh && !this.htmlConnectorTube) {
      this.connectorCurrentAlpha = 0;
      this.connectorTargetAlpha = 0;
      return;
    }
    const diff = this.connectorTargetAlpha - this.connectorCurrentAlpha;
    if (Math.abs(diff) < 1e-4) {
      this.connectorCurrentAlpha = this.connectorTargetAlpha;
      this.applyConnectorAlpha();
      return;
    }
    const step = (this.connectorFadeSpeed * deltaTime);
    const delta = Math.sign(diff) * Math.min(Math.abs(diff), step);
    this.connectorCurrentAlpha = Math.min(Math.max(this.connectorCurrentAlpha + delta, 0), 1);
    this.applyConnectorAlpha();
  }

  private disposeHtmlConnectorResources(): void {
    this.htmlConnectorMesh?.dispose();
    this.htmlConnectorMesh = null;
    this.htmlConnectorMaterial?.dispose();
    this.htmlConnectorMaterial = null;
    this.htmlConnectorTube?.dispose();
    this.htmlConnectorTube = null;
    this.htmlConnectorTubeMaterial?.dispose();
    this.htmlConnectorTubeMaterial = null;
    this.connectorCurrentAlpha = 0;
    this.connectorTargetAlpha = 0;
  }

  private ensureHtmlConnectorMesh(): Mesh {
    if (this.htmlConnectorMesh && this.htmlConnectorMaterial) {
      return this.htmlConnectorMesh;
    }

    ensureConnectorShader();

    const mesh = new Mesh('htmlBillboardConnector', this.scene);
    const vertexData = new VertexData();
    vertexData.positions = [
      -1, 0, 0,
      -1, 1, 0,
      1, 0, 0,
      1, 1, 0,
    ];
    vertexData.indices = [0, 1, 2, 2, 1, 3];
    vertexData.applyToMesh(mesh, true);

    this.htmlConnectorMaterial = new ShaderMaterial(
      'htmlBillboardConnectorMaterial',
      this.scene,
      CONNECTOR_SHADER_NAME,
      {
        attributes: ['position'],
        uniforms: ['world', 'view', 'projection', 'start', 'end', 'radius', 'feather', 'color', 'cameraPosition', 'opacity'],
      },
    );
    this.htmlConnectorMaterial.backFaceCulling = false;
    this.htmlConnectorMaterial.alphaMode = Engine.ALPHA_COMBINE;
    this.htmlConnectorMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.htmlConnectorMaterial.disableDepthWrite = false;
    this.htmlConnectorMaterial.forceDepthWrite = false;
    this.htmlConnectorMaterial.needDepthPrePass = false;
    this.htmlConnectorMaterial.separateCullingPass = false;
    this.htmlConnectorMaterial.setColor3('color', this.htmlConnectorColor);
    this.htmlConnectorMaterial.setFloat('feather', 0.2);
    this.htmlConnectorMaterial.setFloat('opacity', this.connectorCurrentAlpha);

    mesh.material = this.htmlConnectorMaterial;
    mesh.isPickable = false;
    mesh.doNotSyncBoundingInfo = true;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.renderingGroupId = this.currentBillboardCell?.mesh.renderingGroupId ?? 0;
    const visible = this.connectorCurrentAlpha > 0.001;
    mesh.isVisible = visible;
    mesh.setEnabled(visible);

    this.htmlConnectorMesh = mesh;
    return mesh;
  }

  private ensureHtmlConnectorTube(): Mesh {
    if (this.htmlConnectorTube && this.htmlConnectorTubeMaterial) {
      return this.htmlConnectorTube;
    }

    const path = [Vector3.Zero(), new Vector3(0, 0.1, 0)];
    const mesh = MeshBuilder.CreateTube(
      'htmlBillboardConnectorTube',
      {
        path,
        radius: 0.01,
        updatable: true,
        cap: Mesh.CAP_END,
      },
      this.scene,
    );
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
    mesh.isVisible = false;

    this.htmlConnectorTubeMaterial = new StandardMaterial('htmlBillboardConnectorTubeMat', this.scene);
    this.htmlConnectorTubeMaterial.diffuseColor = this.htmlConnectorColor.clone();
    this.htmlConnectorTubeMaterial.emissiveColor = this.htmlConnectorColor.clone().scale(0.8);
    this.htmlConnectorTubeMaterial.specularColor = Color3.Black();
    this.htmlConnectorTubeMaterial.alpha = this.connectorCurrentAlpha;
    this.htmlConnectorTubeMaterial.backFaceCulling = false;
    this.htmlConnectorTubeMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.htmlConnectorTubeMaterial.alphaMode = Engine.ALPHA_COMBINE;
    this.htmlConnectorTubeMaterial.forceDepthWrite = false;
    this.htmlConnectorTubeMaterial.needDepthPrePass = false;
    this.htmlConnectorTubeMaterial.disableLighting = false;
    this.htmlConnectorTubeMaterial.twoSidedLighting = true;

    mesh.material = this.htmlConnectorTubeMaterial;

    this.htmlConnectorTube = mesh;
    return mesh;
  }

  private renderScreenSpaceConnector(
    startPoint: Vector3,
    endPoint: Vector3,
    radiusWorld: number,
    featherRatio: number,
    camera: Camera,
  ): void {
    if (this.htmlConnectorTube) {
      this.htmlConnectorTube.setEnabled(false);
      this.htmlConnectorTube.isVisible = false;
    }
    const mesh = this.ensureHtmlConnectorMesh();
    mesh.renderingGroupId = this.currentBillboardCell?.mesh.renderingGroupId ?? mesh.renderingGroupId;
    mesh.setEnabled(true);

    if (this.htmlConnectorMaterial) {
      this.htmlConnectorMaterial.setVector3('start', startPoint.clone());
      this.htmlConnectorMaterial.setVector3('end', endPoint.clone());
      this.htmlConnectorMaterial.setFloat('radius', Math.max(0.0005, radiusWorld));
      this.htmlConnectorMaterial.setFloat('feather', featherRatio);
      this.htmlConnectorMaterial.setColor3('color', this.htmlConnectorColor);
      this.htmlConnectorMaterial.setVector3('cameraPosition', camera.position.clone());
    }
    this.applyConnectorAlpha();
  }

  private renderTubeConnector(startPoint: Vector3, endPoint: Vector3, radiusWorld: number): void {
    if (this.htmlConnectorMesh) {
      this.htmlConnectorMesh.setEnabled(false);
      this.htmlConnectorMesh.isVisible = false;
    }

    const tube = this.ensureHtmlConnectorTube();
    tube.renderingGroupId = this.currentBillboardCell?.mesh.renderingGroupId ?? 0;

    const path = [startPoint.clone(), endPoint.clone()];
    const radius = Math.max(0.002, radiusWorld);

    MeshBuilder.CreateTube(
      tube.name,
      {
        path,
        radius,
        instance: tube,
      },
      this.scene,
    );

    if (this.htmlConnectorTubeMaterial) {
      this.htmlConnectorTubeMaterial.diffuseColor = this.htmlConnectorColor.clone();
      this.htmlConnectorTubeMaterial.emissiveColor = this.htmlConnectorColor.clone().scale(0.8);
    }

    tube.setEnabled(true);
    tube.isVisible = true;
    this.applyConnectorAlpha();
  }

  private updateHtmlConnectorLine(
    state: BillboardDisplayState,
    cubeAnchor: Vector3,
    attachmentWorld: Vector3,
    canvasRect: DOMRect,
  ): void {
    if (this.config.billboard.mode !== 'html') {
      this.hideHtmlConnectorLine();
      return;
    }
    if (!state.isVisible) {
      this.hideHtmlConnectorLine();
      return;
    }

    if (this.config.billboard.connectorMode === 'htmlSvg') {
      this.hideHtmlConnectorLine();
      return;
    }

    const canvas = this.engine.getRenderingCanvas();
    if (!canvas || canvasRect.width === 0 || canvasRect.height === 0) {
      this.hideHtmlConnectorLine();
      return;
    }

    const renderWidth = this.engine.getRenderWidth();
    const renderHeight = this.engine.getRenderHeight();
    if (renderWidth === 0 || renderHeight === 0) {
      this.hideHtmlConnectorLine();
      return;
    }

    this.setConnectorTargetAlpha(1);

    const CLAMP_MARGIN = 24;
    const clampedX = Math.min(Math.max(state.screenX, CLAMP_MARGIN), state.viewportWidth - CLAMP_MARGIN);
    const clampedY = Math.min(Math.max(state.screenY, CLAMP_MARGIN), state.viewportHeight - CLAMP_MARGIN);

    const metrics = this.billboardScreenMetrics;
    const anchorScreenX = metrics?.centerX ?? clampedX;
    const anchorScreenY = metrics?.centerY ?? clampedY;

    const relativeX = (anchorScreenX - canvasRect.left) / canvasRect.width;
    const relativeY = (anchorScreenY - canvasRect.top) / canvasRect.height;
    if (!Number.isFinite(relativeX) || !Number.isFinite(relativeY)) {
      this.hideHtmlConnectorLine();
      return;
    }

    const normalizedX = Math.min(Math.max(relativeX, 0), 1);
    const normalizedY = Math.min(Math.max(relativeY, 0), 1);

    const pointerX = normalizedX * renderWidth;
    const pointerY = normalizedY * renderHeight;

    const camera = this.sceneController.getCamera();
    const ray = this.scene.createPickingRay(pointerX, pointerY, Matrix.Identity(), camera, false);

    const forward = camera.target.subtract(camera.position);
    if (forward.lengthSquared() < 1e-6) {
      forward.set(0, 0, 1);
    }
    forward.normalize();

    const plane = Plane.FromPositionAndNormal(attachmentWorld, forward);
    const hitDistance = ray.intersectsPlane(plane);
    const endPoint = hitDistance !== null && Number.isFinite(hitDistance)
      ? ray.origin.add(ray.direction.scale(hitDistance))
      : attachmentWorld.clone();

    let startPoint = cubeAnchor.clone();
    const activeCell = this.currentBillboardCell;
    if (activeCell) {
      const cameraRay = Ray.CreateNewFromTo(camera.position, cubeAnchor);
      const pick = this.scene.pickWithRay(cameraRay, (mesh) => mesh === activeCell.mesh, false);
      if (pick?.hit && pick.pickedPoint) {
        startPoint = pick.pickedPoint.clone();
      } else {
        const boundingInfo = activeCell.mesh.getBoundingInfo();
        const corners = boundingInfo?.boundingBox?.vectorsWorld;
        if (corners && corners.length > 0) {
          const cameraPos = camera.position;
          let best = corners[0];
          let bestDist = Number.POSITIVE_INFINITY;
          corners.forEach((corner) => {
            const dist = Vector3.DistanceSquared(corner, cameraPos);
            if (Number.isFinite(dist) && dist < bestDist) {
              bestDist = dist;
              best = corner;
            }
          });
          startPoint = best.clone();
        }
      }
    }
    const direction = endPoint.subtract(startPoint);
    if (direction.lengthSquared() > 1e-6) {
      direction.normalize();
      endPoint.subtractInPlace(direction.scale(0.02 * this.config.cubeSize));
    }

    const connectorLength = Vector3.Distance(startPoint, endPoint);
    if (!Number.isFinite(connectorLength) || connectorLength <= 1e-4) {
      this.hideHtmlConnectorLine();
      return;
    }

    const midPoint = startPoint.add(endPoint).scale(0.5);
    const cameraForward = camera.getForwardRay().direction;
    let depth = Vector3.Dot(midPoint.subtract(camera.position), cameraForward);
    if (!Number.isFinite(depth) || depth <= 0) {
      depth = midPoint.subtract(camera.position).length();
    }

    const thicknessPx = Math.max(0.5, this.config.billboard.connectorThicknessPx);
    const featherPx = Math.max(0, this.config.billboard.connectorFeatherPx);
    const viewportHeight = Math.max(1, renderHeight);
    const worldHeight = 2 * depth * Math.tan(camera.fov / 2);
    const diameterWorld = (thicknessPx / viewportHeight) * worldHeight;
    const radiusWorld = Math.max(0.0005, diameterWorld * 0.5);
    const featherRatio = Math.min(0.49, featherPx / Math.max(thicknessPx, 0.0001));

    switch (this.config.billboard.connectorMode) {
      case 'tube3d': {
        const forwardDir = camera.getForwardRay().direction.clone();
        const tubeTarget = endPoint.clone().subtract(forwardDir.scale(0.02));
        this.renderTubeConnector(startPoint, tubeTarget, radiusWorld);
        break;
      }
      case 'screenSpace':
        this.renderScreenSpaceConnector(startPoint, endPoint, radiusWorld, featherRatio, camera);
        break;
      default:
        this.hideHtmlConnectorLine();
        break;
    }
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
