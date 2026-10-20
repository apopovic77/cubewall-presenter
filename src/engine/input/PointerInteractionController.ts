import type { Scene } from '@babylonjs/core/scene';
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { PointerEventTypes, type PointerInfo } from '@babylonjs/core/Events/pointerEvents';
import type { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Plane } from '@babylonjs/core/Maths/math.plane';
import type { CubeCell, CubeField } from '../CubeField';
import type { CameraOrbitController } from '../CameraOrbitController';

/** What pointer handling needs from the presenter. */
export interface PointerInteractionHost {
  readonly cubeField: CubeField;
  readonly cameraController: CameraOrbitController;
  getCamera(): ArcRotateCamera;
  isDisposed(): boolean;
  /** In AR, XR controllers synthesize pointer events; ArSessionController handles those. */
  isArActive(): boolean;
  isPhysicsActive(): boolean;
  isHoverEnabled(): boolean;
  applySelection(cell: CubeCell, meshName?: string): void;
  clearSelection(animate: boolean): void;
  setManualCameraOverride(active: boolean): void;
  syncRelativeCameraSettings(): void;
  refocusDepthOfField(): void;
  onWheel(): void;
  logDebug(line: string): void;
}

/**
 * Mouse / touch input on the canvas: hover ripples, click to select (as
 * opposed to a camera drag), dragging cubes over the ground under physics,
 * and the wheel handing the camera to the user.
 */
export class PointerInteractionController {
  private readonly scene: Scene;
  private readonly canvas: HTMLCanvasElement;
  private readonly host: PointerInteractionHost;
  private physicsDragCandidate: { cell: CubeCell; startX: number; startY: number } | null = null;
  private activePhysicsDrag: { cell: CubeCell } | null = null;
  private skipNextPhysicsClick = false;
  private wheelListener: ((event: WheelEvent) => void) | null = null;

  constructor(scene: Scene, canvas: HTMLCanvasElement, host: PointerInteractionHost) {
    this.scene = scene;
    this.canvas = canvas;
    this.host = host;
    this.setupPointerInteractions();
    this.setupWheelCapture();
  }

  /** Physics mode switched: forget any half-started drag. */
  public resetPhysicsDrag(): void {
    this.physicsDragCandidate = null;
    this.activePhysicsDrag = null;
    this.skipNextPhysicsClick = false;
  }

  public dispose(): void {
    if (this.wheelListener) {
      this.canvas.removeEventListener('wheel', this.wheelListener);
      this.wheelListener = null;
    }
  }

  private setupWheelCapture(): void {
    this.wheelListener = () => {
      this.host.setManualCameraOverride(true);
      this.host.cameraController.captureCurrentCameraState();
      this.host.onWheel();
    };
    this.canvas.addEventListener('wheel', this.wheelListener, { passive: true });
  }

