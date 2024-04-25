import {
  AnnotatedStep,
  Mutation,
  ReplacePositions,
  idEquals,
} from "../common/mutation";
import { EditorState, Plugin, Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Mark, Schema, Slice } from "prosemirror-model";
import { schema as schemaBasic } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";
import { exampleSetup } from "prosemirror-example-setup";
import { maybeRandomString } from "maybe-random-string";
import {
  AddMarkStep,
  AddNodeMarkStep,
  AttrStep,
  DocAttrStep,
  RemoveMarkStep,
  RemoveNodeMarkStep,
  ReplaceAroundStep,
  ReplaceStep,
  Step,
} from "prosemirror-transform";

import "prosemirror-menu/style/menu.css";
import "prosemirror-view/style/prosemirror.css";
import "prosemirror-example-setup/style/style.css";
import {
  MAX_POSITION,
  MIN_POSITION,
  OrderSavedState,
  Outline,
  OutlineSavedState,
} from "list-positions";

const DEBUG = false;

// Mix the nodes from prosemirror-schema-list into the basic schema to
// create a schema with list support.
const schema = new Schema({
  nodes: addListNodes(schemaBasic.spec.nodes, "paragraph block*", "block"),
  marks: schemaBasic.spec.marks,
});

export class ProseMirrorWrapper {
  readonly view: EditorView;
  readonly clientID: string;
  private clientCounter = 0;
  private outline: Outline;

  /**
   * Our pending local mutations, which have not yet been confirmed by the server.
   */
  private pendingMutations: {
    readonly mutation: Mutation;
    /**
     * Function to undo the local application of this mutation (PM & CRDT state).
     *
     * For changes to PM, apply them to undoTr instead of directly to the view.
     */
    undo: (undoTr: Transaction) => void;
  }[] = [];

  constructor(readonly onLocalMutation: (mutation: Mutation) => void) {
    this.clientID = maybeRandomString();
    this.outline = new Outline();

    this.view = new EditorView(document.querySelector("#editor"), {
      state: EditorState.create({
        schema,
        plugins: [
          ...exampleSetup({ schema }),
          new Plugin({
            // Notify the history plugin not to merge steps, like in the prosemirror-collab
            // plugin. (TODO: is this actually necessary?)
            historyPreserveItems: true,
          }),
        ],
      }),
      dispatchTransaction: (tr) => this.dispatchTransaction(tr),
    });

    // Insert initial Positions to match the doc size, identical on all replicas.
    const [orderSavedState, outlineSavedState] = makeInitialState(
      this.view.state.doc.nodeSize
    );
    this.outline.order.load(orderSavedState);
    this.outline.load(outlineSavedState);
  }

