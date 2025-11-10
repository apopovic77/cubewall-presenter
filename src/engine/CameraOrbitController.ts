import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { CameraFollowMode, CameraOrbitMode, CubeWallConfig } from '../config/AppConfig';
import type { PresenterSettings } from '../config/PresenterSettings';

interface CameraPose {
  position: Vector3;
  target: Vector3;
}

interface FocusTarget {
  anchor: Vector3;
  lookAt: Vector3;
  mode: CameraFollowMode;
}

interface FocusOptions {
  mode?: CameraOrbitMode;
  animate?: boolean;
  followMode?: CameraFollowMode;
}

const DEFAULT_DIRECTION = new Vector3(0, 0.35, -0.65);
const MIN_DISTANCE_SQ = 0.0001;

export class CameraOrbitController {
  private readonly camera: ArcRotateCamera;
  private readonly config: CubeWallConfig;

  private lerpSpeed = 0.07;
  private animationSpeedFactor = 1;
  private flyToRadiusFactor = 4;
  private useCustomView = false;
  private customOffset = new Vector3();
  private customLookAtOffset = new Vector3();

  private orbitMode: CameraOrbitMode = 'flyTo';
  private relativeOffset = new Vector3();
  private relativeLookAtOffset = new Vector3();
  private autoOrbitEnabled = false;
  private autoOrbitSpeed = 0.25;
  private followMode: CameraFollowMode = 'focusOnce';

  private targetPose: CameraPose | null = null;
  private currentFocus: FocusTarget | null = null;
  private manualOverride = false;
  private isAnimating = false;

  constructor(camera: ArcRotateCamera, config: CubeWallConfig) {
    this.camera = camera;
    this.config = config;
    this.relativeOffset.copyFromFloats(
      config.camera.relativeOffset.x,
      config.camera.relativeOffset.y,
      config.camera.relativeOffset.z,
    );
    this.relativeLookAtOffset.copyFromFloats(
      config.camera.relativeLookAtOffset.x,
      config.camera.relativeLookAtOffset.y,
      config.camera.relativeLookAtOffset.z,
    );
    this.autoOrbitEnabled = config.camera.autoOrbitEnabled;
    this.autoOrbitSpeed = config.camera.autoOrbitSpeed;
    this.customOffset.copyFromFloats(
      config.camera.offset.x,
      config.camera.offset.y,
      config.camera.offset.z,
    );
    this.customLookAtOffset.copyFromFloats(
      config.camera.lookAtOffset.x,
      config.camera.lookAtOffset.y,
      config.camera.lookAtOffset.z,
    );
    this.useCustomView = config.camera.useCustomView;
    this.lerpSpeed = config.camera.lerpSpeedFactor;
    this.flyToRadiusFactor = config.camera.flyToRadiusFactor;
    this.animationSpeedFactor = config.camera.animationSpeedFactor;
    this.orbitMode = config.camera.orbitMode;
    this.followMode = config.camera.followMode;
  }

  public applySettings(settings: PresenterSettings): void {
    this.lerpSpeed = settings.cameraLerpSpeed;
    this.animationSpeedFactor = settings.cameraAnimationSpeed;
    this.flyToRadiusFactor = settings.flyToRadiusFactor;
    this.useCustomView = settings.useCustomCamera;
    this.customOffset.copyFromFloats(
      settings.cameraOffsetX,
      settings.cameraOffsetY,
      settings.cameraOffsetZ,
    );
    this.customLookAtOffset.copyFromFloats(
      settings.cameraLookAtOffsetX,
      settings.cameraLookAtOffsetY,
      settings.cameraLookAtOffsetZ,
    );
    this.orbitMode = settings.cameraOrbitMode;
    this.followMode = settings.cameraFollowMode;
    this.relativeOffset.copyFromFloats(
      settings.cameraRelativeOffsetX,
      settings.cameraRelativeOffsetY,
      settings.cameraRelativeOffsetZ,
    );
    this.relativeLookAtOffset.copyFromFloats(
      settings.cameraRelativeLookAtOffsetX,
      settings.cameraRelativeLookAtOffsetY,
      settings.cameraRelativeLookAtOffsetZ,
    );
    this.autoOrbitEnabled = settings.cameraAutoOrbitEnabled;
    this.autoOrbitSpeed = settings.cameraAutoOrbitSpeed;
  }

  public focusOnTarget(target: Vector3, options: FocusOptions = {}): void {
    const mode = options.mode ?? this.orbitMode;
    const pose = this.computePoseForTarget(target, mode);
    const followMode = options.followMode ?? this.followMode;
    this.currentFocus = {
      anchor: target.clone(),
      lookAt: pose.target.clone(),
      mode: followMode,
    };
    this.targetPose = pose;
    if (options.animate === false) {
      this.applyPoseImmediately(pose);
      this.isAnimating = false;
    } else if (!this.manualOverride) {
      this.isAnimating = true;
    }
  }

  public focusOnOverview(animate = true): void {
    const lookAt = new Vector3(0, Math.max(1, this.config.gridSize / 10), 0);
    const direction = this.camera.position.subtract(this.camera.target);
    if (direction.lengthSquared() < MIN_DISTANCE_SQ) {
      direction.copyFrom(DEFAULT_DIRECTION);
    }
    direction.normalize();
    const radius = this.config.camera.radius;
    const position = lookAt.add(direction.scale(radius));
    const pose: CameraPose = { position, target: lookAt };
    this.currentFocus = null;
    this.targetPose = pose;
    if (!animate || this.manualOverride) {
      this.applyPoseImmediately(pose);
      this.isAnimating = false;
    } else {
      this.isAnimating = true;
    }
  }

