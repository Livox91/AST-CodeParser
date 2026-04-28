import fs from "fs";
import path from "path";
import {
    Node,
    Project,
    SyntaxKind,
    ts
} from "ts-morph";
import type {
    CallExpression,
    SourceFile,
    VariableDeclaration
} from "ts-morph";
import { scanFiles } from "../github/scanFiles";
import type { TraceImports, TraceNode, TraceOutput } from "../types/traceTypes";

type DefinitionKind = "function" | "method";

type DefinitionInfo = {
    id: string;
    name: string;
    kind: DefinitionKind;
    filePath: string;
    className?: string;
    startLine: number;
    endLine: number;
    imports: TraceImports;
};

type TraceOptions = {
    maxDepth?: number;
};

const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "output");

function normalizePath(value: string): string {
    return value.replace(/\\/g, "/");
}

function resolveSourceDir(projectRoot: string): string {
    const candidates = [
        path.resolve(projectRoot, "data", "rmp-files"),
        path.resolve(projectRoot, "data", "repo", "tmp-files"),
        path.resolve(projectRoot, "data", "tmp-files")
    ];

    const existingDir = candidates.find((dir) => fs.existsSync(dir));

    if (!existingDir) {
        throw new Error(
            "Source directory not found. Expected data/rmp-files, data/repo/tmp-files, or data/tmp-files."
        );
    }

    return existingDir;
}

