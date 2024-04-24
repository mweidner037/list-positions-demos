import { AnnotatedStep, Mutation } from "../common/messages";
import { EditorState, Plugin, Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Fragment, Schema, Slice } from "prosemirror-model";
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
import { ReplaceAroundStep, ReplaceStep, Step } from "prosemirror-transform";

import "prosemirror-menu/style/menu.css";
import "prosemirror-view/style/prosemirror.css";
import "prosemirror-example-setup/style/style.css";
import { MAX_POSITION, MIN_POSITION, Outline } from "list-positions";

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

    const annSteps: AnnotatedStep[] = [];
    const undoSteps: Step[] = [];
    const undoOutlineChanges: (() => void)[] = [];
    for (let i = 0; i < tr.steps.length; i++) {
      const step = tr.steps[i];
      undoSteps.push(step.invert(tr.docs[i]));

      if (step instanceof ReplaceStep) {
        if (step.from !== step.to) {
          annSteps.push({
            type: "delete",
            fromPos: this.outline.cursorAt(step.from, "right"),
            toPos: this.outline.cursorAt(step.to, "left"),
            openStart: step.slice.openStart,
            openEnd: step.slice.openEnd,
            // @ts-expect-error structure marked internal
            structure: step.structure,
          });
          const toDelete = [...this.outline.positions(step.from, step.to)];
          for (const pos of toDelete) this.outline.delete(pos);
          undoOutlineChanges.push(() => {
            for (const pos of toDelete) this.outline.add(pos);
          });
        }
        if (step.slice.size !== 0) {
          const [startPos, meta] = this.outline.insertAt(
            step.from,
            step.slice.size
          );
          annSteps.push({
            type: "insert",
            meta,
            startPos,
            sliceJSON: step.slice.toJSON(),
          });
          const count = step.slice.size;
          undoOutlineChanges.push(() => this.outline.delete(startPos, count));
        }
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
          ...this.outline.positions(step.gapTo, step.to),
          ...this.outline.positions(step.gapFrom, step.from),
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
          console.error(
            "Unsupported step type, skipping: ReplaceAroundStep with no insert or delete on one side",
            step.toJSON()
          );
          continue;
        }

        annSteps.push(annStep);
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

    // If the first mutations are confirming our first pending local mutations,
    // just mark them as not-pending.
    let i = 0;
    for (; i < mutations.length; i++) {
      if (this.pendingMutations.length === 0) break;

      const firstPending = this.pendingMutations[0].mutation;
      if (
        mutations[i].clientID === firstPending.clientID &&
        mutations[i].clientCounter === firstPending.clientCounter
      ) {
        this.pendingMutations.shift();
      }
    }

    if (i === mutations.length) return;

    // For remaining mutations, we need to undo pending - do mutations - redo pending.
    for (let j = this.pendingMutations.length - 1; j >= 0; j--) {
      this.pendingMutations[j].undo(tr);
    }

    for (; i < mutations.length; i++) {
      this.applyMutation(mutations[i], tr);
    }

    for (let j = 0; j < this.pendingMutations.length; j++) {
      // Apply the CRDT-ified version of the pending mutation, since it's being
      // rebased on top of a different state from where it was originally applied.
      this.pendingMutations[j].undo = this.applyMutation(
        this.pendingMutations[j].mutation,
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
    const undoSteps: Step[] = [];
    const undoOutlineChanges: (() => void)[] = [];

    let firstFailure = true;
    for (const annStep of mutation.annSteps) {
      switch (annStep.type) {
        case "insert": {
          if (annStep.meta) {
            this.outline.order.addMetas([annStep.meta]);
          }

          // "right" gives the index where the Position would be if present, i.e.,
          // the insertion index.
          const from = this.outline.indexOfPosition(annStep.startPos, "right");
          const slice = Slice.fromJSON(schema, annStep.sliceJSON);
          const step = new ReplaceStep(from, from, slice);
          const stepResult = tr.maybeStep(step);
          if (!stepResult.failed) {
            // Update outline to match.
            const count = slice.size;
            this.outline.add(annStep.startPos, count);

            // Record undo command.
            undoSteps.push(step.invert(tr.docs.at(-1)!));
            undoOutlineChanges.push(() =>
              this.outline.delete(annStep.startPos, count)
            );
          } else {
            console.log("insert failed:", stepResult.failed, step, annStep);
          }
          break;
        }
        case "delete": {
          const from = this.outline.indexOfCursor(annStep.fromPos, "right");
          const to = this.outline.indexOfCursor(annStep.toPos, "left");
          if (from < to) {
            const step = new ReplaceStep(
              from,
              to,
              new Slice(Fragment.empty, annStep.openStart, annStep.openEnd),
              annStep.structure
            );
            const stepResult = tr.maybeStep(step);
            if (!stepResult.failed) {
              // Update outline to match.
              const toDelete = [...this.outline.positions(from, to)];
              for (const pos of toDelete) this.outline.delete(pos);

              // Record undo command.
              undoSteps.push(step.invert(tr.docs.at(-1)!));
              undoOutlineChanges.push(() => {
                for (const pos of toDelete) this.outline.add(pos);
              });
            } else {
              console.log("delete failed:", stepResult.failed, step, annStep);
            }
          }
          break;
        }
        case "replaceAround": {
          if (annStep.insertLeft?.meta) {
            this.outline.order.addMetas([annStep.insertLeft?.meta]);
          }
          if (annStep.insertRight?.meta) {
            this.outline.order.addMetas([annStep.insertRight?.meta]);
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
              // Ensure from <= insertionIndex, stretching the deleted the range if needed.
              // Otherwise, our changes to this.outline won't match ProseMirror's changes.
              const insertionIndex = this.outline.indexOfPosition(
                annStep.insertLeft.startPos,
                "right"
              );
              from = Math.min(from, insertionIndex);
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
              // Ensure insertionIndex <= to, stretching the deleted the range if needed.
              // Otherwise, our changes to this.outline won't match ProseMirror's changes.
              const insertionIndex = this.outline.indexOfPosition(
                annStep.insertRight!.startPos,
                "right"
              );
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
          const stepResult = tr.maybeStep(step);
          if (!stepResult.failed) {
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
          } else {
            console.log(
              "replaceAround failed:",
              stepResult.failed,
              step,
              annStep
            );
          }
          break;
        }
        default:
          const neverAnnStep: never = annStep;
          console.log("Unknown AnnotatedStep type:", neverAnnStep);
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
