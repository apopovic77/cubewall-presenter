import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { FloatArray } from '@babylonjs/core/types';
import type { CubeWallConfig } from '../../config/AppConfig';
import type { CubeCell, CubeContentOptions } from '../CubeField';
import type { CubeInstanceRenderer } from '../instancing/CubeInstanceRenderer';
import type { TileMaterialManager } from '../tiles/TileMaterialManager';
import type { FallbackImageSource } from './FallbackImageSource';
import { buildTileFaceUVs, computeFaceUVs } from './CubeFaceUvs';

/** Pixel width requested from storage for cube face textures (atlas cells are ~160 px). */
const CUBE_TEXTURE_WIDTH_PX = 320;
/** Pixel width of the texture loaded for the selected cube, which is seen up close. */
const DETAIL_TEXTURE_WIDTH_PX = 1024;

/** What the loader needs from the field it serves. */
export interface CubeTextureHost {
  readonly contentOptions: Pick<CubeContentOptions, 'sidePattern' | 'mirrorTopBottom' | 'uvLayout'>;
  readonly selection: CubeCell | null;
  readonly cells: readonly CubeCell[];
  /** Cubes and image tiles go into the atlas; glass text tiles keep their own texture. */
  isInstanced(cell: CubeCell): boolean;
  applyGeometryToCell(cell: CubeCell, aspectOverride: number | null): void;
  /** Image tile: its height follows the image's aspect ratio (and the layout re-flows). */
  applyTileAspect(cell: CubeCell, aspect: number): void;
}

/**
 * Puts content images onto cubes: into the shared atlas for instanced cells,
 * as a material texture for the others and for the selected cube's
 * high-resolution detail texture; handles UV layout, aspect crop and
 * fallback images.
 */
export class CubeTextureLoader {
  private readonly scene: Scene;
  private readonly config: CubeWallConfig;
  private readonly instanceRenderer: CubeInstanceRenderer;
  private readonly tileMaterialManager: TileMaterialManager;
  private readonly fallback: FallbackImageSource;
  private readonly host: CubeTextureHost;
  private readonly outstandingAspectAdjustments = new Map<number, { cell: CubeCell; texture: Texture }>();

  constructor(options: {
    scene: Scene;
    config: CubeWallConfig;
    instanceRenderer: CubeInstanceRenderer;
    tileMaterialManager: TileMaterialManager;
    fallback: FallbackImageSource;
    host: CubeTextureHost;
  }) {
    this.scene = options.scene;
    this.config = options.config;
    this.instanceRenderer = options.instanceRenderer;
    this.tileMaterialManager = options.tileMaterialManager;
    this.fallback = options.fallback;
    this.host = options.host;
  }

  /** Drops aspect corrections still waiting for a texture (rebuild, physics toggle). */
  public cancelPendingAspectAdjustments(): void {
    this.outstandingAspectAdjustments.clear();
  }

  public loadTextureForCell(cell: CubeCell, url: string): void {
    url = this.normalizeTextureUrl(url);
    if (!url) {
      this.clearTextureForCell(cell);
      return;
    }

    if (cell.textureUrl === url && cell.textureLoaded) {
      return;
    }

    if (this.host.isInstanced(cell)) {
      this.loadAtlasImageForCell(cell, url);
      return;
    }

    cell.textureLoaded = false;
    cell.textureUrl = url;
    const material = cell.material;
    const texture = new Texture(
      url,
      this.scene,
      undefined,
      true,
      Texture.TRILINEAR_SAMPLINGMODE,
      () => {
        material.diffuseTexture = texture;
        // The per-cube tint is only for untextured cubes; multiplied with a
        // photo it casts it dark magenta/rose.
        material.diffuseColor = Color3.White();
        material.emissiveTexture = null;
        material.emissiveColor = Color3.Black();
        cell.textureLoaded = true;
        texture.wrapU = Texture.CLAMP_ADDRESSMODE;
        texture.wrapV = Texture.CLAMP_ADDRESSMODE;
        this.configureTextureForCell(cell, texture);
        cell.textureSidePattern = this.host.contentOptions.sidePattern;
        cell.textureMirrorTopBottom = this.host.contentOptions.mirrorTopBottom;
        const aspect = this.computeAspectRatio(texture);
        cell.textureAspectRatio = Number.isFinite(aspect) ? aspect : null;
        this.host.applyGeometryToCell(cell, cell.textureAspectRatio);
        if (cell.tileDescriptor) {
          this.tileMaterialManager.applyTileMaterials(cell, cell.tileDescriptor);
        } else {
          this.tileMaterialManager.restoreCubeMaterials(cell);
        }
        this.scheduleAspectAdjustment(cell, texture);
        this.fallback.reportLoaded();
        console.debug('[CubeField] texture loaded', {
          grid: { x: cell.gridX, z: cell.gridZ },
          url,
          size: texture.getSize(),
        });
      },
      () => {
        texture.dispose();
        cell.textureLoaded = false;
        console.warn('[CubeField] texture failed', {
          grid: { x: cell.gridX, z: cell.gridZ },
          url,
        });
        this.fallback.reportFailure(url);
        if (!this.fallback.enabled) {
          this.clearTextureForCell(cell);
          return;
        }
        const fallbackUrl = this.fallback.pickUrl(cell.gridX * this.config.gridSize + cell.gridZ);
        if (fallbackUrl && fallbackUrl !== url) {
          this.loadTextureForCell(cell, fallbackUrl);
        } else {
          this.clearTextureForCell(cell);
        }
      },
    );
  }

