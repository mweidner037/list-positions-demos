import {transact} from './pg.js';
import {getChangedEntries, getCookie, getLastMutationIDsSince} from './data.js';
import {z} from 'zod';
import type {ClientID, PatchOperation} from 'replicache';
import type Express from 'express';

const pullRequest = z.object({
  profileID: z.string(),
  clientGroupID: z.string(),
  cookie: z.union([z.number(), z.null()]),
  schemaVersion: z.string(),
});

export type PullResponse = {
  cookie: number;
  lastMutationIDChanges: Record<ClientID, number>;
  patch: PatchOperation[];
};

export async function pull(
  spaceID: string,
  requestBody: Express.Request,
): Promise<PullResponse> {
  console.log(`Processing pull`, JSON.stringify(requestBody, null, ''));

  const pull = pullRequest.parse(requestBody);
  const {cookie: requestCookie} = pull;

  console.log('spaceID', spaceID);

  const t0 = Date.now();
  const sinceCookie = requestCookie ?? 0;

  const [entries, lastMutationIDChanges, responseCookie] = await transact(
    async executor => {
      return Promise.all([
        getChangedEntries(executor, spaceID, sinceCookie),
        getLastMutationIDsSince(executor, pull.clientGroupID, sinceCookie),
        getCookie(executor, spaceID),
      ]);
    },
  );

  console.log('lastMutationIDChanges: ', lastMutationIDChanges);
  console.log('responseCookie: ', responseCookie);
  console.log('Read all objects in', Date.now() - t0);

  if (responseCookie === undefined) {
    throw new Error(`Unknown space ${spaceID}`);
  }

  const resp: PullResponse = {
    lastMutationIDChanges,
    cookie: responseCookie,
    patch: [],
  };

  for (const [key, value, deleted] of entries) {
    if (deleted) {
      resp.patch.push({
        op: 'del',
        key,
      });
    } else {
      resp.patch.push({
        op: 'put',
        key,
        value,
      });
    }
  }

  console.log(`Returning`, JSON.stringify(resp, null, ''));
  return resp;
}
