/** Read the DOM event directly: KeyboardEvent properties are on its prototype. */
export type TitleKeyAction = "commit" | "continue" | "cancel" | "none";
export function titleKeyAction(event: Pick<KeyboardEvent, "key" | "isComposing" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"> & {keyCode?: number}): TitleKeyAction {
  if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return "none";
  if (event.key === "Escape") return "cancel";
  if (event.key === "Enter") return "commit";
  if (event.key === "Tab" && !event.shiftKey) return "continue";
  return "none";
}
