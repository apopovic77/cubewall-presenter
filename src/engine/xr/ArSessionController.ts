import type { Scene } from '@babylonjs/core/scene';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience';
import { WebXRSessionManager } from '@babylonjs/core/XR/webXRSessionManager';
import { WebXRState } from '@babylonjs/core/XR/webXRTypes';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { AdvancedDynamicTexture } from '@babylonjs/gui/2D/advancedDynamicTexture';
import { Rectangle } from '@babylonjs/gui/2D/controls/rectangle';
import { StackPanel } from '@babylonjs/gui/2D/controls/stackPanel';
import { TextBlock } from '@babylonjs/gui/2D/controls/textBlock';
import type { CubeContentItem } from '../../types/content';

/** Longest side of the cube field in AR, in metres. */
const AR_WALL_SIZE_M = 1.2;
/** Distance of the field centre in front of the viewer, in metres. */
const AR_WALL_DISTANCE_M = 1.1;
/** Table height with a floor-anchored reference space, in metres. */
const AR_TABLE_HEIGHT_M = 0.8;
/** Below eye level when the device only offers a head-anchored reference space. */
const AR_BELOW_EYE_M = 0.6;

const INFO_PANEL_WIDTH_M = 0.56;
const INFO_PANEL_HEIGHT_M = 0.32;
const INFO_SUMMARY_MAX_CHARS = 320;

export interface ArSessionHooks {
  /** Pre-XR scene look (background, post-processing) is swapped for passthrough. */
  setPassthrough(active: boolean): void;
  /** A controller or hand selected a mesh (null: it pointed at nothing in the scene). */
  onSelect(mesh: AbstractMesh | null): void;
  onStateChange?(active: boolean): void;
}

/**
 * Immersive-AR mode for the cube wall (e.g. Meta Quest browser with passthrough).
 *
 * The cube field root is re-parented under an anchor node for the session, so
 * layouts and animations that drive the root keep working; the anchor scales the
 * field to table size and places it in front of the viewer. Squeeze (grip) places
 * it again in front of the current head pose.
 */
export class ArSessionController {
  private readonly scene: Scene;
  private readonly fieldRoot: TransformNode;
  private readonly hooks: ArSessionHooks;
  private xr: WebXRDefaultExperience | null = null;
  private anchor: TransformNode | null = null;
  private infoPanel: Mesh | null = null;
  private infoTexture: AdvancedDynamicTexture | null = null;
  private infoTitle: TextBlock | null = null;
  private infoMeta: TextBlock | null = null;
  private infoSummary: TextBlock | null = null;
  private referenceSpace: XRReferenceSpaceType = 'local-floor';
  private stateObserver: Observer<WebXRState> | null = null;
  private active = false;
  private disposed = false;

  constructor(scene: Scene, fieldRoot: TransformNode, hooks: ArSessionHooks) {
    this.scene = scene;
    this.fieldRoot = fieldRoot;
    this.hooks = hooks;
  }

