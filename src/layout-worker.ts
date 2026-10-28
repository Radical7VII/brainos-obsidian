import { LayoutClock } from "./layout-clock";
import { ForceLayout } from "./force-layout";
import type { GraphNode } from "./thoughts";
import type { LayoutRequest, LayoutResult } from "./layout-protocol";

const layout = new ForceLayout();
const clock = new LayoutClock();
let nodes: GraphNode[] = [];
let revision = 0;
let commandVersion = 0;
let timer: number | undefined;
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<LayoutRequest>) => void) | null;
  postMessage(value: LayoutResult, transfer?: Transferable[]): void;
};
function publish() {
  const positions = new Float32Array(nodes.length * 2);
  nodes.forEach((node, index) => { positions[index * 2] = node.x; positions[index * 2 + 1] = node.y; });
  scope.postMessage({ revision, commandVersion, positions, running: layout.isRunning }, [positions.buffer]);
}
function run() {
  timer = undefined;
  for (let steps = clock.advance(performance.now()); steps > 0; steps--) layout.tick(nodes);
  publish();
  if (layout.isRunning) timer = self.setTimeout(run, 1000 / 60);
  else clock.reset();
}
function start() { if (timer === undefined) timer = self.setTimeout(run, 0); }

scope.onmessage = event => {
  const message = event.data;
  commandVersion = message.commandVersion;
  switch (message.type) {
    case "sync":
      revision = message.revision;
      nodes = message.nodes;
      layout.sync(nodes, message.edges, message.saved, !!message.local);
      break;
    case "configure": layout.configure(message.options); break;
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
