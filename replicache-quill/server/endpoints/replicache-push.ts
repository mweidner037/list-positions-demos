import type {MutatorDefs} from 'replicache';
import {push} from '../src/push.js';

import type Express from 'express';

export async function handlePush<M extends MutatorDefs>(
  req: Express.Request,
  res: Express.Response,
  next: Express.NextFunction,
  mutators: M,
): Promise<void> {
  if (req.query.spaceID === undefined) {
    res.status(400).send('Missing spaceID');
    return;
  }
  const spaceID = req.query.spaceID.toString() as string;
  try {
    await push(spaceID, req.body, mutators);
    res.status(200).json({});
  } catch (e: any) {
    next(Error(e));
  }
}
