import { TimestampFormatting } from "list-formatting";
import { BunchMeta, List, Order, Position } from "list-positions";

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
  readonly markers: List<Marker>;
  readonly formatting: TimestampFormatting;

  constructor(order?: Order) {
    this.order = order ?? new Order();
    this.list = new List(this.order);
    this.markers = new List(this.order);
    this.formatting = new TimestampFormatting(this.order);
  }

  insertMarkerAt(
    index: number,
    marker: Marker
  ): [pos: Position, createdBunch: BunchMeta | null] {
    const [pos, createdBunch] = this.list.insertAt(index, "\n");
    this.markers.set(pos, marker);
    return [pos, createdBunch];
  }

  insertMarker(
    prevPos: Position,
    marker: Marker
  ): [pos: Position, createdBunch: BunchMeta | null] {
    const [pos, createdBunch] = this.list.insert(prevPos, "\n");
    this.markers.set(pos, marker);
    return [pos, createdBunch];
  }

  setMarker(pos: Position, marker: Marker): void {
    if (this.list.has(pos)) {
      if (!this.markers.has(pos)) {
        throw new Error("Not a marker: " + JSON.stringify(pos));
      }
    } else this.list.set(pos, "\n");
    this.markers.set(pos, marker);
  }

  deleteMarker(pos: Position): void {
    if (this.list.has(pos)) {
      if (this.markers.has(pos)) {
        this.markers.delete(pos);
        this.list.delete(pos);
      } else {
        throw new Error("Not a marker: " + JSON.stringify(pos));
      }
    }
  }
}
