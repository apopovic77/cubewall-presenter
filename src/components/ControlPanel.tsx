import { useState, type CSSProperties } from 'react';
import type { ArMenuAction, ArPhysicsMode } from '../engine/xr/menu/ArMenuModel';

/** Everything the panel can trigger: the AR menu actions plus desktop-only ones. */
export type ControlAction = ArMenuAction | 'toggle-geometry' | 'random-orientation' | 'toggle-settings';

interface ControlPanelProps {
  geometryMode: 'cube' | 'tile';
  wavePositionEnabled: boolean;
  waveRotationEnabled: boolean;
  layoutMode: string;
  physicsMode: ArPhysicsMode;
  morphFront: 'sphere' | 'plane' | 'none';
  onAction: (action: ControlAction) => void;
}

interface ButtonSpec {
  action: ControlAction;
  label: string;
  shortcut: string;
  active?: boolean;
}

const FRONT_LABELS: Record<'sphere' | 'plane' | 'none', string> = {
  sphere: 'Front: Kugel',
  plane: 'Front: Ebene',
  none: 'Front: aus',
};

const PHYSICS_LABELS: Record<ArPhysicsMode, string> = {
  off: 'Physik: aus',
  classic: 'Physik: Fallen',
  anchor: 'Physik: Anker',
};

/**
 * Clickable version of the keyboard shortcuts, so the wall can be operated
 * without a keyboard (e.g. in the Meta Quest browser before entering AR).
 */
export function ControlPanel({
  geometryMode,
  wavePositionEnabled,
  waveRotationEnabled,
  layoutMode,
  physicsMode,
  morphFront,
  onAction,
}: ControlPanelProps) {
  const [open, setOpen] = useState(true);

  const sections: Array<{ title: string; buttons: ButtonSpec[] }> = [
    {
      title: 'Layout',
      buttons: [
        { action: 'layout-matrix', label: 'Raster', shortcut: '4', active: layoutMode === 'matrix' },
        { action: 'layout-masonry', label: 'Masonry', shortcut: '5', active: layoutMode === 'masonry' },
        { action: 'layout-axis', label: 'Zeitachse', shortcut: 'F4', active: layoutMode === 'axis' },
        { action: 'auto-rotate', label: 'Auto-Rotation', shortcut: 'F6' },
        { action: 'random-orientation', label: 'Zufällig drehen', shortcut: '⇧F6' },
        { action: 'morph', label: 'Morph', shortcut: 'F7' },
        { action: 'line-wave', label: 'Linienwelle', shortcut: 'F8' },
        { action: 'front-cycle', label: FRONT_LABELS[morphFront], shortcut: 'F10', active: morphFront !== 'none' },
      ],
    },
    {
      title: 'Bewegung und Physik',
      buttons: [
        { action: 'wave-position', label: 'Welle', shortcut: '2', active: wavePositionEnabled },
        { action: 'wave-rotation', label: 'Wellen-Drehung', shortcut: '3', active: waveRotationEnabled },
        { action: 'physics-cycle', label: PHYSICS_LABELS[physicsMode], shortcut: 'F3', active: physicsMode !== 'off' },
      ],
    },
    {
      title: 'Würfel und Ansicht',
      buttons: [
        { action: 'next-cube', label: 'Nächster Würfel', shortcut: 'N' },
        { action: 'random-cube', label: 'Zufälliger Würfel', shortcut: 'M' },
        { action: 'toggle-geometry', label: geometryMode === 'tile' ? 'Kacheln → Würfel' : 'Würfel → Kacheln', shortcut: '1' },
        { action: 'toggle-settings', label: 'Einstellungen', shortcut: 'F1' },
      ],
    },
  ];

  return (
    <div style={panelStyle}>
      <button type="button" style={headerStyle} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>Steuerung</span>
        <span style={{ opacity: 0.7 }}>{open ? '−' : '+'}</span>
      </button>
      {open &&
        sections.map((section) => (
          <div key={section.title} style={{ marginTop: 10 }}>
            <div style={sectionTitleStyle}>{section.title}</div>
            <div style={gridStyle}>
              {section.buttons.map((button) => (
                <button
                  key={button.action}
                  type="button"
                  onClick={() => onAction(button.action)}
                  style={{ ...buttonStyle, ...(button.active ? activeButtonStyle : null) }}
                >
                  <span>{button.label}</span>
                  <kbd style={kbdStyle}>{button.shortcut}</kbd>
                </button>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

const panelStyle: CSSProperties = {
  position: 'fixed',
  top: 16,
  right: 16,
  width: 300,
  maxHeight: 'calc(100vh - 32px)',
  overflowY: 'auto',
  padding: '12px 14px 14px',
  borderRadius: 14,
  background: 'rgba(10, 12, 22, 0.82)',
  backdropFilter: 'blur(12px)',
  color: '#f3f5ff',
  fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
  fontSize: 14,
  zIndex: 20,
  boxShadow: '0 18px 36px rgba(3, 8, 20, 0.35)',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  width: '100%',
  padding: 0,
  border: 'none',
  background: 'none',
  color: 'inherit',
  font: 'inherit',
  fontWeight: 600,
  fontSize: 15,
  cursor: 'pointer',
};

const sectionTitleStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.6,
  textTransform: 'uppercase',
  opacity: 0.6,
  marginBottom: 6,
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 6,
};

// Large hit targets: the Quest browser is operated with a ray or a finger.
const buttonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
  minHeight: 40,
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid rgba(255, 255, 255, 0.1)',
  background: 'rgba(32, 51, 70, 0.9)',
  color: '#f0f6fc',
  font: 'inherit',
  fontSize: 13,
  textAlign: 'left',
  cursor: 'pointer',
};

const activeButtonStyle: CSSProperties = {
  background: 'rgba(41, 70, 83, 0.95)',
  boxShadow: 'inset 0 -3px 0 #9ae6ed',
};

const kbdStyle: CSSProperties = {
  flexShrink: 0,
  padding: '1px 5px',
  borderRadius: 5,
  background: 'rgba(255, 255, 255, 0.08)',
  fontSize: 10,
  fontFamily: 'inherit',
  opacity: 0.75,
};
