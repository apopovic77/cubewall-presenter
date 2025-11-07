import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Scalar } from '@babylonjs/core/Maths/math.scalar';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import '@babylonjs/core/Shaders/default.fragment';
import '@babylonjs/core/Shaders/default.vertex';
import { appConfig } from '../config/AppConfig';
import type { CubeWallConfig } from '../config/AppConfig';

export interface CubeSelectionInfo {
  readonly gridX: number;
  readonly gridZ: number;
  readonly color: Color3;
  readonly textureUrl: string | null;
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
}

export class CubeField {
  private readonly scene: Scene;
  private readonly config: CubeWallConfig;
  private cubes: CubeCell[] = [];
  private selection: CubeCell | null = null;
  private dynamicImageUrls: string[] = [];
  private picsumErrorCount = 0;
  private useFallbackImages: boolean;

  constructor(scene: Scene, config: CubeWallConfig = appConfig) {
    this.scene = scene;
    this.config = config;
    this.useFallbackImages = config.useFallbackImages;
    this.rebuild(config.gridSize);
  }

  public rebuild(gridSize: number): void {
    this.dispose();
    this.config.gridSize = gridSize;
    this.useFallbackImages = this.config.useFallbackImages;
    if (this.useFallbackImages) {
      this.picsumErrorCount = 0;
    }
    const offset = -((gridSize - 1) * (this.config.cubeSize + this.config.cubeSpacing)) / 2;

    if (!this.useFallbackImages) {
      this.generateDynamicImageUrls(gridSize * gridSize);
    } else {
      this.dynamicImageUrls = [];
    }

    for (let x = 0; x < gridSize; x += 1) {
      for (let z = 0; z < gridSize; z += 1) {
        const mesh = MeshBuilder.CreateBox(
          `cube_${x}_${z}`,
          { size: this.config.cubeSize },
          this.scene,
        );

        const basePosition = new Vector3(
          offset + x * (this.config.cubeSize + this.config.cubeSpacing),
          0,
          offset + z * (this.config.cubeSize + this.config.cubeSpacing),
        );
        mesh.position.copyFrom(basePosition);
        mesh.isPickable = true;
        mesh.metadata = { gridX: x, gridZ: z };

        const tintHue = (x + z) / (gridSize * 2);
        const tintColor = Color3.FromHSV(tintHue, 0.45, 1);
        const material = new StandardMaterial(`cubeMat_${x}_${z}`, this.scene);
        material.diffuseColor = tintColor.scale(0.4);
        material.emissiveColor = Color3.Black();
        material.specularColor = new Color3(0.1, 0.1, 0.1);
        material.backFaceCulling = false;
        mesh.material = material;

        const wavePhase = (x * this.config.wavePhaseSpread) + (z * this.config.wavePhaseSpread * 0.7);
        const radialDirection = new Vector3(basePosition.x, 0, basePosition.z);
        if (radialDirection.lengthSquared() > 0.0001) {
          radialDirection.normalize();
        } else {
          radialDirection.set(0, 0, 0);
        }

        const cube: CubeCell = {
          mesh,
          gridX: x,
          gridZ: z,
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
        };

        this.cubes.push(cube);

        const flatIndex = x * gridSize + z;
        const textureUrl = this.pickTextureUrl(flatIndex);
        if (textureUrl) {
          this.loadTextureForCell(cube, textureUrl);
        }
      }
    }
  }

  public dispose(): void {
    this.cubes.forEach((cell) => {
      cell.mesh.dispose(false, true);
      cell.material.dispose(false, true);
    });
    this.cubes = [];
    this.selection = null;
  }

  public getRowAnchors(): Vector3[] {
    const anchors: Vector3[] = [];
    for (let z = 0; z < this.config.gridSize; z += 1) {
      const cell = this.cubes.find((c) => c.gridZ === z && c.gridX === 0);
      if (cell) {
        anchors.push(cell.basePosition.clone());
      }
    }
    return anchors;
  }

  private generateDynamicImageUrls(count: number): void {
    this.dynamicImageUrls = [];
    const timestamp = Date.now();
    for (let i = 0; i < count; i += 1) {
      const seed = Math.floor(Math.random() * 20000) + i;
      this.dynamicImageUrls.push(`https://picsum.photos/256/256?random=${seed}&t=${timestamp + i}`);
    }
  }

  private pickTextureUrl(index: number): string {
    if (!this.useFallbackImages && this.dynamicImageUrls.length > 0) {
      return this.dynamicImageUrls[index % this.dynamicImageUrls.length];
    }
    const safe = this.config.fallbackTextureUrlsSafe.length > 0 ? this.config.fallbackTextureUrlsSafe : this.config.fallbackTextureUrls;
    if (safe.length === 0) {
      return '';
    }
    return safe[index % safe.length];
  }

