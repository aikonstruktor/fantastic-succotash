import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { createApp } from "../server.mjs";

test("production Node server serves the SPA and immutable assets but never masks API/asset errors", async () => {
  const server = createApp().listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${base}/healthz`);
    assert.deepEqual(await health.json(), { status: "ok" });
    const home = await fetch(base);
    const html = await home.text();
    assert.equal(home.status, 200);
    assert.match(html, /Agent workspace/);
    const asset = html.match(/src="([^"]+\.js)"/)?.[1];
    assert.ok(asset);
    const script = await fetch(base + asset);
    assert.equal(script.status, 200);
    assert.match(script.headers.get("cache-control"), /immutable/);
    await script.arrayBuffer();
    const nested = await fetch(`${base}/conversation/example`);
    assert.equal(nested.status, 200);
    assert.equal(nested.headers.get("cache-control"), "no-store");
    assert.equal(await nested.text(), html);
    for (const path of ["/api", "/api/copilotkit", "/missing.js", "/assets/missing.js"]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 404, path);
      assert.doesNotMatch(await response.text(), /<div id="root">/);
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
