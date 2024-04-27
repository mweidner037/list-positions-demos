// This file defines our "mutators".
//
// Mutators are how you change data in Replicache apps.
//
// They are registered with Replicache at construction-time and callable like:
// `myReplicache.mutate.createTodo({text: "foo"})`.
//
// Replicache runs each mutation immediately (optimistically) on the client,
// against the local cache, and then later (usually moments later) sends a
// description of the mutation (its name and arguments) to the server, so that
// the server can *re-run* the mutation there against the authoritative
// datastore.
//
// This re-running of mutations is how Replicache handles conflicts: the
// mutators defensively check the database when they run and do the appropriate
// thing. The Replicache sync protocol ensures that the server-side result takes
// precedence over the client-side optimistic result.
//
// If the server is written in JavaScript, the mutator functions can be directly
// reused on the server. This sample demonstrates the pattern by using these
// mutators both with Replicache on the client (see [id]].tsx) and on the server
// (see pages/api/replicache/[op].ts).
//
// See https://doc.replicache.dev/how-it-works#sync-details for all the detail
// on how Replicache syncs and resolves conflicts, but understanding that is not
// required to get up and running.

import type {ReadonlyJSONValue, WriteTransaction} from 'replicache';
import {
  idOfMark,
  type AddMarks,
  type Bunch,
  type CreateBunch,
  type DeleteValues,
  type SetValues,
} from './rich_text';

export type M = typeof mutators;

export const mutators = {
  createBunch: async (tx: WriteTransaction, update: CreateBunch) => {
    const existing = await tx.get<Bunch>(`bunch/${update.bunchID}`);
    if (existing !== undefined) {
      console.warn('createBunch: Skipping duplicate bunchID:', update.bunchID);
      return;
    }
    const newBunch: Bunch = {meta: update, values: {}};
    await tx.set(`bunch/${update.bunchID}`, newBunch);
  },

  setValues: async (tx: WriteTransaction, update: SetValues) => {
    const existing = await tx.get<Bunch>(`bunch/${update.startPos.bunchID}`);
    if (existing === undefined) {
      console.error(
        'setValues: Skipping unknown bunchID:',
        update.startPos.bunchID,
      );
      return;
    }
    const values: Record<number, string> = {...existing.values};
    for (let i = 0; i < update.values.length; i++) {
      values[i + update.startPos.innerIndex] = update.values[i];
    }
    const updated: Bunch = {...existing, values};
    await tx.set(`bunch/${update.startPos.bunchID}`, updated);
  },

  deleteValues: async (tx: WriteTransaction, update: DeleteValues) => {
    const existing = await tx.get<Bunch>(`bunch/${update.startPos.bunchID}`);
    if (existing === undefined) {
      console.error(
        'setValues: Skipping unknown bunchID:',
        update.startPos.bunchID,
      );
      return;
    }
    const values: Record<number, string> = {...existing.values};
    for (let i = 0; i < update.count; i++) {
      delete values[i + update.startPos.innerIndex];
    }
    const updated: Bunch = {...existing, values};
    await tx.set(`bunch/${update.startPos.bunchID}`, updated);
  },

  addMarks: async (tx: WriteTransaction, update: AddMarks) => {
    for (const mark of update.marks) {
      const id = idOfMark(mark);
      const existing = await tx.get<Bunch>(`mark/${id}`);
      if (existing !== undefined) {
        console.warn('addMarks: Skipping duplicate mark ID:', id);
        continue;
      }
      // ReadonlyJSONValue is supposed to express that the value is deep-readonly.
      // Because of https://github.com/microsoft/TypeScript/issues/15300 , though,
      // it doesn't work on JSON objects whose type is (or includes) an interface.
      await tx.set(`mark/${id}`, mark as unknown as ReadonlyJSONValue);
    }
  },
};
