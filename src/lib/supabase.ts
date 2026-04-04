import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export interface ProductVariant {
  id: string;
  wallpaper_id: string;
  spec: string;
  thickness: string;
  cost_per_piece?: number;
  price_per_piece?: number;
  stock: number;
  sort_order: number;
}

export interface Wallpaper {
  id: string;
  product_code?: string;
  title: string;
  category: string;
  image_url: string;
  image_urls?: string[];
  stock: number;          // 保留相容舊資料，新系統用 variants
  is_active: boolean;
  spec?: string;
  thickness?: string;
  cost_per_m2?: number;
  cost_per_piece?: number;
  price_per_piece?: number;
  variants?: ProductVariant[];
  created_at: string;
  updated_at: string;
}

export interface CartItem {
  wallpaper: Wallpaper;
  quantity: number;
}

export interface OrderItem {
  id: string;
  order_id: string;
  wallpaper_id: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  created_at: string;
  wallpaper?: Wallpaper;
}

export interface Order {
  id: string;
  order_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  customer_company: string;
  status: string;
  notes: string;
  total_amount: number;
  quote_number?: string;
  created_at: string;
  updated_at: string;
  order_items?: OrderItem[];
}
