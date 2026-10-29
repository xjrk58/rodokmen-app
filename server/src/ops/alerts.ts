import type { Config } from '../config.js';
import type { Mailer } from '../mail/mailer.js';
import { alertEmail } from '../mail/templates.js';

/** Emails the Owner (ALERT_EMAIL). Without an address, the alert goes to stderr only. */
export async function sendAlert(config: Config, mailer: Mailer, subject: string, details: string): Promise<void> {
  const to = config.mail.alertEmail;
  if (!to) {
    console.error(`[alert, no ALERT_EMAIL set] ${subject}\n${details}`);
    return;
  }
  await mailer.send(alertEmail({ to, subject, details, origin: config.publicOrigin }));
}
