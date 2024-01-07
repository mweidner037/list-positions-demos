import { TimestampFormatting } from "list-formatting";
import {
  BunchMeta,
  List,
  ListSavedState,
  Order,
  Position,
} from "list-positions";

export type Block<M extends object> = {
  readonly marker: M;
  /**
   * Array of text blocks (not individual chars) and embedded markers.
   */
  readonly content: (string | M)[];
  /**
   * Content's starting index in list. Can use to get formatting.
   */
  readonly startIndex: number;
  readonly endIndex: number;
};

/**
 * @typeParam M Type of non-text content, represented as a single
 * object (not string) element of the list.
 * - Block starts
 * - Embedded content like images (Quill embeds, Prosemirror non-text inline nodes)
 */
export class BlockText<M extends object> {
  readonly order: Order;
  /** Use for reads only - update using wrapper methods on this. */
  readonly list: List<string | M>;
  /**
   * Just the block markers from list.
   *
   * Use for reads only - update using wrapper methods on this.
   */
  readonly blockMarkers: List<M>;
  readonly formatting: TimestampFormatting;

  constructor(private readonly isBlock: (marker: M) => boolean, order?: Order) {
    this.order = order ?? new Order();
    this.list = new List(this.order);
    this.blockMarkers = new List(this.order);
    this.formatting = new TimestampFormatting(this.order);
  }

  set(pos: Position, value: string): void;
  set(pos: Position, value: M): void;
  set(startPos: Position, ...sameBunchValues: string[]): void;
  set(startPos: Position, ...sameBunchValues: string[] | [M]): void {
    this.list.set(startPos, ...sameBunchValues);
    if (sameBunchValues.length === 1) {
      const value = sameBunchValues[0];
      if (typeof value !== "string" && this.isBlock(value)) {
        this.blockMarkers.set(startPos, value);
      }
    }
  }

  delete(pos: Position): void;
  delete(startPos: Position, sameBunchCount: number): void;
  delete(startPos: Position, sameBunchCount?: number): void {
    this.list.delete(startPos, sameBunchCount);
    this.blockMarkers.delete(startPos, sameBunchCount);
  }

  insertAt(
    index: number,
    value: string
  ): [pos: Position, createdBunch: BunchMeta | null];
  insertAt(
    index: number,
    value: M
  ): [pos: Position, createdBunch: BunchMeta | null];
  insertAt(
    index: number,
    ...values: string[]
  ): [startPos: Position, createdBunch: BunchMeta | null];
  insertAt(
    index: number,
    ...values: string[] | [M]
  ): [startPos: Position, createdBunch: BunchMeta | null] {
    const [startPos, createdBunch] = this.list.insertAt(index, ...values);
    if (values.length === 1) {
      const value = values[0];
      if (typeof value !== "string" && this.isBlock(value)) {
        this.blockMarkers.set(startPos, value);
      }
    }
    return [startPos, createdBunch];
  }

  blocks(): Block<M>[] {
    // TODO: enforce invariant that first var is a block.
    if (
      this.list.length === 0 ||
      typeof this.list.getAt(0) === "string" ||
      !this.isBlock(this.list.getAt(0) as M)
    ) {
      throw new Error("Does not start with a block marker");
    }

    const ans: Block<M>[] = [];
    let currentBlock = this.blockMarkers.getAt(0);
    let contentStartIndex = 1;
    for (const [pos, marker] of this.blockMarkers.entries(1)) {
      // End the current block.
      const markerIndex = this.list.indexOfPosition(pos);
      // TODO: handle non-block markers.
      ans.push({
        marker: currentBlock,
        content: [
          (this.list.slice(contentStartIndex, markerIndex) as string[]).join(
            ""
          ),
        ],
        startIndex: contentStartIndex,
        endIndex: markerIndex,
      });
      contentStartIndex = markerIndex + 1;

      // Start the next block.
      currentBlock = marker;
      contentStartIndex = markerIndex + 1;
    }
    // End the final block.
    // TODO: handle non-block markers.
    ans.push({
      marker: currentBlock,
      content: [(this.list.slice(contentStartIndex) as string[]).join("")],
      startIndex: contentStartIndex,
      endIndex: this.list.length,
    });

    return ans;
  }

  loadList(savedState: ListSavedState<string | M>): void {
    this.list.load(savedState);
    for (const [pos, value] of this.list.entries()) {
      if (typeof value !== "string") this.blockMarkers.set(pos, value);
    }
  }
}