  private dispatchTransaction(tr: Transaction): void {
    this.view.updateState(this.view.state.apply(tr));

    if (tr.steps.length === 0) return;

    const annSteps: AnnotatedStep[] = [];
    const undoSteps: Step[] = [];
    const undoOutlineChanges: (() => void)[] = [];
    for (let i = 0; i < tr.steps.length; i++) {
      const step = tr.steps[i];
      undoSteps.push(step.invert(tr.docs[i]));

      if (step instanceof ReplaceStep) {
        const annStep: AnnotatedStep = {
          type: "replace",
          positions: this.toReplacePositions(
            step.from,
            step.to,
            step.slice.size,
            "left"
          ),
          sliceJSON: step.slice.toJSON(),
          // @ts-expect-error structure marked internal
          structure: step.structure,
        };

        // Update this.outline to reflect the local changes.
        undoOutlineChanges.push(
          this.applyReplacePositions(
            annStep.positions,
            step.from,
            step.to,
            step.slice.size
          )
        );

        annSteps.push(annStep);
      } else if (step instanceof ReplaceAroundStep) {
        const sliceAfterInsert = step.slice.size - step.insert;
        const annStep: AnnotatedStep = {
          type: "replaceAround",
          leftPositions: this.toReplacePositions(
            step.from,
            step.gapFrom,
            step.insert,
            "left"
          ),
          rightPositions: this.toReplacePositions(
            step.gapTo,
            step.to,
            sliceAfterInsert,
            "right"
          ),
          sliceJSON: step.slice.toJSON(),
          sliceInsert: step.insert,
          // @ts-expect-error structure marked internal
          structure: step.structure,
        };

        // Update this.outline to reflect the local changes.
        // Important to update later indices first.
        undoOutlineChanges.push(
          this.applyReplacePositions(
            annStep.rightPositions,
            step.gapTo,
            step.to,
            sliceAfterInsert
          )
        );
        undoOutlineChanges.push(
          this.applyReplacePositions(
            annStep.leftPositions,
            step.from,
            step.gapFrom,
            step.insert
          )
        );

        annSteps.push(annStep);
      } else if (
        step instanceof AddMarkStep ||
        step instanceof RemoveMarkStep
      ) {
        annSteps.push({
          type: "changeMark",
          isAdd: step instanceof AddMarkStep,
          fromPos: this.outline.cursorAt(step.from, "right"),
          toPos: this.outline.cursorAt(step.to, "left"),
          markJSON: step.mark.toJSON(),
        });
      } else if (
        step instanceof AddNodeMarkStep ||
        step instanceof RemoveNodeMarkStep
      ) {
        // TODO: test (need to find a setup that uses this step).
        annSteps.push({
          type: "changeNodeMark",
          isAdd: step instanceof AddNodeMarkStep,
          pos: this.outline.positionAt(step.pos),
          markJSON: step.mark.toJSON(),
        });
      } else if (step instanceof AttrStep) {
        // TODO: test (need to find a setup that uses this step).
        annSteps.push({
          type: "attr",
          pos: this.outline.positionAt(step.pos),
          attr: step.attr,
          value: step.value,
        });
      } else if (step instanceof DocAttrStep) {
        // TODO: test (need to find a setup that uses this step).
        annSteps.push({ type: "docAttr", attr: step.attr, value: step.value });
      } else {
        console.warn(
          "Unsupported step type, skipping:",
          step.constructor.name,
          step.toJSON()
        );
      }

      // Sanity checking.
      const doc = i === tr.steps.length - 1 ? tr.doc : tr.docs[i + 1];
      if (this.outline.length !== doc.nodeSize) {
        console.error(
          "(Receive) Lengths no longer match after",
          annSteps.at(-1),
          step
        );
        console.error("  Resulting doc:", doc);
        return;
      }
    }

    const mutation: Mutation = {
      clientID: this.clientID,
      clientCounter: this.clientCounter++,
      annSteps,
    };
    if (DEBUG) console.log("Local", mutation, tr.steps);
    this.pendingMutations.push({
      mutation,
      undo: (undoTr) => {
        for (let i = undoSteps.length - 1; i >= 0; i--) {
          undoTr.step(undoSteps[i]);
        }
        for (let i = undoOutlineChanges.length - 1; i >= 0; i--) {
          undoOutlineChanges[i]();
        }
      },
    });

    this.onLocalMutation(mutation);
  }

  /**
   * Computes ReplacePositions corresponding to a ReplaceStep or one side of
   * a ReplaceAroundStep.
   *
   * @param bias Whether to bias the insertion Position towards the left or right side of
   * the deleted range.
   */
  private toReplacePositions(
    from: number,
    to: number,
    insertionCount: number,
    bias: "left" | "right"
  ): ReplacePositions {
    if (from === to && insertionCount === 0) {
      throw new Error("Unsupported: trivial replacement");
    }

    const ans: ReplacePositions = {};
    if (insertionCount !== 0) {
      // There is content to insert.
      let insertionIndex: number;
      if (to === from) {
        insertionIndex = from;
      } else if (to - from >= 2) {
        // Insert in the middle of the deleted positions, so that the resolved
        // [from, to) range always contains the insertion position.
        insertionIndex = bias === "left" ? from + 1 : to - 1;
      } else {
        // Bias the insert in the given direction. That way, if we have
        // to stretch the resolved [from, to) range to include the insertion position
        // (so that the resolved Replace[Around]Step is well-formed),
        // then the range expands in the given direction.
        insertionIndex = bias === "left" ? from : to;
      }

      // Use insertAt-then-delete to create the positions without actually changing this.outline yet.
      // (Lazy version of calling this.outline.order.createPositions.)
      const [startPos, meta] = this.outline.insertAt(
        insertionIndex,
        insertionCount
      );
      this.outline.delete(startPos, insertionCount);

      ans.insert = { meta, startPos };
    }

    if (to > from) {
      // There is deleted content.
      ans.delete = {
        startPos: this.outline.cursorAt(from, "right"),
        endPos: this.outline.cursorAt(to, "left"),
      };
    }

    return ans;
  }

  /**
   * Updates this.outline to match the effect of a ReplaceStep or one side of
   * a ReplaceAroundStep.
   *
   * from and to must match the rebased step (in the current state)
   * and not be invalidated by earlier changes to this.outline.
   *
   * @returns Function that undoes the changes to this.outline.
   */
  private applyReplacePositions(
    positions: ReplacePositions,
    from: number,
    to: number,
    insertionCount: number
  ): () => void {
    const toDelete = [...this.outline.positions(from, to)];
    for (const pos of toDelete) this.outline.delete(pos);
    if (positions.insert) {
      this.outline.add(positions.insert.startPos, insertionCount);
    }

    return () => {
      if (positions.insert) {
        this.outline.delete(positions.insert.startPos, insertionCount);
      }
      for (const pos of toDelete) this.outline.add(pos);
    };
  }

