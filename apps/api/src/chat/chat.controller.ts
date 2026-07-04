import { Body, Controller, Param, Post } from "@nestjs/common";
import { ChatService, type ChatTurn } from "./chat.service";

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

  @Post(":threadId/resume")
  async resume(
    @Param("threadId") threadId: string,
    @Body() body: { approved: boolean },
  ): Promise<ChatResponse> {
    return toResponse(await this.chat.resume(threadId, body.approved === true));
  }
}