  /** Instanced cubes: the image goes into the shared atlas instead of a texture of its own. */
  private loadAtlasImageForCell(cell: CubeCell, url: string): void {
    cell.textureLoaded = false;
    cell.textureUrl = url;
    this.instanceRenderer.setImage(
      cell,
      url,
      (aspect) => {
        cell.textureLoaded = true;
        cell.textureAspectRatio = Number.isFinite(aspect) ? aspect : null;
        if (cell.tileDescriptor?.kind === 'image' && cell.textureAspectRatio) this.host.applyTileAspect(cell, cell.textureAspectRatio);
        if (cell === this.host.selection) this.loadDetailTexture(cell);
      },
      () => {
        console.warn('[CubeField] atlas image failed', { grid: { x: cell.gridX, z: cell.gridZ }, url });
        const fallbackUrl = this.fallback.enabled
          ? this.fallback.pickUrl(cell.gridX * this.config.gridSize + cell.gridZ)
          : '';
        if (fallbackUrl && this.normalizeTextureUrl(fallbackUrl) !== url) {
          this.loadTextureForCell(cell, fallbackUrl);
        } else {
          this.clearTextureForCell(cell);
        }
      },
    );
  }

  /**
   * The selected cube is drawn by its own mesh with a high-resolution texture
   * (atlas cells are small); it switches over once that texture has loaded.
   */
  public loadDetailTexture(cell: CubeCell): void {
    if (!cell.textureUrl) {
      this.instanceRenderer.setDetached(cell, true);
      return;
    }
    const detailUrl = this.withTextureWidth(cell.textureUrl, DETAIL_TEXTURE_WIDTH_PX);
    const material = cell.material;
    const texture = new Texture(detailUrl, this.scene, undefined, true, Texture.TRILINEAR_SAMPLINGMODE, () => {
      if (this.host.selection !== cell) {
        texture.dispose();
        return;
      }
      material.diffuseTexture?.dispose();
      material.diffuseTexture = texture;
      material.diffuseColor = Color3.White();
      this.configureTextureForCell(cell, texture);
      this.applyAspectCrop(cell, texture);
      this.instanceRenderer.setDetached(cell, true);
    }, () => {
      texture.dispose();
      if (this.host.selection === cell) this.instanceRenderer.setDetached(cell, true);
    });
  }

  public releaseDetailTexture(cell: CubeCell): void {
    this.instanceRenderer.setDetached(cell, false);
    const material = cell.material;
    material.diffuseTexture?.dispose();
    material.diffuseTexture = null;
    material.diffuseColor = cell.tintColor.scale(0.4);
  }

  public refreshTextureMappings(): void {
    this.host.cells.forEach((cell) => {
      const texture = cell.material.diffuseTexture;
      if (texture instanceof Texture && cell.textureLoaded) {
        if (texture.isReady()) {
          this.configureTextureForCell(cell, texture);
          this.host.applyGeometryToCell(cell, cell.textureAspectRatio);
          if (cell.tileDescriptor) {
            this.tileMaterialManager.applyTileMaterials(cell, cell.tileDescriptor);
          } else {
            this.tileMaterialManager.restoreCubeMaterials(cell);
          }
          this.scheduleAspectAdjustment(cell, texture);
        } else {
          texture.onLoadObservable.addOnce(() => {
            this.configureTextureForCell(cell, texture);
            this.host.applyGeometryToCell(cell, cell.textureAspectRatio);
            if (cell.tileDescriptor) {
              this.tileMaterialManager.applyTileMaterials(cell, cell.tileDescriptor);
            } else {
              this.tileMaterialManager.restoreCubeMaterials(cell);
            }
            this.scheduleAspectAdjustment(cell, texture);
          });
        }
      }
    });
  }

