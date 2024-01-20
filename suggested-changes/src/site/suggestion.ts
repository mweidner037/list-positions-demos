import { Anchors, TimestampFormatting } from "list-formatting";
import { List, Order, Position } from "list-positions";
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

  // We store the suggestion's range as an open interval (startPosExcl, endPosExcl).
  // This results in "expand = both" behavior, which is less nice than "expand = none".
  // However, it prevents issues where text appended (resp. prepended) to a suggestion
  // unexpectedly appears later in the document (since from this.wrapper's perspective,
  // it was inserted at the end of the list, hence can appear anywhere between the last
  // Position and Order.MAX_POSITION).
  readonly startPosExcl: Position;
  readonly endPosExcl: Position;
  /**
   * The block Position <= startPos.
   */
  firstBlockPos: Position;

  constructor(
    parent: HTMLElement,
    readonly origin: ProseMirrorWrapper,
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
    this.startPosExcl =
      selStart === 0
        ? Order.MIN_POSITION
        : origin.list.positionAt(selStart - 1);
    this.endPosExcl =
      selEnd === origin.list.length
        ? Order.MAX_POSITION
        : origin.list.positionAt(selEnd);

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
    this.firstBlockPos = origin.blockMarkers.positionAt(blockIndex);
    list.set(this.firstBlockPos, origin.blockMarkers.get(this.firstBlockPos)!);

    const formatting = new TimestampFormatting(list.order);
    // TODO: optimization: only extract formatting spans in range.
    formatting.load(origin.formatting.save());

    // Construct our GUI.
    this.wrapper = new ProseMirrorWrapper(
      this.container,
      { refState: { list, formatting } },
      this.onLocalChange.bind(this)
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

  private onLocalChange(msgs: Message[]): void {
    for (let msg of msgs) {
      if (msg.type === "mark") {
        // If the mark goes to the min/max anchors, modify it to instead go
        // up to startPosExcl/endPosExcl. Otherwise, when applied to the origin,
        // it will affect the whole rest of the text.
        const minStart = Anchors.equals(msg.mark.start, Anchors.MIN_ANCHOR);
        const maxEnd = Anchors.equals(msg.mark.end, Anchors.MAX_ANCHOR);
        if (minStart || maxEnd) {
          this.wrapper.deleteMark(msg.mark);
          msg = {
            ...msg,
            mark: {
              ...msg.mark,
              start: minStart
                ? { pos: this.startPosExcl, before: false }
                : msg.mark.start,
              end: maxEnd
                ? { pos: this.endPosExcl, before: true }
                : msg.mark.end,
            },
          };
          this.wrapper.addMark(msg.mark);
        }
      }
      this.messages.push(msg);
    }
  }

  isInRange(pos: Position): boolean {
    return (
      this.wrapper.order.compare(this.startPosExcl, pos) < 0 &&
      this.wrapper.order.compare(pos, this.endPosExcl) < 0
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
            if (
              Order.equalsPosition(msg.pos, this.firstBlockPos) ||
              this.isInRange(msg.pos)
            ) {
              this.wrapper.setMarker(msg.pos, msg.marker);
            }
            break;
          case "delete":
            if (Order.equalsPosition(msg.pos, this.firstBlockPos)) {
              // Before deleting, need to fill in the previous blockPos, so that
              // wrapper.list always starts with a block marker.
              const curIndex = this.origin.blockMarkers.indexOfPosition(
                this.firstBlockPos,
                "right"
              );
              this.firstBlockPos = this.origin.blockMarkers.positionAt(
                curIndex - 1
              );
              this.wrapper.setMarker(
                this.firstBlockPos,
                this.origin.blockMarkers.get(this.firstBlockPos)!
              );
            }
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
