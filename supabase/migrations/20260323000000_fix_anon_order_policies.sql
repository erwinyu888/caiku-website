/*
  # Fix anonymous user order policies

  1. Allow anonymous users to:
     - INSERT order_items (needed for customer checkout)
     - SELECT orders (needed for order lookup by email/phone)
     - SELECT order_items (needed for order lookup)
     - UPDATE orders (needed for customer to update notes)
     - UPDATE/DELETE order_items (needed for customer to modify pending order items)

  2. Add stock decrement trigger
     - Automatically decrements wallpaper stock when order_item is inserted
     - Uses SECURITY DEFINER so it runs with elevated privileges
*/

-- ─── orders: allow anyone to SELECT (app filters by email/phone) ───
DROP POLICY IF EXISTS "Anyone can view own orders" ON orders;
CREATE POLICY "Anyone can view own orders"
  ON orders FOR SELECT
  USING (true);

-- ─── orders: allow anyone to UPDATE (for note editing by customer) ───
DROP POLICY IF EXISTS "Anyone can update own order" ON orders;
CREATE POLICY "Anyone can update own order"
  ON orders FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- ─── order_items: allow anyone to INSERT (for checkout) ───
DROP POLICY IF EXISTS "Anyone can insert order_items" ON order_items;
CREATE POLICY "Anyone can insert order_items"
  ON order_items FOR INSERT
  WITH CHECK (true);

-- ─── order_items: allow anyone to SELECT (for order lookup) ───
DROP POLICY IF EXISTS "Anyone can view order_items" ON order_items;
CREATE POLICY "Anyone can view order_items"
  ON order_items FOR SELECT
  USING (true);

-- ─── order_items: allow anyone to UPDATE (for pending order modifications) ───
DROP POLICY IF EXISTS "Anyone can update order_items" ON order_items;
CREATE POLICY "Anyone can update order_items"
  ON order_items FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- ─── order_items: allow anyone to DELETE (for removing items from pending orders) ───
DROP POLICY IF EXISTS "Anyone can delete order_items" ON order_items;
CREATE POLICY "Anyone can delete order_items"
  ON order_items FOR DELETE
  USING (true);

-- ─── Auto-decrement wallpaper stock when order_item is inserted ───
CREATE OR REPLACE FUNCTION decrement_wallpaper_stock()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE wallpapers
  SET stock = GREATEST(0, stock - NEW.quantity)
  WHERE id = NEW.wallpaper_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_decrement_stock ON order_items;
CREATE TRIGGER trigger_decrement_stock
  AFTER INSERT ON order_items
  FOR EACH ROW
  EXECUTE FUNCTION decrement_wallpaper_stock();
