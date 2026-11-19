ALTER TABLE orders ADD COLUMN "cancelledAt" TIMESTAMPTZ(3), ADD COLUMN "cancelReason" TEXT;
CREATE INDEX stock_reservations_balanceId_status_idx ON stock_reservations ("balanceId", status);
CREATE SEQUENCE docklane_order_number_seq START WITH 10001;
SELECT setval('docklane_order_number_seq', GREATEST(10000, COALESCE(MAX(SUBSTRING(number FROM '^DL-([0-9]+)$')::bigint), 0)), true) FROM orders;
