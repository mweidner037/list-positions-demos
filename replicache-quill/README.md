# Replicache-Quill

Basic collaborative rich-text editor using [list-positions](https://github.com/mweidner037/list-positions#readme) and [list-formatting](https://github.com/mweidner037/list-formatting#readme), the [Replicache](https://replicache.dev/) client-side sync framework, and [Quill](https://quilljs.com/).

The editor state is stored in Replicache under two prefixes:

- `bunch/<bunchID>` for the `List` state, grouped by bunch. Each entry stores a bunch's [BunchMeta](https://github.com/mweidner037/list-positions#managing-metadata) fields, plus its current values (chars) as an object `{ [innerIndex: number]: string }`.
- `mark/<mark ID>` for the formatting marks. Each entry stores a TimestampMark, keyed by an arbitrary unique ID.

Replicache mutators correspond to the basic rich-text operations:

- `createBunch` to create a new bunch with its BunchMeta.
- `setValues` to set some Position-value pairs within a bunch.
- `deleteValues` to delete some Position-value pairs within a bunch.
- `addMarks` to add a formatting mark.

See `shared/src/rich_text.ts` and `shared/src/mutators.ts`.

The instructions below are from Replicache's [todo-wc](https://github.com/rocicorp/todo-wc) example, which we used as a template.

## 1. Setup

#### Get your Replicache License Key

```bash
$ npx replicache get-license
```

#### Set your `VITE_REPLICACHE_LICENSE_KEY` environment variable

```bash
$ export VITE_REPLICACHE_LICENSE_KEY="<your license key>"
```

(Or put it in `client/.env`, which is gitignored.)

#### Install and Build

```bash
$ npm install; npm run build;
```

## 2.Start frontend and backend watcher

```bash
$ npm run watch --ws
```

Provides an example integrating replicache with react in a simple todo application.

## Deploying to Render

A render blueprint example is provided to deploy the application.

Open the `render.yaml` file and add your license key

```
- key: VITE_REPLICACHE_LICENSE_KEY
    value: <license_key>
```

Commit the changes and follow the direction on [Deploying to Render](https://doc.replicache.dev/deploy-render)
/client
/shared
/server
package.json
