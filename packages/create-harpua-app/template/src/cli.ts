import "reflect-metadata";
import * as readline from "node:readline";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { isAIMessage } from "@langchain/core/messages";

import { AppModule } from "./app.module";
import { AgentService, type AgentTurn } from "./agent/agent.service";

function printTurn(turn: AgentTurn): void {
  for (const message of turn.newMessages) {
    if (isAIMessage(message)) {
      for (const call of message.tool_calls ?? []) {
        console.log(`[tool: ${call.name}] ${JSON.stringify(call.args)}`);
      }
      const text =
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content);
      if (text.length > 0) console.log(`[assistant] ${text}`);
    }
  }
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["warn", "error"],
  });
  const agent = app.get(AgentService);
  const threadId = process.argv[2] ?? randomUUID();
  console.log(`Chatting on thread ${threadId} (type "exit" to quit)`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let closing = false;

  const prompt = (): void => {
    rl.setPrompt("weather> ");
    rl.prompt();
  };

  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    rl.close();
    await app.close();
  };

  const handle = async (line: string): Promise<void> => {
    if (closing) return;
    if (line === "exit" || line === "quit") {
      await shutdown();
      return;
    }
    if (line.length === 0) {
      prompt();
      return;
    }
    const turn = await agent.ask(threadId, line);
    printTurn(turn);
    prompt();
  };

  // Serialize line handling so piped input is processed in order.
  let queue: Promise<void> = Promise.resolve();
  rl.on("line", (line) => {
    queue = queue.then(() => handle(line.trim()));
    queue.catch(() => undefined);
  });
  rl.on("close", () => {
    void queue.then(shutdown).then(() => process.exit(0));
  });

  prompt();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
