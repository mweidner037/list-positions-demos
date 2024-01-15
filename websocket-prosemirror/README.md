# WebSocket-Prosemirror

A basic collaborative rich-text editor using [list-positions](https://github.com/mweidner037/list-positions#readme) and [list-formatting](https://github.com/mweidner037/list-formatting#readme), a WebSocket server, and [ProseMirror](https://prosemirror.net/).

When a client makes a change, a description is sent to the server in JSON format. The server echoes that change to all other connected clients. The server also updates its own copy of the rich-text state; this is sent to new clients when they load the page.

A client optimistically updates its own state before sending its change to the server. The demo is simple enough that these optimistic updates are always "correct" (match the server's eventual state) - see the comments in [`src/server/rich_text_server.ts`](./src/server/rich_text_server.ts). A more complicated app might need to "repair" optimistic updates that are rejected or modified by the server, e.g., due to permissions issues.

The collaborative state is linear, not a tree like ProseMirror's own state; it is stored as Lists in [`ProsemirrorWrapper`](./src/site/prosemirror_wrapper.ts). The collaborative state uses special "block markers" to indicate the start of each block and its type (paragraph, h1, h2, ul, ol). In particular, bullets and numbering are stored as a series of unordered or ordered list blocks, with no explicit list start/end; at render time, we fill in numbers and render the numbers/bullets using a CSS ::before element on a normal paragraph.

The ProseMirror wrapper uses its copy of the collaborative state as the source-of-truth for ProseMirror. Whenever that state changes, `ProsemirrorWrapper.sync()` recomputes the ProseMirror state and sends it to ProseMirror. When ProseMirror generates a transaction due to a local change (e.g. typing), `ProsemirrorWrapper.onLocalTr` converts that transaction into changes to the collaborative state, then updates the server and calls `ProsemirrorWrapper.sync()`. Calling `sync()` is technically redundant, but it ensures that the two states don't diverge, and it makes the data flow consistent between local vs remote changes.

_References: unpublished notes by Martin Kleppmann (2022); [Notion's data model](https://www.notion.so/blog/data-model-behind-notion); [y-prosemirror](https://github.com/yjs/y-prosemirror)_

Code organization:

- `src/common/`: Messages shared between clients and the server.
- `src/server/`: WebSocket server.
- `src/site/`: ProseMirror client.

## Installation

First, install [Node.js](https://nodejs.org/). Then run `npm i`.

## Commands

### `npm run dev`

Build the app from `src/`, in [development mode](https://webpack.js.org/guides/development/).

### `npm run build`

Build the app from `src/`, in [production mode](https://webpack.js.org/guides/production/).

### `npm start`

Run the server on [http://localhost:3000/](http://localhost:3000/). Use multiple browser windows at once to test collaboration.

To change the port, set the `$PORT` environment variable.

### `npm run clean`

Delete `dist/`.
