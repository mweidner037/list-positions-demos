# Suggested Changes

Extension of [websocket-prosemirror-blocks](../websocket-prosemirror-blocks/) that adds "Suggested Changes".

Select some text and click "Suggest change" to create a suggestion on the right side. Edit it and accept/reject.

Internally, each suggestion (class [`Suggestion`](./src/site/suggestion.ts)) first copies the selected portion of the main text into a new `ProseMirrorWrapper`. Edits to the suggestion are tracked as `Message`s, then committed to the main text if accepted - as if performed by a collaborator. Suggestions also update live to reflect their merge with the main text, via `src/site/main.ts`'s `onLocalChange` function.

Code organization:

- `src/common/`: Messages shared between clients and the server.
- `src/server/`: WebSocket server.
- `src/site/`: ProseMirror client.
  - `src/site/suggestion.ts`: Class managing the GUI and state for an individual suggestion.

## Future Plans

<!-- TODO -->

- [ ] Make suggestions collaborative.
- [ ] Show where suggestions are with a highlight in the main text. Increase highlight on the focused suggestion.
- [ ] Formatting in suggestions - currently only keyboard shortcuts (Ctrl+I/B) are supported.
- [ ] Testing/cleanup.

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
