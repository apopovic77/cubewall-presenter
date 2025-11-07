import { AnimatePresence, motion } from 'framer-motion';
import type { CubeSelectionInfo } from '../engine/CubeField';

export interface SelectionOverlayProps {
  selection: CubeSelectionInfo | null;
}

export function SelectionOverlay({ selection }: SelectionOverlayProps) {
  const item = selection?.content ?? null;
  let publishedLabel: string | null = null;
  if (item?.publishedAt) {
    const date = new Date(item.publishedAt);
    if (!Number.isNaN(date.getTime())) {
      publishedLabel = date.toLocaleDateString('de-DE');
    }
  }

  return (
    <AnimatePresence>
      {selection && (
        <motion.div
          key="selection-overlay"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ type: 'spring', damping: 18, stiffness: 180 }}
          className="cw-selection"
        >
          <span className="cw-selection__badge">{item?.category ?? 'Selected Cube'}</span>
          <div className="cw-selection__swatch" style={{ backgroundColor: selection.color.toHexString() }} />
          <div className="cw-selection__coords">
            <span>Grid X: {selection.gridX}</span>
            <span>Grid Z: {selection.gridZ}</span>
          </div>
          {item && (
            <div className="cw-selection__details">
              <h3>{item.title}</h3>
              <div className="cw-selection__meta">
                {item.sourceName && <span>{item.sourceName}</span>}
                {publishedLabel && <span>{publishedLabel}</span>}
              </div>
              {item.summary && <p>{item.summary}</p>}
              {item.url && (
                <a href={item.url} target="_blank" rel="noreferrer">
                  Zum Artikel
                </a>
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
