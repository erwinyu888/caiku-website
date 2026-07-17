/*
  # 庫存記帳統一由資料庫觸發器處理 + 原子化結帳 RPC

  修正的問題：
  1. 後台編輯訂單項目（改數量／刪項目）不會調整庫存
  2. 前端用過期的本地資料覆寫庫存（read-modify-write 競態，
     會把客人剛下單扣掉的庫存蓋回去）
  3. 結帳無防超賣（舊觸發器用 GREATEST(0, ...) 靜默夾到 0）
  4. 訂單寫入一半失敗會留下沒有項目的空訂單
  5. 單價／小計／總額由客戶端計算，可被偽造

  庫存模型（單一事實來源）：
  - 訂單成立即扣庫存（含 pending「待確認」狀態）
  - 只有 cancelled「已取消」狀態不佔庫存
  - 所有庫存增減一律由本檔案的觸發器處理，前端不再手動調整

  前端配套（同一次部署）：
  - 結帳改呼叫 create_order() RPC
  - 後台移除所有手動調庫存的程式碼
*/

-- ═══════════════════════════════════════════════════════════
-- 1. order_items INSERT：扣庫存（已取消訂單不扣；不足時報錯防超賣）
--    取代 20260323000000 的舊版（舊版用 GREATEST 靜默夾 0）
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION decrement_wallpaper_stock()
RETURNS TRIGGER AS $$
DECLARE
  ord_status text;
  wp_title text;
