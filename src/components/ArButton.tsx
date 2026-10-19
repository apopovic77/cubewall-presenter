import { useEffect, useState } from 'react';
import { CubeWallPresenter } from '../engine/CubeWallPresenter';

interface ArButtonProps {
  getPresenter: () => CubeWallPresenter | null;
}

/**
 * "View in AR" for headsets with an immersive-AR browser (e.g. Meta Quest).
 * Renders nothing where the browser cannot start an AR session.
 */
export function ArButton({ getPresenter }: ArButtonProps) {
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void CubeWallPresenter.isArSupported().then((result) => {
      if (cancelled || !result) return;
      setSupported(true);
      getPresenter()
        ?.prepareAr()
        .catch((reason: unknown) => console.warn('[AR] Failed to prepare XR', reason));
    });
    return () => {
      cancelled = true;
    };
  }, [getPresenter]);

  if (!supported) return null;

  const handleClick = () => {
    const presenter = getPresenter();
    if (!presenter) return;
    setError(null);
    presenter.enterAr().catch((reason: unknown) => {
      console.warn('[AR] Failed to start session', reason);
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };

  return (
    <div
      style={{
        position: 'fixed',
        left: 24,
        bottom: 24,
        zIndex: 30,
        fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
      }}
    >
      <button
        type="button"
        onClick={handleClick}
        style={{
          padding: '16px 28px',
          borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.18)',
          background: 'rgba(10, 12, 22, 0.82)',
          color: '#f3f5ff',
          fontSize: 18,
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: '0 18px 36px rgba(3, 8, 20, 0.35)',
        }}
      >
        In AR ansehen
      </button>
      {error && (
        <div style={{ marginTop: 8, color: '#fca5a5', fontSize: 13, maxWidth: 320 }}>AR nicht gestartet: {error}</div>
      )}
    </div>
  );
}
