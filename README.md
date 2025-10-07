# Loyalty Webhook Processor

## Overview

The **Loyalty Webhook Processor** is a Node.js service that processes payment webhooks and awards loyalty points to users in a reliable, idempotent manner. This system handles webhook retries gracefully, ensuring that duplicate webhook deliveries never result in duplicate point awards. Financial systems require accuracy, and this service prevents duplicate processing.

Built with TypeScript, this service implements a webhook processing pipeline with HMAC signature verification for security, schema validation for data integrity, and a two-layer idempotency mechanism to prevent duplicate processing. The architecture uses BullMQ (backed by Redis) for asynchronous job processing, enabling retry logic with exponential backoff and horizontal scaling capabilities. PostgreSQL with Prisma ORM provides transactional consistency, ensuring user points and transaction records remain synchronized even during failures.

The service exposes RESTful APIs for querying user points and transaction history, along with health check and Prometheus metrics endpoints for observability. This design prioritizes reliability, security, and scalability. It handles high-volume payment processing environments.

**Tech Stack:** Node.js, TypeScript, Express, BullMQ, Redis, PostgreSQL, Prisma, Zod, Pino

---

## System Architecture

![System Architecture](images/architecture.png)

---

## Request Flow & Idempotency

![Request Flow & Idempotency](images/flow.png)

---

## File Structure & Explanation

### Core Application Files

#### `src/server.ts`

The main entry point for the Express HTTP server. This file sets up the Express application with middleware including Pino HTTP logger for structured request logging, JSON body parser, and request routing. It registers all API routes (`/webhooks`, `/users`, `/transactions`, `/health`, `/metrics`) and implements error handling with a 404 handler for undefined routes and a global error handler. The server includes graceful shutdown logic that responds to SIGTERM and SIGINT signals, allowing in-flight requests to complete before closing. It also handles unhandled promise rejections and uncaught exceptions to prevent silent failures.

#### `src/worker.ts`

The BullMQ worker process that consumes jobs from the Redis queue. This runs as a separate process from the HTTP server, enabling independent scaling of job processing capacity. The worker is configured with a concurrency of 5, meaning it can process 5 jobs simultaneously. It includes rate limiting (10 jobs per second) to prevent overwhelming downstream systems. For each job, the worker updates the event's attempt count, calls the loyalty service to process the payment, and updates the event status to either "processed" or "failed". The worker implements event handlers for job completion and failure, logging all outcomes. Like the server, it includes graceful shutdown handling to allow running jobs to complete before terminating.

#### `src/queue.ts`

Configures the BullMQ queue connection to Redis and defines default job options. Jobs are configured with automatic retry logic (5 attempts maximum) using exponential backoff starting at 1 second. This means retries happen at roughly 1s, 2s, 4s, 8s, and 16s intervals. The queue automatically removes completed jobs after 100 jobs or 1 hour, and failed jobs after 24 hours, preventing unbounded growth of job records. This file also sets up queue event monitoring, logging job completions, failures, and stalled jobs. The QueueEvents listener provides real-time visibility into job processing status.

### Route Handlers

#### `src/routes/webhook.ts`

The main webhook route in the application: handles incoming payment webhooks. This endpoint implements the first line of defense with HMAC SHA-256 signature verification to ensure webhooks originate from trusted sources. If the signature is missing or invalid, it immediately returns a 401 error. Next, it validates the payload structure using Zod schema validation, checking that required fields (`eventId`, `type`, `userId`, `amount`, `currency`, `timestamp`) are present and correctly typed. The core idempotency mechanism creates an Event record with a unique constraint on `eventId`. If a duplicate event arrives (Prisma error P2002), it returns 200 with "already received and processed", preventing duplicate job creation. For new events, it enqueues a job to BullMQ and returns 202 Accepted, acknowledging receipt without waiting for processing to complete.

#### `src/routes/users.ts`

Provides a GET endpoint to retrieve a user's current loyalty points balance and metadata. This endpoint queries the User table by ID and returns the user's points, email, name, and timestamps. If the user doesn't exist, it returns a 404 error with a clear error message. This simple read-only endpoint is useful for customer support dashboards and user account pages.

#### `src/routes/transactions.ts`

Implements a paginated GET endpoint for querying transaction history. It accepts optional query parameters: `userId` to filter by user, `limit` (default 100, max 1000) for page size, and `offset` for pagination. Transactions are ordered by creation date descending, showing most recent first. This endpoint enables transaction history display in user interfaces and supports auditing requirements. The response includes metadata about count, limit, and offset for pagination control.

#### `src/routes/health.ts`

Provides a health check endpoint that tests connectivity to database and cache dependencies. It performs actual queries to PostgreSQL (`SELECT 1`) and Redis (PING command), measuring latency for each. The endpoint returns 200 if all services are healthy, or 503 if any service is down. This health check supports Kubernetes liveness/readiness probes and load balancer health monitoring. The latency measurements help diagnose performance degradation.

