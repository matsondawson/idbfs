import { describe, it, expect, vi, afterEach } from "vitest";
import { GitHubClient } from "../github/client";

describe("GitHubClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports isAuthenticated based on whether a token was passed", () => {
    expect(new GitHubClient("a-token").isAuthenticated).toBe(true);
    expect(new GitHubClient().isAuthenticated).toBe(false);
    expect(new GitHubClient(undefined).isAuthenticated).toBe(false);
  });

  it("getRawFile fetches from the raw-content CDN by commit sha, url-encoding path segments", async () => {
    const fetchMock = vi.fn(
      async () => new Response("hello", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new GitHubClient();
    const data = await client.getRawFile("alice", "repo", "abc123", "src/a b/f#ile.txt");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/alice/repo/abc123/src/a%20b/f%23ile.txt",
    );
    expect(new TextDecoder().decode(data)).toBe("hello");
  });

  it("getRawFile throws with the path on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404, statusText: "Not Found" })),
    );

    const client = new GitHubClient();
    await expect(client.getRawFile("alice", "repo", "abc123", "missing.txt")).rejects.toThrow(
      /404.*missing\.txt/,
    );
  });

  it("getDefaultBranch returns the repo's actual default branch, not a guess", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        expect(String(input)).toBe("https://api.github.com/repos/alice/repo");
        return new Response(JSON.stringify({ default_branch: "master" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const client = new GitHubClient();
    await expect(client.getDefaultBranch("alice", "repo")).resolves.toBe("master");
  });
});
