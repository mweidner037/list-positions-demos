import { TimestampFormatting } from "list-formatting";
import {
  BunchMeta,
  BunchNode,
  List,
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
    // We use the fact that Order replicaIDs always use chars < "|".

    // Find the last left child of startPos, if any.
    const offset = 2 * startPos.innerIndex;
    const node = order.getNodeFor(startPos);
    let lastChild: BunchNode | null = null;
    for (let i = node.childrenLength - 1; i >= 0; i--) {
      const child = node.getChild(i);
      if (child.offset === offset) {
        lastChild = child;
        break;
      }
    }
    // If this hack was used before, lastChild might already start with a pipe.
    // Use one more pipe than it.
    let existingPipes = 0;
    if (lastChild !== null) {
      for (let i = 0; i < lastChild.bunchID.length; i++) {
        if (lastChild.bunchID[i] === "|") existingPipes++;
        else break;
      }
    }
    // Make a bunchID out of the pipes and a random string.
    const pipes = new Array(existingPipes + 1).fill("|").join("");
    const bunchID = pipes + maybeRandomString();
    // Create a bunch and record its BunchMeta.
    const meta: BunchMeta = {
      bunchID,
      parentID: node.bunchID,
      offset,
    };
    order.addMetas([meta]);

    const beforePos: Position = {
      bunchID,
      innerIndex: 0,
    };
    // TODO: use dedicated meta message instead of this empty set.
    this.messages.push({ type: "set", startPos: beforePos, chars: "", meta });
    return beforePos;
  }

  private createAfterPos(order: Order, selEnd: number): Position {
    // The last position in our list.
    const endPosIncl = this.origin.list.positionAt(selEnd - 1);

    // Create a Position after endPosIncl that is hacked to be closer to it
    // than almost any concurrent or future Position.
    // We use the fact that Order replicaIDs always use chars > " ".

    // Find the first right child of endPosIncl, if any.
    const offset = 2 * endPosIncl.innerIndex + 1;
    const node = order.getNodeFor(endPosIncl);
    let firstChild: BunchNode | null = null;
    for (let i = 0; i < node.childrenLength; i++) {
      const child = node.getChild(i);
      if (child.offset === offset) {
        firstChild = child;
        break;
      }
    }
    // If this hack was used before, firstChild might already start with a space.
    // Use one more space than it.
    let existingSpaces = 0;
    if (firstChild !== null) {
      for (let i = 0; i < firstChild.bunchID.length; i++) {
        if (firstChild.bunchID[i] === " ") existingSpaces++;
        else break;
      }
    }
    // Make a bunchID out of the spaces and a random string.
    const spaces = new Array(existingSpaces + 1).fill(" ").join("");
    const bunchID = spaces + maybeRandomString();
    // Create a bunch and record its BunchMeta.
    const meta: BunchMeta = {
      bunchID,
      parentID: node.bunchID,
      offset,
    };
    order.addMetas([meta]);

    const afterPos: Position = {
      bunchID,
      innerIndex: 0,
    };
    // TODO: use dedicated meta message instead of this empty set.
    this.messages.push({ type: "set", startPos: afterPos, chars: "", meta });
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
            // meta is already applied via the origin's set method.
            // Note: this assumes a new position, so it's either all in range or all not.
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
