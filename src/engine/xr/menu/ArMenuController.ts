import type { Scene } from '@babylonjs/core/scene';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience';
import { WebXRFeatureName } from '@babylonjs/core/XR/webXRFeaturesManager';
import { WebXRHandJoint, type WebXRHand } from '@babylonjs/core/XR/features/WebXRHandTracking';
import type { WebXRInputSource } from '@babylonjs/core/XR/webXRInputSource';
import type { WebXRControllerComponent } from '@babylonjs/core/XR/motionController/webXRControllerComponent';
import { AR_MENU_WORLD_SIZE_M, type ArMenuAction, type ArMenuState } from './ArMenuModel';
import { ArMenuPanel } from './ArMenuPanel';

// Palm-up gate (values from the CloudV2 hand menu, post #5509).
const PALM_UP_OPEN_Y = 0.55;
const PALM_UP_OPEN_FACING = 0.15;
const PALM_UP_CLOSE_Y = 0.2;
const PALM_UP_CLOSE_FACING = -0.1;
const PALM_UP_HOLD_MS = 180;
const PALM_HEAD_MIN_M = 0.15;
const PALM_HEAD_MAX_M = 1.1;
/** Panel centre above the palm: half the panel plus a gap. */
const PANEL_ABOVE_PALM_M = AR_MENU_WORLD_SIZE_M / 2 + 0.045;

// Controller dock: in front of the head, following with lag.
const DOCK_DISTANCE_M = 0.45;
const DOCK_BELOW_EYE_M = 0.1;
const DOCK_FOLLOW_RATE = 4.5;

// Poke with the other hand's index finger tip.
const POKE_ARM_DEPTH_M = 0.03;
const POKE_TRIGGER_DEPTH_M = 0.008;
const POKE_MAX_BEHIND_M = 0.04;
const POKE_FREEZE_MARGIN_M = 0.03;
/** A native `select` this soon after a poke is the same gesture; ignore it. */
const SELECT_AFTER_POKE_MS = 800;

export interface ArMenuHooks {
  getState(): ArMenuState;
  onAction(action: ArMenuAction): void;
}

/**
 * AR menu placement and input.
 *
 * Hand tracking: the panel appears above the left palm when the palm faces up
 * and towards the face (with hysteresis), turned towards the head about the
 * vertical axis only. It is operated by poking with the right index finger or
 * by ray + pinch. Controllers: X or Y on the left controller toggles the panel
 * on a dock that follows the head; it is operated by ray + trigger.
 */
export class ArMenuController {
  private readonly panel: ArMenuPanel;
  private readonly frameObserver: Observer<XRFrame>;
  private readonly controllerObservers: Array<() => void> = [];
  private palmCandidateSince: number | null = null;
  private palmOpen = false;
  private dockOpen = false;
  private dockInitialized = false;
  private pokeArmed = false;
  private lastPokeAt = 0;
  private lastFrameAt = performance.now();
  private readonly ray = new Ray(Vector3.Zero(), Vector3.Forward(), 10);

  private readonly xr: WebXRDefaultExperience;
  private readonly hooks: ArMenuHooks;

  constructor(scene: Scene, xr: WebXRDefaultExperience, hooks: ArMenuHooks) {
    this.xr = xr;
    this.hooks = hooks;
    this.panel = new ArMenuPanel(scene, 'Würfelwand');
    this.panel.setState(hooks.getState());
    this.frameObserver = xr.baseExperience.sessionManager.onXRFrameObservable.add(() => this.onFrame());
    xr.input.controllers.forEach((controller) => this.watchController(controller));
    const added = xr.input.onControllerAddedObservable.add((controller) => this.watchController(controller));
    this.controllerObservers.push(() => xr.input.onControllerAddedObservable.remove(added));
  }

  /** Re-reads toggle states (after an action or an external change). */
  refresh(): void {
    this.panel.setState(this.hooks.getState());
  }

  /**
   * Called on the native `selectstart`: true if this input source points at the
   * menu, so the session must not treat the gesture as a grab or cube pick.
   */
  capturesSelect(controller: WebXRInputSource): boolean {
    return this.pointerHit(controller) !== null;
  }

  /** Native `select` (pinch / trigger) while pointing at the menu presses the item. */
  handleSelect(controller: WebXRInputSource): boolean {
    const hit = this.pointerHit(controller);
    if (!hit) return false;
    if (performance.now() - this.lastPokeAt < SELECT_AFTER_POKE_MS) return true;
    if (hit.item) this.press(hit.item.action);
    return true;
  }

