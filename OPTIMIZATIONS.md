# 優化待辦清單

> 2026-07-04 全專案審查結果。安全性項目已修復（見文末「已完成」），
> 以下為尚未處理的項目，按優先順序排列。

## 🟠 高優先：資料正確性 Bug

### 1. 庫存調整非原子操作（AdminPage.tsx:458-545）
- `updateOrderStatus` / `handleUpdateOrder` / `deleteOrder` 逐筆 `update stock`，
  中途失敗（例如第 3 項庫存不足就 `return`）**前面已扣的庫存不會回滾**，訂單狀態也沒更新。
- `newStock` 用前端 state 的舊值計算，兩個管理員同時操作會互相覆蓋（lost update）。
- 多處 `await` 完全沒檢查 error，部分失敗靜默。
- **建議**：把「狀態變更 + 庫存增減」搬進 Postgres function（`supabase.rpc()`），
  用 `stock = stock + delta` 原子更新並在 SQL 內檢查 `stock >= 0`，包在 transaction 裡。

### 2. 編輯訂單時，項目數量變動完全不影響庫存（AdminPage.tsx:495-545）
- 庫存調整只在「取消⇄成立」狀態切換時觸發，且用的是編輯前快照。
- 已確認訂單把數量 1 改 5、新增項目，庫存完全不扣；刪除項目也不回補。
- **建議**：以「編輯前 vs 編輯後有效數量」的 diff 計算庫存增減，同樣走 RPC。

### 3. 下單流程仍非交易（app.tsx handleSubmitOrder）
- 已改為批次 insert + 檢查 error（安全修復時順手處理），但 orders 與 order_items
  仍是兩次請求：items 失敗時會留下孤兒訂單。
- 訂單編號 `QT-${Date.now()}` 同毫秒可能碰撞。
- **建議**：改成 `create_order` RPC（SECURITY DEFINER），單一交易寫入 order + items，
  金額/單價在 SQL 內以 `wallpapers.price_per_piece` 重新計算（不信任前端），
  訂單編號由 DB sequence 產生。

### 4. 新增的產品編輯後會遺失封面圖（AdminPage.tsx:907 附近）
- 新增時只寫 `image_url` 不寫 `image_urls` → 編輯 modal 圖片清單是空的 →
  按「更新」時 `coverUrl = imageUrlsArray[0] || ''` 把封面清成空字串。
- **修法**：編輯按鈕改 `setEditingImageUrls(((w.image_urls?.length ? w.image_urls : [w.image_url]).filter(Boolean)).join('\n'))`；
  新增時同步寫 `image_urls: [image_url]`。

### 5. 刪除產品/圖片不清理 Storage 檔案（AdminPage.tsx deleteWallpaper / deleteImage）
- 刪產品只刪 DB row，bucket 圖檔永久孤兒化；編輯時刪圖、上傳後取消也一樣。
- 確認 `order_items.wallpaper_id` FK 應為 `ON DELETE SET NULL`（保留歷史訂單）。
- **建議**：刪除時解析 storage path 呼叫 `storage.remove([...])`，或定期清理 job。

### 6. 錯誤處理普遍缺失、成功訊息誤報
- `handleMergeCustomers`（AdminPage.tsx:313-325）逐筆更新不檢查 error，一律 alert「合併完成」。
- fetch 系列失敗時畫面顯示「尚無產品/訂單」而非錯誤，誤導使用者。
- **建議**：每個 mutation 檢查 error；fetch 失敗顯示錯誤狀態 + 重試按鈕。

### 7. 表單無防重複送出
- 新增產品/客戶、編輯訂單的送出按鈕在 async 期間沒 disable，連點兩下重複寫入。
- **建議**：統一加 `isSubmitting` state。

### 8. 分類改名/刪除後產品變孤兒（AdminPage.tsx:393-415）
- wallpapers 用名稱字串存分類，改名後舊產品篩選失效；刪分類不警告底下還有產品。
- **短期**：改名時同步 `update wallpapers set category = new where category = old`；
  **長期**：改用 `category_id` FK。

## 🟡 效能

### 9. 846KB 單一 JS bundle
- recharts 只有後台 Dashboard 用，卻因 `app.tsx` 靜態 import AdminPage 讓每個前台訪客都下載。
- **修法**：`const AdminPage = React.lazy(() => import('./pages/AdminPage'))` + `<Suspense>`。
- **`xlsx` 套件裝了但完全沒用到** → 直接從 package.json 移除。

### 10. 巨型元件 + 無 memoization
- app.tsx（1571 行、~30 個 useState）、AdminPage.tsx（1558 行）：任何輸入打一個字全樹重繪。
- 篩選/分組（app.tsx:317-325）、`sortedWallpapers`/`derivedCustomers`/`unifiedCustomers`
  （AdminPage.tsx:156-268）每次 render 重算。
- **建議**：拆頁面元件（HomePage / ProductsPage / CartDrawer / 各 Tab / 各 Modal），
  昂貴計算包 `useMemo`，搜尋框加 debounce；資料層可考慮 TanStack Query。

