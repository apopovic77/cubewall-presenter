import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Vector3, Quaternion, Vector4, Matrix } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Scalar } from '@babylonjs/core/Maths/math.scalar';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import type { FloatArray } from '@babylonjs/core/types';
import { TileMaterialManager } from './tiles/TileMaterialManager';
import '@babylonjs/core/Shaders/default.fragment';
import '@babylonjs/core/Shaders/default.vertex';
import {
  appConfig,
  type TextureSidePattern,
  type TextureUvLayout,
  type AxisLabelAxis,
  type CubeWallConfig,
  type CubeLayoutConfig,
} from '../config/AppConfig';
import type { CubeContentItem } from '../types/content';
import { FieldLayoutEngine } from './layouts/FieldLayoutEngine';
import { GridWaveField } from './layouts/fields/GridWaveField';
import { SpiralField } from './layouts/fields/SpiralField';
import { SphereField } from './layouts/fields/SphereField';
import { HelixField } from './layouts/fields/HelixField';
import { ChaosField } from './layouts/fields/ChaosField';
import { LineWaveField } from './layouts/fields/LineWaveField';
import { GlassTileFactory } from './tiles/GlassTileFactory';
import type { TileDescriptor, TileFootprint } from './tiles/TileTypes';
import { MasonryField } from './layouts/fields/MasonryField';
import { CubeInstanceRenderer } from './instancing/CubeInstanceRenderer';
import { FieldPhysics, type FieldPhysicsMode } from './physics/FieldPhysics';

/** Pixel width requested from storage for cube face textures (atlas cells are ~160 px). */
const CUBE_TEXTURE_WIDTH_PX = 320;
/** Pixel width of the texture loaded for the selected cube, which is seen up close. */
const DETAIL_TEXTURE_WIDTH_PX = 1024;

export interface CubeSelectionInfo {
  readonly gridX: number;
  readonly gridZ: number;
  readonly color: Color3;
  readonly textureUrl: string | null;
  readonly content: CubeContentItem | null;
}

export interface CubeCell {
  mesh: Mesh;
  gridX: number;
  gridZ: number;
  basePosition: Vector3;
  baseRotation: Vector3;
  currentPosition: Vector3;
  currentRotation: Vector3;
  targetPosition: Vector3;
  targetRotation: Vector3;
  wavePhase: number;
  individualXRotAccumulator: number;
  isSelected: boolean;
  selectionProgress: number;
  interactionActive: boolean;
  interactionPhase: 0 | 1 | 2;
  interactionTime: number;
  material: StandardMaterial;
  tintColor: Color3;
  selectionDirection: Vector3;
  textureUrl: string;
  textureLoaded: boolean;
  content: CubeContentItem | null;
  tileDescriptor: TileDescriptor | null;
  footprint: TileFootprint;
  isBeingDragged: boolean;
  physicsSpinAngle: number;
  textureAspectRatio: number | null;
  textureSidePattern: TextureSidePattern;
  textureMirrorTopBottom: boolean;
  textureUvLayout: TextureUvLayout;
}

export interface CubeContentOptions {
  repeatContent: boolean;
  useFallbackTextures: boolean;
  useDynamicFallbacks: boolean;
  sidePattern: TextureSidePattern;
  mirrorTopBottom: boolean;
  uvLayout: TextureUvLayout;
  layout: CubeLayoutConfig;
}

interface AxisValueInfo {
  label: string | null;
  raw: string | number | null;
  timestamp?: number;
  count: number;
}

interface AxisGroup {
  key: string;
  label: string;
  orderValue: number | string;
  timestamp?: number;
  items: CubeContentItem[];
}

export class CubeField {
  private readonly scene: Scene;
  private readonly config: CubeWallConfig;
  private root: TransformNode;
  /** Draws the cubes in cube geometry mode; tile mode renders each mesh itself. */
  private readonly instanceRenderer: CubeInstanceRenderer;
  private cubes: CubeCell[] = [];
  private selection: CubeCell | null = null;
  private dynamicImageUrls: string[] = [];
  private picsumErrorCount = 0;
  private allowFallbackTextures = false;
  private useDynamicFallbacks = false;
  private useSafeFallbackTextures = false;
  private contentItems: CubeContentItem[] = [];
  /** Rigid-body simulation (drop / anchor modes); runs in field space, see FieldPhysics. */
  private readonly physics: FieldPhysics;
  private readonly holdMatrix = new Matrix();
  private contentGeneration = 0;
  private fieldAutoRotateActive = false;
  private fieldAutoRotateSpeed = 0.25;
  private fieldAutoRotateAxis = new Vector3(0, 1, 0);
  private contentOptions: CubeContentOptions;
  private axisValueInfo: Record<AxisLabelAxis, AxisValueInfo[]> = {
    rows: [],
    columns: [],
  };
  private readonly outstandingAspectAdjustments = new Map<number, { cell: CubeCell; texture: Texture }>();
  private readonly fieldEngine: FieldLayoutEngine;
  private fieldTime = 0;
  private readonly fieldMorphDurationSeconds = 6;
  private readonly glassTileFactory: GlassTileFactory;
  private tileDescriptors: TileDescriptor[] = [];
  private tileFootprints: TileFootprint[] = [];
  private stackingAnchors = new Map<string, { x: number; z: number }>();
  private layoutDirty = false;
  private readonly tileMaterialManager: TileMaterialManager;
  private readonly orientationScratch = Vector3.Zero();
  private readonly orientationQuatScratchA = Quaternion.Identity();
  private readonly orientationQuatScratchB = Quaternion.Identity();
  private readonly stackOffsetScratch = new Vector3();

  private getNormalDirection(): number {
    return this.config.selectedCubeNormalDirection === -1 ? -1 : 1;
  }

  private applyGeometryToCell(cell: CubeCell, aspectOverride: number | null = null): void {
    const descriptor = cell.tileDescriptor;
    if (!descriptor) {
      cell.mesh.scaling.set(1, 1, 1);
      const orientation = this.getOrientationRotation();
      cell.baseRotation.copyFrom(orientation);
      cell.currentRotation.copyFrom(orientation);
      cell.targetRotation.copyFrom(orientation);
      cell.mesh.rotation.copyFrom(orientation);
      return;
    }

    const baseSize = this.config.cubeSize;
    const desiredWidth = this.config.geometryMode === 'tile' ? baseSize : descriptor.footprint.width;
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
    const orientation = this.getOrientationRotation();
    cell.baseRotation.copyFrom(orientation);
    cell.currentRotation.copyFrom(orientation);
    cell.targetRotation.copyFrom(orientation);
    cell.mesh.rotation.copyFrom(orientation);
  }

