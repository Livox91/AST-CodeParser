import fs from "fs";
import path from "path";
import { Resvg } from "@resvg/resvg-js";
import type {
    GraphEdge,
    GraphEdgeType,
    GraphNode,
    GraphNodeType,
    GraphOutput
} from "../types/graphTypes";

type RenderOptions = {
    layout?: "dot" | "fdp" | "neato" | undefined;
    width?: number | undefined;
};

type GraphvizInstance = {
    layout: (dot: string, format: string, engine: string) => string | Promise<string>;
    load?: () => Promise<void>;
};

type GraphvizModule = {
    graphviz?: GraphvizInstance;
    Graphviz?: { load: () => Promise<GraphvizInstance> };
};

const DEFAULT_INPUT_PATH = path.resolve(process.cwd(), "output", "ast-graph.json");
const DEFAULT_OUTPUT_PATH = path.resolve(process.cwd(), "output", "ast-graph.png");

const NODE_STYLES: Record<GraphNodeType, { shape: string; stroke: string; fill: string }> = {
    file: { shape: "folder", stroke: "#1f2937", fill: "#e5e7eb" },
    class: { shape: "box", stroke: "#1d4ed8", fill: "#dbeafe" },
    function: { shape: "ellipse", stroke: "#047857", fill: "#d1fae5" },
    module: { shape: "octagon", stroke: "#7c2d12", fill: "#ffedd5" }
};

const EDGE_STYLES: Record<GraphEdgeType, { color: string }> = {
    contains: { color: "#94a3b8" },
    imports: { color: "#2563eb" },
    importsSymbol: { color: "#10b981" }
};

function escapeDot(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function dotId(value: string): string {
    return `"${escapeDot(value)}"`;
}

function readGraph(inputPath: string): GraphOutput {
    const raw = fs.readFileSync(inputPath, "utf8");
    return JSON.parse(raw) as GraphOutput;
}

function buildDot(graph: GraphOutput): string {
    const lines: string[] = [];

    lines.push("digraph AST {");
    lines.push("  rankdir=LR;");
    lines.push("  overlap=false;");
    lines.push("  splines=true;");
    lines.push("  node [style=filled, fontname=\"Segoe UI\", fontsize=11];");
    lines.push("  edge [fontname=\"Segoe UI\", fontsize=9, arrowsize=0.7];");

    for (const node of graph.nodes) {
        lines.push(buildDotNode(node));
    }

    for (const edge of graph.edges) {
        lines.push(buildDotEdge(edge));
    }

    lines.push("}");

    return lines.join("\n");
}

function buildDotNode(node: GraphNode): string {
    const style = NODE_STYLES[node.type];
    const label = escapeDot(node.label);
    return `  ${dotId(node.id)} [label=\"${label}\", shape=${style.shape}, color=\"${style.stroke}\", fillcolor=\"${style.fill}\"];`;
}

function buildDotEdge(edge: GraphEdge): string {
    const style = EDGE_STYLES[edge.type];
    const label = edge.type === "contains" ? "" : edge.label ?? "";
    const labelPart = label ? `, label=\"${escapeDot(label)}\"` : "";
    return `  ${dotId(edge.from)} -> ${dotId(edge.to)} [color=\"${style.color}\"${labelPart}];`;
}

function parseNumber(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

let graphvizInstance: GraphvizInstance | null = null;

async function getGraphvizInstance(): Promise<GraphvizInstance> {
    if (graphvizInstance) return graphvizInstance;

    const wasm = (await import("@hpcc-js/wasm")) as GraphvizModule;

    if (wasm.graphviz) {
        if (typeof wasm.graphviz.load === "function") {
            await wasm.graphviz.load();
        }
        graphvizInstance = wasm.graphviz;
        return graphvizInstance;
    }

    if (wasm.Graphviz?.load) {
        graphvizInstance = await wasm.Graphviz.load();
        return graphvizInstance;
    }

    throw new Error("Graphviz WASM module not available.");
}

async function renderSvg(dot: string, layout: RenderOptions["layout"]): Promise<string> {
    const graphviz = await getGraphvizInstance();
    const engine = layout ?? "dot";
    return await Promise.resolve(graphviz.layout(dot, "svg", engine));
}

function renderPng(svg: string, width?: number): Buffer {
    const resvg = new Resvg(svg, {
        fitTo: width ? { mode: "width", value: width } : { mode: "original" }
    });
    const pngData = resvg.render();
    return Buffer.from(pngData.asPng());
}

export async function generateGraphPng(
    inputPath = DEFAULT_INPUT_PATH,
    outputPath = DEFAULT_OUTPUT_PATH,
    options: RenderOptions = {}
): Promise<void> {
    const graph = readGraph(inputPath);
    const dot = buildDot(graph);
    const svg = await renderSvg(dot, options.layout);
    const png = renderPng(svg, options.width);

    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, png);

    console.log("[graph] PNG:", outputPath);
}

if (require.main === module) {
    const width = parseNumber(process.env.GRAPH_PNG_WIDTH);
    const layout = process.env.GRAPH_LAYOUT as RenderOptions["layout"] | undefined;

    generateGraphPng(DEFAULT_INPUT_PATH, DEFAULT_OUTPUT_PATH, { width, layout }).catch(
        (err) => {
            console.error("[graph] PNG generation failed:", err);
            process.exit(1);
        }
    );
}
