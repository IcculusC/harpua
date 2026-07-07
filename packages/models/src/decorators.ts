import { Inject } from "@nestjs/common";
import { getChatModelToken } from "./constants";

/**
 * Injects a registered chat model by name. With no argument (or `"default"`) it
 * resolves the DEFAULT model registered via {@link ChatModelModule.forRoot} —
 * the same token as {@link CHAT_MODEL}. Pass the slug used in
 * {@link ChatModelModule.register} to inject a named model, e.g.
 * `@InjectChatModel("fast")`.
 *
 * Mirrors `@InjectLangGraphRunnable` in `@harpua/langgraph`.
 */
export function InjectChatModel(name?: string): ParameterDecorator {
  return Inject(getChatModelToken(name));
}
