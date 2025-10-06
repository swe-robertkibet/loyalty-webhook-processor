export interface Config {
  database: {
    url: string;
  };
  redis: {
    url: string;
  };
  server: {
    port: number;
    nodeEnv: 'development' | 'production' | 'test';
  };
  webhook: {
    secret: string;
  };
  loyalty: {
    pointsPer100Currency: number;
  };
  queue: {
    name: string;
    maxRetries: number;
  };
  logging: {
    level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  };
}
