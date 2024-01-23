import {nanoid} from 'nanoid';
import type Express from 'express';
import { transact } from '../src/pg.js';
import { getCookie, createSpace } from "../src/data.js";

export async function handleCreateSpace(
  req: Express.Request,
  res: Express.Response,
  next: Express.NextFunction
): Promise<void> {
  let spaceID = nanoid(6);
  if (req.body.spaceID) {
    spaceID = req.body.spaceID;
  }
  if (spaceID.length > 10) {
    next(Error(`SpaceID must be 10 characters or less`));
  }
  try {
    await transact(async (executor) => {
      await createSpace(executor, spaceID);
    });
    res.status(200).send({ spaceID });
  } catch (e: any) {
    next(Error(`Failed to create space ${spaceID}`, e));
  }
}

export async function handleSpaceExist(
  req: Express.Request,
  res: Express.Response,
  next: Express.NextFunction
): Promise<void> {
  try {
    const cookie = await transact(async (executor) => {
      return await getCookie(executor, req.body.spaceID);
    });
    const exists = cookie !== undefined;
    res.status(200).send({ spaceExists: exists });
  } catch (e: any) {
    next(Error(`Failed to check space exists ${req.body.spaceID}`, e));
  }
}