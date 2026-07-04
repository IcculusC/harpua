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
}
