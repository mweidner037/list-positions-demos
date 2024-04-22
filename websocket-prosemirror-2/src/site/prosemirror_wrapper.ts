import { Mutation } from "../common/messages";
import { EditorState, Plugin, Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Schema } from "prosemirror-model";
import { schema as schemaBasic } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";
import {
  buildInputRules,
  buildKeymap,
  buildMenuItems,
} from "prosemirror-example-setup";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { menuBar } from "prosemirror-menu";

import "prosemirror-menu/style/menu.css";
import "prosemirror-view/style/prosemirror.css";
import "prosemirror-example-setup/style/style.css";
import { maybeRandomString } from "maybe-random-string";
import { Step } from "prosemirror-transform";

// Mix the nodes from prosemirror-schema-list into the basic schema to
// create a schema with list support.
const schema = new Schema({
  nodes: addListNodes(schemaBasic.spec.nodes, "paragraph block*", "block"),
  marks: schemaBasic.spec.marks,
});

export class ProseMirrorWrapper {
  readonly view: EditorView;
  readonly clientID: string;
  private clientCounter = 0;

  constructor(readonly onLocalMutation: (mutation: Mutation) => void) {
    this.clientID = maybeRandomString();
    this.view = new EditorView(document.querySelector("#editor"), {
      state: EditorState.create({
        schema,
        // Modified from prosemirror-example-setup.
        plugins: [
          buildInputRules(schema),
          keymap(buildKeymap(schema)),
          keymap(baseKeymap),
          menuBar({ floating: true, content: buildMenuItems(schema).fullMenu }),
          new Plugin({
            props: { attributes: { class: "ProseMirror-example-setup-style" } },
          }),
        ],
      }),
      dispatchTransaction: (tr) => this.dispatchTransaction(tr),
    });
  }

  private dispatchTransaction(tr: Transaction): void {
    this.view.updateState(this.view.state.apply(tr));
    this.onLocalMutation({
      clientID: this.clientID,
      clientCounter: this.clientCounter++,
      data: tr.steps.map((s) => s.toJSON()),
    });
  }

  receive(mutations: Mutation[]): void {
    const tr = this.view.state.tr;

    for (const mutation of mutations) {
      const steps = (mutation.data as any[]).map((j) =>
        Step.fromJSON(schema, j)
      );
      for (const step of steps) {
        tr.step(step);
      }
    }

    this.view.updateState(this.view.state.apply(tr));
  }
}
