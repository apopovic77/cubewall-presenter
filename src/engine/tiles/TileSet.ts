import type { Scene } from '@babylonjs/core/scene';
import type { CubeWallConfig } from '../../config/AppConfig';
import type { CubeContentItem } from '../../types/content';
import { GlassTileFactory } from './GlassTileFactory';
import { TileGroups } from './TileGroups';
import type { TileDescriptor, TileFootprint } from './TileTypes';

/**
 * The tiles of tile mode (an image tile per item, optionally a glass caption
 * tile after it) with their footprints, which the masonry layout packs.
 * `footprints` are layout footprints: an image tile with a caption covers its
 * whole group (image + gap + caption), so the layout packs the pair as one.
 */
export class TileSet {
  public descriptors: TileDescriptor[] = [];
  public footprints: TileFootprint[] = [];
  public readonly groups: TileGroups;
  private readonly config: CubeWallConfig;
  private readonly factory: GlassTileFactory;
  /** AR: no glass caption tiles (one HTML-rendered texture and mesh each; too heavy for a headset). */
  private captionsSuppressed = false;

  constructor(scene: Scene, config: CubeWallConfig) {
    this.config = config;
    this.factory = new GlassTileFactory(scene);
    this.groups = new TileGroups(() => this.config.tiles.text.verticalGap);
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
      const built = descriptor.footprint;
      if (descriptor.kind === 'glassText') {
        // Drawn at the tile width: keep the rendered text block's aspect ratio.
        const aspect = built.width > 0 && built.height > 0 ? built.width / built.height : 4;
        built.height = Math.max(0.05 * baseSize, baseSize / aspect);
        built.depth = textDepth;
      } else {
        built.height = baseSize;
        built.depth = imageDepth;
      }
      built.width = baseSize;
    });
    this.descriptors = descriptors;
    this.groups.rebuild(descriptors);
    this.refreshFootprints();
    return true;
  }

  /** Image tile `index`: height from the image aspect ratio. */
  public setImageAspect(index: number, aspect: number): void {
    const descriptor = this.descriptors[index];
    if (!descriptor) return;
    descriptor.footprint.height = descriptor.footprint.width / aspect;
    this.refreshFootprint(index);
  }

  /** Layout footprints from the tile footprints (groups cover image + caption). */
  public refreshFootprints(): void {
    this.footprints = this.descriptors.map((descriptor) => ({ ...descriptor.footprint }));
    this.groups.links.forEach((link) => {
      this.footprints[link.leader].height = this.groups.groupHeight(link);
    });
  }

  private refreshFootprint(index: number): void {
    const descriptor = this.descriptors[index];
    if (!descriptor) return;
    this.footprints[index] = { ...descriptor.footprint };
    const follower = this.groups.followerOf(index);
    if (follower >= 0) this.footprints[index].height = this.groups.groupHeight({ leader: index, follower });
  }

  /** Tile mode needs a cell per tile: the smallest square grid for them (0 without tiles). */
  public requiredGridSize(max: number): number {
    if (this.config.geometryMode !== 'tile' || this.descriptors.length === 0) return 0;
    return Math.min(max, Math.ceil(Math.sqrt(this.descriptors.length)));
  }

  public clear(): void {
    this.descriptors.forEach((descriptor) => {
      if (descriptor.glass) {
        descriptor.glass.texture.dispose();
      }
    });
    this.descriptors = [];
    this.footprints = [];
    this.groups.clear();
  }

  public dispose(): void {
    this.clear();
    this.factory.dispose();
  }
}
