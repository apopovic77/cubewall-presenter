export interface CubeContentItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  imageUrl: string | null;
  publishedAt: string | null;
  sourceName: string | null;
  category: string | null;
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
  }));
}