  private configureTextureForCell(cell: CubeCell, texture: Texture): void {
    if (!texture.isReady()) {
      return;
    }
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    const size = texture.getSize();
    const aspect = size.width > 0 && size.height > 0 ? size.width / size.height : 1;
    cell.textureAspectRatio = aspect;
    cell.textureSidePattern = this.host.contentOptions.sidePattern;
    cell.textureMirrorTopBottom = this.host.contentOptions.mirrorTopBottom;
    cell.textureUvLayout = this.host.contentOptions.uvLayout;
    const faceUVs =
      this.config.geometryMode === 'tile'
        ? buildTileFaceUVs()
        : computeFaceUVs(this.host.contentOptions.sidePattern, this.host.contentOptions.mirrorTopBottom);
    const vertexData = VertexData.CreateBox({
      size: this.config.cubeSize,
      sideOrientation: Mesh.FRONTSIDE,
      faceUV: faceUVs,
    });
    if (vertexData.uvs) {
      cell.mesh.updateVerticesData(VertexBuffer.UVKind, vertexData.uvs, false, true);
    }
  }

  private scheduleAspectAdjustment(cell: CubeCell, texture: Texture): void {
    const aspect = this.computeAspectRatio(texture);
    if (!Number.isFinite(aspect) || aspect <= 0) {
      this.outstandingAspectAdjustments.set(cell.mesh.uniqueId, { cell, texture });
      texture.onLoadObservable.addOnce(() => {
        const entry = this.outstandingAspectAdjustments.get(cell.mesh.uniqueId);
        if (!entry) return;
        this.outstandingAspectAdjustments.delete(cell.mesh.uniqueId);
        this.applyAspectCrop(entry.cell, entry.texture);
      });
      return;
    }

    cell.textureAspectRatio = aspect;
    if (cell.tileDescriptor?.kind === 'image') this.host.applyTileAspect(cell, aspect);
    this.applyAspectCrop(cell, texture);
  }

  private computeAspectRatio(texture: Texture): number {
    const internal = texture.getInternalTexture();
    const width = internal?.width ?? texture.getSize().width;
    const height = internal?.height ?? texture.getSize().height;
    if (!width || !height) {
      return Number.NaN;
    }
    return width / height;
  }

  private applyUniformSideUvLayout(cell: CubeCell, uvArray: FloatArray): void {
    if (cell.textureUvLayout !== 'uniformSides') {
      return;
    }
    const positions = cell.mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!positions || positions.length === 0) {
      return;
    }
    const faces = this.getFaceVertexIndexMap();
    const facesToNormalize = [faces.front, faces.right, faces.back, faces.left];
    const worldUp = Vector3.UpReadOnly;

