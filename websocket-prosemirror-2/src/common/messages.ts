import type { BunchMeta, Position } from "list-positions";

export type AnnotatedStep =
  | {
      // We split ReplaceStep into insert + delete.
      // This is easier because then we don't have to deal with edge cases
      // where our created positions are no longer adjacent to the deleted range
      // (due to concurrent insertions, which don't become part of
      // the deleted range because we don't let it expand).
      type: "insert";
      meta: BunchMeta | null;
      startPos: Position;
      // The creator allocates slice.size positions.
      // Need to check that an applier doesn't use more somehow.
      sliceJSON: unknown;
    }
  | {
      type: "delete";
      // Right cursor - doesn't expand.
      fromPos: Position;
      // Left cursor - doesn't expand.
      toPos: Position;
      openStart: number;
      openEnd: number;
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
