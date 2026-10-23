import { forceOptionsFromSliders } from "./force-layout";

export type GraphOptions = {
  source: "vault" | "thoughts";
  hiddenPaths: string[];
  display: { nodeSizeMultiplier: number; lineSizeMultiplier: number; textFadeMultiplier: number; showArrows: boolean };
  forces: { center: number; repel: number; link: number; distance: number };
  filter: { showTags: boolean; showAttachments: boolean; showUnresolved: boolean; showOrphans: boolean; localDepth: number; localIncoming: boolean; localOutgoing: boolean };
};
export function defaultGraphOptions(): GraphOptions {
  return {
    source: "thoughts", hiddenPaths: [],
    display: { nodeSizeMultiplier: 1, lineSizeMultiplier: 1, textFadeMultiplier: 0, showArrows: false },
    forces: { center: 1 - Math.log(0.109) / Math.log(0.01), repel: 10, link: 1, distance: 250 },
    filter: { showTags: false, showAttachments: false, showUnresolved: true, showOrphans: true, localDepth: 1, localIncoming: true, localOutgoing: true },
  };
}
export function loadGraphOptions(value: unknown): GraphOptions {
  const defaults = defaultGraphOptions();
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const group = (key: string) => raw[key] && typeof raw[key] === "object" ? raw[key] as Record<string, unknown> : {};
  const display = group("display"), forces = group("forces"), filter = group("filter");
  const number = (record: Record<string, unknown>, key: string, fallback: number, min: number, max: number) => {
    const value = record[key]; return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  };
  const bool = (record: Record<string, unknown>, key: string, fallback: boolean) => typeof record[key] === "boolean" ? record[key] : fallback;
  return {
    source: raw.source === "vault" ? "vault" : "thoughts",
    hiddenPaths: Array.isArray(raw.hiddenPaths) ? raw.hiddenPaths.filter((path): path is string => typeof path === "string") : [],
    display: {
      nodeSizeMultiplier: number(display, "nodeSizeMultiplier", 1, 0.25, 3),
      lineSizeMultiplier: number(display, "lineSizeMultiplier", 1, 0.1, 5),
      textFadeMultiplier: number(display, "textFadeMultiplier", 0, -3, 3),
      showArrows: bool(display, "showArrows", false),
    },
    forces: {
      center: number(forces, "center", defaults.forces.center, 0, 1), repel: number(forces, "repel", 10, 0, 20),
      link: number(forces, "link", 1, 0, 1), distance: number(forces, "distance", 250, 30, 500),
    },
    filter: {
      showTags: bool(filter, "showTags", false), showAttachments: bool(filter, "showAttachments", false),
      showUnresolved: bool(filter, "showUnresolved", true), showOrphans: bool(filter, "showOrphans", true),
      localDepth: Math.round(number(filter, "localDepth", 1, 1, 5)),
      localIncoming: bool(filter, "localIncoming", true), localOutgoing: bool(filter, "localOutgoing", true),
    },
  };
}
export function graphForces(options: GraphOptions) { return forceOptionsFromSliders(options.forces); }
