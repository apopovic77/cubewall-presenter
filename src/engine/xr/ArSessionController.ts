import type { Scene } from '@babylonjs/core/scene';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience';
import { WebXRSessionManager } from '@babylonjs/core/XR/webXRSessionManager';
import { WebXRState } from '@babylonjs/core/XR/webXRTypes';
import { WebXRFeatureName } from '@babylonjs/core/XR/webXRFeaturesManager';
import { WebXRHandJoint, type WebXRHand } from '@babylonjs/core/XR/features/WebXRHandTracking';
import type { WebXRInputSource } from '@babylonjs/core/XR/webXRInputSource';
import type { Observer } from '@babylonjs/core/Misc/observable';
import { AdvancedDynamicTexture } from '@babylonjs/gui/2D/advancedDynamicTexture';
import { Rectangle } from '@babylonjs/gui/2D/controls/rectangle';
import { StackPanel } from '@babylonjs/gui/2D/controls/stackPanel';
import { TextBlock } from '@babylonjs/gui/2D/controls/textBlock';
import type { CubeContentItem } from '../../types/content';
import { ArMenuController } from './menu/ArMenuController';
import type { ArMenuAction, ArMenuState } from './menu/ArMenuModel';

/** Longest side of the cube field when AR starts, in metres. */
const AR_WALL_SIZE_M = 1.2;
/** Distance of the field centre in front of the viewer, in metres. */
const AR_WALL_DISTANCE_M = 1.0;
/** Field surface below eye level when AR starts (about table height when standing), in metres. */
const AR_BELOW_EYE_M = 0.5;
/** Two-hand scaling limits, relative to the start size. */
const AR_MIN_SCALE_FACTOR = 0.15;
const AR_MAX_SCALE_FACTOR = 6;
/** Size change per "Feld größer / kleiner" press. */
const MENU_SCALE_STEP = 1.3;
/** XR frames to wait for a valid head pose before the first placement. */
const AR_PLACEMENT_FRAME_DELAY = 6;

/** A pinch or grip this close to a cube's surface grabs the cube instead of the field. */
const NEAR_GRAB_MARGIN_M = 0.03;
/** Holding trigger/pinch this long on a cube under the ray picks it up on the ray. */
const RAY_HOLD_MS = 350;
/** Thumb and index tips closer than this count as pinching (no finger-touch selection then). */
const PINCH_DISTANCE_M = 0.03;
/** Window of hand positions used for the throw velocity on release. */
const THROW_SAMPLE_MS = 100;

const INFO_PANEL_WIDTH_M = 0.56;
const INFO_PANEL_HEIGHT_M = 0.32;
const INFO_PANEL_GAP_M = 0.06;
const INFO_SUMMARY_MAX_CHARS = 320;

export interface ArSessionHooks {
  /** Pre-XR scene look (background, post-processing) is swapped for passthrough. */
  setPassthrough(active: boolean): void;
  /** True when a pointer on this mesh means "select it" rather than "grab the field". */
  isSelectable(mesh: AbstractMesh | null): boolean;
  /** A controller or hand selected a cube mesh. */
  onSelect(mesh: AbstractMesh): void;
  /** Cube mesh whose surface is within `margin` metres of a world point (negative: inside), or null. */
  findCubeNear(point: Vector3, margin: number): AbstractMesh | null;
  /** A hand or ray takes the cube; `holdCube` poses it until `releaseCube`. */
  grabCube(mesh: AbstractMesh): void;
  holdCube(mesh: AbstractMesh, world: Matrix): void;
  /** `worldVelocity` in m/s, for throwing it under physics. */
  releaseCube(mesh: AbstractMesh, worldVelocity: Vector3): void;
  /** Toggle states shown on the AR menu. */
  getMenuState(): ArMenuState;
  /** Menu actions other than placing the field and leaving AR (handled here). */
  onMenuAction(action: ArMenuAction): void;
  onStateChange?(active: boolean): void;
}

/** A cube carried by a hand (grip / pinch at the cube) or on a controller ray. */
interface CubeHold {
  mesh: AbstractMesh;
  controller: WebXRInputSource;
  via: 'grip' | 'ray';
  /** Cube pose relative to the holding node at pick-up. */
  offset: Matrix;
  samples: Array<{ position: Vector3; time: number }>;
}

