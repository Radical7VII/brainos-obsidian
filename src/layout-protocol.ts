import type { ForceOptions } from "./force-layout";
import type { GraphEdge, GraphNode, Point } from "./thoughts";

/** Shared transport contract for our layout worker and its main-thread owner. */
export type LayoutCommand =
  | { type: "sync"; revision: number; nodes: GraphNode[]; edges: GraphEdge[]; saved: Record<string, Point>; local: boolean }
  | { type: "configure"; options: Partial<ForceOptions> }
  | { type: "selected"; path: string | undefined }
  | { type: "pin" | "move"; path: string; point: Point }
  | { type: "unpin"; path: string }
  | { type: "reheat"; alpha: number }
  | { type: "reset" };
export type LayoutRequest = LayoutCommand & { commandVersion: number };
export type LayoutResult = { revision: number; commandVersion: number; positions: Float32Array; running: boolean };
