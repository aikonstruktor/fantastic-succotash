import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Production assets are served by Node, not Vite's development/preview server.
export function createApp() {
  const app = express();
  const dist = fileURLToPath(new URL("./dist/", import.meta.url));
  app.disable("x-powered-by");
  app.get("/healthz", (_req, res) => res.json({ status: "ok" }));
  // Misrouted API calls must never return the SPA shell.
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
  app.use("/assets", express.static(path.join(dist, "assets"), {
    immutable: true, maxAge: "1y", fallthrough: false,
  }));
  app.use(express.static(dist, { maxAge: 0 }));
  app.get("/{*path}", (req, res) => {
    if (path.extname(req.path)) return res.sendStatus(404);
    res.set("Cache-Control", "no-store").sendFile(path.join(dist, "index.html"));
  });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createApp().listen(Number(process.env.PORT || 3000), "0.0.0.0", () => {
    console.log("Frontend listening on port", process.env.PORT || 3000);
  });
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
