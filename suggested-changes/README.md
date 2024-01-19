# Suggested Changes

Extension of [websocket-prosemirror](../websocket-prosemirror/) that adds "Suggested Changes".

TODO

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
