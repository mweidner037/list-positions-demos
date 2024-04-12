# ElectricSQL - Recipe Editor Demo

(Based on the [ElectricSQL Quick Start](https://electric-sql.com/docs/quickstart), specifically, `npx create-electric-app@latest my-app --template react`)

This is a web application using ElectricSQL in the browser with [wa-sqlite](https://electric-sql.com/docs/integrations/drivers/web/wa-sqlite).

Behaviors demonstrated (see the schema in [`db/migrations/01-create_recipes.ts`](./db/migrations/01-create_recipes.sql)):

1. Ingredients can be moved (arrows on the left). If an ingredient is moved and edited concurrently, both updates go through in the obvious way. To implement this, we assign a [position string](https://github.com/mweidner037/position-strings#readme) to each ingredient and `ORDER BY` those.
2. The recipe can be scaled (buttons at the bottom). If the recipe is scaled while other edits happen concurrently, the edited amounts are also scaled, keeping the recipe in proportion. To implement this, we store an `amount_unscaled` for each ingredient and a `scale` for the whole recipe, displaying their product (cf. [global modifiers in CRDTs](https://mattweidner.com/2023/09/26/crdt-survey-2.html#global-modifiers)).
3. If an ingredient is deleted and edited concurrently, the edit "wins" over the delete, canceling it. This is ElectricSQL's default behavior.
4. Rich-text editing for the instructions: ElectricSQL doesn't have built-in support for this, so I implement it on top using [list-positions](https://github.com/mweidner037/list-positions#readme) and [list-formatting](https://github.com/mweidner037/list-formatting#readme). See [`ElectricQuill`](./src/quill/ElectricQuill.tsx), a reusable ElectricSQL-Quill binding.

## Pre-reqs

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
