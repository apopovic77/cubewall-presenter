import type { CubeContentLoadResult } from '../index';

export async function loadDefaultContent(): Promise<CubeContentLoadResult> {
  return { items: [], layout: undefined };
}

