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
    };

export type Mutation = {
  annSteps: AnnotatedStep[];
  clientID: string;
  clientCounter: number;
};

export type MutationMessage = {
  type: "mutation";
  mutation: Mutation;
};

export type WelcomeMessage = {
  type: "welcome";
  mutations: Mutation[];
};

export type Message = MutationMessage | WelcomeMessage;