#### `src/routes/metrics.ts`

Exposes Prometheus-format metrics for observability. Includes Node.js default metrics (memory, CPU, event loop lag) plus custom application metrics: `webhook_requests_total` (counter by status), `job_processing_duration_seconds` (histogram with buckets), `queue_size` (gauge), and `loyalty_points_awarded_total` (counter). These metrics enable monitoring dashboards, alerting, and capacity planning. The Prometheus format makes it compatible with Grafana and other monitoring tools.

### Business Logic

#### `src/services/loyalty.ts`

Contains the core business logic for loyalty point calculation and award. The `calculatePoints` method implements the rule: 1 loyalty point per $1 spent (amount in cents / 100). The `processPaymentEvent` method implements the second layer of idempotency by checking if a transaction already exists for the given `eventId`. If found, it returns the existing transaction data without creating duplicates. For new transactions, it uses Prisma's `$transaction` API to perform an atomic database transaction: (1) find or create the user with initial 0 points, (2) increment the user's points by the calculated amount, (3) create a transaction record linking the eventId, userId, amount, and points. This atomicity ensures the user's point balance always matches the sum of their transactions, even if errors occur mid-process.

### Utilities

#### `src/utils/config.ts`

Manages environment variable configuration with type-safe validation using Zod. It defines a schema for all required configuration: database URL, Redis URL, server port/environment, webhook secret, loyalty points rate, queue settings, and log level. The validation happens at startup. If any required variable is missing or invalid, the application exits with a clear error message before processing any requests. This fail-fast approach prevents runtime errors from misconfiguration. Default values are provided for optional settings like port (3000) and points rate (1).

#### `src/utils/logger.ts`

Sets up the Pino structured logger with environment-specific configuration. In development, it uses `pino-pretty` for human-readable colored output. In production, it outputs JSON logs for log aggregation systems like ELK or Datadog. Structured logging includes contextual fields (eventId, userId, jobId) in each log entry, making it easy to trace requests through the entire processing pipeline.

#### `src/utils/verifySignature.ts`

Implements HMAC SHA-256 signature verification for webhook security. The `verifyWebhookSignature` function expects a signature in the format "sha256=hexhash", validates the format, computes the expected HMAC using the configured secret, and performs a timing-safe comparison using `crypto.timingSafeEqual` to prevent timing attacks. The companion `generateWebhookSignature` function is used in tests to create valid signatures. This security measure prevents unauthorized parties from submitting fake webhooks.

### Database

#### `prisma/schema.prisma`

Defines the PostgreSQL database schema with three models: **User** stores user account information with points balance (default 0), supporting optional email and name fields. The `id` field uses CUID for universally unique identifiers. **Event** records each webhook received, with a unique constraint on `eventId` to enforce idempotency at the database level. It tracks processing status (pending/processed/failed), attempt count, and timestamps. **Transaction** represents each loyalty point award, storing the eventId (for duplicate checks), userId (foreign key to User), payment amount in cents, and points awarded. The schema includes an index on userId for efficient transaction queries and enforces referential integrity between transactions and users.

#### `src/db/client.ts` & `src/db/index.ts`

Simple re-exports of the Prisma client instance, providing a centralized database access point. The Prisma client is a singleton that manages database connections with connection pooling.

### Type Definitions

#### `src/types/*.ts`

TypeScript type definitions organized by domain: `config.types.ts` (application configuration), `queue.types.ts` (BullMQ job payloads), `loyalty.types.ts` (loyalty service interfaces), `webhook.types.ts` (webhook request/response shapes), `api.types.ts` (REST API responses). The `index.ts` barrel file re-exports all types for convenient importing. These types provide compile-time safety and enable excellent IDE autocomplete, reducing bugs from typos or incorrect data structures.

### Testing

#### `test-idempotency.ts`

An end-to-end integration test that validates the system's idempotency guarantees. The test performs cleanup of previous test data, generates a unique eventId using timestamp, sends the same webhook twice with valid HMAC signatures, waits for worker processing, and verifies that: (1) the first request returns 202 (queued), (2) the second request returns 200 (duplicate detected), (3) exactly 100 points are awarded (not 200), and (4) exactly 1 transaction is created (not 2). This test exercises the entire system including signature verification, database constraints, queue processing, and service-layer duplicate detection. It provides confidence that duplicate webhooks will never result in duplicate point awards.

---

## Design Decisions & Trade-offs

### Why Implement Two-Layer Idempotency?

