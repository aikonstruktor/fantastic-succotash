import React from "react";
import ReactDOM from "react-dom/client";
import { CopilotKit } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import "@copilotkit/react-ui/styles.css";
import "./styles.css";

function App() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" agent="default" useSingleEndpoint showDevConsole={false}>
      <main className="workspace">
        <header>
          <div className="brand">A<span>/</span></div>
          <div><p className="eyebrow">AGENT WORKSPACE</p><h1>Your thinking partner.</h1></div>
          <span className="stack">Powered by AgentCore</span>
        </header>
        <section className="intro">
          <p>Start a conversation. Explore an idea. Get things done.</p>
          <span>Your agent, connected through a single secure endpoint.</span>
        </section>
        <section className="chat" aria-label="Agent conversation">
          <CopilotChat
            labels={{
              title: "Agent assistant",
              initial: "Hi! What would you like to work on today?",
              placeholder: "Ask your agent anything…",
            }}
          />
        </section>
        <footer>Vite + CopilotKit <span>CloudFront / ECS / AgentCore</span></footer>
      </main>
    </CopilotKit>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