  private getOrientationRotation(): Vector3 {
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

  public applyGeometrySettings(): void {
    this.cubes.forEach((cell) => {
      this.applyGeometryToCell(cell, cell.textureAspectRatio);
      if (this.config.geometryMode === 'tile' && cell.tileDescriptor) {
        this.tileMaterialManager.applyTileMaterials(cell, cell.tileDescriptor);
      } else {
        this.tileMaterialManager.restoreCubeMaterials(cell);
      }
    });
    this.switchFieldForGeometry();
  }

  public requestLayoutRefresh(): void {
    this.layoutDirty = true;
  }

  public getRecommendedAxisLabelAxes(): AxisLabelAxis[] {
    const ids = new Set<string>();
    ids.add(this.fieldEngine.getCurrentField().id);
    if (this.fieldEngine.isMorphing()) {
      ids.add(this.fieldEngine.getNextField().id);
    }

    const axes = new Set<AxisLabelAxis>();
    ids.forEach((id) => {
      switch (id) {
        case 'grid':
          axes.add('rows');
          axes.add('columns');
          break;
        case 'line':
          axes.add('columns');
          break;
        case 'spiral':
        case 'helix':
          axes.add('rows');
          break;
        default:
          break;
      }
    });

    if (axes.size === 0) {
      axes.add('rows');
    }
    return Array.from(axes);
  }

  private mergeLayoutOptions(overrides?: Partial<CubeLayoutConfig>): CubeLayoutConfig {
    const base = this.config.layout;
    const axisKey = overrides?.axisKey && overrides.axisKey.trim() ? overrides.axisKey.trim() : base.axisKey;
    return {
      mode: overrides?.mode ?? base.mode,
      axis: overrides?.axis ?? base.axis,
      axisKey,
      sortOrder: overrides?.sortOrder ?? base.sortOrder,
      axisOrder: overrides?.axisOrder ?? base.axisOrder,
    };
  }

  constructor(scene: Scene, config: CubeWallConfig = appConfig) {
    this.scene = scene;
    this.config = config;
    this.root = new TransformNode('cubeFieldRoot', this.scene);
    this.root.rotationQuaternion = Quaternion.Identity();
    this.root.position.set(0, 0, 0);
    this.physics = new FieldPhysics(scene, this.root, config);
    this.instanceRenderer = new CubeInstanceRenderer(
      scene,
      config.cubeSize,
      this.computeFaceUVs(config.textureSidePattern, config.textureMirrorTopBottom),
    );
    const initialLayout: CubeLayoutConfig = { ...config.layout };
    this.contentOptions = {
      repeatContent: true,
      useFallbackTextures: config.useFallbackImages,
      useDynamicFallbacks: config.useFallbackImages,
      sidePattern: config.textureSidePattern,
      mirrorTopBottom: config.textureMirrorTopBottom,
      uvLayout: config.textureUvLayout,
      layout: initialLayout,
    };
    this.allowFallbackTextures = this.contentOptions.useFallbackTextures;
    this.useDynamicFallbacks = this.contentOptions.useDynamicFallbacks;
    this.useSafeFallbackTextures = this.contentOptions.useFallbackTextures;
    this.fieldEngine = new FieldLayoutEngine([
      new GridWaveField(),
      new LineWaveField(),
      new MasonryField(),
      new SpiralField(),
      new SphereField(),
      new HelixField(),
      new ChaosField(),
    ]);
    this.fieldTime = 0;
    this.glassTileFactory = new GlassTileFactory(scene);
    this.tileMaterialManager = new TileMaterialManager(scene);
    this.updateRootTransform();
    this.rebuild(config.gridSize, this.tileDescriptors.length || undefined);
  }

  private updateRootTransform(): void {
    const plane = this.config.gridPlane ?? {
      origin: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      forward: { x: 0, y: 0, z: 1 },
    };

    this.root.position.set(plane.origin.x, plane.origin.y, plane.origin.z);

    const up = new Vector3(plane.normal.x, plane.normal.y, plane.normal.z);
    if (!Number.isFinite(up.x) || !Number.isFinite(up.y) || !Number.isFinite(up.z) || up.lengthSquared() < 1e-6) {
      up.set(0, 1, 0);
    }
    up.normalize();

    let forward = new Vector3(plane.forward.x, plane.forward.y, plane.forward.z);
    const forwardInvalid = !Number.isFinite(forward.x) || !Number.isFinite(forward.y) || !Number.isFinite(forward.z) || forward.lengthSquared() < 1e-6;
    if (forwardInvalid) {
      forward = Vector3.Cross(up, Vector3.Up());
    }
    forward.normalize();
    if (Math.abs(Vector3.Dot(forward, up)) > 0.999) {
      let arbitrary = Math.abs(up.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(0, 0, 1);
      forward = Vector3.Cross(arbitrary, up);
      if (forward.lengthSquared() < 1e-6) {
        arbitrary = new Vector3(1, 0, 0);
        forward = Vector3.Cross(arbitrary, up);
      }
    }
    forward.normalize();
    const right = Vector3.Cross(up, forward).normalize();
    forward = Vector3.Cross(right, up).normalize();

    const rotation = Quaternion.FromLookDirectionLH(forward, up);
    this.root.rotationQuaternion = rotation;
  }

  public randomizeFieldOrientation(): void {
    const yaw = Scalar.RandomRange(0, Math.PI * 2);
    const pitch = Scalar.RandomRange(-Math.PI / 2, Math.PI / 2);
    const roll = Scalar.RandomRange(-Math.PI / 2, Math.PI / 2);
    const rotation = Quaternion.RotationYawPitchRoll(yaw, pitch, roll);
    this.root.rotationQuaternion = rotation;
  }

  public startFieldMorph(): { current: string; next: string } | null {
    if (this.fieldEngine.isMorphing()) {
      return null;
    }
    const total = this.fieldEngine.getFieldCount();
    if (total <= 1) {
      return null;
    }
    const currentIndex = this.fieldEngine.getCurrentFieldIndex();
    // The wave line (all cubes in one row, ~700 units for 625 cubes) has its own
    // action (F8); in the morph cycle it just sends everything out of view.
    let nextIndex = (currentIndex + 1) % total;
    if (this.fieldEngine.getFieldId(nextIndex) === 'line') nextIndex = (nextIndex + 1) % total;
    this.fieldEngine.startMorphTo(nextIndex, this.fieldMorphDurationSeconds);
    const current = this.fieldEngine.getCurrentField().name;
    const next = this.fieldEngine.getNextField().name;
    return { current, next };
  }

  public startLineWaveField(): boolean {
    const targetIndex = this.fieldEngine.findFieldIndex('line');
    if (targetIndex < 0) {
      return false;
    }
    if (!this.fieldEngine.isMorphing() && this.fieldEngine.getCurrentFieldIndex() === targetIndex) {
      return false;
    }
    this.fieldEngine.startMorphTo(targetIndex, this.fieldMorphDurationSeconds);
    return true;
  }

  public isFieldAutoRotating(): boolean {
    return this.fieldAutoRotateActive;
  }

  public toggleFieldAutoRotation(): boolean {
    this.fieldAutoRotateActive = !this.fieldAutoRotateActive;
    if (this.fieldAutoRotateActive) {
      const normal = new Vector3(
        this.config.gridPlane.normal.x,
        this.config.gridPlane.normal.y,
        this.config.gridPlane.normal.z,
      );
      if (normal.lengthSquared() < 1e-6 || !Number.isFinite(normal.x) || !Number.isFinite(normal.y) || !Number.isFinite(normal.z)) {
        normal.set(0, 1, 0);
      }
      normal.normalize();
      this.fieldAutoRotateAxis = normal;
    }
    return this.fieldAutoRotateActive;
  }

  private updateFieldLayout(deltaTime: number, initial: boolean = false, writeMeshes = true): void {
    this.fieldEngine.update(deltaTime);
    if (this.cubes.length === 0) {
      return;
    }

    if (initial || !this.config.wavePositionEnabled) {
      this.fieldTime = 0;
    } else if (deltaTime > 0) {
      const speed = Math.max(0, this.config.fieldAnimationSpeed);
      this.fieldTime += deltaTime * speed;
    }

    this.stackingAnchors.clear();
    this.fieldEngine.setContext({
      totalCount: this.cubes.length,
      gridSize: this.config.gridSize,
      cubeSize: this.config.cubeSize,
      cubeSpacing: this.config.cubeSpacing,
      waveAmplitudeY: this.config.waveAmplitudeY,
      waveFrequencyY: this.config.waveFrequencyY,
      wavePhaseSpread: this.config.wavePhaseSpread,
      globalScale: Math.max(0.1, this.config.fieldGlobalScale),
      tileFootprints: this.tileFootprints,
      tileDescriptors: this.tileDescriptors,
      masonryColumnCount: this.config.masonry.columnCount,
      masonryColumnSpacing: this.config.masonry.columnSpacing,
      masonryRowSpacing: this.config.masonry.rowSpacing,
    });

    const effectiveTime = this.config.wavePositionEnabled && !initial ? this.fieldTime : 0;
    const positions = this.fieldEngine.sampleAll(this.cubes.length, effectiveTime);
    for (let index = 0; index < this.cubes.length; index += 1) {
      const cube = this.cubes[index];
      const position = positions[index];
      const descriptor = this.tileDescriptors[index] ?? null;
      if (descriptor?.stacking) {
        if (descriptor.stacking.role === 'leader') {
          this.stackingAnchors.set(descriptor.stacking.groupId, { x: position.x, z: position.z });
        } else if (descriptor.stacking.inheritAnchorPosition) {
          const anchor = this.stackingAnchors.get(descriptor.stacking.groupId);
          if (anchor) {
            position.x = anchor.x;
            position.z = anchor.z;
          }
        }
        position.y += descriptor.stacking.yOffset;
      }
      cube.basePosition.copyFrom(position);
      if (writeMeshes && (initial || !this.config.wavePositionEnabled)) {
        const shouldReset = initial || (!cube.isSelected && !cube.interactionActive && !cube.isBeingDragged);
        if (shouldReset) {
          cube.currentPosition.copyFrom(position);
          cube.targetPosition.copyFrom(position);
          cube.mesh.position.copyFrom(position);
          cube.currentRotation.copyFrom(cube.baseRotation);
          cube.mesh.rotation.copyFrom(cube.baseRotation);
        }
      }
    }
  }

  public rebuild(gridSize: number, tileCount?: number): void {
    this.disposeCubes();
    this.updateRootTransform();
    this.config.gridSize = gridSize;
    this.useSafeFallbackTextures = this.config.useFallbackImages;
    if (this.useSafeFallbackTextures) {
      this.picsumErrorCount = 0;
    }
    const total = tileCount ?? gridSize * gridSize;
    const spacing = this.config.cubeSize + this.config.cubeSpacing;
    const columns = Math.max(1, gridSize);
    const offset = -((columns - 1) * spacing) / 2;

    this.generateDynamicImageUrls(total);

    for (let index = 0; index < total; index += 1) {
      const gridX = index % columns;
      const gridZ = Math.floor(index / columns);
        const mesh = MeshBuilder.CreateBox(
        `cube_${gridX}_${gridZ}_${index}`,
          { size: this.config.cubeSize },
          this.scene,
        );
      mesh.parent = this.root;

        const basePosition = new Vector3(
        offset + gridX * spacing,
          0,
        offset + gridZ * spacing,
        );
        mesh.position.copyFrom(basePosition);
        mesh.isPickable = true;
      mesh.metadata = { gridX, gridZ };

      const tintHue = (gridX + gridZ) / Math.max(1, columns * 2);
        const tintColor = Color3.FromHSV(tintHue, 0.45, 1);
      const material = new StandardMaterial(`cubeMat_${gridX}_${gridZ}_${index}`, this.scene);
      material.diffuseColor = tintColor.scale(0.4);
      material.emissiveColor = Color3.Black();
        material.specularColor = new Color3(0.1, 0.1, 0.1);
      material.backFaceCulling = false;
        mesh.material = material;

      const wavePhase = (gridX * this.config.wavePhaseSpread) + (gridZ * this.config.wavePhaseSpread * 0.7);
        const radialDirection = new Vector3(basePosition.x, 0, basePosition.z);
        if (radialDirection.lengthSquared() > 0.0001) {
          radialDirection.normalize();
        } else {
          radialDirection.set(0, 0, 0);
        }

        const cube: CubeCell = {
          mesh,
        gridX,
        gridZ,
          basePosition,
          baseRotation: Vector3.Zero(),
          currentPosition: basePosition.clone(),
          currentRotation: Vector3.Zero(),
          targetPosition: basePosition.clone(),
          targetRotation: Vector3.Zero(),
          wavePhase,
          individualXRotAccumulator: 0,
          isSelected: false,
          selectionProgress: 0,
          interactionActive: false,
          interactionPhase: 0,
          interactionTime: 0,
          material,
          tintColor,
          selectionDirection: radialDirection,
        textureUrl: '',
        textureLoaded: false,
        content: null,
        tileDescriptor: null,
        footprint: { width: 1, height: 1, depth: 1 },
        isBeingDragged: false,
        physicsSpinAngle: 0,
        textureAspectRatio: null,
        textureSidePattern: this.contentOptions.sidePattern,
        textureMirrorTopBottom: this.contentOptions.mirrorTopBottom,
        textureUvLayout: this.contentOptions.uvLayout,
        };

        this.cubes.push(cube);

      if (this.allowFallbackTextures) {
        const textureUrl = this.pickTextureUrl(index);
        if (textureUrl) {
          this.loadTextureForCell(cube, textureUrl);
        }
      }
    }

    this.instanceRenderer.setGeometry(
      this.config.cubeSize,
      this.computeFaceUVs(this.contentOptions.sidePattern, this.contentOptions.mirrorTopBottom),
    );
    this.instanceRenderer.setCubes(this.config.geometryMode === 'tile' ? [] : this.cubes);
    this.applyContentToCubes();
    this.updateFieldLayout(0, true);
    // A rebuild while physics runs keeps the mode: new cubes get bodies at their layout poses.
    if (this.physics.active) this.physics.attach(this.cubes);
  }

  private disposeCubes(): void {
    this.instanceRenderer.setCubes([]);
    this.cubes.forEach((cell) => {
      this.tileMaterialManager.disposeForCell(cell);
      cell.mesh.dispose(false, true);
      cell.material.dispose(false, true);
    });
    this.cubes = [];
    this.selection = null;
    this.outstandingAspectAdjustments.clear();
  }
  public dispose(): void {
    this.physics.dispose();
    this.disposeCubes();
    this.instanceRenderer.dispose();
    this.disposeTileDescriptors();
    this.root.dispose();
    this.glassTileFactory.dispose();
  }

  public async setContent(items: CubeContentItem[], options?: Partial<CubeContentOptions>): Promise<void> {
    // Overlapping calls (layout + geometry change fire several): only the latest one finishes.
    const generation = ++this.contentGeneration;
    this.contentItems = items;
    const layoutOverrides = options?.layout;
    const layout = this.mergeLayoutOptions(layoutOverrides);
    this.contentOptions = {
      repeatContent: options?.repeatContent ?? true,
      useFallbackTextures: options?.useFallbackTextures ?? this.config.useFallbackImages,
      useDynamicFallbacks: options?.useDynamicFallbacks ?? this.config.useFallbackImages,
      sidePattern: options?.sidePattern ?? this.config.textureSidePattern,
      mirrorTopBottom: options?.mirrorTopBottom ?? this.config.textureMirrorTopBottom,
      uvLayout: options?.uvLayout ?? this.config.textureUvLayout,
      layout,
    };
    this.config.layout = { ...layout };
    this.allowFallbackTextures = this.contentOptions.useFallbackTextures;
    this.useDynamicFallbacks = this.contentOptions.useDynamicFallbacks;
    if (!this.allowFallbackTextures || !this.useDynamicFallbacks) {
      this.dynamicImageUrls = [];
    } else if (!this.useSafeFallbackTextures) {
      this.generateDynamicImageUrls(this.config.gridSize * this.config.gridSize);
    }
    console.info('[CubeField] setContent', {
      items: items.length,
      withImage: items.filter((item) => !!item.imageUrl).length,
      layoutMode: layout.mode,
      repeatContent: this.contentOptions.repeatContent,
    });
    if (items.length > 0) {
      console.debug(
        '[CubeField] sample items',
        items.slice(0, 3).map((item) => ({
          id: item.id,
          title: item.title,
          imageUrl: item.imageUrl,
        })),
      );
    }
    if (this.config.geometryMode === 'tile') {
      const current = await this.prepareTileDescriptors(items, generation);
      if (!current) return;
      this.applyTileDescriptorsToCubes();
    } else {
      this.disposeTileDescriptors();
      if (this.cubes.length !== this.config.gridSize * this.config.gridSize) {
        this.rebuild(this.config.gridSize);
      } else {
        this.cubes.forEach((cube) => {
          cube.tileDescriptor = null;
          cube.footprint = { width: 1, height: 1, depth: 1 };
          cube.mesh.setEnabled(true);
          cube.mesh.isPickable = true;
          this.tileMaterialManager.restoreCubeMaterials(cube);
        });
        this.layoutDirty = true;
      }
    }
    this.applyContentToCubes();
    this.refreshTextureMappings();
  }

  public getAxisValueInfo(axis: AxisLabelAxis, index: number): AxisValueInfo | null {
    const values = this.axisValueInfo[axis];
    if (!values || index < 0 || index >= values.length) {
      return null;
    }
    return values[index] ?? null;
  }

  private tryAssignItem(
    assignments: Map<string, CubeContentItem>,
    assigned: Set<string>,
    gridX: number,
    gridZ: number,
    item: CubeContentItem | undefined,
  ): boolean {
    if (!item) {
      return false;
    }
    const key = `${gridX},${gridZ}`;
    if (!this.contentOptions.repeatContent && assigned.has(item.id)) {
      return false;
    }
    assignments.set(key, item);
    if (!this.contentOptions.repeatContent) {
      assigned.add(item.id);
    }
    return true;
  }

  private extractSortValue(item: CubeContentItem): number | string {
    const value = item.layout?.sortValue;
    if (value === null || value === undefined) {
      return item.id;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
      return value;
    }
    return item.id;
  }

  private compareItemsBySortValue(a: CubeContentItem, b: CubeContentItem, order: 'asc' | 'desc'): number {
    const aValue = this.extractSortValue(a);
    const bValue = this.extractSortValue(b);
    const direction = order === 'asc' ? 1 : -1;
    if (typeof aValue === 'number' && typeof bValue === 'number') {
      const diff = aValue - bValue;
      if (diff !== 0) {
        return diff * direction;
      }
    }
    const diff = String(aValue).localeCompare(String(bValue));
    if (diff !== 0) {
      return diff * direction;
    }
    return String(a.id).localeCompare(String(b.id));
  }

  private compareOrderValues(a: number | string, b: number | string, order: 'asc' | 'desc'): number {
    if (typeof a === 'number' && typeof b === 'number') {
      return order === 'asc' ? a - b : b - a;
    }
    const aStr = String(a);
    const bStr = String(b);
    return order === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
  }

  /** False if a newer setContent started meanwhile (its result is discarded). */
  private async prepareTileDescriptors(items: CubeContentItem[], generation: number): Promise<boolean> {
    this.disposeTileDescriptors();
    if (this.config.geometryMode !== 'tile') {
      return true;
    }
    const isStale = () => generation !== this.contentGeneration;
    const descriptors = await this.glassTileFactory.buildDescriptors(items, {
      includeCaptions: this.config.tiles.captionsEnabled,
      isCancelled: isStale,
    });
    if (isStale()) {
      descriptors.forEach((descriptor) => descriptor.glass?.texture.dispose());
      return false;
    }
    const baseSize = this.config.cubeSize;
    const imageDepth = this.config.tiles.image.thickness;
    const textDepth = this.config.tiles.text.thickness;
    descriptors.forEach((descriptor) => {
      descriptor.footprint.width = baseSize;
      descriptor.footprint.depth = descriptor.kind === 'glassText' ? textDepth : imageDepth;
      if (descriptor.kind === 'glassText') {
        descriptor.footprint.height = Math.max(0.05 * baseSize, descriptor.footprint.height || baseSize * 0.25);
      } else {
        descriptor.footprint.height = baseSize;
      }
    });
    this.tileDescriptors = descriptors;
    this.tileFootprints = descriptors.map((descriptor) => ({ ...descriptor.footprint }));
    if (descriptors.length > this.cubes.length) {
      const requiredGridSize = Math.ceil(Math.sqrt(descriptors.length));
      if (requiredGridSize > this.config.gridSize) {
        this.config.gridSize = Math.min(this.config.maxGridSize, requiredGridSize);
        this.rebuild(this.config.gridSize);
      }
    }
    this.layoutDirty = true;
    return true;
  }

  private disposeTileDescriptors(): void {
    this.tileDescriptors.forEach((descriptor) => {
      if (descriptor.glass) {
        descriptor.glass.texture.dispose();
      }
    });
    this.tileDescriptors = [];
    this.tileFootprints = [];
  }

  private switchFieldForGeometry(): void {
    let targetId = 'grid';
    const layoutMode = this.config.layout.mode;
    if (layoutMode === 'masonry') {
      targetId = 'masonry';
    } else if (layoutMode === 'axis') {
      targetId = 'grid';
    }
    const targetIndex = this.fieldEngine.findFieldIndex(targetId);
    if (targetIndex >= 0) {
      this.fieldEngine.startMorphTo(targetIndex, 0.05);
    }
  }

  private applyTileDescriptorsToCubes(): void {
    const count = Math.min(this.tileDescriptors.length, this.cubes.length);
    this.stackingAnchors.clear();
    for (let index = 0; index < count; index += 1) {
      const descriptor = this.tileDescriptors[index];
      const cube = this.cubes[index];
      cube.tileDescriptor = descriptor;
      cube.footprint = { ...descriptor.footprint };
      cube.mesh.isPickable = descriptor.kind === 'image';
      cube.mesh.setEnabled(true);
      if (descriptor.kind === 'glassText' && descriptor.glass) {
        cube.material.diffuseTexture = descriptor.glass.texture;
        cube.material.opacityTexture = descriptor.glass.texture;
        cube.material.alpha = descriptor.glass.alpha;
        cube.material.emissiveColor = descriptor.glass.tint.scale(0.2);
      }
      this.applyGeometryToCell(cube, cube.textureAspectRatio);
      if (this.config.geometryMode === 'tile') {
        this.tileMaterialManager.applyTileMaterials(cube, descriptor);
      } else {
        this.tileMaterialManager.restoreCubeMaterials(cube);
      }
    }

    for (let index = count; index < this.cubes.length; index += 1) {
      const cube = this.cubes[index];
      cube.tileDescriptor = null;
      cube.mesh.setEnabled(false);
      cube.mesh.isPickable = false;
      this.tileMaterialManager.restoreCubeMaterials(cube);
    }
    this.layoutDirty = true;
    this.switchFieldForGeometry();
  }

  private normalizeAxisValue(value: unknown): { key: string; label: string; orderValue: number | string; timestamp?: number } | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      const label = value.toString();
      return { key: label, label, orderValue: value };
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return { key: trimmed, label: trimmed, orderValue: numeric };
      }
      const timestamp = Date.parse(trimmed);
      if (!Number.isNaN(timestamp)) {
        return { key: trimmed, label: trimmed, orderValue: timestamp, timestamp };
      }
      return { key: trimmed, label: trimmed, orderValue: trimmed };
    }
    if (typeof value === 'boolean') {
      const label = value ? 'true' : 'false';
      return { key: label, label, orderValue: label };
    }
    const label = String(value).trim();
    if (!label) {
      return null;
    }
    return { key: label, label, orderValue: label };
  }

  private buildMatrixAssignments(items: CubeContentItem[], assignments: Map<string, CubeContentItem>): void {
    const gridSize = this.config.gridSize;
    const repeat = this.contentOptions.repeatContent && items.length > 0;
    let cursor = 0;

    for (let z = 0; z < gridSize; z += 1) {
      for (let x = 0; x < gridSize; x += 1) {
        let item: CubeContentItem | null = null;
        if (cursor < items.length) {
          item = items[cursor];
          cursor += 1;
        } else if (repeat && items.length > 0) {
          item = items[cursor % items.length];
          cursor += 1;
        }
        if (item) {
          assignments.set(`${x},${z}`, item);
        }
      }
    }

    const emptyRowInfo = Array.from({ length: gridSize }, () => ({
      label: null,
      raw: null,
      count: 0,
    } as AxisValueInfo));
    const emptyColumnInfo = Array.from({ length: gridSize }, () => ({
      label: null,
      raw: null,
      count: 0,
    } as AxisValueInfo));
    this.axisValueInfo.rows = emptyRowInfo;
    this.axisValueInfo.columns = emptyColumnInfo;
  }

  private buildAxisAssignments(items: CubeContentItem[], assignments: Map<string, CubeContentItem>): void {
    const gridSize = this.config.gridSize;
    const layout = this.contentOptions.layout;
    const axisKey = layout.axisKey;
    const axisGroups = new Map<string, AxisGroup>();
    const fallbackItems: CubeContentItem[] = [];

    items.forEach((item) => {
      const axisValues = item.layout?.axisValues;
      const rawValue = axisValues?.[axisKey];
      const normalized = this.normalizeAxisValue(rawValue);
      if (!normalized) {
        fallbackItems.push(item);
        return;
      }
      let group = axisGroups.get(normalized.key);
      if (!group) {
        group = {
          key: normalized.key,
          label: normalized.label,
          orderValue: normalized.orderValue,
          timestamp: normalized.timestamp,
          items: [],
        };
        axisGroups.set(normalized.key, group);
      }
      group.items.push(item);
    });

    const groups = Array.from(axisGroups.values());
    groups.sort((a, b) => {
      const diff = this.compareOrderValues(a.orderValue, b.orderValue, layout.axisOrder);
      if (diff !== 0) {
        return diff;
      }
      return a.label.localeCompare(b.label);
    });

    const limitedGroups = groups.slice(0, gridSize);
    const overflowGroups = groups.slice(gridSize);
    overflowGroups.forEach((group) => {
      fallbackItems.push(...group.items);
    });

    fallbackItems.sort((a, b) => this.compareItemsBySortValue(a, b, layout.sortOrder));

    const assigned = new Set<string>();
    let repeatCursor = 0;

    const pullNextFallback = (): CubeContentItem | undefined => {
      while (fallbackItems.length > 0) {
        const candidate = fallbackItems.shift()!;
        if (this.contentOptions.repeatContent || !assigned.has(candidate.id)) {
          return candidate;
        }
      }
      if (this.contentOptions.repeatContent && items.length > 0) {
        const candidate = items[repeatCursor % items.length];
        repeatCursor += 1;
        return candidate;
      }
      return undefined;
    };

    const rowsInfo: AxisValueInfo[] = Array.from({ length: gridSize }, () => ({
      label: null,
      raw: null,
      count: 0,
    }));
    const columnsInfo: AxisValueInfo[] = Array.from({ length: gridSize }, () => ({
      label: null,
      raw: null,
      count: 0,
    }));
    const rowCounts = new Array(gridSize).fill(0);
    const columnCounts = new Array(gridSize).fill(0);

    if (layout.axis === 'rows') {
      limitedGroups.forEach((group, rowIndex) => {
        if (rowIndex >= gridSize) return;
        rowsInfo[rowIndex] = {
          label: group.label,
          raw: group.label,
          timestamp: group.timestamp,
          count: 0,
        };
        const sortedItems = [...group.items].sort((a, b) => this.compareItemsBySortValue(a, b, layout.sortOrder));
        const primaryItems = sortedItems.slice(0, gridSize);
        const overflow = sortedItems.slice(gridSize);
        fallbackItems.push(...overflow);

        for (let columnIndex = 0; columnIndex < gridSize; columnIndex += 1) {
          let candidate: CubeContentItem | undefined;
          if (columnIndex < primaryItems.length) {
            candidate = primaryItems[columnIndex];
          } else {
            candidate = pullNextFallback();
          }
          if (!candidate && this.contentOptions.repeatContent && sortedItems.length > 0) {
            candidate = sortedItems[columnIndex % sortedItems.length];
          }
          if (!candidate) {
            continue;
          }
          if (this.tryAssignItem(assignments, assigned, columnIndex, rowIndex, candidate)) {
            rowCounts[rowIndex] += 1;
            columnCounts[columnIndex] += 1;
          }
        }
      });

      for (let rowIndex = limitedGroups.length; rowIndex < gridSize; rowIndex += 1) {
        rowsInfo[rowIndex] = rowsInfo[rowIndex] ?? {
          label: null,
          raw: null,
          count: 0,
        };
        for (let columnIndex = 0; columnIndex < gridSize; columnIndex += 1) {
          const candidate = pullNextFallback();
          if (!candidate) {
            continue;
          }
          if (this.tryAssignItem(assignments, assigned, columnIndex, rowIndex, candidate)) {
            rowCounts[rowIndex] += 1;
            columnCounts[columnIndex] += 1;
          }
        }
      }
    } else {
      limitedGroups.forEach((group, columnIndex) => {
        if (columnIndex >= gridSize) return;
        columnsInfo[columnIndex] = {
          label: group.label,
          raw: group.label,
          timestamp: group.timestamp,
          count: 0,
        };
        const sortedItems = [...group.items].sort((a, b) => this.compareItemsBySortValue(a, b, layout.sortOrder));
        const primaryItems = sortedItems.slice(0, gridSize);
        const overflow = sortedItems.slice(gridSize);
        fallbackItems.push(...overflow);

        for (let rowIndex = 0; rowIndex < gridSize; rowIndex += 1) {
          let candidate: CubeContentItem | undefined;
          if (rowIndex < primaryItems.length) {
            candidate = primaryItems[rowIndex];
          } else {
            candidate = pullNextFallback();
          }
          if (!candidate && this.contentOptions.repeatContent && sortedItems.length > 0) {
            candidate = sortedItems[rowIndex % sortedItems.length];
          }
          if (!candidate) {
            continue;
          }
          if (this.tryAssignItem(assignments, assigned, columnIndex, rowIndex, candidate)) {
            rowCounts[rowIndex] += 1;
            columnCounts[columnIndex] += 1;
          }
        }
      });

      for (let columnIndex = limitedGroups.length; columnIndex < gridSize; columnIndex += 1) {
        columnsInfo[columnIndex] = columnsInfo[columnIndex] ?? {
          label: null,
          raw: null,
          count: 0,
        };
        for (let rowIndex = 0; rowIndex < gridSize; rowIndex += 1) {
          const candidate = pullNextFallback();
          if (!candidate) {
            continue;
          }
          if (this.tryAssignItem(assignments, assigned, columnIndex, rowIndex, candidate)) {
            rowCounts[rowIndex] += 1;
            columnCounts[columnIndex] += 1;
          }
        }
      }
    }

    rowsInfo.forEach((info, index) => {
      info.count = rowCounts[index] ?? 0;
    });
    columnsInfo.forEach((info, index) => {
      info.count = columnCounts[index] ?? 0;
    });

    if (layout.axis === 'rows') {
      this.axisValueInfo.rows = rowsInfo;
      this.axisValueInfo.columns = columnsInfo;
    } else {
      this.axisValueInfo.columns = columnsInfo;
      this.axisValueInfo.rows = rowsInfo;
    }
  }

  private buildContentAssignments(items: CubeContentItem[]): Map<string, CubeContentItem> {
    const assignments = new Map<string, CubeContentItem>();

    if (items.length === 0) {
      const gridSize = this.config.gridSize;
      const emptyRows = Array.from({ length: gridSize }, () => ({
        label: null,
        raw: null,
        count: 0,
      } as AxisValueInfo));
      const emptyColumns = Array.from({ length: gridSize }, () => ({
        label: null,
        raw: null,
        count: 0,
      } as AxisValueInfo));
      this.axisValueInfo.rows = emptyRows;
      this.axisValueInfo.columns = emptyColumns;
      return assignments;
    }

    if (this.contentOptions.layout.mode === 'axis') {
      this.buildAxisAssignments(items, assignments);
    } else {
      this.buildMatrixAssignments(items, assignments);
    }

    return assignments;
  }

  public getAxisValuesSnapshot(): {
    rows: { label: string | null; count: number }[];
    columns: { label: string | null; count: number }[];
  } {
    return {
      rows: this.axisValueInfo.rows.map((info) => ({
        label: info.label,
        count: info.count,
      })),
      columns: this.axisValueInfo.columns.map((info) => ({
        label: info.label,
        count: info.count,
      })),
    };
  }

  public getAxisAnchors(axis: AxisLabelAxis): Vector3[] {
    const anchors: Vector3[] = [];
    if (axis === 'rows') {
      for (let z = 0; z < this.config.gridSize; z += 1) {
        const cell = this.cubes.find((c) => c.gridZ === z && c.gridX === 0 && this.isSelectableCube(c));
        if (cell) {
          anchors.push(cell.mesh.getAbsolutePosition().clone());
        }
      }
    } else {
      for (let x = 0; x < this.config.gridSize; x += 1) {
        const cell = this.cubes.find((c) => c.gridX === x && c.gridZ === 0 && this.isSelectableCube(c));
        if (cell) {
          anchors.push(cell.mesh.getAbsolutePosition().clone());
        }
      }
    }
    return anchors;
  }

  public getRowAnchors(): Vector3[] {
    return this.getAxisAnchors('rows');
  }

  private isSelectableCube(cube: CubeCell): boolean {
    return cube.tileDescriptor?.kind !== 'glassText';
  }

  private generateDynamicImageUrls(count: number): void {
    if (!this.allowFallbackTextures || !this.useDynamicFallbacks || this.useSafeFallbackTextures) {
      this.dynamicImageUrls = [];
      return;
    }
    this.dynamicImageUrls = [];
    const timestamp = Date.now();
    for (let i = 0; i < count; i += 1) {
      const seed = Math.floor(Math.random() * 20000) + i;
      this.dynamicImageUrls.push(`https://picsum.photos/256/256?random=${seed}&t=${timestamp + i}`);
    }
  }

  private pickTextureUrl(index: number): string {
    if (!this.allowFallbackTextures) {
      return '';
    }
    if (this.useDynamicFallbacks && !this.useSafeFallbackTextures && this.dynamicImageUrls.length > 0) {
      return this.dynamicImageUrls[index % this.dynamicImageUrls.length];
    }
    const safe = this.config.fallbackTextureUrlsSafe.length > 0 ? this.config.fallbackTextureUrlsSafe : this.config.fallbackTextureUrls;
    if (safe.length === 0) {
      return '';
    }
    return safe[index % safe.length];
  }

  private isInstanced(cell: CubeCell): boolean {
    return this.config.geometryMode !== 'tile' && !cell.tileDescriptor;
  }

  private loadTextureForCell(cell: CubeCell, url: string): void {
    url = this.normalizeTextureUrl(url);
    if (!url) {
      this.clearTextureForCell(cell);
      return;
    }

    if (cell.textureUrl === url && cell.textureLoaded) {
      return;
    }

    if (this.isInstanced(cell)) {
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
        cell.textureSidePattern = this.contentOptions.sidePattern;
        cell.textureMirrorTopBottom = this.contentOptions.mirrorTopBottom;
        const aspect = this.computeAspectRatio(texture);
        cell.textureAspectRatio = Number.isFinite(aspect) ? aspect : null;
        this.applyGeometryToCell(cell, cell.textureAspectRatio);
        if (cell.tileDescriptor) {
          this.tileMaterialManager.applyTileMaterials(cell, cell.tileDescriptor);
        } else {
          this.tileMaterialManager.restoreCubeMaterials(cell);
        }
        this.scheduleAspectAdjustment(cell, texture);
        this.picsumErrorCount = 0;
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
        if (url.includes('picsum.photos')) {
          this.picsumErrorCount += 1;
          if (this.picsumErrorCount >= this.config.picsumErrorThreshold) {
            this.useSafeFallbackTextures = true;
            this.config.useFallbackImages = true;
            this.dynamicImageUrls = [];
          }
        }
        if (!this.allowFallbackTextures) {
          this.clearTextureForCell(cell);
          return;
        }
        const fallbackUrl = this.pickTextureUrl(cell.gridX * this.config.gridSize + cell.gridZ);
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
        if (cell === this.selection) this.loadDetailTexture(cell);
      },
      () => {
        console.warn('[CubeField] atlas image failed', { grid: { x: cell.gridX, z: cell.gridZ }, url });
        const fallbackUrl = this.allowFallbackTextures
          ? this.pickTextureUrl(cell.gridX * this.config.gridSize + cell.gridZ)
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
  private loadDetailTexture(cell: CubeCell): void {
    if (!cell.textureUrl) {
      this.instanceRenderer.setDetached(cell, true);
      return;
    }
    const detailUrl = this.withTextureWidth(cell.textureUrl, DETAIL_TEXTURE_WIDTH_PX);
    const material = cell.material;
    const texture = new Texture(detailUrl, this.scene, undefined, true, Texture.TRILINEAR_SAMPLINGMODE, () => {
      if (this.selection !== cell) {
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
      if (this.selection === cell) this.instanceRenderer.setDetached(cell, true);
    });
  }

  private releaseDetailTexture(cell: CubeCell): void {
    this.instanceRenderer.setDetached(cell, false);
    const material = cell.material;
    material.diffuseTexture?.dispose();
    material.diffuseTexture = null;
    material.diffuseColor = cell.tintColor.scale(0.4);
  }

  private refreshTextureMappings(): void {
    this.cubes.forEach((cell) => {
      const texture = cell.material.diffuseTexture;
      if (texture instanceof Texture && cell.textureLoaded) {
        if (texture.isReady()) {
          this.configureTextureForCell(cell, texture);
          this.applyGeometryToCell(cell, cell.textureAspectRatio);
          if (cell.tileDescriptor) {
            this.tileMaterialManager.applyTileMaterials(cell, cell.tileDescriptor);
          } else {
            this.tileMaterialManager.restoreCubeMaterials(cell);
          }
          this.scheduleAspectAdjustment(cell, texture);
        } else {
          texture.onLoadObservable.addOnce(() => {
            this.configureTextureForCell(cell, texture);
            this.applyGeometryToCell(cell, cell.textureAspectRatio);
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
    cell.textureSidePattern = this.contentOptions.sidePattern;
    cell.textureMirrorTopBottom = this.contentOptions.mirrorTopBottom;
    cell.textureUvLayout = this.contentOptions.uvLayout;
    const faceUVs =
      this.config.geometryMode === 'tile'
        ? this.buildTileFaceUVs()
        : this.computeFaceUVs(this.contentOptions.sidePattern, this.contentOptions.mirrorTopBottom);
    const vertexData = VertexData.CreateBox({
      size: this.config.cubeSize,
      sideOrientation: Mesh.FRONTSIDE,
      faceUV: faceUVs,
    });
    if (vertexData.uvs) {
      cell.mesh.updateVerticesData(VertexBuffer.UVKind, vertexData.uvs, false, true);
    }
  }

  private computeFaceUVs(sidePattern: TextureSidePattern, mirrorTopBottom: boolean): Vector4[] {
    const make = (flipU: boolean, flipV: boolean) => (
      flipU && flipV ? new Vector4(1, 1, 0, 0)
        : flipU ? new Vector4(1, 0, 0, 1)
        : flipV ? new Vector4(0, 1, 1, 0)
        : new Vector4(0, 0, 1, 1)
    );

    const sideFlips = sidePattern === 'alternating'
      ? [false, true, false, true]
      : [false, false, false, false];

    return [
      make(sideFlips[0], false), // front
      make(sideFlips[2], false), // back
      make(sideFlips[1], false), // right
      make(sideFlips[3], false), // left
      make(false, false), // top
      make(false, mirrorTopBottom), // bottom
    ];
  }

  private buildTileFaceUVs(): Vector4[] {
    const front = new Vector4(0, 0, 1, 1);
    const back = new Vector4(1, 0, 0, 1); // mirror horizontal to keep orientation
    const blank = new Vector4(0.5, 0.5, 0.5, 0.5);
    return [front, back, blank, blank, blank, blank];
  }

  public updateTextureUvLayout(options: { layout: TextureUvLayout; sidePattern: TextureSidePattern; mirrorTopBottom: boolean }): void {
    const { layout, sidePattern, mirrorTopBottom } = options;
    const unchanged =
      layout === this.contentOptions.uvLayout &&
      sidePattern === this.contentOptions.sidePattern &&
      mirrorTopBottom === this.contentOptions.mirrorTopBottom;
    if (unchanged) {
      return;
    }
    this.contentOptions.uvLayout = layout;
    this.contentOptions.sidePattern = sidePattern;
    this.contentOptions.mirrorTopBottom = mirrorTopBottom;
    this.config.textureUvLayout = layout;
    this.config.textureSidePattern = sidePattern;
    this.config.textureMirrorTopBottom = mirrorTopBottom;
    this.cubes.forEach((cube) => {
      cube.textureUvLayout = layout;
      cube.textureSidePattern = sidePattern;
      cube.textureMirrorTopBottom = mirrorTopBottom;
    });
    this.instanceRenderer.setGeometry(this.config.cubeSize, this.computeFaceUVs(sidePattern, mirrorTopBottom));
    this.refreshTextureMappings();
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
    if (cell.tileDescriptor?.kind === 'image') {
      const width = cell.tileDescriptor.footprint.width;
      const height = width / aspect;
      cell.tileDescriptor.footprint.height = height;
      cell.footprint.height = height;
      const index = this.cubes.indexOf(cell);
      if (index >= 0) {
        this.tileFootprints[index] = { ...cell.tileDescriptor.footprint };
      }
      this.layoutDirty = true;
    }
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

    const sidePattern = cell.textureSidePattern ?? this.contentOptions.sidePattern;
    const mirrorTopBottom = cell.textureMirrorTopBottom ?? this.contentOptions.mirrorTopBottom;
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

  public getSelectionInfo(): CubeSelectionInfo | null {
    if (!this.selection) return null;
    return {
      gridX: this.selection.gridX,
      gridZ: this.selection.gridZ,
      color: this.selection.tintColor,
      textureUrl: this.selection.textureUrl || null,
      content: this.selection.content ?? null,
    };
  }

  public getCurrentSelection(): CubeCell | null {
    return this.selection;
  }

  public getAllCells(): CubeCell[] {
    return [...this.cubes];
  }

  public getLiftNormalWorld(cell: CubeCell): Vector3 {
    const local = cell.selectionDirection.clone();
    if (local.lengthSquared() < 1e-6) {
      local.set(0, this.getNormalDirection(), 0);
    }
    const world = Vector3.TransformNormal(local, this.root.getWorldMatrix());
    if (world.lengthSquared() < 1e-6 || !Number.isFinite(world.x) || !Number.isFinite(world.y) || !Number.isFinite(world.z)) {
      world.set(0, this.getNormalDirection(), 0);
    }
    world.normalize();
    return world;
  }

  public getCenterCell(): CubeCell | null {
    if (this.cubes.length === 0) return null;
    const centerIndex = Math.floor(this.config.gridSize / 2);
    const centerCandidates = this.cubes.filter((cube) => cube.gridX === centerIndex && cube.gridZ === centerIndex);
    if (centerCandidates.length > 0) {
      return centerCandidates[0];
    }
    return this.cubes[0] ?? null;
  }

  public getRandomCell(excludeSelected = true): CubeCell | null {
    const selectable = this.cubes.filter((cube) => this.isSelectableCube(cube));
    if (selectable.length === 0) {
      return null;
    }
    if (!excludeSelected) {
      const index = Math.floor(Math.random() * selectable.length);
      return selectable[index];
    }
    const candidates = selectable.filter((cube) => !cube.isSelected);
    if (candidates.length === 0) {
      return this.selection ?? selectable[Math.floor(Math.random() * selectable.length)];
    }
    const index = Math.floor(Math.random() * candidates.length);
    return candidates[index];
  }

  /** Parent of all cubes; layouts move and rotate it. */
  public getRootNode(): TransformNode {
    return this.root;
  }

  public getCellFromMesh(mesh: AbstractMesh | null | undefined): CubeCell | null {
    if (!mesh || !mesh.metadata) return null;
    const { gridX, gridZ } = mesh.metadata as { gridX: number; gridZ: number };
    const cell = this.cubes.find((c) => c.gridX === gridX && c.gridZ === gridZ) ?? null;
    if (!cell) return null;
    if (this.isSelectableCube(cell)) {
      return cell;
    }
    const groupId = cell.tileDescriptor?.stacking?.groupId;
    if (!groupId) return null;
    const leader = this.cubes.find(
      (candidate) =>
        candidate.tileDescriptor?.stacking?.groupId === groupId &&
        candidate.tileDescriptor?.stacking?.role === 'leader',
    );
    return leader ?? null;
  }

  public selectCell(cell: CubeCell | null): void {
    if (cell && !this.isSelectableCube(cell)) {
      return;
    }
    if (this.selection === cell) return;
    if (this.selection) {
      if (this.isInstanced(this.selection)) this.releaseDetailTexture(this.selection);
      this.selection.isSelected = false;
      this.selection.selectionProgress = Math.max(this.selection.selectionProgress, 0);
      this.selection = null;
    }
    if (cell) {
      this.selection = cell;
      this.selection.isSelected = true;
      this.selection.selectionProgress = 0;
      if (this.isInstanced(cell) && cell.textureLoaded) {
        this.loadDetailTexture(cell);
      } else if (this.isInstanced(cell) && !cell.textureUrl) {
        this.instanceRenderer.setDetached(cell, true);
      }
    }
    this.cubes.forEach((cube) => {
      cube.material.emissiveColor = cube === this.selection ? this.config.tintColor.clone() : Color3.Black();
    });
  }

  public triggerRipple(center: CubeCell): void {
    if (!this.isSelectableCube(center)) {
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

    this.cubes.forEach((cube) => {
      if (cube === center || cube.isSelected || !this.isSelectableCube(cube)) return;
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

  public update(deltaTime: number, sceneTime: number): void {
    if (this.fieldAutoRotateActive && deltaTime > 0) {
      const currentRotation = this.root.rotationQuaternion ?? Quaternion.Identity();
      const angle = this.fieldAutoRotateSpeed * deltaTime;
      const deltaRotation = Quaternion.RotationAxis(this.fieldAutoRotateAxis, angle);
      const nextRotation = currentRotation.multiply(deltaRotation);
      nextRotation.normalize();
      this.root.rotationQuaternion = nextRotation;
    }

    const refreshLayout = this.layoutDirty;
    if (refreshLayout) {
      this.layoutDirty = false;
    }
    // The layout (and a running morph) keeps advancing under physics; only the
    // mesh poses then come from the bodies instead of the layout.
    this.updateFieldLayout(deltaTime, refreshLayout, !this.physics.active);
    const rotationWaveEnabled = this.config.waveRotationEnabled;
    const normalDirection = this.getNormalDirection();
    if (this.physics.active) {
      const lift = Math.min(this.config.selectedCubeLift, this.config.cubeSize * 0.6);
      this.physics.drive(deltaTime, lift);
      return;
    }
    // Frame-rate independent smoothing; a plain `speed * dt` overshoots on long frames.
    const interactionBlend = 1 - Math.exp(-this.config.interactionLerpSpeed * deltaTime);

    this.cubes.forEach((cube) => {
      // A cube held in an AR hand is posed by holdCube; it glides back once released.
      if (cube.isBeingDragged) return;
      if (!this.isSelectableCube(cube)) {
        const descriptor = cube.tileDescriptor;
        const stacking = descriptor?.stacking;
        if (stacking?.inheritAnchorPosition && stacking.groupId) {
          const leader = this.cubes.find(
            (candidate) =>
              candidate.tileDescriptor?.stacking?.groupId === stacking.groupId &&
              candidate.tileDescriptor?.stacking?.role === 'leader',
          );
          if (leader) {
            const offset = this.stackOffsetScratch;
            offset.copyFrom(cube.basePosition).subtractInPlace(leader.basePosition);
            cube.currentPosition.copyFrom(leader.currentPosition);
            cube.currentPosition.addInPlace(offset);
            cube.targetPosition.copyFrom(cube.currentPosition);
            cube.currentRotation.copyFrom(leader.currentRotation);
            cube.targetRotation.copyFrom(leader.currentRotation);
            cube.mesh.position.copyFrom(cube.currentPosition);
            cube.mesh.rotation.copyFrom(cube.currentRotation);
            return;
          }
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

  private applyContentToCubes(): void {
    const total = this.cubes.length;
    if (total === 0) {
      return;
    }

    const options = this.contentOptions;
    if (!this.contentItems || this.contentItems.length === 0) {
      console.warn('[CubeField] applyContentToCubes – no content items, fallbacks=', options.useFallbackTextures);
      this.cubes.forEach((cube, index) => {
        if (cube.tileDescriptor?.kind === 'glassText') {
          cube.content = null;
          cube.mesh.isPickable = false;
          cube.textureUrl = '';
          cube.textureLoaded = true;
          return;
        }
        cube.content = null;
        if (options.useFallbackTextures) {
          const fallbackUrl = this.pickTextureUrl(index);
          if (fallbackUrl) {
            this.loadTextureForCell(cube, fallbackUrl);
            return;
          }
        }
        this.clearTextureForCell(cube);
      });
      return;
    }

    const items = this.contentItems;
    const assignments = this.buildContentAssignments(items);
    const contentLookup = new Map(items.map((item) => [item.id, item]));
    console.info('[CubeField] applyContentToCubes', {
      totalCubes: total,
      contentItems: items.length,
      assignments: assignments.size,
    });

    this.cubes.forEach((cube, index) => {
      const descriptor = cube.tileDescriptor;
      if (descriptor && descriptor.kind === 'glassText') {
        cube.content = contentLookup.get(descriptor.contentId) ?? null;
        cube.mesh.isPickable = false;
        cube.textureUrl = '';
        cube.textureLoaded = true;
        return;
      }

      const key = `${cube.gridX},${cube.gridZ}`;
      const item = assignments.get(key) ?? null;

      cube.content = item ?? null;

      let textureUrl = item?.imageUrl ?? '';
      if (!textureUrl && options.useFallbackTextures) {
        textureUrl = this.pickTextureUrl(index);
      }

      if (textureUrl) {
        this.loadTextureForCell(cube, textureUrl);
        return;
      }

      this.clearTextureForCell(cube);
    });
  }

  private clearTextureForCell(cell: CubeCell): void {
    if (this.isInstanced(cell)) this.instanceRenderer.clearImage(cell);
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
    cell.textureSidePattern = this.contentOptions.sidePattern;
    cell.textureMirrorTopBottom = this.contentOptions.mirrorTopBottom;
    cell.textureUvLayout = this.contentOptions.uvLayout;
    this.applyGeometryToCell(cell, cell.textureAspectRatio);
    if (cell.tileDescriptor) {
      this.tileMaterialManager.applyTileMaterials(cell, cell.tileDescriptor);
    } else {
      this.tileMaterialManager.restoreCubeMaterials(cell);
    }
  }

  /** Starts the rigid-body simulation; false if it was switched off again while Havok loaded. */
  public async enablePhysics(mode: FieldPhysicsMode): Promise<boolean> {
    if (this.physics.active) {
      this.physics.setMode(mode);
      return true;
    }
    this.selectCell(null);
    this.outstandingAspectAdjustments.clear();
    this.cubes.forEach((cube) => {
      cube.selectionProgress = 0;
      cube.physicsSpinAngle = 0;
      cube.isBeingDragged = false;
    });
    return this.physics.enable(this.cubes, mode);
  }

  public setPhysicsMode(mode: FieldPhysicsMode): void {
    this.physics.setMode(mode);
  }

  /** Stops the simulation; cubes glide back into the layout from where they lie. */
  public disablePhysics(): void {
    // Always disable: it also cancels an enable that is still loading Havok.
    const wasActive = this.physics.active;
    this.physics.disable();
    if (!wasActive) return;
    this.selectCell(null);
    this.outstandingAspectAdjustments.clear();
    this.cubes.forEach((cube) => {
      cube.isBeingDragged = false;
      cube.selectionProgress = 0;
      cube.physicsSpinAngle = 0;
      cube.currentPosition.copyFrom(cube.mesh.position);
      const localRotation = cube.mesh.rotationQuaternion
        ? cube.mesh.rotationQuaternion.toEulerAngles()
        : cube.mesh.rotation.clone();
      cube.mesh.rotationQuaternion = null;
      cube.mesh.rotation.copyFrom(localRotation);
      cube.currentRotation.copyFrom(localRotation);
      this.applyGeometryToCell(cube, cube.textureAspectRatio);
      if (cube.tileDescriptor) {
        this.tileMaterialManager.applyTileMaterials(cube, cube.tileDescriptor);
      }
    });
    this.layoutDirty = true;
  }

  public beginPhysicsDrag(cell: CubeCell): void {
    if (!this.physics.active) return;
    if (this.selection === cell) this.selectCell(null);
    this.physics.beginDrag(cell);
  }

  /** `worldPoint`: where the pointer ray meets the ground plane (see getPhysicsGroundWorldY). */
  public updatePhysicsDrag(cell: CubeCell, worldPoint: Vector3): void {
    if (!this.physics.active || !cell.isBeingDragged) return;
    this.physics.dragTo(cell, worldPoint);
  }

  public endPhysicsDrag(cell: CubeCell): void {
    if (!this.physics.active) return;
    this.physics.endDrag(cell);
  }

  /** AR: a hand (or ray) takes this cube; it follows holdCube until releaseCube. */
  public grabCube(cell: CubeCell): void {
    if (this.selection === cell) this.selectCell(null);
    if (this.physics.active) {
      this.physics.beginDrag(cell);
    } else {
      cell.isBeingDragged = true;
    }
  }

  /** Pose of the held cube as a world matrix. */
  public holdCube(cell: CubeCell, world: Matrix): void {
    if (!cell.isBeingDragged) return;
    if (this.physics.active) {
      this.physics.holdTo(cell, world);
      return;
    }
    const parentWorld = this.root.getWorldMatrix();
    world.multiplyToRef(parentWorld.clone().invert(), this.holdMatrix);
    const rotation = new Quaternion();
    this.holdMatrix.decompose(undefined, rotation, cell.mesh.position);
    cell.mesh.rotationQuaternion = null;
    rotation.toEulerAnglesToRef(cell.mesh.rotation);
    cell.currentPosition.copyFrom(cell.mesh.position);
    cell.currentRotation.copyFrom(cell.mesh.rotation);
  }

  /** Lets go of a held cube; with physics it is thrown with `worldVelocity` (m/s). */
  public releaseCube(cell: CubeCell, worldVelocity?: Vector3): void {
    if (this.physics.active) {
      this.physics.endDrag(cell, worldVelocity);
    } else {
      cell.isBeingDragged = false;
    }
  }

  public getPhysicsGroundWorldY(): number {
    return this.physics.groundWorldY();
  }

  public isPhysicsActive(): boolean {
    return this.physics.active;
  }

}

function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

