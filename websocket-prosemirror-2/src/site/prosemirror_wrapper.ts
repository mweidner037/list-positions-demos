import { Mutation } from "../common/messages";

export class ProseMirrorWrapper {
  constructor(readonly onLocalMutation: (mutation: Mutation) => void) {}

  receive(mutations: Mutation[]): void {}
}
