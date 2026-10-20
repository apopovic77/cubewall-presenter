import type { CubeContentItem } from '../../types/content';
import type { AxisLabelAxis, CubeLayoutConfig } from '../../config/AppConfig';

export interface AxisValueInfo {
  label: string | null;
  raw: string | number | null;
  timestamp?: number;
  count: number;
}

interface AxisGroup {
  key: string;
  label: string;
  orderValue: number | string;
  timestamp?: number;
  items: CubeContentItem[];
}

/** Inputs of one assignment pass. */
export interface ContentAssignmentOptions {
  gridSize: number;
  repeatContent: boolean;
  layout: CubeLayoutConfig;
}

/**
 * Decides which content item goes onto which grid cell ("x,z"): row by row
 * (matrix) or grouped by an axis value such as the publishing day (axis), and
 * keeps the per-row / per-column axis values for the axis labels.
 */
export class ContentAssigner {
  private options: ContentAssignmentOptions = {
    gridSize: 1,
    repeatContent: true,
    layout: { mode: 'matrix' } as CubeLayoutConfig,
  };
  private axisValueInfo: Record<AxisLabelAxis, AxisValueInfo[]> = {
    rows: [],
    columns: [],
  };

  /** Grid cell key `x,z` → item. */
  public assign(items: CubeContentItem[], options: ContentAssignmentOptions): Map<string, CubeContentItem> {
    this.options = options;
    return this.buildContentAssignments(items);
  }

  public getAxisValueInfo(axis: AxisLabelAxis, index: number): AxisValueInfo | null {
    const values = this.axisValueInfo[axis];
    if (!values || index < 0 || index >= values.length) {
      return null;
    }
    return values[index] ?? null;
  }

  private tryAssignItem(
    assignments: Map<string, CubeContentItem>,
    assigned: Set<string>,
    gridX: number,
    gridZ: number,
    item: CubeContentItem | undefined,
  ): boolean {
    if (!item) {
      return false;
    }
    const key = `${gridX},${gridZ}`;
    if (!this.options.repeatContent && assigned.has(item.id)) {
      return false;
    }
    assignments.set(key, item);
    if (!this.options.repeatContent) {
      assigned.add(item.id);
    }
    return true;
  }

  private extractSortValue(item: CubeContentItem): number | string {
    const value = item.layout?.sortValue;
    if (value === null || value === undefined) {
      return item.id;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
      return value;
    }
    return item.id;
  }

  private compareItemsBySortValue(a: CubeContentItem, b: CubeContentItem, order: 'asc' | 'desc'): number {
    const aValue = this.extractSortValue(a);
    const bValue = this.extractSortValue(b);
    const direction = order === 'asc' ? 1 : -1;
    if (typeof aValue === 'number' && typeof bValue === 'number') {
      const diff = aValue - bValue;
      if (diff !== 0) {
        return diff * direction;
      }
    }
    const diff = String(aValue).localeCompare(String(bValue));
    if (diff !== 0) {
      return diff * direction;
    }
    return String(a.id).localeCompare(String(b.id));
  }

  private compareOrderValues(a: number | string, b: number | string, order: 'asc' | 'desc'): number {
    if (typeof a === 'number' && typeof b === 'number') {
      return order === 'asc' ? a - b : b - a;
    }
    const aStr = String(a);
    const bStr = String(b);
    return order === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
  }