BEGIN
  SELECT status INTO ord_status FROM orders WHERE id = NEW.order_id;
  IF ord_status = 'cancelled' THEN
    RETURN NEW;  -- 已取消訂單不佔庫存
  END IF;

  UPDATE wallpapers
  SET stock = stock - NEW.quantity
  WHERE id = NEW.wallpaper_id AND stock >= NEW.quantity;

  IF NOT FOUND THEN
    SELECT title INTO wp_title FROM wallpapers WHERE id = NEW.wallpaper_id;
    RAISE EXCEPTION '「%」庫存不足', coalesce(wp_title, NEW.wallpaper_id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_decrement_stock ON order_items;
CREATE TRIGGER trigger_decrement_stock
  AFTER INSERT ON order_items
  FOR EACH ROW
  EXECUTE FUNCTION decrement_wallpaper_stock();

-- ═══════════════════════════════════════════════════════════
-- 2. order_items UPDATE：數量（或產品）變更時自動補差額
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION adjust_stock_on_item_update()
RETURNS TRIGGER AS $$
DECLARE
  ord_status text;
  wp_title text;
BEGIN
  IF NEW.quantity = OLD.quantity AND NEW.wallpaper_id = OLD.wallpaper_id THEN
    RETURN NEW;
  END IF;

  SELECT status INTO ord_status FROM orders WHERE id = NEW.order_id;
  IF ord_status = 'cancelled' THEN
    RETURN NEW;  -- 已取消訂單的項目變更不影響庫存
  END IF;

  -- 先加回舊的，再扣新的（同時支援改數量與換產品；失敗時整筆交易回滾）
  UPDATE wallpapers SET stock = stock + OLD.quantity WHERE id = OLD.wallpaper_id;

  UPDATE wallpapers
  SET stock = stock - NEW.quantity
  WHERE id = NEW.wallpaper_id AND stock >= NEW.quantity;

  IF NOT FOUND THEN
    SELECT title INTO wp_title FROM wallpapers WHERE id = NEW.wallpaper_id;
    RAISE EXCEPTION '「%」庫存不足', coalesce(wp_title, NEW.wallpaper_id::text);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_adjust_stock_on_item_update ON order_items;
CREATE TRIGGER trigger_adjust_stock_on_item_update
  AFTER UPDATE ON order_items
  FOR EACH ROW
  EXECUTE FUNCTION adjust_stock_on_item_update();

-- ═══════════════════════════════════════════════════════════
-- 3. order_items DELETE：加回庫存
--    父訂單已取消 → 不加回（取消當下已加回過）
--    父訂單不存在（整單刪除的 cascade）→ 加回；
--    「刪除已取消訂單」的情境由第 5 節的 orders BEFORE DELETE
--    觸發器先行刪除項目（當時父訂單還在、狀態為 cancelled，
--    所以這裡會正確跳過），cascade 到此已無項目可刪
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION restore_stock_on_item_delete()
RETURNS TRIGGER AS $$
DECLARE
  ord_status text;
BEGIN
  SELECT status INTO ord_status FROM orders WHERE id = OLD.order_id;
  IF ord_status = 'cancelled' THEN
    RETURN OLD;
  END IF;
  UPDATE wallpapers SET stock = stock + OLD.quantity WHERE id = OLD.wallpaper_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_restore_stock_on_item_delete ON order_items;
CREATE TRIGGER trigger_restore_stock_on_item_delete
  AFTER DELETE ON order_items
  FOR EACH ROW
  EXECUTE FUNCTION restore_stock_on_item_delete();

-- ═══════════════════════════════════════════════════════════
-- 4. orders 狀態變更：進出「已取消」時整單加回／重扣
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION adjust_stock_on_order_status()
RETURNS TRIGGER AS $$
DECLARE
  r record;
  wp_title text;
BEGIN
  IF OLD.status <> 'cancelled' AND NEW.status = 'cancelled' THEN
    -- 取消訂單：整單加回
    UPDATE wallpapers w
    SET stock = w.stock + oi.qty
    FROM (
      SELECT wallpaper_id, sum(quantity) AS qty
      FROM order_items WHERE order_id = NEW.id GROUP BY wallpaper_id
    ) oi
    WHERE w.id = oi.wallpaper_id;

  ELSIF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    -- 恢復已取消的訂單：重新扣庫存（不足時報錯、整筆回滾）
    FOR r IN
      SELECT wallpaper_id, sum(quantity) AS qty
      FROM order_items WHERE order_id = NEW.id GROUP BY wallpaper_id
    LOOP
      UPDATE wallpapers
      SET stock = stock - r.qty
      WHERE id = r.wallpaper_id AND stock >= r.qty;

      IF NOT FOUND THEN
        SELECT title INTO wp_title FROM wallpapers WHERE id = r.wallpaper_id;
        RAISE EXCEPTION '「%」庫存不足，無法將訂單移出已取消狀態', coalesce(wp_title, r.wallpaper_id::text);
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_adjust_stock_on_order_status ON orders;
CREATE TRIGGER trigger_adjust_stock_on_order_status
  AFTER UPDATE OF status ON orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION adjust_stock_on_order_status();

-- ═══════════════════════════════════════════════════════════
-- 5. orders DELETE：已取消的訂單庫存已加回過，
--    趁父訂單還在時先刪項目（讓第 3 節觸發器看到 cancelled 而跳過加回）；
--    其他狀態交給 cascade → 第 3 節觸發器自動加回
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION handle_order_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'cancelled' THEN
    DELETE FROM order_items WHERE order_id = OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_handle_order_delete ON orders;
CREATE TRIGGER trigger_handle_order_delete
  BEFORE DELETE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION handle_order_delete();

-- ═══════════════════════════════════════════════════════════
-- 6. create_order RPC：原子化結帳
--    - 單一交易：訂單＋項目要嘛全部成立、要嘛全部失敗（修問題 4）
--    - 價格一律以資料庫的 price_per_piece 計算（修問題 5）
--    - FOR UPDATE 鎖行＋觸發器雙重防超賣（修問題 3）
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_order(
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_customer_company text,
  p_notes text,
  p_items jsonb  -- 格式：[{"wallpaper_id": "uuid", "quantity": 3}, ...]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid := gen_random_uuid();
  v_order_number text := 'QT-' || (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_total numeric := 0;
  v_item jsonb;
  v_wid uuid;
  v_qty int;
  v_price numeric;
  v_title text;
  v_stock int;
BEGIN
  IF p_customer_name IS NULL OR btrim(p_customer_name) = ''
     OR p_customer_email IS NULL OR btrim(p_customer_email) = ''
     OR p_customer_phone IS NULL OR btrim(p_customer_phone) = '' THEN
    RAISE EXCEPTION '缺少必填的聯絡資訊';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '訂單至少需要一個項目';
  END IF;
  IF jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION '訂單項目過多';
  END IF;

  INSERT INTO orders (id, order_number, customer_name, customer_email,
                      customer_phone, customer_company, notes, status, total_amount)
  VALUES (v_order_id, v_order_number, btrim(p_customer_name), btrim(p_customer_email),
          btrim(p_customer_phone), coalesce(p_customer_company, ''),
          coalesce(p_notes, ''), 'pending', 0);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_wid := (v_item->>'wallpaper_id')::uuid;
    v_qty := (v_item->>'quantity')::int;
    IF v_wid IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION '商品數量不正確';
    END IF;

    SELECT title, stock, coalesce(price_per_piece, 0)
    INTO v_title, v_stock, v_price
    FROM wallpapers
    WHERE id = v_wid AND is_active = true
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION '找不到商品或商品已下架';
    END IF;
    IF v_stock < v_qty THEN
      RAISE EXCEPTION '「%」庫存不足（剩餘 %）', v_title, v_stock;
    END IF;

    -- 觸發器（第 1 節）在此自動扣庫存
    INSERT INTO order_items (order_id, wallpaper_id, quantity, unit_price, subtotal)
    VALUES (v_order_id, v_wid, v_qty, v_price, v_price * v_qty);

    v_total := v_total + v_price * v_qty;
  END LOOP;

  UPDATE orders SET total_amount = v_total WHERE id = v_order_id;

  RETURN jsonb_build_object('order_number', v_order_number, 'total_amount', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.create_order(text, text, text, text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.create_order(text, text, text, text, text, jsonb) TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════
-- 7. 收回 anon 對 orders / order_items 的直接 INSERT
--    （結帳一律走 create_order RPC，杜絕偽造價格與塞單；
--     後台 authenticated 的政策不受影響）
-- ═══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Anyone can insert orders" ON orders;
DROP POLICY IF EXISTS "Anyone can insert order_items" ON order_items;
