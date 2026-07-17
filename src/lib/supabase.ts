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

// 只允許真正的圖片類型，副檔名由 MIME 決定，避免上傳 HTML/SVG 到公開 bucket
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
};
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB，與 bucket 的 file_size_limit 一致

// 上傳前壓縮：最長邊縮到 1600px、轉 JPEG 品質 0.82。
// 產品圖在網頁上顯示綽綽有餘，手機拍的 5MB 照片通常會壓到 300KB 以下
const MAX_DIMENSION = 1600;
const COMPRESS_QUALITY = 0.82;

async function compressImage(file: File): Promise<Blob> {
  if (file.type === 'image/gif') return file; // GIF 可能是動圖，壓縮會失去動畫

  try {
    // imageOrientation: 'from-image' 讓手機照片依 EXIF 自動轉正
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#ffffff'; // 透明背景補白底（轉 JPEG 後透明區域才不會變黑）
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', COMPRESS_QUALITY)
    );
    // 壓縮失敗或壓完反而更大（例如原本就是小圖）就用原檔
    if (!blob || blob.size >= file.size) return file;
    return blob;
  } catch {
    return file; // 壓縮出錯不擋上傳，改用原檔
  }
}

export async function uploadProductImage(file: File): Promise<string> {
  if (!ALLOWED_IMAGE_TYPES[file.type]) {
    throw new Error('僅支援 JPG、PNG、WebP、GIF 圖片格式');
  }

  const compressed = await compressImage(file);
  const contentType = compressed.type || file.type;
  const ext = ALLOWED_IMAGE_TYPES[contentType] || 'jpg';

  if (compressed.size > MAX_IMAGE_SIZE) {
    throw new Error('圖片壓縮後仍超過 5MB，請改用較小的圖片');
  }

  const timestamp = Date.now();

  // 生成安全的檔案名稱（只用時間戳 + 隨機數）
  const randomId = Math.random().toString(36).substring(2, 8);
  const fileName = `${timestamp}-${randomId}.${ext}`;

  const { data, error } = await supabase.storage
    .from('product_image')
    .upload(fileName, compressed, { contentType });

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
