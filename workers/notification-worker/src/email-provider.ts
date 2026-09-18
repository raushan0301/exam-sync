export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
}

export interface EmailProvider {
  send(params: SendEmailParams): Promise<void>;
}

/**
 * No real email vendor (SES/SendGrid/etc.) is documented anywhere in
 * ARCHITECTURE.md's tech-stack table — only "S3 (or provider-equivalent)"
 * is named for object storage; no equivalent line exists for email.
 * Wiring a specific vendor SDK here would be an undocumented invention,
 * not a documented requirement. This console-logging implementation is
 * the disclosed placeholder: every EMAIL-channel delivery attempt
 * succeeds trivially (logged, not actually sent), which is enough to
 * exercise the full outbox -> queue -> worker -> SENT pipeline in dev/CI.
 * A real provider is a drop-in `EmailProvider` implementation swapped in
 * at `index.ts`'s composition root — nothing else in this worker needs to
 * change.
 */
export class ConsoleEmailProvider implements EmailProvider {
  async send(params: SendEmailParams): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[notification-worker] EMAIL to=${params.to} subject="${params.subject}" body="${params.body}"`);
  }
}
