import {
  TimestampFormatting,
  TimestampFormattingSavedState,
} from "list-formatting";
import { List, ListSavedState, Order, OrderSavedState } from "list-positions";

export type BlockMarker = {
  type: string;
  attrs?: Record<string, any>;
};

export type Block = {
  readonly marker: BlockMarker;
  readonly startIndex: number;
  readonly endIndex: number;
  text: string;
  // TODO: formatting
};

export type BlockTextSavedState = {
  readonly order: OrderSavedState;
  // TODO: enforce disjointness with text's bunches; one marker per bunch?
  readonly blockMarkers: ListSavedState<BlockMarker>;
  readonly text: ListSavedState<string>;
  readonly formatting: TimestampFormattingSavedState;
};

export class BlockText {
  readonly order: Order;
  readonly blockMarkers: List<BlockMarker>;
  readonly text: List<string>;
  readonly formatting: TimestampFormatting;

  constructor(order?: Order) {
    this.order = order ?? new Order();
    this.blockMarkers = new List(this.order);
    this.text = new List(this.order);
    this.formatting = new TimestampFormatting(this.order);
  }

  // TODO: enforce invariant that first pos is a block.
  // TODO: enforce invariant that text and blockMarkers use disjoint Positions.

  blocks(): Block[] {
    if (
      this.blockMarkers.length === 0 ||
      (this.text.length !== 0 &&
        this.order.compare(
          this.blockMarkers.positionAt(0),
          this.text.positionAt(0)
        ) >= 0)
    ) {
      throw new Error("Does not start with a block marker");
    }

    const ans: Block[] = [];
    const allText = this.text.slice().join("");
    for (let i = 0; i < this.blockMarkers.length; i++) {
      const startIndex = this.text.indexOfPosition(
        this.blockMarkers.positionAt(i),
        "right"
      );
      const endIndex =
        i === this.blockMarkers.length
          ? this.text.length
          : this.text.indexOfPosition(
              this.blockMarkers.positionAt(i + 1),
              "right"
            );
      ans.push({
        marker: this.blockMarkers.getAt(i),
        startIndex,
        endIndex,
        text: allText.slice(startIndex, endIndex),
      });
    }

    return ans;
  }

  save(): BlockTextSavedState {
    return {
      order: this.order.save(),
      blockMarkers: this.blockMarkers.save(),
      text: this.text.save(),
      formatting: this.formatting.save(),
    };
  }

  load(savedState: BlockTextSavedState): void {
    this.order.load(savedState.order);
    this.blockMarkers.load(savedState.blockMarkers);
    this.text.load(savedState.text);
    this.formatting.load(savedState.formatting);
  }
}
