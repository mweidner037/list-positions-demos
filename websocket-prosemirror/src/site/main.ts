import { Message } from "../common/messages";
import { ProsemirrorWrapper } from "./prosemirror_wrapper";

const wsURL = location.origin.replace(/^http/, "ws");
const ws = new WebSocket(wsURL);

function welcomeListener(e: MessageEvent<string>) {
  const msg = JSON.parse(e.data) as Message;
  if (msg.type === "welcome") {
    // Got the initial state. Start Quill.
    ws.removeEventListener("message", welcomeListener);
    new ProsemirrorWrapper(ws, msg);
  } else {
    console.error("Received non-welcome message first: " + msg.type);
  }
}
ws.addEventListener("message", welcomeListener);

// For this basic demo, we don't allow disconnection tests or
// attempt to reconnect the WebSocket ever.
// That would require buffering updates and/or logic to
// "merge" in the Welcome state received after reconnecting.
