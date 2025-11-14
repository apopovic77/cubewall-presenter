import { Scene } from '@babylonjs/core/scene';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { CubeCell } from '../CubeField';
import type { TileDescriptor } from './TileTypes';

const SIDE_DIFFUSE_SCALE = 0.4;
const SIDE_SPECULAR = 0.05;
const FACES_PER_BOX = 6;

export class TileMaterialManager {
  private readonly scene: Scene;
  private readonly sideMaterials = new Map<number, StandardMaterial>();
  private readonly multiMaterials = new Map<number, MultiMaterial>();
  private readonly glassFrontMaterials = new Map<number, StandardMaterial>();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  public applyTileMaterials(cell: CubeCell, descriptor: TileDescriptor): void {
    const mesh = cell.mesh;
    const uniqueId = mesh.uniqueId;

    const frontMaterial = this.prepareFrontMaterial(cell, descriptor);
    const sideMaterial = this.getOrCreateSideMaterial(uniqueId, cell.tintColor);
    const multiMaterial = this.getOrCreateMultiMaterial(uniqueId, frontMaterial, sideMaterial);

    mesh.material = multiMaterial;
    this.rebuildTileSubMeshes(mesh);
  }

  public restoreCubeMaterials(cell: CubeCell): void {
    const mesh = cell.mesh;
    const uniqueId = mesh.uniqueId;

    const multi = this.multiMaterials.get(uniqueId);
    const side = this.sideMaterials.get(uniqueId);

    if (!multi && !side) {
      return;
    }

    if (side) {
      side.dispose();
      this.sideMaterials.delete(uniqueId);
    }
    const glassFront = this.glassFrontMaterials.get(uniqueId);
    if (glassFront) {
      glassFront.dispose();
      this.glassFrontMaterials.delete(uniqueId);
    }

    if (multi) {
      multi.dispose();
      this.multiMaterials.delete(uniqueId);
    }

    mesh.subMeshes?.forEach((subMesh) => subMesh.dispose());
    mesh.subMeshes = [];
    const indices = mesh.getIndices();
    if (indices) {
      SubMesh.AddToMesh(0, 0, mesh.getTotalVertices(), 0, indices.length, mesh);
    }
    mesh.material = cell.material;
  }

  public disposeForCell(cell: CubeCell): void {
    const uniqueId = cell.mesh.uniqueId;
    const side = this.sideMaterials.get(uniqueId);
    if (side) {
      side.dispose();
      this.sideMaterials.delete(uniqueId);
    }
    const multi = this.multiMaterials.get(uniqueId);
    if (multi) {
      multi.dispose();
      this.multiMaterials.delete(uniqueId);
    }
    const glassFront = this.glassFrontMaterials.get(uniqueId);
    if (glassFront) {
      glassFront.dispose();
      this.glassFrontMaterials.delete(uniqueId);
    }
  }

  private getOrCreateSideMaterial(uniqueId: number, tint: Color3): StandardMaterial {
    let material = this.sideMaterials.get(uniqueId);
    if (!material) {
      material = new StandardMaterial(`tileSide_${uniqueId}`, this.scene);
      material.diffuseTexture = null;
      material.emissiveColor = Color3.Black();
      material.specularColor = new Color3(SIDE_SPECULAR, SIDE_SPECULAR, SIDE_SPECULAR);
      material.backFaceCulling = false;
      this.sideMaterials.set(uniqueId, material);
    }
    material.diffuseColor = tint.scale(SIDE_DIFFUSE_SCALE);
    return material;
  }

  private getOrCreateMultiMaterial(uniqueId: number, frontMaterial: StandardMaterial, sideMaterial: StandardMaterial): MultiMaterial {
    let multi = this.multiMaterials.get(uniqueId);
    if (!multi) {
      multi = new MultiMaterial(`tileMulti_${uniqueId}`, this.scene);
      this.multiMaterials.set(uniqueId, multi);
    }
    multi.subMaterials = [sideMaterial, frontMaterial];
    return multi;
  }

  private prepareFrontMaterial(cell: CubeCell, descriptor: TileDescriptor): StandardMaterial {
    const mesh = cell.mesh;
    const uniqueId = mesh.uniqueId;
    const existingGlassMaterial = this.glassFrontMaterials.get(uniqueId);

    if (descriptor.kind === 'glassText' && descriptor.glass) {
      let material = existingGlassMaterial;
      if (!material) {
        material = new StandardMaterial(`tileFront_${uniqueId}`, this.scene);
        material.backFaceCulling = false;
        this.glassFrontMaterials.set(uniqueId, material);
      }
      material.diffuseTexture = descriptor.glass.texture;
      material.opacityTexture = descriptor.glass.texture;
      material.alpha = descriptor.glass.alpha;
      material.emissiveColor = descriptor.glass.tint.scale(0.25);
      material.specularColor = new Color3(0.2, 0.2, 0.2);
      material.reflectionTexture = null;
      return material;
    }

    if (existingGlassMaterial) {
      existingGlassMaterial.dispose();
      this.glassFrontMaterials.delete(uniqueId);
    }
    return cell.material;
  }

  private rebuildTileSubMeshes(mesh: CubeCell['mesh']): void {
    const indices = mesh.getIndices();
    if (!indices || indices.length === 0) {
      return;
    }
    mesh.subMeshes?.forEach((subMesh) => subMesh.dispose());
    mesh.subMeshes = [];

    const totalVertices = mesh.getTotalVertices();
    const totalIndices = indices.length;
    const verticesPerFace = Math.floor(totalVertices / FACES_PER_BOX);
    const indicesPerFace = Math.floor(totalIndices / FACES_PER_BOX);

    for (let face = 0; face < FACES_PER_BOX; face += 1) {
      const materialIndex = face === 0 || face === 1 ? 1 : 0; // front/back use textured material
      const verticesStart = face * verticesPerFace;
      const indicesStart = face * indicesPerFace;
      SubMesh.AddToMesh(materialIndex, verticesStart, verticesPerFace, indicesStart, indicesPerFace, mesh);
    }
  }
}

