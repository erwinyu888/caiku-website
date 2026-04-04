/*
  # Add Orders and Inventory Management

  1. Schema Changes
    - Add `stock` column to `wallpapers` table
    - Drop `cart_items` table (no longer needed)
    - Create `orders` table for order management
      - `id` (uuid, primary key)
      - `order_number` (text, unique) - Auto-generated order number
      - `customer_name` (text) - Customer name
      - `customer_email` (text) - Customer email
      - `customer_phone` (text) - Customer phone number
      - `customer_company` (text) - Customer company
      - `wallpaper_id` (uuid) - Reference to wallpaper
      - `wallpaper_title` (text) - Snapshot of wallpaper title
      - `quantity` (integer) - Order quantity
      - `status` (text) - Order status (pending, confirmed, completed, cancelled)
      - `notes` (text) - Additional notes
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on orders table
    - Public can insert orders
    - Only authenticated users can view and manage orders
*/

-- Add stock column to wallpapers table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'wallpapers' AND column_name = 'stock'
  ) THEN
    ALTER TABLE wallpapers ADD COLUMN stock integer DEFAULT 0 NOT NULL;
  END IF;
END $$;

-- Drop cart_items table if it exists
DROP TABLE IF EXISTS cart_items;

-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text UNIQUE NOT NULL,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text DEFAULT '' NOT NULL,
  customer_company text DEFAULT '' NOT NULL,
  wallpaper_id uuid NOT NULL REFERENCES wallpapers(id) ON DELETE RESTRICT,
  wallpaper_title text NOT NULL,
  quantity integer DEFAULT 1 NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  notes text DEFAULT '' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_customer_email ON orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_orders_wallpaper_id ON orders(wallpaper_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- Enable Row Level Security
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- RLS Policies for orders
CREATE POLICY "Anyone can insert orders"
  ON orders FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Authenticated users can view all orders"
  ON orders FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update orders"
  ON orders FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete orders"
  ON orders FOR DELETE
  TO authenticated
  USING (true);

-- Function to generate order number
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS text AS $$
DECLARE
  new_order_number text;
  order_exists boolean;
BEGIN
  LOOP
    new_order_number := 'ORD-' || to_char(now(), 'YYYYMMDD') || '-' || LPAD(floor(random() * 10000)::text, 4, '0');
    
    SELECT EXISTS(SELECT 1 FROM orders WHERE order_number = new_order_number) INTO order_exists;
    
    IF NOT order_exists THEN
      EXIT;
    END IF;
  END LOOP;
  
  RETURN new_order_number;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate order number
CREATE OR REPLACE FUNCTION set_order_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
    NEW.order_number := generate_order_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_order_number ON orders;
CREATE TRIGGER trigger_set_order_number
  BEFORE INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION set_order_number();