    facesToNormalize.forEach((indices) => {
      const points = indices.map((vertexIndex) => {
        const base = vertexIndex * 3;
        return new Vector3(positions[base], positions[base + 1], positions[base + 2]);
      });

      const center = points.reduce((acc, point) => acc.addInPlace(point), Vector3.Zero()).scaleInPlace(1 / points.length);
      const edge1 = points[1].subtract(points[0]);
      const edge2 = points[3].subtract(points[0]);
      const normal = Vector3.Cross(edge1, edge2).normalize();
      let uAxis = Vector3.Cross(worldUp, normal);
      if (uAxis.lengthSquared() < 1e-6) {
        uAxis = Vector3.Cross(Vector3.Forward(), normal);
        if (uAxis.lengthSquared() < 1e-6) {
          uAxis = Vector3.Cross(Vector3.Right(), normal);
        }
      }
      uAxis.normalize();
      const vAxis = Vector3.Cross(normal, uAxis).normalize();

      let minU = Infinity;
      let maxU = -Infinity;
      let minV = Infinity;
      let maxV = -Infinity;
      const projections = points.map((point) => {
        const offset = point.subtract(center);
        const u = Vector3.Dot(offset, uAxis);
        const v = Vector3.Dot(offset, vAxis);
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
        return { u, v };
      });

      const rangeU = maxU - minU;
      const rangeV = maxV - minV;
      if (rangeU < 1e-6 || rangeV < 1e-6) {
        return;
      }

      projections.forEach(({ u, v }, idx) => {
        const uvIndex = indices[idx] * 2;
        uvArray[uvIndex] = (u - minU) / rangeU;
        uvArray[uvIndex + 1] = (v - minV) / rangeV;
      });
    });
  }

  private applyAspectCrop(cell: CubeCell, texture: Texture): void {
    if (this.config.geometryMode === 'tile') {
      return;
    }
    const aspect = cell.textureAspectRatio ?? this.computeAspectRatio(texture);
    if (!Number.isFinite(aspect) || aspect <= 0) {
      return;
    }

    const uvData = cell.mesh.getVerticesData(VertexBuffer.UVKind);
    if (!uvData) {
      return;
    }

    const faces = this.getFaceVertexIndexMap();
    this.applyUniformSideUvLayout(cell, uvData);

    const sidePattern = cell.textureSidePattern ?? this.host.contentOptions.sidePattern;
    const mirrorTopBottom = cell.textureMirrorTopBottom ?? this.host.contentOptions.mirrorTopBottom;
    const sideFlips = sidePattern === 'alternating'
      ? [false, true, false, true]
      : [false, false, false, false];

    this.adjustFaceUVs(uvData, faces.front, aspect, sideFlips[0], false);
    this.adjustFaceUVs(uvData, faces.back, aspect, sideFlips[2], false);
    this.adjustFaceUVs(uvData, faces.right, aspect, sideFlips[1], false);
    this.adjustFaceUVs(uvData, faces.left, aspect, sideFlips[3], false);
    this.adjustFaceUVs(uvData, faces.top, aspect, false, false);
    this.adjustFaceUVs(uvData, faces.bottom, aspect, false, mirrorTopBottom);

    cell.mesh.setVerticesData(VertexBuffer.UVKind, uvData, true);
  }

  private adjustFaceUVs(uvArray: FloatArray, vertexIndices: number[], aspect: number, mirrorHorizontal: boolean, mirrorVertical: boolean): void {
    const horizontalScale = aspect > 1 ? 1 / aspect : 1;
    const verticalScale = aspect < 1 ? aspect : 1;
    const horizontalOffset = (1 - horizontalScale) / 2;
    const verticalOffset = (1 - verticalScale) / 2;

    vertexIndices.forEach((vertex) => {
      const idx = vertex * 2;
      let u = uvArray[idx];
      let v = uvArray[idx + 1];

      if (mirrorHorizontal) {
        u = 1 - u;
      }
      if (mirrorVertical) {
        v = 1 - v;
      }

      u = horizontalOffset + u * horizontalScale;
      v = verticalOffset + v * verticalScale;

      if (mirrorHorizontal) {
        u = 1 - u;
      }
      if (mirrorVertical) {
        v = 1 - v;
      }

      uvArray[idx] = Math.max(0, Math.min(1, u));
      uvArray[idx + 1] = Math.max(0, Math.min(1, v));
    });
  }

  private getFaceVertexIndexMap(): {
    front: number[];
    right: number[];
    back: number[];
    left: number[];
    top: number[];
    bottom: number[];
  } {
    return {
      front: [0, 1, 2, 3],
      right: [4, 5, 6, 7],
      back: [8, 9, 10, 11],
      left: [12, 13, 14, 15],
      top: [16, 17, 18, 19],
      bottom: [20, 21, 22, 23],
    };
  }

  private withTextureWidth(url: string, width: number): string {
    try {
      const parsed = new URL(url);
      parsed.searchParams.set('width', String(width));
      return parsed.toString();
    } catch {
      return url;
    }
  }

  private normalizeTextureUrl(url: string | null | undefined): string {
    if (!url) {
      return '';
    }
    try {
      // A cube face is a few hundred pixels at most; 600 px images cost ~4x the
      // memory for 625 cubes, which a standalone headset cannot afford.
      const parsed = new URL(this.withTextureWidth(url, CUBE_TEXTURE_WIDTH_PX));
      if (!parsed.searchParams.has('quality')) {
        parsed.searchParams.set('quality', '85');
      }
      if (!parsed.searchParams.has('format')) {
        parsed.searchParams.set('format', 'jpg');
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }

  public clearTextureForCell(cell: CubeCell): void {
    if (this.host.isInstanced(cell)) this.instanceRenderer.clearImage(cell);
    const material = cell.material;
    if (material.diffuseTexture) {
      material.diffuseTexture.dispose();
      material.diffuseTexture = null;
    }
    if (material.emissiveTexture) {
      material.emissiveTexture.dispose();
      material.emissiveTexture = null;
    }
    material.emissiveColor = Color3.Black();
    material.diffuseColor = cell.tintColor.scale(0.4);
    cell.textureLoaded = false;
    cell.textureUrl = '';
    cell.textureAspectRatio = null;
    cell.textureSidePattern = this.host.contentOptions.sidePattern;
    cell.textureMirrorTopBottom = this.host.contentOptions.mirrorTopBottom;
    cell.textureUvLayout = this.host.contentOptions.uvLayout;
    this.host.applyGeometryToCell(cell, cell.textureAspectRatio);
    if (cell.tileDescriptor) {
      this.tileMaterialManager.applyTileMaterials(cell, cell.tileDescriptor);
    } else {
      this.tileMaterialManager.restoreCubeMaterials(cell);
    }
  }
}
