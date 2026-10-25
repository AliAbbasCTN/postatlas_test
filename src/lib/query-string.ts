// Pure helper: builds `basePath?a=1&b=2`, skipping empty values. Used by filter chips, tabs and pagination links.
export function withParams(basePath: string, params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${basePath}?${s}` : basePath;
}
