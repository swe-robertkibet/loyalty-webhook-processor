import crypto from 'crypto';
import { config } from './config';

export function verifyWebhookSignature(payload: string, signature: string): boolean {
  if (!signature) {
    return false;
  }

  // EXTRACT SIGNATURE FROM HEADER FORMAT (e.g., "sha256=hash")
  const signatureParts = signature.split('=');
  if (signatureParts.length !== 2 || signatureParts[0] !== 'sha256') {
    return false;
  }

  const receivedHash = signatureParts[1];

  const expectedHash = crypto
    .createHmac('sha256', config.webhook.secret)
    .update(payload)
    .digest('hex');

  // CONSTANT-TIME COMPARISON TO PREVENT TIMING ATTACKS
  return crypto.timingSafeEqual(Buffer.from(receivedHash), Buffer.from(expectedHash));
}

export function generateWebhookSignature(payload: string): string {
  const hash = crypto.createHmac('sha256', config.webhook.secret).update(payload).digest('hex');

  return `sha256=${hash}`;
}
