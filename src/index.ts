import "dotenv/config";
import path from "path";
import fs from "fs";
import { cloneRepo } from "./github/cloneRepo";
import { scanFiles } from "./github/scanFiles";
import { runParser } from "./parser/parser";
import { generateGraph } from "./graph/generateGraphs";
import { generateGraphPng } from "./graph/visualizer";
import { generateTraceToFile } from "./Processes/generateTraces";

async function main() {
    try {
        const repoUrl = process.env.REPO_URL;
        const tmpDir = path.resolve(process.cwd(), "data", "repo", "tmp-files");

        if (!repoUrl) {
            throw new Error("REPO_URL not found in .env");
        }

        console.log("[index] Starting...");

        // 1. Clone repo
        const repoPath = await cloneRepo(repoUrl);

        // 2. Scan files
        const files = scanFiles(repoPath);

        // 3. Convert to relative paths (VERY important for later graph work)
        const relativeFiles = files.map((file) =>
            path.relative(repoPath, file)
        );

        // Copy these files to projDir/data/repo/tmp-files for later use (e.g. graph construction)
        if (!fs.existsSync(tmpDir)) {
            fs.mkdirSync(tmpDir, { recursive: true });
        }
        relativeFiles.forEach((file) => {
            const src = path.join(repoPath, file);
            const dest = path.join(tmpDir, file);
            const destDir = path.dirname(dest);
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }
            fs.copyFileSync(src, dest);
        });

        // 4. Parse copied files
        await runParser();

        // 5. Generate graph data from output
        generateGraph();

        // 6. Render graph PNG
        await generateGraphPng();

        // 7. Generate trace for getReservations method
        const tracePath = generateTraceToFile("validateUser");
        console.log("[trace] Output:", tracePath);

        // Delete the cloned repo to save space
        fs.rmSync(repoPath, { recursive: true, force: true });



    } catch (err) {
        console.error("[index] Error:", err);
        process.exit(1);
    }
}

main();