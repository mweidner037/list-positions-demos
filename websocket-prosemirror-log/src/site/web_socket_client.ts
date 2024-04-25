// For this basic demo, we don't attempt to reconnect the WebSocket ever.
// That would require buffering updates and/or logic to
// "merge" in the Welcome state received after reconnecting.
// However, we do allow "test" disconnection that just buffers messages
// internally (without actually disconnecting the WebSocket).

export class WebSocketClient {
  ws: WebSocket;

  onMessage?: (message: string) => void;

  private _testConnected = true;
  private sendQueue: string[] = [];
  private receiveQueue: string[] = [];

  constructor(readonly wsURL: string) {
    this.ws = new WebSocket(wsURL);
    this.ws.addEventListener("message", (e) => this.messageHandler(e));
  }

  private messageHandler(e: MessageEvent<string>): void {
    const message = e.data;
    if (this._testConnected) {
      this.onMessage?.(message);
    } else {
      this.receiveQueue.push(message);
    }
  }

  private sendInternal(message: string): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(message);
    } else {
      console.log("WebSocket not open, skipping send");
    }
  }

  send(message: string): void {
    if (this._testConnected) {
      this.sendInternal(message);
    } else {
      this.sendQueue.push(message);
    }
  }

  set testConnected(conn: boolean) {
    if (conn !== this._testConnected) {
      this._testConnected = conn;
      if (conn) {
        // Send queued messages.
        for (const message of this.sendQueue) {
          this.sendInternal(message);
        }
        this.sendQueue = [];

        // Received queued messages.
        const toReceive = this.receiveQueue;
        this.receiveQueue = [];
        for (const message of toReceive) {
          this.onMessage?.(message);
        }
      }
    }
  }

  get testConnected(): boolean {
    return this._testConnected;
  }
}
