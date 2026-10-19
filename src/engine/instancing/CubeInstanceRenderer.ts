import type { Scene } from '@babylonjs/core/scene';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Material } from '@babylonjs/core/Materials/material';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, type Vector4 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/thinInstanceMesh';

/** Layer bit of the proxy meshes while the instanced mesh draws them (no camera renders it). */
const HIDDEN_LAYER_MASK = 0;
/** Babylon's default mesh layer mask. */
const VISIBLE_LAYER_MASK = 0x0fffffff;

/** Atlas edge in pixels: 4096² RGBA with mipmaps is ~90 MB, affordable on a Quest. */
const ATLAS_SIZE_PX = 4096;
/** Inset per atlas cell so mip levels do not bleed neighbouring images into a face. */
const ATLAS_CELL_PADDING_PX = 3;
/**
 * Atlas uploads are batched: each copies the whole 4096² canvas to the GPU and
 * rebuilds its mipmaps. While many images are still loading, upload rarely;
 * once the queue is (almost) empty, upload promptly.
 */
const ATLAS_UPLOAD_INTERVAL_MS = 250;
const ATLAS_UPLOAD_INTERVAL_LOADING_MS = 1500;
const ATLAS_LOADING_THRESHOLD = 8;

const ATLAS_RECT_ATTRIBUTE = 'atlasRect';

/** Per-instance atlas rectangle (xy offset, zw size) applied to the box UVs. */
class AtlasUvPlugin extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, 'CubeAtlasUv', 200, { CUBE_ATLAS_UV: false });
    this._enable(true);
  }

  override prepareDefines(defines: Record<string, unknown>): void {
    defines.CUBE_ATLAS_UV = true;
  }

  override getClassName(): string {
    return 'AtlasUvPlugin';
  }

  override getAttributes(attributes: string[]): void {
    attributes.push(ATLAS_RECT_ATTRIBUTE);
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== 'vertex') return null;
    return {
      CUSTOM_VERTEX_DEFINITIONS: `attribute vec4 ${ATLAS_RECT_ATTRIBUTE};`,
      // Runs after `uvUpdated` is declared and before the diffuse UV is derived from it.
      CUSTOM_VERTEX_UPDATE_POSITION: `
        #ifdef UV1
          uvUpdated = ${ATLAS_RECT_ATTRIBUTE}.xy + uvUpdated * ${ATLAS_RECT_ATTRIBUTE}.zw;
        #endif
      `,
    };
  }
}

/** What the renderer needs from a cube: its proxy mesh and whether to draw it itself. */
export interface InstancedCube {
  mesh: Mesh;
  tintColor: Color3;
}

/**
 * Draws all cubes of the field with one thin-instanced box and one texture atlas
 * instead of one mesh, material and texture per cube.
 *
 * The per-cube meshes stay in the scene as proxies: animation, layouts, physics
 * and picking keep moving and hitting them, but they are on a layer no camera
 * renders. Every frame their world matrices are copied into the instance buffer.
 * A cube can be "detached" (e.g. the selected one): its proxy is rendered again
 * with its own material and full-resolution texture, and its instance is hidden.
 */
export class CubeInstanceRenderer {
  private readonly scene: Scene;
  private readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly atlas: DynamicTexture;
  private readonly atlasContext: CanvasRenderingContext2D;
  private cubes: InstancedCube[] = [];
  private detached = new Set<InstancedCube>();
  private matrices = new Float32Array(0);
  private atlasRects = new Float32Array(0);
  private cellsPerRow = 1;
  private cellSizePx = ATLAS_SIZE_PX;
  private imageRequests = new Map<InstancedCube, HTMLImageElement>();
  private atlasDirty = false;
  private lastAtlasUpload = 0;
  private readonly frameObserver: Observer<Scene>;
  private readonly hiddenMatrix = Matrix.Scaling(0, 0, 0);
  private disposed = false;
  private cropToSquare = true;

