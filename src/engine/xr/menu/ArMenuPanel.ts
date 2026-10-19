import type { Scene } from '@babylonjs/core/scene';
import type { Ray } from '@babylonjs/core/Culling/ray';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import {
  AR_MENU_CANVAS_PX,
  AR_MENU_WORLD_SIZE_M,
  buildArMenu,
  menuItemAt,
  type ArMenuItem,
  type ArMenuSection,
  type ArMenuState,
} from './ArMenuModel';
import { paintArMenu } from './ArMenuPaint';

const PRESSED_MS = 160;

export interface ArMenuHit {
  item: ArMenuItem | null;
  point: Vector3;
}

/**
 * One square, unlit panel with a canvas texture; repainted only when its
 * content, hover or pressed state changes. Hit testing maps a ray's UV on the
 * panel back to the item rectangles.
 */
export class ArMenuPanel {
  readonly mesh: Mesh;
  private readonly texture: DynamicTexture;
  private readonly context: CanvasRenderingContext2D;
  private readonly material: StandardMaterial;
  private items: ArMenuItem[] = [];
  private sections: ArMenuSection[] = [];
  private state: ArMenuState | null = null;
  private hovered: ArMenuItem['action'] | null = null;
  private pressed: { action: ArMenuItem['action']; until: number } | null = null;
  private paintKey = '';

  private readonly title: string;

  constructor(scene: Scene, title: string) {
    this.title = title;
    this.mesh = MeshBuilder.CreatePlane(
      'arMenuPanel',
      { width: AR_MENU_WORLD_SIZE_M, height: AR_MENU_WORLD_SIZE_M, sideOrientation: Mesh.FRONTSIDE },
      scene,
    );
    this.mesh.isPickable = true;
    this.mesh.setEnabled(false);

    this.texture = new DynamicTexture('arMenuTexture', { width: AR_MENU_CANVAS_PX, height: AR_MENU_CANVAS_PX }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    this.texture.hasAlpha = true;
    this.context = this.texture.getContext() as CanvasRenderingContext2D;

    this.material = new StandardMaterial('arMenuMaterial', scene);
    // Unlit: room lighting must not darken the panel.
    this.material.disableLighting = true;
    this.material.emissiveTexture = this.texture;
    this.material.opacityTexture = this.texture;
    this.material.diffuseColor = Color3.Black();
    this.material.backFaceCulling = true;
    this.mesh.material = this.material;
  }

  get visible(): boolean {
    return this.mesh.isEnabled();
  }

  setVisible(visible: boolean): void {
    this.mesh.setEnabled(visible);
    if (!visible) this.setHovered(null);
  }

  setState(state: ArMenuState): void {
    this.state = state;
    const layout = buildArMenu(state);
    this.items = layout.items;
    this.sections = layout.sections;
    this.repaintIfNeeded();
  }

  /** Ray against the panel; returns the item under the hit point (or null if the panel is hit between items). */
  hitTest(ray: Ray): ArMenuHit | null {
    if (!this.visible) return null;
    const pick = ray.intersectsMesh(this.mesh, false);
    if (!pick.hit || !pick.pickedPoint) return null;
    const uv = pick.getTextureCoordinates();
    if (!uv) return null;
    return { item: this.itemAtUv(uv.x, uv.y), point: pick.pickedPoint };
  }

  /** Item under a world point on (or near) the panel plane, for finger pokes. */
  itemAtWorldPoint(point: Vector3): ArMenuItem | null {
    const local = Vector3.TransformCoordinates(point, this.mesh.getWorldMatrix().clone().invert());
    const u = local.x / AR_MENU_WORLD_SIZE_M + 0.5;
    const v = local.y / AR_MENU_WORLD_SIZE_M + 0.5;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    return this.itemAtUv(u, v);
  }

  setHovered(action: ArMenuItem['action'] | null): void {
    if (this.hovered === action) return;
    this.hovered = action;
    this.repaintIfNeeded();
  }

  /** Paints the pressed feedback; call `tick` every frame so it fades. */
  flashPressed(action: ArMenuItem['action']): void {
    this.pressed = { action, until: performance.now() + PRESSED_MS };
    this.repaintIfNeeded();
  }

  tick(): void {
    if (this.pressed && performance.now() > this.pressed.until) {
      this.pressed = null;
      this.repaintIfNeeded();
    }
  }

  dispose(): void {
    this.mesh.dispose();
    this.material.dispose(true, true);
  }

  private itemAtUv(u: number, v: number): ArMenuItem | null {
    // Plane UV v runs bottom-up; canvas y runs top-down.
    return menuItemAt(this.items, u * AR_MENU_CANVAS_PX, (1 - v) * AR_MENU_CANVAS_PX);
  }

  private repaintIfNeeded(): void {
    if (!this.state) return;
    const key = JSON.stringify([this.state, this.hovered, this.pressed?.action ?? null]);
    if (key === this.paintKey) return;
    this.paintKey = key;
    this.paint();
    this.texture.update();
  }
  private paint(): void {
    paintArMenu(this.context, { title: this.title, items: this.items, sections: this.sections, hovered: this.hovered, pressed: this.pressed?.action ?? null });
  }
}