The system implements idempotency at two distinct layers: the webhook layer (Event table unique constraint) and the service layer (Transaction existence check). **The first layer (Event table)** provides fast rejection of duplicate webhooks before they reach the queue, preventing unnecessary job creation and reducing Redis load. However, database unique constraints alone aren't sufficient for race conditions where two identical webhooks arrive simultaneously on different server instances—both might pass the constraint check before either commits. **The second layer (Transaction check)** acts as a safety net, ensuring that even if duplicate jobs somehow enter the queue, the loyalty service will detect the existing transaction and return early without awarding duplicate points. This defense-in-depth approach prioritizes correctness over efficiency, which is appropriate for financial data where accuracy is non-negotiable.

### Why Use BullMQ for Asynchronous Processing?

Webhooks must respond quickly (typically within 5 seconds) to avoid timeout-triggered retries from the sending system. Processing loyalty points involves multiple database queries and potential external API calls (not implemented but anticipated), which could exceed this timeout window. **BullMQ decouples webhook reception from processing**: the webhook endpoint acknowledges receipt immediately with 202 Accepted, while actual processing happens asynchronously. This architecture provides several benefits: (1) webhook senders receive fast responses preventing premature retries, (2) the worker can be scaled independently from the web server to handle processing load, (3) built-in retry logic with exponential backoff handles transient failures gracefully, (4) jobs persist in Redis even if the worker crashes, preventing data loss. The trade-off is increased system complexity (requiring Redis) and eventual consistency (points aren't awarded immediately), but these are acceptable for the reliability gains.

### Why Use Atomic Database Transactions?

The loyalty service wraps user creation, point incrementation, and transaction creation in a Prisma `$transaction` block, making these operations atomic. **Without atomicity**, a failure after incrementing points but before creating the transaction record would result in "phantom points": points in the user's balance with no corresponding transaction history. This breaks accounting invariants and makes auditing impossible. **With atomicity**, either all operations succeed together or none do, maintaining the invariant that `user.points === sum(transactions.points)`. The trade-off is slightly lower performance (transactions hold locks longer) and potential for deadlocks under high concurrency, but these risks are mitigated by proper indexing and connection pooling. The correctness guarantee is worth the performance cost.

### Why HMAC SHA-256 for Webhook Signatures?

Webhooks are public HTTP endpoints accessible to anyone on the internet, creating a security risk: malicious actors could submit fake payment events to award themselves points fraudulently. **HMAC (Hash-based Message Authentication Code) signatures** provide cryptographic verification that webhooks originate from the legitimate payment provider. The payment provider signs each webhook payload with a shared secret using SHA-256, and our service verifies the signature matches before processing. The `crypto.timingSafeEqual` function prevents timing attacks where an attacker measures response times to guess the signature byte-by-byte. This is a standard approach used by Stripe, GitHub, and other webhook providers. The trade-off is operational complexity (secret key management) and a slight performance cost, but this is necessary for financial system security.

### Why Zod for Runtime Validation?

TypeScript provides compile-time type checking, but HTTP requests arrive at runtime with no guarantees about data structure. Malformed payloads could cause crashes or incorrect processing. **Zod provides runtime schema validation** that bridges the gap: it validates incoming data matches expected types and structure, returning clear error messages for invalid payloads. The validated data is automatically typed for TypeScript, eliminating redundancy between validation and types. We chose Zod over alternatives like Joi or Yup because of its superior TypeScript integration and ability to infer static types from schemas. The trade-off is validation overhead for each request, but this is negligible compared to I/O operations and worth the reliability.

---

## Setup & Usage

### Prerequisites

- Node.js >= 20.0.0
- PostgreSQL database
- Redis server

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/loyalty_webhook_db"
REDIS_URL="redis://localhost:6379"
WEBHOOK_SECRET="your-super-secret-hmac-key-change-this-in-production"
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
```

### Installation & Database Setup

```bash
npm install
npx prisma migrate dev    # Creates database tables
npx prisma generate       # Generates Prisma client
```

### Running the Service

```bash
npm run dev        # Start API server (Terminal 1)
npm run worker     # Start worker process (Terminal 2)
```

### Testing Idempotency

```bash
npm run test:idempotency   # Runs end-to-end idempotency test
```

### API Endpoints

- `POST /webhooks/payment` - Process payment webhook (requires signature)
- `GET /users/:id` - Get user points balance
- `GET /transactions?userId=:userId` - List user transactions
- `GET /health` - Health check (database + Redis)
- `GET /metrics` - Prometheus metrics

---

## Observability

The service provides observability through:

- **Structured Logging**: Pino JSON logs with request IDs for tracing
- **Health Checks**: `/health` endpoint for load balancer probes
- **Metrics**: Prometheus metrics at `/metrics` for Grafana dashboards
- **Event Status**: Event table tracks processing attempts and failures

Monitor `queue_size` metric to detect processing bottlenecks and `job_processing_duration_seconds` histogram to identify performance degradation.

---

**Built with precision for reliability, security, and scalability.**
