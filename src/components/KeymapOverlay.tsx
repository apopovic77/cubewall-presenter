import type { CSSProperties } from 'react';

interface KeymapOverlayProps {
  geometryMode: 'cube' | 'tile';
  wavePositionEnabled: boolean;
  waveRotationEnabled: boolean;
  layoutMode: string;
  physicsActive: boolean;
}

export function KeymapOverlay({
  geometryMode,
  wavePositionEnabled,
  waveRotationEnabled,
  layoutMode,
  physicsActive,
}: KeymapOverlayProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        padding: '12px 16px',
        borderRadius: 12,
        background: 'rgba(10, 12, 22, 0.78)',
        backdropFilter: 'blur(12px)',
        color: '#f3f5ff',
        fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        fontSize: 13,
        lineHeight: 1.5,
        zIndex: 20,
        boxShadow: '0 18px 36px rgba(3, 8, 20, 0.35)',
        pointerEvents: 'none',
        maxWidth: 260,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 13, letterSpacing: 0.3, marginBottom: 6 }}>
        Keymap · Dev Helper
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        <li>
          <kbd style={kbdStyles}>1</kbd> Geometry toggle{' '}
          <strong>{geometryMode === 'tile' ? 'Tiles' : 'Cubes'}</strong>
        </li>
        <li>
          <kbd style={kbdStyles}>2</kbd> Wave motion{' '}
          <strong>{wavePositionEnabled ? 'On' : 'Off'}</strong>
        </li>
        <li>
          <kbd style={kbdStyles}>3</kbd> Wave rotation{' '}
          <strong>{waveRotationEnabled ? 'On' : 'Off'}</strong>
        </li>
        <li>
          <kbd style={kbdStyles}>4</kbd> Layout → <strong>Matrix</strong>
        </li>
        <li>
          <kbd style={kbdStyles}>5</kbd> Layout → <strong>Masonry</strong>
        </li>
        <li style={{ marginTop: 6 }}>
          <kbd style={kbdStyles}>F1</kbd> Settings · <kbd style={kbdStyles}>F3</kbd> Physics{' '}
          <strong>{physicsActive ? 'On' : 'Off'}</strong>
        </li>
        <li>
          <kbd style={kbdStyles}>F4</kbd> Layout Axis Toggle · <kbd style={kbdStyles}>F6</kbd>{' '}
          Random/Auto Rotate
        </li>
        <li>
          <kbd style={kbdStyles}>F7</kbd> Morph · <kbd style={kbdStyles}>F8</kbd> Line Wave ·
          <kbd style={kbdStyles}>F9</kbd> Geometry (legacy)
        </li>
        <li>
          <kbd style={kbdStyles}>N</kbd> Next Cube · <kbd style={kbdStyles}>Esc</kbd> Close Panels
        </li>
      </ul>
      <div style={{ marginTop: 8, fontSize: 11, opacity: 0.65 }}>
        Layout:{' '}
        <strong style={{ textTransform: 'capitalize' }}>
          {layoutMode.replace(/^./, (c) => c.toUpperCase())}
        </strong>
      </div>
    </div>
  );
}

const kbdStyles: CSSProperties = {
  display: 'inline-block',
  minWidth: 18,
  padding: '2px 6px',
  marginRight: 6,
  borderRadius: 6,
  background: 'rgba(32, 38, 63, 0.6)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  fontSize: 11,
  textAlign: 'center',
  fontFamily: 'inherit',
};

