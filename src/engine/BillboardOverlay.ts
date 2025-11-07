import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Scalar } from '@babylonjs/core/Maths/math.scalar';
import { Tools } from '@babylonjs/core/Misc/tools';
import '@babylonjs/core/Shaders/color.vertex';
import '@babylonjs/core/Shaders/color.fragment';
import { AdvancedDynamicTexture } from '@babylonjs/gui/2D/advancedDynamicTexture';
import { Rectangle } from '@babylonjs/gui/2D/controls/rectangle';
import { TextBlock } from '@babylonjs/gui/2D/controls/textBlock';
import { Button } from '@babylonjs/gui/2D/controls/button';
import type { CubeCell } from './CubeField';
import type { CubeSelectionInfo } from './CubeField';
import type { CubeWallConfig } from '../config/AppConfig';

export interface BillboardOverlayOptions {
  scene: Scene;
  camera: ArcRotateCamera;
  config: CubeWallConfig;
  onRequestClose?: () => void;
}

interface CameraTargetState {
  lookAt: Vector3;
  radius: number | null;
  alpha: number | null;
  beta: number | null;
  position: Vector3 | null;
}

export class BillboardOverlay {
  private readonly scene: Scene;
  private readonly camera: ArcRotateCamera;
  private readonly config: CubeWallConfig;
  private readonly onRequestClose?: () => void;

  private readonly root: TransformNode;
  private readonly plane: Mesh;
  private readonly texture: AdvancedDynamicTexture;
  private readonly container: Rectangle;
  private readonly infoText: TextBlock;
  private readonly offsetVector = new Vector3(0, 0, 0);

  private lineMesh: Mesh | null = null;
  private selectedCell: CubeCell | null = null;
  private isVisible = false;

  private readonly cameraTarget: CameraTargetState = {
    lookAt: Vector3.Zero(),
    radius: null,
    alpha: null,
    beta: null,
    position: null,
  };

  private isAnimatingCamera = false;

  constructor({ scene, camera, config, onRequestClose }: BillboardOverlayOptions) {
    this.scene = scene;
    this.camera = camera;
    this.config = config;
    this.onRequestClose = onRequestClose;

    this.root = new TransformNode('billboardRoot', this.scene);
    this.plane = MeshBuilder.CreatePlane('billboardPlane', {
      width: 3,
      height: 1.6,
    }, this.scene);
    this.plane.parent = this.root;
    this.plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.plane.isPickable = false;
    this.plane.setEnabled(false);

    this.texture = AdvancedDynamicTexture.CreateForMesh(this.plane, 1024, 512, false);

    this.container = new Rectangle('billboardContainer');
    this.container.widthInPixels = 920;
    this.container.heightInPixels = 360;
    this.container.cornerRadius = 28;
    this.container.thickness = 2;
    this.container.color = 'rgba(120,160,255,0.35)';
    this.container.background = 'rgba(15, 22, 40, 0.72)';
    this.container.paddingTopInPixels = 28;
    this.container.paddingLeftInPixels = 32;
    this.container.paddingRightInPixels = 32;
    this.container.paddingBottomInPixels = 24;
    this.texture.addControl(this.container);

    this.infoText = new TextBlock('billboardInfo');
    this.infoText.color = '#f5f8ff';
    this.infoText.fontSize = 42;
    this.infoText.textWrapping = true;
    this.infoText.textHorizontalAlignment = TextBlock.HORIZONTAL_ALIGNMENT_LEFT;
    this.infoText.textVerticalAlignment = TextBlock.VERTICAL_ALIGNMENT_TOP;
    this.infoText.lineSpacing = '16px';
    this.container.addControl(this.infoText);

    const closeButton = Button.CreateSimpleButton('billboardClose', '×');
    closeButton.widthInPixels = 60;
    closeButton.heightInPixels = 60;
    closeButton.fontSize = 48;
    closeButton.color = '#f5f8ff';
    closeButton.background = 'rgba(120, 150, 255, 0.25)';
    closeButton.cornerRadius = 30;
    closeButton.horizontalAlignment = Button.HORIZONTAL_ALIGNMENT_RIGHT;
    closeButton.verticalAlignment = Button.VERTICAL_ALIGNMENT_TOP;
    closeButton.topInPixels = 8;
    closeButton.leftInPixels = -8;
    closeButton.thickness = 0;
    closeButton.onPointerUpObservable.add(() => {
      this.deselect(true);
      this.onRequestClose?.();
    });
    this.container.addControl(closeButton);
  }

