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

export async function uploadProductImage(file: File): Promise<string> {
  const timestamp = Date.now();

  // 從檔案名稱提取副檔名
  const ext = file.name.split('.').pop() || 'jpg';

  // 生成安全的檔案名稱（只用時間戳 + 隨機數）
  const randomId = Math.random().toString(36).substring(2, 8);
  const fileName = `${timestamp}-${randomId}.${ext}`;

  const { data, error } = await supabase.storage
    .from('product_image')
    .upload(fileName, file);

  if (error) {
    throw new Error(`Supabase 上傳失敗: ${error.message}`);
  }

  if (!data) {
    throw new Error('上傳成功但未取得檔案資訊');
  }

  const { data: urlData } = supabase.storage
    .from('product_image')
    .getPublicUrl(fileName);

  if (!urlData?.publicUrl) {
    throw new Error('無法取得公開網址');
  }

  return urlData.publicUrl;
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
