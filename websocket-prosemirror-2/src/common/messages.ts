import type { BunchMeta, Position } from "list-positions";

// TODO: investigate "structure" args to ReplaceStep and ReplaceAroundStep.

export type AnnotatedStep =
  | {
      type: "replaceInsert";
      meta: BunchMeta | null;
      startPos: Position;
      // The creator allocates slice.size positions.
      // Need to check that an applier doesn't use more somehow.
      sliceJSON: unknown;
    }
  | {
      type: "replaceDelete";
      fromPos: Position;
      toInclPos: Position;
      openStart: number;
      openEnd: number;
    }
  | { type: "replaceAround" };

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
