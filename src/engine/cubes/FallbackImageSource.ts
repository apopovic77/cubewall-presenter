import type { CubeWallConfig } from '../../config/AppConfig';

/**
 * Placeholder images for cubes without content (demo / empty provider):
 * random picsum photos, falling back to the configured safe URLs once picsum
 * fails too often.
 */
export class FallbackImageSource {
  private readonly config: CubeWallConfig;
  private dynamicImageUrls: string[] = [];
  private picsumErrorCount = 0;
  private allowFallbackTextures = false;
  private useDynamicFallbacks = false;
  private useSafeFallbackTextures = false;

  constructor(config: CubeWallConfig) {
    this.config = config;
  }

  /** Fallbacks are used at all (otherwise cubes without an image stay plain). */
  get enabled(): boolean {
    return this.allowFallbackTextures;
  }

  /** Content options changed (setContent / constructor). */
  configure(useFallbackTextures: boolean, useDynamicFallbacks: boolean, cellCount: number): void {
    this.allowFallbackTextures = useFallbackTextures;
    this.useDynamicFallbacks = useDynamicFallbacks;
    if (!this.allowFallbackTextures || !this.useDynamicFallbacks) {
      this.dynamicImageUrls = [];
    } else if (!this.useSafeFallbackTextures) {
      this.generateDynamicImageUrls(cellCount);
    }
  }

  /** Initial state from the constructor's content options. */
  initialize(useFallbackTextures: boolean, useDynamicFallbacks: boolean): void {
    this.allowFallbackTextures = useFallbackTextures;
    this.useDynamicFallbacks = useDynamicFallbacks;
    this.useSafeFallbackTextures = useFallbackTextures;
  }

  /** The field is rebuilt with `count` cells. */
  resetForRebuild(count: number): void {
    this.useSafeFallbackTextures = this.config.useFallbackImages;
    if (this.useSafeFallbackTextures) {
      this.picsumErrorCount = 0;
    }
    this.generateDynamicImageUrls(count);
  }

  pickUrl(index: number): string {
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

  reportLoaded(): void {
    this.picsumErrorCount = 0;
  }

  /** Too many picsum failures switch to the safe URLs for good. */
  reportFailure(url: string): void {
    if (!url.includes('picsum.photos')) return;
    this.picsumErrorCount += 1;
    if (this.picsumErrorCount >= this.config.picsumErrorThreshold) {
      this.useSafeFallbackTextures = true;
      this.config.useFallbackImages = true;
      this.dynamicImageUrls = [];
    }
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
}
