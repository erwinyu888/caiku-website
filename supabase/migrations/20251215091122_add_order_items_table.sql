/*
  # Add order items support for multi-product orders

  1. New Tables
    - `order_items`
      - `id` (uuid, primary key) - Unique identifier for each order item
      - `order_id` (uuid, foreign key) - References the parent order
      - `wallpaper_id` (uuid, foreign key) - References the wallpaper product
      - `quantity` (integer) - Quantity of this item
      - `created_at` (timestamptz) - When the item was added
  
  2. Changes
    - Migrate existing order data to order_items table
    - Remove wallpaper_id and quantity columns from orders table
  
  3. Security
    - Enable RLS on order_items table
    - Add policies for authenticated admin users to manage order items
    
  4. Notes
    - This migration preserves all existing order data
    - Each existing order will have one corresponding order item created
    - After migration, orders can have multiple items
*/

-- Create order_items table
CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  wallpaper_id uuid NOT NULL REFERENCES wallpapers(id) ON DELETE RESTRICT,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at timestamptz DEFAULT now()
);

-- Migrate existing order data to order_items
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'orders' AND column_name = 'wallpaper_id'
  ) THEN
    INSERT INTO order_items (order_id, wallpaper_id, quantity, created_at)
    SELECT id, wallpaper_id, quantity, created_at
    FROM orders
    WHERE wallpaper_id IS NOT NULL;
    
    ALTER TABLE orders DROP COLUMN IF EXISTS wallpaper_id;
    ALTER TABLE orders DROP COLUMN IF EXISTS quantity;
  END IF;
END $$;

-- Enable RLS
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- Policies for order_items
CREATE POLICY "Authenticated users can view order items"
  ON order_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert order items"
  ON order_items FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update order items"
  ON order_items FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete order items"
  ON order_items FOR DELETE
  TO authenticated
  USING (true);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_wallpaper_id ON order_items(wallpaper_id);