  private loadTextureForCell(cell: CubeCell, url: string): void {
    if (!url) {
      cell.textureLoaded = false;
      cell.textureUrl = '';
      return;
    }

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
        this.picsumErrorCount = 0;
      },
      () => {
        texture.dispose();
        cell.textureLoaded = false;
        if (url.includes('picsum.photos')) {
          this.picsumErrorCount += 1;
          if (this.picsumErrorCount >= this.config.picsumErrorThreshold) {
            this.useFallbackImages = true;
            this.config.useFallbackImages = true;
            this.dynamicImageUrls = [];
          }
        }
        const fallbackUrl = this.pickTextureUrl(cell.gridX * this.config.gridSize + cell.gridZ);
        if (fallbackUrl && fallbackUrl !== url) {
          this.loadTextureForCell(cell, fallbackUrl);
        }
      },
    );
  }

  public getSelectionInfo(): CubeSelectionInfo | null {
    if (!this.selection) return null;
    return {
      gridX: this.selection.gridX,
      gridZ: this.selection.gridZ,
      color: this.selection.tintColor,
      textureUrl: this.selection.textureUrl || null,
    };
  }

  public getCurrentSelection(): CubeCell | null {
    return this.selection;
  }

  public getRandomCell(excludeSelected = true): CubeCell | null {
    if (this.cubes.length === 0) return null;
    if (!excludeSelected) {
      const index = Math.floor(Math.random() * this.cubes.length);
      return this.cubes[index];
    }

    const candidates = this.cubes.filter((cube) => !cube.isSelected);
    if (candidates.length === 0) {
      return this.selection ?? this.cubes[Math.floor(Math.random() * this.cubes.length)];
    }
    const index = Math.floor(Math.random() * candidates.length);
    return candidates[index];
  }

  public getCellFromMesh(mesh: AbstractMesh | null | undefined): CubeCell | null {
    if (!mesh || !mesh.metadata) return null;
    const { gridX, gridZ } = mesh.metadata as { gridX: number; gridZ: number };
    return this.cubes.find((c) => c.gridX === gridX && c.gridZ === gridZ) ?? null;
  }

  public selectCell(cell: CubeCell | null): void {
    if (this.selection === cell) return;
    if (this.selection) {
      this.selection.isSelected = false;
      this.selection.selectionProgress = Math.max(this.selection.selectionProgress, 0);
      this.selection = null;
    }
    if (cell) {
      this.selection = cell;
      this.selection.isSelected = true;
      this.selection.selectionProgress = 0;
    }
    this.cubes.forEach((cube) => {
      cube.material.emissiveColor = cube === this.selection ? this.config.tintColor.clone() : Color3.Black();
    });
  }

  public triggerRipple(center: CubeCell): void {
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
      if (cube === center || cube.isSelected) return;
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
    this.cubes.forEach((cube) => {
      cube.individualXRotAccumulator += this.config.individualXRotSpeed * deltaTime;

      if (cube.isSelected) {
        cube.selectionProgress = Math.min(1, cube.selectionProgress + deltaTime * 3);
      } else {
        cube.selectionProgress = Math.max(0, cube.selectionProgress - deltaTime * 3);
      }

      const selectionEased = easeOutCubic(cube.selectionProgress);
      const selectedYRotation = this.config.selectedCubeRotation * selectionEased;
      if (cube.isSelected && this.config.slowAutorotateEnabled) {
        cube.currentRotation.y += this.config.slowAutorotateSpeed * deltaTime;
      }
      // Pop out only upwards (Y-axis)
      const selectionOffset = new Vector3(0, this.config.selectedCubeLift * selectionEased, 0);

      const waveOffsetY = this.config.waveAmplitudeY * (
        Math.sin(cube.basePosition.x * this.config.waveFrequencyY + sceneTime + cube.wavePhase * 0.5)
        + Math.cos(cube.basePosition.z * this.config.waveFrequencyY + sceneTime * 0.7 + cube.wavePhase * 0.3)
      );
      const waveRotX = this.config.waveAmplitudeRot * Math.sin(cube.basePosition.z * this.config.waveFrequencyRot + sceneTime * 1.2 + cube.wavePhase);
      const waveRotZ = this.config.waveAmplitudeRot * Math.cos(cube.basePosition.x * this.config.waveFrequencyRot + sceneTime * 1.1 + cube.wavePhase * 0.6);

      const intendedPosition = cube.basePosition.clone().add(selectionOffset);
      intendedPosition.y += waveOffsetY;

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
}

function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}