  public select(cell: CubeCell, selectionInfo: CubeSelectionInfo): void {
    this.selectedCell = cell;
    this.updateBillboardText(selectionInfo);
    if (this.config.billboard.mode === '3d') {
      this.isVisible = true;
      this.plane.setEnabled(true);
    } else {
      this.isVisible = false;
      this.plane.setEnabled(false);
    }
    this.updateBillboardPosition();
    if (this.config.selectionCameraFollowEnabled) {
      this.flyToSelection(cell);
    }
  }

  public deselect(animateCameraBack: boolean): void {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.plane.setEnabled(false);
    if (this.lineMesh) {
      this.lineMesh.dispose();
      this.lineMesh = null;
    }
    this.selectedCell = null;
    if (animateCameraBack && this.config.selectionCameraFollowEnabled) {
      this.flyToOverview();
    } else {
      this.isAnimatingCamera = false;
    }
  }

  public update(): void {
    const shouldShowPlane = this.config.billboard.mode === '3d' && !!this.selectedCell;
    if (this.plane.isEnabled() !== shouldShowPlane) {
      this.plane.setEnabled(shouldShowPlane);
      this.isVisible = shouldShowPlane;
    }

    if (this.isVisible) {
      this.updateBillboardPosition();
    } else if (this.selectedCell) {
      // Even in HTML mode keep offset updated for world position projection
      this.updateBillboardPosition();
    }
    if (this.isAnimatingCamera) {
      this.updateCameraLerp();
    }
  }

