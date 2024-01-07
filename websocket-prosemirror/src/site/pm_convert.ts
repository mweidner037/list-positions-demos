// import { Node, Schema } from "prosemirror-model";
// import { ReplaceStep, Transform } from "prosemirror-transform";

// export const schema = new Schema({
//   nodes: {
//     doc: { content: "paragraph+" },
//     paragraph: { content: "text*" },
//     text: {},
//   },
// });

// export type Action =
// | {
//     type: "set";
//     pos: Position;
//     value: string | Marker;
//   }
// | { type: "delete"; pos: Position };

// applyActions(actions: Action[], doc: Node): Transform {
//   const tr = new Transform(doc);
//   for (const action of actions) {
//     switch (action.type) {
//       case "set":
//         if (typeof action.value === "string") {
//           const pmPos = this.toPmPos(action.pos);
//           const content = schema.text(action.value);
//           if (this.list.has(action.pos)) {
//             tr.replaceWith(pmPos, pmPos + 1, content);
//           } else tr.insert(pmPos, content);
//         } else {
//           if (this.list.has(action.pos)) {
//             // TODO. For now, do nothing (assume redundant).
//           } else {
//             // Create a new block.
//             // TODO: what if pm pos is exactly on a block making the prev block empty?)
//             tr.split(this.toPmPos(action.pos), 1, [
//               {
//                 type: schema.nodes[action.value.type],
//                 attrs: action.value.attrs,
//               },
//             ]);
//             this.markers.set(action.pos, action.value);
//           }
//         }
//         this.list.set(action.pos, action.value);
//         break;
//       case "delete":
//         if (this.list.has(action.pos)) {
//           const value = this.list.get(action.pos);
//           if (typeof value === "string") {
//             // Char.
//             const pmPos = this.toPmPos(action.pos);
//             tr.delete(pmPos, pmPos + 1);
//           } else {
//             // TODO: combine block with previous.

//             this.markers.delete(action.pos);
//           }
//           this.list.delete(action.pos);
//         }
//         break;
//     }
//   }
//   return tr;
// }

// applyTransform(tr: Transform): Action[] {
//   const actions: Action[] = [];
//   for (const step of tr.steps) {
//     if (step instanceof ReplaceStep) {
//       const fromIndex = this.toIndex(step.from);
//       // Deletion
//       if (step.from < step.to) {
//         const toDelete = this.list.positions(
//           fromIndex,
//           this.toIndex(step.to)
//         );
//         for (const pos of toDelete) {
//           actions.push({ type: "delete", pos });
//           this.list.delete(pos);
//           this.markers.delete(pos);
//         }
//       }
//       // Insertion
//       let insIndex = fromIndex;
//       for (let i = 0; i < step.slice.content.childCount; i++) {
//         const child = step.slice.content.child(i);
//         switch (child.type.name) {
//           case "text":
//             const [startPos] = this.list.insertAt(insIndex, ...child.text!);
//             let j = 0;
//             for (const pos of Order.startPosToArray(
//               startPos,
//               child.text!.length
//             )) {
//               actions.push({ type: "set", pos, value: child.text![j] });
//               j++;
//             }
//             insIndex += child.text!.length;
//             break;
//           case "paragraph":
//             const marker: Marker = { type: "paragraph", attrs: {} };
//             const [pos] = this.list.insertAt(insIndex, marker);
//             actions.push({ type: "set", pos, value: marker });
//             insIndex++;
//             break;
//           default:
//             console.error("Unknown child type", child);
//         }
//       }
//     } else {
//       console.error("Unsupported step", step);
//     }
//   }
//   return actions;
// }

// /**
//  * For inline content, the position of the value
//  * (or where it will be once inserted).
//  * For a block marker, the position of the block node's start.
//  *
//  * For cursors: -1, convert, then +1 (left binding).
//  */
// private toPmPos(pos: Position): number {
//   let offset = -1;
//   for (let i = 0; i < this.markers.indexOfPosition(pos, "right"); i++) {
//     const marker = this.markers.getAt(i);
//     offset += 2;
//   }
//   if (this.markers.has(pos)) offset++;
//   return this.list.indexOfPosition(pos, "right") + offset;
// }

// /**
//  * For inline content, the index of the value.
//  * For a position at the start of a block, the block's marker.
//  * For a position at the end of a block, errors.
//  *
//  * For cursors: -1, convert, then +1 (left binding).
//  */
// private toIndex(pmPos: number): number {
//   // TODO
// }

// toProseMirror(): Node {
//   const blocks: Node[] = [];

//   let currentBlock: Marker = this.list.getAt(0) as Marker;
//   let blockStart = 1;
//   let i = 1;

//   const endBlock = () => {
//     const text = (this.list.slice(blockStart, i) as string[]).join("");
//     blocks.push(schema.node("paragraph", null, [schema.text(text)]));
//   };

//   for (const value of this.list.values(1)) {
//     // TODO: avoid this loop by looping over markers instead
//     if (typeof value !== "string") {
//       // Marker -> new block start.
//       endBlock();
//       // Start next block.
//       currentBlock = value;
//       blockStart = i;
//     }
//     i++;
//   }
//   // End final block.
//   endBlock();

//   return schema.node("doc", null, blocks);
// }
