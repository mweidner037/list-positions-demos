import { TimestampFormattingSavedState } from "@list-positions/formatting";
import { ListSavedState, OrderSavedState } from "list-positions";

/**
 * Immutable - don't mutate attrs directly.
 */
export type BlockMarker = {
  readonly type: string;
  readonly attrs?: Record<string, any>;
  /**
   * Lamport timestamp for LWW.
   */
  readonly timestamp: number;
  readonly creatorID: string;
};

export type BlockTextSavedState = {
  readonly order: OrderSavedState;
  readonly text: ListSavedState<string>;
  readonly blockMarkers: ListSavedState<BlockMarker>;
  readonly formatting: TimestampFormattingSavedState;
};
