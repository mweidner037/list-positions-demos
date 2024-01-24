import {transact} from './pg.js';
import {ReplicacheTransaction} from 'replicache-transaction';
import {z, ZodType} from 'zod';
import {getPokeBackend} from './poke.js';
import type {MutatorDefs, ReadonlyJSONValue} from 'replicache';
import {PostgresStorage} from './postgres-storage.js';
import {
  getCookie,
  getLastMutationIDs,
  setCookie,
  setLastMutationIDs,
} from './data.js';

const mutationSchema = z.object({
  clientID: z.string(),
  id: z.number(),
  name: z.string(),
  args: z.any(),
});

const pushRequestSchema = z.object({
  profileID: z.string(),
  clientGroupID: z.string(),
  mutations: z.array(mutationSchema),
});

type PushRequest = z.infer<typeof pushRequestSchema>;
export type Error = 'SpaceNotFound';

export function parseIfDebug<T extends ReadonlyJSONValue>(
  schema: ZodType<T>,
  val: T,
): T {
  if (globalThis.process?.env?.NODE_ENV !== 'production') {
    return schema.parse(val);
  }
  return val as T;
}

export async function push<M extends MutatorDefs>(
  spaceID: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requestBody: any,
  mutators: M,
) {
  console.log('Processing push', JSON.stringify(requestBody, null, ''));

  const push = parseIfDebug<PushRequest>(pushRequestSchema, requestBody);

  const {clientGroupID} = push;

  const t0 = Date.now();
  await transact(async executor => {
    const prevVersion = await getCookie(executor, spaceID);
    if (prevVersion === undefined) {
      throw new Error(`Unknown space ${spaceID}`);
    }

    const nextVersion = prevVersion + 1;
    const clientIDs = [...new Set(push.mutations.map(m => m.clientID))];

    const lastMutationIDs = await getLastMutationIDs(executor, clientIDs);

    console.log(JSON.stringify({prevVersion, nextVersion, lastMutationIDs}));

    const storage = new PostgresStorage(spaceID, nextVersion, executor);
    const tx = new ReplicacheTransaction(storage);

    for (let i = 0; i < push.mutations.length; i++) {
      const mutation = push.mutations[i];
      const {clientID} = mutation;
      const lastMutationID = lastMutationIDs[clientID];
      if (lastMutationID === undefined) {
        throw new Error(
          'invalid state - lastMutationID not found for client: ' + clientID,
        );
      }
      const expectedMutationID = lastMutationID + 1;

      if (mutation.id < expectedMutationID) {
        console.log(
          `Mutation ${mutation.id} has already been processed - skipping`,
        );
        continue;
      }
      if (mutation.id > expectedMutationID) {
        console.warn(`Mutation ${mutation.id} is from the future - aborting`);
        break;
      }

      console.log('Processing mutation:', JSON.stringify(mutation, null, ''));

      const t1 = Date.now();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mutator = (mutators as any)[mutation.name];
      if (!mutator) {
        console.error(`Unknown mutator: ${mutation.name} - skipping`);
      }

      try {
        await mutator(tx, mutation.args);
      } catch (e) {
        console.error(
          `Error executing mutator: ${JSON.stringify(mutator)}: ${e}`,
        );
      }

      lastMutationIDs[clientID] = expectedMutationID;
      console.log('Processed mutation in', Date.now() - t1);
    }

    await Promise.all([
      setLastMutationIDs(executor, clientGroupID, lastMutationIDs, nextVersion),
      setCookie(executor, spaceID, nextVersion),
      tx.flush(),
    ]);

    const pokeBackend = getPokeBackend();
    await pokeBackend.poke(spaceID);
  });

  console.log('Processed all mutations in', Date.now() - t0);
}
