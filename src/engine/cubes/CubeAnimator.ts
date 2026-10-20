import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scalar } from '@babylonjs/core/Maths/math.scalar';
import type { CubeWallConfig } from '../../config/AppConfig';
import type { CubeCell } from '../CubeField';
import type { TileGroups } from '../tiles/TileGroups';
import { easeOutCubic, isSelectableCell } from './cellUtils';

/**
 * Per-frame motion of the cubes without physics: from the layout position
 * (basePosition) plus selection lift, wave rotation and hover ripple, smoothed
 * towards the mesh pose.
 */
export class CubeAnimator {
  private readonly config: CubeWallConfig;
  private readonly stackOffsetScratch = new Vector3();

  constructor(config: CubeWallConfig) {
    this.config = config;
  }

  /**
   * `normalDirection`: sign of the field's up axis (selection lifts along it).
   * `groups`: caption tiles ride rigidly on their image tile (offset in its
   * frame, so they turn with it); a leader comes before its caption in `cells`.
   */
  public animate(
    cells: readonly CubeCell[],
    deltaTime: number,
    sceneTime: number,
    normalDirection: number,
    groups: TileGroups,
  ): void {
    const rotationWaveEnabled = this.config.waveRotationEnabled;
    // Frame-rate independent smoothing; a plain `speed * dt` overshoots on long frames.
    const interactionBlend = 1 - Math.exp(-this.config.interactionLerpSpeed * deltaTime);

    cells.forEach((cube, index) => {
      // A cube held in an AR hand is posed by holdCube; it glides back once released.
      if (cube.isBeingDragged) return;
      if (!isSelectableCell(cube)) {
        const leaderIndex = groups.leaderOf(index);
        const leader = leaderIndex >= 0 ? cells[leaderIndex] : undefined;
        if (leader) {
          const offset = groups.followerOffsetToRef({ leader: leaderIndex, follower: index }, this.stackOffsetScratch);
          groups.placeToRef(leader.currentPosition, leader.currentRotation, offset, cube.currentPosition);
          cube.targetPosition.copyFrom(cube.currentPosition);
          cube.currentRotation.copyFrom(leader.currentRotation);
          cube.targetRotation.copyFrom(leader.currentRotation);
          cube.mesh.position.copyFrom(cube.currentPosition);
          cube.mesh.rotation.copyFrom(cube.currentRotation);
          return;
        }
        cube.currentPosition.copyFrom(cube.basePosition);
        cube.targetPosition.copyFrom(cube.basePosition);
        cube.currentRotation.copyFrom(cube.baseRotation);
        cube.mesh.position.copyFrom(cube.basePosition);
        cube.mesh.rotation.copyFrom(cube.currentRotation);
        return;
      }
      cube.individualXRotAccumulator = rotationWaveEnabled
        ? cube.individualXRotAccumulator + this.config.individualXRotSpeed * deltaTime
        : 0;

      if (cube.isSelected) {
        cube.selectionProgress = Math.min(1, cube.selectionProgress + deltaTime * 3);
      } else {
        cube.selectionProgress = Math.max(0, cube.selectionProgress - deltaTime * 3);
      }

      const selectionEased = easeOutCubic(cube.selectionProgress);
      let selectedYRotation = 0;
      if (cube.isSelected) {
        if (this.config.selectionSpinEnabled) {
          cube.physicsSpinAngle += this.config.selectedCubeRotation * deltaTime;
          selectedYRotation = cube.physicsSpinAngle;
        } else if (rotationWaveEnabled) {
          selectedYRotation = this.config.selectedCubeRotation * selectionEased;
        }
      } else if (rotationWaveEnabled) {
        selectedYRotation = this.config.selectedCubeRotation * selectionEased;
      }
      const selectionOffset = new Vector3(
        0,
        normalDirection * this.config.selectedCubeLift * selectionEased,
        0,
      );

      const waveRotX = rotationWaveEnabled
        ? this.config.waveAmplitudeRot *
          Math.sin(cube.basePosition.z * this.config.waveFrequencyRot + sceneTime * 1.2 + cube.wavePhase)
        : 0;
      const waveRotZ = rotationWaveEnabled
        ? this.config.waveAmplitudeRot *
          Math.cos(cube.basePosition.x * this.config.waveFrequencyRot + sceneTime * 1.1 + cube.wavePhase * 0.6)
        : 0;

      const intendedPosition = cube.basePosition.clone().add(selectionOffset);

      const intendedRotation = cube.baseRotation.clone();
      intendedRotation.x += cube.individualXRotAccumulator + waveRotX;
      intendedRotation.y += selectedYRotation;
      intendedRotation.z += waveRotZ;

      if (cube.interactionActive) {
        cube.interactionTime += deltaTime;
        
        // Phase 0: Lift up (0-0.3s)
        if (cube.interactionPhase === 0 && cube.interactionTime > 0.3) {
          cube.interactionPhase = 1;
          cube.interactionTime = 0;
        }
        // Phase 1: Hold (0-0.2s)
        else if (cube.interactionPhase === 1 && cube.interactionTime > 0.2) {
          cube.interactionPhase = 2;
          cube.interactionTime = 0;
          // Set target back to intended position for smooth return
          cube.targetPosition = intendedPosition.clone();
          cube.targetRotation = intendedRotation.clone();
        }
        // Phase 2: Return (0-0.5s)
        else if (cube.interactionPhase === 2 && cube.interactionTime > 0.5) {
          cube.interactionActive = false;
          cube.interactionPhase = 0;
          cube.interactionTime = 0;
        }
      }

      const targetPosition = cube.interactionActive ? cube.targetPosition : intendedPosition;
      const targetRotation = cube.interactionActive ? cube.targetRotation : intendedRotation;

      cube.currentPosition = Vector3.Lerp(cube.currentPosition, targetPosition, interactionBlend);
      cube.currentRotation.x = Scalar.Lerp(cube.currentRotation.x, targetRotation.x, interactionBlend);
      cube.currentRotation.y = Scalar.Lerp(cube.currentRotation.y, targetRotation.y, interactionBlend);
      cube.currentRotation.z = Scalar.Lerp(cube.currentRotation.z, targetRotation.z, interactionBlend);

      cube.mesh.position.copyFrom(cube.currentPosition);
      cube.mesh.rotation.copyFrom(cube.currentRotation);
    });
  }

