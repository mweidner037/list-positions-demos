import Quill, { DeltaStatic, Delta as DeltaType } from "quill";

// Quill CSS.
import { FormattedValues, RichList, sliceFromSpan } from "list-formatting";
import "quill/dist/quill.snow.css";
import { Message, WelcomeMessage } from "../common/messages";

const Delta: typeof DeltaType = Quill.import("delta");

export class QuillWrapper {
  readonly editor: Quill;
  readonly richList: RichList<string>;

  constructor(readonly ws: WebSocket, welcome: WelcomeMessage) {
    this.richList = new RichList({ expandRules });

    // Setup Quill.
    const editorContainer = document.getElementById("editor") as HTMLDivElement;
    this.editor = new Quill(editorContainer, {
      theme: "snow",
      modules: {
        toolbar: [
          ["bold", "italic"],
          [{ header: "1" }, { header: "2" }],
          [{ list: "ordered" }, { list: "bullet" }],
        ],
        history: {
          userOnly: true,
        },
      },
      formats: ["bold", "italic", "header", "list"],
    });

    // Load initial state into richList.
    this.richList.order.load(welcome.order);
    this.richList.list.load(welcome.list);
    // welcome.marks is not a saved state; add directly.
    for (const mark of welcome.marks) this.richList.formatting.addMark(mark);

    // Sync initial state to Quill.
    this.editor.updateContents(
      deltaFromSlices(this.richList.formattedValues())
    );
    // Delete Quill's own initial "\n" - the server's state already contains one.
    this.editor.updateContents(
      new Delta().retain(this.richList.list.length).delete(1)
    );

    // Sync Quill changes to our local state and to the server.
    let ourChange = false;
    this.editor.on("text-change", (delta) => {
      // Filter our own programmatic changes.
      if (ourChange) return;

      for (const op of getRelevantDeltaOperations(delta)) {
        // Insertion
        if (op.insert) {
          if (typeof op.insert === "string") {
            const quillAttrs = op.attributes ?? {};
            const formattingAttrs = Object.fromEntries(
              [...Object.entries(quillAttrs)].map(quillAttrToFormatting)
            );
            const [startPos, createdBunch, createdMarks] =
              this.richList.insertWithFormat(
                op.index,
                formattingAttrs,
                ...op.insert
              );
            this.send({
              type: "set",
              startPos,
              chars: op.insert,
              meta: createdBunch ?? undefined,
            });
            for (const mark of createdMarks) {
              this.send({
                type: "mark",
                mark,
              });
            }
          } else {
            // Embed of object
            throw new Error("Embeds not supported");
          }
        }
        // Deletion
        else if (op.delete) {
          const toDelete = [
            ...this.richList.list.positions(op.index, op.index + op.delete),
          ];
          for (const pos of toDelete) {
            this.richList.list.delete(pos);
            this.send({
              type: "delete",
              pos,
            });
          }
        }
        // Formatting
        else if (op.attributes && op.retain) {
          for (const [quillKey, quillValue] of Object.entries(op.attributes)) {
            const [key, value] = quillAttrToFormatting([quillKey, quillValue]);
            const [mark] = this.richList.format(
              op.index,
              op.index + op.retain,
              key,
              value
            );
            this.send({
              type: "mark",
              mark,
            });
          }
        }
      }
    });

    // Sync server changes to our local state and to Quill.
    this.ws.addEventListener("message", (e) => {
      ourChange = true;
      try {
        const msg = JSON.parse(e.data) as Message;
        switch (msg.type) {
          case "set":
            if (msg.meta) {
              this.richList.order.receive([msg.meta]);
            }
            // Sets are always nontrivial.
            // Because the server enforces causal ordering, bunched values
            // are always still contiguous and have a single format.
            this.richList.list.set(msg.startPos, ...msg.chars);
            const startIndex = this.richList.list.indexOfPosition(msg.startPos);
            const format = this.richList.formatting.getFormat(msg.startPos);
            this.editor.updateContents(
              new Delta()
                .retain(startIndex)
                .insert(msg.chars, formattingToQuillAttr(format))
            );
            break;
          case "delete":
            if (this.richList.list.has(msg.pos)) {
              const index = this.richList.list.indexOfPosition(msg.pos);
              this.richList.list.delete(msg.pos);
              this.editor.updateContents(new Delta().retain(index).delete(1));
            }
            break;
          case "mark":
            const changes = this.richList.formatting.addMark(msg.mark);
            for (const change of changes) {
              const { startIndex, endIndex } = sliceFromSpan(
                this.richList.list,
                change.start,
                change.end
              );
              this.editor.updateContents(
                new Delta()
                  .retain(startIndex)
                  .retain(
                    endIndex - startIndex,
                    formattingToQuillAttr({ [change.key]: change.value })
                  )
              );
            }
            break;
          default:
            throw new Error("Unknown message type: " + msg.type);
        }
      } finally {
        ourChange = false;
      }
    });
  }

