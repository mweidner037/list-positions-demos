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
import { ReplaceStep } from "prosemirror-transform";

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
    // TODO: skip locally applying any steps we don't understand.
    // TODO: use a last-in-order plugin so we can see what effects plugins have?
    this.view.updateState(this.view.state.apply(tr));
    const annSteps: AnnotatedStep[] = [];
    for (let i = 0; i < tr.steps.length; i++) {
      const step = tr.steps[i];
      if (step instanceof ReplaceStep) {
        // Using replace semantics for normal insertions seems odd.
        // Instead, break it into a separate delete and insert.
        if (step.from !== step.to) {
          annSteps.push({
            type: "replaceDelete",
            fromPos: this.outline.positionAt(step.from),
            // step.to is exclusive, toPos is inclusive.
            // TODO: omit if same as fromPos (opt).
            toInclPos: this.outline.positionAt(step.to - 1),
            openStart: step.slice.openStart,
            openEnd: step.slice.openEnd,
          });
          this.outline.deleteAt(step.from, step.to - step.from);
        }
        if (step.slice.size !== 0) {
          const [startPos, meta] = this.outline.insertAt(
            step.from,
            step.slice.size
          );
          annSteps.push({
            type: "replaceInsert",
            meta,
            startPos,
            sliceJSON: step.slice.toJSON(),
          });
        }
      } else {
        console.warn(
          "Unsupported step type, skipping:",
          step.constructor.name,
          step
        );
      }
    }

    this.onLocalMutation({
      clientID: this.clientID,
      clientCounter: this.clientCounter++,
      annSteps,
    });
  }

  receive(mutations: Mutation[]): void {
    const tr = this.view.state.tr;

    for (const mutation of mutations) {
      for (const annStep of mutation.annSteps) {
        switch (annStep.type) {
          case "replaceInsert": {
            if (annStep.meta) {
              this.outline.order.addMetas([annStep.meta]);
            }

            // "right" gives the index where the Position would be if present, i.e.,
            // the insertion index.
            const from = this.outline.indexOfPosition(
              annStep.startPos,
              "right"
            );
            const slice = Slice.fromJSON(schema, annStep.sliceJSON);
            const step = new ReplaceStep(from, from, slice);
            const stepResult = tr.maybeStep(step);
            if (!stepResult.failed) {
              // Update Outline to match.
              // TODO: Should we instead cheat by just comparing the before & after doc sizes?
              // Needs to be <= the slice's size.
              // If not, log and undo?
              this.outline.add(annStep.startPos, slice.size);
            } else {
              console.log(
                "replaceDelete failed",
                stepResult.failed,
                step,
                annStep
              );
            }
            break;
          }
          case "replaceDelete": {
            // Bias inwards (less deleted).
            const from = this.outline.indexOfPosition(annStep.fromPos, "right");
            const toIncl = this.outline.indexOfPosition(
              annStep.toInclPos,
              "left"
            );
            if (from <= toIncl) {
              const step = new ReplaceStep(
                from,
                toIncl + 1,
                new Slice(Fragment.empty, annStep.openStart, annStep.openEnd)
              );
              const stepResult = tr.maybeStep(step);
              if (!stepResult.failed) {
                // Update Outline to match.
                this.outline.deleteAt(from, toIncl - from + 1);
              } else {
                console.log(
                  "replaceDelete failed",
                  stepResult.failed,
                  step,
                  annStep
                );
              }
            }
            break;
          }
          default:
            const neverAnnStep: never = annStep;
            console.log("Unknown AnnotatedStep type:", neverAnnStep);
        }

        // Sanity checking.
        if (this.outline.length !== tr.doc.nodeSize) {
          console.error("Lengths no longer match after", annStep);
          console.error("Resulting doc:", tr.doc);
          return;
        }
      }
    }

    this.view.updateState(this.view.state.apply(tr));
  }
}
