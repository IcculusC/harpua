import "reflect-metadata";
import * as readline from "node:readline";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { isAIMessage } from "@langchain/core/messages";
import { z } from "zod";

import { AppModule } from "./app.module";
import { ChatService, type ChatTurn } from "./chat/chat.service";

// The interrupt payload an approval-gated tool raises. Render it as a readable
// prompt when it matches; fall back to raw JSON for any other interrupt kind.
const toolApprovalRequestSchema = z.object({
  type: z.literal("tool_approval_request"),
  tool: z.string(),
  args: z.unknown(),
});

function renderInterrupt(payload: unknown): string {
  const parsed = toolApprovalRequestSchema.safeParse(payload);
  if (parsed.success) {
    return `[approval needed] run ${parsed.data.tool} with ${JSON.stringify(
      parsed.data.args,
    )}?`;
  }
  return `[interrupt] ${JSON.stringify(payload)}`;
}

function printTurn(turn: ChatTurn): void {
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
  if (turn.interrupt !== undefined) {
    console.log(renderInterrupt(turn.interrupt));
  }
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["warn", "error"],
  });
  const chat = app.get(ChatService);
  const threadId = process.argv[2] ?? randomUUID();
  console.log(`Chatting on thread ${threadId} (type "exit" to quit)`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let awaitingApproval = false;
  let closing = false;

  const prompt = (): void => {
    rl.setPrompt(awaitingApproval ? "Approve? (y/n) " : "harpua> ");
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
    if (awaitingApproval) {
      const approved = /^y(es)?$/i.test(line);
      awaitingApproval = false;
      const turn = await chat.resume(threadId, { approved });
      printTurn(turn);
      if (turn.interrupt !== undefined) awaitingApproval = true;
      prompt();
      return;
    }
    if (line === "exit" || line === "quit") {
      await shutdown();
      return;
    }
    if (line.length === 0) {
      prompt();
      return;
    }
    const turn = await chat.send(threadId, line);
    printTurn(turn);
    if (turn.interrupt !== undefined) awaitingApproval = true;
    prompt();
  };

  // Serialize line handling so piped input is processed in order.
  let queue: Promise<void> = Promise.resolve();
  rl.on("line", (line) => {
    queue = queue.then(() => handle(line.trim()));
    queue.catch(() => undefined);
  });
  rl.on("close", () => {
    // Ctrl-D / end of piped input: finish pending work, then exit cleanly.
    void queue.then(shutdown).then(() => process.exit(0));
  });

  prompt();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
