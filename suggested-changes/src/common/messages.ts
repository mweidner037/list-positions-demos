import { TimestampMark } from "@list-positions/formatting";
import { BunchMeta, Position } from "list-positions";
import { BlockMarker, BlockTextSavedState } from "./block_text";

export type SetMessage = {
  type: "set";
  startPos: Position;
  chars: string;
  meta?: BunchMeta;
};

export type SetMarkerMessage = {
  type: "setMarker";
  pos: Position;
  marker: BlockMarker;
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
  savedState: BlockTextSavedState;
};

export type Message =
  | SetMessage
  | SetMarkerMessage
  | DeleteMessage
  | MarkMessage
  | WelcomeMessage;
