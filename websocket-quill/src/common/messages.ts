import { TimestampMark } from "list-formatting";
import { BunchMeta, Position } from "list-positions";

export type SetMessage = {
  type: "set";
  pos: Position;
  char: string;
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

export type Message = SetMessage | DeleteMessage | MarkMessage;
