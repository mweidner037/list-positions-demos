import {
  TimestampFormatting,
  TimestampMark,
  diffFormats,
  spanFromSlice,
} from "@list-positions/formatting";
import {
  BunchMeta,
  List,
  Order,
  Position,
  positionEquals,
} from "list-positions";
import { pcBaseKeymap, toggleMark } from "prosemirror-commands";
import { keydownHandler } from "prosemirror-keymap";
import { Attrs, Fragment, Mark, Node, Slice } from "prosemirror-model";
import {
  AllSelection,
  EditorState,
  Selection,
  TextSelection,
  Transaction,
} from "prosemirror-state";
import {
  AddMarkStep,
  RemoveMarkStep,
  ReplaceStep,
} from "prosemirror-transform";
import { EditorView } from "prosemirror-view";
import { BlockMarker, BlockTextSavedState } from "../common/block_text";
import { Message } from "../common/messages";
import { schema } from "./schema";

import { maybeRandomString } from "maybe-random-string";
import "prosemirror-view/style/prosemirror.css";

const pmKey = "ProseMirrorWrapper";

export type ListSelection = {
  // We circumvent AllSelections; NodeSections appear unused.
  readonly type: "TextSelection";
  // A cursor in ProseMirrorWrapper.list.
  readonly anchor: Position;
  // A cursor in ProseMirrorWrapper.list.
  readonly head: Position;
};

export class ProseMirrorWrapper {
  readonly view: EditorView;

  // Read only; use our mutators instead, typically inside an update() call.
  readonly order: Order;
  /**
   * Chars + block markers in order.
   */
  readonly list: List<string | BlockMarker>;
  /**
   * Just block markers (subset of this.list).
   */
  readonly blockMarkers: List<BlockMarker>;
  readonly formatting: TimestampFormatting;

  private selection: ListSelection;

  // Block markers that we've rendered and whose block hasn't changed.
  // Entries are deleted when their block changes.
  private cachedBlocks = new Map<BlockMarker, Node>();

  /**
   * Lamport timestamp, used for block markers' LWW.
   */
  private timestamp = 0;
  private replicaID: string;

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
    this.list = new List(this.order);
    this.blockMarkers = new List(this.order);
    this.formatting = new TimestampFormatting(this.order);

    this.loadInternal(initialState);

    this.replicaID = maybeRandomString();

    // Set cursor to front of first char.
    this.selection = {
      type: "TextSelection",
      anchor: this.list.cursorAt(1),
      head: this.list.cursorAt(1),
    };

    // Setup ProseMirror.
    this.view = new EditorView(document.querySelector("#editor"), {
      state: EditorState.create({ schema }),
      handleKeyDown: keydownHandler({
        ...pcBaseKeymap,
        "Mod-i": toggleMark(schema.marks.em),
        "Mod-b": toggleMark(schema.marks.strong),
        // TODO: better list-enter behavior
      }),
      // Sync ProseMirror changes to our local state and the server.
      dispatchTransaction: this.onLocalTr.bind(this),
    });