function ensureDir(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function isRelativeImport(moduleSpecifier: string): boolean {
    return moduleSpecifier.startsWith(".");
}

function getImports(sourceFile: SourceFile): TraceImports {
    const local = new Set<string>();
    const external = new Set<string>();

    const importDeclarations = sourceFile.getImportDeclarations();
    for (const decl of importDeclarations) {
        const moduleSpecifier = decl.getModuleSpecifierValue();
        if (isRelativeImport(moduleSpecifier)) {
            local.add(moduleSpecifier);
        } else {
            external.add(moduleSpecifier);
        }
    }

    const importEquals = sourceFile
        .getStatements()
        .filter(Node.isImportEqualsDeclaration);
    for (const decl of importEquals) {
        const moduleReference = decl.getModuleReference().getText();
        if (isRelativeImport(moduleReference)) {
            local.add(moduleReference);
        } else {
            external.add(moduleReference);
        }
    }

    return {
        external: Array.from(external).sort(),
        local: Array.from(local).sort()
    };
}

function getNodeRange(node: Node) {
    return {
        startLine: node.getStartLineNumber(),
        endLine: node.getEndLineNumber()
    };
}

function sanitizeFileName(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function getMethodName(input: string | undefined): string {
    if (!input) {
        throw new Error("Method name is required. Pass it as the first argument.");
    }

    const trimmed = input.trim();
    if (!trimmed) {
        throw new Error("Method name cannot be empty.");
    }

    return trimmed;
}

function getCallExpressionSymbol(callExpression: CallExpression) {
    const expression = callExpression.getExpression();
    return (
        expression.getSymbol() ??
        (Node.isPropertyAccessExpression(expression)
            ? expression.getNameNode().getSymbol()
            : undefined)
    );
}

function findCallerDefinitionId(
    node: Node,
    definitionIdByNode: Map<Node, string>
): string | null {
    let current: Node | undefined = node;
    while (current) {
        const id = definitionIdByNode.get(current);
        if (id) return id;
        current = current.getParent();
    }
    return null;
}

function addDefinition(
    definitions: Map<string, DefinitionInfo>,
    definitionIdByNode: Map<Node, string>,
    definition: DefinitionInfo,
    declarationNodes: Node[]
) {
    if (!definitions.has(definition.id)) {
        definitions.set(definition.id, definition);
    }

    for (const node of declarationNodes) {
        definitionIdByNode.set(node, definition.id);
    }
}

function collectDefinitions(
    sourceFiles: SourceFile[],
    sourceDir: string
) {
    const definitions = new Map<string, DefinitionInfo>();
    const definitionIdByNode = new Map<Node, string>();
    const methodNameIndex = new Map<string, string[]>();

    for (const sourceFile of sourceFiles) {
        const filePath = normalizePath(
            path.relative(sourceDir, sourceFile.getFilePath())
        );
        const imports = getImports(sourceFile);

        for (const fn of sourceFile.getFunctions()) {
            const name = fn.getName();
            if (!name) continue;
            const range = getNodeRange(fn);
            const id = `function:${filePath}#${name}`;
            addDefinition(
                definitions,
                definitionIdByNode,
                {
                    id,
                    name,
                    kind: "function",
                    filePath,
                    startLine: range.startLine,
                    endLine: range.endLine,
                    imports
                },
                [fn]
            );
            methodNameIndex.set(name, [
                ...(methodNameIndex.get(name) ?? []),
                id
            ]);
        }

        for (const cls of sourceFile.getClasses()) {
            const className = cls.getName() ?? "(default)";
            for (const method of cls.getMethods()) {
                const name = method.getName();
                const range = getNodeRange(method);
                const id = `method:${filePath}#${className}.${name}`;
                addDefinition(
                    definitions,
                    definitionIdByNode,
                    {
                        id,
                        name,
                        kind: "method",
                        filePath,
                        className,
                        startLine: range.startLine,
                        endLine: range.endLine,
                        imports
                    },
                    [method]
                );
                methodNameIndex.set(name, [
                    ...(methodNameIndex.get(name) ?? []),
                    id
                ]);
            }
        }

        for (const variableDecl of sourceFile.getVariableDeclarations()) {
            const name = variableDecl.getName();
            const initializer = variableDecl.getInitializer();
            if (!initializer) continue;
            if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) {
                continue;
            }

            const range = getNodeRange(variableDecl);
            const id = `function:${filePath}#${name}`;
            addDefinition(
                definitions,
                definitionIdByNode,
                {
                    id,
                    name,
                    kind: "function",
                    filePath,
                    startLine: range.startLine,
                    endLine: range.endLine,
                    imports
                },
                [variableDecl, initializer]
            );
            methodNameIndex.set(name, [
                ...(methodNameIndex.get(name) ?? []),
                id
            ]);
        }
    }

    return { definitions, definitionIdByNode, methodNameIndex };
}

function buildCallGraph(
    sourceFiles: SourceFile[],
    definitionIdByNode: Map<Node, string>,
    definitions: Map<string, DefinitionInfo>
) {
    const incoming = new Map<string, Set<string>>();

    for (const sourceFile of sourceFiles) {
        const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
        for (const call of calls) {
            const callerId = findCallerDefinitionId(call, definitionIdByNode);
            if (!callerId) continue;

            const symbol = getCallExpressionSymbol(call);
            if (!symbol) continue;

            const declarations = symbol.getDeclarations();
            if (!declarations || declarations.length === 0) continue;

            for (const decl of declarations) {
                const calleeId = definitionIdByNode.get(decl);
                if (!calleeId) continue;
                if (!definitions.has(calleeId)) continue;

                const callers = incoming.get(calleeId) ?? new Set<string>();
                callers.add(callerId);
                incoming.set(calleeId, callers);
            }
        }
    }

    return incoming;
}

function buildTraceNode(
    definitionId: string,
    definitions: Map<string, DefinitionInfo>,
    incoming: Map<string, Set<string>>,
    options: TraceOptions,
    path: Set<string>,
    depth: number
): TraceNode {
    const definition = definitions.get(definitionId);
    if (!definition) {
        throw new Error(`Definition not found for ${definitionId}`);
    }

    const node: TraceNode = {
        id: definition.id,
        name: definition.name,
        kind: definition.kind,
        filePath: definition.filePath,
        startLine: definition.startLine,
        endLine: definition.endLine,
        imports: definition.imports,
        callers: []
    };

    if (definition.className) {
        node.className = definition.className;
    }

    const maxDepth = options.maxDepth ?? Infinity;
    if (depth >= maxDepth) {
        return node;
    }

    const callers = incoming.get(definitionId);
    if (!callers || callers.size === 0) {
        return node;
    }

    for (const callerId of callers) {
        if (path.has(callerId)) {
            const callerDefinition = definitions.get(callerId);
            const cycleNode: TraceNode = {
                id: callerId,
                name: callerDefinition?.name ?? callerId,
                kind: callerDefinition?.kind ?? "function",
                filePath: callerDefinition?.filePath ?? "",
                imports: callerDefinition?.imports ?? {
                    external: [],
                    local: []
                },
                callers: [],
                cycle: true
            };

            if (callerDefinition?.className) {
                cycleNode.className = callerDefinition.className;
            }
            if (callerDefinition?.startLine !== undefined) {
                cycleNode.startLine = callerDefinition.startLine;
            }
            if (callerDefinition?.endLine !== undefined) {
                cycleNode.endLine = callerDefinition.endLine;
            }

            node.callers.push(cycleNode);
            continue;
        }

        const nextPath = new Set(path);
        nextPath.add(callerId);
        node.callers.push(
            buildTraceNode(callerId, definitions, incoming, options, nextPath, depth + 1)
        );
    }

    return node;
}

export function generateTrace(
    methodName: string,
    options: TraceOptions = {}
): TraceOutput {
    const projectRoot = process.cwd();
    const sourceDir = resolveSourceDir(projectRoot);
    const files = scanFiles(sourceDir).sort();

    const project = new Project({
        skipAddingFilesFromTsConfig: true,
        compilerOptions: {
            allowJs: true,
            checkJs: false,
            jsx: ts.JsxEmit.Preserve
        }
    });

    project.addSourceFilesAtPaths(files);

    const sourceFiles = project
        .getSourceFiles()
        .filter((file) => normalizePath(file.getFilePath()).includes(normalizePath(sourceDir)));

    const { definitions, definitionIdByNode, methodNameIndex } =
        collectDefinitions(sourceFiles, sourceDir);
    const incoming = buildCallGraph(sourceFiles, definitionIdByNode, definitions);

    const rootIds = methodNameIndex.get(methodName) ?? [];
    if (rootIds.length === 0) {
        throw new Error(`No local method or function found for name: ${methodName}`);
    }

    const roots = rootIds.map((id) =>
        buildTraceNode(id, definitions, incoming, options, new Set([id]), 0)
    );

    return {
        generatedAt: new Date().toISOString(),
        methodName,
        rootCount: roots.length,
        roots
    };
}

export function generateTraceToFile(
    methodName: string,
    options: TraceOptions = {},
    outputDir = DEFAULT_OUTPUT_DIR
): string {
    const trace = generateTrace(methodName, options);
    ensureDir(outputDir);
    const outputName = `trace-${sanitizeFileName(methodName)}.json`;
    const outputPath = path.join(outputDir, outputName);
    fs.writeFileSync(outputPath, JSON.stringify(trace, null, 2), "utf8");
    return outputPath;
}

if (require.main === module) {
    const methodName = getMethodName(process.argv[2]);
    const maxDepthRaw = process.argv[3];
    const maxDepth = maxDepthRaw ? Number(maxDepthRaw) : undefined;
    const options = maxDepth !== undefined ? { maxDepth } : {};
    const outputPath = generateTraceToFile(methodName, options, DEFAULT_OUTPUT_DIR);
    console.log("[trace] Output:", outputPath);
}
