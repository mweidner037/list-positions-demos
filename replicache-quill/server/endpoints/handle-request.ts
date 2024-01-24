import type {MutatorDefs} from 'replicache';
import {handlePull} from './replicache-pull.js';
import {handlePush} from './replicache-push.js';
import type Express from 'express';
import {handleCreateSpace, handleSpaceExist} from './handle-space.js';

export async function handleRequest<M extends MutatorDefs>(
  req: Express.Request,
  res: Express.Response,
  next: Express.NextFunction,
  mutators: M,
): Promise<void> {
  if (req.query === undefined) {
    res.status(400).send('Missing query');
    return;
  }

  const {op} = req.params;
  console.log(`Handling request ${JSON.stringify(req.body)}, op: ${op}`);

  switch (op) {
    case 'push':
      return await handlePush(req, res, next, mutators);
    case 'pull':
      return await handlePull(req, res, next);
    case 'createSpace':
      return await handleCreateSpace(req, res, next);
    case 'spaceExists':
      return await handleSpaceExist(req, res, next);
  }

  res.status(400).send({error: 'Invalid op'});
}
