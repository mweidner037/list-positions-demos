import {
  TimestampFormatting,
  TimestampMark,
  sliceFromSpan,
} from "list-formatting";
import { List, Order, Position } from "list-positions";
import { pcBaseKeymap } from "prosemirror-commands";
import { keydownHandler } from "prosemirror-keymap";
import { Fragment, Node, Slice } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import "prosemirror-view/style/prosemirror.css";
import { BlockMarker, BlockTextSavedState } from "../common/block_text";
import { schema } from "./schema";

export class ProsemirrorWrapper {
  readonly view: EditorView;

  // Read only; use our mutators instead, typically inside an update() call.
  readonly order: Order;
  readonly blockMarkers: List<BlockMarker>;
  readonly text: List<string>;
  readonly formatting: TimestampFormatting;

  // Block markers that we've rendered and whose block hasn't changed.
  // Entries are deleted when their block changes.
  private cachedBlocks = new Map<BlockMarker, Node>();

  /**
   *
   * @param initialState TODO: must include at least one block.
   */
  constructor(initialState: BlockTextSavedState) {
    this.order = new Order();
    this.blockMarkers = new List(this.order);
    this.text = new List(this.order);
    this.formatting = new TimestampFormatting(this.order);

    // Load initial state.
    this.order.load(initialState.order);
    this.blockMarkers.load(initialState.blockMarkers);
    this.text.load(initialState.text);
    this.formatting.load(initialState.formatting);

    // Setup ProseMirror.
    this.view = new EditorView(document.querySelector("#editor"), {
      state: EditorState.create({ schema }),
      handleKeyDown: keydownHandler(pcBaseKeymap),
      // Sync ProseMirror changes to our local state and the server.
      // TODO: uncomment
      // dispatchTransaction: this.onLocalTr.bind(this),
    });

    // Send initial state to ProseMirror.
    this.sync();
  }

  private isInUpdate = false;

  update(f: (wrapper: this) => void): void {
    if (this.isInUpdate) f(this);
    else {
      this.isInUpdate = true;
      try {
        f(this);
      } finally {
        this.isInUpdate = false;
        this.sync();
      }
    }
  }

  set(startPos: Position, chars: string): void {
    this.update(() => {
      // TODO: assumes usually newness / no splitting, so that chars
      // only belong to one block.
      this.text.set(startPos, ...chars);
      const blockIndex = this.blockMarkers.indexOfPosition(startPos, "left");
      this.cachedBlocks.delete(this.blockMarkers.getAt(blockIndex));
    });
  }

  setMarker(pos: Position, marker: BlockMarker): void {
    // TODO: assumes that marker does not already exist elsewhere, if non-redundant.
    if (!this.blockMarkers.has(pos)) {
      const prevBlockIndex = this.blockMarkers.indexOfPosition(pos, "left");
      if (prevBlockIndex !== -1) {
        // TODO: should inserting before the first block marker be allowed?
        this.cachedBlocks.delete(this.blockMarkers.getAt(prevBlockIndex));
      }
      this.blockMarkers.set(pos, marker);
    }
  }

  delete(pos: Position): void {
    this.update(() => {
      if (this.blockMarkers.has(pos)) {
        const blockIndex = this.blockMarkers.indexOfPosition(pos);
        if (blockIndex === 0) {
          throw new Error("Cannot delete the first block marker");
        }
        this.cachedBlocks.delete(this.blockMarkers.get(pos)!);
        this.cachedBlocks.delete(this.blockMarkers.getAt(blockIndex - 1));
        this.blockMarkers.delete(pos);
      } else if (this.text.has(pos)) {
        this.text.delete(pos);
        const blockIndex = this.blockMarkers.indexOfPosition(pos, "left");
        this.cachedBlocks.delete(this.blockMarkers.getAt(blockIndex));
      }
    });
  }

