import express from "express";
import { CopilotRuntime, ExperimentalEmptyAdapter, copilotRuntimeNodeHttpEndpoint } from "@copilotkit/runtime";
import { createAgent } from "./agent.js";
import type { readConfig } from "./config.js";

export function createApp(config: ReturnType<typeof readConfig>) {
  const app = express();
  app.disable("x-powered-by");
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.get("/api/healthz", (_req, res) => res.json({ status: "ok", mode: config.mode }));
  const runtime = new CopilotRuntime({ agents: { default: createAgent(config) } });
  const handler = copilotRuntimeNodeHttpEndpoint({
    endpoint: "/api/copilotkit",
    runtime,
    serviceAdapter: new ExperimentalEmptyAdapter(),
  });
  // Keep the full URL intact. Mounting at /api/copilotkit would strip its prefix in Express.
  app.use((req, res, next) => {
    if (req.path === "/api/copilotkit" || req.path.startsWith("/api/copilotkit/")) {
      void Promise.resolve(handler(req, res)).catch(next);
    } else {
      next();
    }
  });
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Request failed", { name: error instanceof Error ? error.name : "UnknownError" });
    if (res.headersSent) { res.end(); return; }
    res.status(500).json({ error: "Request failed" });
  });
  return app;
}
