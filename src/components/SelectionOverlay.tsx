import { AnimatePresence, motion } from 'framer-motion';
import type { CubeSelectionInfo } from '../engine/CubeField';

export interface SelectionOverlayProps {
  selection: CubeSelectionInfo | null;
}

export function SelectionOverlay({ selection }: SelectionOverlayProps) {
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
          <span className="cw-selection__badge">Selected Cube</span>
          <div className="cw-selection__swatch" style={{ backgroundColor: selection.color.toHexString() }} />
          <div className="cw-selection__coords">
            <span>Grid X: {selection.gridX}</span>
            <span>Grid Z: {selection.gridZ}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
