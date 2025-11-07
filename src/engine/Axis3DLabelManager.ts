import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';

export interface AxisLabelData {
  id: string;
  text: string;
  worldPosition: Vector3;
}

interface Axis3DLabelEntry {
  plane: Mesh;
  material: StandardMaterial;
  texture: DynamicTexture;
  text: string;
}

export class Axis3DLabelManager {
  private readonly scene: Scene;

  private readonly entries = new Map<string, Axis3DLabelEntry>();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  public update(labels: AxisLabelData[], cameraPosition: Vector3): void {
    const active = new Set(labels.map((label) => label.id));

    labels.forEach((label) => {
      const entry = this.ensureEntry(label.id);
      if (entry.text !== label.text) {
        this.drawText(entry, label.text);
        entry.text = label.text;
      }
      entry.plane.position.copyFrom(label.worldPosition);
      entry.plane.lookAt(cameraPosition);
      entry.plane.rotation.y += Math.PI;
      entry.plane.rotation.x += Math.PI;
    });

    Array.from(this.entries.entries()).forEach(([id, entry]) => {
      if (!active.has(id)) {
        this.disposeEntry(entry);
        this.entries.delete(id);
      }
    });
  }

  public dispose(): void {
    Array.from(this.entries.values()).forEach((entry) => this.disposeEntry(entry));
    this.entries.clear();
  }

  private ensureEntry(id: string): Axis3DLabelEntry {
    let entry = this.entries.get(id);
    if (entry) {
      entry.plane.setEnabled(true);
      return entry;
    }

    const plane = MeshBuilder.CreatePlane(`axisLabel_${id}`, { width: 2, height: 0.6 }, this.scene);
    plane.isPickable = false;
    plane.renderingGroupId = 0;

    const material = new StandardMaterial(`axisLabelMat_${id}`, this.scene);
    material.disableLighting = true;
    material.emissiveColor = new Color3(0.95, 0.97, 1);
    material.specularColor = Color3.Black();
    material.backFaceCulling = false;
    material.forceDepthWrite = true;
    material.useAlphaFromDiffuseTexture = true;
    material.needDepthPrePass = true;

    const texture = new DynamicTexture(`axisLabelTex_${id}`, { width: 1024, height: 256 }, this.scene, true);
    texture.hasAlpha = true;
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;

    material.diffuseTexture = texture;
    material.opacityTexture = texture;
    plane.material = material;

    entry = {
      plane,
      material,
      texture,
      text: '',
    };
    this.entries.set(id, entry);
    return entry;
  }

  private drawText(entry: Axis3DLabelEntry, text: string): void {
    const { texture, plane } = entry;
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    const { width, height } = texture.getSize();
    ctx.clearRect(0, 0, width, height);
    ctx.font = '600 110px "Inter", "Helvetica", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#111111';
    const padding = 30;
    ctx.fillText(text, padding, height / 2);
    texture.update(false);

    const metrics = ctx.measureText(text);
    const textWidth = Math.max(metrics.width + padding * 2, 200);
    const planeWidth = textWidth / 450;
    plane.scaling.x = planeWidth;
    plane.scaling.y = 0.6;
  }

  private disposeEntry(entry: Axis3DLabelEntry): void {
    entry.plane.dispose();
    entry.material.dispose();
    entry.texture.dispose();
  }
}

