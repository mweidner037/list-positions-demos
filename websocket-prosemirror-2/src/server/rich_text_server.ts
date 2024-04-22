import { WebSocket, WebSocketServer } from "ws";
import { Message, Mutation } from "../common/messages";

const heartbeatInterval = 30000;

/**
 * Server that assigns mutations a sequence number and echoes them to all
 * clients in order.
 *
 * TODO: instead store literal state + CRDT state only, to demo that we
 * don't need the whole history?
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
      if (ws === origin) continue;
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
