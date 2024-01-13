import {
  TimestampFormatting,
  TimestampMark,
  sliceFromSpan,
} from "list-formatting";
import { BunchMeta, List, Order, Position } from "list-positions";
import { pcBaseKeymap } from "prosemirror-commands";
import { keydownHandler } from "prosemirror-keymap";
import { Fragment, Node, Slice } from "prosemirror-model";
import {
  EditorState,
  Selection,
  TextSelection,
  Transaction,
} from "prosemirror-state";
import { ReplaceStep } from "prosemirror-transform";
import { EditorView } from "prosemirror-view";
import "prosemirror-view/style/prosemirror.css";
import { BlockMarker, BlockTextSavedState } from "../common/block_text";
import { Message } from "../common/messages";
import { schema } from "./schema";

type ListSelection = {
  // TODO: NodeSelection, AllSelection
  type: "TextSelection";
  anchor: Position;
  head: Position;
};

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
   * @param initialState Must start with a block.
   * @param onLocalChange Callback for when the local user changes the state
   * (specifically, any ProseMirror tr that's not our own).
   * Gives the collaborative messages to send.
   * When this is called, the changes have been applied to this's state but not
   * synced to ProseMirror; you can override the changes by performing further
   * updates on this's state before returning.
   */
  constructor(
    initialState: BlockTextSavedState,
    readonly onLocalChange: (msgs: Message[]) => void
  ) {
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
      dispatchTransaction: this.onLocalTr.bind(this),
    });

    // Send initial state to ProseMirror.
    this.sync();
  }

  private isInUpdate = false;
  private storedSelection: ListSelection | null = null;

  update<R>(f: () => R): R {
    if (this.isInUpdate) return f();
    else {
      this.isInUpdate = true;
      this.storedSelection = this.getSelection();
      try {
        return f();
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
    this.update(() => {
      // TODO: assumes that marker does not already exist elsewhere, if non-redundant.
      if (!this.blockMarkers.has(pos)) {
        const prevBlockIndex = this.blockMarkers.indexOfPosition(pos, "left");
        if (prevBlockIndex !== -1) {
          // TODO: should inserting before the first block marker be allowed?
          this.cachedBlocks.delete(this.blockMarkers.getAt(prevBlockIndex));
        }
        this.blockMarkers.set(pos, marker);
      }
    });
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

  // TODO: will the non-combined lists cause issues for cursors?
  /**
   * Inserts after the given Position, before the next block marker or char.
   *
   * @param prevPos Usually either a block marker or char position.
   */
  insert(
    prevPos: Position,
    chars: string
  ): [startPos: Position, createdBunch: BunchMeta | null] {
    return this.update(() => {
      const [startPos, createdBunch] = this.order.createPositions(
        prevPos,
        this.nextPos(prevPos),
        chars.length
      );
      this.set(startPos, chars);
      return [startPos, createdBunch];
    });
  }

  /**
   * Inserts after the given Position, before the next block marker or char.
   *
   * @param prevPos Usually either a block marker or char position.
   */
  insertMarker(
    prevPos: Position,
    marker: BlockMarker
  ): [startPos: Position, createdBunch: BunchMeta | null] {
    return this.update(() => {
      const [startPos, createdBunch] = this.order.createPositions(
        prevPos,
        this.nextPos(prevPos),
        1
      );
      this.setMarker(startPos, marker);
      return [startPos, createdBunch];
    });
  }

  /**
   * Returns the next Position after pos in either this.text or this.blockMarkers,
   * or Order.MAX_POSITION if no such Position exists.
   *
   * Use for insertions.
   */
  nextPos(pos: Position): Position {
    const nextTextIndex = this.text.indexOfPosition(pos, "left") + 1;
    const nextTextPos =
      nextTextIndex === this.text.length
        ? Order.MAX_POSITION
        : this.text.positionAt(nextTextIndex);

    const nextMarkerIndex = this.blockMarkers.indexOfPosition(pos, "left") + 1;
    const nextMarkerPos =
      nextMarkerIndex === this.blockMarkers.length
        ? Order.MAX_POSITION
        : this.blockMarkers.positionAt(nextMarkerIndex);

    return this.order.compare(nextTextPos, nextMarkerPos) <= 0
      ? nextTextPos
      : nextMarkerPos;
  }

  /**
   * Returns the previous Position before pos in either this.text or this.blockMarkers,
   * or Order.MIN_POSITION if no such Position exists.
   *
   * Use for insertions.
   */
  prevPos(pos: Position): Position {
    const prevTextIndex = this.text.indexOfPosition(pos, "right") - 1;
    const prevTextPos =
      prevTextIndex === -1
        ? Order.MIN_POSITION
        : this.text.positionAt(prevTextIndex);

    const prevMarkerIndex = this.blockMarkers.indexOfPosition(pos, "right") - 1;
    const prevMarkerPos =
      prevMarkerIndex === this.blockMarkers.length
        ? Order.MIN_POSITION
        : this.blockMarkers.positionAt(prevMarkerIndex);

    return this.order.compare(prevTextPos, prevMarkerPos) >= 0
      ? prevTextPos
      : prevMarkerPos;
  }

  getSelection(pmSel = this.view.state.selection): ListSelection {
    if (pmSel instanceof TextSelection) {
      return {
        type: "TextSelection",
        anchor: this.prevPos(this.posFromPM(this.view.state.doc, pmSel.anchor)),
        head: this.prevPos(this.posFromPM(this.view.state.doc, pmSel.head)),
      };
    } else {
      console.error("Unsupported selection class", pmSel);
      // Jump to end.
      return {
        type: "TextSelection",
        anchor: Order.MAX_POSITION,
        head: Order.MAX_POSITION,
      };
    }
  }

  private toPmSelection(doc: Node, sel: ListSelection): Selection {
    switch (sel.type) {
      case "TextSelection":
        return TextSelection.create(
          doc,
          this.cursorFromPos(doc, sel.anchor),
          this.cursorFromPos(doc, sel.head)
        );
      default:
        throw new Error("Unrecognized ListSelection type: " + sel.type);
    }
  }

  setSelection(sel: ListSelection): void {
    // TODO: simpler tr, don't replace the whole state.
    this.update(() => {
      this.storedSelection = sel;
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
            const content: Node[] = [];
            if (startIndex < endIndex) {
              content.push(
                schema.text(this.text.slice(startIndex, endIndex).join(""))
              );
            }
            node = schema.node("paragraph", null, content);
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

    // Replace the whole doc content, then restore the selection.
    // This strategy is borrowed from y-prosemirror and also mentioned
    // by marijn: https://discuss.prosemirror.net/t/replacing-a-states-doc/634/14
    // However, it does have downsides: https://github.com/yjs/y-prosemirror/issues/113
    const tr = this.view.state.tr;
    tr.setMeta("ProseMirrorWrapper", true);
    tr.replace(0, tr.doc.content.size, new Slice(Fragment.from(nodes), 0, 0));

    tr.setSelection(this.toPmSelection(tr.doc, this.storedSelection!));
    this.storedSelection = null;
    // TODO: scrollIntoView like y-prosemirror?

    this.view.dispatch(tr);
  }

  private onLocalTr(tr: Transaction) {
    if (tr.getMeta("ProseMirrorWrapper")) {
      // Our own change; pass through.
      this.view.updateState(this.view.state.apply(tr));
      return;
    }
    if (tr.steps.length === 0) {
      // Doesn't affect content; pass through.
      // E.g. selection only change.
      this.view.updateState(this.view.state.apply(tr));
      return;
    }

    this.update(() => {
      // Apply to our state, recording messages for this.onLocalChange.
      const messages: Message[] = [];
      for (let s = 0; s < tr.steps.length; s++) {
        const step = tr.steps[s];
        if (step instanceof ReplaceStep) {
          const fromPos = this.posFromPM(tr.docs[s], step.from);
          // Tell the block before fromPos to update, since its content are about to change.
          this.cachedBlocks.delete(
            this.blockMarkers.getAt(
              this.blockMarkers.indexOfPosition(fromPos, "right") - 1
            )
          );

          // Deletion
          if (step.from < step.to) {
            const toPos = this.posFromPM(tr.docs[s], step.to);
            // text
            const textDelete = this.text.positions(
              this.text.indexOfPosition(fromPos, "right"),
              this.text.indexOfPosition(toPos, "right")
            );
            for (const pos of textDelete) {
              messages.push({ type: "delete", pos });
              this.text.delete(pos);
            }
            // blockMarkers
            const blockStartIndex = this.blockMarkers.indexOfPosition(
              fromPos,
              "right"
            );
            if (blockStartIndex === 0) {
              throw new Error("Cannot delete the first block marker");
            }
            const blockEndIndex = this.blockMarkers.indexOfPosition(
              toPos,
              "right"
            );
            const blockDelete = this.blockMarkers.positions(
              blockStartIndex,
              blockEndIndex
            );
            for (const pos of blockDelete) {
              messages.push({ type: "delete", pos });
              this.blockMarkers.delete(pos);
            }
            // Tell deleted blocks to update.
            for (const blockMarker of this.blockMarkers.values(
              blockStartIndex,
              blockEndIndex
            )) {
              this.cachedBlocks.delete(blockMarker);
            }
          }

          // Insertion
          const content = step.slice.content;
          if (content.childCount !== 0) {
            const insertNextPos = fromPos;
            let insertPrevPos = this.prevPos(insertNextPos);
            if (step.slice.openStart === 0 && step.slice.openEnd === 0) {
              // Insert children directly.
              this.insertInline(
                insertPrevPos,
                insertNextPos,
                content,
                messages
              );
            } else if (step.slice.openStart === 1 && step.slice.openEnd === 1) {
              // Children are series of block nodes.
              // First's content is added to existing block; others create new
              // blocks, with last block getting the rest of the existing block's
              // content.
              for (let b = 0; b < content.childCount; b++) {
                const blockChild = content.child(b);
                if (blockChild.type.name !== "paragraph") {
                  console.error(
                    "Warning: non-paragraph child in open slice (?)",
                    blockChild
                  );
                }
                if (b !== 0) {
                  // Insert new block marker before the block's content.
                  const marker: BlockMarker = { type: blockChild.type.name };
                  const [pos, createdBunch] = this.order.createPositions(
                    insertPrevPos,
                    insertNextPos,
                    1
                  );
                  insertPrevPos = pos;
                  this.blockMarkers.set(pos, marker);
                  messages.push({
                    type: "setMarker",
                    pos,
                    marker,
                    meta: createdBunch ?? undefined,
                  });
                }
                insertPrevPos = this.insertInline(
                  insertPrevPos,
                  insertNextPos,
                  blockChild.content,
                  messages
                );
              }
            } else console.error("Unsupported open start/end", step.slice);
          }
        } else {
          console.error("Unsupported step", step);
        }
      }

      this.onLocalChange(messages);
    });
    // End of update() causes changes to be synced to ProseMirror.
    // Nominally, we could just pass the tr to updateState, but using our own
    // sync() ensures that the state is exactly what we expect, and also gives
    // a uniform data flow for local vs remote updates.
  }

  /**
   * @returns New prevPos
   */
  private insertInline(
    prevPos: Position,
    nextPos: Position,
    content: Fragment,
    messages: Message[]
  ): Position {
    for (let c = 0; c < content.childCount; c++) {
      const child = content.child(c);
      switch (child.type.name) {
        case "text":
          // Simple text insertion.
          const [startPos, createdBunch] = this.order.createPositions(
            prevPos,
            nextPos,
            child.text!.length
          );
          prevPos = {
            // Last created Position.
            bunchID: startPos.bunchID,
            innerIndex: startPos.innerIndex + child.text!.length - 1,
          };
          this.text.set(startPos, ...child.text!);
          messages.push({
            type: "set",
            startPos,
            chars: child.text!,
            meta: createdBunch ?? undefined,
          });
          break;
        default:
          console.error("Unsupported child", child);
      }
    }
    return prevPos;
  }

  /**
   * Returns the Position in this.text or this.blockMarker corresponding to
   * the given ProseMirror position.
   *
   * If pmPos points to the start of a block,
   * the Position points to that block's marker.
   * If pmPos points to the end of a block (after its text),
   * the Position points to the next block's marker, as expected for insertions
   * before a Position.
   *
   * doc and this's state must be in sync.
   */
  private posFromPM(doc: Node, pmPos: number): Position {
    const resolved = doc.resolve(pmPos);
    switch (resolved.parent.type.name) {
      case "doc": {
        // Block resolved.index(0). Return Position of its block marker.
        return this.blockMarkers.positionAt(resolved.index(0));
      }
      case "paragraph": {
        // Block resolved.index(0), inline node resolved.index(1), char resolved.textOffset.
        // For insertions at the end of a text node, index(1) is one greater
        // (possibly out-of-bounds) and textOffset is 0.
        const pmBlock = resolved.parent;
        if (resolved.index(1) === pmBlock.content.childCount) {
          // Insertion is at the end of the block. Return Position of the next
          // block's marker, or Order.MAX_POSITION if there is no next block.
          return resolved.index(0) === this.blockMarkers.length - 1
            ? Order.MAX_POSITION
            : this.blockMarkers.positionAt(resolved.index(0) + 1);
        } else {
          const blockPos = this.blockMarkers.positionAt(resolved.index(0));
          // Start with the index of the block's first char in this.text.
          let textIndex = this.text.indexOfPosition(blockPos, "right");
          // Add total size of previous inline nodes.
          for (let c = 0; c < resolved.index(1); c++) {
            textIndex += pmBlock.content.child(c).nodeSize;
          }
          // Add offset within inline node.
          textIndex += resolved.textOffset;
          return this.text.positionAt(textIndex);
        }
      }
      default:
        throw new Error(
          "Unrecognized parent type: " + JSON.stringify(resolved.parent)
        );
    }
  }

  /**
   * Returns the ProseMirror position corresponding to a cursor at the given
   * Position (i.e., originally directly to the right of the Position's
   * char or block marker).
   */
  private cursorFromPos(doc: Node, pos: Position): number {
    // Locate the char/block that the cursor is bound to (on its left).
    const blockIndex = this.blockMarkers.indexOfPosition(pos, "left");
    const blockPos = this.blockMarkers.positionAt(blockIndex);
    const textIndex = this.text.indexOfPosition(pos, "left");
    const textPos =
      textIndex === -1 ? Order.MIN_POSITION : this.text.positionAt(textIndex);

    // +1 to enter doc, +1 to enter block.
    let blockStartPos = 2;
    for (let b = 0; b < blockIndex; b++) {
      blockStartPos += doc.content.child(b).nodeSize;
    }

    if (this.order.compare(blockPos, textPos) > 0) {
      // Bound to blockPos.
      // Cursor is at the start of the block.
      return blockStartPos;
    } else {
      // Bound to textPos.
      // Since blockPos < textPos, the char belongs to the block at blockIndex.
      const indexInBlock =
        textIndex - this.text.indexOfPosition(blockPos, "right");
      // Add 1 because the char is to the cursor's left.
      return blockStartPos + indexInBlock + 1;
    }
  }

  save(): BlockTextSavedState {
    return {
      order: this.order.save(),
      blockMarkers: this.blockMarkers.save(),
      text: this.text.save(),
      formatting: this.formatting.save(),
    };
  }
}
