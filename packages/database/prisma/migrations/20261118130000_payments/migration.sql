ALTER TABLE orders ADD COLUMN "confirmedAt" timestamptz(3), ADD COLUMN "expiredAt" timestamptz(3);
ALTER TABLE payments ADD COLUMN "sessionId" text, ADD COLUMN "checkoutUrl" text,
  ADD COLUMN "sessionExpiresAt" timestamptz(3), ADD COLUMN "providerRequest" jsonb,
  ADD COLUMN "lastReconciledAt" timestamptz(3);
CREATE UNIQUE INDEX payments_session_id_key ON payments ("sessionId");
ALTER TABLE outbox_events ADD COLUMN "businessId" text, ADD COLUMN "lockedAt" timestamptz(3),
  ADD COLUMN "leaseToken" uuid, ADD COLUMN "lastErrorCode" text;
UPDATE outbox_events SET "businessId" = payload->>'businessId' WHERE payload ? 'businessId';