  addMark(mark: TimestampMark): void {
    this.update(() => {
      const changes = this.formatting.addMark(mark);
      if (changes.length !== 0) {
        // Mark was not completely redundant. Assume the whole span may have
        // changed and tell touched blocks to update.
        const { startIndex, endIndex } = sliceFromSpan(
          this.blockMarkers,
          mark.start,
          mark.end
        );
        for (const blockMarker of this.blockMarkers.values(
          startIndex,
          endIndex
        )) {
          this.cachedBlocks.delete(blockMarker);
        }
      }
    });
  }

  /**
   * Send our current BlockText state to ProseMirror.
   */
  private sync() {
    const nodes: Node[] = [];
    for (let b = 0; b < this.blockMarkers.length; b++) {
      const blockMarker = this.blockMarkers.getAt(b);
      const cached = this.cachedBlocks.get(blockMarker);
      if (cached !== undefined) {
        nodes.push(cached);
      } else {
        let node: Node;
        switch (blockMarker.type) {
          case "paragraph":
            const startIndex = this.text.indexOfPosition(
              this.blockMarkers.positionAt(b),
              "right"
            );
            const endIndex =
              b === this.blockMarkers.length - 1
                ? this.text.length
                : this.text.indexOfPosition(
                    this.blockMarkers.positionAt(b + 1),
                    "right"
                  );
            // TODO: use formatting. Needs formattedText() slice args.
            node = schema.node("paragraph", null, [
              schema.text(this.text.slice(startIndex, endIndex).join("")),
            ]);
            break;
          default:
            throw new Error(
              "Unsupported block marker: " + JSON.stringify(blockMarker)
            );
        }
        nodes.push(node);
        this.cachedBlocks.set(blockMarker, node);
      }
    }

    const doc = schema.node("doc", null, nodes);

    // Replace the whole state with doc, then restore the selection.
    // This strategy is borrowed from y-prosemirror.
    // Note: replacing the whole state has some downsides;
    // see https://github.com/yjs/y-prosemirror/issues/113
    // TODO: can we instead set the state directly?
    const tr = this.view.state.tr;
    tr.setMeta("ProseMirrorWrapper", true);
    tr.replace(0, tr.doc.nodeSize, new Slice(Fragment.from(doc), 0, 0));
    // TODO: restore selection, unless PM does for us; scrollIntoView?
    // Note that we must convert it to Positions at the start of update().

    this.view.dispatch(tr);
  }

  // private onLocalTr(tr: Transaction) {
  //   if (tr.getMeta("ProseMirrorWrapper")) {
  //     // Our own change; pass through.
  //     this.view.updateState(this.view.state.apply(tr));
  //     return;
  //   }

  //   // Apply to blockText, recording messages to send to the server.
  //   const messages: Message[] = [];
  //   for (let s = 0; s < tr.steps.length; s++) {
  //     const step = tr.steps[s];
  //     if (step instanceof ReplaceStep) {
  //       const fromIndex = this.textIndex(tr.docs[s], step.from);
  //       // Deletion
  //       if (step.from < step.to) {
  //         const toDelete = this.blockText.list.positions(
  //           fromIndex,
  //           this.textIndex(tr.docs[s], step.to)
  //         );
  //         for (const pos of toDelete) {
  //           messages.push({ type: "delete", pos });
  //           this.blockText.delete(pos);
  //         }
  //       }
  //       // Insertion
  //       const content = step.slice.content;
  //       if (content.childCount !== 0) {
  //         if (step.slice.openStart === 0 && step.slice.openEnd === 0) {
  //           // Insert children directly.
  //           this.insertInline(fromIndex, content, messages);
  //         } else if (step.slice.openStart === 1 && step.slice.openEnd === 1) {
  //           // Children are series of block nodes.
  //           // First's content is added to existing block; others create new
  //           // blocks, with last block getting the rest of the existing block's
  //           // content.
  //           let insIndex = fromIndex;
  //           for (let b = 0; b < content.childCount; b++) {
  //             const blockChild = content.child(b);
  //             if (blockChild.type.name !== "paragraph") {
  //               console.error(
  //                 "Warning: non-paragraph child in open slice (?)",
  //                 blockChild
  //               );
  //             }
  //             if (b !== 0) {
  //               // Insert new block marker before the block's content.
  //               const marker: BlockMarker = { type: blockChild.type.name };
  //               const [pos, createdBunch] = this.blockText.insertAt(
  //                 insIndex,
  //                 marker
  //               );
  //               messages.push({
  //                 type: "setMarker",
  //                 pos,
  //                 marker,
  //                 meta: createdBunch ?? undefined,
  //               });
  //               insIndex++;
  //             }
  //             insIndex = this.insertInline(
  //               insIndex,
  //               blockChild.content,
  //               messages
  //             );
  //           }
  //         } else console.error("Unsupported open start/end", step.slice);
  //       }
  //     } else {
  //       console.error("Unsupported step", step);
  //     }
  //   }

