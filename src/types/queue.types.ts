export interface PaymentEventJob {
  eventId: string;
  type: string;
  payload: {
    userId: string;
    amount: number;
    currency: string;
    timestamp: string;
    [key: string]: unknown;
  };
}
