export interface ProcessPaymentEventParams {
  eventId: string;
  userId: string;
  amount: number;
  type: string;
}

export interface ProcessPaymentEventResult {
  userId: string;
  pointsAwarded: number;
  totalPoints: number;
  transactionId: number;
}

export interface LoyaltyCalculation {
  amount: number;
  pointsEarned: number;
}
