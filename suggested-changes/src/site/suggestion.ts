import { TimestampFormatting } from "list-formatting";
import { List } from "list-positions";
import { BlockMarker } from "../common/block_text";
import { Message } from "../common/messages";
import { ProseMirrorWrapper } from "./prosemirror_wrapper";

export class Suggestion {
  readonly container: HTMLDivElement;
  readonly wrapper: ProseMirrorWrapper;
  readonly messages: Message[] = [];

  constructor(parent: HTMLElement, origin: ProseMirrorWrapper) {
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

    parent.appendChild(this.container);
  }

  destroy() {
    this.container.parentElement?.removeChild(this.container);
  }

  // TODO: update in response to main-text changes in range.
}
