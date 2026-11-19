ALTER TABLE products ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE warehouses ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_balances ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_movements ADD COLUMN "balanceVersion" INTEGER;
CREATE UNIQUE INDEX "inventory_movements_balanceId_balanceVersion_key" ON inventory_movements("balanceId", "balanceVersion");
ALTER TABLE products ADD CONSTRAINT products_version_check CHECK (version >= 0);
ALTER TABLE warehouses ADD CONSTRAINT warehouses_version_priority_check CHECK (version >= 0 AND priority >= 0);
ALTER TABLE inventory_balances ADD CONSTRAINT inventory_balances_version_check CHECK (version >= 0);
ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_version_check CHECK ("balanceVersion" IS NULL OR "balanceVersion" > 0);
CREATE FUNCTION prevent_inventory_movement_rewrite() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Inventory movements are append-only; record a compensating adjustment instead.' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER inventory_movements_append_only BEFORE UPDATE OR DELETE ON inventory_movements
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_movement_rewrite();
