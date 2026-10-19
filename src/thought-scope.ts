/** Match a directory boundary, including descendants but excluding similarly named siblings. */
export function isThoughtFile(path: string, folder = "") {
  const normalized = folder.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/{2,}/g, "/");
  if (normalized.split("/").some(part => part === "." || part === "..")) return false;
  return path.endsWith(".md") && (!normalized || path.startsWith(normalized + "/"));
}
