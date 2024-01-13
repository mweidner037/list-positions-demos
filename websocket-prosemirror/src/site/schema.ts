import { DOMOutputSpec, Schema } from "prosemirror-model";

const pDOM: DOMOutputSpec = ["p", 0];

export const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: {
      content: "text*",
      parseDOM: [{ tag: "p" }],
      toDOM() {
        return pDOM;
      },
    },
    text: {},
  },
});