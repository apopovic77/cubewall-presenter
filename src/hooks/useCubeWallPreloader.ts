import { useEffect, useMemo, useRef, useState } from 'react';
import { usePreloader } from '../preloader';
import { appConfig, type CubeLayoutConfig } from '../config/AppConfig';
import { loadCubeContent, resolveContentProviderId } from '../content/registry';
import type { CubeContentItem } from '../types/content';

interface PreloadResult {
  items: CubeContentItem[];
  layout: Partial<CubeLayoutConfig> | null;
  fetchedAt: string;
}

declare global {
  interface Window {
    __cubewallPreload?: PreloadResult;
  }
}

export interface CubeWallPreloaderState {
  ready: boolean;
  error: Error | null;
}

export function useCubeWallPreloader(): CubeWallPreloaderState {
  const { state, registerAssets, startLoading } = usePreloader();
  const [error, setError] = useState<Error | null>(null);
  const [ready, setReady] = useState<boolean>(() => Boolean(window.__cubewallPreload));
  const providerId = useMemo(() => resolveContentProviderId(), []);

  const registerAssetsRef = useRef(registerAssets);
  const startLoadingRef = useRef(startLoading);
  const fetchPromiseRef = useRef<Promise<PreloadResult> | null>(null);
  const processedRef = useRef(false);

  useEffect(() => {
    registerAssetsRef.current = registerAssets;
    startLoadingRef.current = startLoading;
  }, [registerAssets, startLoading]);

  useEffect(() => {
    if (ready) {
      return;
    }

    if (!fetchPromiseRef.current) {
      fetchPromiseRef.current = (async () => {
        console.info('[CubeWallInit] useCubeWallPreloader fetching content …');
        const payload = await loadCubeContent(providerId);
        return {
          items: payload.items,
          layout: payload.layout ?? null,
          fetchedAt: new Date().toISOString(),
        };
      })();
    }

    let disposed = false;

    fetchPromiseRef.current
      .then(async (payload) => {
        if (disposed || processedRef.current) {
          return;
        }
        processedRef.current = true;

        console.info(
          `[CubeWallPreloader] Provider "${providerId}" lieferte ${payload.items.length} Einträge.`,
        );

        const assetUrls = new Set<string>();
        payload.items.forEach((item) => {
          const url = item.imageUrl?.trim();
          if (url) {
            assetUrls.add(url);
          }
        });
        if (appConfig.useFallbackImages) {
          appConfig.fallbackTextureUrls.forEach((src) => assetUrls.add(src));
          appConfig.fallbackTextureUrlsSafe.forEach((src) => assetUrls.add(src));
        }

        const missingImages = payload.items.filter((item) => !item.imageUrl);
        if (missingImages.length > 0) {
          console.warn(
            `[CubeWallPreloader] ${missingImages.length} Items ohne Bild-URL. Beispiel(e):`,
            missingImages.slice(0, 5).map(({ id, title }) => ({ id, title })),
          );
        }

        console.info(
          `[CubeWallPreloader] Registriere ${assetUrls.size} Texture-Asset(s).`,
        );

        if (assetUrls.size > 0) {
          registerAssetsRef.current(
            Array.from(assetUrls).map((src, index) => ({
              id: `cubewall-preload-${index}`,
              type: 'image' as const,
              src,
              priority: index < 24 ? 100 - index : 10,
            })),
          );
          console.info('[CubeWallPreloader] Starte Asset-Loading …');
          await startLoadingRef.current();
          if (disposed) return;
        }

        window.__cubewallPreload = payload;
        setReady(true);
        console.info('[CubeWallInit] useCubeWallPreloader completed.', {
          items: payload.items.length,
        });
      })
      .catch((err) => {
        if (disposed) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setReady(true);
      });

    return () => {
      disposed = true;
    };
  }, [providerId, ready]);

  useEffect(() => {
    if (!ready && state.progress >= 100) {
      setReady(Boolean(window.__cubewallPreload));
    }
  }, [ready, state.progress]);

  return { ready, error };
}

