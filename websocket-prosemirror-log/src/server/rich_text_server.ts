import { WebSocket, WebSocketServer } from "ws";
import { Message } from "../common/messages";
import { Mutation } from "../common/mutation";

const heartbeatInterval = 30000;

/**
 * Server that assigns mutations a sequence number and echoes them to all
 * clients in order.
 *
 * We store the full Mutation log for welcoming future clients. In principle,
 * you could instead store just the current ProseMirror + Outline states and
 * use those to welcome clients. (For reconnections, you would also need a vector
 * clock or similar, to tell clients which of their past mutations have been acked.)
 */
export class RichTextServer {
  private readonly mutations: Mutation[] = [];

  private clients = new Set<WebSocket>();

  constructor(readonly wss: WebSocketServer) {
    this.wss.on("connection", (ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        this.wsOpen(ws);
      } else ws.on("open", () => this.wsOpen(ws));
      ws.on("message", (data) => this.wsReceive(ws, data.toString()));
      ws.on("close", () => this.wsClose(ws));
      ws.on("error", (err) => {
        console.error(err);
        this.wsClose(ws);
      });
    });
  }

  private sendMessage(ws: WebSocket, msg: Message) {
    if (ws.readyState == WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private echo(origin: WebSocket, data: string) {
    for (const ws of this.clients) {
      if (ws.readyState == WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  private wsOpen(ws: WebSocket) {
    this.startHeartbeats(ws);

    // Send the current state.
    this.sendMessage(ws, {
      type: "welcome",
      mutations: this.mutations,
    });

    this.clients.add(ws);
  }

  /**
   * Ping to keep connection alive.
   *
   * This is necessary on at least Heroku, which has a 55 second timeout:
   * https://devcenter.heroku.com/articles/websockets#timeouts
   */
  private startHeartbeats(ws: WebSocket) {
    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else clearInterval(interval);
    }, heartbeatInterval);
  }

  private wsReceive(ws: WebSocket, data: string) {
    const msg = JSON.parse(data) as Message;
    switch (msg.type) {
      case "mutation":
        // Here is where you can choose to reject/alter the mutation, before
        // adding it to the log (which is the source of truth) and
        // broadcasting it.
        // Note: Even if you reject the change, you should keep the BunchMeta,
        // in case this client's future changes depend on it.
        // TODO: Need a way to tell a client when one of its mutations has
        // been acknowledged but not accepted as-is, so that the client can remove
        // that mutation from its pendingMutations.
        this.mutations.push(msg.mutation);
        this.echo(ws, data);
        break;
      default:
        console.error("Unknown message type: " + msg.type);
    }
  }

  private wsClose(ws: WebSocket) {
    this.clients.delete(ws);
  }
}
