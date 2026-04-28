export type GraphNodeType = "file" | "class" | "function" | "module";

export type GraphEdgeType = "contains" | "imports" | "importsSymbol";

export type GraphNode = {
    id: string;
    type: GraphNodeType;
    label: string;
    filePath?: string;
};

export type GraphEdge = {
    from: string;
    to: string;
    type: GraphEdgeType;
    label?: string;
};

export type GraphOutput = {
    generatedAt: string;
    sourceJson: string;
    nodeCount: number;
    edgeCount: number;
    nodes: GraphNode[];
    edges: GraphEdge[];
};
