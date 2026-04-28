import fs from "fs";
import path from "path";
import { Node, Project, SyntaxKind, ts } from "ts-morph";
import type {
    ImportDeclaration,
    SourceFile,
    VariableDeclaration
} from "ts-morph";
import { scanFiles } from "../github/scanFiles";
import type {
    ClassInfo,
    FileSummary,
    FunctionInfo,
    ImportInfo,
    ParseOutput
} from "../types/parserTypes";

const OUTPUT_FILE_NAME = "ts-morph-output.json";

function normalizePath(value: string): string {
    return value.replace(/\\/g, "/");
}

function getNodeRange(node: Node) {
    return {
        startLine: node.getStartLineNumber(),
        endLine: node.getEndLineNumber()
    };
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

function extractImports(sourceFile: SourceFile): ImportInfo[] {
    const importDeclarations = sourceFile
        .getImportDeclarations()
        .map((decl: ImportDeclaration): ImportInfo => {
            const defaultImport = decl.getDefaultImport()?.getText() ?? null;
            const namespaceImport = decl.getNamespaceImport()?.getText() ?? null;
            const namedImports = decl.getNamedImports().map((named) => named.getName());

            return {
                kind: "importDeclaration" as const,
                module: decl.getModuleSpecifierValue(),
                defaultImport,
                namespaceImport,
                namedImports,
                isTypeOnly: decl.isTypeOnly(),
                ...getNodeRange(decl)
            };
        });

    const importEqualsDeclarations = sourceFile
        .getStatements()
        .filter(Node.isImportEqualsDeclaration)
        .map((decl): ImportInfo => ({
            kind: "importEquals" as const,
            module: decl.getModuleReference().getText(),
            defaultImport: null,
            namespaceImport: null,
            namedImports: [],
            isTypeOnly: false,
            ...getNodeRange(decl)
        }));

    return [...importDeclarations, ...importEqualsDeclarations];
}

function extractFunctions(sourceFile: SourceFile): FunctionInfo[] {
    const functionDeclarations = sourceFile.getFunctions().map((fn): FunctionInfo => ({
        name: fn.getName() ?? "(default)",
        kind: "function" as const,
        isAsync: fn.isAsync(),
        isExported: fn.isExported(),
        parameters: fn.getParameters().map((param) => param.getName()),
        ...getNodeRange(fn)
    }));

    const variableFunctions = sourceFile
        .getVariableDeclarations()
        .flatMap((decl: VariableDeclaration) => {
            const initializer = decl.getInitializer();

            if (!initializer) return [];
            if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) {
                return [];
            }

            const kind: FunctionInfo["kind"] = Node.isArrowFunction(initializer)
                ? "arrow"
                : "functionExpression";
            const statement = decl.getFirstAncestorByKind(SyntaxKind.VariableStatement);
            const isExported = statement?.isExported() ?? false;

            return [
                {
                    name: decl.getName(),
                    kind,
                    isAsync: initializer.isAsync(),
                    isExported,
                    parameters: initializer.getParameters().map((param) => param.getName()),
                    ...getNodeRange(decl)
                }
            ];
        });

    return [...functionDeclarations, ...variableFunctions];
}

function extractClasses(sourceFile: SourceFile): ClassInfo[] {
    return sourceFile.getClasses().map((cls): ClassInfo => ({
        name: cls.getName() ?? "(default)",
        isExported: cls.isExported(),
        isAbstract: cls.isAbstract(),
        extends: cls.getExtends()?.getText() ?? null,
        implements: cls.getImplements().map((impl) => impl.getText()),
        methods: cls.getMethods().map((method) => method.getName()),
        properties: cls.getProperties().map((prop) => prop.getName()),
        ...getNodeRange(cls)
    }));
}

function buildFileSummary(sourceFile: SourceFile, sourceDir: string): FileSummary {
    const relativePath = normalizePath(path.relative(sourceDir, sourceFile.getFilePath()));

    return {
        path: relativePath,
        imports: extractImports(sourceFile),
        functions: extractFunctions(sourceFile),
        classes: extractClasses(sourceFile)
    };
}

export async function runParser(): Promise<ParseOutput> {
    const projectRoot = process.cwd();
    const sourceDir = resolveSourceDir(projectRoot);
    const outputDir = path.resolve(projectRoot, "output");
    const sourceDirNormalized = normalizePath(sourceDir);

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

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
        .filter((file) => {
            const filePath = normalizePath(file.getFilePath());
            return (
                filePath === sourceDirNormalized ||
                filePath.startsWith(`${sourceDirNormalized}/`)
            );
        })
        .sort((a, b) =>
            normalizePath(a.getFilePath()).localeCompare(
                normalizePath(b.getFilePath())
            )
        );

    const output: ParseOutput = {
        generatedAt: new Date().toISOString(),
        sourceDir: sourceDirNormalized,
        fileCount: sourceFiles.length,
        files: sourceFiles.map((file) => buildFileSummary(file, sourceDir))
    };

    const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf8");

    console.log("[parser] Parsed files:", output.fileCount);
    console.log("[parser] Output:", outputPath);

    return output;
}

if (require.main === module) {
    runParser().catch((err) => {
        console.error("[parser] Error:", err);
        process.exit(1);
    });
}
