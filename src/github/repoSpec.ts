/** accepts "owner/repo" or a github.com URL (https or git@), with or without a trailing ".git" */
export function parseRepoSpec(spec: string): { owner: string; repo: string } | null {
  let s = spec.trim();
  const ssh = s.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  s = s
    .replace(/^https?:\/\//, "")
    .replace(/^github\.com\//, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "");
  const parts = s.split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  return { owner: parts[0], repo: parts[1] };
}
