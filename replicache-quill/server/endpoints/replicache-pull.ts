import type Express from 'express';
import {pull} from '../src/pull.js';

export async function handlePull(
  req: Express.Request,
  res: Express.Response,
  next: Express.NextFunction
): Promise<void> {
  if (req.query.spaceID === undefined) {
    res.status(400).json({ error: "spaceID is required" });
    return;
  }
  const { spaceID } = req.query;
  try {
    const resp = await pull(spaceID as string, req.body);
    res.json(resp);
  } catch (e: any) {
    next(Error(e));
  }
}

