import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { LangGraphTool } from "@harpua/langgraph";
import { OrdersService } from "./orders.service";

@Injectable()
export class OrderTools {
  constructor(private readonly orders: OrdersService) {}

  @LangGraphTool({
    name: "lookup_order",
    description: "Look up an order by its id",
    schema: z.object({ orderId: z.string() }),
  })
  lookupOrder(input: { orderId: string }): string {
    const o = this.orders.lookup(input.orderId);
    return `Order ${o.orderId}: ${o.quantity}x ${o.item} — status ${o.status}, total ${o.total}`;
  }

  // Destructive, so it is approval-gated: the framework pauses with a
  // tool_approval_request interrupt BEFORE this runs, and only executes on a
  // resume with { approved: true }. The model still sees/calls it normally.
  // approvalMessage adds custom human-facing wording to that interrupt payload;
  // it zod-parses the tool-call args rather than assuming their shape.
  @LangGraphTool({
    name: "cancel_order",
    description: "Cancel an order by its id. Requires the user's approval.",
    schema: z.object({ orderId: z.string() }),
    requiresApproval: true,
    approvalMessage: (args) => {
      const { orderId } = z.object({ orderId: z.string() }).parse(args);
      return `Permanently cancel order ${orderId}? This cannot be undone.`;
    },
  })
  cancelOrder(input: { orderId: string }): string {
    return this.orders.cancel(input.orderId);
  }
}
