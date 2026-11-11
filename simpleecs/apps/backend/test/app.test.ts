import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { HttpAgent } from "@ag-ui/client";
import { createApp } from "../src/app.js";
import { createAgentCoreFetch, mockFetch, sessionId } from "../src/agent.js";
import { readConfig } from "../src/config.js";

const arn = "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/example-abc123";
const agentConfig = readConfig({ AGENTCORE_AGENT_ARN: arn });
const input = (threadId = "thread-1") => ({
  threadId, runId: crypto.randomUUID(), state: {},
  messages: [{ id: crypto.randomUUID(), role: "user", content: "Hello" }],
  tools: [], context: [], forwardedProps: {},
});

test("configuration fails closed and derives the AWS region from the ARN", () => {
  assert.throws(() => readConfig({}), /runtime ARN/);
  assert.throws(() => readConfig({ AGENT_MODE: "invalid" }), /AGENT_MODE/);
  assert.throws(() => readConfig({ AGENT_MODE: "mock", NODE_ENV: "production" }), /disabled/);
  assert.throws(() => readConfig({ AGENTCORE_AGENT_ARN: arn, AWS_REGION: "eu-west-1" }), /match/);
  assert.throws(() => readConfig({ AGENT_MODE: "mock", PORT: "bad" }), /PORT/);
  assert.equal(agentConfig.region, "us-east-1");
  assert.equal(readConfig({ AGENT_MODE: "mock" }).mode, "mock");
});

test("session IDs are stable, distinct, and satisfy AgentCore length constraints", () => {
  for (const thread of ["a", "a".repeat(1000), "unicode-✓"]) {
    assert.match(sessionId(thread), /^[a-f0-9]{64}$/);
    assert.equal(sessionId(thread), sessionId(thread));
  }
  assert.notEqual(sessionId("one"), sessionId("two"));
});

test("AgentCore fetch forwards AG-UI input and streams without waiting for completion", async () => {
  const body = input();
  const abort = new AbortController();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const client = {
    async send(command: any, options: any) {
      assert.equal(command.input.agentRuntimeArn, arn);
      assert.equal(command.input.qualifier, "DEFAULT");
      assert.equal(command.input.runtimeSessionId, sessionId(body.threadId));
      assert.equal(command.input.accept, "text/event-stream");
      assert.deepEqual(JSON.parse(Buffer.from(command.input.payload).toString()), body);
      assert.equal(options.abortSignal, abort.signal);
      return { contentType: "text/event-stream; charset=utf-8", response: { transformToWebStream: () => stream } };
    },
  };
  const response = await createAgentCoreFetch(agentConfig, client as any)("unused", {
    body: JSON.stringify(body), signal: abort.signal,
  });
  const reader = response.body!.getReader();
  controller.enqueue(new TextEncoder().encode("data: first\n\n"));
  assert.equal(new TextDecoder().decode((await reader.read()).value), "data: first\n\n");
  controller.enqueue(new TextEncoder().encode("data: second\n\n"));
  controller.close();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "data: second\n\n");
  assert.equal((await reader.read()).done, true);
});

test("AgentCore fetch rejects non-AG-UI responses with a safe error", async () => {
  const client = { send: async () => ({ contentType: "application/json", response: {} }) };
  await assert.rejects(
    createAgentCoreFetch(agentConfig, client as any)("unused", { body: JSON.stringify(input()) }),
    /Agent invocation failed/,
  );
});

test("mock SSE can be consumed by the real AG-UI client", async () => {
  const agent = new HttpAgent({ url: "https://mock.invalid", fetch: mockFetch, threadId: "test-thread" });
  agent.addMessage({ id: "user-1", role: "user", content: "Hello" });
  await agent.runAgent();
  assert.equal(agent.messages.at(-1)?.role, "assistant");
  assert.match(String(agent.messages.at(-1)?.content), /local mock is connected/);
});

test("real CopilotKit HTTP endpoint supports discovery, repeated runs, and separate threads", { timeout: 30_000 }, async () => {
  const server = createApp(readConfig({ AGENT_MODE: "mock" })).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const health = await fetch(`${base}/api/healthz`);
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("cache-control"), "no-store");
    assert.deepEqual(await health.json(), { status: "ok", mode: "mock" });
    const post = (body: unknown) => fetch(`${base}/api/copilotkit`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const discovery = await post({ method: "info" });
    assert.equal(discovery.status, 200);
    assert.match(await discovery.text(), /default/);
    for (const threadId of ["same-thread", "same-thread", "other-thread"]) {
      const body = input(threadId);
      const run = await post({ method: "agent/run", params: { agentId: "default" }, body });
      const stream = await run.text();
      assert.equal(run.status, 200, stream);
      assert.match(run.headers.get("content-type") ?? "", /text\/event-stream/);
      assert.match(stream, /RUN_STARTED/);
      assert.match(stream, /local mock is connected/);
      assert.match(stream, /RUN_FINISHED/);
      assert.doesNotMatch(stream, /RUN_ERROR/);
    }
    const missing = await fetch(`${base}/api/missing`);
    assert.equal(missing.status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
