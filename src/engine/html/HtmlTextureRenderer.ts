import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

export interface HtmlTextureOptions {
  maxWidth: number;
  padding: number;
  backgroundColor?: string;
  textColor?: string;
  fontFamily?: string;
  scale?: number;
}

export interface HtmlTextureResult {
  texture: DynamicTexture;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
}

const DEFAULT_BACKGROUND = 'rgba(255,255,255,0)';
const DEFAULT_TEXT_COLOR = '#ffffff';
const DEFAULT_FONT_FAMILY = `'Inter', 'Helvetica Neue', Arial, sans-serif`;

export class HtmlTextureRenderer {
  private readonly scene: Scene;
  private readonly measureContainer: HTMLDivElement;
  private readonly styleElement: HTMLStyleElement;

  constructor(scene: Scene) {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      throw new Error('HtmlTextureRenderer requires a browser environment.');
    }
    this.scene = scene;
    this.measureContainer = document.createElement('div');
    this.measureContainer.style.cssText = [
      'position:absolute',
      'top:-10000px',
      'left:-10000px',
      'visibility:hidden',
      'pointer-events:none',
      'z-index:-1',
    ].join(';');
    this.styleElement = document.createElement('style');
    this.styleElement.textContent = `
      .cw-html-texture {
        display:flex;
        flex-direction:column;
        gap:8px;
        box-sizing:border-box;
        font-family:${DEFAULT_FONT_FAMILY};
        color:${DEFAULT_TEXT_COLOR};
      }
      .cw-html-texture__headline {
        font-size:28px;
        line-height:1.2;
        font-weight:700;
      }
      .cw-html-texture__subheadline {
        font-size:18px;
        line-height:1.4;
        font-weight:500;
        opacity:0.85;
      }
      .cw-html-texture__meta {
        display:flex;
        gap:16px;
        font-size:14px;
        opacity:0.65;
        text-transform:uppercase;
        letter-spacing:0.1em;
      }
    `;
    document.head.appendChild(this.styleElement);
    document.body.appendChild(this.measureContainer);
  }

  public async render(html: string, options: HtmlTextureOptions): Promise<HtmlTextureResult> {
    const scale = options.scale ?? window.devicePixelRatio ?? 1;
    const padding = options.padding ?? 24;
    const backgroundColor = options.backgroundColor ?? DEFAULT_BACKGROUND;
    const fontFamily = options.fontFamily ?? DEFAULT_FONT_FAMILY;

    const measured = this.measureHtml(html, options.maxWidth, padding, fontFamily);
    const baseWidth = Math.max(1, measured.width);
    const baseHeight = Math.max(1, measured.height);
    const width = Math.max(1, Math.ceil(baseWidth * scale));
    const height = Math.max(1, Math.ceil(baseHeight * scale));

    const svgMarkup = this.createSvgMarkup(html, baseWidth, baseHeight, padding, backgroundColor, fontFamily);
    const image = await this.svgToImage(svgMarkup, width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to obtain canvas rendering context.');
    }
    try {
      ctx.drawImage(image, 0, 0, width, height);
    } catch (error) {
      canvas.width = canvas.height = 0;
      URL.revokeObjectURL(image.src);
      throw error instanceof Error ? error : new Error('Failed to draw SVG onto canvas.');
    }

    const texture = new DynamicTexture(
      `cwHtmlTexture_${Date.now()}`,
      { width, height },
      this.scene,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    texture.hasAlpha = true;
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    try {
      const textureContext = texture.getContext();
      textureContext.drawImage(canvas, 0, 0, width, height);
      texture.update(false, true);
    } catch (error) {
      texture.dispose();
      canvas.width = canvas.height = 0;
      if (error instanceof DOMException && error.name === 'SecurityError') {
        throw new Error(
          'HTML texture upload blocked by browser security policy (canvas is tainted by cross-origin content).',
        );
      }
      throw error;
    }

    return {
      texture,
      width,
      height,
      canvas,
    };
  }

  private measureHtml(html: string, maxWidth: number, padding: number, fontFamily: string): { width: number; height: number } {
    const wrapper = document.createElement('div');
    wrapper.className = 'cw-html-texture';
    wrapper.style.fontFamily = fontFamily;
    wrapper.style.width = `${maxWidth}px`;
    wrapper.style.padding = `${padding}px`;
    wrapper.innerHTML = html;
    this.measureContainer.innerHTML = '';
    this.measureContainer.appendChild(wrapper);
    const rect = wrapper.getBoundingClientRect();
    this.measureContainer.innerHTML = '';
    return {
      width: Math.ceil(rect.width),
      height: Math.ceil(rect.height),
    };
  }

  private createSvgMarkup(html: string, width: number, height: number, padding: number, background: string, fontFamily: string): string {
    const escapedHtml = html.replace(/xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <foreignObject width="100%" height="100%">
          <div xmlns="http://www.w3.org/1999/xhtml"
               style="
                 width:${width}px;
                 height:${height}px;
                 box-sizing:border-box;
                 padding:${padding}px;
                 background:${background};
                 color:${DEFAULT_TEXT_COLOR};
                 font-family:${fontFamily};
               ">
            <div class="cw-html-texture">
              ${escapedHtml}
            </div>
          </div>
        </foreignObject>
      </svg>
    `;
  }

  private svgToImage(svgMarkup: string, width: number, height: number): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = (error) => {
        URL.revokeObjectURL(url);
        reject(error instanceof Error ? error : new Error('Failed to load SVG image.'));
      };
      image.width = width;
      image.height = height;
      image.src = url;
    });
  }

  public dispose(): void {
    if (typeof document !== 'undefined') {
      this.measureContainer.remove();
      this.styleElement.remove();
    }
  }
}

