![Replicache logo](https://uploads-ssl.webflow.com/623a2f46e064937599256c2d/6269e72c61073c3d561a5015_Lockup%20v2.svg)

# todo-wc

This repository contains sample code for [Replicache](https://replicache.dev/). The example uses web-components with a common express server backend. The backend utilizes Express and demonstrates implementations of `push`, `pull`, `poke`, `createSpace`, and `spaceExists` handlers. These are required for the Replicache sync protocol. This library intends to help developers easily experiment with Replicache.

## 1. Setup

#### Get your Replicache License Key

```bash
$ npx replicache get-license
```

#### Set your `VITE_REPLICACHE_LICENSE_KEY` environment variable

```bash
$ export VITE_REPLICACHE_LICENSE_KEY="<your license key>"
```

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