  private normalizeAxisValue(value: unknown): { key: string; label: string; orderValue: number | string; timestamp?: number } | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      const label = value.toString();
      return { key: label, label, orderValue: value };
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return { key: trimmed, label: trimmed, orderValue: numeric };
      }
      const timestamp = Date.parse(trimmed);
      if (!Number.isNaN(timestamp)) {
        return { key: trimmed, label: trimmed, orderValue: timestamp, timestamp };
      }
      return { key: trimmed, label: trimmed, orderValue: trimmed };
    }
    if (typeof value === 'boolean') {
      const label = value ? 'true' : 'false';
      return { key: label, label, orderValue: label };
    }
    const label = String(value).trim();
    if (!label) {
      return null;
    }
    return { key: label, label, orderValue: label };
  }

  private buildMatrixAssignments(items: CubeContentItem[], assignments: Map<string, CubeContentItem>): void {
    const gridSize = this.options.gridSize;
    const repeat = this.options.repeatContent && items.length > 0;
    let cursor = 0;

    for (let z = 0; z < gridSize; z += 1) {
      for (let x = 0; x < gridSize; x += 1) {
        let item: CubeContentItem | null = null;
        if (cursor < items.length) {
          item = items[cursor];
          cursor += 1;
        } else if (repeat && items.length > 0) {
          item = items[cursor % items.length];
          cursor += 1;
        }
        if (item) {
          assignments.set(`${x},${z}`, item);
        }
      }
    }

    const emptyRowInfo = Array.from({ length: gridSize }, () => ({
      label: null,
      raw: null,
      count: 0,
    } as AxisValueInfo));
    const emptyColumnInfo = Array.from({ length: gridSize }, () => ({
      label: null,
      raw: null,
      count: 0,
    } as AxisValueInfo));
    this.axisValueInfo.rows = emptyRowInfo;
    this.axisValueInfo.columns = emptyColumnInfo;
  }

  private buildAxisAssignments(items: CubeContentItem[], assignments: Map<string, CubeContentItem>): void {
    const gridSize = this.options.gridSize;
    const layout = this.options.layout;
    const axisKey = layout.axisKey;
    const axisGroups = new Map<string, AxisGroup>();
    const fallbackItems: CubeContentItem[] = [];

    items.forEach((item) => {
      const axisValues = item.layout?.axisValues;
      const rawValue = axisValues?.[axisKey];
      const normalized = this.normalizeAxisValue(rawValue);
      if (!normalized) {
        fallbackItems.push(item);
        return;
      }
      let group = axisGroups.get(normalized.key);
      if (!group) {
        group = {
          key: normalized.key,
          label: normalized.label,
          orderValue: normalized.orderValue,
          timestamp: normalized.timestamp,
          items: [],
        };
        axisGroups.set(normalized.key, group);
      }
      group.items.push(item);
    });

    const groups = Array.from(axisGroups.values());
    groups.sort((a, b) => {
      const diff = this.compareOrderValues(a.orderValue, b.orderValue, layout.axisOrder);
      if (diff !== 0) {
        return diff;
      }
      return a.label.localeCompare(b.label);
    });

    const limitedGroups = groups.slice(0, gridSize);
    const overflowGroups = groups.slice(gridSize);
    overflowGroups.forEach((group) => {
      fallbackItems.push(...group.items);
    });

    fallbackItems.sort((a, b) => this.compareItemsBySortValue(a, b, layout.sortOrder));

    const assigned = new Set<string>();
    let repeatCursor = 0;

    const pullNextFallback = (): CubeContentItem | undefined => {
      while (fallbackItems.length > 0) {
        const candidate = fallbackItems.shift()!;
        if (this.options.repeatContent || !assigned.has(candidate.id)) {
          return candidate;
        }
      }
      if (this.options.repeatContent && items.length > 0) {
        const candidate = items[repeatCursor % items.length];
        repeatCursor += 1;
        return candidate;
      }
      return undefined;
    };

    const rowsInfo: AxisValueInfo[] = Array.from({ length: gridSize }, () => ({
      label: null,
      raw: null,
      count: 0,
    }));
    const columnsInfo: AxisValueInfo[] = Array.from({ length: gridSize }, () => ({
      label: null,
      raw: null,
      count: 0,
    }));
    const rowCounts = new Array(gridSize).fill(0);
    const columnCounts = new Array(gridSize).fill(0);

    if (layout.axis === 'rows') {
      limitedGroups.forEach((group, rowIndex) => {
        if (rowIndex >= gridSize) return;
        rowsInfo[rowIndex] = {
          label: group.label,
          raw: group.label,
          timestamp: group.timestamp,
          count: 0,
        };
        const sortedItems = [...group.items].sort((a, b) => this.compareItemsBySortValue(a, b, layout.sortOrder));
        const primaryItems = sortedItems.slice(0, gridSize);
        const overflow = sortedItems.slice(gridSize);
        fallbackItems.push(...overflow);

        for (let columnIndex = 0; columnIndex < gridSize; columnIndex += 1) {
          let candidate: CubeContentItem | undefined;
          if (columnIndex < primaryItems.length) {
            candidate = primaryItems[columnIndex];
          } else {
            candidate = pullNextFallback();
          }
          if (!candidate && this.options.repeatContent && sortedItems.length > 0) {
            candidate = sortedItems[columnIndex % sortedItems.length];
          }
          if (!candidate) {
            continue;
          }
          if (this.tryAssignItem(assignments, assigned, columnIndex, rowIndex, candidate)) {
            rowCounts[rowIndex] += 1;
            columnCounts[columnIndex] += 1;
          }
        }
      });

      for (let rowIndex = limitedGroups.length; rowIndex < gridSize; rowIndex += 1) {
        rowsInfo[rowIndex] = rowsInfo[rowIndex] ?? {
          label: null,
          raw: null,
          count: 0,
        };
        for (let columnIndex = 0; columnIndex < gridSize; columnIndex += 1) {
          const candidate = pullNextFallback();
          if (!candidate) {
            continue;
          }
          if (this.tryAssignItem(assignments, assigned, columnIndex, rowIndex, candidate)) {
            rowCounts[rowIndex] += 1;
            columnCounts[columnIndex] += 1;
          }
        }
      }
    } else {
      limitedGroups.forEach((group, columnIndex) => {
        if (columnIndex >= gridSize) return;
        columnsInfo[columnIndex] = {
          label: group.label,
          raw: group.label,
          timestamp: group.timestamp,
          count: 0,
        };
        const sortedItems = [...group.items].sort((a, b) => this.compareItemsBySortValue(a, b, layout.sortOrder));
        const primaryItems = sortedItems.slice(0, gridSize);
        const overflow = sortedItems.slice(gridSize);
        fallbackItems.push(...overflow);

        for (let rowIndex = 0; rowIndex < gridSize; rowIndex += 1) {
          let candidate: CubeContentItem | undefined;
          if (rowIndex < primaryItems.length) {
            candidate = primaryItems[rowIndex];
          } else {
            candidate = pullNextFallback();
          }
          if (!candidate && this.options.repeatContent && sortedItems.length > 0) {
            candidate = sortedItems[rowIndex % sortedItems.length];
          }
          if (!candidate) {
            continue;
          }
          if (this.tryAssignItem(assignments, assigned, columnIndex, rowIndex, candidate)) {
            rowCounts[rowIndex] += 1;
            columnCounts[columnIndex] += 1;
          }
        }
      });

      for (let columnIndex = limitedGroups.length; columnIndex < gridSize; columnIndex += 1) {
        columnsInfo[columnIndex] = columnsInfo[columnIndex] ?? {
          label: null,
          raw: null,
          count: 0,
        };
        for (let rowIndex = 0; rowIndex < gridSize; rowIndex += 1) {
          const candidate = pullNextFallback();
          if (!candidate) {
            continue;
          }
          if (this.tryAssignItem(assignments, assigned, columnIndex, rowIndex, candidate)) {
            rowCounts[rowIndex] += 1;
            columnCounts[columnIndex] += 1;
          }
        }
      }
    }

    rowsInfo.forEach((info, index) => {
      info.count = rowCounts[index] ?? 0;
    });
    columnsInfo.forEach((info, index) => {
      info.count = columnCounts[index] ?? 0;
    });

    if (layout.axis === 'rows') {
      this.axisValueInfo.rows = rowsInfo;
      this.axisValueInfo.columns = columnsInfo;
    } else {
      this.axisValueInfo.columns = columnsInfo;
      this.axisValueInfo.rows = rowsInfo;
    }
  }

  private buildContentAssignments(items: CubeContentItem[]): Map<string, CubeContentItem> {
    const assignments = new Map<string, CubeContentItem>();

    if (items.length === 0) {
      const gridSize = this.options.gridSize;
      const emptyRows = Array.from({ length: gridSize }, () => ({
        label: null,
        raw: null,
        count: 0,
      } as AxisValueInfo));
      const emptyColumns = Array.from({ length: gridSize }, () => ({
        label: null,
        raw: null,
        count: 0,
      } as AxisValueInfo));
      this.axisValueInfo.rows = emptyRows;
      this.axisValueInfo.columns = emptyColumns;
      return assignments;
    }

    if (this.options.layout.mode === 'axis') {
      this.buildAxisAssignments(items, assignments);
    } else {
      this.buildMatrixAssignments(items, assignments);
    }

    return assignments;
  }

  public getAxisValuesSnapshot(): {
    rows: { label: string | null; count: number }[];
    columns: { label: string | null; count: number }[];
  } {
    return {
      rows: this.axisValueInfo.rows.map((info) => ({
        label: info.label,
        count: info.count,
      })),
      columns: this.axisValueInfo.columns.map((info) => ({
        label: info.label,
        count: info.count,
      })),
    };
  }
}
