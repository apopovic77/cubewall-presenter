import type { PresenterSettings } from './PresenterSettings';

/** Wave values the control panel steps with buttons (same ranges as the settings sliders). */
export type WaveStepKey = 'waveAmplitudeY' | 'waveAmplitudeRot' | 'waveSpeed';

const RANGES: Record<WaveStepKey, { min: number; max: number }> = {
  waveAmplitudeY: { min: 0, max: 1.5 },
  waveAmplitudeRot: { min: 0, max: 1 },
  waveSpeed: { min: 0, max: 2 },
};

/** Each press scales by this factor, so small values change finely and large ones quickly. */
const STEP_FACTOR = 1.25;
/** Stepping up from (near) zero starts here instead of staying at zero. */
const STEP_FLOOR: Record<WaveStepKey, number> = {
  waveAmplitudeY: 0.04,
  waveAmplitudeRot: 0.02,
  waveSpeed: 0.05,
};

/**
 * Next value of a wave setting one step up (`direction` 1) or down (-1).
 * Stepping up also switches the matching wave on, so the change is visible.
 */
export function stepWaveSetting(
  settings: PresenterSettings,
  key: WaveStepKey,
  direction: 1 | -1,
): Partial<PresenterSettings> {
  const { min, max } = RANGES[key];
  const current = settings[key];
  const scaled = direction > 0 ? Math.max(current * STEP_FACTOR, STEP_FLOOR[key]) : current / STEP_FACTOR;
  const next = Math.min(max, Math.max(min, scaled < STEP_FLOOR[key] / 2 ? 0 : scaled));
  const rounded = Math.round(next * 1000) / 1000;
  if (direction < 0) return { [key]: rounded };
  const enable = key === 'waveAmplitudeRot' ? { waveRotationEnabled: true } : { wavePositionEnabled: true };
  return { [key]: rounded, ...enable };
}
