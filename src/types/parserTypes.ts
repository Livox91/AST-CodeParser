export type ImportInfo = {
    kind: "importDeclaration" | "importEquals";
    module: string;
    defaultImport: string | null;
    namespaceImport: string | null;
    namedImports: string[];
    isTypeOnly: boolean;
    startLine: number;
    endLine: number;
};

export type FunctionInfo = {
    name: string;
    kind: "function" | "arrow" | "functionExpression";
    isAsync: boolean;
    isExported: boolean;
    parameters: string[];
    startLine: number;
    endLine: number;
};

export type ClassInfo = {
    name: string;
    isExported: boolean;
    isAbstract: boolean;
    extends: string | null;
    implements: string[];
    methods: string[];
    properties: string[];
    startLine: number;
    endLine: number;
};

export type FileSummary = {
    path: string;
    imports: ImportInfo[];
    functions: FunctionInfo[];
    classes: ClassInfo[];
};

export type ParseOutput = {
    generatedAt: string;
    sourceDir: string;
    fileCount: number;
    files: FileSummary[];
};
