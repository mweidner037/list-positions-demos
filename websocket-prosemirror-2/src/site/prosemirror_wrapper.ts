import { AnnotatedStep, Mutation, idEquals } from "../common/mutation";
import { EditorState, Plugin, Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Mark, Schema, Slice } from "prosemirror-model";
import { schema as schemaBasic } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";
import {
  buildInputRules,
  buildKeymap,
  buildMenuItems,
} from "prosemirror-example-setup";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { menuBar } from "prosemirror-menu";
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
import { MAX_POSITION, MIN_POSITION, Outline } from "list-positions";

// TODO: remove menu buttons: undo/redo

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

  private pendingMutations: {
    readonly mutation: Mutation;
    /**
     * Function to undo the local application of this mutation (PM + CRDT state).
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
        // Modified from prosemirror-example-setup.
        plugins: [
          buildInputRules(schema),
          keymap(buildKeymap(schema)),
          keymap(baseKeymap),
          menuBar({ floating: true, content: buildMenuItems(schema).fullMenu }),
          new Plugin({
            props: { attributes: { class: "ProseMirror-example-setup-style" } },
          }),
        ],
      }),
      dispatchTransaction: (tr) => this.dispatchTransaction(tr),
    });

    // Insert initial Positions to match the doc size, identical on all replicas.
    const initSize = this.view.state.doc.nodeSize;
    const [initPos] = this.outline.order.createPositions(
      MIN_POSITION,
      MAX_POSITION,
      initSize,
      { bunchID: "INIT" }
    );
    this.outline.add(initPos, initSize);
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
          sliceJSON: step.slice.toJSON(),
          // @ts-expect-error structure marked internal
          structure: step.structure,
        };

        if (step.slice.size !== 0) {
          // There is content to insert.
          let insertionIndex: number;
          if (step.to === step.from) {
            // No deletion, just insert before the gap.
            insertionIndex = step.from;
          } else if (step.to - step.from >= 2) {
            // Insert in the middle of the deleted positions, so that the resolved
            // [from, to) range always contains the insertion position.
            insertionIndex = step.from + 1;
          } else {
            // Arbitrary choice: insert after the deleted position.
            // Either way, we may have to stretch the resolved [from, to) range to include
            // the insertion position (so that the resolved ReplaceStep is well-formed),
            // which awkwardly deletes concurrently-inserted content.
            insertionIndex = step.from + 1;
          }

          // Use insertAt-then-delete to create the positions without actually changing this.outline yet.
          const [startPos, meta] = this.outline.insertAt(
            insertionIndex,
            step.slice.size
          );
          this.outline.delete(startPos, step.slice.size);

          annStep.insert = { meta, startPos };
        }

        if (step.to > step.from) {
          // There is deleted content.
          annStep.delete = {
            startPos: this.outline.cursorAt(step.from, "right"),
            endPos: this.outline.cursorAt(step.to, "left"),
          };
        }

        // Update this.outline to reflect the local changes.
        const toDelete = [...this.outline.positions(step.from, step.to)];
        for (const pos of toDelete) this.outline.delete(pos);
        undoOutlineChanges.push(() => {
          for (const pos of toDelete) this.outline.add(pos);
        });

        if (annStep.insert) {
          const startPos = annStep.insert.startPos;
          const count = step.slice.size;
          this.outline.add(startPos, count);
          undoOutlineChanges.push(() => this.outline.delete(startPos, count));
        }

        annSteps.push(annStep);
      } else if (step instanceof ReplaceAroundStep) {
        const sliceAfterInsert = step.slice.size - step.insert;
        const annStep: AnnotatedStep = {
          type: "replaceAround",
          sliceJSON: step.slice.toJSON(),
          sliceInsert: step.insert,
          sliceAfterInsert,
          // @ts-expect-error structure marked internal
          structure: step.structure,
        };

        if (step.insert > 0) {
          // There is content to insert on the left side of the gap.
          let insertionIndex: number;
          if (step.gapFrom === step.from) {
            // No deletion, just insert before the gap.
            insertionIndex = step.from;
          } else if (step.gapFrom - step.from >= 2) {
            // Insert in the middle of the deleted positions, so that the resolved
            // [from, gapFrom) range always contains the insertion position.
            insertionIndex = step.from + 1;
          } else {
            // Insert before the deleted position. That way, if we have
            // to stretch the resolved [from, gapFrom) range to include the insertion position
            // (so that the resolved ReplaceAroundStep is well-formed),
            // then the range expands away from the gap, which is probably more important (e.g. a paragraph's contents).
            insertionIndex = step.from;
          }

          // Use insertAt-then-delete to create the positions without actually changing this.outline yet.
          const [startPos, meta] = this.outline.insertAt(
            insertionIndex,
            step.insert
          );
          this.outline.delete(startPos, step.insert);

          annStep.insertLeft = { meta, startPos };
        }

        if (sliceAfterInsert > 0) {
          // There is content to insert on the right side of the gap.
          let insertionIndex: number;
          if (step.to === step.gapTo) {
            // No deletion, just insert after the gap.
            insertionIndex = step.to;
          } else if (step.to - step.gapTo >= 2) {
            // Insert in the middle of the deleted positions, so that the resolved
            // [gapTo, to) range always contains the insertion position.
            insertionIndex = step.to - 1;
          } else {
            // Insert after the deleted position. That way, if we have
            // to stretch the resolved [gapTo, to) range to include the insertion position
            // (so that the resolved ReplaceAroundStep is well-formed),
            // then the range expands away from the gap, which is probably more important (e.g. a paragraph's contents).
            insertionIndex = step.to;
          }

          // Use insertAt-then-delete to create the positions without actually changing this.outline yet.
          const [startPos, meta] = this.outline.insertAt(
            insertionIndex,
            sliceAfterInsert
          );
          this.outline.delete(startPos, sliceAfterInsert);

          annStep.insertRight = { meta, startPos };
        }

        if (step.gapFrom > step.from) {
          // There is deleted content before the gap.
          annStep.deleteLeft = {
            startPos: this.outline.cursorAt(step.from, "right"),
            endPos: this.outline.cursorAt(step.gapFrom, "left"),
          };
        }

        if (step.to > step.gapTo) {
          // There is deleted content after the gap.
          annStep.deleteRight = {
            startPos: this.outline.cursorAt(step.gapTo, "right"),
            endPos: this.outline.cursorAt(step.to, "left"),
          };
        }

        // Update this.outline to reflect the local changes.
        const toDelete = [
          ...this.outline.positions(step.from, step.gapFrom),
          ...this.outline.positions(step.gapTo, step.to),
        ];
        for (const pos of toDelete) this.outline.delete(pos);
        undoOutlineChanges.push(() => {
          for (const pos of toDelete) this.outline.add(pos);
        });

        if (annStep.insertRight) {
          const startPos = annStep.insertRight.startPos;
          const count = step.slice.size - step.insert;
          this.outline.add(startPos, count);
          undoOutlineChanges.push(() => this.outline.delete(startPos, count));
        }
        if (annStep.insertLeft) {
          const startPos = annStep.insertLeft.startPos;
          const count = step.insert;
          this.outline.add(startPos, count);
          undoOutlineChanges.push(() => this.outline.delete(startPos, count));
        }

        if (
          !(
            (annStep.insertLeft || annStep.deleteLeft) &&
            (annStep.insertRight || annStep.deleteRight)
          )
        ) {
          // Without an insert or delete command, we won't know what to use as from/to.
          // We could add a separate field to handle that case, but I'm not sure it ever happens.
          console.warn(
            "Unsupported step type, skipping: ReplaceAroundStep with no insert or delete on one side",
            step.toJSON()
          );
          continue;
        }

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
        console.error("(Receive) Lengths no longer match after", step);
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
      // TODO: Handle the case where the server deliberately skipped one of our messages.
      // Needs to ack this fact.
    }

    for (let p = 0; p < this.pendingMutations.length; p++) {
      // Apply the CRDT-ified version of the pending mutation, since it's being
      // rebased on top of a different state from where it was originally applied.
      this.pendingMutations[p].undo = this.applyMutation(
        this.pendingMutations[p].mutation,
        tr
      );
    }

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
          if (annStep.insert?.meta) {
            this.outline.order.addMetas([annStep.insert.meta]);
          }

          let from: number;
          let to: number;
          if (annStep.delete) {
            // The original deleted range was nonempty, so even if already deleted,
            // it is never the case that startIndex > endIndex.
            from = this.outline.indexOfCursor(annStep.delete.startPos, "right");
            to = this.outline.indexOfCursor(annStep.delete.endPos, "left");
            if (annStep.insert) {
              // Ensure from <= insertionIndex <= to, stretching the deleted the range if needed.
              // Otherwise, our changes to this.outline won't match ProseMirror's changes.
              const insertionIndex = this.outline.indexOfPosition(
                annStep.insert.startPos,
                "right"
              );
              from = Math.min(from, insertionIndex);
              to = Math.max(to, insertionIndex);
            }
          } else {
            // Use insertion index, i.e., the index where startPos will be once present.
            from = this.outline.indexOfPosition(
              annStep.insert!.startPos,
              "right"
            );
            to = from;
          }

          const slice = Slice.fromJSON(schema, annStep.sliceJSON);
          const step = new ReplaceStep(from, to, slice, annStep.structure);
          const success = maybeStep(tr, step, annStep);
          if (success) {
            // Update Outline to match.
            const toDelete = [...this.outline.positions(from, to)];
            for (const pos of toDelete) this.outline.delete(pos);
            if (annStep.insert) {
              this.outline.add(annStep.insert.startPos, slice.size);
            }

            // Record undo command.
            undoSteps.push(step.invert(tr.docs.at(-1)!));
            const sliceSize = slice.size;
            undoOutlineChanges.push(() => {
              for (const pos of toDelete) this.outline.add(pos);
              if (annStep.insert) {
                this.outline.delete(annStep.insert.startPos, sliceSize);
              }
            });
          }
          break;
        }
        case "replaceAround": {
          if (annStep.insertLeft?.meta) {
            this.outline.order.addMetas([annStep.insertLeft.meta]);
          }
          if (annStep.insertRight?.meta) {
            this.outline.order.addMetas([annStep.insertRight.meta]);
          }

          let from: number;
          let gapFrom: number;
          if (annStep.deleteLeft) {
            // The original deleted range was nonempty, so even if already deleted,
            // it is never the case that startIndex > endIndex.
            from = this.outline.indexOfCursor(
              annStep.deleteLeft.startPos,
              "right"
            );
            gapFrom = this.outline.indexOfCursor(
              annStep.deleteLeft.endPos,
              "left"
            );
            if (annStep.insertLeft) {
              // Ensure from <= insertionIndex <= gapFrom, stretching the deleted the range if needed.
              // Otherwise, our changes to this.outline won't match ProseMirror's changes.
              const insertionIndex = this.outline.indexOfPosition(
                annStep.insertLeft.startPos,
                "right"
              );
              from = Math.min(from, insertionIndex);
              gapFrom = Math.max(gapFrom, insertionIndex);
            }
          } else {
            // Use insertion index, i.e., the index where startPos will be once present.
            from = this.outline.indexOfPosition(
              annStep.insertLeft!.startPos,
              "right"
            );
            gapFrom = from;
          }

          let gapTo: number;
          let to: number;
          if (annStep.deleteRight) {
            gapTo = this.outline.indexOfCursor(
              annStep.deleteRight.startPos,
              "right"
            );
            to = this.outline.indexOfCursor(annStep.deleteRight.endPos, "left");
            if (annStep.insertRight) {
              // Ensure gapTo <= insertionIndex <= to, stretching the deleted the range if needed.
              // Otherwise, our changes to this.outline won't match ProseMirror's changes.
              const insertionIndex = this.outline.indexOfPosition(
                annStep.insertRight.startPos,
                "right"
              );
              gapTo = Math.min(gapTo, insertionIndex);
              to = Math.max(to, insertionIndex);
            }
          } else {
            // Use insertion index, i.e., the index where startPos will be once present.
            gapTo = this.outline.indexOfPosition(
              annStep.insertRight!.startPos,
              "right"
            );
            to = gapTo;
          }

          const step = new ReplaceAroundStep(
            from,
            to,
            gapFrom,
            gapTo,
            Slice.fromJSON(schema, annStep.sliceJSON),
            annStep.sliceInsert,
            annStep.structure
          );
          const success = maybeStep(tr, step, annStep);
          if (success) {
            // Update Outline to match.
            const toDelete = [
              ...this.outline.positions(from, gapFrom),
              ...this.outline.positions(gapTo, to),
            ];
            for (const pos of toDelete) this.outline.delete(pos);
            if (annStep.insertLeft) {
              this.outline.add(
                annStep.insertLeft.startPos,
                annStep.sliceInsert
              );
            }
            if (annStep.insertRight) {
              this.outline.add(
                annStep.insertRight.startPos,
                annStep.sliceAfterInsert
              );
            }

            // Record undo command.
            undoSteps.push(step.invert(tr.docs.at(-1)!));
            undoOutlineChanges.push(() => {
              for (const pos of toDelete) this.outline.add(pos);
              if (annStep.insertLeft) {
                this.outline.delete(
                  annStep.insertLeft.startPos,
                  annStep.sliceInsert
                );
              }
              if (annStep.insertRight) {
                this.outline.delete(
                  annStep.insertRight.startPos,
                  annStep.sliceAfterInsert
                );
              }
            });
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
        console.error("(Receive) Lengths no longer match after", annStep);
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
    // - Start with 3 paras.
    // - Alice converts first two into an ordered list.
    // - While offline, Bob converts last two into an ordered list.
    // - Bob's change rebased: ReplaceAroundStep applying the <ol></ol> fails
    // as expected. But then this ReplaceStep applying the <li></li>'s fails with
    // an error (invalid content for list-node: <>), which I think is because
    // the 3rd <li> is no longer inside an <ol>, hence gets upset.
    console.log(`${annStep.type} errored:`, `${err}`, step, annStep);
    return false;
  }
}
