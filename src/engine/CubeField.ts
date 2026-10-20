import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Scalar } from '@babylonjs/core/Maths/math.scalar';
import { Color3 } from '@babylonjs/core/Maths/math.color';
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
import type { TileDescriptor, TileFootprint } from './tiles/TileTypes';
import { MasonryField } from './layouts/fields/MasonryField';
import { CubeInstanceRenderer } from './instancing/CubeInstanceRenderer';
import { FieldPhysics, type FieldPhysicsMode, type PhysicsCompanion, type PhysicsCube } from './physics/FieldPhysics';
import { ContentAssigner, type AxisValueInfo } from './content/ContentAssigner';
import { CubeTextureLoader, type CubeTextureHost } from './cubes/CubeTextureLoader';
import { FallbackImageSource } from './cubes/FallbackImageSource';
import { CubeAnimator } from './cubes/CubeAnimator';
import { CellGeometry } from './cubes/CellGeometry';
import { TileSet } from './tiles/TileSet';
import { createActivationFront } from './transition/ActivationFront';
import { isSelectableCell } from './cubes/cellUtils';
import { buildTileFaceUVs, computeFaceUVs } from './cubes/CubeFaceUvs';

/** Upper bound of the grid tile mode grows to (two cells per item with captions). */
const MAX_TILE_GRID_SIZE = 150;


export interface CubeSelectionInfo {
  readonly gridX: number;
  readonly gridZ: number;
  readonly color: Color3;
  readonly textureUrl: string | null;
  readonly content: CubeContentItem | null;
}

/** Shapes without a meaningful element order: cubes may claim any slot. */
const FREE_FORM_FIELDS = new Set(['sphere', 'spiral', 'helix', 'chaos']);

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
  /** Image tile with a caption: the caption tile, part of this cell's physics body. */
  companion?: PhysicsCompanion | null;
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

export class CubeField {
  private readonly scene: Scene;
  private readonly config: CubeWallConfig;
  private root: TransformNode;
  /** Draws the cubes in cube geometry mode; tile mode renders each mesh itself. */
  private readonly instanceRenderer: CubeInstanceRenderer;
  private cubes: CubeCell[] = [];
  private selection: CubeCell | null = null;
  private contentItems: CubeContentItem[] = [];
  /** Rigid-body simulation (drop / anchor modes); runs in field space, see FieldPhysics. */
  private readonly physics: FieldPhysics;
  private readonly scalingScratch = new Vector3();
  private readonly holdMatrix = new Matrix();
  private contentGeneration = 0;
  /** Geometry mode the instanced renderer is currently set up for. */
  private instancingMode: 'cube' | 'tile' | null = null;
  private fieldAutoRotateActive = false;
  private fieldAutoRotateSpeed = 0.25;
  private fieldAutoRotateAxis = new Vector3(0, 1, 0);
  private contentOptions: CubeContentOptions;
  private readonly contentAssigner = new ContentAssigner();
  private readonly fieldEngine: FieldLayoutEngine;
  private fieldTime = 0;
  private readonly fieldMorphDurationSeconds = 6;
  private layoutDirty = false;
  private readonly tileMaterialManager: TileMaterialManager;
  private readonly fallback: FallbackImageSource;
  private readonly textures: CubeTextureLoader;
  private readonly animator: CubeAnimator;
  private readonly tiles: TileSet;
  private readonly geometry: CellGeometry;

  private getNormalDirection(): number {
    return this.config.selectedCubeNormalDirection === -1 ? -1 : 1;
  }

  /**
   * Caption width / gap / alpha changed in the settings: resize the caption
   * tiles, re-flow the layout and, under physics, rebuild the pair bodies.
   */
  public applyCaptionSettings(): void {
    if (this.tiles.groups.links.length === 0) return;
    this.tiles.applyCaptionSettings();
    for (const link of this.tiles.groups.links) {
      const caption = this.cubes[link.follower];
      if (!caption?.tileDescriptor?.glass) continue;
      caption.material.alpha = caption.tileDescriptor.glass.alpha;
      this.applyCellGeometry(caption, null);
      this.tileMaterialManager.applyTileMaterials(caption, caption.tileDescriptor);
      // The gap changes the offset without resizing a mesh: refresh the body explicitly.
      if (this.physics.active && this.cubes[link.leader]) {
        this.updateCompanion(link.leader);
        this.physics.refreshBody(this.cubes[link.leader]);
      }
    }
    this.layoutDirty = true;
  }

