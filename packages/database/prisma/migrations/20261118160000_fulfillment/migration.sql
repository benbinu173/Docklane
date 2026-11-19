ALTER TABLE orders ADD COLUMN "packedAt" timestamptz(3);
ALTER TABLE shipments ADD COLUMN "trackingUrl" text, ADD COLUMN reason text NOT NULL DEFAULT 'Order fulfillment';
ALTER TABLE refund_attempts ADD COLUMN purpose text NOT NULL DEFAULT 'ADMIN',
  ADD COLUMN "lastReconciledAt" timestamptz(3), ADD COLUMN "resolvedAt" timestamptz(3);
UPDATE refund_attempts SET purpose = 'LATE_PAYMENT' WHERE "providerIdempotencyKey" LIKE 'late-payment:%';
UPDATE refund_attempts SET "resolvedAt" = "updatedAt" WHERE status IN ('SUCCEEDED', 'FAILED');
ALTER TABLE refund_attempts ADD CONSTRAINT refund_attempts_purpose_check CHECK (purpose IN ('ADMIN', 'CANCELLATION', 'LATE_PAYMENT'));
CREATE INDEX "return_receipts_orderId_receivedAt_idx" ON return_receipts ("orderId", "receivedAt");
CREATE INDEX "audit_events_businessId_entityType_entityId_createdAt_idx" ON audit_events ("businessId", "entityType", "entityId", "createdAt");
