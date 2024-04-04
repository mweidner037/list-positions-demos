import { TimestampFormatting } from "list-formatting";
import {
  List,
  MAX_POSITION,
  MIN_POSITION,
  Order,
  Position,
  positionEquals,
} from "list-positions";
import { maybeRandomString } from "maybe-random-string";
import { BlockMarker } from "../common/block_text";
import { Message } from "../common/messages";
import { ProseMirrorWrapper } from "./prosemirror_wrapper";

export class Suggestion {
  readonly container: HTMLDivElement;
  readonly wrapper: ProseMirrorWrapper;
  readonly messages: Message[] = [];

  /**
   * Our range in origin.list is described as an *open* interval (beforePos, afterPos).
   * Openness makes it easy to handle prepends and appends, but from the user's
   * perspective, a closed interval makes more sense.
   * To emulate that, we use hacked beforePos/afterPos that try to stay next to
   * the closed interval even when there are concurrent edits next to
   * our range in origin.list.
   */
  readonly beforePos: Position;
  readonly afterPos: Position;
  /**
   * The last block Position <= startPos.
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

    // Use a forked Order, for privacy (our metas are not synced until we merge the change)
    // and to prevent the origin from using one of our not-yet-synced metas as a dependency.
    const list = new List<string | BlockMarker>(new Order());
    list.order.load(origin.order.save());
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
    // OPT: only extract formatting spans in range.
    formatting.load(origin.formatting.save());

    // Set beforePos and afterPos.
    this.beforePos = this.createBeforePos(list.order, selStart);
    this.afterPos = this.createAfterPos(list.order, selEnd);

    // Construct our GUI.
    this.wrapper = new ProseMirrorWrapper(
      this.container,
      { refState: { list, formatting } },
      (msgs) => this.messages.push(...msgs),
      { beforePos: this.beforePos, afterPos: this.afterPos }
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

  private createBeforePos(order: Order, selStart: number): Position {
    // The first position in our list.
    const startPos = this.origin.list.positionAt(selStart);

    // Create a Position before startPos that is hacked to be closer to it
    // than almost any concurrent or future Position.
    // We do so by creating a left child whose bunchID (tiebreaker) starts with "|",
    // which is < all other default bunchID chars.

    // If this hack was used before, a sibling might already start with "|".
    // Use more "|"s than it.
    // (Technically, we only need to consider siblings with the same offset, but we're lazy.)
    let existingPipes = 0;
    const parent = order.getNodeFor(startPos);
    for (let i = 0; i < parent.childrenLength; i++) {
      const sibling = parent.getChild(i);
      let siblingPipes = 0;
      for (const char of sibling.bunchID) {
        if (char === "|") siblingPipes++;
      }
      existingPipes = Math.max(existingPipes, siblingPipes);
    }

    // Make a bunchID out of the pipes and a random string.
    const pipes = new Array(existingPipes + 1).fill("|").join("");
    const bunchID = pipes + maybeRandomString();

    // Use a crafted Order.createPositions call that creates a new bunch as a
    // left child of startPos, according to the Fugue algorithm.
    const [beforePos, newMeta] = order.createPositions(
      MIN_POSITION,
      startPos,
      1,
      { bunchID }
    );
    console.log(beforePos, newMeta);

    // TODO: use dedicated meta message instead of this empty set.
    this.messages.push({
      type: "set",
      startPos: beforePos,
      chars: "",
      meta: newMeta!,
    });
    return beforePos;
  }

  private createAfterPos(order: Order, selEnd: number): Position {
    // The last position in our list.
    const endPosIncl = this.origin.list.positionAt(selEnd - 1);

    // Create a Position after endPosIncl that is hacked to be closer to it
    // than almost any concurrent or future Position.
    // We do so by creating a right child whose bunchID (tiebreaker) starts with " ",
    // which is < all other default bunchID chars.

    // If this hack was used before, a sibling might already start with " ".
    // Use more " "s than it.
    // (Technically, we only need to consider siblings with the same offset, but we're lazy.)
    let existingSpaces = 0;
    const parent = order.getNodeFor(endPosIncl);
    for (let i = 0; i < parent.childrenLength; i++) {
      const sibling = parent.getChild(i);
      let siblingSpaces = 0;
      for (const char of sibling.bunchID) {
        if (char === " ") siblingSpaces++;
      }
      existingSpaces = Math.max(existingSpaces, siblingSpaces);
    }

    // Make a bunchID out of the pipes and a random string.
    const spaces = new Array(existingSpaces + 1).fill(" ").join("");
    const bunchID = spaces + maybeRandomString();

    // Use a crafted Order.createPositions call that creates a new bunch as a
    // right child of endPosIncl, according to the Fugue algorithm.
    const [afterPos, newMeta] = order.createPositions(
      endPosIncl,
      MAX_POSITION,
      1,
      { bunchID }
    );

    // TODO: use dedicated meta message instead of this empty set.
    this.messages.push({
      type: "set",
      startPos: afterPos,
      chars: "",
      meta: newMeta!,
    });
    return afterPos;
  }

  isInRange(pos: Position): boolean {
    return (
      this.wrapper.order.compare(this.beforePos, pos) < 0 &&
      this.wrapper.order.compare(pos, this.afterPos) < 0
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
            if (msg.meta) {
              this.wrapper.order.addMetas([msg.meta]);
            }
            // Note: this assumes a new position, so that it's either all in range or all not.
            if (this.isInRange(msg.startPos)) {
              this.wrapper.set(msg.startPos, msg.chars);
            }
            break;
          case "setMarker":
            // meta is already applied via the origin's set method.
            // TODO: for case of == this.firstBlockPos, if the suggestion has changed
            // the block type, ignore it so that the suggesion's addition can win?
            // Or re-do our own block marker set, so it will LWW win in the end.
            if (
              positionEquals(msg.pos, this.firstBlockPos) ||
              this.isInRange(msg.pos)
            ) {
              this.wrapper.setMarker(msg.pos, msg.marker);
            }
            break;
          case "delete":
            if (positionEquals(msg.pos, this.firstBlockPos)) {
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
            // OPT: only add formatting spans in range.
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