  /**
   * Returns the rebased range [from, to) corresponding to positions.
   *
   * Also updates this.outline's Order metadata.
   */
  private fromReplacePositions(
    positions: ReplacePositions
  ): [from: number, to: number] {
    if (positions.insert?.meta) {
      this.outline.order.addMetas([positions.insert.meta]);
    }

    let from: number;
    let to: number;
    if (positions.delete) {
      // The original deleted range was nonempty, so even if already deleted,
      // it is never the case that to < from.
      from = this.outline.indexOfCursor(positions.delete.startPos, "right");
      to = this.outline.indexOfCursor(positions.delete.endPos, "left");
      if (positions.insert) {
        // Ensure from <= insertionIndex <= to, stretching the deleted the range if needed.
        // Otherwise, our changes to this.outline won't match ProseMirror's changes.
        const insertionIndex = this.outline.indexOfPosition(
          positions.insert.startPos,
          "right"
        );
        if (DEBUG && (insertionIndex < from || insertionIndex > to)) {
          console.log(
            "Expanding delete range for insert",
            from,
            to,
            insertionIndex
          );
          console.log(positions.insert.startPos, [...this.outline.positions()]);
        }
        from = Math.min(from, insertionIndex);
        to = Math.max(to, insertionIndex);
      }
    } else {
      // Use insertion index, i.e., the index where startPos will be once present.
      from = this.outline.indexOfPosition(positions.insert!.startPos, "right");
      to = from;
    }

    return [from, to];
  }

  receive(mutations: Mutation[]): void {
    const tr = this.view.state.tr;

    // Optimization: If the first mutations are confirming our first pending local mutations,
    // just mark those as not-pending.
    const matches = (() => {
      let i = 0;
      for (
        ;
        i < Math.min(mutations.length, this.pendingMutations.length);
        i++
      ) {
        if (!idEquals(mutations[i], this.pendingMutations[i].mutation)) break;
      }
      return i;
    })();
    mutations = mutations.slice(matches);
    this.pendingMutations = this.pendingMutations.slice(matches);

    // Process remaining mutations normally.

    if (mutations.length === 0) return;

    // For remaining mutations, we need to undo pending - do mutations - redo pending.
    for (let p = this.pendingMutations.length - 1; p >= 0; p--) {
      this.pendingMutations[p].undo(tr);
    }

    for (let i = 0; i < mutations.length; i++) {
      this.applyMutation(mutations[i], tr);
      // If it's one of ours (possibly interleaved with remote messages),
      // remove it from this.pendingMessages.
      // As a consequence, it won't be redone.
      if (
        this.pendingMutations.length !== 0 &&
        idEquals(mutations[i], this.pendingMutations[0].mutation)
      ) {
        this.pendingMutations.shift();
      }
      // TODO: If the server could deliberately skip (or modify) messages, we need
      // to get an ack from the server and make use of it.
    }

    for (let p = 0; p < this.pendingMutations.length; p++) {
      // Apply the CRDT-ified version of the pending mutation, since it's being
      // rebased on top of a different state from where it was originally applied.
      this.pendingMutations[p].undo = this.applyMutation(
        this.pendingMutations[p].mutation,
        tr
      );
    }

    tr.setMeta("addToHistory", false);
    this.view.updateState(this.view.state.apply(tr));
  }

