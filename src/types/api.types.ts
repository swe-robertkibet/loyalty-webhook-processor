export interface UserResponse {
  id: string;
  email: string | null;
  name: string | null;
  points: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TransactionResponse {
  id: number;
  eventId: string;
  userId: string;
  amount: number;
  points: number;
  createdAt: Date;
}

export interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  services: {
    database: {
      status: 'up' | 'down';
      latency?: number;
    };
    redis: {
      status: 'up' | 'down';
      latency?: number;
    };
  };
}

export interface ErrorResponse {
  error: string;
  message: string;
}
