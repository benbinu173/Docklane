-- Catalog pages aggregate stock for a small SKU set across warehouses.
-- The warehouse/SKU uniqueness index cannot efficiently serve SKU-only lookups.
-- Run outside a transaction so existing inventory writes remain available.
CREATE INDEX CONCURRENTLY "inventory_balances_sku_idx" ON "inventory_balances" ("sku");
