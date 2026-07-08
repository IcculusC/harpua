import { Injectable } from "@nestjs/common";

/** One "sent" weather-report email. */
export interface OutboxEntry {
  recipient: string;
  body: string;
}

/**
 * A tiny in-memory outbox standing in for a real email transport. The
 * approval-gated `send_weather_report` tool records each pretend-send here, so
 * the side effect is observable (the CLI/tests read `sent`) without any network
 * or real mail — the point is to demonstrate a human-approved side effect.
 */
@Injectable()
export class OutboxService {
  readonly sent: OutboxEntry[] = [];

  send(recipient: string, body: string): void {
    this.sent.push({ recipient, body });
  }
}
