import { TriplitClient } from "@triplit/client";
import { RichList } from "list-formatting";
import { Order } from "list-positions";
import { schema } from "../triplit/schema";
import { QuillWrapper, WrapperOp } from "./quill_wrapper";

const client = new TriplitClient({
  schema,
  serverUrl: import.meta.env.VITE_TRIPLIT_SERVER_URL,
  token: import.meta.env.VITE_TRIPLIT_TOKEN,
});

const bunches = client.query("bunches").build();
client.subscribe(bunches, (results, info) => {
  console.log(results, info);
});
const values = client.query("values").build();
client.subscribe(values, (results, info) => {
  console.log(results, info);
});

const quillWrapper = new QuillWrapper(onLocalOps, makeInitialState());

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
              .where("bunchID", "=", op.pos.bunchID)
              .where("innerIndex", "=", op.pos.innerIndex)
              .build()
            // TODO: options type not working?
            // { policy: "local-only" }
          );
          if (search !== null) {
            await tx.delete("values", search[0]);
          }
          break;
        case "mark":
          console.log("TODO: marks");
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