  /** Hover ripple: the centre cube and its neighbours (by grid distance) bob and tilt briefly. */
  public triggerRipple(cells: readonly CubeCell[], center: CubeCell): void {
    if (!isSelectableCell(center)) {
      return;
    }
    const radius = this.config.interactionRadius;

    if (center.isSelected) {
      center.interactionActive = false;
      center.interactionPhase = 0;
      center.interactionTime = 0;
    } else {
      center.interactionActive = true;
      center.interactionPhase = 1;
      center.interactionTime = 0;
      center.targetPosition = center.currentPosition.clone();
      center.targetRotation = center.currentRotation.clone();
    }

    cells.forEach((cube) => {
      if (cube === center || cube.isSelected || !isSelectableCell(cube)) return;
      const distX = cube.gridX - center.gridX;
      const distZ = cube.gridZ - center.gridZ;
      const distance = Math.sqrt(distX * distX + distZ * distZ);
      if (distance > radius) return;

      const falloff = Math.pow(1 - distance / radius, 2);
      cube.interactionActive = true;
      cube.interactionPhase = 0;
      cube.interactionTime = 0;

      const randomRotate = (Math.random() - 0.5) * this.config.interactionRotateAmount;
      cube.targetRotation = cube.currentRotation.clone();
      cube.targetRotation.x += randomRotate * falloff;
      cube.targetRotation.z -= randomRotate * falloff;
      cube.targetPosition = cube.currentPosition.clone();
      cube.targetPosition.y += this.config.interactionLift * falloff;
    });
  }
}