  /** True while the panel is shown and the point is within reach of it (finger poking the menu). */
  isNearPanel(point: Vector3): boolean {
    return this.panel.visible && Vector3.Distance(point, this.panel.mesh.getAbsolutePosition()) < AR_MENU_WORLD_SIZE_M;
  }

  dispose(): void {
    this.xr.baseExperience.sessionManager.onXRFrameObservable.remove(this.frameObserver);
    this.controllerObservers.forEach((remove) => remove());
    this.panel.dispose();
  }

  private press(action: ArMenuAction): void {
    this.panel.flashPressed(action);
    this.hooks.onAction(action);
    this.refresh();
  }

  private pointerHit(controller: WebXRInputSource) {
    if (!this.panel.visible) return null;
    controller.getWorldPointerRayToRef(this.ray);
    return this.panel.hitTest(this.ray);
  }

  private watchController(controller: WebXRInputSource): void {
    controller.onMotionControllerInitObservable.addOnce((motionController) => {
      if (motionController.handedness !== 'left') return;
      ['x-button', 'y-button'].forEach((id) => {
        const component: WebXRControllerComponent | null = motionController.getComponent(id) ?? null;
        if (!component) return;
        const observer = component.onButtonStateChangedObservable.add(() => {
          if (component.changes.pressed?.current) {
            this.dockOpen = !this.dockOpen;
            this.dockInitialized = false;
          }
        });
        this.controllerObservers.push(() => component.onButtonStateChangedObservable.remove(observer));
      });
    });
  }

  private onFrame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;
    const head = this.xr.baseExperience.camera;
    const leftHand = this.hand('left');

    if (leftHand && this.updatePalmGate(leftHand, head.position, now)) {
      this.placeAbovePalm(leftHand, head.position);
      this.panel.setVisible(true);
      this.updatePoke(now);
    } else if (this.dockOpen) {
      this.placeOnDock(head.position, head.getDirection(Vector3.Forward()), dt);
      this.panel.setVisible(true);
    } else {
      this.panel.setVisible(false);
    }