interface FieldBounds {
  min: Vector3;
  max: Vector3;
  center: Vector3;
}

/** Anchor and hand poses when the current one- or two-hand gesture began. */
interface GrabSnapshot {
  handCount: number;
  anchorPosition: Vector3;
  scale: number;
  yaw: number;
  first: Vector3;
  midpoint: Vector3;
  distance: number;
  angle: number;
}

/**
 * Immersive-AR mode for the cube wall (e.g. Meta Quest browser with passthrough).
 *
 * The cube field root is re-parented under an anchor node for the session, so
 * layouts and animations that drive the root keep working; the anchor carries
 * the AR placement (position, yaw, uniform scale).
 *
 * Input: pointing at a cube and pinching / pulling the trigger selects it.
 * Grabbing (grip button, or pinch / trigger aimed past the cubes) moves the
 * field with one hand; with both hands it also scales and turns it.
 */
export class ArSessionController {
  private readonly scene: Scene;
  private readonly fieldRoot: TransformNode;
  private readonly hooks: ArSessionHooks;
  private xr: WebXRDefaultExperience | null = null;
  private anchor: TransformNode | null = null;
  private bounds: FieldBounds | null = null;
  private baseScale = 1;
  private yaw = 0;
  private placed = false;
  private framesUntilPlacement = 0;
  private readonly grabs = new Map<XRInputSource, WebXRInputSource>();
  /** Trigger/pinch pressed with the ray on a cube: a short press selects, a long one picks it up. */
  private readonly pendingRayPicks = new Map<XRInputSource, { mesh: AbstractMesh; startedAt: number }>();
  private readonly cubeHolds = new Map<XRInputSource, CubeHold>();
  /** Cube each index finger currently touches (one selection per touch). */
  private readonly touchedCubes = new Map<XRHandedness, AbstractMesh | null>();
  /** Input sources whose current select gesture belongs to the menu. */
  private readonly menuSelects = new Set<XRInputSource>();
  private menu: ArMenuController | null = null;
  private grabSnapshot: GrabSnapshot | null = null;
  private infoPanel: Mesh | null = null;
  private infoTexture: AdvancedDynamicTexture | null = null;
  private infoTitle: TextBlock | null = null;
  private infoMeta: TextBlock | null = null;
  private infoSummary: TextBlock | null = null;
  private stateObserver: Observer<WebXRState> | null = null;
  private frameObserver: Observer<XRFrame> | null = null;
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
    } catch {
      // Some runtimes only grant a head-anchored space; placement is head-relative anyway.
      await xr.baseExperience.enterXRAsync('immersive-ar', 'local', xr.renderTarget);
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

  /** Re-reads the menu's toggle states after a change made outside the menu. */
  refreshMenu(): void {
    this.menu?.refresh();
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
      // Babylon's near interaction would grab cubes on touch; grabbing is handled here.
      disableNearInteraction: true,
      optionalFeatures: true,
      // A ray on every hand / controller at once, not only on the one that clicked last.
      pointerSelectionOptions: { enablePointerSelectionOnAllControllers: true },
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
    this.bounds = this.measureField();
    const footprint = Math.max(this.bounds.max.x - this.bounds.min.x, this.bounds.max.z - this.bounds.min.z, 1e-3);
    this.baseScale = AR_WALL_SIZE_M / footprint;
    this.createInfoPanel();
    this.menu = new ArMenuController(this.scene, xr, {
      getState: () => this.hooks.getMenuState(),
      onAction: (action) => this.handleMenuAction(action),
    });

    const session = xr.baseExperience.sessionManager.session;
    session.addEventListener('selectstart', this.handleSelectStart);
    session.addEventListener('select', this.handleSelect);
    session.addEventListener('selectend', this.handleSelectEnd);
    session.addEventListener('squeezestart', this.handleSqueezeStart);
    session.addEventListener('squeezeend', this.handleSqueezeEnd);
    session.addEventListener('inputsourceschange', this.handleInputSourcesChange);

    this.placed = false;
    this.framesUntilPlacement = AR_PLACEMENT_FRAME_DELAY;
    this.frameObserver = xr.baseExperience.sessionManager.onXRFrameObservable.add(() => this.onFrame());
    this.hooks.onStateChange?.(true);
  }

  private restoreScene(): void {
    const sessionManager = this.xr?.baseExperience.sessionManager;
    const session = sessionManager?.session;
    session?.removeEventListener('selectstart', this.handleSelectStart);
    session?.removeEventListener('select', this.handleSelect);
    session?.removeEventListener('selectend', this.handleSelectEnd);
    session?.removeEventListener('squeezestart', this.handleSqueezeStart);
    session?.removeEventListener('squeezeend', this.handleSqueezeEnd);
    session?.removeEventListener('inputsourceschange', this.handleInputSourcesChange);
    if (this.frameObserver && sessionManager) {
      sessionManager.onXRFrameObservable.remove(this.frameObserver);
    }
    this.frameObserver = null;
    this.grabs.clear();
    this.pendingRayPicks.clear();
    [...this.cubeHolds.keys()].forEach((source) => this.endCubeHold(source));
    this.touchedCubes.clear();
    this.menuSelects.clear();
    this.menu?.dispose();
    this.menu = null;
    this.grabSnapshot = null;

    this.fieldRoot.parent = null;
    this.infoTexture?.dispose();
    this.infoPanel?.dispose();
    this.anchor?.dispose();
    this.infoTexture = null;
    this.infoPanel = null;
    this.anchor = null;
    this.bounds = null;
    this.infoTitle = this.infoMeta = this.infoSummary = null;
    this.active = false;
    this.hooks.setPassthrough(false);
    this.hooks.onStateChange?.(false);
  }

  private onFrame(): void {
    if (!this.placed) {
      // The head pose is not valid on the very first frames of a session.
      this.framesUntilPlacement -= 1;
      if (this.framesUntilPlacement <= 0) {
        this.placeInFrontOfViewer();
        this.placed = true;
      }
      return;
    }
    this.promoteRayPicks();
    if (this.cubeHolds.size > 0) this.updateCubeHolds();
    this.updateFingerTouch();
    if (this.grabs.size > 0) this.updateGrab();
    this.updateInfoPanelPosition();
  }

  // --- input ---------------------------------------------------------------

  private controllerFor(inputSource: XRInputSource): WebXRInputSource | undefined {
    return this.xr?.input.controllers.find((candidate) => candidate.inputSource === inputSource);
  }

  private meshUnderPointer(controller: WebXRInputSource | undefined): AbstractMesh | null {
    if (!controller || !this.xr) return null;
    return this.xr.pointerSelection.getMeshUnderPointer(controller.uniqueId);
  }

  private handleMenuAction(action: ArMenuAction): void {
    if (action === 'place-field') {
      this.placeInFrontOfViewer();
    } else if (action === 'field-bigger') {
      this.scaleField(MENU_SCALE_STEP);
    } else if (action === 'field-smaller') {
      this.scaleField(1 / MENU_SCALE_STEP);
    } else if (action === 'exit-ar') {
      void this.exit();
    } else {
      this.hooks.onMenuAction(action);
    }
  }

  private readonly handleSelectStart = (event: XRInputSourceEvent): void => {
    const controller = this.controllerFor(event.inputSource);
    if (!controller) return;
    if (this.menu?.capturesSelect(controller)) {
      this.menuSelects.add(event.inputSource);
      return;
    }
    // Second hand pinching while the first one aims at the field: both grab the
    // field (move / scale / turn), whatever cube the rays happen to hit.
    if (this.convertToTwoHandGrab(event.inputSource, controller)) return;
    const nearCube = this.hooks.findCubeNear(this.grabPoint(controller), NEAR_GRAB_MARGIN_M);
    if (nearCube) {
      this.startCubeHold(event.inputSource, controller, nearCube, 'grip');
      return;
    }
    const pointed = this.meshUnderPointer(controller);
    if (pointed && this.hooks.isSelectable(pointed)) {
      this.pendingRayPicks.set(event.inputSource, { mesh: pointed, startedAt: performance.now() });
    } else {
      this.startGrab(event.inputSource, controller);
    }
  };

  private readonly handleSelect = (event: XRInputSourceEvent): void => {
    if (this.menuSelects.has(event.inputSource)) {
      const controller = this.controllerFor(event.inputSource);
      if (controller) this.menu?.handleSelect(controller);
      return;
    }
    // Still pending means a short press: select. A long press became a ray hold instead.
    const pick = this.pendingRayPicks.get(event.inputSource);
    if (!pick) return;
    this.pendingRayPicks.delete(event.inputSource);
    this.hooks.onSelect(pick.mesh);
  };

  private readonly handleSelectEnd = (event: XRInputSourceEvent): void => {
    this.pendingRayPicks.delete(event.inputSource);
    this.endCubeHold(event.inputSource);
    this.menuSelects.delete(event.inputSource);
    this.endGrab(event.inputSource);
  };

  private readonly handleSqueezeStart = (event: XRInputSourceEvent): void => {
    const controller = this.controllerFor(event.inputSource);
    if (!controller) return;
    const nearCube = this.hooks.findCubeNear(this.grabPoint(controller), NEAR_GRAB_MARGIN_M);
    if (nearCube) {
      this.startCubeHold(event.inputSource, controller, nearCube, 'grip');
    } else {
      this.startGrab(event.inputSource, controller);
    }
  };

  private readonly handleSqueezeEnd = (event: XRInputSourceEvent): void => {
    this.endCubeHold(event.inputSource);
    this.endGrab(event.inputSource);
  };

  private readonly handleInputSourcesChange = (event: XRInputSourceChangeEvent): void => {
    event.removed.forEach((source) => {
      this.pendingRayPicks.delete(source);
      this.endCubeHold(source);
      this.endGrab(source);
    });
  };

  /**
   * If another input source is already pressed on the field (a pending ray
   * pick, a cube on the ray, or a field grab), turn both into a field grab.
   * A cube held right in the other hand stays held.
   */
  private convertToTwoHandGrab(source: XRInputSource, controller: WebXRInputSource): boolean {
    const other = [
      ...this.pendingRayPicks.keys(),
      ...[...this.cubeHolds.entries()].filter(([, hold]) => hold.via === 'ray').map(([key]) => key),
      ...this.grabs.keys(),
    ].find((candidate) => candidate !== source);
    if (!other) return false;
    const otherController = this.controllerFor(other);
    if (!otherController) return false;
    this.pendingRayPicks.delete(other);
    this.endCubeHold(other);
    if (!this.grabs.has(other)) this.startGrab(other, otherController);
    this.startGrab(source, controller);
    return true;
  }

  /** Menu "Feld größer / kleiner": scales about the field's centre. */
  private scaleField(factor: number): void {
    const anchor = this.anchor;
    const bounds = this.bounds;
    if (!anchor || !bounds) return;
    const pivot = Vector3.TransformCoordinates(bounds.center, anchor.computeWorldMatrix(true));
    const current = anchor.scaling.x;
    const next = Math.min(this.baseScale * AR_MAX_SCALE_FACTOR, Math.max(this.baseScale * AR_MIN_SCALE_FACTOR, current * factor));
    const ratio = next / current;
    anchor.scaling.setAll(next);
    anchor.position.copyFrom(pivot.add(anchor.position.subtract(pivot).scale(ratio)));
    this.grabSnapshot = null;
  }

  // --- holding cubes ----------------------------------------------------------

  private handOf(controller: WebXRInputSource): WebXRHand | null {
    const tracking = this.xr?.baseExperience.featuresManager.getEnabledFeature(WebXRFeatureName.HAND_TRACKING);
    return tracking?.getHandByControllerId(controller.uniqueId) ?? null;
  }

  private jointPosition(hand: WebXRHand, joint: WebXRHandJoint): Vector3 | null {
    const mesh = hand.getJointMesh(joint);
    return mesh ? mesh.getAbsolutePosition() : null;
  }

  /** Where a hand pinches (between thumb and index tip) or where a controller is held. */
  private grabPoint(controller: WebXRInputSource): Vector3 {
    const hand = this.handOf(controller);
    if (hand) {
      const thumb = this.jointPosition(hand, WebXRHandJoint.THUMB_TIP);
      const index = this.jointPosition(hand, WebXRHandJoint.INDEX_FINGER_TIP);
      if (thumb && index) return thumb.add(index).scale(0.5);
    }
    return (controller.grip ?? controller.pointer).getAbsolutePosition().clone();
  }

  private holderNode(hold: Pick<CubeHold, 'controller' | 'via'>): AbstractMesh {
    return hold.via === 'ray' ? hold.controller.pointer : (hold.controller.grip ?? hold.controller.pointer);
  }

  private startCubeHold(source: XRInputSource, controller: WebXRInputSource, mesh: AbstractMesh, via: CubeHold['via']): void {
    if (this.cubeHolds.has(source) || [...this.cubeHolds.values()].some((hold) => hold.mesh === mesh)) return;
    const holder = this.holderNode({ controller, via });
    const offset = mesh.computeWorldMatrix(true).multiply(holder.computeWorldMatrix(true).clone().invert());
    this.hooks.grabCube(mesh);
    this.cubeHolds.set(source, { mesh, controller, via, offset, samples: [] });
  }

  private endCubeHold(source: XRInputSource): void {
    const hold = this.cubeHolds.get(source);
    if (!hold) return;
    this.cubeHolds.delete(source);
    this.hooks.releaseCube(hold.mesh, this.throwVelocity(hold));
  }

  /** A press held on a cube long enough turns into carrying it on the ray. */
  private promoteRayPicks(): void {
    const now = performance.now();
    this.pendingRayPicks.forEach((pick, source) => {
      if (now - pick.startedAt < RAY_HOLD_MS) return;
      this.pendingRayPicks.delete(source);
      const controller = this.controllerFor(source);
      if (controller) this.startCubeHold(source, controller, pick.mesh, 'ray');
    });
  }

  private updateCubeHolds(): void {
    const now = performance.now();
    this.cubeHolds.forEach((hold) => {
      const world = hold.offset.multiply(this.holderNode(hold).computeWorldMatrix(true));
      this.hooks.holdCube(hold.mesh, world);
      hold.samples.push({ position: world.getTranslation(), time: now });
      while (hold.samples.length > 2 && now - hold.samples[0].time > THROW_SAMPLE_MS) hold.samples.shift();
    });
  }

  private throwVelocity(hold: CubeHold): Vector3 {
    const first = hold.samples[0];
    const last = hold.samples[hold.samples.length - 1];
    if (!first || !last || last.time - first.time < 1) return Vector3.Zero();
    return last.position.subtract(first.position).scale(1000 / (last.time - first.time));
  }

  /** Touching a cube with an index fingertip selects it (once per touch). */
  private updateFingerTouch(): void {
    const tracking = this.xr?.baseExperience.featuresManager.getEnabledFeature(WebXRFeatureName.HAND_TRACKING);
    if (!tracking) return;
    (['left', 'right'] as XRHandedness[]).forEach((handedness) => {
      const hand = tracking.getHandByHandedness(handedness);
      const tip = hand ? this.jointPosition(hand, WebXRHandJoint.INDEX_FINGER_TIP) : null;
      const thumb = hand ? this.jointPosition(hand, WebXRHandJoint.THUMB_TIP) : null;
      const busy =
        !tip ||
        (thumb !== null && Vector3.Distance(tip, thumb) < PINCH_DISTANCE_M) ||
        [...this.cubeHolds.values()].some((hold) => this.handOf(hold.controller) === hand) ||
        Boolean(this.menu?.isNearPanel(tip));
      const touched = busy || !tip ? null : this.hooks.findCubeNear(tip, 0);
      const previous = this.touchedCubes.get(handedness) ?? null;
      if (touched && touched !== previous) this.hooks.onSelect(touched);
      this.touchedCubes.set(handedness, touched);
    });
  }

  // --- manipulation ----------------------------------------------------------

  private startGrab(source: XRInputSource, controller: WebXRInputSource): void {
    if (this.grabs.size >= 2 && !this.grabs.has(source)) return;
    this.grabs.set(source, controller);
    this.grabSnapshot = null;
  }

  private endGrab(source: XRInputSource): void {
    if (this.grabs.delete(source)) this.grabSnapshot = null;
  }

  private handPositions(): Vector3[] {
    return [...this.grabs.values()].map((controller) => (controller.grip ?? controller.pointer).getAbsolutePosition().clone());
  }

  private takeSnapshot(hands: Vector3[]): GrabSnapshot {
    const anchor = this.anchor!;
    const [first, second] = hands;
    const delta = second ? second.subtract(first) : Vector3.Zero();
    return {
      handCount: hands.length,
      anchorPosition: anchor.position.clone(),
      scale: anchor.scaling.x,
      yaw: this.yaw,
      first: first.clone(),
      midpoint: second ? first.add(second).scale(0.5) : first.clone(),
      distance: Math.max(delta.length(), 1e-3),
      angle: Math.atan2(delta.x, delta.z),
    };
  }

  /** One hand drags the field; two hands also scale it and turn it about the vertical axis. */
  private updateGrab(): void {
    const anchor = this.anchor;
    if (!anchor) return;
    const hands = this.handPositions();
    if (!this.grabSnapshot || this.grabSnapshot.handCount !== hands.length) {
      this.grabSnapshot = this.takeSnapshot(hands);
      return;
    }
    const snapshot = this.grabSnapshot;

    if (hands.length === 1) {
      anchor.position.copyFrom(snapshot.anchorPosition.add(hands[0].subtract(snapshot.first)));
      return;
    }

    const [first, second] = hands;
    const delta = second.subtract(first);
    const midpoint = first.add(second).scale(0.5);
    const scale = Math.min(
      this.baseScale * AR_MAX_SCALE_FACTOR,
      Math.max(this.baseScale * AR_MIN_SCALE_FACTOR, snapshot.scale * (delta.length() / snapshot.distance)),
    );
    const turn = Math.atan2(delta.x, delta.z) - snapshot.angle;
    const turnRotation = Quaternion.RotationYawPitchRoll(turn, 0, 0);
    // Keep the point between the hands fixed on the field while it scales and turns.
    const offset = snapshot.anchorPosition
      .subtract(snapshot.midpoint)
      .applyRotationQuaternion(turnRotation)
      .scale(scale / snapshot.scale);

    this.yaw = snapshot.yaw + turn;
    anchor.scaling.setAll(scale);
    anchor.rotationQuaternion = Quaternion.RotationYawPitchRoll(this.yaw, 0, 0);
    anchor.position.copyFrom(midpoint.add(offset));
  }

  /** Field extents in anchor space at scale 1 (the anchor is still the identity here). */
  private measureField(): FieldBounds {
    this.anchor!.computeWorldMatrix(true);
    const { min, max } = this.fieldRoot.getHierarchyBoundingVectors(true);
    return { min: min.clone(), max: max.clone(), center: min.add(max).scale(0.5) };
  }

  /** Starting placement: table-top size, slightly below eye level, in front of the viewer. */
  private placeInFrontOfViewer(): void {
    const xr = this.xr;
    const anchor = this.anchor;
    const bounds = this.bounds;
    if (!xr || !anchor || !bounds) return;
    const head = xr.baseExperience.camera;

    const forward = head.getDirection(Vector3.Forward());
    forward.y = 0;
    if (forward.lengthSquared() < 1e-6) forward.set(0, 0, 1);
    forward.normalize();

    this.yaw = Math.atan2(forward.x, forward.z);
    const rotation = Quaternion.RotationYawPitchRoll(this.yaw, 0, 0);
    const scale = this.baseScale;
    const target = head.position.add(forward.scale(AR_WALL_DISTANCE_M));
    const surfaceY = head.position.y - AR_BELOW_EYE_M;

    const rotatedCenter = bounds.center.scale(scale).applyRotationQuaternion(rotation);
    anchor.scaling.setAll(scale);
    anchor.rotationQuaternion = rotation;
    anchor.position.set(target.x - rotatedCenter.x, surfaceY - bounds.max.y * scale, target.z - rotatedCenter.z);
    this.updateInfoPanelPosition();
  }

  // --- info panel --------------------------------------------------------------

  /** Keeps the panel above the far edge of the field, at its world size. */
  private updateInfoPanelPosition(): void {
    const panel = this.infoPanel;
    const anchor = this.anchor;
    const bounds = this.bounds;
    if (!panel || !anchor || !bounds) return;
    const farEdge = Vector3.TransformCoordinates(
      new Vector3(bounds.center.x, bounds.max.y, bounds.max.z),
      anchor.computeWorldMatrix(true),
    );
    panel.position.set(farEdge.x, farEdge.y + INFO_PANEL_HEIGHT_M / 2 + INFO_PANEL_GAP_M, farEdge.z);
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
