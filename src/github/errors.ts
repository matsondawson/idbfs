function isRateLimitError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const status = (e as { status?: unknown }).status;
  const message = (e as { message?: unknown }).message;
  return (
    (status === 403 || status === 429) && typeof message === "string" && /rate limit/i.test(message)
  );
}

/** turns a raw GitHub API error into a message that tells the user what to actually do */
export function formatGhError(e: unknown): string {
  if (isRateLimitError(e)) {
    return "GitHub rate limit exceeded — sign in for a much higher limit, or wait for it to reset. Safe to retry: already-transferred files are kept and won't be re-sent.";
  }
  return String(e);
}
