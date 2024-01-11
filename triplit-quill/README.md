# Triplit-Quill

Basic collaborative rich-text editor that synchronizes using the [Triplit](https://www.triplit.dev/) fullstack database. The editor is [Quill](https://quilljs.com/).

The editor state is stored in a Triplit database with three tables:

- `bunches` for the BunchMeta.
- `values` for the values (characters). For simplicity, each character gets its own row. (It's probably possible to instead store one row per bunch instead, using an `S.Set` to track which chars are present/deleted.)
- `marks` for the formatting marks.

See `triplit/schema.ts`.

Local updates are synced to the local database. When any table changes, a [subscription](https://www.triplit.dev/docs/fetching-data/subscriptions) in `src/main.ts` updates the Quill state. Since subscriptions are not incremental (they always return the whole state), we diff against the previous state to figure out what changed.

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

Previews the app built to `dist/`.
