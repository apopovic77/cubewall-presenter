import { Color3 } from '@babylonjs/core/Maths/math.color';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';
import { HtmlTextureRenderer } from '../html/HtmlTextureRenderer';
import type { CubeContentItem } from '../../types/content';
import { appConfig } from '../../config/AppConfig';
import type { TileDescriptor, TileFootprint, TileBuildContext } from './TileTypes';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeText(html: string | null | undefined): string {
  if (!html) {
    return '';
  }
  const container = document.createElement('div');
  container.innerHTML = html;
  const textContent = container.textContent ?? '';
  return textContent.replace(/\s+/g, ' ').trim();
}

export class GlassTileFactory {
  private readonly scene: Scene;
  private readonly htmlRenderer: HtmlTextureRenderer;
  private htmlSvgBlocked = false;
  private svgWarningLogged = false;

  constructor(scene: Scene) {
    this.scene = scene;
    this.htmlRenderer = new HtmlTextureRenderer(scene);
  }

  public async buildDescriptors(
    items: CubeContentItem[],
    options?: { includeCaptions?: boolean },
  ): Promise<TileDescriptor[]> {
    const includeCaptions = options?.includeCaptions ?? true;
    const buildContext = this.getBuildContext();
    const descriptors: TileDescriptor[] = [];

    for (const item of items) {
      const imageDescriptor = this.createImageDescriptor(item, buildContext);
      descriptors.push(imageDescriptor);

      if (includeCaptions) {
        const textDescriptor = await this.createGlassDescriptor(item, imageDescriptor.footprint.height, buildContext);
        if (textDescriptor) {
          descriptors.push(textDescriptor);
        }
      }
    }

    return descriptors;
  }

  private getBuildContext(): TileBuildContext {
    const { tiles } = appConfig;
    return {
      baseImageWidth: tiles.image.baseWidth,
      baseImageAspect: tiles.image.defaultAspect,
      textTileWidth: tiles.text.tileWidth,
      textTileThickness: tiles.text.thickness,
      imageTileThickness: tiles.image.thickness,
      verticalGap: tiles.text.verticalGap,
    };
  }

  private createImageDescriptor(item: CubeContentItem, context: TileBuildContext): TileDescriptor {
    const footprint: TileFootprint = {
      width: context.baseImageWidth,
      depth: context.imageTileThickness,
      height: context.baseImageWidth / context.baseImageAspect,
    };

    return {
      id: `${item.id}:image`,
      kind: 'image',
      contentId: item.id,
      footprint,
      stacking: {
        groupId: item.id,
        role: 'leader',
        yOffset: 0,
        inheritAnchorPosition: false,
        affectsMasonryFlow: true,
      },
      metadata: {
        type: 'imageTile',
      },
    };
  }

  private async createGlassDescriptor(item: CubeContentItem, imageHeight: number, context: TileBuildContext): Promise<TileDescriptor | null> {
    const textContent = this.composeContent(item);
    if (!textContent.html) {
      return null;
    }

    const textConfig = appConfig.tiles.text;
    let renderResult: Awaited<ReturnType<HtmlTextureRenderer['render']>> | null = null;
    if (!this.htmlSvgBlocked) {
      try {
        renderResult = await this.htmlRenderer.render(textContent.html, {
          maxWidth: textConfig.maxRenderWidth,
          padding: textConfig.padding,
          backgroundColor: 'rgba(15,18,26,0)',
          textColor: '#ffffff',
        });
      } catch (error) {
        const disableSvg = this.shouldDisableSvgRendering(error);
        if (disableSvg) {
          this.htmlSvgBlocked = true;
          if (!this.svgWarningLogged) {
            console.warn(
              '[GlassTileFactory] Browser refused SVG-based HTML textures once; falling back to safe canvas rendering for all tiles.',
              error,
            );
            this.svgWarningLogged = true;
          }
        } else {
          console.warn('[GlassTileFactory] Failed to render HTML texture for tile', { id: item.id, error });
        }
      }
    }

    if (!renderResult) {
      const fallback = this.createFallbackTextDescriptor(item, imageHeight, context, textContent);
      if (!fallback) {
        return null;
      }
      return fallback;
    }

    const aspect = renderResult.width > 0 ? renderResult.width / renderResult.height : 1;
    const width = context.textTileWidth;
    const height = width / aspect;
    const depth = context.textTileThickness;
    const gap = context.verticalGap;

    const footprint: TileFootprint = {
      width,
      depth,
      height,
    };

    const tint = Color3.FromHexString(textConfig.glassTintHex);
    const alpha = clamp(textConfig.glassAlpha, 0.05, 0.95);

    return {
      id: `${item.id}:text`,
      kind: 'glassText',
      contentId: item.id,
      footprint,
      glass: {
        texture: renderResult.texture,
        tint,
        alpha,
      },
      stacking: {
        groupId: item.id,
        role: 'follower',
        yOffset: -(imageHeight / 2 + gap + height / 2),
        inheritAnchorPosition: true,
        affectsMasonryFlow: false,
      },
      metadata: {
        type: 'textTile',
        htmlWidth: renderResult.width,
        htmlHeight: renderResult.height,
        fallback: false,
      },
    };
  }