    // Send initial state to ProseMirror.
    this.sync();
  }

  private isInUpdate = false;

  // TODO: consumer must be careful during an update (including onLocalChanges)
  // b/c this.view.state is not yet updated.
  // In onLocalChanges, we manually adjust methods like pmPosAt to use tr.doc,
  // but that is not the case during general updates.
  update<R>(f: () => R): R {
    if (this.isInUpdate) return f();
    else {
      this.isInUpdate = true;
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
      if (this.order.compare(startPos, this.blockMarkers.positionAt(0)) < 0) {
        throw new Error("Cannot set a Position before the first block");
      }
      this.list.set(startPos, ...chars);
      this.markDirty(startPos, {
        bunchID: startPos.bunchID,
        innerIndex: startPos.innerIndex + Math.max(0, chars.length - 1),
      });
    });
  }

  /**
   * marker notes:
   * - Different Positions cannot share the same marker object.
   * - Don't mutate it internally.
   * - Position cannot change from char <-> marker over time.
   */
  setMarker(pos: Position, marker: BlockMarker): void {
    this.update(() => {
      if (this.order.compare(pos, this.blockMarkers.positionAt(0)) < 0) {
        throw new Error("Cannot set a Position before the first block");
      }
      const had = this.blockMarkers.has(pos);
      if (had) {
        const existing = this.blockMarkers.get(pos)!;
        if (
          existing.timestamp > marker.timestamp ||
          (existing.timestamp === marker.timestamp &&
            existing.creatorID > marker.creatorID)
        ) {
          // Existing timestamp wins by the LWW rule - ignore.
          return;
        }
      }
      this.list.set(pos, marker);
      this.blockMarkers.set(pos, marker);
      this.timestamp = Math.max(this.timestamp, marker.timestamp);
      if (!had) {
        // Mark the previous block marker as dirty, since its block was split.
        this.markDirty(pos);
      }
      // Else marker is a new value - automatically dirty b/c not in cache.
    });
  }

  delete(pos: Position): void {
    this.update(() => {
      if (this.list.has(pos)) {
        if (positionEquals(pos, this.blockMarkers.positionAt(0))) {
          throw new Error("Cannot delete the first block marker");
        }
        this.list.delete(pos);
        // Okay if not actually a blockMarker pos - will do nothing.
        this.blockMarkers.delete(pos);
        this.markDirty(pos);
      }
    });
  }

  insertAt(
    listIndex: number,
    chars: string
  ): [startPos: Position, createdBunch: BunchMeta | null] {
    return this.update(() => {
      if (listIndex === 0) {
        throw new Error("Cannot insert before the first block");
      }
      const [startPos, createdBunch] = this.list.insertAt(listIndex, ...chars);
      // Since the Positions are new, their can't be any blocks in the middle:
      // don't need to provide endPos.
      this.markDirty(startPos);
      return [startPos, createdBunch];
    });
  }

  insertMarkerAt(
    listIndex: number,
    marker: BlockMarker
  ): [pos: Position, createdBunch: BunchMeta | null] {
    return this.update(() => {
      if (listIndex === 0) {
        throw new Error("Cannot insert before the first block");
      }
      const [pos, createdBunch] = this.list.insertAt(listIndex, marker);
      this.blockMarkers.set(pos, marker);
      this.markDirty(pos);
      return [pos, createdBunch];
    });
  }

  addMark(mark: TimestampMark): void {
    this.update(() => {
      const changes = this.formatting.addMark(mark);
      if (changes.length !== 0) {
        // Mark was not completely redundant. Assume the whole span may have
        // changed (plus endpoints) and tell touched blocks to update.
        this.markDirty(mark.start.pos, mark.end.pos);
      }
    });
  }

  /**
   * Marks all Positions in the range [startPos, endPos ?? startPos] dirty,
   * so that their blocks will be rerendered on the next sync().
   *
   * If startPos is a block marker pos, the previous block also gets marked dirty.
   *
   * Okay to overshoot - will just rerender some blocks redundantly.
   */
  private markDirty(startPos: Position, endPos = startPos): void {
    const blockStart = Math.max(
      0,
      // If startPos is/was a block, this will catch the previous block,
      // in case it's been split/merged.
      this.blockMarkers.indexOfPosition(startPos, "right") - 1
    );
    // Inclusive.
    // OPT: Avoid second indexOfPosition call if endPos = undefined/startPos.
    // (Need to check if pos is a blockMarker due to right/left difference.)
    const blockEnd = Math.min(
      this.blockMarkers.length - 1,
      this.blockMarkers.indexOfPosition(endPos, "left")
    );
    for (const blockMarker of this.blockMarkers.values(
      blockStart,
      blockEnd + 1
    )) {
      this.cachedBlocks.delete(blockMarker);
    }
  }

  getSelection(): ListSelection {
    return this.selection;
  }

  /**
   * If inside this.update, will wait to sync to ProseMirror until the
   * end of the update. Otherwise syncs immediately.
   */
  setSelection(selection: ListSelection): void {
    this.selection = selection;
    if (!this.isInUpdate) {
      // Sync to ProseMirror.
      const tr = this.view.state.tr;
      tr.setMeta(pmKey, true);
      tr.setSelection(this.pmSelectionFromList(tr.doc, this.selection));
      this.view.dispatch(tr);
    }
  }

  save(): BlockTextSavedState {
    const text = new List<string | BlockMarker>();
    text.load(this.list.save());
    for (const pos of this.blockMarkers.positions()) text.delete(pos);

    return {
      order: this.order.save(),
      blockMarkers: this.blockMarkers.save(),
      text: (text as List<string>).save(),
      formatting: this.formatting.save(),
    };
  }

  load(savedState: BlockTextSavedState): void {
    this.update(() => {
      this.loadInternal(savedState);
      this.cachedBlocks.clear();
      // Reset cursor to front of first char.
      this.selection = {
        type: "TextSelection",
        anchor: this.list.cursorAt(1),
        head: this.list.cursorAt(1),
      };
    });
  }

  private loadInternal(savedState: BlockTextSavedState): void {
    this.order.load(savedState.order);
    this.list.load(savedState.text);
    this.blockMarkers.load(savedState.blockMarkers);
    for (const [pos, marker] of this.blockMarkers.entries()) {
      this.list.set(pos, marker);
    }
    this.formatting.load(savedState.formatting);

    if (this.list.length === 0 || typeof this.list.getAt(0) !== "object") {
      throw new Error("Loaded state does not start with a block marker");
    }
  }

  /**
   * Send our current BlockText state to ProseMirror.
   */
  private sync() {
    const nodes: Node[] = [];
    let nextOl = 1;
    for (let b = 0; b < this.blockMarkers.length; b++) {
      const blockMarker = this.blockMarkers.getAt(b);
      let node: Node;

      const cached = this.cachedBlocks.get(blockMarker);
      if (cached !== undefined) {
        node = cached;
      } else {
        const textStart =
          this.list.indexOfPosition(this.blockMarkers.positionAt(b), "right") +
          1;
        const textEnd =
          b === this.blockMarkers.length - 1
            ? this.list.length
            : this.list.indexOfPosition(this.blockMarkers.positionAt(b + 1));
        const content = this.formatting
          .formattedSlices(this.list, textStart, textEnd)
          .map((slice) => {
            const marks: Mark[] = [];
            for (const [key, value] of Object.entries(slice.format)) {
              marks.push(schema.mark(key));
            }
            return schema.text(
              // Since we apply formattedSlices to the text in a single block,
              // these values are all chars.
              this.list.slice(slice.startIndex, slice.endIndex).join(""),
              marks
            );
          });

        let attrs: Attrs | null = null;
        switch (blockMarker.type) {
          case "ul":
            attrs = { symbol: "•" };
            break;
          // case "ol" is handled later.
        }

        node = schema.node(blockMarker.type, attrs, content);
      }

      // For "ol" nodes, ensure the symbol (count) is correct, even if not
      // dirty - it may have changed because of an earlier dirty node.
      if (node.type.name === "ol") {
        const symbol = nextOl + ".";
        if (node.attrs["symbol"] !== symbol) {
          node = node.type.create(
            { ...node.attrs, symbol },
            node.content,
            node.marks
          );
        }
        nextOl++;
      } else nextOl = 1;

      if (node !== cached) this.cachedBlocks.set(blockMarker, node);
      nodes.push(node);
    }

    // Replace the whole doc content, then restore the selection.
    // This strategy is borrowed from y-prosemirror and also mentioned
    // by marijn: https://discuss.prosemirror.net/t/replacing-a-states-doc/634/14
    // However, it does have downsides: https://github.com/yjs/y-prosemirror/issues/113
    const tr = this.view.state.tr;
    tr.setMeta(pmKey, true);
    tr.replace(0, tr.doc.content.size, new Slice(Fragment.from(nodes), 0, 0));
    tr.setSelection(this.pmSelectionFromList(tr.doc, this.selection));

    this.view.dispatch(tr);
  }

  private onLocalTr(tr: Transaction) {
    if (tr.getMeta(pmKey)) {
      // Our own change; pass through.
      this.view.updateState(this.view.state.apply(tr));
      return;
    }

    if (tr.selectionSet) {
      // Ban AllSelection, since we don't handle it
      // (in listSelectionFromPm, and in future local trs that delete it -
      // those use a step.from of 0 and a block child).
      if (tr.selection instanceof AllSelection) {
        tr.setSelection(TextSelection.create(tr.doc, 1, tr.doc.nodeSize - 3));
      }
    }

    if (tr.steps.length === 0) {
      // Doesn't affect content; pass through.
      // E.g. selection-only change.
      this.selection = this.listSelectionFromPm(tr.doc, tr.selection);
      this.view.updateState(this.view.state.apply(tr));
      return;
    }

    this.update(() => {
      // Apply to our state, recording messages for this.onLocalChange.
      const messages: Message[] = [];
      for (let s = 0; s < tr.steps.length; s++) {
        const step = tr.steps[s];
        if (step instanceof ReplaceStep) {
          const fromIndex = this.indexOfPmPos(tr.docs[s], step.from);
          if (fromIndex === 0) {
            throw new Error(
              "ReplaceStep: Our fromIndex is 0 (insert/delete before first block marker"
            );
          }

          // Deletion
          if (step.from < step.to) {
            const toIndex = this.indexOfPmPos(tr.docs[s], step.to);
            const toDelete = [...this.list.positions(fromIndex, toIndex)];
            for (const pos of toDelete) {
              messages.push({ type: "delete", pos });
              this.list.delete(pos);
              this.blockMarkers.delete(pos);
            }
            this.markDirty(toDelete[0], toDelete[toDelete.length - 1]);
          }

          // Insertion
          const content = step.slice.content;
          if (content.childCount !== 0) {
            if (step.slice.openStart === 0 && step.slice.openEnd === 0) {
              // Insert children directly. Only dirties containing block.
              this.insertInline(fromIndex, content, messages);
            } else if (step.slice.openStart === 1 && step.slice.openEnd === 1) {
              // Children are series of block nodes.
              // First's content is added to existing block; others create new
              // blocks, with last block getting the rest of the existing block's
              // content.
              let insIndex = fromIndex;
              for (let b = 0; b < content.childCount; b++) {
                const blockChild = content.child(b);
                if (b !== 0) {
                  // Insert new block marker before the block's content.
                  const marker: BlockMarker = {
                    type: blockChild.type.name,
                    timestamp: ++this.timestamp,
                    creatorID: this.replicaID,
                  };
                  const [pos, createdBunch] = this.list.insertAt(
                    insIndex,
                    marker
                  );
                  insIndex++;
                  this.blockMarkers.set(pos, marker);
                  messages.push({
                    type: "setMarker",
                    pos,
                    marker,
                    meta: createdBunch ?? undefined,
                  });
                }
                insIndex = this.insertInline(
                  insIndex,
                  blockChild.content,
                  messages
                );
              }
            } else console.error("Unsupported open start/end", step.slice);
            // Mark block containing the first inserted value dirty.
            // New blocks are automatically dirty b/c not in cache.
            this.markDirty(this.list.positionAt(fromIndex));
          }
        } else if (
          step instanceof AddMarkStep ||
          step instanceof RemoveMarkStep
        ) {
          const fromIndex = this.indexOfPmPos(tr.docs[s], step.from);
          const toIndex = this.indexOfPmPos(tr.docs[s], step.to);

          const span = spanFromSlice(this.list, fromIndex, toIndex, "after");
          const mark = this.formatting.newMark(
            span.start,
            span.end,
            step.mark.type.name,
            step instanceof AddMarkStep ? true : null
          );
          this.formatting.addMark(mark);
          messages.push({ type: "mark", mark });

          // AddMarkSteps give a separate step per block, but RemoveMarkSteps don't.
          // For simplicity, mark the whole span dirty regardless.
          this.markDirty(
            this.list.positionAt(fromIndex),
            this.list.positionAt(toIndex - 1)
          );
        } else {
          console.error("Unsupported step", step);
          // TODO: Saw ReplaceAroundStep once, but not sure how it arised.
          // (Multiple enters at end of a paragraph?)
        }
      }

      // Set our selection to match ProseMirror's.
      this.selection = this.listSelectionFromPm(tr.doc, tr.selection);

      // Notify consumer of changes and give them a chance to alter them
      // before sync().
      this.onLocalChange(messages);
    });
    // End of update() causes changes to be synced to ProseMirror.
    // Nominally, we could just pass the tr to updateState, but using our own
    // sync() ensures that the state is exactly what we expect, and also gives
    // a uniform data flow for local vs remote updates.
  }

  /**
   * Note: This does not call markDirty.
   *
   * @returns New insertion index (after inserted content).
   */
  private insertInline(
    index: number,
    content: Fragment,
    messages: Message[]
  ): number {
    for (let c = 0; c < content.childCount; c++) {
      const child = content.child(c);
      switch (child.type.name) {
        case "text":
          // Simple text insertion.
          const [startPos, createdBunch] = this.list.insertAt(
            index,
            ...child.text!
          );
          messages.push({
            type: "set",
            startPos,
            chars: child.text!,
            meta: createdBunch ?? undefined,
          });

          // Match marks.
          // Since the text uses new Positions, it all has the same format.
          const pmFormat: Record<string, any> = {};
          for (const mark of child.marks) {
            pmFormat[mark.type.name] = true;
          }
          const needsFormat = diffFormats(
            this.formatting.getFormat(startPos),
            pmFormat
          );
          for (const [key, value] of needsFormat) {
            const span = spanFromSlice(
              this.list,
              index,
              index + child.text!.length,
              "after"
            );
            const mark = this.formatting.newMark(
              span.start,
              span.end,
              key,
              value
            );
            this.formatting.addMark(mark);
            messages.push({
              type: "mark",
              mark,
            });
          }

          index += child.text!.length;
          break;
        default:
          console.error("Unsupported child", child);
      }
    }
    return index;
  }

  /**
   * Returns the index in this.list corresponding to
   * the given ProseMirror position.
   *
   * - If pmPos points to the end of a block (after its text),
   * the index points to the next block's marker, as expected for insertions
   * before a Position.
   * - If pmPos points to the start of a block,
   * the index points to that block's marker. (Not expected to occur;
   * pmPosAt doesn't invert this case.)
   *
   * @param doc Must be in sync with this.list.
   */
  private indexOfPmPos(doc: Node, pmPos: number): number {
    const resolved = doc.resolve(pmPos);
    if (resolved.parent.type.name === "doc") {
      // Block resolved.index(0). Return index of its block marker.
      // For a cursor at the end of the text, index(0) is out-of-bounds.
      return resolved.index(0) === resolved.parent.childCount
        ? this.list.length
        : this.list.indexOfPosition(
            this.blockMarkers.positionAt(resolved.index(0))
          );
    } else if (resolved.parent.type.spec.group === "block") {
      // Block resolved.index(0), inline node resolved.index(1), char resolved.textOffset.
      // For insertions at the end of a text node, index(1) is one greater
      // (possibly out-of-bounds) and textOffset is 0.
      const pmBlock = resolved.parent;
      if (resolved.index(1) === pmBlock.content.childCount) {
        // Insertion is at the end of the block. Return Position of the next
        // block's marker, or length if there is no next block.
        return resolved.index(0) === this.blockMarkers.length - 1
          ? this.list.length
          : this.list.indexOfPosition(
              this.blockMarkers.positionAt(resolved.index(0) + 1)
            );
      } else {
        const blockPos = this.blockMarkers.positionAt(resolved.index(0));
        // Start with the index of the block's first char in this.list.
        let listIndex = this.list.indexOfPosition(blockPos) + 1;
        // Add total size of previous inline nodes.
        for (let c = 0; c < resolved.index(1); c++) {
          listIndex += pmBlock.content.child(c).nodeSize;
        }
        // Add offset within inline node.
        listIndex += resolved.textOffset;
        return listIndex;
      }
    } else {
      throw new Error(
        "Unrecognized parent type: " + JSON.stringify(resolved.parent)
      );
    }
  }

  /**
   * Returns the ProseMirror position corresponding to the given index
   * in this.list.
   *
   * If listIndex points to a block marker, the ProseMirror position points
   * to the end of the previous block (except for the first block).
   *
   * @param doc Must be in sync with this.list.
   */
  private pmPosAt(doc: Node, listIndex: number): number {
    if (listIndex === 0) {
      // Point to start of the first block.
      return 0;
    }
    if (listIndex === this.list.length) {
      // Insertion/cursor at end of text. Point to 1 after the last char
      // in the last block.
      return doc.content.size - 1;
    }

    let pmPos = 0;
    const pos = this.list.positionAt(listIndex);
    // The index of the block containing pos.
    // If pos points to a blockMarker, we consider it part of the previous block.
    const blockIndex = this.blockMarkers.indexOfPosition(pos, "right") - 1;
    // Add the size of all blocks before the one containing pos.
    for (let b = 0; b < blockIndex; b++) {
      pmPos += doc.child(b).nodeSize;
    }
    // Add 1 to enter the block containing pos.
    pmPos++;
    // Add pos's index within its block.
    const blockStart = this.list.indexOfPosition(
      this.blockMarkers.positionAt(blockIndex)
    );
    pmPos += listIndex - blockStart - 1;
    return pmPos;
  }

  /**
   *
   *
   * @param doc Must be in sync with this.list.
   */
  private listSelectionFromPm(doc: Node, pmSel: Selection): ListSelection {
    if (pmSel instanceof TextSelection) {
      return {
        type: "TextSelection",
        anchor: this.list.cursorAt(this.indexOfPmPos(doc, pmSel.anchor)),
        head: this.list.cursorAt(this.indexOfPmPos(doc, pmSel.head)),
      };
    } else {
      console.error("Unsupported selection class", pmSel);
      // Jump to beginning.
      return {
        type: "TextSelection",
        anchor: this.blockMarkers.cursorAt(1),
        head: this.blockMarkers.cursorAt(1),
      };
    }
  }

  /**
   *
   *
   * @param doc Must be in sync with this.list.
   */
  private pmSelectionFromList(doc: Node, sel: ListSelection): Selection {
    switch (sel.type) {
      case "TextSelection":
        return TextSelection.create(
          doc,
          this.pmPosAt(doc, this.list.indexOfCursor(sel.anchor)),
          this.pmPosAt(doc, this.list.indexOfCursor(sel.head))
        );
      default:
        throw new Error("Unrecognized ListSelection type: " + sel.type);
    }
  }
}
