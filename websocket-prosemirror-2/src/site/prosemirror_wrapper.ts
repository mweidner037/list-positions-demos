import { Mutation } from "../common/messages";
import { EditorState, Plugin } from "prosemirror-state";
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

// Mix the nodes from prosemirror-schema-list into the basic schema to
// create a schema with list support.
const schema = new Schema({
  nodes: addListNodes(schemaBasic.spec.nodes, "paragraph block*", "block"),
  marks: schemaBasic.spec.marks,
});

export class ProseMirrorWrapper {
  readonly view: EditorView;

  constructor(readonly onLocalMutation: (mutation: Mutation) => void) {
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
    });
  }

  receive(mutations: Mutation[]): void {}
}
