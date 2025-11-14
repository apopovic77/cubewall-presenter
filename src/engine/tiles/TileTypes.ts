import type { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type { Color3 } from '@babylonjs/core/Maths/math.color';

export type TileKind = 'image' | 'glassText';

export interface TileFootprint {
  width: number;
  height: number;
  depth: number;
}

export interface TileStacking {
  groupId: string;
  role: 'leader' | 'follower';
  yOffset: number;
  inheritAnchorPosition: boolean;
  affectsMasonryFlow: boolean;
}

export interface GlassTileConfig {
  texture: DynamicTexture;
  tint: Color3;
  alpha: number;
}

export interface TileDescriptor {
  id: string;
  kind: TileKind;
  contentId: string;
  footprint: TileFootprint;
  stacking?: TileStacking;
  glass?: GlassTileConfig;
  metadata?: Record<string, unknown>;
}

export interface TileBuildContext {
  baseImageWidth: number;
  baseImageAspect: number;
  textTileWidth: number;
  textTileThickness: number;
  imageTileThickness: number;
  verticalGap: number;
}

