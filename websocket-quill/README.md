# WebSocket-Quill

A basic collaborative rich-text editor using a WebSocket server and [Quill](https://quilljs.com/).

When a client makes a change, a description is sent to the server in JSON format. The server echoes that change to all other connected clients. The server also updates its own copy of the rich-text state; this is sent to new clients when they load the page.

A client optimistically updates its own state before sending its change to the server. The demo is simple enough that these optimistic updates are always "correct" (match the server's eventual state) - see the comments in [`src/server/rich_text_server.ts`](./src/server/rich_text_server.ts). A more complicated app might need to "repair" optimistic updates that are rejected or modified by the server, e.g., due to permissions issues.

Code organization:

- `src/common/messages.ts`: Messages sent between clients and the server.
- `src/server/`: WebSocket server.
- `src/site/`: Quill client.

## Setup

Install with `npm i`.

## Commands

### `npm run dev`

Build the site in [development mode](https://webpack.js.org/guides/development/).

### `npm run build`

Build the site in [production mode](https://webpack.js.org/guides/production/).

### `npm start`

Run the server on [http://localhost:3000/](http://localhost:3000/). Use multiple browser windows at once to test collaboration.

To change the port, set the `$PORT` environment variable.

### `npm run clean`

Delete `dist/`.
