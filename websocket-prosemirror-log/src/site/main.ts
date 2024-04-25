import { Message } from "../common/messages";
import { Mutation } from "../common/mutation";
import { ProseMirrorWrapper } from "./prosemirror_wrapper";
import { WebSocketClient } from "./web_socket_client";

const wsURL = location.origin.replace(/^http/, "ws");
const client = new WebSocketClient(wsURL);

client.onMessage = (data) => {
  const msg = JSON.parse(data) as Message;
  if (msg.type === "welcome") {
    // Got the initial state. Start ProseMirror.
    const wrapper = new ProseMirrorWrapper(onLocalMutation);
    wrapper.receive(msg.mutations);
    client.onMessage = (data) => onMessage(data, wrapper);
  } else {
    console.error("Received non-welcome message first: " + msg.type);
  }
};

function onMessage(data: string, wrapper: ProseMirrorWrapper): void {
  const msg = JSON.parse(data) as Message;
  switch (msg.type) {
    case "mutation":
      wrapper.receive([msg.mutation]);
      break;
    default:
      console.error("Unexpected message type:", msg.type, msg);
  }
}

function onLocalMutation(mutation: Mutation) {
  send([{ type: "mutation", mutation }]);
}

function send(msgs: Message[]): void {
  for (const msg of msgs) {
    client.send(JSON.stringify(msg));
  }
}

// --- "Connected" checkbox for testing concurrency ---

const connected = document.getElementById("connected") as HTMLInputElement;
connected.addEventListener("click", () => {
  client.testConnected = !client.testConnected;
});
