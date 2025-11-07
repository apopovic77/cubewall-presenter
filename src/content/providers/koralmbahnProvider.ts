import { fetchCubeContent } from '../../utils/contentApi';
import type { CubeContentItem } from '../../types/content';

export async function loadKoralmbahnContent(): Promise<CubeContentItem[]> {
  const items = await fetchCubeContent();
  return items;
}

