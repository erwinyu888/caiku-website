/*
  # Add Customers Table for CRM

  1. New Tables
    - `customers`
      - `id` (uuid, primary key)
      - `name` (text) - Customer's display name
      - `email` (text) - Primary contact email
      - `phone` (text) - Primary contact phone
      - `company` (text) - Company name
      - `notes` (text) - Internal notes from admin
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS
    - Authenticated users can fully manage customers
    - Anon users can read (for order lookup matching)
*/

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text DEFAULT '' NOT NULL,
  phone text DEFAULT '' NOT NULL,
  company text DEFAULT '' NOT NULL,
  notes text DEFAULT '' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email) WHERE email != '';
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone) WHERE phone != '';
CREATE INDEX IF NOT EXISTS idx_customers_name  ON customers(name);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT ON TABLE public.customers TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customers TO authenticated;

CREATE POLICY "Authenticated users can manage customers"
  ON customers FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can view customers"
  ON customers FOR SELECT
  USING (true);