  /**
   * @returns Undo function
   */
  private applyMutation(
    mutation: Mutation,
    tr: Transaction
  ): (undoTr: Transaction) => void {
    if (DEBUG) console.log("Apply", mutation);

    const undoSteps: Step[] = [];
    const undoOutlineChanges: (() => void)[] = [];

    let firstFailure = true;
    for (const annStep of mutation.annSteps) {
      switch (annStep.type) {
        case "replace": {
          const [from, to] = this.fromReplacePositions(annStep.positions);
          const slice = Slice.fromJSON(schema, annStep.sliceJSON);
          const step = new ReplaceStep(from, to, slice, annStep.structure);

          const success = maybeStep(tr, step, annStep);
          if (success) {
            // Update Outline to match and record undo command.
            undoSteps.push(step.invert(tr.docs.at(-1)!));
            undoOutlineChanges.push(
              this.applyReplacePositions(
                annStep.positions,
                from,
                to,
                slice.size
              )
            );
          }
          break;
        }
        case "replaceAround": {
          const [from, gapFrom] = this.fromReplacePositions(
            annStep.leftPositions
          );
          const [gapTo, to] = this.fromReplacePositions(annStep.rightPositions);
          const slice = Slice.fromJSON(schema, annStep.sliceJSON);
          const step = new ReplaceAroundStep(
            from,
            to,
            gapFrom,
            gapTo,
            slice,
            annStep.sliceInsert,
            annStep.structure
          );

          const success = maybeStep(tr, step, annStep);
          if (success) {
            // Update Outline to match and record undo command.
            undoSteps.push(step.invert(tr.docs.at(-1)!));
            // Important to update later indices first.
            undoOutlineChanges.push(
              this.applyReplacePositions(
                annStep.rightPositions,
                gapTo,
                to,
                slice.size - annStep.sliceInsert
              )
            );
            undoOutlineChanges.push(
              this.applyReplacePositions(
                annStep.leftPositions,
                from,
                gapFrom,
                annStep.sliceInsert
              )
            );
          }
          break;
        }
        case "changeMark": {
          const from = this.outline.indexOfCursor(annStep.fromPos, "right");
          const to = this.outline.indexOfCursor(annStep.toPos, "left");
          const mark = Mark.fromJSON(schema, annStep.markJSON);
          const step: AddMarkStep | RemoveMarkStep = new (
            annStep.isAdd ? AddMarkStep : RemoveMarkStep
          )(from, to, mark);
          const success = maybeStep(tr, step, annStep);
          if (success) {
            // Record undo command.
            undoSteps.push(step.invert());
          }
          break;
        }
        case "changeNodeMark": {
          const pos = this.outline.indexOfPosition(annStep.pos);
          if (pos === -1) continue;
          const mark = Mark.fromJSON(schema, annStep.markJSON);
          const step: AddNodeMarkStep | RemoveNodeMarkStep = new (
            annStep.isAdd ? AddNodeMarkStep : RemoveNodeMarkStep
          )(pos, mark);
          const success = maybeStep(tr, step, annStep);
          if (success) {
            // Record undo command.
            undoSteps.push(step.invert(tr.docs.at(-1)!));
          }
          break;
        }
        case "attr": {
          const pos = this.outline.indexOfPosition(annStep.pos);
          if (pos === -1) continue;
          const step = new AttrStep(pos, annStep.attr, annStep.value);
          const success = maybeStep(tr, step, annStep);
          if (success) {
            // Record undo command.
            undoSteps.push(step.invert(tr.docs.at(-1)!));
          }
          break;
        }
        case "docAttr": {
          const step = new DocAttrStep(annStep.attr, annStep.value);
          const success = maybeStep(tr, step, annStep);
          if (success) {
            // Record undo command.
            undoSteps.push(step.invert(tr.docs.at(-1)!));
          }
          break;
        }
        default:
          const neverAnnStep: never = annStep;
          console.error("Unknown AnnotatedStep type:", neverAnnStep);
      }

      // Sanity checking.
      if (this.outline.length !== tr.doc.nodeSize && firstFailure) {
        firstFailure = false;
        console.error(
          "(Receive) Lengths no longer match after",
          annStep,
          tr.steps.at(-1)
        );
        console.error("  Resulting doc:", tr.doc);
      }
    }

    return (undoTr) => {
      for (let i = undoSteps.length - 1; i >= 0; i--) {
        undoTr.step(undoSteps[i]);
      }
      for (let i = undoOutlineChanges.length - 1; i >= 0; i--) {
        undoOutlineChanges[i]();
      }
    };
  }
}

/**
 * @returns Success
 */
function maybeStep(
  tr: Transaction,
  step: Step,
  annStep: AnnotatedStep
): boolean {
  try {
    const stepResult = tr.maybeStep(step);
    if (stepResult.failed) {
      console.log(`${annStep.type} failed:`, stepResult.failed, step, annStep);
      return false;
    }
    return true;
  } catch (err) {
    // Allegedly this is not supposed to happen if you rebase correctly, but
    // I can't seem to prevent it.
    // See https://github.com/ProseMirror/prosemirror/issues/873
    // E.g.:
    // - Start with 3 paragraphs.
    // - Alice converts first two into an ordered list.
    // - While offline, Bob converts last two into an ordered list.
    // - Bob's change rebased: ReplaceAroundStep applying the <ol></ol> fails
    // as expected. But then the ReplaceStep applying the <li></li>'s fails with
    // an error (invalid content for list-node: <>), which I think is because
    // the 3rd <li> is no longer inside an <ol>, hence gets upset.
    console.log(`${annStep.type} errored:`, `${err}`, step, annStep);
    return false;
  }
}

function makeInitialState(
  initSize: number
): [order: OrderSavedState, outline: OutlineSavedState] {
  const outline = new Outline();
  const [initPos] = outline.order.createPositions(
    MIN_POSITION,
    MAX_POSITION,
    initSize,
    { bunchID: "INIT" }
  );
  outline.add(initPos, initSize);

  return [outline.order.save(), outline.save()];
}
