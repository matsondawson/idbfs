import { Octokit } from "@octokit/rest";

export interface TreeEntry {
  path: string;
  mode: "100644" | "100755" | "040000" | "160000" | "120000";
  type: "blob" | "tree" | "commit";
  sha?: string | null;
  content?: string;
}

export class GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async whoami(): Promise<string> {
    const { data } = await this.octokit.rest.users.getAuthenticated();
    return data.login;
  }

  async getRef(owner: string, repo: string, branch: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
      return data.object.sha;
    } catch (e) {
      // a brand-new repo with zero commits returns 409 "Git Repository is
      // empty" here instead of a normal 404 for a missing ref
      if (isNotFound(e) || isStatus(e, 409)) return null;
      throw e;
    }
  }

  async createRef(owner: string, repo: string, branch: string, sha: string): Promise<void> {
    await this.octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha });
  }

  /** returns false (not thrown) when the update was rejected as non-fast-forward */
  async updateRef(owner: string, repo: string, branch: string, sha: string): Promise<boolean> {
    try {
      await this.octokit.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha, force: false });
      return true;
    } catch (e) {
      if (isStatus(e, 422) || isStatus(e, 409)) return false;
      throw e;
    }
  }

  async listBranches(owner: string, repo: string): Promise<string[]> {
    const branches = await this.octokit.paginate(this.octokit.rest.repos.listBranches, { owner, repo, per_page: 100 });
    return branches.map((b) => b.name);
  }

  async getTreeRecursive(owner: string, repo: string, treeSha: string): Promise<Record<string, string>> {
    const { data } = await this.octokit.rest.git.getTree({ owner, repo, tree_sha: treeSha, recursive: "true" });
    const result: Record<string, string> = {};
    for (const entry of data.tree) {
      if (entry.type === "blob" && entry.path && entry.sha) result[entry.path] = entry.sha;
    }
    return result;
  }

  async getCommitTreeSha(owner: string, repo: string, commitSha: string): Promise<string> {
    const { data } = await this.octokit.rest.git.getCommit({ owner, repo, commit_sha: commitSha });
    return data.tree.sha;
  }

  /**
   * The Git Data API (createBlob/createTree/createCommit) refuses to do
   * anything on a genuinely empty repo (zero commits) — it 409s with "Git
   * Repository is empty" even for creating a blob. The Contents API can
   * bootstrap the very first commit on a branch; after that the Git Data
   * API works normally. Returns the new commit sha.
   */
  async bootstrapEmptyRepo(
    owner: string,
    repo: string,
    branch: string,
    path: string,
    base64Content: string,
    message: string,
  ): Promise<string> {
    const { data } = await this.octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      branch,
      message,
      content: base64Content,
    });
    return data.commit.sha!;
  }

  async createBlob(owner: string, repo: string, base64Content: string): Promise<string> {
    const { data } = await this.octokit.rest.git.createBlob({ owner, repo, content: base64Content, encoding: "base64" });
    return data.sha;
  }

  async getBlob(owner: string, repo: string, sha: string): Promise<string> {
    const { data } = await this.octokit.rest.git.getBlob({ owner, repo, file_sha: sha });
    return data.content.replace(/\n/g, "");
  }

  async createTree(owner: string, repo: string, entries: TreeEntry[]): Promise<string> {
    const { data } = await this.octokit.rest.git.createTree({ owner, repo, tree: entries });
    return data.sha;
  }

  async createCommit(owner: string, repo: string, message: string, treeSha: string, parentSha: string | null): Promise<string> {
    const { data } = await this.octokit.rest.git.createCommit({
      owner,
      repo,
      message,
      tree: treeSha,
      parents: parentSha ? [parentSha] : [],
    });
    return data.sha;
  }
}

function isNotFound(e: unknown): boolean {
  return isStatus(e, 404);
}

function isStatus(e: unknown, status: number): boolean {
  return typeof e === "object" && e !== null && "status" in e && (e as { status: unknown }).status === status;
}
