/*
  # Remove wallpaper_title column from orders table

  1. Changes
    - Remove wallpaper_title column from orders table since order items are now stored in the order_items table
  
  2. Notes
    - This is a cleanup migration to remove the unused column
    - All product information is now accessed through the order_items relationship
*/

ALTER TABLE orders DROP COLUMN IF EXISTS wallpaper_title;