  //   // Tell the server.
  //   // TODO: group as tr.
  //   for (const message of messages) {
  //     this.send(message);
  //   }

  //   // Let ProseMirror apply the tr normally.
  //   this.view.updateState(this.view.state.apply(tr));
  // }

  // /**
  //  * @returns New insIndex
  //  */
  // private insertInline(
  //   insIndex: number,
  //   content: Fragment,
  //   messages: Message[]
  // ): number {
  //   for (let c = 0; c < content.childCount; c++) {
  //     const child = content.child(c);
  //     switch (child.type.name) {
  //       case "text":
  //         // Simple text insertion.
  //         const [startPos, createdBunch] = this.blockText.insertAt(
  //           insIndex,
  //           ...child.text!
  //         );
  //         insIndex += child.nodeSize;
  //         messages.push({
  //           type: "set",
  //           startPos,
  //           chars: child.text!,
  //           meta: createdBunch ?? undefined,
  //         });
  //         break;
  //       default:
  //         console.error("Unsupported child", child);
  //     }
  //   }
  //   return insIndex;
  // }

  // /**
  //  * Returns the index in blockText.list corresponding to the given ProseMirror
  //  * position.
  //  *
  //  * If pmPos points to (the start of) a block, the index points to that block's
  //  * marker.
  //  *
  //  * doc and this.blockText must be in sync.
  //  */
  // private textIndex(doc: Node, pmPos: number): number {
  //   const resolved = doc.resolve(pmPos);
  //   switch (resolved.parent.type.name) {
  //     case "doc": {
  //       // Block resolved.index(0). Return index of its block marker.
  //       const markerPos = this.blockText.blockMarkers.positionAt(
  //         resolved.index(0)
  //       );
  //       return this.blockText.list.indexOfPosition(markerPos);
  //     }
  //     case "paragraph": {
  //       // Block resolved.index(0), inline node resolved.index(1), char resolved.textOffset.
  //       // For insertions at the end of a text node, index(1) is one greater
  //       // (possibly out-of-bounds) and textOffset is 0.
  //       const pmBlock = resolved.parent;
  //       const blockPos = this.blockText.blockMarkers.positionAt(
  //         resolved.index(0)
  //       );
  //       // Total size of previous inline nodes.
  //       let prevInline = 0;
  //       for (let c = 0; c < resolved.index(1); c++) {
  //         prevInline += pmBlock.content.child(c).nodeSize;
  //       }
  //       // Add: Block marker index, 1 to move inside block, prevInline,
  //       // then offset into the (possibly out-of-bounds) actual inline node.
  //       return (
  //         this.blockText.list.indexOfPosition(blockPos) +
  //         1 +
  //         prevInline +
  //         resolved.textOffset
  //       );
  //     }
  //     default:
  //       throw new Error(
  //         "Unrecognized parent type: " + JSON.stringify(resolved.parent)
  //       );
  //   }
  // }

  save(): BlockTextSavedState {
    return {
      order: this.order.save(),
      blockMarkers: this.blockMarkers.save(),
      text: this.text.save(),
      formatting: this.formatting.save(),
    };
  }
}