  static isSupportedAsync(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !('xr' in navigator)) return Promise.resolve(false);
    return WebXRSessionManager.IsSessionSupportedAsync('immersive-ar').catch(() => false);
  }

  get isActive(): boolean {
    return this.active;
  }

  /**
   * Builds the XR helper ahead of time, so the click that starts AR goes straight
   * to requestSession while the browser still counts it as a user gesture.
   */
  async prepare(): Promise<void> {
    if (this.disposed) return;
    await this.ensureExperience();
  }

  /** Must be called from a user gesture (button click). */
  async enter(): Promise<void> {
    if (this.active || this.disposed) return;
    const xr = await this.ensureExperience();
    try {
      await xr.baseExperience.enterXRAsync('immersive-ar', 'local-floor', xr.renderTarget);
      this.referenceSpace = 'local-floor';
    } catch {
      // Some runtimes only grant a head-anchored space.
      await xr.baseExperience.enterXRAsync('immersive-ar', 'local', xr.renderTarget);
      this.referenceSpace = 'local';
    }
  }

  async exit(): Promise<void> {
    if (!this.active || !this.xr) return;
    await this.xr.baseExperience.exitXRAsync();
  }

  /** Shows the selected item on the floating info panel (null hides it). */
  showContent(item: CubeContentItem | null): void {
    if (!this.active || !this.infoPanel) return;
    if (!item) {
      this.infoPanel.setEnabled(false);
      return;
    }
    const published = item.publishedAt ? new Date(item.publishedAt) : null;
    const date = published && !Number.isNaN(published.getTime()) ? published.toLocaleDateString('de-DE') : '';
    const summary =
      item.summary.length > INFO_SUMMARY_MAX_CHARS
        ? `${item.summary.slice(0, INFO_SUMMARY_MAX_CHARS).trimEnd()} …`
        : item.summary;
    this.infoTitle!.text = item.title;
    this.infoMeta!.text = [item.sourceName, date].filter(Boolean).join(' · ');
    this.infoSummary!.text = summary;
    this.infoPanel.setEnabled(true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.active) this.restoreScene();
    if (this.stateObserver && this.xr) {
      this.xr.baseExperience.onStateChangedObservable.remove(this.stateObserver);
    }
    this.xr?.dispose();
    this.xr = null;
  }

  private async ensureExperience(): Promise<WebXRDefaultExperience> {
    if (this.xr) return this.xr;
    const xr = await WebXRDefaultExperience.CreateAsync(this.scene, {
      disableDefaultUI: true,
      disableTeleportation: true,
      // Babylon's near interaction would grab cubes on touch; selection is by pointer ray.
      disableNearInteraction: true,
      optionalFeatures: true,
    });
    this.stateObserver = xr.baseExperience.onStateChangedObservable.add((state) => {
      if (state === WebXRState.IN_XR) {
        this.onSessionStarted();
      } else if (state === WebXRState.NOT_IN_XR && this.active) {
        this.restoreScene();
      }
    });
    this.xr = xr;
    return xr;
  }

  private onSessionStarted(): void {
    const xr = this.xr!;
    this.active = true;
    this.hooks.setPassthrough(true);
    this.anchor = new TransformNode('arWallAnchor', this.scene);
    this.anchor.rotationQuaternion = Quaternion.Identity();
    this.fieldRoot.parent = this.anchor;
    this.createInfoPanel();

    const session = xr.baseExperience.sessionManager.session;
    session.addEventListener('select', this.handleSelect);
    session.addEventListener('squeeze', this.handleSqueeze);

    // The head pose is only valid once the first XR frame has been rendered.
    xr.baseExperience.sessionManager.onXRFrameObservable.addOnce(() => this.placeWall());
    this.hooks.onStateChange?.(true);
  }

  private restoreScene(): void {
    const session = this.xr?.baseExperience.sessionManager.session;
    session?.removeEventListener('select', this.handleSelect);
    session?.removeEventListener('squeeze', this.handleSqueeze);
    this.fieldRoot.parent = null;
    this.infoTexture?.dispose();
    this.infoPanel?.dispose();
    this.anchor?.dispose();
    this.infoTexture = null;
    this.infoPanel = null;
    this.anchor = null;
    this.infoTitle = this.infoMeta = this.infoSummary = null;
    this.active = false;
    this.hooks.setPassthrough(false);
    this.hooks.onStateChange?.(false);
  }

  private readonly handleSelect = (event: XRInputSourceEvent): void => {
    const xr = this.xr;
    if (!xr) return;
    const controller = xr.input.controllers.find((candidate) => candidate.inputSource === event.inputSource);
    const mesh = controller ? xr.pointerSelection.getMeshUnderPointer(controller.uniqueId) : null;
    this.hooks.onSelect(mesh);
  };

  private readonly handleSqueeze = (): void => {
    this.placeWall();
  };

  /** Scales the field to table size and puts it in front of the current head pose. */
  private placeWall(): void {
    const xr = this.xr;
    const anchor = this.anchor;
    if (!xr || !anchor) return;
    const head = xr.baseExperience.camera;

    // Measure the field in its own (unparented) scale.
    anchor.scaling.setAll(1);
    anchor.position.setAll(0);
    anchor.rotationQuaternion = Quaternion.Identity();
    anchor.computeWorldMatrix(true);
    const { min, max } = this.fieldRoot.getHierarchyBoundingVectors(true);
    const footprint = Math.max(max.x - min.x, max.z - min.z, 1e-3);
    const scale = AR_WALL_SIZE_M / footprint;
    const center = min.add(max).scale(0.5);

    const forward = head.getDirection(Vector3.Forward());
    forward.y = 0;
    if (forward.lengthSquared() < 1e-6) forward.set(0, 0, 1);
    forward.normalize();
    const yaw = Math.atan2(forward.x, forward.z);
    const height = this.referenceSpace === 'local-floor' ? AR_TABLE_HEIGHT_M : head.position.y - AR_BELOW_EYE_M;
    const target = head.position.add(forward.scale(AR_WALL_DISTANCE_M));
    target.y = height;

    anchor.scaling.setAll(scale);
    anchor.rotationQuaternion = Quaternion.RotationYawPitchRoll(yaw, 0, 0);
    // Shift so the field's centre (not the root origin) lands on the target.
    const rotatedCenter = center.scale(scale).applyRotationQuaternion(anchor.rotationQuaternion);
    anchor.position.copyFrom(target.subtract(new Vector3(rotatedCenter.x, 0, rotatedCenter.z)));
    anchor.position.y = height - min.y * scale;

    if (this.infoPanel) {
      const depth = (max.z - min.z) * scale;
      const panelPos = target.add(forward.scale(depth / 2 + 0.05));
      panelPos.y = height + INFO_PANEL_HEIGHT_M / 2 + 0.12;
      this.infoPanel.position.copyFrom(panelPos);
    }
  }

  private createInfoPanel(): void {
    const panel = MeshBuilder.CreatePlane(
      'arInfoPanel',
      { width: INFO_PANEL_WIDTH_M, height: INFO_PANEL_HEIGHT_M },
      this.scene,
    );
    panel.billboardMode = Mesh.BILLBOARDMODE_Y;
    panel.isPickable = false;
    panel.setEnabled(false);

    const texture = AdvancedDynamicTexture.CreateForMesh(panel, 1400, 800, false);
    const background = new Rectangle('arInfoBackground');
    background.thickness = 0;
    background.cornerRadius = 36;
    background.background = 'rgba(10, 14, 26, 0.86)';
    texture.addControl(background);

    const stack = new StackPanel('arInfoStack');
    stack.paddingLeft = '56px';
    stack.paddingRight = '56px';
    stack.paddingTop = '48px';
    stack.verticalAlignment = StackPanel.VERTICAL_ALIGNMENT_TOP;
    background.addControl(stack);

    this.infoMeta = this.createText('arInfoMeta', 36, '#93a4c8', 60);
    this.infoTitle = this.createText('arInfoTitle', 58, '#ffffff', 220, 'bold');
    this.infoSummary = this.createText('arInfoSummary', 38, '#d6dcea', 420);
    stack.addControl(this.infoMeta);
    stack.addControl(this.infoTitle);
    stack.addControl(this.infoSummary);

    this.infoPanel = panel;
    this.infoTexture = texture;
  }

  private createText(name: string, fontSize: number, color: string, heightPx: number, fontWeight = 'normal'): TextBlock {
    const text = new TextBlock(name);
    text.fontSize = fontSize;
    text.fontWeight = fontWeight;
    text.color = color;
    text.height = `${heightPx}px`;
    text.textWrapping = true;
    text.textHorizontalAlignment = TextBlock.HORIZONTAL_ALIGNMENT_LEFT;
    text.textVerticalAlignment = TextBlock.VERTICAL_ALIGNMENT_TOP;
    return text;
  }
}
