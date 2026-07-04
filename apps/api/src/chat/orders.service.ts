import { Injectable } from "@nestjs/common";

export interface OrderRecord {
  orderId: string;
  item: string;
  quantity: number;
  status: string;
  total: string;
}

/**
 * In-memory order store. Exists to prove tools resolve their dependencies
 * through Nest DI — the `lookups` log doubles as a test hook.
 */
@Injectable()
export class OrdersService {
  readonly lookups: string[] = [];
  private readonly orders = new Map<string, OrderRecord>();

  private ensure(orderId: string): OrderRecord {
    let order = this.orders.get(orderId);
    if (!order) {
      order = {
        orderId,
        item: "Mockingbird Feeder",
        quantity: 1,
        status: "shipped",
        total: "$41.50",
      };
      this.orders.set(orderId, order);
    }
    return order;
  }

  lookup(orderId: string): OrderRecord {
    this.lookups.push(orderId);
    return this.ensure(orderId);
  }

  cancel(orderId: string): string {
    this.ensure(orderId).status = "cancelled";
    return `Order ${orderId} has been cancelled.`;
  }

  statusOf(orderId: string): string {
    return this.ensure(orderId).status;
  }
}
