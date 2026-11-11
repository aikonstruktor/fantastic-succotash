import { createHash, randomUUID } from "node:crypto";
import { HttpAgent } from "@ag-ui/client";
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from "@aws-sdk/client-bedrock-agentcore";
import type { readConfig } from "./config.js";

type Config = ReturnType<typeof readConfig>;
type Sender = Pick<BedrockAgentCoreClient, "send">;

// Hashing keeps any thread identifier stable and within AgentCore's 33–256 character limit.
export function sessionId(threadId: string) {
  return createHash("sha256").update(threadId).digest("hex");
}

export function createAgentCoreFetch(config: Config, client: Sender) {
  return async (_url: string, init?: RequestInit): Promise<Response> => {
    const payload = JSON.parse(String(init?.body));
    if (typeof payload.threadId !== "string" || !payload.threadId) {
      throw new Error("A non-empty AG-UI threadId is required");
    }
    try {
      const result = await client.send(new InvokeAgentRuntimeCommand({
        agentRuntimeArn: config.arn,
        qualifier: config.qualifier,
        runtimeSessionId: sessionId(payload.threadId),
        contentType: "application/json",
        accept: "text/event-stream",
        payload: Buffer.from(JSON.stringify(payload)),
      }), { abortSignal: init?.signal ?? undefined });
      if (!result.response || !result.contentType?.includes("text/event-stream")) {
        throw new Error("AgentCore must return an AG-UI text/event-stream response");
      }
      // Do not buffer the response. HttpAgent parses the original AG-UI SSE stream.
      return new Response(result.response.transformToWebStream(), {
        headers: { "Content-Type": result.contentType },
      });
    } catch (error) {
      // Avoid logging prompts, tokens, AWS response bodies, or credential details.
      console.error("AgentCore invocation failed", { name: error instanceof Error ? error.name : "UnknownError" });
      throw new Error("Agent invocation failed. Check the backend logs and AgentCore configuration.");
    }
  };
}

export const mockFetch = async (_url: string, init?: RequestInit): Promise<Response> => {
  const { threadId, runId } = JSON.parse(String(init?.body));
  const messageId = randomUUID();
  const events = [
    { type: "RUN_STARTED", threadId, runId },
    { type: "TEXT_MESSAGE_START", messageId, role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId, delta: "The local mock is connected. Set AGENT_MODE=agentcore and AGENTCORE_AGENT_ARN in .env to talk to your deployed agent." },
    { type: "TEXT_MESSAGE_END", messageId },
    { type: "RUN_FINISHED", threadId, runId },
  ];
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
};

export function createAgent(config: Config) {
  return new HttpAgent({
    agentId: "default",
    description: "Assistant hosted on Amazon Bedrock AgentCore",
    url: "https://agentcore.invalid/invocations",
    fetch: config.mode === "mock" ? mockFetch : createAgentCoreFetch(
      config,
      new BedrockAgentCoreClient({ region: config.region, maxAttempts: 1 }),
    ),
  });
}
