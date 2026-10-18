import { ForceLayout, ForceOptions } from "./force-layout";
import type { GraphNode, GraphEdge, Point } from "./thoughts";

const layout = new ForceLayout();
let nodes: GraphNode[] = [];
let revision = 0;
let commandVersion = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(value: unknown, transfer?: Transferable[]): void;
};
function publish() {
  const positions = new Float32Array(nodes.length * 2);
  nodes.forEach((node, index) => { positions[index * 2] = node.x; positions[index * 2 + 1] = node.y; });
  scope.postMessage({ revision, commandVersion, positions, running: layout.isRunning }, [positions.buffer]);
}
function run() {
  timer = undefined;
  layout.tick(nodes);
  publish();
  if (layout.isRunning) timer = setTimeout(run, 1000 / 60);
}
function start() { if (timer === undefined) timer = setTimeout(run, 0); }

scope.onmessage = event => {
  const message = event.data;
  commandVersion = message.commandVersion;
  switch (message.type) {
    case "sync":
      revision = message.revision;
      nodes = message.nodes;
      layout.sync(nodes, message.edges as GraphEdge[], message.saved as Record<string, Point>);
      break;
    case "configure": layout.configure(message.options as Partial<ForceOptions>); break;
    case "selected": layout.setSelected(message.path); break;
    case "pin": layout.pin(message.path, message.point); break;
    case "move": layout.movePinned(message.path, message.point); break;
    case "unpin": layout.unpin(message.path); break;
    case "reheat": layout.reheat(message.alpha); break;
    case "reset": layout.reset(); break;
  }
  publish();
  if (layout.isRunning) start();
};
