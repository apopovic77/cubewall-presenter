import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { CubeWallConfig } from '../../config/AppConfig';
import type { CubeCell } from '../CubeField';

/** Shape and base orientation of a cell's mesh. */
export class CellGeometry {
  private readonly config: CubeWallConfig;
  private readonly orientationScratch = Vector3.Zero();
  private readonly orientationQuatScratchA = Quaternion.Identity();
  private readonly orientationQuatScratchB = Quaternion.Identity();

  constructor(config: CubeWallConfig) {
    this.config = config;
  }

  /**
   * Orientation for every cell; for tiles also width / height (from the image
   * aspect or the text block) / thickness as mesh scaling of the unit cube.
   */
  public apply(cell: CubeCell, aspectOverride: number | null = null): void {
    const descriptor = cell.tileDescriptor;
    if (!descriptor) {
      cell.mesh.scaling.set(1, 1, 1);
      const orientation = this.orientation();
      cell.baseRotation.copyFrom(orientation);
      cell.currentRotation.copyFrom(orientation);
      cell.targetRotation.copyFrom(orientation);
      cell.mesh.rotation.copyFrom(orientation);
      return;
    }

    const baseSize = this.config.cubeSize;
    // Image tiles are as wide as a cube; captions have their own (settings) width.
    const desiredWidth =
      this.config.geometryMode === 'tile' && descriptor.kind !== 'glassText' ? baseSize : descriptor.footprint.width;
    let desiredHeight = descriptor.footprint.height || baseSize;
    const desiredDepth = descriptor.footprint.depth || this.config.tileDepth;

    if (descriptor.kind === 'image') {
      const aspect = aspectOverride ?? cell.textureAspectRatio ?? null;
      if (aspect && aspect > 0) {
        desiredHeight = desiredWidth / aspect;
        descriptor.footprint.height = desiredHeight;
        cell.footprint.height = desiredHeight;
      } else {
        desiredHeight = baseSize;
      }
    } else if (descriptor.kind === 'glassText') {
      desiredHeight = Math.max(0.05 * baseSize, descriptor.footprint.height ?? baseSize * 0.25);
      descriptor.footprint.height = desiredHeight;
    }

    const widthScale = desiredWidth / baseSize;
    const heightScale = Math.max(0.05, desiredHeight / baseSize);
    const depthScale = Math.max(0.01, desiredDepth / baseSize);

    cell.mesh.scaling.set(widthScale, heightScale, depthScale);
    const orientation = this.orientation();
    cell.baseRotation.copyFrom(orientation);
    cell.currentRotation.copyFrom(orientation);
    cell.targetRotation.copyFrom(orientation);
    cell.mesh.rotation.copyFrom(orientation);
  }

  /** Base Euler rotation of all cells ('frontUp' stands the faces up). */
  public orientation(): Vector3 {
    const orientation = this.orientationScratch;
    const mode = this.config.baseOrientation;
    if (mode === 'frontUp') {
      const pitch = this.orientationQuatScratchA;
      const yaw = this.orientationQuatScratchB;
      Quaternion.RotationAxisToRef(Vector3.Right(), Math.PI / 2, pitch);
      Quaternion.RotationAxisToRef(Vector3.Up(), Math.PI, yaw);
      pitch.multiplyInPlace(yaw);
      pitch.toEulerAnglesToRef(orientation);
    } else {
      orientation.set(0, 0, 0);
    }
    return orientation;
  }
}
