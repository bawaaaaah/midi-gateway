/** Fastify app: serves the built web UI and a health probe. WebSocket is bolted on separately. */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { ServerConfig } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));
// dist/http.js -> packages/server -> packages -> repo root -> apps/web/dist
const WEB_DIST = join(here, "..", "..", "..", "apps", "web", "dist");

export async function createHttpServer(config: ServerConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ ok: true, port: config.httpPort }));

  if (existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, { root: WEB_DIST, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith("/ws") || req.raw.url?.startsWith("/health")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.get("/", async (_req, reply) => {
      reply.type("text/html").send(
        `<pre>Web UI not built yet.\nRun: npm run dev  (or npm run build)\nExpected at: ${WEB_DIST}</pre>`,
      );
    });
  }

  return app;
}
