import { Message } from "../common/messages";
import { ProsemirrorWrapper } from "./prosemirror_wrapper";

const wsURL = location.origin.replace(/^http/, "ws");
const ws = new WebSocket(wsURL);

function welcomeListener(e: MessageEvent<string>) {
  const msg = JSON.parse(e.data) as Message;
  if (msg.type === "welcome") {
    // Got the initial state. Start Quill.
    ws.removeEventListener("message", welcomeListener);
    const wrapper = new ProsemirrorWrapper(msg.savedState, onLocalChange);
    ws.addEventListener("message", (e: MessageEvent<string>) => {
      onMessage(e, wrapper);
    });
  } else {
    console.error("Received non-welcome message first: " + msg.type);
  }
}
ws.addEventListener("message", welcomeListener);

// For this basic demo, we don't allow disconnection tests or
// attempt to reconnect the WebSocket ever.
// That would require buffering updates and/or logic to
// "merge" in the Welcome state received after reconnecting.

function onLocalChange(msgs: Message[]) {
  if (ws.readyState === WebSocket.OPEN) {
    for (const msg of msgs) {
      ws.send(JSON.stringify(msg));
    }
  }
}

// TODO: batch delivery, wrapped in wrapper.update().
function onMessage(e: MessageEvent<string>, wrapper: ProsemirrorWrapper): void {
  const msg = JSON.parse(e.data) as Message;
  switch (msg.type) {
    case "set":
      if (msg.meta) wrapper.order.receive([msg.meta]);
      wrapper.set(msg.startPos, msg.chars);
      break;
    case "setMarker":
      if (msg.meta) wrapper.order.receive([msg.meta]);
      wrapper.setMarker(msg.pos, msg.marker);
      break;
    case "delete":
      wrapper.delete(msg.pos);
      break;
    case "mark":
      wrapper.addMark(msg.mark);
      break;
    default:
      console.error("Unexpected message type:", msg.type, msg);
  }
}
