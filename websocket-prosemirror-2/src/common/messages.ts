export type Mutation = {
  data: unknown;
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
