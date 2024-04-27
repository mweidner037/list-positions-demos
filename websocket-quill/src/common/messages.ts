import {
  TimestampFormattingSavedState,
  TimestampMark,
} from "@list-positions/formatting";
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
  formatting: TimestampFormattingSavedState;
};

export type Message = SetMessage | DeleteMessage | MarkMessage | WelcomeMessage;
