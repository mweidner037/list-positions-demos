import { ClientFetchResult, TriplitClient } from "@triplit/client";
import { RichList } from "list-formatting";
import { Order } from "list-positions";
import { schema } from "../triplit/schema";
import { QuillWrapper, WrapperOp } from "./quill_wrapper";

const client = new TriplitClient({
  schema,
  serverUrl: import.meta.env.VITE_TRIPLIT_SERVER_URL,
  token: import.meta.env.VITE_TRIPLIT_TOKEN,
});

const quillWrapper = new QuillWrapper(onLocalOps, makeInitialState());

// Sync Triplit changes to Quill.
// Since queries are not incremental, we diff against the previous state
// and process changed (inserted/deleted) ids.

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
  // Rows are never deleted, so need to diff those.
  // TODO: try without clone.
  lastBunchResults = new Map(results);
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
  // TODO: try without clone.
  lastValuesResults = new Map(results);
  // TODO: Are value rows guaranteed to be updated after the bunch rows
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
  // Rows are never deleted, so need to diff those.
  // TODO: try without clone.
  lastMarksResults = new Map(results);
  // TODO: Are value rows guaranteed to be updated after the bunch rows
  // that they depend on, given that our tx does so?
  // If not, we might get errors from missing BunchMeta dependencies.
  quillWrapper.applyOps(ops);
});

/**
 * Syncs Quill changes to Triplit.
 */
function onLocalOps(ops: WrapperOp[]): void {
  client.transact(async (tx) => {
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
          for (const pos of Order.startPosToArray(
            op.startPos,
            op.chars.length
          )) {
            await tx.insert("values", {
              bunchID: pos.bunchID,
              innerIndex: pos.innerIndex,
              value: op.chars[i],
            });
            i++;
          }
          break;
        case "delete":
          const search = await tx.fetchOne(
            client
              .query("values")
              .where(
                ["bunchID", "=", op.pos.bunchID],
                ["innerIndex", "=", op.pos.innerIndex]
              )
              .build(),
            // TODO: why type error here?
            // @ts-ignore
            { policy: "local-only" }
          );
          if (search !== null) {
            // TODO: weird types here. Appears to return the record.
            await tx.delete("values", (search as any).id);
          } else {
            console.error("delete search null?");
          }
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

/**
 * Fake initial saved state that's identical on all replicas: a single
 * "\n", to match Quill's initial state.
 */
function makeInitialState() {
  const richList = new RichList<string>({
    order: new Order({ newBunchID: () => "INIT" }),
  });
  richList.list.insertAt(0, "\n");
  return richList.save();
}