  private composeContent(item: CubeContentItem): {
    html: string;
    meta: string | null;
    headline: string | null;
    summary: string | null;
  } {
    const headlineRaw = sanitizeText(item.title?.trim());
    const summaryRaw = sanitizeText(item.summary?.trim());
    const metaPartsRaw: string[] = [];
    if (item.sourceName) metaPartsRaw.push(sanitizeText(item.sourceName));
    if (item.category) metaPartsRaw.push(sanitizeText(item.category));
    if (item.publishedAt) metaPartsRaw.push(new Date(item.publishedAt).toLocaleDateString());

    if (!headlineRaw && !summaryRaw && metaPartsRaw.length === 0) {
      return {
        html: '',
        meta: null,
        headline: null,
        summary: null,
      };
    }

    const metaEscaped = metaPartsRaw.map(escapeHtml);
    const headlineEscaped = headlineRaw ? escapeHtml(headlineRaw) : null;
    const summaryEscaped = summaryRaw ? escapeHtml(summaryRaw) : null;

    const metaHtml = metaEscaped.length
      ? `<div class="cw-html-texture__meta">${metaEscaped.map((part) => `<span>${part}</span>`).join('')}</div>`
      : '';
    const headlineHtml = headlineEscaped ? `<div class="cw-html-texture__headline">${headlineEscaped}</div>` : '';
    const subHtml = summaryEscaped ? `<div class="cw-html-texture__subheadline">${summaryEscaped}</div>` : '';

    return {
      html: `${metaHtml}${headlineHtml}${subHtml}`,
      meta: metaPartsRaw.length ? metaPartsRaw.join(' • ') : null,
      headline: headlineRaw || null,
      summary: summaryRaw || null,
    };
  }

  private createFallbackTextDescriptor(
    item: CubeContentItem,
    imageHeight: number,
    context: TileBuildContext,
    content: { meta: string | null; headline: string | null; summary: string | null },
  ): TileDescriptor | null {
    const lines: Array<{ text: string; font: string; color: string }> = [];
    if (content.meta) {
      lines.push({
        text: content.meta,
        font: '600 32px "Inter", "Segoe UI", sans-serif',
        color: 'rgba(200,210,255,0.75)',
      });
    }
    if (content.headline) {
      lines.push({
        text: content.headline,
        font: '700 54px "Inter", "Segoe UI", sans-serif',
        color: '#ffffff',
      });
    }
    if (content.summary) {
      lines.push({
        text: content.summary,
        font: '400 40px "Inter", "Segoe UI", sans-serif',
        color: 'rgba(235,240,255,0.88)',
      });
    }
    if (lines.length === 0) {
      return null;
    }

    const pixelWidth = 768;
    const padding = 48;
    const availableWidth = pixelWidth - padding * 2;

    const wrappedLines: Array<{ text: string; font: string; color: string; lineHeight: number }> = [];
    const scratchCanvas = document.createElement('canvas');
    const ctx = scratchCanvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    const wrapText = (text: string, font: string, color: string) => {
      ctx.font = font;
      const baseSizeMatch = font.match(/(\d+)px/);
      const baseSize = baseSizeMatch ? Number.parseInt(baseSizeMatch[1] ?? '32', 10) : 32;
      const lineHeight = baseSize * 1.25;
      const words = text.split(/\s+/);
      let current = '';
      for (const word of words) {
        const tentative = current ? `${current} ${word}` : word;
        const metrics = ctx.measureText(tentative);
        if (metrics.width <= availableWidth || !current) {
          current = tentative;
        } else {
          wrappedLines.push({ text: current, font, color, lineHeight });
          current = word;
        }
      }
      if (current) {
        wrappedLines.push({ text: current, font, color, lineHeight });
      }
    };

    lines.forEach(({ text, font, color }) => wrapText(text, font, color));

    const totalHeight = Math.max(
      1,
      Math.ceil(padding * 2 + wrappedLines.reduce((sum, line) => sum + line.lineHeight, 0)),
    );

    const texture = new DynamicTexture(
      `cwHtmlFallback_${item.id}_${Date.now()}`,
      { width: pixelWidth, height: totalHeight },
      this.scene,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    texture.hasAlpha = true;
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;

    const textureCtx = texture.getContext();
    textureCtx.clearRect(0, 0, pixelWidth, totalHeight);
    textureCtx.fillStyle = 'rgba(15,18,28,0.75)';
    textureCtx.fillRect(0, 0, pixelWidth, totalHeight);

    let y = padding;
    wrappedLines.forEach((line) => {
      textureCtx.font = line.font;
      textureCtx.fillStyle = line.color;
      textureCtx.fillText(line.text, padding, y + line.lineHeight * 0.8);
      y += line.lineHeight;
    });
    texture.update(false, true);

    const aspect = pixelWidth / totalHeight;
    const width = context.textTileWidth;
    const height = width / aspect;
    const depth = context.textTileThickness;
    const gap = context.verticalGap;

    const footprint: TileFootprint = {
      width,
      depth,
      height,
    };

    const tint = Color3.FromHexString(appConfig.tiles.text.glassTintHex);
    const alpha = clamp(appConfig.tiles.text.glassAlpha, 0.05, 0.95);

    return {
      id: `${item.id}:text`,
      kind: 'glassText',
      contentId: item.id,
      footprint,
      glass: {
        texture,
        tint,
        alpha,
      },
      stacking: {
        groupId: item.id,
        role: 'follower',
        yOffset: -(imageHeight / 2 + gap + height / 2),
        inheritAnchorPosition: true,
        affectsMasonryFlow: false,
      },
      metadata: {
        type: 'textTile',
        htmlWidth: pixelWidth,
        htmlHeight: totalHeight,
        fallback: true,
      },
    };
  }

  private shouldDisableSvgRendering(error: unknown): boolean {
    if (!error) return false;
    if (error instanceof DOMException && error.name === 'SecurityError') {
      return true;
    }
    if (error instanceof Error) {
      return /security/i.test(error.message) || /tainted/i.test(error.message);
    }
    return false;
  }

  public dispose(): void {
    this.htmlRenderer.dispose();
  }
}

