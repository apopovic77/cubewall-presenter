import { PointerEventTypes, PointerInfo } from '@babylonjs/core/Events/pointerEvents';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Culling/ray';
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
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { Material } from '@babylonjs/core/Materials/material';
import { Effect } from '@babylonjs/core/Materials/effect';
import { Axis3DLabelManager, type AxisLabelData } from './Axis3DLabelManager';
import type { CubeContentItem } from '../types/content';

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

    varying float vEdge;

    void main(void) {
      float edge = smoothstep(1.0 - feather, 1.0, vEdge);
      float alpha = 1.0 - edge;
      if (alpha <= 0.004) {
        discard;
      }
      gl_FragColor = vec4(color, alpha);
    }
  `;
  connectorShaderRegistered = true;
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
  content: {
    gridX: number;
    gridZ: number;
    colorHex: string;
    textureLabel: string;
    item: CubeContentItem | null;
  } | null;
  onRequestClose: () => void;
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
  private billboardFrameId = 0;
  private sceneTime = 0;
  private disposed = false;
  private hoverInteractionEnabled = true;
  private autoSelectEnabled = false;
  private autoSelectInterval = 6;
  private autoSelectElapsed = 0;
  private axisLabelStartDateMs = Number.NaN;
  private readonly axisLabelDateFormatter = new Intl.DateTimeFormat('de-DE', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });
  private physicsActive = false;
  private physicsDragCandidate: { cell: CubeCell; startX: number; startY: number } | null = null;
  private activePhysicsDrag: { cell: CubeCell } | null = null;
  private skipNextPhysicsClick = false;
  private savedHoverInteraction = true;
  private savedAutoSelect = false;
  private htmlConnectorMesh: Mesh | null = null;
  private htmlConnectorMaterial: ShaderMaterial | null = null;
  private readonly htmlConnectorColor = new Color3(0.3, 0.7, 1.0);

  public async triggerPhysicsDrop(): Promise<void> {
    if (this.physicsActive) {
      this.physicsActive = false;
      this.cubeField.disablePhysicsDrop();
      this.sceneController.disablePhysics();
      this.hoverInteractionEnabled = this.savedHoverInteraction;
      this.autoSelectEnabled = this.savedAutoSelect;
      this.autoSelectElapsed = 0;
      this.physicsDragCandidate = null;
      this.activePhysicsDrag = null;
      this.skipNextPhysicsClick = false;
      this.refreshAxisAnchors();
      return;
    }

    this.savedHoverInteraction = this.hoverInteractionEnabled;
    this.savedAutoSelect = this.autoSelectEnabled;
    this.cubeField.selectCell(null);
    this.updateBillboard(null, false);
    this.selectionChange?.(null);
    this.billboardStateChange?.(null);
    this.physicsActive = true;
    this.autoSelectEnabled = false;
    this.hoverInteractionEnabled = false;
    this.physicsDragCandidate = null;
    this.activePhysicsDrag = null;
    this.skipNextPhysicsClick = false;
    await this.sceneController.enablePhysicsAsync();
    this.cubeField.enablePhysicsDrop();
  }

  private updateDepthOfFieldFocus(cell: CubeCell | null): void {
    if (!this.config.depthOfFieldEnabled || !this.config.depthOfFieldAutoFocusEnabled) return;
    const targetCell = cell ?? this.cubeField.getCurrentSelection() ?? this.cubeField.getCenterCell();
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
          this.handlePick(pointerInfo);
          break;
        }
        case PointerEventTypes.POINTERDOWN: {
          const event = pointerInfo.event as PointerEvent | MouseEvent;
          if ('button' in event && event.button !== 0) break;
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
            } else {
              this.logDebug(`POINTERDOWN on ${pickInfo.pickedMesh.name}`);
              this.physicsDragCandidate = null;
              this.activePhysicsDrag = null;
              this.skipNextPhysicsClick = false;
              this.handlePick(pointerInfo, pickInfo);
            }
            pointerDownPos = null;
          } else {
            this.logDebug('POINTERDOWN (no pickable mesh) - waiting for POINTERUP/tap');
            this.billboardOverlay.interruptCameraAnimation();
            pointerDownPos = 'clientX' in event && 'clientY' in event ? { x: event.clientX, y: event.clientY } : null;
            this.physicsDragCandidate = null;
            this.skipNextPhysicsClick = false;
          }
          break;
        }
        case PointerEventTypes.POINTERUP: {
          const event = pointerInfo.event as PointerEvent | MouseEvent;
          if ('button' in event && event.button !== 0) break;
          if (this.physicsActive) {
            if (this.activePhysicsDrag) {
              this.finishActivePhysicsDrag();
              this.skipNextPhysicsClick = true;
            } else if (this.physicsDragCandidate && !this.skipNextPhysicsClick) {
              this.skipNextPhysicsClick = true;
              this.applySelection(this.physicsDragCandidate.cell);
            }
            this.physicsDragCandidate = null;
            pointerDownPos = null;
            break;
          }
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
    this.updateBillboard(null, false);
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
    this.applySelection(cell, mesh.name);
  }

  private applySelection(cell: CubeCell, meshName?: string): void {
    const alreadySelected = cell.isSelected;
    this.logDebug(`handlePick: ${meshName ?? cell.mesh.name} -> ${alreadySelected ? 'deselect' : 'select'}`);
    this.cubeField.selectCell(alreadySelected ? null : cell);
    if (!alreadySelected && this.hoverInteractionEnabled && !this.physicsActive) {
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
      this.hideHtmlConnectorLine();
      this.currentBillboardInfo = null;
      this.currentBillboardCell = null;
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

  public setContent(items: CubeContentItem[], options?: Partial<CubeContentOptions>): void {
    this.cubeField.setContent(items, options);
    if (this.currentBillboardCell) {
      this.updateBillboard(this.currentBillboardCell, false);
    } else {
      this.emitHtmlBillboardState();
    }
  }

  public randomizeFieldOrientation(): void {
    this.cubeField.randomizeFieldOrientation();
    this.logDebug('[Field] Randomized orientation');
  }

  public startFieldMorph(): void {
    const result = this.cubeField.startFieldMorph();
    if (!result) {
      this.logDebug('[Field] Morph request ignored (already morphing or no alternate field)');
      return;
    }
    this.logDebug(`[Field] Morphing ${result.current} → ${result.next}`);
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
      if (this.config.billboard.mode === 'html' && this.currentBillboardCell && this.currentBillboardInfo) {
        this.emitHtmlBillboardState();
      }
      this.scene.render();
    });
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
    const uvLayout = settings.textureUvLayout === 'mirrorTopAndAlternatingSides'
      ? { sidePattern: 'alternating' as const, mirrorTopBottom: true }
      : { sidePattern: 'uniform' as const, mirrorTopBottom: false };
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

    this.sceneController.updateLightingFromConfig();
    this.sceneController.updateBackgroundFromConfig();
    this.sceneController.updateDepthOfFieldFromConfig();
    if (this.config.depthOfFieldAutoFocusEnabled) {
      this.updateDepthOfFieldFocus(null);
    }
    this.cubeField.updateTextureMirrorOptions({
      sidePattern,
      mirrorTopBottom,
    });
    this.emitHtmlBillboardState();
    this.emitAxisLabelsState();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
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
      this.hideHtmlConnectorLine();
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
      content: {
        gridX: this.currentBillboardInfo.gridX,
        gridZ: this.currentBillboardInfo.gridZ,
        colorHex: this.currentBillboardInfo.color.toHexString(),
        textureLabel: this.getTextureLabel(this.currentBillboardInfo.textureUrl),
        item: this.currentBillboardCell.content ?? null,
      },
      onRequestClose: this.handleHtmlBillboardClose,
    };

    this.billboardStateChange(state);
    this.updateHtmlConnectorLine(state, cubeAnchor, attachmentWorld, rect);
  }

  private hideHtmlConnectorLine(): void {
    if (this.htmlConnectorMesh) {
      this.htmlConnectorMesh.isVisible = false;
    }
  }

  private disposeHtmlConnectorResources(): void {
    this.htmlConnectorMesh?.dispose();
    this.htmlConnectorMesh = null;
    this.htmlConnectorMaterial?.dispose();
    this.htmlConnectorMaterial = null;
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
        uniforms: ['world', 'view', 'projection', 'start', 'end', 'radius', 'feather', 'color', 'cameraPosition'],
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

    mesh.material = this.htmlConnectorMaterial;
    mesh.isPickable = false;
    mesh.doNotSyncBoundingInfo = true;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.renderingGroupId = this.currentBillboardCell?.mesh.renderingGroupId ?? 0;
    mesh.isVisible = false;

    this.htmlConnectorMesh = mesh;
    return mesh;
  }

  private renderScreenSpaceConnector(
    startPoint: Vector3,
    endPoint: Vector3,
    radiusWorld: number,
    featherRatio: number,
    camera: Camera,
  ): void {
    const mesh = this.ensureHtmlConnectorMesh();
    mesh.renderingGroupId = this.currentBillboardCell?.mesh.renderingGroupId ?? mesh.renderingGroupId;
    mesh.setEnabled(true);
    mesh.isVisible = true;

    if (this.htmlConnectorMaterial) {
      this.htmlConnectorMaterial.setVector3('start', startPoint.clone());
      this.htmlConnectorMaterial.setVector3('end', endPoint.clone());
      this.htmlConnectorMaterial.setFloat('radius', Math.max(0.0005, radiusWorld));
      this.htmlConnectorMaterial.setFloat('feather', featherRatio);
      this.htmlConnectorMaterial.setColor3('color', this.htmlConnectorColor);
      this.htmlConnectorMaterial.setVector3('cameraPosition', camera.position.clone());
    }
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

    const CLAMP_MARGIN = 24;
    const clampedX = Math.min(Math.max(state.screenX, CLAMP_MARGIN), state.viewportWidth - CLAMP_MARGIN);
    const clampedY = Math.min(Math.max(state.screenY, CLAMP_MARGIN), state.viewportHeight - CLAMP_MARGIN);

    const anchorScreenX = clampedX;
    const anchorScreenY = clampedY + 24;

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

    const startPoint = cubeAnchor.clone();
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

    this.renderScreenSpaceConnector(startPoint, endPoint, radiusWorld, featherRatio, camera);
  }

  private getAxisLabelAxes(): AxisLabelAxis[] {
    const axes = this.config.axisLabels.axes;
    if (Array.isArray(axes) && axes.length > 0) {
      const normalized = axes
        .map((axis) => (axis === 'columns' ? 'columns' : 'rows'))
        .filter((axis, index, arr) => arr.indexOf(axis) === index) as AxisLabelAxis[];
      if (normalized.length > 0) {
        return normalized;
      }
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
        axis: label.axis,
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
