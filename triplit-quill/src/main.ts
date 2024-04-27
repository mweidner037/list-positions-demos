import { ClientFetchResult, TriplitClient } from "@triplit/client";
import { RichText } from "@list-positions/formatting";
import {
  MAX_POSITION,
  MIN_POSITION,
  Position,
  expandPositions,
} from "list-positions";
import { schema } from "../triplit/schema";
import { QuillWrapper, WrapperOp } from "./quill_wrapper";

const client = new TriplitClient({
  schema,
  serverUrl: import.meta.env.VITE_TRIPLIT_SERVER_URL,
  token: import.meta.env.VITE_TRIPLIT_TOKEN,
});

const quillWrapper = new QuillWrapper(onLocalOps, makeInitialState());

// Send Triplit changes to Quill.
// Since queries are not incremental, we diff against the previous state
// and process changed (inserted/deleted) ids.
// Note that this will also capture local changes; quillWrapper will ignore
// those as redundant.

const bunches = client.query("bunches").build();
let lastBunchResults: ClientFetchResult<typeof bunches> = new Map();
client.subscribe(bunches, (results) => {
  const ops: WrapperOp[] = [];
  for (const [id, row] of results) {
    if (!lastBunchResults.has(id)) {
      // Process inserted row.
      ops.push({
        type: "meta",
        meta: { bunchID: row.id, parentID: row.parentID, offset: row.offset },
      });
    }
  }
  // Rows are never deleted, so no need to diff those.
  lastBunchResults = results;
  // TODO: are rows guaranteed to be in causal order?
  // Since we batch the applyOps call, it's okay if not, so long as the
  // whole table is causally consistent.
  quillWrapper.applyOps(ops);
});

const values = client.query("values").build();
let lastValuesResults: ClientFetchResult<typeof values> = new Map();
client.subscribe(values, (results) => {
  const ops: WrapperOp[] = [];
  for (const [id, row] of results) {
    if (!lastValuesResults.has(id)) {
      // Process inserted row.
      ops.push({
        type: "set",
        startPos: { bunchID: row.bunchID, innerIndex: row.innerIndex },
        chars: row.value,
      });
    }
  }
  // Diff in the other direction to find deleted rows.
  for (const [id, row] of lastValuesResults) {
    if (!results.has(id)) {
      // Process deleted row.
      ops.push({
        type: "delete",
        pos: { bunchID: row.bunchID, innerIndex: row.innerIndex },
      });
    }
  }
  lastValuesResults = results;
  // TODO: Are value & mark rows guaranteed to be updated after the bunch rows
  // that they depend on, given that our tx does so?
  // If not, we might get errors from missing BunchMeta dependencies.
  quillWrapper.applyOps(ops);
});

const marks = client.query("marks").build();
let lastMarksResults: ClientFetchResult<typeof marks> = new Map();
client.subscribe(marks, (results) => {
  const ops: WrapperOp[] = [];
  for (const [id, row] of results) {
    if (!lastMarksResults.has(id)) {
      // Process inserted row.
      ops.push({
        type: "mark",
        mark: {
          start: {
            pos: { bunchID: row.startBunchID, innerIndex: row.startInnerIndex },
            before: row.startBefore,
          },
          end: {
            pos: { bunchID: row.endBunchID, innerIndex: row.endInnerIndex },
            before: row.endBefore,
          },
          key: row.key,
          value: JSON.parse(row.value),
          creatorID: row.creatorID,
          timestamp: row.timestamp,
        },
      });
    }
  }
  // Rows are never deleted, so no need to diff those.
  lastMarksResults = results;
  quillWrapper.applyOps(ops);
});

// Send Quill changes to Triplit.
// Use a queue to avoid overlapping transactions (since onLocalOps is sync
// but transactions are async).

// TODO: Despite avoiding overlapping transactions and explicit fetches, I still
// get ReadWriteConflictErrors if I type/delete quickly (by holding down a
// keyboard key). Are tx writes conflicting with subscribe's reads?

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
      await client.transact(async (tx) => {
        for (const op of ops) {
          switch (op.type) {
            case "meta":
              await tx.insert("bunches", {
                id: op.meta.bunchID,
                parentID: op.meta.parentID,
                offset: op.meta.offset,
              });
              break;
            case "set":
              let i = 0;
              for (const pos of expandPositions(op.startPos, op.chars.length)) {
                await tx.insert("values", {
                  id: idOfPos(pos),
                  bunchID: pos.bunchID,
                  innerIndex: pos.innerIndex,
                  value: op.chars[i],
                });
                i++;
              }
              break;
            case "delete":
              await tx.delete("values", idOfPos(op.pos));
              break;
            case "mark":
              await tx.insert("marks", {
                startBunchID: op.mark.start.pos.bunchID,
                startInnerIndex: op.mark.start.pos.innerIndex,
                startBefore: op.mark.start.before,
                endBunchID: op.mark.end.pos.bunchID,
                endInnerIndex: op.mark.end.pos.innerIndex,
                endBefore: op.mark.end.before,
                key: op.mark.key,
                value: JSON.stringify(op.mark.value),
                creatorID: op.mark.creatorID,
                timestamp: op.mark.timestamp,
              });
              break;
          }
        }
      });
    }
  } finally {
    sendingLocalOps = false;
  }
}

/**
 * Fake initial saved state that's identical on all replicas: a single
 * "\n", to match Quill's initial state.
 */
function makeInitialState() {
  const richText = new RichText();
  // Use the same bunchID & BunchMeta on all replicas.
  const [pos] = richText.order.createPositions(MIN_POSITION, MAX_POSITION, 1, {
    bunchID: "INIT",
  });
  richText.text.set(pos, "\n");
  return richText.save();
}

function idOfPos(pos: Position): string {
  return `${pos.innerIndex},${pos.bunchID}`;
}