  constructor(scene: Scene, cubeSize: number, faceUVs: Vector4[]) {
    this.scene = scene;
    this.mesh = new Mesh('cubeInstances', scene);
    this.mesh.isPickable = false;
    // Instances span the whole field and move every frame; skip per-frame culling bounds.
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.setGeometry(cubeSize, faceUVs);

    this.atlas = new DynamicTexture('cubeAtlas', { width: ATLAS_SIZE_PX, height: ATLAS_SIZE_PX }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
    this.atlas.wrapU = Texture.CLAMP_ADDRESSMODE;
    this.atlas.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.atlasContext = this.atlas.getContext() as CanvasRenderingContext2D;

    this.material = new StandardMaterial('cubeInstancesMaterial', scene);
    this.material.diffuseTexture = this.atlas;
    this.material.specularColor = new Color3(0.1, 0.1, 0.1);
    this.material.backFaceCulling = false;
    new AtlasUvPlugin(this.material);
    this.mesh.material = this.material;

    // After animation and physics have moved the proxies, before meshes are drawn.
    this.frameObserver = scene.onBeforeActiveMeshesEvaluationObservable.add(() => this.syncFrame());
  }

  /** Box geometry with the same per-face UV layout the per-cube meshes use. */
  setGeometry(cubeSize: number, faceUVs: Vector4[]): void {
    VertexData.CreateBox({ size: cubeSize, faceUV: faceUVs, sideOrientation: Mesh.FRONTSIDE }).applyToMesh(this.mesh, true);
  }

  /**
   * Takes over rendering of these cubes (replaces the previous set).
   * `cropToSquare`: cubes show the image's centre square; tiles (whose
   * geometry already has the image aspect) show the whole image.
   */
  setCubes(cubes: InstancedCube[], options: { cropToSquare?: boolean } = {}): void {
    this.releaseCubes();
    this.cubes = cubes;
    this.cropToSquare = options.cropToSquare ?? true;
    const count = cubes.length;
    this.cellsPerRow = Math.max(1, Math.ceil(Math.sqrt(count)));
    this.cellSizePx = Math.floor(ATLAS_SIZE_PX / this.cellsPerRow);
    this.matrices = new Float32Array(count * 16);
    this.atlasRects = new Float32Array(count * 4);

    this.atlasContext.clearRect(0, 0, ATLAS_SIZE_PX, ATLAS_SIZE_PX);
    cubes.forEach((cube, index) => {
      cube.mesh.layerMask = HIDDEN_LAYER_MASK;
      this.writeAtlasRect(index);
      this.fillCell(index, cube.tintColor.scale(0.4));
    });
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer(ATLAS_RECT_ATTRIBUTE, this.atlasRects, 4, true);
    this.markAtlasDirty();
    this.syncFrame();
  }

  /** Loads an image into the cube's atlas cell (centre-cropped to a square). */
  setImage(cube: InstancedCube, url: string, onLoaded?: (aspect: number) => void, onFailed?: () => void): void {
    const index = this.cubes.indexOf(cube);
    if (index < 0) return;
    this.imageRequests.get(cube)?.removeAttribute('src');
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => {
      if (this.disposed || this.imageRequests.get(cube) !== image) return;
      this.imageRequests.delete(cube);
      this.drawImageCell(index, image);
      onLoaded?.(image.naturalWidth / Math.max(1, image.naturalHeight));
    };
    image.onerror = () => {
      if (this.imageRequests.get(cube) !== image) return;
      this.imageRequests.delete(cube);
      onFailed?.();
    };
    this.imageRequests.set(cube, image);
    image.src = url;
  }

  /** Untextured cube: its atlas cell shows the cube's tint. */
  clearImage(cube: InstancedCube): void {
    const index = this.cubes.indexOf(cube);
    if (index < 0) return;
    this.imageRequests.delete(cube);
    this.fillCell(index, cube.tintColor.scale(0.4));
  }

  /** Renders this cube through its own proxy mesh (and hides its instance), or back. */
  setDetached(cube: InstancedCube, detached: boolean): void {
    if (!this.cubes.includes(cube)) return;
    if (detached) {
      this.detached.add(cube);
      cube.mesh.layerMask = VISIBLE_LAYER_MASK;
    } else {
      this.detached.delete(cube);
      cube.mesh.layerMask = HIDDEN_LAYER_MASK;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.onBeforeActiveMeshesEvaluationObservable.remove(this.frameObserver);
    this.releaseCubes();
    this.mesh.dispose();
    this.material.dispose(true, true);
  }

  /** Gives the proxies their own rendering back (tile mode, teardown). */
  private releaseCubes(): void {
    this.cubes.forEach((cube) => {
      if (!cube.mesh.isDisposed()) cube.mesh.layerMask = VISIBLE_LAYER_MASK;
    });
    this.cubes = [];
    this.detached.clear();
    this.imageRequests.clear();
  }

  private syncFrame(): void {
    const count = this.cubes.length;
    if (count === 0) return;
    for (let index = 0; index < count; index += 1) {
      const cube = this.cubes[index];
      const hidden = this.detached.has(cube) || !cube.mesh.isEnabled();
      const matrix = hidden ? this.hiddenMatrix : cube.mesh.computeWorldMatrix(true);
      matrix.copyToArray(this.matrices, index * 16);
    }
    this.mesh.thinInstanceBufferUpdated('matrix');

    const interval =
      this.imageRequests.size > ATLAS_LOADING_THRESHOLD ? ATLAS_UPLOAD_INTERVAL_LOADING_MS : ATLAS_UPLOAD_INTERVAL_MS;
    if (this.atlasDirty && performance.now() - this.lastAtlasUpload >= interval) {
      this.atlas.update();
      this.atlasDirty = false;
      this.lastAtlasUpload = performance.now();
    }
  }

  private markAtlasDirty(): void {
    this.atlasDirty = true;
  }

  /** Atlas rectangle of a cell in UV space (V runs bottom-up in the texture). */
  private writeAtlasRect(index: number): void {
    const column = index % this.cellsPerRow;
    const row = Math.floor(index / this.cellsPerRow);
    const inner = this.cellSizePx - ATLAS_CELL_PADDING_PX * 2;
    const x = column * this.cellSizePx + ATLAS_CELL_PADDING_PX;
    const y = row * this.cellSizePx + ATLAS_CELL_PADDING_PX;
    const offset = index * 4;
    this.atlasRects[offset] = x / ATLAS_SIZE_PX;
    // DynamicTexture is uploaded with invertY, so canvas row 0 is the top (v = 1).
    this.atlasRects[offset + 1] = 1 - (y + inner) / ATLAS_SIZE_PX;
    this.atlasRects[offset + 2] = inner / ATLAS_SIZE_PX;
    this.atlasRects[offset + 3] = inner / ATLAS_SIZE_PX;
  }

  private cellOrigin(index: number): { x: number; y: number } {
    return {
      x: (index % this.cellsPerRow) * this.cellSizePx,
      y: Math.floor(index / this.cellsPerRow) * this.cellSizePx,
    };
  }

  private fillCell(index: number, color: Color3): void {
    const { x, y } = this.cellOrigin(index);
    this.atlasContext.fillStyle = color.toHexString();
    this.atlasContext.fillRect(x, y, this.cellSizePx, this.cellSizePx);
    this.markAtlasDirty();
  }

  /** Cubes: centre square of the image, like the per-cube aspect crop. Tiles: the whole image, squeezed into the cell. */
  private drawImageCell(index: number, image: HTMLImageElement): void {
    const { x, y } = this.cellOrigin(index);
    if (!this.cropToSquare) {
      this.atlasContext.drawImage(image, x, y, this.cellSizePx, this.cellSizePx);
      this.markAtlasDirty();
      return;
    }
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const sx = (image.naturalWidth - side) / 2;
    const sy = (image.naturalHeight - side) / 2;
    this.atlasContext.drawImage(image, sx, sy, side, side, x, y, this.cellSizePx, this.cellSizePx);
    this.markAtlasDirty();
  }
}
