export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const mode = env.AGENT_MODE ?? "agentcore";
  if (mode !== "mock" && mode !== "agentcore") {
    throw new Error("AGENT_MODE must be mock or agentcore");
  }
  if (env.NODE_ENV === "production" && mode === "mock") {
    throw new Error("Mock mode is disabled in production");
  }
  const arn = env.AGENTCORE_AGENT_ARN ?? "";
  const match = /^arn:aws:bedrock-agentcore:([a-z0-9-]+):\d{12}:runtime\/[A-Za-z0-9_-]+$/.exec(arn);
  if (mode === "agentcore" && !match) {
    throw new Error("AGENTCORE_AGENT_ARN must be an AgentCore runtime ARN");
  }
  const region = env.AWS_REGION || match?.[1] || "us-east-1";
  if (mode === "agentcore" && region !== match?.[1]) {
    throw new Error("AWS_REGION must match the AgentCore runtime ARN region");
  }
  const port = Number(env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return { mode, arn, region, port, qualifier: env.AGENTCORE_QUALIFIER || "DEFAULT" };
}