  public applyGeometrySettings(): void {
    this.cubes.forEach((cell) => {
      this.applyCellGeometry(cell, cell.textureAspectRatio);
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
    this.fallback = new FallbackImageSource(config);
    this.animator = new CubeAnimator(config);
    this.root = new TransformNode('cubeFieldRoot', this.scene);
    this.root.rotationQuaternion = Quaternion.Identity();
    this.root.position.set(0, 0, 0);
    this.physics = new FieldPhysics(scene, this.root, config);
    this.instanceRenderer = new CubeInstanceRenderer(
      scene,
      config.cubeSize,
      computeFaceUVs(config.textureSidePattern, config.textureMirrorTopBottom),
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
    this.fallback.initialize(this.contentOptions.useFallbackTextures, this.contentOptions.useDynamicFallbacks);
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
    this.tiles = new TileSet(scene, config);
    this.geometry = new CellGeometry(config);
    this.tileMaterialManager = new TileMaterialManager(scene);
    this.textures = new CubeTextureLoader({
      scene,
      config,
      instanceRenderer: this.instanceRenderer,
      tileMaterialManager: this.tileMaterialManager,
      fallback: this.fallback,
      host: this.createTextureHost(),
    });
    this.updateRootTransform();
    this.rebuild(config.gridSize, this.tiles.descriptors.length || undefined);
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

  /**
   * Next shape in the morph cycle. `viewerWorld`: where the viewer is, so the
   * activation front starts on their side. A running morph is interrupted:
   * the new one starts from wherever the cubes are.
   */
  public startFieldMorph(viewerWorld: Vector3 | null = null): { current: string; next: string } | null {
    const total = this.fieldEngine.getFieldCount();
    if (total <= 1) {
      return null;
    }
    const currentIndex = this.fieldEngine.getCurrentFieldIndex();
    // The wave line (all cubes in one row, ~700 units for 625 cubes) has its own
    // action (F8); in the morph cycle it just sends everything out of view.
    const fromIndex = this.fieldEngine.isMorphing()
      ? this.fieldEngine.findFieldIndex(this.fieldEngine.getNextField().id)
      : currentIndex;
    let nextIndex = (fromIndex + 1) % total;
    if (this.fieldEngine.getFieldId(nextIndex) === 'line') nextIndex = (nextIndex + 1) % total;
    this.startTransitionTo(nextIndex, viewerWorld);
    const current = this.fieldEngine.getCurrentField().name;
    const next = this.fieldEngine.getNextField().name;
    return { current, next };
  }

  public startLineWaveField(viewerWorld: Vector3 | null = null): boolean {
    const targetIndex = this.fieldEngine.findFieldIndex('line');
    if (targetIndex < 0) {
      return false;
    }
    if (!this.fieldEngine.isMorphing() && this.fieldEngine.getCurrentFieldIndex() === targetIndex) {
      return false;
    }
    this.startTransitionTo(targetIndex, viewerWorld);
    return true;
  }

  /**
   * Transition into field `targetIndex`: cubes leave from their current pose,
   * released by the activation front; in free-form shapes they claim the
   * nearest free slot (ordered shapes keep the index order, which carries
   * meaning: rows by date, columns).
   */
  private startTransitionTo(targetIndex: number, viewerWorld: Vector3 | null): void {
    const from = this.cubes.map((cube) => cube.mesh.position.clone());
    const viewer = viewerWorld
      ? Vector3.TransformCoordinates(viewerWorld, this.root.computeWorldMatrix(true).clone().invert())
      : null;
    const front = createActivationFront(this.config.morphFront, viewer, from, this.config.morphFrontSweepSeconds);
    const targetId = this.fieldEngine.getFieldId(targetIndex) ?? '';
    this.fieldEngine.startTransition(targetIndex, this.currentFieldTime(), {
      from,
      front,
      assignSlots: FREE_FORM_FIELDS.has(targetId),
      travelSeconds: front.mode === 'none' ? this.fieldMorphDurationSeconds : this.config.morphTravelSeconds,
    });
  }

  /** The time the layout is sampled at (waves frozen when wave motion is off). */
  private currentFieldTime(): number {
    return this.config.wavePositionEnabled ? this.fieldTime : 0;
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

    this.fieldEngine.setContext({
      totalCount: this.cubes.length,
      gridSize: this.config.gridSize,
      cubeSize: this.config.cubeSize,
      cubeSpacing: this.config.cubeSpacing,
      waveAmplitudeY: this.config.waveAmplitudeY,
      waveFrequencyY: this.config.waveFrequencyY,
      wavePhaseSpread: this.config.wavePhaseSpread,
      globalScale: Math.max(0.1, this.config.fieldGlobalScale),
      tileFootprints: this.tiles.footprints,
      tileDescriptors: this.tiles.descriptors,
      masonryColumnCount: this.config.masonry.columnCount,
      masonryColumnSpacing: this.config.masonry.columnSpacing,
      masonryRowSpacing: this.config.masonry.rowSpacing,
    });

    const effectiveTime = initial ? 0 : this.currentFieldTime();
    const positions = this.fieldEngine.sampleAll(this.cubes.length, effectiveTime);
    // Image + caption pairs: placed as one around the group's slot.
    this.tiles.groups.placeInLayout(positions, (index) => this.cubes[index]?.baseRotation);
    for (let index = 0; index < this.cubes.length; index += 1) {
      const cube = this.cubes[index];
      const position = positions[index];
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

  public rebuild(requestedGridSize: number, tileCount?: number): void {
    this.disposeCubes();
    this.updateRootTransform();
    const gridSize = Math.max(requestedGridSize, this.tiles.requiredGridSize(MAX_TILE_GRID_SIZE));
    this.config.gridSize = gridSize;
    const total = tileCount ?? gridSize * gridSize;
    const spacing = this.config.cubeSize + this.config.cubeSpacing;
    const columns = Math.max(1, gridSize);
    const offset = -((columns - 1) * spacing) / 2;

    this.fallback.resetForRebuild(total);

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

      if (this.fallback.enabled) {
        const textureUrl = this.fallback.pickUrl(index);
        if (textureUrl) {
          this.textures.loadTextureForCell(cube, textureUrl);
        }
      }
    }

    // Tile mode keeps its tiles across a rebuild (e.g. a grid size change in the settings).
    if (this.tiles.requiredGridSize(MAX_TILE_GRID_SIZE) > 0) this.applyTileDescriptorsToCubes();
    this.configureInstancing();
    this.applyContentToCubes();
    this.updateFieldLayout(0, true);
    // A rebuild while physics runs keeps the mode: new cubes get bodies at their layout poses.
    if (this.physics.active) this.physics.attach(this.physicsCubes());
  }

  /**
   * The bodies of the simulation: one per cell, except caption tiles, which
   * ride as a second box on their image tile's body.
   */
  private physicsCubes(): PhysicsCube[] {
    const groups = this.tiles.groups;
    const result: PhysicsCube[] = [];
    this.cubes.forEach((cube, index) => {
      if (groups.leaderOf(index) >= 0) return;
      this.updateCompanion(index);
      result.push(cube);
    });
    return result;
  }

  /**
   * Every size / orientation change of a cell goes through here: under
   * physics, a changed size rebuilds the body of its group (with the caption box).
   */
  private applyCellGeometry(cell: CubeCell, aspect: number | null): void {
    const before = this.scalingScratch.copyFrom(cell.mesh.scaling);
    this.geometry.apply(cell, aspect);
    if (!this.physics.active || before.equalsWithEpsilon(cell.mesh.scaling, 1e-5)) return;
    const index = this.cubes.indexOf(cell);
    if (index < 0) return;
    const leader = this.tiles.groups.leaderOf(index);
    const owner = leader >= 0 ? leader : index;
    this.updateCompanion(owner);
    this.physics.refreshBody(this.cubes[owner]);
  }

  /** The caption tile riding on cell `index` (with the current tile heights), or none. */
  private updateCompanion(index: number): void {
    this.cubes[index].companion = this.tiles.groups.companionOf(index, this.cubes);
  }

  /**
   * Hands all cells to the instanced renderer with the geometry of the current
   * mode (cube faces or flat image tiles). Images are reloaded into the atlas.
   */
  private configureInstancing(): void {
    const tileMode = this.config.geometryMode === 'tile';
    this.instanceRenderer.setGeometry(
      this.config.cubeSize,
      tileMode ? buildTileFaceUVs() : computeFaceUVs(this.contentOptions.sidePattern, this.contentOptions.mirrorTopBottom),
    );
    this.instanceRenderer.setCubes(this.cubes, { cropToSquare: !tileMode });
    this.instancingMode = this.config.geometryMode;
    this.cubes.forEach((cell) => {
      if (this.isInstanced(cell)) cell.textureLoaded = false;
      else this.instanceRenderer.setDetached(cell, true);
    });
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
    this.textures.cancelPendingAspectAdjustments();
  }
  public dispose(): void {
    this.physics.dispose();
    this.disposeCubes();
    this.instanceRenderer.dispose();
    this.tiles.clear();
    this.root.dispose();
    this.tiles.dispose();
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
    this.fallback.configure(
      this.contentOptions.useFallbackTextures,
      this.contentOptions.useDynamicFallbacks,
      this.config.gridSize * this.config.gridSize,
    );
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
      this.configureInstancing();
      // New pairs and sizes: running physics gets fresh bodies.
      if (this.physics.active) this.physics.attach(this.physicsCubes());
    } else {
      this.tiles.clear();
      if (this.cubes.length !== this.config.gridSize * this.config.gridSize) {
        this.rebuild(this.config.gridSize);
      } else {
        this.cubes.forEach((cube) => {
          cube.tileDescriptor = null;
          cube.footprint = { width: 1, height: 1, depth: 1 };
          cube.mesh.setEnabled(true);
          cube.mesh.isPickable = true;
          this.applyCellGeometry(cube, null);
          this.tileMaterialManager.restoreCubeMaterials(cube);
        });
        if (this.instancingMode !== this.config.geometryMode) this.configureInstancing();
        this.layoutDirty = true;
      }
    }
    this.applyContentToCubes();
    this.textures.refreshTextureMappings();
  }

  /** False if a newer setContent started meanwhile (its result is discarded). */
  private async prepareTileDescriptors(items: CubeContentItem[], generation: number): Promise<boolean> {
    this.tiles.clear();
    if (this.config.geometryMode !== 'tile') {
      return true;
    }
    const current = await this.tiles.build(items, () => generation !== this.contentGeneration);
    if (!current) return false;
    // Every tile needs a cell (captions double the count); rebuild grows the grid.
    if (this.tiles.descriptors.length > this.cubes.length) this.rebuild(this.config.gridSize);
    this.layoutDirty = true;
    return true;
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
    const count = Math.min(this.tiles.descriptors.length, this.cubes.length);
    for (let index = 0; index < count; index += 1) {
      const descriptor = this.tiles.descriptors[index];
      const cube = this.cubes[index];
      cube.tileDescriptor = descriptor;
      cube.footprint = { ...descriptor.footprint };
      cube.mesh.isPickable = descriptor.kind === 'image';
      cube.mesh.setEnabled(true);
      this.instanceRenderer.setDetached(cube, descriptor.kind === 'glassText');
      if (descriptor.kind === 'glassText' && descriptor.glass) {
        cube.material.diffuseTexture = descriptor.glass.texture;
        cube.material.opacityTexture = descriptor.glass.texture;
        cube.material.alpha = descriptor.glass.alpha;
        cube.material.emissiveColor = descriptor.glass.tint.scale(0.2);
      }
      this.applyCellGeometry(cube, cube.textureAspectRatio);
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
    this.tiles.refreshFootprints();
    this.layoutDirty = true;
    this.switchFieldForGeometry();
  }

  public getAxisValueInfo(axis: AxisLabelAxis, index: number): AxisValueInfo | null {
    return this.contentAssigner.getAxisValueInfo(axis, index);
  }

  public getAxisValuesSnapshot(): ReturnType<ContentAssigner['getAxisValuesSnapshot']> {
    return this.contentAssigner.getAxisValuesSnapshot();
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
    return isSelectableCell(cube);
  }

  private createTextureHost(): CubeTextureHost {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const field = this;
    return {
      get contentOptions() {
        return field.contentOptions;
      },
      get selection() {
        return field.selection;
      },
      get cells() {
        return field.cubes;
      },
      isInstanced: (cell) => this.isInstanced(cell),
      applyGeometryToCell: (cell, aspect) => this.applyCellGeometry(cell, aspect),
      applyTileAspect: (cell, aspect) => this.applyTileAspect(cell, aspect),
    };
  }

  /** Cubes and image tiles are instanced; glass text tiles keep their own mesh. */
  private isInstanced(cell: CubeCell): boolean {
    return cell.tileDescriptor?.kind !== 'glassText';
  }

  /** Image tile: height from the image's aspect ratio, and the layout re-flows (masonry). */
  private applyTileAspect(cell: CubeCell, aspect: number): void {
    const descriptor = cell.tileDescriptor;
    if (!descriptor) return;
    const height = descriptor.footprint.width / aspect;
    descriptor.footprint.height = height;
    cell.footprint.height = height;
    const index = this.cubes.indexOf(cell);
    if (index >= 0) this.tiles.setImageAspect(index, aspect);
    this.applyCellGeometry(cell, aspect);
    this.layoutDirty = true;
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
    this.instanceRenderer.setGeometry(this.config.cubeSize, computeFaceUVs(sidePattern, mirrorTopBottom));
    this.textures.refreshTextureMappings();
  }

  public triggerRipple(center: CubeCell): void {
    this.animator.triggerRipple(this.cubes, center);
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
      if (this.isInstanced(this.selection)) this.textures.releaseDetailTexture(this.selection);
      this.selection.isSelected = false;
      this.selection.selectionProgress = Math.max(this.selection.selectionProgress, 0);
      this.selection = null;
    }
    if (cell) {
      this.selection = cell;
      this.selection.isSelected = true;
      this.selection.selectionProgress = 0;
      if (this.isInstanced(cell) && cell.textureLoaded) {
        this.textures.loadDetailTexture(cell);
      } else if (this.isInstanced(cell) && !cell.textureUrl) {
        this.instanceRenderer.setDetached(cell, true);
      }
    }
    this.cubes.forEach((cube) => {
      cube.material.emissiveColor = cube === this.selection ? this.config.tintColor.clone() : Color3.Black();
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
    const normalDirection = this.getNormalDirection();
    if (this.physics.active) {
      const lift = Math.min(this.config.selectedCubeLift, this.config.cubeSize * 0.6);
      this.physics.drive(deltaTime, this.fieldEngine.isMorphing(), lift);
      return;
    }
    this.animator.animate(this.cubes, deltaTime, sceneTime, normalDirection, this.tiles.groups);
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
          const fallbackUrl = this.fallback.pickUrl(index);
          if (fallbackUrl) {
            this.textures.loadTextureForCell(cube, fallbackUrl);
            return;
          }
        }
        this.textures.clearTextureForCell(cube);
      });
      return;
    }

    const items = this.contentItems;
    const assignments = this.contentAssigner.assign(items, {
      gridSize: this.config.gridSize,
      repeatContent: this.contentOptions.repeatContent,
      layout: this.contentOptions.layout,
    });
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
        textureUrl = this.fallback.pickUrl(index);
      }

      if (textureUrl) {
        this.textures.loadTextureForCell(cube, textureUrl);
        return;
      }

      this.textures.clearTextureForCell(cube);
    });
  }

  /** Starts the rigid-body simulation; false if it was switched off again while Havok loaded. */
  public async enablePhysics(mode: FieldPhysicsMode): Promise<boolean> {
    if (this.physics.active) {
      this.physics.setMode(mode);
      return true;
    }
    this.selectCell(null);
    this.textures.cancelPendingAspectAdjustments();
    this.cubes.forEach((cube) => {
      cube.selectionProgress = 0;
      cube.physicsSpinAngle = 0;
      cube.isBeingDragged = false;
    });
    return this.physics.enable(() => this.physicsCubes(), mode);
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
    this.textures.cancelPendingAspectAdjustments();
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
      this.applyCellGeometry(cube, cube.textureAspectRatio);
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

  public setTileCaptionsSuppressed(suppressed: boolean): void {
    this.tiles.setCaptionsSuppressed(suppressed);
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
