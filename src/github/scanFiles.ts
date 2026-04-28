import fs from "fs";
import path from "path";

const IGNORE_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "out"
]);

const VALID_EXTENSIONS = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx"
]);

const MAX_FILE_SIZE = 200 * 1024; // 200KB

export function scanFiles(rootDir: string): string[] {
    const results: string[] = [];

    function walk(currentPath: string) {
        const stats = fs.statSync(currentPath);

        if (stats.isDirectory()) {
            const dirName = path.basename(currentPath);

            if (IGNORE_DIRS.has(dirName)) return;

            const files = fs.readdirSync(currentPath);
            for (const file of files) {
                walk(path.join(currentPath, file));
            }
        } else {
            const ext = path.extname(currentPath);

            if (!VALID_EXTENSIONS.has(ext)) return;
            if (stats.size > MAX_FILE_SIZE) return;

            results.push(currentPath);
        }
    }

    walk(rootDir);
    return results;
}