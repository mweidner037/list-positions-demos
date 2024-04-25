import { DOMOutputSpec, MarkSpec, Schema } from "prosemirror-model";

const pDOM: DOMOutputSpec = ["p", 0];
const h1DOM: DOMOutputSpec = ["h1", 0];
const h2DOM: DOMOutputSpec = ["h2", 0];

const emDOM: DOMOutputSpec = ["em", 0];
const strongDOM: DOMOutputSpec = ["strong", 0];

export const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "text*",
      marks: "_",
      parseDOM: [{ tag: "p" }],
      toDOM() {
        return pDOM;
      },
    },
    h1: {
      group: "block",
      content: "text*",
      marks: "_",
      parseDOM: [{ tag: "h1" }],
      toDOM() {
        return h1DOM;
      },
    },
    h2: {
      group: "block",
      content: "text*",
      marks: "_",
      parseDOM: [{ tag: "h2" }],
      toDOM() {
        return h2DOM;
      },
    },
    ul: {
      group: "block",
      content: "text*",
      marks: "_",
      attrs: {
        /**
         * This is only set in sync(), *not* stored in the collaborative state.
         */
        symbol: { default: "•" },
      },
      // TODO: ul vs ol
      parseDOM: [{ tag: "li" }],
      toDOM(node) {
        return [
          "p",
          {
            class: "fakeLi",
            style: `--before-content: "${node.attrs.symbol}"`,
          },
          0,
        ];
      },
    },
    ol: {
      group: "block",
      content: "text*",
      marks: "_",
      attrs: {
        /**
         * This is only set in sync(), *not* stored in the collaborative state.
         */
        symbol: { default: "1." },
      },
      toDOM(node) {
        return [
          "p",
          {
            class: "fakeLi",
            style: `--before-content: "${node.attrs.symbol}"`,
          },
          0,
        ];
      },
    },
    text: {},
  },
  marks: {
    // em and strong marks copied from prosemirror-schema-basic.

    /// An emphasis mark. Rendered as an `<em>` element. Has parse rules
    /// that also match `<i>` and `font-style: italic`.
    em: {
      parseDOM: [
        { tag: "i" },
        { tag: "em" },
        { style: "font-style=italic" },
        { style: "font-style=normal", clearMark: (m) => m.type.name == "em" },
      ],
      toDOM() {
        return emDOM;
      },
    } as MarkSpec,

    /// A strong mark. Rendered as `<strong>`, parse rules also match
    /// `<b>` and `font-weight: bold`.
    strong: {
      parseDOM: [
        { tag: "strong" },
        // This works around a Google Docs misbehavior where
        // pasted content will be inexplicably wrapped in `<b>`
        // tags with a font-weight normal.
        {
          tag: "b",
          getAttrs: (node: HTMLElement) =>
            node.style.fontWeight != "normal" && null,
        },
        { style: "font-weight=400", clearMark: (m) => m.type.name == "strong" },
        {
          style: "font-weight",
          getAttrs: (value: string) =>
            /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null,
        },
      ],
      toDOM() {
        return strongDOM;
      },
    } as MarkSpec,
  },
});
