import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
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
  config: CubeWallConfig;
  onRequestClose?: () => void;
}

export class BillboardOverlay {
  private readonly scene: Scene;
  private readonly config: CubeWallConfig;
  private readonly onRequestClose?: () => void;

  private readonly root: TransformNode;
  private readonly plane: Mesh;
  private readonly texture: AdvancedDynamicTexture;
  private readonly container: Rectangle;
  private readonly infoText: TextBlock;
  private readonly offsetVector = new Vector3(0, 0, 0);
  private readonly dateFormatter = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });

  private lineMesh: Mesh | null = null;
  private selectedCell: CubeCell | null = null;
  private isVisible = false;

  constructor({ scene, config, onRequestClose }: BillboardOverlayOptions) {
    this.scene = scene;
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
  }

  public deselect(_animateCameraBack: boolean): void {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.plane.setEnabled(false);
    if (this.lineMesh) {
      this.lineMesh.dispose();
      this.lineMesh = null;
    }
    this.selectedCell = null;
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
  }

  private updateBillboardText(selectionInfo: CubeSelectionInfo): void {
    const item = selectionInfo.content;
    if (item) {
      const lines: string[] = [];
      lines.push(item.title || 'Unbenannter Beitrag');

      const metaParts: string[] = [];
      if (item.sourceName) metaParts.push(item.sourceName);
      if (item.publishedAt) {
        const date = new Date(item.publishedAt);
        if (!Number.isNaN(date.getTime())) {
          metaParts.push(this.dateFormatter.format(date));
        }
      }
      if (item.category) metaParts.push(item.category);
      if (metaParts.length > 0) {
        lines.push(metaParts.join(' · '));
      }

      if (item.summary) {
        lines.push('', item.summary);
      }

      if (item.url) {
        lines.push('', item.url);
      }

      this.infoText.text = lines.join('\n');
    } else {
      const colorHex = selectionInfo.color.toHexString();
      const textureLabel = this.getTextureLabel(selectionInfo.textureUrl);
      this.infoText.text = `Cube (${selectionInfo.gridX}, ${selectionInfo.gridZ})\nColor: ${colorHex}\nTexture: ${textureLabel}`;
    }
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
}

