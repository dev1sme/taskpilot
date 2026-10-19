import type { FastifyReply } from "fastify";

/** Server-Sent Events fan-out to every open browser tab. */
export class EventHub {
  private readonly clients = new Set<FastifyReply>();
  private readonly heartbeat: NodeJS.Timeout;

  constructor() {
    this.heartbeat = setInterval(() => this.publish("ping", Date.now()), 20_000);
    this.heartbeat.unref();
  }

  serve(reply: FastifyReply): void {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    this.clients.add(reply);
    reply.raw.on("close", () => this.clients.delete(reply));
    this.write(reply, "hello", "ok");
  }

  publish(event: string, data: unknown): void {
    for (const client of this.clients) this.write(client, event, data);
  }

  close(): void {
    clearInterval(this.heartbeat);
    for (const client of this.clients) client.raw.end();
    this.clients.clear();
  }

  private write(client: FastifyReply, event: string, data: unknown): void {
    client.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}