  public setManualOverride(active: boolean): void {
    if (this.manualOverride === active) return;
    this.manualOverride = active;
    if (active) {
      this.isAnimating = false;
      this.targetPose = null;
    } else {
      if (this.currentFocus) {
        this.currentFocus.lookAt = this.camera.target.clone();
      } else {
        this.captureCurrentCameraState();
      }
    }
  }

  public isManualOverrideActive(): boolean {
    return this.manualOverride;
  }

  public captureCurrentCameraState(): void {
    const currentTarget = this.camera.target.clone();
    this.currentFocus = {
      anchor: currentTarget.clone(),
      lookAt: currentTarget.clone(),
      mode: this.followMode,
    };
    this.targetPose = null;
    this.isAnimating = false;
  }

  public captureRelativeOffset(anchor: Vector3): { offset: Vector3; lookAtOffset: Vector3 } {
    return {
      offset: this.camera.position.subtract(anchor).clone(),
      lookAtOffset: this.camera.target.subtract(anchor).clone(),
    };
  }

  public interruptAnimation(): void {
    this.isAnimating = false;
    this.targetPose = null;
  }

  public updateContinuousTarget(anchor: Vector3): void {
    if (!this.currentFocus || this.currentFocus.mode !== 'continuous') {
      return;
    }
    this.currentFocus.anchor.copyFrom(anchor);
    if (this.manualOverride) {
      return;
    }
    const pose = this.computePoseForTarget(anchor, this.orbitMode);
    if (!this.targetPose) {
      this.applyPoseImmediately(pose);
      this.targetPose = pose;
      this.isAnimating = false;
      return;
    }
    this.currentFocus.lookAt = pose.target.clone();
    this.targetPose = pose;
    this.isAnimating = true;
  }

  public update(deltaTime: number): void {
    if (this.manualOverride) {
      return;
    }

    if (this.isAnimating && this.targetPose) {
      const lerpFactor = this.computeLerpFactor(deltaTime);
      const nextTarget = Vector3.Lerp(this.camera.target, this.targetPose.target, lerpFactor);
      const nextPosition = Vector3.Lerp(this.camera.position, this.targetPose.position, lerpFactor);
      this.camera.position.copyFrom(nextPosition);
      this.camera.setTarget(nextTarget);
      this.syncRadiusWithPosition();
      const targetDelta = Vector3.DistanceSquared(nextPosition, this.targetPose.position);
      const lookDelta = Vector3.DistanceSquared(nextTarget, this.targetPose.target);
      if (targetDelta < 1e-4 && lookDelta < 1e-4) {
        this.applyPoseImmediately(this.targetPose);
        this.isAnimating = false;
        this.targetPose = null;
      }
    } else if (this.autoOrbitEnabled && this.currentFocus) {
      this.applyAutoOrbit(deltaTime);
    }
  }

  public getFollowMode(): CameraFollowMode {
    return this.followMode;
  }

  private computePoseForTarget(target: Vector3, mode: CameraOrbitMode): CameraPose {
    if (mode === 'relativeOffset') {
      return {
        position: target.clone().addInPlace(this.relativeOffset),
        target: target.clone().addInPlace(this.relativeLookAtOffset),
      };
    }

    if (this.useCustomView) {
      return {
        position: target.clone().addInPlace(this.customOffset),
        target: target.clone().addInPlace(this.customLookAtOffset),
      };
    }

    const direction = this.camera.position.subtract(this.camera.target);
    if (direction.lengthSquared() < MIN_DISTANCE_SQ) {
      direction.copyFrom(DEFAULT_DIRECTION);
    }
    direction.normalize();
    const zoomRadius = this.config.cubeSize * this.flyToRadiusFactor;
    return {
      position: target.add(direction.scale(zoomRadius)),
      target: target.clone(),
    };
  }

  private applyPoseImmediately(pose: CameraPose): void {
    this.camera.position.copyFrom(pose.position);
    this.camera.setTarget(pose.target);
    this.syncRadiusWithPosition();
  }

  private applyAutoOrbit(deltaTime: number): void {
    if (!this.currentFocus) return;
    const pivot = this.currentFocus.lookAt.clone();
    const offset = this.camera.position.subtract(pivot);
    if (offset.lengthSquared() < MIN_DISTANCE_SQ) {
      return;
    }
    const rotation = Matrix.RotationY(this.autoOrbitSpeed * deltaTime);
    const rotated = Vector3.TransformCoordinates(offset, rotation);
    this.camera.position.copyFrom(pivot.add(rotated));
    this.camera.setTarget(pivot);
    this.syncRadiusWithPosition();
  }

  private computeLerpFactor(deltaTime: number): number {
    const frameScale = Math.max(1, deltaTime * 60);
    const factor = this.lerpSpeed * this.animationSpeedFactor * frameScale;
    return Math.min(1, Math.max(0, factor));
  }

  private syncRadiusWithPosition(): void {
    const radius = this.camera.position.subtract(this.camera.target).length();
    if (Number.isFinite(radius)) {
      this.camera.radius = radius;
    }
  }
}

