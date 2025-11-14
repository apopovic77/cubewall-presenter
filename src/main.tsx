import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { AppPreloaderWrapper } from './components/AppPreloaderWrapper.tsx';
import {
  PreloaderProvider,
  PreloaderOverlay,
  type PreloaderAsset,
} from './preloader';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PreloaderProvider
      config={{
        minDisplayTime: 1000,
        showProgress: true,
        showCount: true,
        backgroundColor: '#05060b',
        textColor: '#ffffff',
        blurBackdrop: true,
        onError: (error: unknown, asset?: PreloaderAsset) => {
          console.warn('[CubeWall] Failed to preload asset', asset?.id ?? asset?.src, error);
        },
      }}
      autoStart={false}
    >
      <PreloaderOverlay message="Loading cube textures..." />
      <AppPreloaderWrapper>
        <App />
      </AppPreloaderWrapper>
    </PreloaderProvider>
  </StrictMode>,
);
