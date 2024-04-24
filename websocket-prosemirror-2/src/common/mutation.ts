import type { BunchMeta, Position } from "list-positions";

export type AnnotatedStep =
  | {
      type: "replace";
      insert?: { meta: BunchMeta | null; startPos: Position };
      delete?: {
        // Right cursor - doesn't expand.
        startPos: Position;
        // Left cursor - doesn't expand.
        endPos: Position;
      };
      sliceJSON: unknown;
      structure: boolean;
    }
  | {
      type: "replaceAround";
      insertLeft?: {
        // TODO: metas array instead (easier to process)
        meta: BunchMeta | null;
        startPos: Position;
      };
      insertRight?: {
        meta: BunchMeta | null;
        startPos: Position;
      };
      deleteLeft?: {
        // Right cursor - doesn't expand.
        startPos: Position;
        // Left cursor - doesn't expand.
        endPos: Position;
      };
      deleteRight?: {
        // Right cursor - doesn't expand.
        startPos: Position;
        // Left cursor - doesn't expand.
        endPos: Position;
      };
      sliceJSON: unknown;
      // This is just an index into the slice, so we don't need to CRDT-ify it.
      sliceInsert: number;
      sliceAfterInsert: number;
      structure: boolean;
    }
  | {
      type: "changeMark";
      // Else remove.
      isAdd: boolean;
      // Right cursor - doesn't expand.
      fromPos: Position;
      // Left cursor - doesn't expand.
      // TODO: do expand for e.g. bold?
      // TODO: test behavior of marks across concurrent split - will it complain that the mark crosses a non-inline node?
      toPos: Position;
      markJSON: unknown;
    }
  | {
      type: "changeNodeMark";
      // Else remove.
      isAdd: boolean;
      pos: Position;
      markJSON: unknown;
    };

export type Mutation = {
  annSteps: AnnotatedStep[];
  clientID: string;
  clientCounter: number;
};

export function idEquals(a: Mutation, b: Mutation): boolean {
  return a.clientID === b.clientID && a.clientCounter === b.clientCounter;
}
