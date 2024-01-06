import { TimestampFormatting } from "list-formatting";
import { BunchIDs, List, Order } from "list-positions";
import { Node, Schema } from "prosemirror-model";

export const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: {},
  },
});

/**
 * Non-text content, represented as a single element of the list.
 *
 * - Block starts
 * - Embedded content like images (Quill embeds, Prosemirror non-text inline nodes)
 */
export type Marker = {
  type: string;
  attrs: Record<string, any>;
};

export class BlockText {
  readonly order: Order;
  readonly list: List<string | Marker>;
  readonly formatting: TimestampFormatting;

  constructor(order?: Order) {
    this.order = order ?? new Order();
    this.list = new List(this.order);
    this.formatting = new TimestampFormatting(this.order);

    // Initial block marker. TODO: easier way.
    this.order.receive([
      { parentID: BunchIDs.ROOT, offset: 1, bunchID: "INIT" },
    ]);
    this.list.set(
      { bunchID: "INIT", innerIndex: 0 },
      { type: "paragraph", attrs: {} }
    );
  }

  toProseMirror(): Node {
    const blocks: Node[] = [];

    let currentBlock: Marker = this.list.getAt(0) as Marker;
    let blockStart = 1;
    let i = 1;

    const endBlock = () => {
      const text = (this.list.slice(blockStart, i) as string[]).join("");
      blocks.push(schema.node("paragraph", null, [schema.text(text)]));
    };

    for (const value of this.list.values(1)) {
      // TODO: avoid this loop by looping over markers instead?
      if (typeof value !== "string") {
        // Marker -> new block start.
        endBlock();
        // Start next block.
        currentBlock = value;
        blockStart = i;
      }
      i++;
    }
    // End final block.
    endBlock();

    return schema.node("doc", null, blocks);
  }
}
