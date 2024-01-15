# Triplit-Quill

Basic collaborative rich-text editor using [list-positions](https://github.com/mweidner037/list-positions#readme) and [list-formatting](https://github.com/mweidner037/list-formatting#readme), the [Triplit](https://www.triplit.dev/) fullstack database, and [Quill](https://quilljs.com/).

The editor state is stored in a Triplit database with three tables:

- `bunches` for list-positions's [BunchMeta](https://github.com/mweidner037/list-positions#managing-metadata).
- `values` for the values (characters). For simplicity, each character gets its own row. (It's probably possible to instead store one row per bunch instead, using an `S.Set` to track which chars are present/deleted.)
- `marks` for the formatting marks.

See `triplit/schema.ts`.

Local updates are synced to the local database. When any table changes, a [subscription](https://www.triplit.dev/docs/fetching-data/subscriptions) in `src/main.ts` updates the Quill state. Since subscriptions are not incremental (they always return the whole state), we diff against the previous state to figure out what changed.

> Note: Rapidly inserting/deleting characters (by holding down a keyboard key) currently causes some weird behaviors.

## Setup

1. Install with `npm i`.
2. (Optional) To sync to the Triplit cloud, create a `.env` file with the content given in your Triplit project's dashboard (Vite version). Note that `.env` is gitignored.

## Commands

These are unchanged from the `npm create triplit-app` setup (vanilla version).

### `npm run dev`

Start a Vite development server with auto-reloading.

### `npm run build`

Build the app to `dist/`.

### `npm run preview`

Preview the app built to `dist/`.
