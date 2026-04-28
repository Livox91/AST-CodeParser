import simpleGit from "simple-git";
import path from "path";
import fs from "fs";

const git = simpleGit();

export async function cloneRepo(repoUrl: string): Promise<string> {
    const repoName = repoUrl.split("/").pop()?.replace(".git", "") || "repo";
    const repoPath = path.join(process.cwd(), "data", repoName);

    // If already exists, skip cloning
    if (fs.existsSync(repoPath)) {
        console.log(`[cloneRepo] Repo already exists: ${repoPath}`);
        return repoPath;
    }

    console.log(`[cloneRepo] Cloning ${repoUrl}...`);
    await git.clone(repoUrl, repoPath);

    console.log(`[cloneRepo] Cloned to ${repoPath}`);
    return repoPath;
}