    this.updateHover();
    this.panel.tick();
  }

  private hand(handedness: XRHandedness): WebXRHand | null {
    const tracking = this.xr.baseExperience.featuresManager.getEnabledFeature(WebXRFeatureName.HAND_TRACKING);
    return tracking?.getHandByHandedness(handedness) ?? null;
  }

  private joint(hand: WebXRHand, joint: WebXRHandJoint): Vector3 | null {
    const mesh = hand.getJointMesh(joint);
    return mesh ? mesh.getAbsolutePosition() : null;
  }

  /** Palm-up and towards the face, held for a moment; closes with hysteresis. */
  private updatePalmGate(hand: WebXRHand, headPosition: Vector3, now: number): boolean {
    const wrist = this.joint(hand, WebXRHandJoint.WRIST);
    const index = this.joint(hand, WebXRHandJoint.INDEX_FINGER_METACARPAL);
    const pinky = this.joint(hand, WebXRHandJoint.PINKY_FINGER_METACARPAL);
    if (!wrist || !index || !pinky) {
      this.palmOpen = false;
      this.palmCandidateSince = null;
      return false;
    }
    // Left hand in Babylon's left-handed space: (index − wrist) × (pinky − wrist) points out of the palm.
    const normal = Vector3.Cross(index.subtract(wrist), pinky.subtract(wrist)).normalize();
    const center = wrist.add(index).add(pinky).scale(1 / 3);
    const toHead = headPosition.subtract(center);
    const distance = toHead.length();
    const facing = Vector3.Dot(normal, toHead.normalize());
    const inReach = distance >= PALM_HEAD_MIN_M && distance <= PALM_HEAD_MAX_M;

    if (this.palmOpen) {
      if (!inReach || normal.y < PALM_UP_CLOSE_Y || facing < PALM_UP_CLOSE_FACING) {
        this.palmOpen = false;
        this.palmCandidateSince = null;
      }
      return this.palmOpen;
    }
    if (inReach && normal.y >= PALM_UP_OPEN_Y && facing >= PALM_UP_OPEN_FACING) {
      this.palmCandidateSince ??= now;
      if (now - this.palmCandidateSince >= PALM_UP_HOLD_MS) this.palmOpen = true;
    } else {
      this.palmCandidateSince = null;
    }
    return this.palmOpen;
  }

  private placeAbovePalm(hand: WebXRHand, headPosition: Vector3): void {
    const wrist = this.joint(hand, WebXRHandJoint.WRIST)!;
    const index = this.joint(hand, WebXRHandJoint.INDEX_FINGER_METACARPAL)!;
    const pinky = this.joint(hand, WebXRHandJoint.PINKY_FINGER_METACARPAL)!;
    const target = wrist.add(index).add(pinky).scale(1 / 3);
    target.y += PANEL_ABOVE_PALM_M;
    // Hold still while the other index finger is in front of the panel, so a poke lands.
    if (this.fingerNearPanel() && Vector3.Distance(target, this.panel.mesh.position) < 0.18) return;
    this.setPanelPose(target, headPosition);
  }

  private placeOnDock(headPosition: Vector3, viewDirection: Vector3, dt: number): void {
    const forward = new Vector3(viewDirection.x, 0, viewDirection.z);
    if (forward.lengthSquared() < 1e-6) forward.set(0, 0, 1);
    forward.normalize();
    const ideal = headPosition.add(forward.scale(DOCK_DISTANCE_M));
    ideal.y -= DOCK_BELOW_EYE_M;
    const position = this.dockInitialized
      ? Vector3.Lerp(this.panel.mesh.position, ideal, 1 - Math.exp(-DOCK_FOLLOW_RATE * dt))
      : ideal;
    this.dockInitialized = true;
    this.setPanelPose(position, headPosition);
  }

  /** Upright panel facing the head, turned about the vertical axis only (readable, calm). */
  private setPanelPose(position: Vector3, headPosition: Vector3): void {
    const mesh = this.panel.mesh;
    mesh.position.copyFrom(position);
    const away = position.subtract(headPosition);
    // A plane's visible side faces −Z, so +Z points away from the viewer.
    mesh.rotationQuaternion = Quaternion.RotationYawPitchRoll(Math.atan2(away.x, away.z), 0, 0);
    mesh.computeWorldMatrix(true);
  }

  private fingerTip(): Vector3 | null {
    const right = this.hand('right');
    return right ? this.joint(right, WebXRHandJoint.INDEX_FINGER_TIP) : null;
  }

  /** Signed distance of a point in front of the panel (positive: viewer side). */
  private depthInFront(point: Vector3): number {
    const mesh = this.panel.mesh;
    const toViewer = mesh.getDirection(Vector3.Forward()).scale(-1);
    return Vector3.Dot(point.subtract(mesh.getAbsolutePosition()), toViewer);
  }

  private fingerNearPanel(): boolean {
    const tip = this.fingerTip();
    if (!tip || !this.panel.visible) return false;
    const depth = this.depthInFront(tip);
    const local = tip.subtract(this.panel.mesh.getAbsolutePosition());
    const half = AR_MENU_WORLD_SIZE_M / 2 + POKE_FREEZE_MARGIN_M;
    return depth > -0.06 && depth < 0.09 && Math.abs(local.y) < half && Math.hypot(local.x, local.z) < half;
  }

  /** One entry from the front through the panel surface is one click. */
  private updatePoke(now: number): void {
    const tip = this.fingerTip();
    if (!tip) {
      this.pokeArmed = false;
      return;
    }
    const depth = this.depthInFront(tip);
    if (depth > POKE_ARM_DEPTH_M) {
      this.pokeArmed = true;
      return;
    }
    if (depth < -POKE_MAX_BEHIND_M) {
      this.pokeArmed = false;
      return;
    }
    if (this.pokeArmed && depth <= POKE_TRIGGER_DEPTH_M) {
      this.pokeArmed = false;
      const item = this.panel.itemAtWorldPoint(tip);
      if (item) {
        this.lastPokeAt = now;
        this.press(item.action);
      }
    }
  }

  private updateHover(): void {
    if (!this.panel.visible) return;
    let hovered: ArMenuAction | null = null;
    for (const controller of this.xr.input.controllers) {
      const hit = this.pointerHit(controller);
      if (hit?.item) {
        hovered = hit.item.action;
        break;
      }
    }
    const tip = this.fingerTip();
    if (!hovered && tip && this.fingerNearPanel()) hovered = this.panel.itemAtWorldPoint(tip)?.action ?? null;
    this.panel.setHovered(hovered);
  }
}
