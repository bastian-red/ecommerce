import { type NotificationChannel } from './channel';
import { renderOrderEmail, type OrderEmailData, type OrderEmailKind } from './templates';

export * from './channel';
export * from './templates';

/**
 * Thin façade over channel + templates. It exists so callers name an intent
 * ("send the confirmation for this order") rather than picking a template and a
 * channel themselves, which is how two call sites end up sending two different
 * confirmation emails.
 */
export class NotificationService {
  constructor(private readonly channel: NotificationChannel) {}

  get channelName(): string {
    return this.channel.name;
  }

  send(kind: OrderEmailKind, data: OrderEmailData): Promise<void> {
    return this.channel.send(renderOrderEmail(kind, data));
  }
}
