export interface WebhookPayload {
  eventId: string;
  type: string;
  userId: string;
  amount: number;
  currency: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface WebhookResponse {
  success: boolean;
  message: string;
  eventId?: string;
  jobId?: string;
}

export interface WebhookErrorResponse {
  success: false;
  error: string;
  message: string;
}
