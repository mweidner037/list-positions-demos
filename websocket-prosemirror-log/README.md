# WebSocket-Prosemirror-Log

A basic collaborative rich-text editor using [list-positions](https://github.com/mweidner037/list-positions#readme), a WebSocket server, and [ProseMirror](https://prosemirror.net/). It supports arbitrary schemas and works similarly to ProseMirror's built-in collaboration system, using a server-authoritative log of changes.

When a client makes a change, a _mutation_ describing that change is sent to the server in JSON format. The server assigns that mutation a sequence number in the log and echoes it to all connected clients. It also stores the log to send to future clients. (In principle, the server could instead store the literal ProseMirror & list-positions states.)

A client's state is always given by:

- First, apply all mutations received from (or confirmed by) the server, in the same order as the server's log.
- Next, apply all pending local mutations, which have been performed by the local user but not yet confirmed by the server.

To process a remote message from the server, the pending local mutations are undone, the remote message is applied, and then the pending local mutations are redone. If a mutation no longer makes sense in its current state, it is skipped.

Internally, each mutation consists of ordinary ProseMirror [steps](https://prosemirror.net/docs/guide/#transform), but with their list indices (ProseMirror positions) replaced by Positions from list-positions. That way, it is always possible to "rebase" a step on top of the server's latest state: just look up the new indices corresponding to each steps' Positions. (Internally, the lookup uses an [Outline](https://github.com/mweidner037/list-positions#outline).)

Overall, this strategy is the same as [ProseMirror's built-in collaboration system](https://prosemirror.net/docs/guide/#collab), but using immutable Positions (CRDT-style) instead of indices that are transformed during rebasing (OT-style). As a result, clients never need to rebase and resubmit steps: steps can be rebased "as-is".

Using ProseMirror's built-in steps lets many ProseMirror features work out-of-the-box, just like with ProseMirror's built-in collaboration. In contrast, [y-prosemirror](https://github.com/yjs/y-prosemirror) and [websocket-prosemirror-blocks](../websocket-prosemirror-blocks#readme) rewrite the ProseMirror state directly, which breaks the default cursor tracking, undo/redo, and [some other features](https://discuss.yjs.dev/t/decorationsets-and-remapping-broken-with-y-sync-plugin/845).

_References: [Collaborative Editing in ProseMirror](https://marijnhaverbeke.nl/blog/collaborative-editing.html); [Replicache's sync strategy](https://rocicorp.dev/blog/ready-player-two)_

Code organization:

- `src/common/`: Messages shared between clients and the server.
- `src/server/`: WebSocket server.
- `src/site/`: ProseMirror client.

## Installation

First, install [Node.js](https://nodejs.org/). Then run `npm i`.

## Commands

### `npm run dev`

Build the app from `src/`, in [development mode](https://webpack.js.org/guides/development/). You can also use `npm run watch`.

### `npm run build`

Build the app from `src/`, in [production mode](https://webpack.js.org/guides/production/).

### `npm start`

Run the server on [http://localhost:3000/](http://localhost:3000/). Use multiple browser windows at once to test collaboration.

To change the port, set the `$PORT` environment variable.

### `npm run clean`

Delete `dist/`.
