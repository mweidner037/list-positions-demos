import { Message, Mutation } from "../common/messages";
import { ProseMirrorWrapper } from "./prosemirror_wrapper";

const wsURL = location.origin.replace(/^http/, "ws");
const ws = new WebSocket(wsURL);

function welcomeListener(e: MessageEvent<string>) {
  const msg = JSON.parse(e.data) as Message;
  if (msg.type === "welcome") {
    // Got the initial state. Start ProseMirror.
    ws.removeEventListener("message", welcomeListener);
    const wrapper = new ProseMirrorWrapper(onLocalMutation);
    wrapper.receive(msg.mutations);
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

function onLocalMutation(mutation: Mutation) {
  send([{ type: "mutation", mutation }]);
}

function send(msgs: Message[]): void {
  if (ws.readyState === WebSocket.OPEN) {
    for (const msg of msgs) {
      ws.send(JSON.stringify(msg));
    }
  }
}

// OPT: batch delivery, wrapped in wrapper.update().
function onMessage(e: MessageEvent<string>, wrapper: ProseMirrorWrapper): void {
  const msg = JSON.parse(e.data) as Message;
  switch (msg.type) {
    case "mutation":
      wrapper.receive([msg.mutation]);
      break;
    default:
      console.error("Unexpected message type:", msg.type, msg);
  }
}
