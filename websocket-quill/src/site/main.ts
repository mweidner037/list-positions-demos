import { Message } from "../common/messages";
import { QuillWrapper } from "./quill_wrapper";

const wsURL = location.origin.replace(/^http/, "ws");
const ws = new WebSocket(wsURL);

function welcomeListener(e: MessageEvent<string>) {
  const msg = JSON.parse(e.data) as Message;
  if (msg.type === "welcome") {
    // Got the initial state. Start Quill.
    ws.removeEventListener("message", welcomeListener);
    new QuillWrapper(ws, msg);
  } else {
    console.error("Received non-welcome message first: " + msg.type);
  }
}
ws.addEventListener("message", welcomeListener);