### 11. 圖片無 lazy loading、無縮圖
- 產品格線一頁 16 張全載原圖，`<img>` 沒有 `loading="lazy"` / `decoding="async"`。
- **建議**：全部加 `loading="lazy"`；用 Supabase image transformation（`?width=400`）產縮圖。

### 12. 一次撈全表 + 前端假分頁
- `select('*')` 撈全部產品/訂單，訂單還在前端手動 join（O(N×M)）。
- **建議**：訂單改巢狀查詢 `orders.select('*, order_items(*, wallpapers(*))')`；
  量大後改 `.range()` 伺服器分頁。

### 13. 逐筆 await 的序列請求
- 合併客戶逐筆 update 訂單（改 `.in('id', ids)` 單一請求）、多張圖逐張上傳（可 `Promise.all` 或顯示進度）。

## 🔵 UX / 品質

14. **結帳表單驗證失效**（app.tsx:1400-1422）：`required`/`type="email"` 沒包在 `<form>` 裡不會觸發，
    亂填 email 導致之後查不到訂單。改 `<form onSubmit>` + email/電話格式檢查。
15. **購物車不持久化**：重新整理即清空，建議 localStorage 存 id+quantity。
16. **無 URL 路由**：無法分享連結、返回鍵失效、SEO 為零。導入 react-router 或 hash 路由。
17. **render 期間呼叫 setState**（app.tsx:313 `if (!isAuthenticated) { setShowAdmin(false); ... }`）：
    移到點擊「管理後台」時判斷，或放 useEffect。
18. **認證狀態只在掛載時檢查一次**：改訂閱 `supabase.auth.onAuthStateChange`。
19. **Toast 計時器互相干擾**（app.tsx:212-213）：連續加兩件商品第一個 timer 提早關掉第二個 toast；
    用 useRef 存 timer id，設定前先 clearTimeout。
20. **Modal 通病**：背景可捲動、無 ESC、無 focus trap、部分不能點背景關閉。抽共用 `<Modal>`。
21. **購物車庫存用加入當下快照**：送單前重查庫存；clamp 時 toast 應顯示「已達庫存上限」而非「已加入」。
22. **footer 點分類沒 resetPage**（app.tsx:1021）+ 資料刷新後 `page > totalPages` 會空白頁。
23. **數字輸入清空產生 NaN / 跳回 1**（AdminPage.tsx:692/727/1198、app.tsx:1509）：
    state 允許暫存空字串，blur 時再 clamp。
24. **全站 alert()/confirm()**：換 toast + 確認 dialog。
25. **列表用 index 當 key**（AdminPage.tsx:1131 等）：改用 id。
26. **新增產品表單不能上傳圖片**（只能貼 URL），上傳功能只在編輯 modal——動線不一致。
27. **訂單/訊息/客戶列表無分頁**，資料成長後會卡。
28. **重複程式碼**：LINE SVG 圖示 ×4、訂單狀態徽章 ×2、旋轉圖片 IIFE ×11（兩檔合計）、
    稅額三聯計算 ×3、品牌文案 ×2 → 各抽共用元件/常數。AdminPage import 了
    `wallpaper-utils` 四個函式卻沒用，毛利率公式又手寫兩份 → 統一改用工具函式。
29. **旋轉角度存在 URL fragment（`#r90`）寫進 DB**：脆弱設計，長期應上傳時用 canvas 實際旋轉。
30. **`any` 型別**（app.tsx lookupOrders 等）：改用 `lib/supabase.ts` 的 `Order`/`OrderItem`。
31. **雜項**：`index.html` `lang="tw_zh"` → `zh-Hant`；favicon 還是 Vite 預設；
    git 裡仍追蹤 5 個 dist/ 檔（`git rm -r --cached dist` 清掉）；`dist.zip` 加入 .gitignore；
    package.json version `1.1.0.0` 非合法 semver；縮圖 `<img>` 缺 alt；
    空的公告欄佔位 div（app.tsx:343）。

## ✅ 已完成（2026-07-04 安全性修復）

- **PostgREST 注入**：訂單查詢改用 `lookup_orders` RPC（參數化、SECURITY DEFINER）。
- **RLS 收緊**：新 migration `20260704000000_tighten_rls_security.sql` 移除 orders/order_items
  的匿名 SELECT/UPDATE/DELETE，wallpapers/categories 寫入限 authenticated，
  customers/contact_messages 全收為 authenticated-only，Storage 寫入限 authenticated。
  **⚠️ 需執行 `supabase db push`（或在 SQL editor 跑該 migration）後再部署前端。**
- **報價單 XSS**：`exportQuotePDF` 所有客戶輸入欄位經 `escapeHtml` 轉義。
- **上傳驗證**：`uploadProductImage` MIME 白名單（jpg/png/webp/gif）+ 5MB 上限 +
  副檔名由 MIME 決定 + bucket 層級 `allowed_mime_types`/`file_size_limit`。
- **`.env` 移出 git**：`git rm --cached .env` + .gitignore 加入 `.env`。
- 結帳改為客戶端產生 order id + order_items 批次 insert 並檢查 error
  （配合 RLS 移除 anon SELECT 後 `.select()` 不再可用）。
