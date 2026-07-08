import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
} from "@nestjs/common";
import { z } from "zod";

import { AgentService, type AgentTurn } from "./agent.service";

const resumeBodySchema = z.object({
  approved: z.boolean(),
  reason: z.string().min(1).optional(),
});

interface AgentResponse {
  messages: string[];
  interrupt?: unknown;
}

function toResponse(turn: AgentTurn): AgentResponse {
  return {
    messages: turn.messages,
    ...(turn.interrupt !== undefined ? { interrupt: turn.interrupt } : {}),
  };
}

@Controller("agent")
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  /**
   * Send a message on a conversation thread. The thread id keys the checkpointer,
   * so repeated posts to the same id continue the same conversation. If the turn
   * calls an approval-gated tool the response carries an `interrupt` payload
   * instead of a final answer — approve or decline it via `/resume` below.
   *
   *   curl -XPOST localhost:3000/agent/t1 -H 'content-type: application/json' \
   *     -d '{"message":"what is the weather in berlin?"}'
   */
  @Post(":threadId")
  async send(
    @Param("threadId") threadId: string,
    @Body() body: { message: string },
  ): Promise<AgentResponse> {
    return toResponse(await this.agent.ask(threadId, body.message));
  }

  /**
   * Resume a thread paused on an approval-gated tool. Body is zod-validated;
   * `{ approved: true }` runs the pending tool, `{ approved: false, reason? }`
   * declines it. A malformed body is a 400.
   *
   *   curl -XPOST localhost:3000/agent/t1/resume -H 'content-type: application/json' \
   *     -d '{"approved":true}'
   */
  @Post(":threadId/resume")
  async resume(
    @Param("threadId") threadId: string,
    @Body() body: unknown,
  ): Promise<AgentResponse> {
    const decision = resumeBodySchema.safeParse(body);
    if (!decision.success) {
      throw new BadRequestException(decision.error.issues);
    }
    return toResponse(await this.agent.resume(threadId, decision.data));
  }
}
