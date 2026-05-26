export type TraceNodeKind = "function" | "method";

export type TraceImports = {
    external: string[];
    local: string[];
};

export type TraceNode = {
    id: string;
    name: string;
    kind: TraceNodeKind;
    filePath: string;
    className?: string;
    startLine?: number;
    endLine?: number;
    code?: string | undefined;
    imports: TraceImports;
    callers: TraceNode[];
    cycle?: boolean;
};

export type TraceOutput = {
    generatedAt: string;
    methodName: string;
    rootCount: number;
    roots: TraceNode[];
};
