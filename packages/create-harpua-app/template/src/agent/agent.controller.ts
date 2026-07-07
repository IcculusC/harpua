import { Body, Controller, Param, Post } from "@nestjs/common";

import { AgentService } from "./agent.service";

interface AgentResponse {
  messages: string[];
}

@Controller("agent")
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  /**
   * Send a message on a conversation thread. The thread id keys the checkpointer,
   * so repeated posts to the same id continue the same conversation.
   *
   *   curl -XPOST localhost:3000/agent/t1 -H 'content-type: application/json' \
   *     -d '{"message":"what is the weather in berlin?"}'
   */
  @Post(":threadId")
  async send(
    @Param("threadId") threadId: string,
    @Body() body: { message: string },
  ): Promise<AgentResponse> {
    const turn = await this.agent.ask(threadId, body.message);
    return { messages: turn.messages };
  }
}
