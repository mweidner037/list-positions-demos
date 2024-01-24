import {RichList, TimestampMark} from 'list-formatting';
import {Order} from 'list-positions';
import {
  ExperimentalDiffOperationAdd,
  ExperimentalDiffOperationChange,
  Replicache,
} from 'replicache';
import {Bunch, mutators} from 'shared';
import {QuillWrapper, WrapperOp} from './quill_wrapper';
import {createSpace, spaceExists} from './space';

async function init() {
  const {pathname} = window.location;

  if (pathname === '/' || pathname === '') {
    window.location.href = '/list/' + (await createSpace());
    return;
  }

  // URL layout is "/list/<listid>"
  const paths = pathname.split('/');
  const [, listDir, listID] = paths;
  if (
    listDir !== 'list' ||
    listID === undefined ||
    !(await spaceExists(listID))
  ) {
    window.location.href = '/';
    return;
  }

  // See https://doc.replicache.dev/licensing for how to get a license key.
  const licenseKey = import.meta.env.VITE_REPLICACHE_LICENSE_KEY;
  if (!licenseKey) {
    throw new Error('Missing VITE_REPLICACHE_LICENSE_KEY');
  }

  const r = new Replicache({
    licenseKey,
    pushURL: `/api/replicache/push?spaceID=${listID}`,
    pullURL: `/api/replicache/pull?spaceID=${listID}`,
    name: listID,
    mutators,
  });

  // Implements a Replicache poke using Server-Sent Events.
  // If a "poke" message is received, it will pull from the server.
  const ev = new EventSource(`/api/replicache/poke?spaceID=${listID}`, {
    withCredentials: true,
  });
  ev.onmessage = async event => {
    if (event.data === 'poke') {
      await r.pull();
    }
  };

  const quillWrapper = new QuillWrapper(onLocalOps, makeInitialState());

  // Send Quill changes to Replicache.
  // Use a queue to avoid reordered mutations (since onLocalOps is sync
  // but mutations are async).

  let localOpsQueue: WrapperOp[] = [];
  let sendingLocalOps = false;
  function onLocalOps(ops: WrapperOp[]) {
    localOpsQueue.push(...ops);
    if (!sendingLocalOps) void sendLocalOps();
  }

  async function sendLocalOps() {
    sendingLocalOps = true;
    try {
      while (localOpsQueue.length !== 0) {
        const ops = localOpsQueue;
        localOpsQueue = [];
        for (const op of ops) {
          switch (op.type) {
            case 'meta':
              await r.mutate.createBunch(op.meta);
              break;
            case 'set':
              await r.mutate.setValues({
                startPos: op.startPos,
                values: [...op.chars],
              });
              break;
            case 'delete':
              await r.mutate.deleteValues({
                startPos: op.startPos,
                count: op.count,
              });
              break;
            case 'marks':
              await r.mutate.addMarks({marks: op.marks});
              break;
          }
        }
      }
    } finally {
      sendingLocalOps = false;
    }
  }

  // Send Replicache changes to Quill.
  // TODO: should we treat the initial state separately?

  r.experimentalWatch(diff => {
    const wrapperOps: WrapperOp[] = [];
    for (const diffOp of diff) {
      if (diffOp.key.startsWith('bunch/')) {
        switch (diffOp.op) {
          case 'add': {
            const op = diffOp as ExperimentalDiffOperationAdd<string, Bunch>;
            wrapperOps.push({
              type: 'meta',
              meta: {
                bunchID: op.newValue.bunchID,
                parentID: op.newValue.parentID,
                offset: op.newValue.offset,
              },
            });
            for (const [indexStr, char] of Object.entries(op.newValue.values)) {
              const innerIndex = Number.parseInt(indexStr);
              wrapperOps.push({
                type: 'set',
                startPos: {bunchID: op.newValue.bunchID, innerIndex},
                chars: char,
              });
            }
            break;
          }
          case 'change': {
            const op = diffOp as ExperimentalDiffOperationChange<string, Bunch>;
            // Need to manually diff op.oldValue and op.newValue.
            // Luckily, bunches are usually small (10-100 chars?).

            // deletedKeys collects keys present in oldValue but not newValue.
            const deletedKeys = new Set(Object.keys(op.oldValue.values));
            for (const [indexStr, newChar] of Object.entries(
              op.newValue.values,
            )) {
              const innerIndex = Number.parseInt(indexStr);
              const oldChar = op.oldValue.values[innerIndex];
              if (newChar !== oldChar) {
                wrapperOps.push({
                  type: 'set',
                  startPos: {bunchID: op.newValue.bunchID, innerIndex},
                  chars: newChar,
                });
              }
              deletedKeys.delete(indexStr);
            }
            for (const indexStr of deletedKeys) {
              wrapperOps.push({
                type: 'delete',
                startPos: {
                  bunchID: op.newValue.bunchID,
                  innerIndex: Number.parseFloat(indexStr),
                },
                count: 1,
              });
            }
            break;
          }
          default:
            console.error('Unexpected op on bunch key:', diffOp.op, diffOp.key);
        }
      } else if (diffOp.key.startsWith('mark/')) {
        switch (diffOp.op) {
          case 'add':
            const op = diffOp as ExperimentalDiffOperationAdd<
              string,
              TimestampMark
            >;
            wrapperOps.push({type: 'marks', marks: [op.newValue]});
            break;
          default:
            console.error('Unexpected op on mark key:', diffOp.op, diffOp.key);
        }
      } else {
        console.error('Unexpected key:', diffOp.key);
      }
    }

    quillWrapper.applyOps(wrapperOps);
  });
}
await init();

/**
 * Fake initial saved state that's identical on all replicas: a single
 * "\n", to match Quill's initial state.
 */
function makeInitialState() {
  const richList = new RichList<string>({
    order: new Order({newBunchID: () => 'INIT'}),
  });
  richList.list.insertAt(0, '\n');
  return richList.save();
}
