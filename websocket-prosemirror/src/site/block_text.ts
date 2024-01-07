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
   * Just the markers from list.
   *
   * Use for reads only - update using wrapper methods on this.
   */
  readonly markers: List<M>;
  readonly formatting: TimestampFormatting;

  constructor(private readonly isBlock: (marker: M) => boolean, order?: Order) {
    this.order = order ?? new Order();
    this.list = new List(this.order);
    this.markers = new List(this.order);
    this.formatting = new TimestampFormatting(this.order);
  }

  set(pos: Position, value: string): void;
  set(pos: Position, value: M): void;
  set(startPos: Position, ...sameBunchValues: string[]): void;
  set(startPos: Position, ...sameBunchValues: string[] | [M]): void {
    this.list.set(startPos, ...sameBunchValues);
    if (typeof sameBunchValues[0] !== "string") {
      this.markers.set(startPos, sameBunchValues[0]);
    }
  }

  delete(pos: Position): void;
  delete(startPos: Position, sameBunchCount: number): void;
  delete(startPos: Position, sameBunchCount?: number): void {
    this.list.delete(startPos, sameBunchCount);
    this.markers.delete(startPos, sameBunchCount);
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
    if (typeof values[0] !== "string") {
      this.markers.set(startPos, values[0]);
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
    let currentBlock = this.markers.getAt(0);
    let currentContent: (string | M)[] = [];
    let contentStartIndex = 1;
    let textStartIndex = 1;
    // Skips initBlock.
    for (const [pos, marker] of this.markers.entries(1)) {
      // Process text content since the previous block.
      const markerIndex = this.list.indexOfPosition(pos);
      if (markerIndex !== textStartIndex) {
        currentContent.push(
          (this.list.slice(textStartIndex, markerIndex) as string[]).join("")
        );
      }
      textStartIndex = markerIndex + 1;

      // Process the marker.
      if (this.isBlock(marker)) {
        // End the current block.
        ans.push({
          marker: currentBlock,
          content: currentContent,
          startIndex: contentStartIndex,
          endIndex: markerIndex,
        });
        // Start the next block.
        currentBlock = marker;
        currentContent = [];
        contentStartIndex = markerIndex + 1;
      } else currentContent.push(marker);
    }

    return ans;
  }

  loadList(savedState: ListSavedState<string | M>): void {
    this.list.load(savedState);
    for (const [pos, value] of this.list.entries()) {
      if (typeof value !== "string") this.markers.set(pos, value);
    }
  }
}
