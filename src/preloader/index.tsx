import type { PropsWithChildren, ReactNode } from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

type PreloaderAssetType = 'image';

export interface PreloaderAsset {
  id: string;
  src: string;
  type: PreloaderAssetType;
  priority?: number;
}

export interface PreloaderState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  total: number;
  loaded: number;
  progress: number;
  error: Error | null;
}

export interface PreloaderConfig {
  minDisplayTime?: number;
  showProgress?: boolean;
  showCount?: boolean;
  backgroundColor?: string;
  textColor?: string;
  blurBackdrop?: boolean;
  onError?: (error: unknown, asset?: PreloaderAsset) => void;
}

const DEFAULT_CONFIG: Required<Omit<PreloaderConfig, 'onError'>> = {
  minDisplayTime: 0,
  showProgress: true,
  showCount: true,
  backgroundColor: '#05060b',
  textColor: '#ffffff',
  blurBackdrop: false,
};

interface PreloaderContextValue {
  state: PreloaderState;
  registerAssets: (assets: PreloaderAsset[]) => void;
  startLoading: () => Promise<void>;
  config: Required<Omit<PreloaderConfig, 'onError'>>;
  onError?: (error: unknown, asset?: PreloaderAsset) => void;
}

const PreloaderContext = createContext<PreloaderContextValue | null>(null);

function createInitialState(): PreloaderState {
  return {
    status: 'idle',
    total: 0,
    loaded: 0,
    progress: 0,
    error: null,
  };
}

interface PreloaderProviderProps extends PropsWithChildren {
  config?: PreloaderConfig;
  autoStart?: boolean;
}

export function PreloaderProvider({
  children,
  config,
  autoStart = false,
}: PreloaderProviderProps): ReactNode {
  const mergedConfig = useMemo(() => {
    return {
      ...DEFAULT_CONFIG,
      ...config,
    };
  }, [config]);

  const onError = config?.onError;

  const assetsRef = useRef<Map<string, PreloaderAsset>>(new Map());
  const loadPromiseRef = useRef<Promise<void> | null>(null);
  const [state, setState] = useState<PreloaderState>(() => createInitialState());

  const registerAssets = useCallback((assets: PreloaderAsset[]) => {
    if (!assets || assets.length === 0) return;
    const map = assetsRef.current;
    assets.forEach((asset) => {
      if (asset && asset.id && asset.src) {
        map.set(asset.id, asset);
      }
    });
    setState((prev) => {
      const total = map.size;
      const loaded = prev.loaded > total ? total : prev.loaded;
      const progress = total > 0 ? Math.round((loaded / total) * 100) : 0;
      return {
        ...prev,
        total,
        loaded,
        progress,
      };
    });
  }, []);

  const loadAsset = useCallback(
    (asset: PreloaderAsset) =>
      new Promise<void>((resolve) => {
        if (asset.type === 'image') {
          const image = new Image();
          const handleSuccess = () => {
            image.removeEventListener('load', handleSuccess);
            image.removeEventListener('error', handleError);
            resolve();
          };
          const handleError = (event: Event | string) => {
            image.removeEventListener('load', handleSuccess);
            image.removeEventListener('error', handleError);
            onError?.(event || new Error(`Failed to load asset ${asset.src}`), asset);
            resolve();
          };
          image.addEventListener('load', handleSuccess);
          image.addEventListener('error', handleError);
          image.src = asset.src;
          return;
        }
        resolve();
      }),
    [onError],
  );

  const startLoading = useCallback(() => {
    if (loadPromiseRef.current) {
      return loadPromiseRef.current;
    }

    const promise = (async () => {
      const startTimestamp = performance.now();
      const assets = Array.from(assetsRef.current.values()).sort((a, b) => {
        const priorityA = a.priority ?? 0;
        const priorityB = b.priority ?? 0;
        return priorityB - priorityA;
      });

      if (assets.length === 0) {
        setState((prev) => ({
          ...prev,
          status: 'ready',
          progress: 100,
          loaded: prev.total,
        }));
        return;
      }

      setState((prev) => ({
        ...prev,
        status: 'loading',
        total: assets.length,
        loaded: 0,
        progress: 0,
        error: null,
      }));

      let loadedCount = 0;
      const updateProgress = () => {
        loadedCount += 1;
        setState((prev) => {
          const progress = Math.round((loadedCount / assets.length) * 100);
          return {
            ...prev,
            loaded: loadedCount,
            progress,
          };
        });
      };

      await Promise.all(
        assets.map(async (asset) => {
          await loadAsset(asset);
          updateProgress();
        }),
      );

      const elapsed = performance.now() - startTimestamp;
      const delay = Math.max(mergedConfig.minDisplayTime - elapsed, 0);
      if (delay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }

      setState((prev) => ({
        ...prev,
        status: prev.error ? 'error' : 'ready',
        progress: 100,
      }));
    })();

    loadPromiseRef.current = promise.finally(() => {
      loadPromiseRef.current = null;
    });

    return loadPromiseRef.current;
  }, [loadAsset, mergedConfig.minDisplayTime]);

  useEffect(() => {
    if (autoStart) {
      startLoading().catch((error) => {
        onError?.(error);
        setState((prev) => ({
          ...prev,
          status: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
        }));
      });
    }
  }, [autoStart, onError, startLoading]);

  const contextValue = useMemo<PreloaderContextValue>(
    () => ({
      state,
      registerAssets,
      startLoading,
      config: mergedConfig,
      onError,
    }),
    [mergedConfig, onError, registerAssets, startLoading, state],
  );

  return <PreloaderContext.Provider value={contextValue}>{children}</PreloaderContext.Provider>;
}

export function usePreloader(): PreloaderContextValue {
  const ctx = useContext(PreloaderContext);
  if (!ctx) {
    throw new Error('usePreloader must be used within a PreloaderProvider.');
  }
  return ctx;
}

interface PreloaderOverlayProps {
  message?: string;
  children?: ReactNode;
}

export function PreloaderOverlay({ message, children }: PreloaderOverlayProps): ReactNode {
  const { state, config } = usePreloader();

  const shouldRender = state.status === 'loading' || state.status === 'idle';
  if (!shouldRender) {
    return null;
  }

  const progressText = config.showProgress ? `${state.progress}%` : null;
  const countText =
    config.showCount && state.total > 0 ? `${state.loaded}/${state.total}` : null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: config.blurBackdrop ? `${config.backgroundColor}cc` : config.backgroundColor,
        backdropFilter: config.blurBackdrop ? 'blur(8px)' : undefined,
        color: config.textColor,
        zIndex: 9999,
        gap: '0.75rem',
        fontFamily: 'inherit',
        letterSpacing: '0.02em',
      }}
    >
      {message ? <div style={{ fontSize: '1rem', opacity: 0.8 }}>{message}</div> : null}
      {children}
      {(progressText || countText) && (
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline' }}>
          {progressText ? <span style={{ fontSize: '1.5rem' }}>{progressText}</span> : null}
          {countText ? <span style={{ opacity: 0.7, fontSize: '0.9rem' }}>{countText}</span> : null}
        </div>
      )}
    </div>
  );
}

