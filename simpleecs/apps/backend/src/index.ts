import { createApp } from "./app.js";
import { readConfig } from "./config.js";

const config = readConfig();
const server = createApp(config).listen(config.port, "0.0.0.0", () => {
  console.log(`Backend listening on port ${config.port} (${config.mode})`);
});
server.requestTimeout = 120_000;
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 25_000).unref();
});
