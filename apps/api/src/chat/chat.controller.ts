import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  Query,
  Sse,
  type MessageEvent,
} from "@nestjs/common";
import { Observable, from, map } from "rxjs";
import { z } from "zod";
import { ChatService, type ChatStreamEvent, type ChatTurn } from "./chat.service";

const resumeBodySchema = z.object({
  approved: z.boolean(),
  reason: z.string().min(1).optional(),
});

interface ChatResponse {
  messages: string[];
  interrupt?: unknown;
}

function toResponse(turn: ChatTurn): ChatResponse {
  return {
    messages: turn.messages,
    ...(turn.interrupt !== undefined ? { interrupt: turn.interrupt } : {}),
  };
}

@Controller("chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post(":threadId")
  async send(
    @Param("threadId") threadId: string,
    @Body() body: { message: string },
  ): Promise<ChatResponse> {
    return toResponse(await this.chat.send(threadId, body.message));
  }

  /**
   * Server-Sent Events stream of a turn. `@Sse` is GET-based in Nest, so the
   * message rides in as a query param. Each node update is a named SSE event
   * (event name = node id); the run ends with a `final` event carrying the
   * assistant text or the interrupt payload.
   *
   *   curl -N "http://localhost:3000/chat/t1/stream?message=check%20order%2042"
   */
  @Sse(":threadId/stream")
  stream(
    @Param("threadId") threadId: string,
    @Query("message") message: string,
  ): Observable<MessageEvent> {
    return from(this.chat.streamTurn(threadId, message)).pipe(
      map((event: ChatStreamEvent) =>
        event.kind === "final"
          ? {
              type: "final",
              data: JSON.stringify({
                messages: event.messages,
                ...(event.interrupt !== undefined
                  ? { interrupt: event.interrupt }
                  : {}),
              }),
            }
          : {
              type: event.node,
              data: JSON.stringify({
                node: event.node,
                messages: event.messages,
              }),
            },
      ),
    );
  }

  @Post(":threadId/resume")
  async resume(
    @Param("threadId") threadId: string,
    @Body() body: unknown,
  ): Promise<ChatResponse> {
    const decision = resumeBodySchema.safeParse(body);
    if (!decision.success) {
      throw new BadRequestException(decision.error.issues);
    }
    return toResponse(await this.chat.resume(threadId, decision.data));
  }
}
