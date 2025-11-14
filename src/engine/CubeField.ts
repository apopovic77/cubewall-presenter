import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Vector3, Quaternion, Vector4 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Scalar } from '@babylonjs/core/Maths/math.scalar';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsConstraint } from '@babylonjs/core/Physics/v2/physicsConstraint';
import { PhysicsShapeType, PhysicsMotionType, PhysicsConstraintType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
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
  physicsAggregate?: PhysicsAggregate | null;
  anchorMesh: Mesh | null;
  anchorAggregate?: PhysicsAggregate | null;
  anchorConstraint?: PhysicsConstraint | null;
  isBeingDragged: boolean;
  liftAnchor: Vector3 | null;
  physicsSpinAngle: number;
  textureAspectRatio: number | null;
  textureSidePattern: TextureSidePattern;
  textureMirrorTopBottom: boolean;
  textureUvLayout: TextureUvLayout;
  physicsMotionType: PhysicsMotionType;
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
  private cubes: CubeCell[] = [];
  private selection: CubeCell | null = null;
  private dynamicImageUrls: string[] = [];
  private picsumErrorCount = 0;
  private allowFallbackTextures = false;
  private useDynamicFallbacks = false;
  private useSafeFallbackTextures = false;
  private contentItems: CubeContentItem[] = [];
  private physicsActive: boolean = false;
  private fieldAutoRotateActive = false;
  private fieldAutoRotateSpeed = 0.25;
  private fieldAutoRotateAxis = new Vector3(0, 1, 0);
  private contentOptions: CubeContentOptions;
  private axisValueInfo: Record<AxisLabelAxis, AxisValueInfo[]> = {
    rows: [],
    columns: [],
  };
  private physicsAnchorsEnabled = false;
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
      if (this.physicsActive && cell.physicsAggregate) {
        this.refreshPhysicsForCell(cell);
      }
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
    if (this.physicsActive && cell.physicsAggregate) {
      this.refreshPhysicsForCell(cell);
    }
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

  private refreshPhysicsForCell(cell: CubeCell): void {
    if (!this.physicsActive || !cell.physicsAggregate) {
      return;
    }
    const hadAnchor = this.physicsAnchorsEnabled && Boolean(cell.anchorAggregate);
    if (hadAnchor) {
      this.disposePhysicsAnchor(cell);
    }
    cell.physicsAggregate.dispose();
    cell.physicsAggregate = new PhysicsAggregate(
      cell.mesh,
      PhysicsShapeType.BOX,
      { mass: 1, restitution: 0.2, friction: 0.6 },
      this.scene,
    );
    const body = cell.physicsAggregate.body;
    if (body && !body.isDisposed) {
      body.setMotionType(PhysicsMotionType.DYNAMIC);
      body.setLinearVelocity(Vector3.Zero());
      body.setAngularVelocity(Vector3.Zero());
    }
    if (hadAnchor) {
      this.createPhysicsAnchor(cell);
    }
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
    const nextIndex = (currentIndex + 1) % total;
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

  private updateFieldLayout(deltaTime: number, initial: boolean = false): void {
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
      if (initial || !this.config.wavePositionEnabled) {
        const shouldReset = initial || (!cube.isSelected && !cube.interactionActive);
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
        physicsAggregate: null,
        anchorMesh: null,
        anchorAggregate: null,
        anchorConstraint: null,
        isBeingDragged: false,
        liftAnchor: null,
        physicsSpinAngle: 0,
        textureAspectRatio: null,
        textureSidePattern: this.contentOptions.sidePattern,
        textureMirrorTopBottom: this.contentOptions.mirrorTopBottom,
        textureUvLayout: this.contentOptions.uvLayout,
          physicsMotionType: PhysicsMotionType.DYNAMIC,
        };

        this.cubes.push(cube);

      if (this.allowFallbackTextures) {
        const textureUrl = this.pickTextureUrl(index);
        if (textureUrl) {
          this.loadTextureForCell(cube, textureUrl);
        }
      }
    }

    this.applyContentToCubes();
    this.updateFieldLayout(0, true);
  }

  private disposeCubes(): void {
    this.cubes.forEach((cell) => {
      this.disposePhysicsAnchor(cell);
      this.tileMaterialManager.disposeForCell(cell);
      cell.physicsAggregate?.dispose();
      cell.mesh.dispose(false, true);
      cell.material.dispose(false, true);
    });
    this.cubes = [];
    this.selection = null;
    this.physicsActive = false;
    this.outstandingAspectAdjustments.clear();
  }
  public dispose(): void {
    this.disposeCubes();
    this.disposeTileDescriptors();
    this.root.dispose();
    this.glassTileFactory.dispose();
  }

  public async setContent(items: CubeContentItem[], options?: Partial<CubeContentOptions>): Promise<void> {
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
      await this.prepareTileDescriptors(items);
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

  private async prepareTileDescriptors(items: CubeContentItem[]): Promise<void> {
    this.disposeTileDescriptors();
    if (this.config.geometryMode !== 'tile') {
      return;
    }
    const descriptors = await this.glassTileFactory.buildDescriptors(items, {
      includeCaptions: this.config.tiles.captionsEnabled,
    });
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

  private loadTextureForCell(cell: CubeCell, url: string): void {
    url = this.normalizeTextureUrl(url);
    if (!url) {
      this.clearTextureForCell(cell);
      return;
    }

    if (cell.textureUrl === url && cell.textureLoaded) {
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

  private normalizeTextureUrl(url: string | null | undefined): string {
    if (!url) {
      return '';
    }
    try {
      const parsed = new URL(url);
      if (!parsed.searchParams.has('width')) {
        parsed.searchParams.set('width', '600');
      }
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
      if (this.physicsActive) {
        this.selection.isBeingDragged = false;
      }
      this.selection.isSelected = false;
      this.selection.selectionProgress = Math.max(this.selection.selectionProgress, 0);
      this.selection.liftAnchor = null;
      this.selection = null;
    }
    if (cell) {
      this.selection = cell;
      this.selection.isSelected = true;
      this.selection.selectionProgress = 0;
      if (this.physicsActive) {
        cell.isBeingDragged = false;
        cell.liftAnchor = null;
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
    this.updateFieldLayout(deltaTime, refreshLayout);
    const rotationWaveEnabled = this.config.waveRotationEnabled;
    const normalDirection = this.getNormalDirection();
    if (this.physicsActive) {
      const isMorphing = this.fieldEngine.isMorphing();
      if (this.physicsAnchorsEnabled && isMorphing) {
        this.ensurePhysicsAnchors();
        this.updatePhysicsAnchors(deltaTime, sceneTime, normalDirection);
      } else {
        this.disposeAllPhysicsAnchors();
        this.updatePhysicsDrivenCubes(deltaTime);
      }
      return;
    }

    this.cubes.forEach((cube) => {
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

      cube.currentPosition = Vector3.Lerp(cube.currentPosition, targetPosition, this.config.interactionLerpSpeed * deltaTime);
      cube.currentRotation.x = Scalar.Lerp(cube.currentRotation.x, targetRotation.x, this.config.interactionLerpSpeed * deltaTime);
      cube.currentRotation.y = Scalar.Lerp(cube.currentRotation.y, targetRotation.y, this.config.interactionLerpSpeed * deltaTime);
      cube.currentRotation.z = Scalar.Lerp(cube.currentRotation.z, targetRotation.z, this.config.interactionLerpSpeed * deltaTime);

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
        cube.physicsAggregate?.dispose();
        cube.physicsAggregate = null;
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

      cube.physicsAggregate?.dispose();
      cube.physicsAggregate = null;
      cube.physicsMotionType = PhysicsMotionType.DYNAMIC;

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

  private createPhysicsAnchor(cube: CubeCell): void {
    this.disposePhysicsAnchor(cube);
    const anchorMesh = MeshBuilder.CreateBox(`anchor_${cube.gridX}_${cube.gridZ}`, { size: this.config.cubeSize * 0.9 }, this.scene);
    anchorMesh.isPickable = false;
    anchorMesh.visibility = 0;
    anchorMesh.parent = this.root;
    anchorMesh.position.copyFrom(cube.mesh.position);

    const anchorAggregate = new PhysicsAggregate(anchorMesh, PhysicsShapeType.BOX, { mass: 0, restitution: 0, friction: 0.8 }, this.scene);
    anchorAggregate.body.setMotionType(PhysicsMotionType.ANIMATED);

    const dynamicBody = cube.physicsAggregate?.body;
    let constraint: PhysicsConstraint | null = null;
    if (dynamicBody && !dynamicBody.isDisposed) {
      constraint = new PhysicsConstraint(
        PhysicsConstraintType.BALL_AND_SOCKET,
        {
        pivotA: Vector3.Zero(),
        pivotB: Vector3.Zero(),
        collision: false,
        },
        this.scene,
      );
      anchorAggregate.body.addConstraint(dynamicBody, constraint);
    }

    cube.anchorMesh = anchorMesh;
    cube.anchorAggregate = anchorAggregate;
    cube.anchorConstraint = constraint;
  }

  private disposePhysicsAnchor(cube: CubeCell): void {
    cube.anchorConstraint?.dispose();
    cube.anchorConstraint = null;
    cube.anchorAggregate?.dispose();
    cube.anchorAggregate = null;
    cube.anchorMesh?.dispose();
    cube.anchorMesh = null;
  }

  private setCubeMotionType(cube: CubeCell, motion: PhysicsMotionType): void {
    const body = cube.physicsAggregate?.body;
    if (!body || body.isDisposed) return;
    if (cube.physicsMotionType === motion) {
      return;
    }
    body.setMotionType(motion);
    body.setLinearVelocity(Vector3.Zero());
    body.setAngularVelocity(Vector3.Zero());
    cube.physicsMotionType = motion;
  }

  public setPhysicsAnchorsEnabled(enabled: boolean): void {
    if (this.physicsAnchorsEnabled === enabled) {
      return;
    }
    this.physicsAnchorsEnabled = enabled;
    if (!enabled) {
      this.disposeAllPhysicsAnchors();
    }
  }

  private ensurePhysicsAnchors(): void {
    this.cubes.forEach((cube) => {
      if (!cube.physicsAggregate || cube.physicsAggregate.body?.isDisposed) {
        return;
      }
      if (!cube.anchorAggregate || cube.anchorAggregate.body.isDisposed) {
        this.createPhysicsAnchor(cube);
      }
    });
  }

  private disposeAllPhysicsAnchors(): void {
    this.cubes.forEach((cube) => {
      if (cube.anchorAggregate) {
        this.disposePhysicsAnchor(cube);
      }
    });
  }

  private updatePhysicsAnchors(deltaTime: number, sceneTime: number, normalDirection: number): void {
    this.cubes.forEach((cube) => {
      cube.currentPosition.copyFrom(cube.mesh.position);
      cube.currentRotation.copyFrom(cube.mesh.rotation);

      cube.individualXRotAccumulator += this.config.individualXRotSpeed * deltaTime;

      if (cube.isSelected) {
        cube.selectionProgress = Math.min(1, cube.selectionProgress + deltaTime * 3);
      } else {
        cube.selectionProgress = Math.max(0, cube.selectionProgress - deltaTime * 3);
      }

      const selectionEased = easeOutCubic(cube.selectionProgress);
      let selectedYRotation = 0;
      if (this.config.selectionSpinEnabled) {
        cube.physicsSpinAngle += this.config.selectedCubeRotation * deltaTime;
        selectedYRotation = cube.physicsSpinAngle;
      } else {
        selectedYRotation = this.config.selectedCubeRotation * selectionEased;
      }
      const selectionOffset = new Vector3(0, normalDirection * this.config.selectedCubeLift * selectionEased, 0);

      const waveRotX = this.config.waveAmplitudeRot * Math.sin(cube.basePosition.z * this.config.waveFrequencyRot + sceneTime * 1.2 + cube.wavePhase);
      const waveRotZ = this.config.waveAmplitudeRot * Math.cos(cube.basePosition.x * this.config.waveFrequencyRot + sceneTime * 1.1 + cube.wavePhase * 0.6);

      const targetPosition = cube.basePosition.clone().add(selectionOffset);
      const targetRotation = cube.baseRotation.clone();
      targetRotation.x += cube.individualXRotAccumulator + waveRotX;
      targetRotation.y += selectedYRotation;
      targetRotation.z += waveRotZ;

      cube.targetPosition.copyFrom(targetPosition);
      cube.targetRotation.copyFrom(targetRotation);

      const anchorAggregate = cube.anchorAggregate;
      const anchorMesh = cube.anchorMesh;
      if (!anchorAggregate || anchorAggregate.body.isDisposed) {
        cube.mesh.position.copyFrom(targetPosition);
        cube.mesh.rotation.copyFrom(targetRotation);
        return;
      }

      if (anchorMesh) {
        anchorMesh.position.copyFrom(targetPosition);
      }

      const anchorBody = anchorAggregate.body;
      const anchorRotation = Quaternion.FromEulerAngles(targetRotation.x, targetRotation.y, targetRotation.z);
      anchorBody.setTargetTransform(targetPosition, anchorRotation);
    });
  }

  private updatePhysicsDrivenCubes(deltaTime: number): void {
    const lerpSpeed = this.config.interactionLerpSpeed * deltaTime;
    const lift = this.config.selectedCubeLift;
    const autorotate = this.config.slowAutorotateSpeed * deltaTime;

    const rootWorld = this.root.getWorldMatrix();
    const rootWorldInverse = rootWorld.clone();
    rootWorldInverse.invert();
    let physicsUpLocal = Vector3.TransformNormal(Vector3.UpReadOnly, rootWorldInverse);
    if (!Number.isFinite(physicsUpLocal.x) || !Number.isFinite(physicsUpLocal.y) || !Number.isFinite(physicsUpLocal.z)) {
      physicsUpLocal = Vector3.Up();
    }
    physicsUpLocal.normalize();

    this.cubes.forEach((cube) => {
      if (cube.isBeingDragged) {
        cube.selectionProgress = 0;
        cube.liftAnchor = null;
        cube.physicsSpinAngle = 0;
        cube.currentPosition.copyFrom(cube.mesh.position);
        cube.currentRotation.copyFrom(cube.mesh.rotation);
        return;
      }

      if (!cube.isSelected) {
        cube.selectionProgress = 0;
        cube.liftAnchor = null;
        cube.physicsSpinAngle = 0;
        cube.currentPosition.copyFrom(cube.mesh.position);
        cube.currentRotation.copyFrom(cube.mesh.rotation);
        this.setCubeMotionType(cube, PhysicsMotionType.DYNAMIC);
        return;
      }

      cube.selectionProgress = Math.min(1, cube.selectionProgress + deltaTime * 3);
      this.setCubeMotionType(cube, PhysicsMotionType.ANIMATED);
      if (!cube.liftAnchor) {
        cube.liftAnchor = cube.mesh.position.clone();
      }

      const selectionEased = easeOutCubic(cube.selectionProgress);
      const anchor = cube.liftAnchor;
      const targetOffset = physicsUpLocal.scale(lift * selectionEased);
      const targetPosition = anchor.add(targetOffset);

      Vector3.LerpToRef(cube.currentPosition, targetPosition, lerpSpeed, cube.currentPosition);

      cube.currentRotation.x = Scalar.Lerp(cube.currentRotation.x, 0, lerpSpeed);
      cube.currentRotation.z = Scalar.Lerp(cube.currentRotation.z, 0, lerpSpeed);

      const rotationMode = this.config.physicsSelectedRotationMode ?? 'static';
      let targetYRotation = 0;
      if (rotationMode === 'animated') {
        cube.physicsSpinAngle += (this.config.physicsSelectedRotationSpeed ?? 0) * deltaTime;
        targetYRotation = cube.physicsSpinAngle * selectionEased;
      } else {
        cube.physicsSpinAngle = 0;
        targetYRotation = 0;
      }

      const newY = Scalar.Lerp(cube.currentRotation.y, targetYRotation, lerpSpeed);
      cube.currentRotation.y = this.config.slowAutorotateEnabled ? newY + autorotate : newY;

      cube.mesh.position.copyFrom(cube.currentPosition);
      cube.mesh.rotation.set(cube.currentRotation.x, cube.currentRotation.y, cube.currentRotation.z);

      const body = cube.physicsAggregate?.body;
      if (body && !body.isDisposed) {
        const targetRotationQuat = Quaternion.FromEulerAngles(
          cube.currentRotation.x,
          cube.currentRotation.y,
          cube.currentRotation.z,
        );
        body.setTargetTransform(cube.currentPosition, targetRotationQuat);
        body.setLinearVelocity(Vector3.Zero());
        body.setAngularVelocity(Vector3.Zero());
      }
    });
  }


  public beginPhysicsDrag(cell: CubeCell): void {
    if (!this.physicsActive) return;
    if (this.fieldEngine.isMorphing()) {
      this.disposePhysicsAnchor(cell);
    }
    const body = cell.physicsAggregate?.body;
    if (body && !body.isDisposed) {
      body.setMotionType(PhysicsMotionType.ANIMATED);
      body.setLinearVelocity(Vector3.Zero());
      body.setAngularVelocity(Vector3.Zero());
    }
    cell.isBeingDragged = true;
    cell.isSelected = false;
    cell.selectionProgress = 0;
    cell.liftAnchor = null;
    if (this.selection === cell) {
      this.selection = null;
    }
    cell.material.emissiveColor = Color3.Black();
  }

  public updatePhysicsDrag(cell: CubeCell, position: Vector3): void {
    if (!this.physicsActive || !cell.isBeingDragged) return;
    cell.currentPosition.copyFrom(position);
    cell.mesh.position.copyFrom(position);
    const rotationQuat = cell.mesh.rotationQuaternion ?? Quaternion.RotationYawPitchRoll(
      cell.mesh.rotation.y,
      cell.mesh.rotation.x,
      cell.mesh.rotation.z,
    );
    const body = cell.physicsAggregate?.body;
    if (body && !body.isDisposed) {
      body.setTargetTransform(position, rotationQuat);
      body.setLinearVelocity(Vector3.Zero());
      body.setAngularVelocity(Vector3.Zero());
    }
  }

  public endPhysicsDrag(cell: CubeCell): void {
    if (!this.physicsActive) return;
    cell.isBeingDragged = false;
    cell.liftAnchor = null;
    const body = cell.physicsAggregate?.body;
    if (body && !body.isDisposed) {
      body.setMotionType(PhysicsMotionType.DYNAMIC);
      body.setLinearVelocity(Vector3.Zero());
      body.setAngularVelocity(Vector3.Zero());
    }
    if (this.fieldEngine.isMorphing()) {
      this.createPhysicsAnchor(cell);
    }
  }

  public enablePhysicsDrop(): void {
    if (this.physicsActive) return;
    this.physicsActive = true;
    this.physicsAnchorsEnabled = false;
    this.outstandingAspectAdjustments.clear();
    this.selection = null;
    this.cubes.forEach((cube) => {
      cube.physicsAggregate?.dispose();
      cube.physicsAggregate = new PhysicsAggregate(
        cube.mesh,
        PhysicsShapeType.BOX,
        { mass: 1, restitution: 0.2, friction: 0.6 },
        this.scene,
      );
      cube.physicsMotionType = PhysicsMotionType.DYNAMIC;
      cube.isSelected = false;
      cube.isBeingDragged = false;
      cube.selectionProgress = 0;
      cube.physicsSpinAngle = 0;
      cube.currentPosition.copyFrom(cube.mesh.position);
      cube.currentRotation.copyFrom(cube.mesh.rotation);
      cube.liftAnchor = null;
      const body = cube.physicsAggregate.body;
      if (body && !body.isDisposed) {
        body.setMotionType(PhysicsMotionType.DYNAMIC);
        body.setLinearVelocity(Vector3.Zero());
        body.setAngularVelocity(Vector3.Zero());
      }
    });
  }

  public disablePhysicsDrop(): void {
    if (!this.physicsActive) return;
    this.physicsActive = false;
    this.physicsAnchorsEnabled = false;
    this.selection = null;
    this.outstandingAspectAdjustments.clear();
    this.cubes.forEach((cube) => {
      this.disposePhysicsAnchor(cube);
      cube.physicsAggregate?.dispose();
      cube.physicsAggregate = null;
      cube.isBeingDragged = false;
      cube.selectionProgress = 0;
      cube.liftAnchor = null;
      cube.physicsSpinAngle = 0;
      cube.currentPosition.copyFrom(cube.mesh.position);

      let localRotation: Vector3;
      if (cube.mesh.rotationQuaternion) {
        localRotation = cube.mesh.rotationQuaternion.toEulerAngles();
      } else {
        localRotation = cube.mesh.rotation.clone();
      }
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

  public isPhysicsActive(): boolean {
    return this.physicsActive;
  }
}

function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

