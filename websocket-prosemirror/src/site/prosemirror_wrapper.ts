import { keydownHandler } from "prosemirror-keymap";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { WelcomeMessage } from "../common/messages";
import { BlockText } from "./block_text";

import { pcBaseKeymap } from "prosemirror-commands";

import { ListSavedState } from "list-positions";
import { Node } from "prosemirror-model";
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
      dispatchTransaction: (tr) => {
        for (const step of tr.steps) {
          console.log(step);
        }
        this.view.updateState(this.view.state.apply(tr));
        console.log(this.view.state.doc);
      },
    });

    // TODO
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
}