  private setupPointerInteractions(): void {
    let lastHoveredId: number | null = null;
    let pointerDownInfo: { x: number; y: number; shouldTriggerClick: boolean; button: number } | null = null;
    let pendingPick: { cell: CubeCell; meshName?: string } | null = null;
    let pointerClickHandled = false;

    this.scene.onPointerObservable.add((pointerInfo: PointerInfo) => {
      if (this.host.isDisposed()) return;
      // In AR, XR controllers synthesize pointer events without screen coordinates;
      // selection and grabbing come from ArSessionController, only hover ripples stay.
      if (this.host.isArActive() && pointerInfo.type !== PointerEventTypes.POINTERMOVE) return;
      switch (pointerInfo.type) {
        case PointerEventTypes.POINTERMOVE: {
          const moveEvent = pointerInfo.event as PointerEvent | MouseEvent | null;
          if (
            moveEvent &&
            pointerDownInfo &&
            'clientX' in moveEvent &&
            'clientY' in moveEvent &&
            moveEvent.buttons & 1
          ) {
            const dx = moveEvent.clientX - pointerDownInfo.x;
            const dy = moveEvent.clientY - pointerDownInfo.y;
            if (Math.sqrt(dx * dx + dy * dy) > 6) {
              pointerDownInfo.shouldTriggerClick = false;
              this.host.setManualCameraOverride(true);
              this.host.cameraController.interruptAnimation();
              this.host.logDebug(
                `[Pointer] Drag detected (dx=${dx.toFixed(2)}, dy=${dy.toFixed(2)}). Manual override engaged.`,
              );
            }
          }
          if (this.host.isPhysicsActive()) {
            if (!this.host.isArActive()) this.handlePhysicsPointerMove(pointerInfo);
            break;
          }
          if (!this.host.isHoverEnabled()) {
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
          const cell = this.host.cubeField.getCellFromMesh(mesh);
          if (cell && !cell.isSelected) {
            this.host.cubeField.triggerRipple(cell);
          }
          break;
        }
        case PointerEventTypes.POINTERPICK: {
          this.host.logDebug('POINTERPICK');
          // In AR, selection comes from the XR 'select' event (see selectFromAr).
          if (this.host.isArActive()) break;
          if (pointerDownInfo && pendingPick) {
            break;
          }
          this.handlePick(pointerInfo);
          break;
        }
        case PointerEventTypes.POINTERDOWN: {
          const event = pointerInfo.event as PointerEvent | MouseEvent;
          const button = 'button' in event ? (event.button ?? 0) : 0;
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
            this.host.cameraController.interruptAnimation();
            this.host.setManualCameraOverride(true);
            this.host.logDebug('[Pointer] Non-left button down -> manual override');
            break;
          }
          const pickInfo = this.resolvePickInfo(pointerInfo);
          if (pickInfo?.pickedMesh && pickInfo.pickedMesh.isPickable) {
            const cell = this.host.cubeField.getCellFromMesh(pickInfo.pickedMesh);
            if (!cell) {
              this.host.logDebug(`POINTERDOWN -> no cube data for mesh ${pickInfo.pickedMesh.name}`);
              break;
            }
            if (typeof event.preventDefault === 'function') event.preventDefault();
            if (typeof event.stopPropagation === 'function') event.stopPropagation();
            if (this.host.isPhysicsActive()) {
              const startX = 'clientX' in event ? event.clientX : 0;
              const startY = 'clientY' in event ? event.clientY : 0;
              this.physicsDragCandidate = { cell, startX, startY };
              this.activePhysicsDrag = null;
              this.skipNextPhysicsClick = false;
              this.host.logDebug(`POINTERDOWN physics candidate -> ${pickInfo.pickedMesh.name}`);
              pendingPick = null;
            } else {
              this.host.logDebug(`POINTERDOWN on ${pickInfo.pickedMesh.name}`);
              this.physicsDragCandidate = null;
              this.activePhysicsDrag = null;
              this.skipNextPhysicsClick = false;
              pendingPick = { cell, meshName: pickInfo.pickedMesh.name };
            }
          } else {
            this.host.logDebug('POINTERDOWN (no pickable mesh) - waiting for POINTERUP/tap');
            this.physicsDragCandidate = null;
            this.skipNextPhysicsClick = false;
            pendingPick = null;
          }
          break;
        }
        case PointerEventTypes.POINTERUP: {
          const event = pointerInfo.event as PointerEvent | MouseEvent;
          const button = 'button' in event ? (event.button ?? 0) : 0;
          if (button !== 0 && button !== 1 && button !== 2) break;
          if (this.host.isPhysicsActive()) {
            if (this.activePhysicsDrag) {
              this.finishActivePhysicsDrag();
              this.skipNextPhysicsClick = true;
            } else if (this.physicsDragCandidate && !this.skipNextPhysicsClick) {
              this.skipNextPhysicsClick = true;
              this.host.applySelection(this.physicsDragCandidate.cell);
            }
            this.physicsDragCandidate = null;
            pointerDownInfo = null;
            pendingPick = null;
            break;
          }
          if (pointerDownInfo && pointerDownInfo.button !== 0) {
            this.host.setManualCameraOverride(true);
            this.host.syncRelativeCameraSettings();
            this.host.logDebug('[Pointer] PointerUp non-left -> manual override stays');
            pointerDownInfo = null;
            pendingPick = null;
            break;
          }
          if (pointerDownInfo && pointerDownInfo.button === 0 && 'clientX' in event && 'clientY' in event) {
            const dx = event.clientX - pointerDownInfo.x;
            const dy = event.clientY - pointerDownInfo.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance <= 6) {
              this.host.logDebug(`POINTERUP -> treating as click (distance ${distance.toFixed(2)})`);
              if (pointerDownInfo.shouldTriggerClick) {
                if (pendingPick) {
                  this.host.applySelection(pendingPick.cell, pendingPick.meshName);
                } else {
                  this.handlePick(pointerInfo);
                }
                pointerClickHandled = true;
              }
            } else {
              this.host.logDebug(`POINTERUP -> manual camera move (drag distance ${distance.toFixed(2)})`);
              this.host.setManualCameraOverride(true);
              this.host.cameraController.captureCurrentCameraState();
              this.host.syncRelativeCameraSettings();
              this.host.refocusDepthOfField();
              pointerClickHandled = true;
            }
          }
          pointerDownInfo = null;
          pendingPick = null;
          break;
        }
        case PointerEventTypes.POINTERTAP: {
          this.host.logDebug('POINTERTAP');
          if (this.host.isArActive()) break;
          if (pointerClickHandled) {
            pointerClickHandled = false;
            pendingPick = null;
            break;
          }
          if (this.host.isPhysicsActive()) {
            if (this.skipNextPhysicsClick) {
              this.skipNextPhysicsClick = false;
              break;
            }
          }
          this.handlePick(pointerInfo);
          if (this.host.isPhysicsActive()) {
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
    if (!this.host.isPhysicsActive()) return;
    const event = pointerInfo.event as PointerEvent | MouseEvent | null;
    if (!event) return;
    const buttons = 'buttons' in event ? (event.buttons ?? 0) : 0;

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
    this.host.logDebug(`physics drag start -> cube_${cell.gridX}_${cell.gridZ}`);
    this.host.clearSelection(false);
    this.host.cubeField.beginPhysicsDrag(cell);
  }

  private updateActivePhysicsDrag(pointerInfo: PointerInfo): void {
    if (!this.activePhysicsDrag) return;
    const dragCell = this.activePhysicsDrag.cell;
    const point = this.getGroundIntersection(pointerInfo);
    if (!point) return;
    this.host.cubeField.updatePhysicsDrag(dragCell, point);
  }

  private finishActivePhysicsDrag(): void {
    if (!this.activePhysicsDrag) return;
    this.host.cubeField.endPhysicsDrag(this.activePhysicsDrag.cell);
    this.host.logDebug(
      `physics drag end -> cube_${this.activePhysicsDrag.cell.gridX}_${this.activePhysicsDrag.cell.gridZ}`,
    );
    this.activePhysicsDrag = null;
  }

  private getGroundIntersection(pointerInfo: PointerInfo): Vector3 | null {
    const canvas = this.scene.getEngine().getRenderingCanvas();
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

    const camera = this.host.getCamera();
    const ray = this.scene.createPickingRay(scaledX, scaledY, Matrix.Identity(), camera);
    const groundHeight = this.host.cubeField.getPhysicsGroundWorldY();
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
      this.host.logDebug('handlePick: no pick info');
      this.host.clearSelection(true);
      return;
    }

    const mesh = pickInfo.pickedMesh;
    if (!mesh || !mesh.isPickable) {
      this.host.logDebug('handlePick: mesh missing or not pickable');
      this.host.clearSelection(true);
      return;
    }

    const cell = this.host.cubeField.getCellFromMesh(mesh);
    if (!cell) {
      this.host.logDebug(`handlePick: no cube data for mesh ${mesh.name}`);
      this.host.clearSelection(true);
      return;
    }
    this.host.applySelection(cell, mesh.name);
  }

  private resolvePickInfo(pointerInfo: PointerInfo, silent = false): PickingInfo | null {
    if (pointerInfo.pickInfo?.hit && pointerInfo.pickInfo.pickedMesh) {
      return pointerInfo.pickInfo;
    }

    const canvas = this.scene.getEngine().getRenderingCanvas();
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
      this.host.logDebug(
        `pick(${Math.round(x)}, ${Math.round(y)}) scaled to (${Math.round(scaledX)}, ${Math.round(scaledY)}) => ${pickResult?.pickedMesh?.name ?? 'none'} [${pickableMeshes.length} pickable, canvas ${canvas.width}x${canvas.height}, display ${Math.round(rect.width)}x${Math.round(rect.height)}]`,
      );
    }

    if (pickResult && pickResult.hit && pickResult.pickedMesh) {
      return pickResult;
    }

    const camera = this.host.getCamera();
    const ray = this.scene.createPickingRay(scaledX, scaledY, Matrix.Identity(), camera);
    const rayPick = this.scene.pickWithRay(ray, (mesh) => mesh.isPickable);

    if (!silent) {
      this.host.logDebug(`ray pick => ${rayPick?.pickedMesh?.name ?? 'none'}`);
    }

    if (rayPick && rayPick.hit && rayPick.pickedMesh) {
      return rayPick;
    }

    // A click into empty space hits nothing (it used to fall back to the cube in
    // the middle of the screen, selecting an arbitrary cube).
    return null;
  }
}
