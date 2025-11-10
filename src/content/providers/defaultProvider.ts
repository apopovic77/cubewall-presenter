import type { CubeContentLoadResult } from '../registry';

export async function loadDefaultContent(): Promise<CubeContentLoadResult> {
  return { items: [], layout: undefined };
}

