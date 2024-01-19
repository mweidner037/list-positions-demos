import { Message } from "../common/messages";
import { ProseMirrorWrapper } from "./prosemirror_wrapper";
import { Suggestion } from "./suggestion";

const wsURL = location.origin.replace(/^http/, "ws");
const ws = new WebSocket(wsURL);

const suggestionsDiv = document.getElementById("suggestions") as HTMLDivElement;

let wrapper!: ProseMirrorWrapper;
const suggestions = new Set<Suggestion>();

function welcomeListener(e: MessageEvent<string>) {
  const msg = JSON.parse(e.data) as Message;
  if (msg.type === "welcome") {
    // Got the initial state. Start Quill.
    ws.removeEventListener("message", welcomeListener);
    wrapper = new ProseMirrorWrapper(
      document.querySelector("#editor")!,
      { savedState: msg.savedState },
      onLocalChange
    );
    ws.addEventListener("message", (e: MessageEvent<string>) => {
      onWsMessage(e);
    });

    for (const type of ["h1", "h2", "ul", "ol"]) {
      document.getElementById("button_" + type)!.onclick = () =>
        setBlockType(type);
    }

    // Enable "suggest changes" button only when the selection is nontrivial.
    const suggestChanges = document.getElementById(
      "button_suggest"
    ) as HTMLButtonElement;
    wrapper.onSelectionChange = () => {
      const pmSel = wrapper.view.state.selection;
      suggestChanges.disabled = pmSel.from === pmSel.to;
    };
    suggestChanges.onclick = () => {
      const suggestion = new Suggestion(
        suggestionsDiv,
        wrapper,
        onAccept,
        onReject
      );
      suggestions.add(suggestion);
    };
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
  send(msgs);
  // TODO: use formatting spans to quickly get the affected suggestions,
  // instead of looping over all of them?
  // Or, only update the suggestions in view.
  // Likewise in onWsMessage.
  for (const suggestion of suggestions) suggestion.applyOriginMessages(msgs);
}

function send(msgs: Message[]): void {
  if (ws.readyState === WebSocket.OPEN) {
    for (const msg of msgs) {
      ws.send(JSON.stringify(msg));
    }
  }
}

// TODO: batch delivery, wrapped in wrapper.update().
function onWsMessage(e: MessageEvent<string>): void {
  const msg = JSON.parse(e.data) as Message;
  wrapper.applyMessage(msg);
  for (const suggestion of suggestions) suggestion.applyOriginMessages([msg]);
}

/**
 * Called when a suggested change is accepted, with the given changes.
 */
function onAccept(caller: Suggestion, msgs: Message[]): void {
  // Apply the changes locally.
  wrapper.update(() => {
    for (const msg of msgs) wrapper.applyMessage(msg);
  });

  // Apply the changes remotely.
  send(msgs);

  suggestions.delete(caller);
}

function onReject(caller: Suggestion): void {
  suggestions.delete(caller);
}

/**
 * Sets the currently selected block(s) to the given type.
 */
function setBlockType(type: string): void {
  // Cursors point to the Position on their left.
  // Affect all block markers between those immediately left (inclusive)
  // of anchor and head.
  const sel = wrapper.getSelection();
  let [start, end] = [sel.anchor, sel.head];
  if (wrapper.order.compare(start, end) > 0) [start, end] = [end, start];

  const startBlock = wrapper.blockMarkers.indexOfPosition(start, "left");
  const endBlock = wrapper.blockMarkers.indexOfPosition(end, "left");
  const entries = [...wrapper.blockMarkers.entries(startBlock, endBlock + 1)];

  // If they all have the given type, toggle it off. Else toggle it on.
  let allHaveType = true;
  for (const [, existing] of entries) {
    if (existing.type !== type) {
      allHaveType = false;
      break;
    }
  }
  const typeToSet = allHaveType ? "paragraph" : type;

  wrapper.update(() => {
    for (const [blockPos, existing] of wrapper.blockMarkers.entries(
      startBlock,
      endBlock + 1
    )) {
      if (existing.type !== typeToSet) {
        const marker = { ...existing, type: typeToSet };
        wrapper.setMarker(blockPos, marker);
        send([{ type: "setMarker", pos: blockPos, marker }]);
      }
    }
  });
}

// TODO: show suggestions as gray highlight in main doc; when a selection
// is focused, emphasize its highlight.
