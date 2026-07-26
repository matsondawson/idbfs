const TOKEN_KEY = "idbfs:gh:token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface GitHubIdentity {
  login: string;
}

export async function whoami(token: string): Promise<GitHubIdentity> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(`token check failed: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { login: string };
  return { login: data.login };
}
