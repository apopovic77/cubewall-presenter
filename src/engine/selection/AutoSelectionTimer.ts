import type { CubeCell } from '../CubeField';

/**
 * Kiosk auto-selection: every `interval` seconds the next cube in field order
 * is due (skipping disposed and already selected ones). Suspended (e.g. while
 * physics runs) without losing the user's on/off setting.
 */
export class AutoSelectionTimer {
  private enabled = false;
  private suspended = false;
  private interval = 6;
  private elapsed = 0;
  private sequence: CubeCell[] = [];
  private sequenceIndex = 0;

  /** From the settings. */
  configure(enabled: boolean, intervalSeconds: number): void {
    this.enabled = enabled;
    this.interval = Math.max(1, intervalSeconds);
    this.elapsed = this.enabled ? Math.min(this.elapsed, this.interval) : 0;
  }

  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (!suspended) this.elapsed = 0;
  }

  get isRunning(): boolean {
    return this.enabled && !this.suspended;
  }

  /** A selection happened (manual or automatic): the next automatic one waits a full interval. */
  restart(): void {
    this.elapsed = 0;
  }

  /** The field's cells changed. */
  setCells(cells: CubeCell[]): void {
    this.sequence = cells;
    this.sequenceIndex = 0;
  }

  /**
   * Advances the timer; returns the cube to select when one is due (the next
   * in field order, else `fallback()`), null otherwise.
   */
  update(deltaTime: number, refreshCells: () => CubeCell[], fallback: () => CubeCell | null): CubeCell | null {
    if (!this.isRunning) return null;
    this.elapsed += deltaTime;
    if (this.elapsed < this.interval) return null;
    this.elapsed = 0;
    const cell = this.next(refreshCells) ?? fallback();
    return cell && !cell.isSelected ? cell : null;
  }

  /** Next cube in field order that is not selected (also for "next cube" navigation). */
  next(refreshCells: () => CubeCell[]): CubeCell | null {
    if (this.sequence.length === 0) this.setCells(refreshCells());
    const found = this.scan();
    if (found) return found;
    this.setCells(refreshCells());
    return this.scan();
  }

  private scan(): CubeCell | null {
    const total = this.sequence.length;
    for (let attempts = 0; attempts < total; attempts += 1) {
      const candidate = this.sequence[this.sequenceIndex % total];
      this.sequenceIndex = (this.sequenceIndex + 1) % total;
      if (!candidate || candidate.mesh.isDisposed() || candidate.isSelected) continue;
      return candidate;
    }
    return null;
  }
}
