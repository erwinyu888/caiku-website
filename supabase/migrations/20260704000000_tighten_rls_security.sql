/*
  # 收緊 RLS 安全性

  修正 20260323000000_fix_anon_order_policies.sql 開放過寬的問題：
  先前任何匿名訪客都能 SELECT 所有訂單（含客戶個資）、UPDATE 任意訂單、
  UPDATE/DELETE 任意 order_items。

  1. 移除 orders / order_items 的匿名 SELECT / UPDATE / DELETE policy
     - 保留匿名 INSERT（前台結帳需要）
     - 管理端操作走既有的 authenticated policies
  2. 新增 lookup_orders() RPC（SECURITY DEFINER）
     - 訂單查詢改為參數化比對 Email / 電話，只回傳該客戶自己的訂單
     - 同時修正原本 .or() 字串拼接的 PostgREST 注入漏洞
  3. 動態移除 wallpapers / categories 上任何 anon 可寫的 policy，
     確保只有 authenticated 能寫入；並移除 customers / contact_messages
     上任何 anon policy（前台完全不使用這兩張表）
  4. product_image bucket 加上檔案大小與 MIME 類型限制
*/

-- ─── 1. orders：收回匿名 SELECT / UPDATE ───
DROP POLICY IF EXISTS "Anyone can view own orders" ON orders;
DROP POLICY IF EXISTS "Anyone can update own order" ON orders;

-- order_items：收回匿名 SELECT / UPDATE / DELETE（保留 INSERT 供結帳）
DROP POLICY IF EXISTS "Anyone can view order_items" ON order_items;
DROP POLICY IF EXISTS "Anyone can update order_items" ON order_items;
DROP POLICY IF EXISTS "Anyone can delete order_items" ON order_items;

-- ─── 2. 訂單查詢 RPC：參數化、只回傳比對到的訂單 ───
CREATE OR REPLACE FUNCTION public.lookup_orders(contact text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(order_row ORDER BY order_created DESC), '[]'::jsonb)
  FROM (
    SELECT
      o.created_at AS order_created,
      to_jsonb(o) || jsonb_build_object(
        'order_items',
        coalesce((
          SELECT jsonb_agg(
            to_jsonb(oi) || jsonb_build_object(
              'wallpaper',
              CASE WHEN w.id IS NULL THEN NULL
                   ELSE jsonb_build_object('title', w.title, 'spec', w.spec, 'image_url', w.image_url)
              END
            )
          )
          FROM order_items oi
          LEFT JOIN wallpapers w ON w.id = oi.wallpaper_id
          WHERE oi.order_id = o.id
        ), '[]'::jsonb)
      ) AS order_row
    FROM orders o
    WHERE lower(o.customer_email) = lower(btrim(contact))
       OR o.customer_phone = btrim(contact)
  ) sub;
$$;

REVOKE ALL ON FUNCTION public.lookup_orders(text) FROM public;
GRANT EXECUTE ON FUNCTION public.lookup_orders(text) TO anon, authenticated;

-- ─── 3. wallpapers / categories：移除任何 anon 可寫的 policy ───
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('wallpapers', 'categories')
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND (roles = '{public}' OR 'anon' = ANY(roles))
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

-- 確保前台仍可讀取、管理端（authenticated）可寫入
DROP POLICY IF EXISTS "Public can view wallpapers" ON wallpapers;
CREATE POLICY "Public can view wallpapers"
  ON wallpapers FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage wallpapers" ON wallpapers;
CREATE POLICY "Authenticated users can manage wallpapers"
  ON wallpapers FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public can view categories" ON categories;
CREATE POLICY "Public can view categories"
  ON categories FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage categories" ON categories;
CREATE POLICY "Authenticated users can manage categories"
  ON categories FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- customers / contact_messages：前台完全不使用，全部收為 authenticated-only
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('customers', 'contact_messages')
      AND (roles = '{public}' OR 'anon' = ANY(roles))
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'customers') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can manage customers" ON customers';
    EXECUTE 'CREATE POLICY "Authenticated users can manage customers"
      ON customers FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'contact_messages') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Authenticated users can manage contact_messages" ON contact_messages';
    EXECUTE 'CREATE POLICY "Authenticated users can manage contact_messages"
      ON contact_messages FOR ALL TO authenticated USING (true) WITH CHECK (true)';
  END IF;
END $$;

-- ─── 4. Storage：product_image bucket 限制大小與類型，寫入限 authenticated ───
UPDATE storage.buckets
SET file_size_limit = 5242880,  -- 5MB
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
WHERE id = 'product_image';

DO $$
DECLARE p record;
BEGIN
  -- 移除 storage.objects 上 anon 可寫的 policy（本專案只有 product_image 一個 bucket）
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND (roles = '{public}' OR 'anon' = ANY(roles))
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', p.policyname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Authenticated users can upload product images" ON storage.objects;
CREATE POLICY "Authenticated users can upload product images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product_image');

DROP POLICY IF EXISTS "Authenticated users can update product images" ON storage.objects;
CREATE POLICY "Authenticated users can update product images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'product_image') WITH CHECK (bucket_id = 'product_image');

DROP POLICY IF EXISTS "Authenticated users can delete product images" ON storage.objects;
CREATE POLICY "Authenticated users can delete product images"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'product_image');
