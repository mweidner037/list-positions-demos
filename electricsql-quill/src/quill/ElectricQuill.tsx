import { useEffect, useRef } from "react";

import { useLiveQuery } from "electric-sql/react";
import { TimestampMark } from "list-formatting";
import { BunchMeta, Position, expandPositions } from "list-positions";
import { useElectric } from "../Loader";
import { QuillWrapper, WrapperOp } from "./quill_wrapper";

// TODO: Fix Quill double-toolbar in React strict mode.
// For now we just disable strict mode.
// See https://github.com/zenoamaro/react-quill/issues/784

/**
 * The state of a long-lived "instance" of the ElectricQuill component,
 * associated to a particular Quill instance.
 */
type InstanceState = {
  wrapper: QuillWrapper;
  curBunchIDs: Set<string>;
  curCharIDs: Set<string>;
  curMarkIDs: Set<string>;
};

export function ElectricQuill({
  docId,
  style,
}: {
  docId: string;
  style?: React.CSSProperties;
}) {
  const { db } = useElectric()!;

  const instanceStateRef = useRef<InstanceState | null>(null);
  const quillRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const wrapper = new QuillWrapper(
      quillRef.current!,
      onLocalOps,
      // Start with minimal initial state; existing db state loaded
      // in by queries below, analogous to new edits.
      QuillWrapper.makeInitialState()
    );
    instanceStateRef.current = {
      wrapper,
      curBunchIDs: new Set(),
      curCharIDs: new Set(),
      curMarkIDs: new Set(),
    };

    /**
     * Note: I use a strategy that describes the Quill state "transparently"
     * in the DB - e.g., there are rows corresponding to individual chars.
     * (Though it is not yet practical to query the text in order.)
     *
     * In principle, one could instead store the Quill state "opaquely",
     * by just storing the WrapperOps in an append-only log.
     * But one goal of list-positions is to allow transparent storage & updates,
     * instead of storing a CRDT library's opaque update blobs,
     * so that is what I demo here.
     */

    // Send local ops to the DB.
    async function onLocalOps(ops: WrapperOp[]) {
      // Encoded Positions to delete.
      // We batch these into a single DB op at the end, to prevent
      // gradual backspacing when a collaborator deletes a large selection.
      const toDelete: string[] = [];

      for (const op of ops) {
        switch (op.type) {
          case "set": {
            const poss = expandPositions(op.startPos, op.chars.length);
            await db.char_entries.createMany({
              data: poss.map((pos, i) => ({
                pos: encodePos(pos),
                char: op.chars[i],
                doc_id: docId,
              })),
            });
            break;
          }
          case "delete":
            for (const pos of expandPositions(op.startPos, op.count ?? 1)) {
              toDelete.push(encodePos(pos));
            }
            break;
          case "metas":
            // Note: It is important that receivers apply all of these BunchMetas together,
            // in case they have internal dependencies.
            await db.bunches.createMany({
              data: op.metas.map((meta) => ({
                id: meta.bunchID,
                parent_id: meta.parentID,
                the_offset: meta.offset,
                doc_id: docId,
              })),
            });
            break;
          case "marks":
            console.log(op.marks);
            await db.formatting_marks.createMany({
              data: op.marks.map((mark) => ({
                id: encodeMarkID(mark),
                start_pos: encodePos(mark.start.pos),
                start_before: mark.start.before,
                end_pos: encodePos(mark.end.pos),
                end_before: mark.end.before,
                the_key: mark.key,
                the_value: JSON.stringify(mark.value),
                doc_id: docId,
              })),
            });
            break;
        }
      }

      // Batched delete.
      if (toDelete.length !== 0) {
        await db.char_entries.deleteMany({
          where: { OR: toDelete.map((pos) => ({ pos })) },
        });
      }
    }

    return () => wrapper.destroy();
  }, [docId]);

  // Reflect DB ops in Quill.
  // Since queries are not incremental, we diff against the previous state
  // and process changed (inserted/deleted) ids.
  // Note that this will also capture local changes; QuillWrapper will ignore
  // those as redundant.
  const { results: bunches } = useLiveQuery(
    db.bunches.liveMany({ where: { doc_id: docId } })
  );
  const { results: charEntries } = useLiveQuery(
    db.char_entries.liveMany({ where: { doc_id: docId } })
  );
  const { results: marks } = useLiveQuery(
    db.formatting_marks.liveMany({ where: { doc_id: docId } })
  );

  if (instanceStateRef.current !== null) {
    const { wrapper, curBunchIDs, curCharIDs, curMarkIDs } =
      instanceStateRef.current;
    const newOps: WrapperOp[] = [];

    if (bunches) {
      const newBunchMetas: BunchMeta[] = [];
      for (const bunch of bunches) {
        if (!curBunchIDs.has(bunch.id)) {
          curBunchIDs.add(bunch.id);
          newBunchMetas.push({
            bunchID: bunch.id,
            parentID: bunch.parent_id,
            offset: bunch.the_offset,
          });
        }
      }
      if (newBunchMetas.length !== 0) {
        newOps.push({ type: "metas", metas: newBunchMetas });
      }
    }

    if (charEntries) {
      const unseenCharIDs = new Set(curCharIDs);
      for (const charEntry of charEntries) {
        if (!curCharIDs.has(charEntry.pos)) {
          curCharIDs.add(charEntry.pos);
          newOps.push({
            type: "set",
            startPos: decodePos(charEntry.pos),
            chars: charEntry.char,
          });
        }
        unseenCharIDs.delete(charEntry.pos);
      }
      // unseenCharIDs is the diff in the other direction, used to find deleted rows.
      for (const unseenCharID of unseenCharIDs) {
        newOps.push({
          type: "delete",
          startPos: decodePos(unseenCharID),
        });
        curCharIDs.delete(unseenCharID);
      }
    }

    if (marks) {
      for (const mark of marks) {
        if (!curMarkIDs.has(mark.id)) {
          curMarkIDs.add(mark.id);
          newOps.push({
            type: "marks",
            marks: [
              {
                ...decodeMarkID(mark.id),
                start: {
                  pos: decodePos(mark.start_pos),
                  before: mark.start_before,
                },
                end: {
                  pos: decodePos(mark.end_pos),
                  before: mark.end_before,
                },
                key: mark.the_key,
                value: JSON.parse(mark.the_value),
              },
            ],
          });
        }
      }
    }

    if (newOps.length !== 0) wrapper.applyOps(newOps);
  }

  return <div ref={quillRef} style={style} />;
}

function encodePos(pos: Position): string {
  return `${pos.bunchID}_${pos.innerIndex.toString(36)}`;
}

function decodePos(encoded: string): Position {
  const sep = encoded.lastIndexOf("_");
  const bunchID = encoded.slice(0, sep);
  const innerIndex = Number.parseInt(encoded.slice(sep + 1), 36);
  return { bunchID, innerIndex };
}

function encodeMarkID(mark: TimestampMark): string {
  return `${mark.creatorID}_${mark.timestamp.toString(36)}`;
}

function decodeMarkID(encoded: string): {
  creatorID: string;
  timestamp: number;
} {
  const sep = encoded.lastIndexOf("_");
  const creatorID = encoded.slice(0, sep);
  const timestamp = Number.parseInt(encoded.slice(sep + 1), 36);
  return { creatorID, timestamp };
}
