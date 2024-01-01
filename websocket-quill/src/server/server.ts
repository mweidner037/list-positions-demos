import express from "express";
import path from "path";
import { WebSocketServer } from "ws";
import { RichTextServer } from "./rich_text_server";

const port = process.env.PORT || 3000;

// Server dist/ with a simple express server.
const app = express();
app.use("/", express.static(path.join(__dirname, "../../dist")));
const server = app.listen(port, () =>
  console.log(`Listening at http://localhost:${port}/`)
);

// Run the WebSocket server.
const wss = new WebSocketServer({ server });
new RichTextServer(wss);
