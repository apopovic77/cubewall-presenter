import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PhysicsBody } from '@babylonjs/core/Physics/v2/physicsBody';
import { PhysicsShape, PhysicsShapeBox, PhysicsShapeContainer } from '@babylonjs/core/Physics/v2/physicsShape';
import type { PhysicsEngine } from '@babylonjs/core/Physics/v2/physicsEngine';
// Registers scene.enablePhysics / getPhysicsEngine / onAfterPhysicsObservable.
import '@babylonjs/core/Physics/joinedPhysicsEngineComponent';
import { PhysicsMotionType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin.js';
import HavokPhysics from '@babylonjs/havok';
import type { CubeWallConfig } from '../../config/AppConfig';

/**
 * A second mesh rigidly attached to a cube (the caption tile under an image
 * tile): it becomes a second box of the cube's body and is posed from it.
 */
export interface PhysicsCompanion {
  mesh: Mesh;
  /** Its layout position (root space), for the ground and the layout lift. */
  basePosition: Vector3;
  /** Its centre in the cube's local frame (root units, unscaled). */
  offset: Vector3;
}

/** The cube data the physics needs; CubeField's cells satisfy it. */
export interface PhysicsCube {
  mesh: Mesh;
  isSelected: boolean;
  isBeingDragged?: boolean;
  basePosition: Vector3;
  baseRotation: Vector3;
  companion?: PhysicsCompanion | null;
}

export type FieldPhysicsMode = 'classic' | 'anchor';

const GRAVITY = -9.81;
/** Fixed simulation step (Babylon accumulates frame time into steps of this size). */
const STEP_SECONDS = 1 / 60;
/** Ground slab: top face at the ground height. */
const GROUND_HALF_EXTENT = 200;
/** Thick enough that fast cubes do not tunnel through it in one step. */
const GROUND_THICKNESS = 6;
/** Bodies that fall this far below the ground are put back above the field. */
const KILL_DEPTH = 30;
/** Response rate (1/s) of animated targets (selection lift, drag) and of the anchor steering. */
const TARGET_FOLLOW_RATE = 10;
const ANCHOR_SPRING = 6;
/** Field units per second; morph targets can be far away (sphere, helix), so this is generous. */
const ANCHOR_MAX_SPEED = 40;
const ANCHOR_SPIN_GAIN = 4;
/** Classic mode: the morph attraction ends once this share of cubes has settled ... */
const SETTLED_SHARE = 0.95;
/** ... i.e. is within this many cube sizes of its place ... */
const SETTLED_DISTANCE_FACTOR = 0.25;
/** ... and slower than this (field units / s; the wave keeps targets gently moving); */
const SETTLED_SPEED = 1;
/** at the latest this long after the cross-fade ended (jammed cubes must not hover forever). */
const SETTLE_TIMEOUT_MS = 20_000;
/** Lowest cube centre of a lifted shape: half a cube plus a little air above the ground. */
const LIFT_CLEARANCE_FACTOR = 0.6;
/** Share of the steering velocity a cube keeps when a morph releases it in classic mode. */
const RELEASE_DAMPING = 0.15;

let havokModule: Promise<unknown> | null = null;

/** The Havok WASM module is loaded once per page; each enable gets a fresh plugin and world. */
function loadHavok(): Promise<unknown> {
  havokModule ??= HavokPhysics({
    locateFile: (path: string) => (path.endsWith('.wasm') ? '/havok/HavokPhysics.wasm' : path),
  });
  return havokModule;
}

interface CubeBody {
  node: TransformNode;
  body: PhysicsBody;
  /** The body's shape and, for a cube with a companion, the container's two boxes. */
  shapes: PhysicsShape[];
  motion: PhysicsMotionType;
  /** Smoothed target of an animated body (selection lift / drag), field space. */
  target: Vector3 | null;
  /** Rotation of a cube held in a hand (field space); null for screen drags. */
  heldRotation: Quaternion | null;
  liftOrigin: Vector3 | null;
}

/**
 * Rigid-body simulation of the cube field in "field space" — the space the
 * field root lives in (its parent's space). On the desktop that is world space;
 * in AR it is the local space of the scaled, movable AR anchor. Physics never
 * sees the anchor, so moving or scaling the field in AR does not disturb the
 * simulation, and gravity and sizes keep their desktop proportions.
 *
 * Each cube gets its own unparented body node; after every step the cube's
 * mesh pose (relative to the root) is derived from it.
 */
export class FieldPhysics {
  private readonly scene: Scene;
  private readonly root: TransformNode;
  private readonly config: CubeWallConfig;
  private engine: PhysicsEngine | null = null;
  private stepObserver: Observer<Scene> | null = null;
  private bodies = new Map<PhysicsCube, CubeBody>();
  private groundNode: TransformNode | null = null;
  private groundBody: PhysicsBody | null = null;
  private groundShape: PhysicsShapeBox | null = null;
  private groundY = 0;
  private enableGeneration = 0;
  private currentMode: FieldPhysicsMode | null = null;
  /** Bodies are currently steered into the layout (gravity off). */
  private steering = false;
  /** Classic mode: a morph's attraction is still on (until settled or timeout). */
  private pullUntilSettled = false;
  private pullSettleDeadline = Number.POSITIVE_INFINITY;
  private lastSettledShare = 0;
  /** Upward offset of the layout attractor so shapes reaching below the ground stand on it. */
  private layoutLift = 0;
  // Scratch values (no per-frame allocations in the hot loops).
  private readonly rootMatrix = new Matrix();
  private readonly rootInverse = new Matrix();
  private readonly bodyMatrix = new Matrix();
  private readonly localMatrix = new Matrix();
  private readonly tmpScale = new Vector3();
  private readonly tmpPosition = new Vector3();
  private readonly tmpQuat = new Quaternion();
  private readonly tmpVector = new Vector3();

  constructor(scene: Scene, root: TransformNode, config: CubeWallConfig) {
    this.scene = scene;
    this.root = root;
    this.config = config;
  }

  get active(): boolean {
    return this.currentMode !== null;
  }

  get mode(): FieldPhysicsMode | null {
    return this.currentMode;
  }

  /**
   * Starts the simulation; resolves false if it was switched off again while
   * Havok loaded. `cubes` is read once Havok is ready, so sizes that changed
   * during the load (images learning their aspect) are current.
   */
  async enable(cubes: () => PhysicsCube[], mode: FieldPhysicsMode): Promise<boolean> {
    const generation = ++this.enableGeneration;
    const havok = await loadHavok();
    if (generation !== this.enableGeneration) return false;
    if (!this.engine) {
      this.scene.enablePhysics(new Vector3(0, GRAVITY, 0), new HavokPlugin(true, havok));
      this.engine = this.scene.getPhysicsEngine() as PhysicsEngine;
      this.engine.setTimeStep(STEP_SECONDS);
      // The scene steps the engine before rendering; cube meshes follow right after.
      this.stepObserver = this.scene.onAfterPhysicsObservable.add(() => this.syncMeshes());
    }
    this.currentMode = mode;
    this.steering = mode === 'anchor';
    this.attach(cubes());
    return true;
  }

  setMode(mode: FieldPhysicsMode): void {
    if (!this.currentMode) return;
    this.currentMode = mode;
    this.steering = mode === 'anchor';
    this.bodies.forEach((entry) => this.applyGravity(entry));
  }

  /** Anchor mode floats the cubes into the layout (no sag); classic mode lets them fall. */
  private applyGravity(entry: CubeBody): void {
    entry.body.setGravityFactor(this.steering ? 0 : 1);
  }

  /** Stops the simulation; cubes keep their current pose. */
  disable(): void {
    this.enableGeneration += 1;
    this.currentMode = null;
    this.pullUntilSettled = false;
    this.steering = false;
    this.disposeBodies();
    this.disposeGround();
    if (this.stepObserver) this.scene.onAfterPhysicsObservable.remove(this.stepObserver);
    this.stepObserver = null;
    if (this.engine) this.scene.disablePhysicsEngine();
    this.engine = null;
  }

  /** (Re)creates bodies for this cube set at the cubes' current poses (rebuild, new content). */
  attach(cubes: PhysicsCube[]): void {
    if (!this.engine || !this.currentMode) return;
    this.disposeBodies();
    this.updateRootMatrices();
    let minY = Number.POSITIVE_INFINITY;
    cubes.forEach((cube) => {
      if (!cube.mesh.isEnabled()) return;
      const created = this.createBody(cube);
      minY = Math.min(minY, created.node.position.y);
      if (cube.companion) {
        minY = Math.min(minY, Vector3.TransformCoordinatesToRef(cube.companion.mesh.position, this.rootMatrix, this.tmpVector).y);
      }
      this.applyGravity(created);
      this.bodies.set(cube, created);
    });
    const half = this.config.cubeSize / 2;
    this.groundY = Math.min(this.config.physicsGroundHeight, Number.isFinite(minY) ? minY - half * 2 : 0);
    this.createGround();
  }

  /**
   * The cube's size changed (an image tile learnt its aspect ratio): its body
   * is rebuilt at its current pose, keeping its motion.
   */
  refreshBody(cube: PhysicsCube): void {
    const entry = this.bodies.get(cube);
    if (!entry || !this.engine) return;
    this.updateRootMatrices();
    const linear = entry.body.getLinearVelocity();
    const angular = entry.body.getAngularVelocity();
    const motion = entry.motion;
    const { target, heldRotation, liftOrigin } = entry;
    this.disposeEntry(entry);
    const created = this.createBody(cube);
    Object.assign(created, { target, heldRotation, liftOrigin });
    this.applyGravity(created);
    this.bodies.set(cube, created);
    if (motion !== PhysicsMotionType.DYNAMIC) {
      this.setMotion(created, motion);
    } else {
      created.body.setLinearVelocity(linear);
      created.body.setAngularVelocity(angular);
    }
  }

  /** Ground height in world space (for screen-ray drag planes). */
  groundWorldY(): number {
    this.updateRootMatrices();
    const parent = this.root.parent as TransformNode | null;
    if (!parent) return this.groundY;
    return Vector3.TransformCoordinates(new Vector3(0, this.groundY, 0), parent.getWorldMatrix()).y;
  }

  /**
   * Per-frame steering before the step: lifts the selected cube, pulls cubes
   * into the layout (anchor mode, also while it morphs), follows drags.
   * Layout poses come from each cube's basePosition and baseRotation (root space).
   */
  drive(deltaTime: number, morphing: boolean, liftHeight: number): void {
    if (!this.engine || !this.currentMode) return;
    this.updateRootMatrices();
    const follow = 1 - Math.exp(-TARGET_FOLLOW_RATE * deltaTime);
    // The layout position is an attractor; cubes collide on their way to it.
    // Anchor mode keeps attracting forever. In classic mode a morph switches the
    // attraction on, and it stays on until the field has settled (most cubes at
    // their place and nearly at rest) — not just until the layouter's cross-fade
    // ends — then gravity takes over again.
    if (morphing) {
      this.pullUntilSettled = true;
      this.pullSettleDeadline = Number.POSITIVE_INFINITY;
    } else if (this.pullUntilSettled) {
      if (this.pullSettleDeadline === Number.POSITIVE_INFINITY) {
        this.pullSettleDeadline = performance.now() + SETTLE_TIMEOUT_MS;
      }
      if (this.lastSettledShare >= SETTLED_SHARE || performance.now() > this.pullSettleDeadline) {
        this.pullUntilSettled = false;
      }
    }
    const steerToLayout = this.currentMode === 'anchor' || this.pullUntilSettled;
    if (steerToLayout) this.updateLayoutLift(follow);
    let settled = 0;
    let steered = 0;
    if (steerToLayout !== this.steering) {
      this.steering = steerToLayout;
      this.bodies.forEach((entry) => {
        this.applyGravity(entry);
        // Released from steering: drop from (nearly) rest instead of flying on at steering speed.
        if (!steerToLayout && entry.motion === PhysicsMotionType.DYNAMIC) {
          entry.body.setLinearVelocity(entry.body.getLinearVelocity().scaleInPlace(RELEASE_DAMPING));
          entry.body.setAngularVelocity(entry.body.getAngularVelocity().scaleInPlace(RELEASE_DAMPING));
        }
      });
    }

    this.bodies.forEach((entry, cube) => {
      if (cube.isBeingDragged) {
        if (entry.heldRotation && entry.target) {
          // Held in a hand: exactly the hand pose; the animated body shoves the others aside.
          entry.body.setTargetTransform(entry.target, entry.heldRotation);
        } else {
          this.followTarget(entry, follow);
        }
        return;
      }
      if (cube.isSelected) {
        if (!entry.liftOrigin) {
          entry.liftOrigin = entry.node.position.clone();
          entry.target = entry.node.position.clone();
          this.setMotion(entry, PhysicsMotionType.ANIMATED);
        }
        const goal = this.tmpVector.copyFrom(entry.liftOrigin);
        goal.y += liftHeight;
        entry.target!.addInPlace(goal.subtract(entry.target!).scaleInPlace(follow));
        this.followTarget(entry, 1, true);
        return;
      }
      if (entry.liftOrigin) {
        entry.liftOrigin = null;
        entry.target = null;
        this.setMotion(entry, PhysicsMotionType.DYNAMIC);
      }
      if (steerToLayout) {
        steered += 1;
        if (this.steerToLayout(cube, entry)) settled += 1;
      }
    });
    this.lastSettledShare = steered > 0 ? settled / steered : 0;
  }

  beginDrag(cube: PhysicsCube): void {
    const entry = this.bodies.get(cube);
    if (!entry) return;
    cube.isBeingDragged = true;
    entry.liftOrigin = null;
    entry.heldRotation = null;
    entry.target = entry.node.position.clone();
    this.setMotion(entry, PhysicsMotionType.ANIMATED);
  }

  /** Drag target as a world point; it rides on the ground, half a cube above it. */
  dragTo(cube: PhysicsCube, worldPoint: Vector3): void {
    const entry = this.bodies.get(cube);
    if (!entry || !entry.target) return;
    const parent = this.root.parent as TransformNode | null;
    const fieldPoint = parent
      ? Vector3.TransformCoordinates(worldPoint, this.worldToField())
      : worldPoint.clone();
    fieldPoint.y = this.groundY + this.config.cubeSize * 0.5 + this.config.cubeSize * 0.6;
    entry.target.copyFrom(fieldPoint);
  }

  /** Hand-held cube: target pose as a world matrix (AR hand or ray), converted to field space. */
  holdTo(cube: PhysicsCube, world: Matrix): void {
    const entry = this.bodies.get(cube);
    if (!entry || !entry.target) return;
    world.multiplyToRef(this.worldToField(), this.bodyMatrix);
    entry.heldRotation ??= new Quaternion();
    this.bodyMatrix.decompose(this.tmpScale, entry.heldRotation, entry.target);
  }

  /** Releases a dragged or held cube; `worldVelocity` (m/s) throws it. */
  endDrag(cube: PhysicsCube, worldVelocity?: Vector3): void {
    const entry = this.bodies.get(cube);
    cube.isBeingDragged = false;
    if (!entry) return;
    entry.target = null;
    entry.heldRotation = null;
    this.setMotion(entry, PhysicsMotionType.DYNAMIC);
    if (worldVelocity) {
      entry.body.setLinearVelocity(Vector3.TransformNormal(worldVelocity, this.worldToField()));
    }
  }

  /** World → field space (inverse of the root's parent, e.g. the AR anchor incl. its scale). */
  private worldToField(): Matrix {
    const parent = this.root.parent as TransformNode | null;
    return parent ? parent.getWorldMatrix().clone().invert() : Matrix.Identity();
  }

  dispose(): void {
    this.disable();
  }

  private createBody(cube: PhysicsCube): CubeBody {
    const mesh = cube.mesh;
    const meshQuat = mesh.rotationQuaternion ?? Quaternion.FromEulerVector(mesh.rotation);
    Matrix.ComposeToRef(Vector3.OneReadOnly, meshQuat, mesh.position, this.localMatrix);
    this.localMatrix.multiplyToRef(this.rootMatrix, this.bodyMatrix);
    const node = new TransformNode(`physicsBody_${mesh.name}`, this.scene);
    node.rotationQuaternion = new Quaternion();
    this.bodyMatrix.decompose(this.tmpScale, node.rotationQuaternion, node.position);

    const box = this.createBox(mesh);
    const shapes: PhysicsShape[] = [box];
    let shape: PhysicsShape = box;
    if (cube.companion) {
      // One body, two boxes: the pair falls, tips and is thrown as one piece.
      const companionBox = this.createBox(cube.companion.mesh);
      const container = new PhysicsShapeContainer(this.scene);
      container.addChild(box);
      container.addChild(companionBox, cube.companion.offset.scale(Math.abs(this.root.scaling.x)));
      shapes.push(companionBox, container);
      shape = container;
    }
    const body = new PhysicsBody(node, PhysicsMotionType.DYNAMIC, false, this.scene);
    body.shape = shape;
    // Mass 1 per piece; the centre of mass follows the shapes.
    body.setMassProperties({ mass: cube.companion ? 2 : 1 });
    return { node, body, shapes, motion: PhysicsMotionType.DYNAMIC, target: null, heldRotation: null, liftOrigin: null };
  }

  /** Box of a (scaled) unit-cube mesh; root scaling (field global scale) folds into the size, bodies stay unscaled. */
  private createBox(mesh: Mesh): PhysicsShapeBox {
    const rootScale = this.root.scaling;
    const extents = new Vector3(
      this.config.cubeSize * Math.abs(mesh.scaling.x * rootScale.x),
      this.config.cubeSize * Math.abs(mesh.scaling.y * rootScale.y),
      this.config.cubeSize * Math.abs(mesh.scaling.z * rootScale.z),
    );
    const box = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), extents, this.scene);
    box.material = { friction: 0.6, restitution: 0.2 };
    return box;
  }

  private createGround(): void {
    this.disposeGround();
    this.groundNode = new TransformNode('physicsGround', this.scene);
    this.groundNode.position.set(0, this.groundY - GROUND_THICKNESS / 2, 0);
    this.groundShape = new PhysicsShapeBox(
      Vector3.Zero(),
      Quaternion.Identity(),
      new Vector3(GROUND_HALF_EXTENT * 2, GROUND_THICKNESS, GROUND_HALF_EXTENT * 2),
      this.scene,
    );
    this.groundShape.material = { friction: 0.6, restitution: 0.2 };
    this.groundBody = new PhysicsBody(this.groundNode, PhysicsMotionType.STATIC, false, this.scene);
    this.groundBody.shape = this.groundShape;
  }

  private disposeGround(): void {
    this.groundBody?.dispose();
    this.groundShape?.dispose();
    this.groundNode?.dispose();
    this.groundBody = null;
    this.groundShape = null;
    this.groundNode = null;
  }

  private disposeBodies(): void {
    this.bodies.forEach((entry, cube) => {
      this.disposeEntry(entry);
      cube.isBeingDragged = false;
    });
    this.bodies.clear();
  }

  private disposeEntry(entry: CubeBody): void {
    entry.body.dispose();
    entry.shapes.forEach((shape) => shape.dispose());
    entry.node.dispose();
  }

  private setMotion(entry: CubeBody, motion: PhysicsMotionType): void {
    if (entry.motion === motion) return;
    entry.body.setMotionType(motion);
    entry.body.setLinearVelocity(Vector3.ZeroReadOnly);
    entry.body.setAngularVelocity(Vector3.ZeroReadOnly);
    entry.motion = motion;
  }

  /** Animated bodies move to their (smoothed) target; upright while lifted or dragged. */
  private followTarget(entry: CubeBody, follow: number, alreadySmoothed = false): void {
    if (!entry.target) return;
    const position = alreadySmoothed
      ? entry.target
      : Vector3.Lerp(entry.node.position, entry.target, follow);
    const rotation = entry.node.rotationQuaternion ?? Quaternion.Identity();
    const upright = Quaternion.RotationYawPitchRoll(rotation.toEulerAngles().y, 0, 0);
    entry.body.setTargetTransform(position, Quaternion.Slerp(rotation, upright, 0.2));
  }

  /** Anchor mode: velocity spring towards the cube's layout pose, so cubes flow into the new form and still collide. */
  /**
   * Shapes centred on the field (sphere, helix, spiral) reach far below the
   * ground the flat grid rests on; without a lift their lower half is pressed
   * flat onto it. The attractor is raised (smoothly) until the lowest target
   * stands on the ground.
   */
  private updateLayoutLift(follow: number): void {
    let lowest = Number.POSITIVE_INFINITY;
    this.bodies.forEach((_entry, cube) => {
      const y = Vector3.TransformCoordinatesToRef(cube.basePosition, this.rootMatrix, this.tmpVector).y;
      if (y < lowest) lowest = y;
      if (cube.companion) {
        const companionY = Vector3.TransformCoordinatesToRef(cube.companion.basePosition, this.rootMatrix, this.tmpVector).y;
        if (companionY < lowest) lowest = companionY;
      }
    });
    if (!Number.isFinite(lowest)) return;
    const restOnGround = this.groundY + this.config.cubeSize * LIFT_CLEARANCE_FACTOR;
    const desired = Math.max(0, restOnGround - lowest);
    this.layoutLift += (desired - this.layoutLift) * follow;
  }

  /** Returns true when the cube is at its place and nearly at rest. */
  private steerToLayout(cube: PhysicsCube, entry: CubeBody): boolean {
    const target = Vector3.TransformCoordinatesToRef(cube.basePosition, this.rootMatrix, this.tmpPosition);
    target.y += this.layoutLift;
    const offset = target.subtract(entry.node.position);
    const atPlace =
      offset.length() < this.config.cubeSize * SETTLED_DISTANCE_FACTOR &&
      entry.body.getLinearVelocity().length() < SETTLED_SPEED;
    const velocity = offset.scaleInPlace(ANCHOR_SPRING);
    const speed = velocity.length();
    if (speed > ANCHOR_MAX_SPEED) velocity.scaleInPlace(ANCHOR_MAX_SPEED / speed);
    entry.body.setLinearVelocity(velocity);

    const rootRotation = this.root.rotationQuaternion ?? Quaternion.Identity();
    const targetRotation = rootRotation.multiply(Quaternion.FromEulerVector(cube.baseRotation));
    const current = entry.node.rotationQuaternion ?? Quaternion.Identity();
    const delta = targetRotation.multiply(Quaternion.Inverse(current));
    if (delta.w < 0) delta.scaleInPlace(-1);
    const sinHalf = Math.sqrt(1 - Math.min(1, delta.w * delta.w));
    const angle = 2 * Math.acos(Math.min(1, delta.w));
    const spin = sinHalf > 1e-4
      ? new Vector3(delta.x / sinHalf, delta.y / sinHalf, delta.z / sinHalf).scaleInPlace(angle * ANCHOR_SPIN_GAIN)
      : Vector3.Zero();
    entry.body.setAngularVelocity(spin);
    return atPlace;
  }

  private syncMeshes(): void {
    this.updateRootMatrices();
    const killY = this.groundY - KILL_DEPTH;
    this.bodies.forEach((entry, cube) => {
      if (entry.node.position.y < killY) this.respawn(cube, entry);
      const rotation = entry.node.rotationQuaternion ?? Quaternion.Identity();
      Matrix.ComposeToRef(Vector3.OneReadOnly, rotation, entry.node.position, this.bodyMatrix);
      this.bodyMatrix.multiplyToRef(this.rootInverse, this.localMatrix);
      const mesh = cube.mesh;
      mesh.rotationQuaternion ??= new Quaternion();
      this.localMatrix.decompose(this.tmpScale, this.tmpQuat, this.tmpPosition);
      mesh.position.copyFrom(this.tmpPosition);
      mesh.rotationQuaternion.copyFrom(this.tmpQuat);
      const companion = cube.companion;
      if (companion) {
        const companionMesh = companion.mesh;
        companionMesh.rotationQuaternion ??= new Quaternion();
        companionMesh.rotationQuaternion.copyFrom(this.tmpQuat);
        companion.offset.rotateByQuaternionToRef(this.tmpQuat, companionMesh.position);
        companionMesh.position.addInPlace(this.tmpPosition);
      }
    });
  }

  private respawn(cube: PhysicsCube, entry: CubeBody): void {
    const target = Vector3.TransformCoordinates(cube.basePosition, this.rootMatrix);
    target.y += this.layoutLift;
    target.y = Math.max(target.y, this.groundY + this.config.cubeSize * 4);
    entry.body.disablePreStep = false;
    entry.node.position.copyFrom(target);
    entry.body.setLinearVelocity(Vector3.ZeroReadOnly);
    entry.body.setAngularVelocity(Vector3.ZeroReadOnly);
    this.scene.onAfterRenderObservable.addOnce(() => {
      entry.body.disablePreStep = true;
    });
  }

  /** Root pose relative to its parent (= field space) and its inverse, without scale. */
  private updateRootMatrices(): void {
    const rotation = this.root.rotationQuaternion ?? Quaternion.FromEulerVector(this.root.rotation);
    Matrix.ComposeToRef(this.root.scaling, rotation, this.root.position, this.rootMatrix);
    this.rootMatrix.invertToRef(this.rootInverse);
  }
}
