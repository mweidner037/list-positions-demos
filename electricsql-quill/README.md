# ElectricSQL-Quill

Basic collaborative rich-text editor using [list-positions](https://github.com/mweidner037/list-positions#readme) and [@list-positions/formatting](https://github.com/mweidner037/list-positions-formatting#readme), the [ElectricSQL](https://electric-sql.com/) database sync service, and [Quill](https://quilljs.com/).

This is a web application using ElectricSQL in the browser with [wa-sqlite](https://electric-sql.com/docs/integrations/drivers/web/wa-sqlite).
The editor state is stored in a SQL database with three tables:

- `bunches` for list-positions's [BunchMeta](https://github.com/mweidner037/list-positions#managing-metadata).
- `char_entries` for the characters. Each character gets its own row.
- `formatting_marks` for the formatting marks.

See the schema in [`db/migrations/01-create_docs.ts`](./db/migrations/01-create_docs.sql).

Local updates are synced to the local database. When any table changes, a [live query](https://electric-sql.com/docs/usage/data-access/queries#live-queries) in `src/quill/ElectricQuill.tsx` updates the Quill state. Since subscriptions are not incremental (they always return the whole state), we diff against the previous state to figure out what changed.

## Pre-reqs

The instructions below are unchanged from the [ElectricSQL Quick Start](https://electric-sql.com/docs/quickstart) (specifically, `npx create-electric-app@latest my-app --template react`).

You need [NodeJS >= 16.11 and Docker Compose v2](https://electric-sql.com/docs/usage/installation/prereqs).

## Install

Install the dependencies:

```sh
npm install
```

## Setup

Start Postgres and Electric using Docker (see [running the examples](https://electric-sql.com/docs/examples/notes/running) for more options):

```shell
npm run backend:up
# Or `npm run backend:start` to foreground
```

Note that, if useful, you can connect to Postgres using:

```shell
npm run db:psql
```

Setup your [database schema](https://electric-sql.com/docs/usage/data-modelling):

```shell
npm run db:migrate
```

Generate your [type-safe client](https://electric-sql.com/docs/usage/data-access/client):

```shell
npm run client:generate
# or `npm run client:watch`` to re-generate whenever the DB schema changes
```

## Run

Start your app:

```sh
npm run dev
```

<!-- see https://vitejs.dev/config/server-options#server-port for default Vite port -->

Open [localhost:5173](http://localhost:5173) in your web browser.

## Develop

This template contains the basic Electric code which you can adapt to your use case. For more information see the:

- [Documentation](https://electric-sql.com/docs)
- [Quickstart](https://electric-sql.com/docs/quickstart)
- [Usage guide](https://electric-sql.com/docs/usage)

If you need help [let ElectricSQL know on Discord](https://discord.electric-sql.com).
