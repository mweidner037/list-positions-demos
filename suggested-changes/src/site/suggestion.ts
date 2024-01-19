import { TimestampFormatting } from "list-formatting";
import { List, Position } from "list-positions";
import { BlockMarker } from "../common/block_text";
import { Message } from "../common/messages";
import { ProseMirrorWrapper } from "./prosemirror_wrapper";

// TODO: a suggested formatting span with expansion will expand to also
// cover existing text before/after the suggestion's span. Need to
// remember neighboring chars somehow.

export class Suggestion {
  readonly container: HTMLDivElement;
  readonly wrapper: ProseMirrorWrapper;
  readonly messages: Message[] = [];

  readonly startPos: Position;
  /** Inclusive. */
  readonly endPosIncl: Position;

  constructor(
    parent: HTMLElement,
    origin: ProseMirrorWrapper,
    private readonly onAccept: (caller: Suggestion, msgs: Message[]) => void,
    private readonly onReject: (caller: Suggestion) => void
  ) {
    this.container = document.createElement("div");

    // Extract initial state: the selection in origin.
    let selStart = origin.list.indexOfCursor(origin.getSelection().anchor);
    let selEnd = origin.list.indexOfCursor(origin.getSelection().head);
    if (selStart > selEnd) [selStart, selEnd] = [selEnd, selStart];
    if (selStart === selEnd) {
      throw new Error("Selection is empty");
    }
    this.startPos = origin.list.positionAt(selStart);
    this.endPosIncl = origin.list.positionAt(selEnd - 1);

    const list = new List<string | BlockMarker>(origin.order);
    for (const [pos, value] of origin.list.entries(selStart, selEnd)) {
      list.set(pos, value);
    }
    // Also extract the block marker just before the selection, to format
    // the first block.
    const blockIndex = origin.blockMarkers.indexOfPosition(
      origin.list.positionAt(selStart),
      "left"
    );
    const blockPos = origin.blockMarkers.positionAt(blockIndex);
    list.set(blockPos, origin.blockMarkers.get(blockPos)!);

    const formatting = new TimestampFormatting(list.order);
    // TODO: optimization: only extract formatting spans in range.
    formatting.load(origin.formatting.save());

    // Construct our GUI.
    // TODO: separate .ProseMirror class (smaller, different bg color).
    this.wrapper = new ProseMirrorWrapper(
      this.container,
      { refState: { list, formatting } },
      (msgs) => this.messages.push(...msgs)
    );

    const buttonDiv = document.createElement("div");
    const acceptButton = document.createElement("button");
    acceptButton.innerText = "✅️";
    acceptButton.onclick = () => this.accept();
    buttonDiv.appendChild(acceptButton);
    // TODO: padding between
    const rejectButton = document.createElement("button");
    rejectButton.innerText = "❌️";
    rejectButton.onclick = () => this.reject();
    buttonDiv.appendChild(rejectButton);
    this.container.appendChild(buttonDiv);

    parent.appendChild(this.container);
  }

  isInRange(pos: Position): boolean {
    return (
      this.wrapper.order.compare(this.startPos, pos) <= 0 &&
      this.wrapper.order.compare(pos, this.endPosIncl) <= 0
    );
  }

  /**
   * Updates our state to reflect ops on the origin doc.
   */
  applyOriginMessages(msgs: Message[]): void {
    this.wrapper.update(() => {
      for (const msg of msgs) {
        switch (msg.type) {
          case "set":
            // meta is already applied via the origin's set method.
            // Note: this assumes a new position, so it's either all in range or all not.
            if (this.isInRange(msg.startPos)) {
              this.wrapper.set(msg.startPos, msg.chars);
            }
            break;
          case "setMarker":
            // meta is already applied via the origin's set method.
            // TODO: also capture updates to our marker.
            if (this.isInRange(msg.pos)) {
              this.wrapper.setMarker(msg.pos, msg.marker);
            }
            break;
          case "delete":
            // TODO: what if our marker is deleted and we need to back up to the previous marker?
            // Will currently throw error (can't delete starting marker).
            this.wrapper.delete(msg.pos);
            break;
          case "mark":
            // TODO: only add formatting spans in range.
            this.wrapper.addMark(msg.mark);
            break;
          default:
            console.error("Unexpected message type:", msg.type, msg);
        }
      }
    });
  }

  private accept(): void {
    this.onAccept(this, this.messages);
    this.destroy();
  }

  private reject(): void {
    this.onReject(this);
    this.destroy();
  }

  private destroy() {
    this.container.parentElement?.removeChild(this.container);
    this.wrapper.view.destroy();
  }
}
