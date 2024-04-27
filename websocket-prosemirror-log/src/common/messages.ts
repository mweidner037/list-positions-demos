import type { BunchMeta, Position } from "list-positions";
import { Mutation } from "./mutation";

export type MutationMessage = {
  type: "mutation";
  mutation: Mutation;
};

export type WelcomeMessage = {
  type: "welcome";
  mutations: Mutation[];
};

export type Message = MutationMessage | WelcomeMessage;