  private updateBillboardText(selectionInfo: CubeSelectionInfo): void {
    const colorHex = selectionInfo.color.toHexString();
    const textureLabel = this.getTextureLabel(selectionInfo.textureUrl);
    this.infoText.text = `Cube (${selectionInfo.gridX}, ${selectionInfo.gridZ})\nColor: ${colorHex}\nTexture: ${textureLabel}`;
    this.texture.markAsDirty();
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

  private updateBillboardPosition(): void {
    if (!this.selectedCell) return;
    const cubePosition = this.selectedCell.mesh.getAbsolutePosition();
    const height = this.config.cubeSize * this.config.billboard.heightOffset;
    const distance = this.config.cubeSize * this.config.billboard.distance;
    const angle = Tools.ToRadians(this.config.billboard.angleDegrees);
    this.offsetVector.set(
      Math.cos(angle) * distance,
      height,
      Math.sin(angle) * distance,
    );
    this.root.position.copyFrom(cubePosition.add(this.offsetVector));
    this.updateLine(cubePosition);
  }

  private updateLine(cubePosition: Vector3): void {
    if (this.config.billboard.mode !== '3d') {
      if (this.lineMesh) {
        this.lineMesh.dispose();
        this.lineMesh = null;
      }
      return;
    }

    if (this.lineMesh) {
      this.lineMesh.dispose();
      this.lineMesh = null;
    }
    const points = [cubePosition, this.root.position.clone()];
    this.lineMesh = MeshBuilder.CreateLines('billboardLine', { points }, this.scene);
    this.lineMesh.isPickable = false;
  }

  private flyToSelection(cell: CubeCell): void {
    const cubePosition = cell.mesh.getAbsolutePosition();
    if (this.config.camera.useCustomView) {
      this.cameraTarget.lookAt = cubePosition.add(new Vector3(
        this.config.camera.lookAtOffset.x,
        this.config.camera.lookAtOffset.y,
        this.config.camera.lookAtOffset.z,
      ));
      this.cameraTarget.position = cubePosition.add(new Vector3(
        this.config.camera.offset.x,
        this.config.camera.offset.y,
        this.config.camera.offset.z,
      ));
      this.cameraTarget.radius = null;
      this.cameraTarget.alpha = null;
      this.cameraTarget.beta = null;
    } else {
      this.cameraTarget.lookAt = cubePosition.clone();
      const zoomRadius = this.config.cubeSize * this.config.camera.flyToRadiusFactor;
      const direction = this.camera.position.subtract(this.camera.target).normalize();
      this.cameraTarget.position = cubePosition.add(direction.scale(zoomRadius));
      this.cameraTarget.radius = zoomRadius;
      this.cameraTarget.alpha = this.camera.alpha;
      this.cameraTarget.beta = this.camera.beta;
    }
    this.isAnimatingCamera = true;
  }

  private flyToOverview(): void {
    const lookAt = new Vector3(0, Math.max(1, this.config.gridSize / 10), 0);
    this.cameraTarget.lookAt = lookAt;
    this.cameraTarget.radius = this.config.camera.radius;
    this.cameraTarget.alpha = this.camera.alpha;
    this.cameraTarget.beta = this.camera.beta;
    this.cameraTarget.position = null;
    this.isAnimatingCamera = true;
  }

  private updateCameraLerp(): void {
    const speed = this.config.camera.lerpSpeedFactor * this.config.camera.animationSpeedFactor;
    const stopThresholdPos = 0.01;
    const stopThresholdAngle = 0.001;
    const stopThresholdRadius = 0.01;

    let isConverged = true;

    if (!this.camera.target.equalsWithEpsilon(this.cameraTarget.lookAt, stopThresholdPos)) {
      this.camera.target = Vector3.Lerp(this.camera.target, this.cameraTarget.lookAt, speed);
      isConverged = false;
    }

    if (this.cameraTarget.radius !== null) {
      if (Math.abs(this.camera.radius - this.cameraTarget.radius) > stopThresholdRadius) {
        this.camera.radius = Scalar.Lerp(this.camera.radius, this.cameraTarget.radius, speed);
        isConverged = false;
      } else {
        this.camera.radius = this.cameraTarget.radius;
      }
    }

    if (this.cameraTarget.alpha !== null) {
      if (Math.abs(this.camera.alpha - this.cameraTarget.alpha) > stopThresholdAngle) {
        this.camera.alpha = Scalar.Lerp(this.camera.alpha, this.cameraTarget.alpha, speed);
        isConverged = false;
      } else {
        this.camera.alpha = this.cameraTarget.alpha;
      }
    }

    if (this.cameraTarget.beta !== null) {
      if (Math.abs(this.camera.beta - this.cameraTarget.beta) > stopThresholdAngle) {
        this.camera.beta = Scalar.Lerp(this.camera.beta, this.cameraTarget.beta, speed);
        this.camera.beta = Scalar.Clamp(this.camera.beta, this.camera.lowerBetaLimit ?? 0.01, this.camera.upperBetaLimit ?? Math.PI - 0.01);
        isConverged = false;
      } else {
        this.camera.beta = this.cameraTarget.beta;
      }
    }

    if (this.cameraTarget.position && !this.camera.position.equalsWithEpsilon(this.cameraTarget.position, stopThresholdPos)) {
      this.camera.position = Vector3.Lerp(this.camera.position, this.cameraTarget.position, speed);
      isConverged = false;
    }

    if (isConverged) {
      this.isAnimatingCamera = false;
      if (this.cameraTarget.position) {
        this.camera.position.copyFrom(this.cameraTarget.position);
      }
      this.camera.target.copyFrom(this.cameraTarget.lookAt);
    }
  }

  public getCurrentOffset(): Vector3 {
    return this.offsetVector.clone();
  }

  public getAttachmentWorldPosition(): Vector3 {
    return this.root.getAbsolutePosition().clone();
  }

  public dispose(): void {
    this.plane.dispose();
    this.texture.dispose();
    this.container.dispose();
    if (this.lineMesh) {
      this.lineMesh.dispose();
      this.lineMesh = null;
    }
    this.root.dispose();
  }

  public interruptCameraAnimation(): void {
    this.isAnimatingCamera = false;
  }

  public captureCurrentCameraState(): void {
    this.cameraTarget.lookAt = this.camera.target.clone();
    this.cameraTarget.radius = this.camera.radius;
    this.cameraTarget.alpha = this.camera.alpha;
    this.cameraTarget.beta = this.camera.beta;
    this.cameraTarget.position = this.camera.position.clone();
  }
}