  private send(msg: Message) {
    if (this.ws.readyState == WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

/**
 * Expand arg for the given format key's mark/unmark op.
 *
 * Default for inline formatting is "after"/"after".
 *
 * For links, instead use "none"/"both" (Peritext example 9).
 *
 * We also set all block formats to "none"/"none" for a Quill-specific reason:
 * Quill doesn't let a block format apply to a non-"\n", so a block format
 * shouldn't expand to neighboring non-"\n" chars (otherwise, we have to do
 * extra unmark ops).
 */
function expandRules(
  key: string,
  value: any
): "none" | "before" | "after" | "both" {
  switch (key) {
    case "block":
    case "indent":
    case "align":
    case "direction":
      return "none";
    case "link":
      return value !== null ? "none" : "both";
    default:
      return "after";
  }
}

/**
 * Convert delta.ops into an array of modified DeltaOperations
 * having the form { index: first char index, ...DeltaOperation },
 * leaving out ops that do nothing.
 */
function getRelevantDeltaOperations(delta: DeltaStatic): {
  index: number;
  insert?: string | object;
  delete?: number;
  attributes?: Record<string, any>;
  retain?: number;
}[] {
  if (delta.ops === undefined) return [];
  const relevantOps = [];
  let index = 0;
  for (const op of delta.ops) {
    if (op.retain === undefined || op.attributes) {
      relevantOps.push({ index, ...op });
    }
    // Adjust index for the next op.
    if (op.insert !== undefined) {
      if (typeof op.insert === "string") index += op.insert.length;
      else index += 1; // Embed
    } else if (op.retain !== undefined) index += op.retain;
    // Deletes don't add to the index because we'll do the
    // next operation after them, hence the text will already
    // be shifted left.
  }
  return relevantOps;
}

function deltaFromSlices(slices: FormattedValues<string>[]) {
  let delta = new Delta();
  for (const values of slices) {
    delta = delta.insert(
      values.values.join(""),
      formattingToQuillAttr(values.format)
    );
  }
  return delta;
}

/**
 * These formats are exclusive; we need to pass only one at a time to Quill or
 * the result is inconsistent.
 * So, we wrap them in our own "block" formatting attribute:
 * { block: [key, value] }.
 */
const exclusiveBlocks = new Set(["blockquote", "header", "list", "code-block"]);

/**
 * Converts a Quill formatting attr (key/value pair) to the format
 * we store in Formatting.
 */
function quillAttrToFormatting(
  attr: [key: string, value: any]
): [key: string, value: any] {
  const [key, value] = attr;
  if (exclusiveBlocks.has(key)) {
    // Wrap it in our own "block" formatting attribute.
    // See the comment above exclusiveBlocks.
    if (value === null) return ["block", null];
    else return ["block", JSON.stringify([key, value])];
  } else {
    return [key, value];
  }
}

/**
 * Inverse of quillAttrToFormatting, except acting on a whole object at a time.
 */
function formattingToQuillAttr(
  attrs: Record<string, any>
): Record<string, any> {
  const ret: Record<string, any> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "block") {
      if (value === null) {
        // Instead of figuring out which block key is being unmarked,
        // just ask Quill to unmark all of them.
        for (const blockKey of exclusiveBlocks) ret[blockKey] = null;
      } else {
        const [quillKey, quillValue] = JSON.parse(value) as [string, any];
        ret[quillKey] = quillValue;
      }
    } else ret[key] = value;
  }
  return ret;
}
