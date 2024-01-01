import { TimestampMark } from "list-formatting";
import {
  BunchMeta,
  ListSavedState,
  OrderSavedState,
  Position,
} from "list-positions";

export type SetMessage = {
  type: "set";
  startPos: Position;
  chars: string;
  meta?: BunchMeta;
};

export type DeleteMessage = {
  type: "delete";
  pos: Position;
};

export type MarkMessage = {
  type: "mark";
  mark: TimestampMark;
};

export type WelcomeMessage = {
  type: "welcome";
  order: OrderSavedState;
  list: ListSavedState<string>;
  // Note: these are in receipt order, *not* timestamp order.
  // So you can't use them as a TimestampFormattingSavedState.
  marks: TimestampMark[];
};

export type Message = SetMessage | DeleteMessage | MarkMessage | WelcomeMessage;
