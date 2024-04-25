import type { BunchMeta, Position } from "list-positions";

/**
 * Positions for a ReplaceStep or one part of a ReplaceAroundStep.
 *
 * At least one of insert or delete is guaranteed to be defined.
 */
export type ReplacePositions = {
  insert?: { meta: BunchMeta | null; startPos: Position };
  delete?: {
    // Right cursor - doesn't expand.
    startPos: Position;
    // Left cursor - doesn't expand.
    endPos: Position;
  };
};

/**
 * A ProseMirror step, annotated with Positions in place of list indices (PM positions).
 *
 * The Positions let us rebase steps "as-is", without explicitly transforming indices.
 * In other words, an AnnotatedStep is CRDT-style, while a plain step is OT-style.
 */
export type AnnotatedStep =
  | {
      type: "replace";
      positions: ReplacePositions;
      sliceJSON: unknown;
      structure: boolean;
    }
  | {
      type: "replaceAround";
      leftPositions: ReplacePositions;
      rightPositions: ReplacePositions;
      sliceJSON: unknown;
      // This is just an index into the slice, so we don't need to CRDT-ify it.
      sliceInsert: number;
      structure: boolean;
    }
  | {
      // TODO: If an insertion is applied after a concurrent changeMark, it won't
      // get the mark (according to PM's default logic).
      // Can we change it to get the mark anyway (Peritext-style)?
      type: "changeMark";
      // Else remove.
      isAdd: boolean;
      // Right cursor - doesn't expand.
      fromPos: Position;
      // Left cursor - doesn't expand.
      // TODO: do expand for e.g. bold?
      toPos: Position;
      markJSON: unknown;
    }
  | {
      type: "changeNodeMark";
      // Else remove.
      isAdd: boolean;
      pos: Position;
      markJSON: unknown;
    }
  | {
      type: "attr";
      pos: Position;
      attr: string;
      value: unknown;
    }
  | {
      type: "docAttr";
      attr: string;
      value: unknown;
    };

export type Mutation = {
  annSteps: AnnotatedStep[];
  clientID: string;
  clientCounter: number;
};

export function idEquals(a: Mutation, b: Mutation): boolean {
  return a.clientID === b.clientID && a.clientCounter === b.clientCounter;
}
