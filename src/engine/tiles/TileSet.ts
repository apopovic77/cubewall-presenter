import type { Scene } from '@babylonjs/core/scene';
import type { CubeWallConfig } from '../../config/AppConfig';
import type { CubeContentItem } from '../../types/content';
import { GlassTileFactory } from './GlassTileFactory';
import type { TileDescriptor, TileFootprint } from './TileTypes';

/**
 * The tiles of tile mode (an image tile per item, optionally a glass caption
 * tile after it) with their footprints, which the masonry layout packs.
 */
export class TileSet {
  public descriptors: TileDescriptor[] = [];
  public footprints: TileFootprint[] = [];
  private readonly config: CubeWallConfig;
  private readonly factory: GlassTileFactory;
  /** AR: no glass caption tiles (one HTML-rendered texture and mesh each; too heavy for a headset). */
  private captionsSuppressed = false;

  constructor(scene: Scene, config: CubeWallConfig) {
    this.config = config;
    this.factory = new GlassTileFactory(scene);
  }

  public setCaptionsSuppressed(suppressed: boolean): void {
    this.captionsSuppressed = suppressed;
  }

  /** Builds the tiles for these items; false (and nothing kept) if `isStale` turned true meanwhile. */
  public async build(items: CubeContentItem[], isStale: () => boolean): Promise<boolean> {
    this.clear();
    const descriptors = await this.factory.buildDescriptors(items, {
      includeCaptions: this.config.tiles.captionsEnabled && !this.captionsSuppressed,
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
    this.descriptors = descriptors;
    this.footprints = descriptors.map((descriptor) => ({ ...descriptor.footprint }));
    return true;
  }

  /** Image tile `index`: height from the image aspect ratio. */
  public setImageAspect(index: number, aspect: number): void {
    const descriptor = this.descriptors[index];
    if (!descriptor) return;
    descriptor.footprint.height = descriptor.footprint.width / aspect;
    this.footprints[index] = { ...descriptor.footprint };
  }

  public clear(): void {
    this.descriptors.forEach((descriptor) => {
      if (descriptor.glass) {
        descriptor.glass.texture.dispose();
      }
    });
    this.descriptors = [];
    this.footprints = [];
  }

  public dispose(): void {
    this.clear();
    this.factory.dispose();
  }
}
