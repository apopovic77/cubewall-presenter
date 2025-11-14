import type { PropsWithChildren, ReactElement } from 'react';
import { useCubeWallPreloader } from '../hooks/useCubeWallPreloader';

export function AppPreloaderWrapper({ children }: PropsWithChildren): ReactElement | null {
  const { ready, error } = useCubeWallPreloader();

  if (!ready) return null;

  console.info('[CubeWallInit] AppPreloaderWrapper releasing application render.');
  if (error) {
    console.warn('[CubeWallPresenter] Preloader encountered an error, continuing without cached textures.', error);
  }

  return <>{children}</>;
}

