import fs from "fs";
import path from "path";
import type { ParseOutput } from "../types/parserTypes";
import type { GraphEdge, GraphNode, GraphOutput } from "../types/graphTypes";

const DEFAULT_INPUT_PATH = path.resolve(
    process.cwd(),
    "output",
    "ts-morph-output.json"
);
const DEFAULT_OUTPUT_PATH = path.resolve(process.cwd(), "output", "ast-graph.json");

function toPosix(value: string): string {
    return value.replace(/\\/g, "/");
}

function ensureOutputDir(outputPath: string) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function isRelativeImport(moduleSpecifier: string): boolean {
    return moduleSpecifier.startsWith(".");
}

function resolveRelativeImport(
    importingFile: string,
    moduleSpecifier: string,
    filePathSet: Set<string>
): string | null {
    const baseDir = path.posix.dirname(importingFile);
    const rawTarget = path.posix.normalize(
        path.posix.join(baseDir, moduleSpecifier)
    );
    const ext = path.posix.extname(rawTarget);
    const candidates: string[] = [];

    if (ext) {
        candidates.push(rawTarget);
    } else {
        const extensions = [".ts", ".tsx", ".js", ".jsx"];
        for (const extension of extensions) {
            candidates.push(`${rawTarget}${extension}`);
            candidates.push(`${rawTarget}/index${extension}`);
        }
    }

    for (const candidate of candidates) {
        if (filePathSet.has(candidate)) {
            return candidate;
        }
    }

    return null;
}

function loadParseOutput(inputPath: string): ParseOutput {
    const raw = fs.readFileSync(inputPath, "utf8");
    return JSON.parse(raw) as ParseOutput;
}

function createNodeIndex(nodes: GraphNode[]) {
    const map = new Map<string, GraphNode>();
    for (const node of nodes) {
        map.set(node.id, node);
    }
    return map;
}

function addNode(nodes: GraphNode[], map: Map<string, GraphNode>, node: GraphNode) {
    if (map.has(node.id)) return;
    map.set(node.id, node);
    nodes.push(node);
}

function addEdge(edges: GraphEdge[], edgeSet: Set<string>, edge: GraphEdge) {
    const key = `${edge.from}|${edge.to}|${edge.type}|${edge.label ?? ""}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push(edge);
}

export function generateGraph(
    inputPath = DEFAULT_INPUT_PATH,
    outputPath = DEFAULT_OUTPUT_PATH
): GraphOutput {
    const parseOutput = loadParseOutput(inputPath);
    const filePaths = parseOutput.files.map((file) => toPosix(file.path));
    const filePathSet = new Set(filePaths);

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const edgeSet = new Set<string>();
    const nodeMap = createNodeIndex(nodes);

    const classIndex = new Map<string, Map<string, string>>();
    const functionIndex = new Map<string, Map<string, string>>();

    for (const file of parseOutput.files) {
        const filePath = toPosix(file.path);
        const fileId = `file:${filePath}`;

        addNode(nodes, nodeMap, {
            id: fileId,
            type: "file",
            label: filePath,
            filePath
        });

        const classMap = new Map<string, string>();
        const functionMap = new Map<string, string>();

        for (const cls of file.classes) {
            const classId = `class:${filePath}#${cls.name}`;
            addNode(nodes, nodeMap, {
                id: classId,
                type: "class",
                label: cls.name,
                filePath
            });
            addEdge(edges, edgeSet, {
                from: fileId,
                to: classId,
                type: "contains"
            });
            classMap.set(cls.name, classId);
        }

        for (const fn of file.functions) {
            const functionId = `function:${filePath}#${fn.name}`;
            addNode(nodes, nodeMap, {
                id: functionId,
                type: "function",
                label: fn.name,
                filePath
            });
            addEdge(edges, edgeSet, {
                from: fileId,
                to: functionId,
                type: "contains"
            });
            functionMap.set(fn.name, functionId);
        }

        classIndex.set(filePath, classMap);
        functionIndex.set(filePath, functionMap);
    }

    for (const file of parseOutput.files) {
        const filePath = toPosix(file.path);
        const fileId = `file:${filePath}`;

        for (const imp of file.imports) {
            if (isRelativeImport(imp.module)) {
                const resolved = resolveRelativeImport(
                    filePath,
                    imp.module,
                    filePathSet
                );

                if (resolved) {
                    const targetFileId = `file:${resolved}`;
                    addNode(nodes, nodeMap, {
                        id: targetFileId,
                        type: "file",
                        label: resolved,
                        filePath: resolved
                    });
                    addEdge(edges, edgeSet, {
                        from: fileId,
                        to: targetFileId,
                        type: "imports",
                        label: imp.module
                    });

                    const targetClasses = classIndex.get(resolved);
                    const targetFunctions = functionIndex.get(resolved);

                    for (const name of imp.namedImports) {
                        const classId = targetClasses?.get(name);
                        if (classId) {
                            addEdge(edges, edgeSet, {
                                from: fileId,
                                to: classId,
                                type: "importsSymbol",
                                label: name
                            });
                            continue;
                        }

                        const functionId = targetFunctions?.get(name);
                        if (functionId) {
                            addEdge(edges, edgeSet, {
                                from: fileId,
                                to: functionId,
                                type: "importsSymbol",
                                label: name
                            });
                        }
                    }
                    continue;
                }
            }

            const moduleId = `module:${imp.module}`;
            addNode(nodes, nodeMap, {
                id: moduleId,
                type: "module",
                label: imp.module
            });
            addEdge(edges, edgeSet, {
                from: fileId,
                to: moduleId,
                type: "imports",
                label: imp.module
            });
        }
    }

    const output: GraphOutput = {
        generatedAt: new Date().toISOString(),
        sourceJson: toPosix(inputPath),
        nodeCount: nodes.length,
        edgeCount: edges.length,
        nodes,
        edges
    };

    ensureOutputDir(outputPath);
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf8");

    console.log("[graph] Nodes:", output.nodeCount);
    console.log("[graph] Edges:", output.edgeCount);
    console.log("[graph] Output:", outputPath);

    return output;
}

if (require.main === module) {
    generateGraph();
}
