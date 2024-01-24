import type Express from 'express';
import {getPokeBackend} from '../src/poke.js';

export async function handlePoke(
  req: Express.Request,
  res: Express.Response,
): Promise<void> {
  if (req.query.spaceID === undefined) {
    res.status(400).send('Missing spaceID');
    return;
  }
  const {spaceID} = req.query;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'text/event-stream;charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');

  res.write(`id: ${Date.now()}\n`);
  res.write(`data: hello\n\n`);

  const pokeBackend = getPokeBackend();

  const unlisten = pokeBackend.addListener(spaceID as string, () => {
    console.log(`Sending poke for space ${spaceID}`);
    res.write(`id: ${Date.now()}\n`);
    res.write(`data: poke\n\n`);
  });

  setInterval(() => {
    res.write(`id: ${Date.now()}\n`);
    res.write(`data: beat\n\n`);
  }, 30 * 1000);

  res.on('close', () => {
    console.log('Closing poke connection');
    unlisten();
  });
}
