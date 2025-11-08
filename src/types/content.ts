export type CubeLayoutAxisValue = string | number | null | undefined;

export interface CubeContentLayout {
  sortValue?: number | string | null;
  axisValues?: Record<string, CubeLayoutAxisValue>;
}

export interface CubeContentItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  imageUrl: string | null;
  publishedAt: string | null;
  sourceName: string | null;
  category: string | null;
  layout?: CubeContentLayout;
}

export function normalizeCubeContent(items: CubeContentItem[]): CubeContentItem[] {
  return items.map((item) => ({
    ...item,
    title: item.title?.trim() || 'Unbetitelter Beitrag',
    summary: item.summary?.trim() || '',
    url: item.url?.trim() || '#',
    imageUrl: item.imageUrl?.trim() || null,
    publishedAt: item.publishedAt?.trim() || null,
    sourceName: item.sourceName?.trim() || null,
    category: item.category?.trim() || null,
    layout: normalizeLayout(item.layout),
  }));
}

function normalizeLayout(layout: CubeContentLayout | undefined): CubeContentLayout | undefined {
  if (!layout) return undefined;

  const normalized: CubeContentLayout = {};

  if (layout.sortValue !== undefined) {
    const value = coerceSortValue(layout.sortValue);
    if (value !== undefined) {
      normalized.sortValue = value;
    }
  }

  if (layout.axisValues) {
    const entries = Object.entries(layout.axisValues).reduce<Record<string, CubeLayoutAxisValue>>((acc, [key, value]) => {
      if (value === undefined || value === null) {
        return acc;
      }
      const trimmedKey = key.trim();
      if (!trimmedKey) {
        return acc;
      }
      if (typeof value === 'string') {
        const trimmedValue = value.trim();
        if (trimmedValue) {
          acc[trimmedKey] = trimmedValue;
        }
      } else {
        acc[trimmedKey] = value;
      }
      return acc;
    }, {});

    if (Object.keys(entries).length > 0) {
      normalized.axisValues = entries;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function coerceSortValue(value: number | string | null | undefined): number | string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      return value;
    }
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  const timestamp = Date.parse(trimmed);
  if (!Number.isNaN(timestamp)) {
    return timestamp;
  }
  return trimmed;
}


