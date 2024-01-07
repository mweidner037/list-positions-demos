import { keydownHandler } from "prosemirror-keymap";
import { EditorState, Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Message, WelcomeMessage } from "../common/messages";
import { BlockText } from "./block_text";

import { pcBaseKeymap } from "prosemirror-commands";

import { ListSavedState, Position } from "list-positions";
import { Node } from "prosemirror-model";
import { ReplaceStep } from "prosemirror-transform";
import "prosemirror-view/style/prosemirror.css";
import { BlockMarker, isBlock, schema } from "./schema";

export class ProsemirrorWrapper {
  readonly view: EditorView;
  readonly blockText: BlockText<BlockMarker>;

  constructor(readonly ws: WebSocket, welcome: WelcomeMessage) {
    this.blockText = new BlockText(isBlock);

    // Load initial state into blockText.
    this.blockText.order.load(welcome.order);
    this.blockText.loadList(
      welcome.list as ListSavedState<string | BlockMarker>
    );
    // welcome.marks is not a saved state; add directly.
    for (const mark of welcome.marks) this.blockText.formatting.addMark(mark);

    // Setup Prosemirrow with initial state from blockText.
    this.view = new EditorView(document.querySelector("#editor"), {
      state: EditorState.create({ schema, doc: this.currentDoc() }),
      handleKeyDown: keydownHandler(pcBaseKeymap),
      // Sync ProseMirror changes to our local state and the server.
      dispatchTransaction: this.onLocalTr.bind(this),
    });

    // Sync server changes to our local state and ProseMirror.
    this.ws.addEventListener("message", (e) => {
      const tr = this.view.state.tr;
      tr.setMeta("ProsemirrorWrapper", true);
      const msg = JSON.parse(e.data) as Message;
      switch (msg.type) {
        case "set":
          if (msg.meta) {
            this.blockText.order.receive([msg.meta]);
          }
          // Sets are always nontrivial.
          // Because the server enforces causal ordering, bunched values
          // are always still contiguous and have a single format.
          this.blockText.set(msg.startPos, ...msg.chars);
          const startIndex = this.blockText.list.indexOfPosition(msg.startPos);
          const format = this.blockText.formatting.getFormat(msg.startPos);
          // TODO: use format.
          tr.insertText(msg.chars, startIndex);
          break;
        case "delete":
          if (this.blockText.list.has(msg.pos)) {
            const value = this.blockText.list.get(msg.pos)!;
            if (typeof value !== "string" && isBlock(value)) {
              // TODO: block marker case. Need to merge block w/ previous.
              console.error("Not implemented: delete block marker.");
            } else {
              const pmPos = this.pmPosOfValue(tr.doc, msg.pos);
              this.blockText.delete(msg.pos);
              tr.delete(pmPos, pmPos + 1);
            }
          }
          break;
        // TODO: setMarker, mark.
        // TODO: separate message type for block deletion?
        default:
          throw new Error("Unknown message type: " + msg.type);
      }
      if (tr.steps.length !== 0) {
        this.view.dispatch(tr);
      }
    });
  }

  private currentDoc(): Node {
    console.log(this.blockText.list.slice());
    const blocks = this.blockText.blocks();
    console.log(blocks);
    const nodes = blocks.map((block) => {
      switch (block.marker.type) {
        case "paragraph":
          const content = block.content.map((piece) => {
            if (typeof piece === "string") return schema.text(piece);
            else {
              throw new Error("Unrecognized embed: " + JSON.stringify(piece));
            }
          });
          return schema.node("paragraph", null, content);
        default:
          throw new Error(
            "Unrecognized block marker: " + JSON.stringify(block.marker)
          );
      }
    });
    console.log(nodes);
    return schema.node("doc", null, nodes);
  }

  private onLocalTr(tr: Transaction) {
    if (tr.getMeta("ProsemirrorWrapper")) {
      // Our own change; pass through.
      this.view.updateState(this.view.state.apply(tr));
      return;
    }

    // Apply to blockText, recording messages to send to the server.
    const messages: Message[] = [];
    for (let s = 0; s < tr.steps.length; s++) {
      const step = tr.steps[s];
      if (step instanceof ReplaceStep) {
        const fromIndex = this.textIndex(tr.docs[s], step.from);
        // Deletion
        if (step.from < step.to) {
          const toDelete = this.blockText.list.positions(
            fromIndex,
            this.textIndex(tr.docs[s], step.to)
          );
          for (const pos of toDelete) {
            messages.push({ type: "delete", pos });
            this.blockText.delete(pos);
          }
        }
        // Insertion
        if (
          step.slice.openStart === 0 &&
          step.slice.openEnd === 0 &&
          step.slice.content.childCount === 1
        ) {
          const child = step.slice.content.child(0);
          switch (child.type.name) {
            case "text":
              // Simple text insertion.
              const [startPos, createdBunch] = this.blockText.insertAt(
                fromIndex,
                ...child.text!
              );
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
        } else {
          console.error("Unsupported slice", step.slice);
        }
      } else {
        console.error("Unsupported step", step);
      }
    }

    // Tell the server.
    // TODO: group as tr.
    for (const message of messages) {
      this.send(message);
    }

    // Let ProseMirror apply the tr normally.
    this.view.updateState(this.view.state.apply(tr));
  }

  private textIndex(doc: Node, pmPos: number): number {
    const resolved = doc.resolve(pmPos);
    switch (resolved.parent.type.name) {
      case "doc": {
        // Block resolved.index(0). Return index of its block marker.
        const markerPos = this.blockText.blockMarkers.positionAt(
          resolved.index(0)
        );
        return this.blockText.list.indexOfPosition(markerPos);
      }
      case "paragraph": {
        // Char resolved.index(1) in block resolved.index(0).
        const markerPos = this.blockText.blockMarkers.positionAt(
          resolved.index(0)
        );
        this.blockText.list.indexOfPosition(markerPos) + resolved.index(1);
      }
      default:
        throw new Error(
          "Unrecognized parent type: " + JSON.stringify(resolved.parent)
        );
    }
  }

  /**
   * Returns the ProseMirror position corresponding to the value (not block marker)
   * at the given present Position.
   */
  private pmPosOfValue(doc: Node, pos: Position): number {
    const blockIndex = this.blockText.blockMarkers.indexOfPosition(pos, "left");
    const blockPos = this.blockText.blockMarkers.positionAt(blockIndex);
    const indexInBlock =
      this.blockText.list.indexOfPosition(pos) -
      this.blockText.list.indexOfPosition(blockPos);

    // Find the total size of previous blocks.
    let blockStart = 0;
    for (let b = 0; b < blockIndex; b++) {
      blockStart += doc.child(b).nodeSize;
    }

    // Add 1 for the start of doc, 1 for the start of the block, and
    // the index within block.
    return blockStart + 2 + indexInBlock;
  }

  private send(msg: Message) {
    if (this.ws.readyState == WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
