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
  private readonly captionAspects = new WeakMap<TileDescriptor, number>();
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
        // The rendered text block's aspect ratio; width / height follow from the caption settings.
        this.captionAspects.set(descriptor, built.width > 0 && built.height > 0 ? built.width / built.height : 4);
        built.depth = textDepth;
      } else {
        built.width = baseSize;
        built.height = baseSize;
        built.depth = imageDepth;
      }
    });
    this.descriptors = descriptors;
    this.groups.rebuild(descriptors);
    this.applyCaptionSettings();
    return true;
  }

  /**
   * Caption width (relative to the image tile: `text.tileWidth / image.baseWidth`,
   * so the default draws it as wide as the image), height from the text's
   * aspect ratio, glass alpha. Takes effect on the next layout / material pass.
   */
  public applyCaptionSettings(): void {
    const { text, image } = this.config.tiles;
    const width = this.config.cubeSize * (text.tileWidth / Math.max(0.01, image.baseWidth));
    const alpha = Math.min(0.95, Math.max(0.05, text.glassAlpha));
    this.descriptors.forEach((descriptor) => {
      if (descriptor.kind !== 'glassText') return;
      const aspect = this.captionAspects.get(descriptor) ?? 4;
      descriptor.footprint.width = width;
      descriptor.footprint.height = Math.max(0.05 * this.config.cubeSize, width / aspect);
      if (descriptor.glass) descriptor.glass.alpha = alpha;
    });
    this.refreshFootprints();
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
