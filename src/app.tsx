import { useState, useEffect } from 'react';
import { Search, Shield, LogOut, X, ShoppingCart, Plus, Minus, Trash2, ChevronLeft, ChevronRight, CheckCircle, SlidersHorizontal, Layers, MapPin, MessageCircle, Eye, Wrench, Palette, DollarSign } from 'lucide-react';
import AdminPage from './pages/AdminPage';
import LoginPage from './pages/LoginPage';
import { supabase } from './lib/supabase';
import type { Wallpaper, CartItem } from './lib/supabase';

const PLACEHOLDER_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'%3E%3Crect width='400' height='300' fill='%23f5f5f5'/%3E%3Crect x='150' y='100' width='100' height='70' rx='4' fill='none' stroke='%23d4d4d4' stroke-width='2'/%3E%3Ccircle cx='175' cy='120' r='8' fill='%23d4d4d4'/%3E%3Cpolyline points='150,170 185,140 210,158 235,130 300,170' fill='none' stroke='%23d4d4d4' stroke-width='2'/%3E%3Ctext x='200' y='210' font-family='sans-serif' font-size='13' fill='%23a3a3a3' text-anchor='middle'%3E%E7%84%A1%E5%9C%96%E7%89%87%3C/text%3E%3C/svg%3E";

interface Category {
  id: string;
  name: string;
  display_order: number;
  is_active: boolean;
}

interface ProductGroup {
  groupName: string;
  products: Wallpaper[];
  minPrice: number;
  maxPrice: number;
  totalStock: number;
  image: string;
  category: string;
}

/** 判斷是否為「普通石皮」產品（標題以「普通石皮」開頭） */
function isSetProduct(title: string): boolean {
  return title.startsWith('普通石皮');
}

/** 根據產品標題回傳單位（普通石皮系列 → 組，其他 → 片） */
function getUnit(title: string): string {
  return isSetProduct(title) ? '組' : '片';
}

/** 每「組」包含的片數（普通石皮 5，其他 1） */
export function getUnitsPerSet(title: string): number {
  return isSetProduct(title) ? 5 : 1;
}

/** 解析圖片 URL 中的旋轉角度 (格式: url#r90) */
function parseImgRotation(url: string): { src: string; deg: number } {
  const match = url.match(/#r(\d+)$/);
  return match ? { src: url.replace(/#r\d+$/, ''), deg: parseInt(match[1]) } : { src: url, deg: 0 };
}

function getGroupName(title: string): string {
  const dashIdx = title.indexOf('-');
  return dashIdx > -1 ? title.substring(0, dashIdx).trim() : title;
}

function getVariantLabel(product: Wallpaper): string {
  const dashIdx = product.title.indexOf('-');
  if (dashIdx > -1) return product.title.substring(dashIdx + 1).trim();
  if (product.spec) return `${product.spec} mm`;
  return product.title;
}

function groupProducts(products: Wallpaper[]): ProductGroup[] {
  const groupMap = new Map<string, Wallpaper[]>();
  for (const product of products) {
    const groupName = getGroupName(product.title);
    if (!groupMap.has(groupName)) groupMap.set(groupName, []);
    groupMap.get(groupName)!.push(product);
  }
  return Array.from(groupMap.entries()).map(([groupName, prods]) => {
    const prices = prods.map(p => p.price_per_piece || 0).filter(p => p > 0);
    const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
    const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
    const totalStock = prods.reduce((sum, p) => sum + p.stock, 0);
    return {
      groupName,
      products: prods,
      minPrice,
      maxPrice,
      totalStock,
      image: prods[0].image_url || PLACEHOLDER_IMG,
      category: prods[0].category,
    };
  });
}

type PageKey = 'home' | 'products' | 'service' | 'about' | 'contact' | 'order-lookup';
const PAGE_KEYS: PageKey[] = ['home', 'products', 'service', 'about', 'contact', 'order-lookup'];

/** 從網址 hash 解析目前頁面（#/products → products），無效值回 home */
function pageFromHash(): PageKey | 'admin' {
  const h = window.location.hash.replace(/^#\/?/, '');
  if (h === 'admin') return 'admin';
  return (PAGE_KEYS as string[]).includes(h) ? (h as PageKey) : 'home';
}

function App() {
  const [showAdmin, setShowAdmin]             = useState(false);
  // 重新整理時停在 #/admin：先同步顯示登入頁佔住 hash（避免被改寫回 #/home），
  // checkAuthStatus 確認已登入後會自動切到後台
  const [showLogin, setShowLogin]             = useState(() => pageFromHash() === 'admin');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery]         = useState('');
  const [showSearch, setShowSearch]           = useState(false);
  // 頁面狀態與網址 hash 同步：重新整理後停留在原頁面
  const [currentPage, setCurrentPage]         = useState<PageKey>(() => {
    const p = pageFromHash();
    return p === 'admin' ? 'home' : p;
  });
  const [showDrawer, setShowDrawer]           = useState(false);
  const [wallpapers, setWallpapers]           = useState<Wallpaper[]>([]);
  const [categories, setCategories]           = useState<Category[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [selectedWallpaper, setSelectedWallpaper] = useState<Wallpaper | null>(null);
  const [lightboxIdx, setLightboxIdx]         = useState(0);

  // 變體選擇 Modal
  const [showVariantModal, setShowVariantModal] = useState(false);
  const [selectedGroup, setSelectedGroup]     = useState<ProductGroup | null>(null);

  // 分頁
  const PAGE_SIZE = 16;
  const [page, setPage]                       = useState(1);
  const resetPage = () => setPage(1);

  // 購物車
  const [cart, setCart]                       = useState<CartItem[]>([]);
  const [showCart, setShowCart]               = useState(false);
  const [addingItem, setAddingItem]           = useState<Wallpaper | null>(null);
  const [addQty, setAddQty]                   = useState(1);
  const [addedToast, setAddedToast]           = useState<string | null>(null);

  // 結帳表單
  const [showCheckout, setShowCheckout]       = useState(false);
  const [checkoutForm, setCheckoutForm]       = useState({ name: '', email: '', phone: '', company: '', tax_id: '', shipping_address: '', notes: '' });
  const [submitting, setSubmitting]           = useState(false);
  const [orderResult, setOrderResult]         = useState<{ success: boolean; orderNumber?: string; message?: string } | null>(null);

  // 訂單查詢
  const [lookupVerify, setLookupVerify]       = useState('');
  const [lookupOrders, setLookupOrders]       = useState<any[]>([]);
  const [lookupSelectedId, setLookupSelectedId] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading]     = useState(false);
  const [lookupError, setLookupError]         = useState('');

  // 當前展開的訂單
  const lookupOrder = lookupOrders.find(o => o.id === lookupSelectedId)
    ?? (lookupOrders.length === 1 ? lookupOrders[0] : null);

  const selectLookupOrder = (order: any) => {
    setLookupSelectedId(order.id);
  };

  const handleLookupOrder = async () => {
    if (!lookupVerify.trim()) return;
    setLookupLoading(true);
    setLookupError('');
    setLookupOrders([]);
    setLookupSelectedId(null);

    const contact = lookupVerify.trim();
    // 走 SECURITY DEFINER RPC：參數化比對，anon 不再擁有 orders 的 SELECT 權限
    const { data, error } = await supabase.rpc('lookup_orders', { contact });

    if (error) {
      setLookupError('查詢失敗，請稍後再試。');
    } else if (!data || data.length === 0) {
      setLookupError('查詢無結果，請確認 Email 或電話是否正確。');
    } else {
      setLookupOrders(data);
    }
    setLookupLoading(false);
  };

  useEffect(() => {
    fetchWallpapers();
    fetchCategories();
    checkAuthStatus();
  }, []);

  // 頁面狀態 → 網址 hash（切頁時寫入，產生瀏覽紀錄，上一頁/下一頁可用）
  useEffect(() => {
    const target = showAdmin || showLogin ? 'admin' : currentPage;
    const newHash = '#/' + target;
    if (window.location.hash !== newHash) window.location.hash = newHash;
  }, [currentPage, showAdmin, showLogin]);

  // 網址 hash → 頁面狀態（上一頁/下一頁、手動改網址時同步回來）
  useEffect(() => {
    const onHashChange = () => {
      const p = pageFromHash();
      if (p === 'admin') {
        if (isAuthenticated) setShowAdmin(true);
        else setShowLogin(true);
      } else {
        setShowAdmin(false);
        setShowLogin(false);
        setCurrentPage(p);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [isAuthenticated]);

  const checkAuthStatus = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setIsAuthenticated(!!session);
    // 重新整理時停在 #/admin：已登入直接回後台，未登入停在登入頁
    if (pageFromHash() === 'admin') {
      if (session) { setShowAdmin(true); setShowLogin(false); }
      else setShowLogin(true);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    setShowAdmin(false);
  };

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    setShowLogin(false);
    setShowAdmin(true);
  };

  const fetchWallpapers = async () => {
    setLoading(true);
    // created_at 相同的產品（批次匯入）需要 id 平手判定，順序才不會隨編輯變動
    const { data, error } = await supabase
      .from('wallpapers')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true });
    if (!error) setWallpapers(data || []);
    setLoading(false);
  };

  const fetchCategories = async () => {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true });
    if (!error) setCategories(data || []);
  };

  // ── 購物車操作 ──
  const addToCart = (wallpaper: Wallpaper, qty = 1) => {
    setCart(prev => {
      const existing = prev.find(i => i.wallpaper.id === wallpaper.id);
      if (existing) {
        return prev.map(i => i.wallpaper.id === wallpaper.id
          ? { ...i, quantity: Math.min(i.quantity + qty, wallpaper.stock) }
          : i);
      }
      return [...prev, { wallpaper, quantity: Math.min(qty, wallpaper.stock) }];
    });
    setAddedToast(wallpaper.title);
    setTimeout(() => setAddedToast(null), 2500);
  };

  const openAddModal = (wallpaper: Wallpaper) => {
    setAddingItem(wallpaper);
    setAddQty(1);
  };

  const confirmAdd = () => {
    if (!addingItem) return;
    addToCart(addingItem, addQty);
    setAddingItem(null);
  };

  const updateCartQty = (id: string, qty: number) => {
    if (qty <= 0) {
      setCart(prev => prev.filter(i => i.wallpaper.id !== id));
    } else {
      setCart(prev => prev.map(i => i.wallpaper.id === id ? { ...i, quantity: qty } : i));
    }
  };

  const removeFromCart = (id: string) => setCart(prev => prev.filter(i => i.wallpaper.id !== id));

  const cartTotal = cart.reduce((sum, i) => sum + (i.wallpaper.price_per_piece || 0) * i.quantity, 0);
  const cartCount = cart.reduce((sum, i) => sum + i.quantity, 0);

  // ── 產品群組互動 ──
  const handleGroupClick = (group: ProductGroup) => {
    if (group.products.length === 1) {
      setSelectedWallpaper(group.products[0]);
      setLightboxIdx(0);
    } else {
      setSelectedGroup(group);
      setShowVariantModal(true);
    }
  };

  const handleGroupAddToCart = (group: ProductGroup) => {
    if (group.products.length === 1) {
      openAddModal(group.products[0]);
    } else {
      setSelectedGroup(group);
      setShowVariantModal(true);
    }
  };

  // ── 建立訂單 ──
  // 走 create_order RPC：單一交易寫入訂單＋項目、伺服器端以 DB 價格計算金額、
  // 庫存不足時整筆失敗並回傳原因（庫存扣減由 DB trigger 處理）
  const handleSubmitOrder = async () => {
    if (!checkoutForm.name || !checkoutForm.email || !checkoutForm.phone || cart.length === 0) return;
    setSubmitting(true);

    const { data, error } = await supabase.rpc('create_order', {
      p_customer_name:    checkoutForm.name,
      p_customer_email:   checkoutForm.email,
      p_customer_phone:   checkoutForm.phone,
      p_customer_company: checkoutForm.company,
      p_notes: [
        checkoutForm.notes,
        checkoutForm.tax_id ? `統一編號：${checkoutForm.tax_id}` : '',
        checkoutForm.shipping_address ? `送貨地址：${checkoutForm.shipping_address}` : '',
      ].filter(Boolean).join('\n'),
      p_items: cart.map(item => ({
        wallpaper_id: item.wallpaper.id,
        quantity:     item.quantity,
      })),
    });

    if (error) {
      setOrderResult({ success: false, message: error.message });
      setSubmitting(false);
      fetchWallpapers();
      return;
    }

    setCart([]);
    setCheckoutForm({ name: '', email: '', phone: '', company: '', tax_id: '', shipping_address: '', notes: '' });
    setOrderResult({ success: true, orderNumber: data?.order_number });
    setSubmitting(false);
    fetchWallpapers();
  };

  if (showLogin)  return <LoginPage onLoginSuccess={handleLoginSuccess} onBack={() => setShowLogin(false)} />;
  if (showAdmin) {
    if (!isAuthenticated) { setShowAdmin(false); setShowLogin(true); return null; }
    return <AdminPage onBack={() => { setShowAdmin(false); fetchWallpapers(); fetchCategories(); }} onLogout={handleLogout} />;
  }

  const filteredWallpapers = wallpapers.filter(w => {
    const matchCat    = !selectedCategory || w.category === selectedCategory;
    const matchSearch = !searchQuery || w.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

  const productGroups = groupProducts(filteredWallpapers);
  const totalPages    = Math.ceil(productGroups.length / PAGE_SIZE);
  const pagedGroups   = productGroups.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const rawUrls = selectedWallpaper?.image_urls;
  const urlArray: string[] = Array.isArray(rawUrls)
    ? rawUrls.filter(Boolean)
    : typeof rawUrls === 'string' && rawUrls
      ? [rawUrls]
      : [];
  const images = urlArray.length
    ? urlArray
    : selectedWallpaper?.image_url
      ? [selectedWallpaper.image_url]
      : [PLACEHOLDER_IMG];

  return (
    <div className="min-h-screen bg-white flex flex-col">

      {/* ── 頂部公告欄 ── */}
      <div className="bg-neutral-100 border-b border-neutral-200 text-xs text-neutral-600 py-2">
      </div>

      {/* ── Header ── */}
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-20">
            <div className="text-2xl font-bold text-neutral-800">材酷建材 CAIKU</div>
            <div className="flex items-center space-x-8">
              <nav className="hidden md:flex space-x-8">
                {([
                  { label: '首頁', page: 'home' as const },
                  { label: '產品', page: 'products' as const },
                  { label: '服務', page: 'service' as const },
                  { label: '關於材酷', page: 'about' as const },
                  { label: '訂單查詢', page: 'order-lookup' as const },
                  { label: '聯絡我們', page: 'contact' as const },
                ]).map(n => (
                  <button key={n.label} onClick={() => { setCurrentPage(n.page); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                    className={`text-sm font-medium transition-colors ${currentPage === n.page ? 'text-neutral-900' : 'text-neutral-700 hover:text-neutral-900'}`}>{n.label}</button>
                ))}
              </nav>
              <div className="flex items-center space-x-3">
                {/* 社群連結 */}
                <a href="https://lin.ee/rohhrPR" target="_blank" rel="noopener noreferrer" className="text-neutral-500 hover:text-[#06C755] transition-colors" title="LINE">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>
                </a>
                <a href="https://www.instagram.com/_caiku_?igsh=MXNla2l6dGE0cWhqMQ==" target="_blank" rel="noopener noreferrer" className="text-neutral-500 hover:text-[#E4405F] transition-colors" title="Instagram">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
                </a>
                <a href="https://www.facebook.com/share/1HLkSESqxm/" target="_blank" rel="noopener noreferrer" className="text-neutral-500 hover:text-[#1877F2] transition-colors" title="Facebook">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                </a>
                <button onClick={() => setShowSearch(!showSearch)} className="text-neutral-600 hover:text-neutral-800"><Search size={20}/></button>
                <button onClick={() => setShowCart(true)} className="relative text-neutral-600 hover:text-neutral-800">
                  <ShoppingCart size={20}/>
                  {cartCount > 0 && (
                    <span className="absolute -top-2 -right-2 bg-neutral-900 text-white text-xs w-5 h-5 flex items-center justify-center rounded-full">{cartCount}</span>
                  )}
                </button>
              </div>
            </div>
          </div>
          {showSearch && (
            <div className="pb-4">
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); resetPage(); }}
                placeholder="搜尋產品名稱..."
                className="w-full border border-neutral-300 px-4 py-2 text-sm focus:outline-none focus:border-neutral-900"
              />
            </div>
          )}
        </div>

        {/* 麵包屑 */}
        {currentPage === 'products' && (
        <div className="bg-neutral-50 border-b border-neutral-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
            <div className="flex items-center space-x-2 text-sm text-neutral-600">
              <button onClick={() => { setCurrentPage('home'); }} className="hover:text-neutral-900">首頁</button>
              <span>&gt;</span>
              <span className="font-medium text-neutral-900">產品</span>
              {selectedCategory && <><span>&gt;</span><span className="font-medium text-neutral-900">{selectedCategory}</span></>}
            </div>
          </div>
        </div>
        )}
      </header>

      {/* ── 首頁 ── */}
      {currentPage === 'home' && (
        <div className="flex-1">
          {/* Hero */}
          <section className="bg-neutral-50 border-b border-neutral-200">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28 text-center">
              <h1 className="text-3xl md:text-5xl font-bold text-neutral-900 mb-6 leading-tight tracking-tight">
                讓建築擁有輕盈、自然且持久的靈魂
              </h1>
              <p className="text-lg md:text-xl text-neutral-500 max-w-2xl mx-auto mb-10">
                材酷建材 CAIKU —— 專注於創新建築飾面材料，打破傳統石材的沉重與施工限制。
              </p>
              <button onClick={() => setCurrentPage('products')}
                className="bg-neutral-900 text-white px-8 py-3 text-sm font-medium hover:bg-neutral-700 transition-colors tracking-wider uppercase">
                瀏覽產品
              </button>
            </div>
          </section>

          {/* 品牌核心 */}
          <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <h2 className="text-2xl font-bold text-neutral-900 mb-4">品牌核心</h2>
            <p className="text-neutral-600 leading-relaxed max-w-3xl">
              我們專注於創新建築飾面材料，致力於打破傳統石材的沉重與施工限制。材酷 (Caiku) 品牌名稱源自對「材料」與「酷炫創意」的結合，我們相信好的建材不只能改變空間的視覺，更能大幅提升施工效率與設計價值。
            </p>
          </section>

          {/* 品牌定位 */}
          <section className="bg-neutral-50 border-y border-neutral-200">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
              <h2 className="text-2xl font-bold text-neutral-900 mb-8">品牌定位</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-white p-8 border border-neutral-200">
                  <h3 className="text-lg font-bold text-neutral-900 mb-3">專業</h3>
                  <p className="text-neutral-600 leading-relaxed">提供從選材、配送到施工報價的一站式解決方案。</p>
                </div>
                <div className="bg-white p-8 border border-neutral-200">
                  <h3 className="text-lg font-bold text-neutral-900 mb-3">品質</h3>
                  <p className="text-neutral-600 leading-relaxed">嚴選耐候防水、防潮、室內外牆都適合使用，具美感的石材紋理。</p>
                </div>
              </div>
            </div>
          </section>

          {/* 為什麼選擇材酷 */}
          <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <h2 className="text-2xl font-bold text-neutral-900 mb-8">為什麼選擇材酷建材 CAIKU</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex gap-4 p-6 bg-neutral-50 border border-neutral-200">
                <Eye size={24} className="text-neutral-900 flex-shrink-0 mt-1"/>
                <div>
                  <h3 className="font-bold text-neutral-900 mb-2">實體展間</h3>
                  <p className="text-neutral-600 text-sm leading-relaxed">我們設有專業實體展間，現場提供大樣款式，讓您摸得到質感、看得到真實成色，更加安心選購。</p>
                </div>
              </div>
              <div className="flex gap-4 p-6 bg-neutral-50 border border-neutral-200">
                <Wrench size={24} className="text-neutral-900 flex-shrink-0 mt-1"/>
                <div>
                  <h3 className="font-bold text-neutral-900 mb-2">施工友善</h3>
                  <p className="text-neutral-600 text-sm leading-relaxed">我們的軟石材料可使用結構膠與釘槍快速施作，大幅縮短工期。</p>
                </div>
              </div>
              <div className="flex gap-4 p-6 bg-neutral-50 border border-neutral-200">
                <Palette size={24} className="text-neutral-900 flex-shrink-0 mt-1"/>
                <div>
                  <h3 className="font-bold text-neutral-900 mb-2">異材質美學</h3>
                  <p className="text-neutral-600 text-sm leading-relaxed">包含立體石皮秋山石景連紋、軟石系列、PU九宮格等造型，滿足設計師對整體呈現的追求。</p>
                </div>
              </div>
              <div className="flex gap-4 p-6 bg-neutral-50 border border-neutral-200">
                <DollarSign size={24} className="text-neutral-900 flex-shrink-0 mt-1"/>
                <div>
                  <h3 className="font-bold text-neutral-900 mb-2">透明報價</h3>
                  <p className="text-neutral-600 text-sm leading-relaxed">價格公開透明，並提供專業的連工帶料諮詢，拒絕工程資訊不透明。</p>
                </div>
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="bg-neutral-900 text-white">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
              <h2 className="text-2xl font-bold mb-4">立即探索我們的產品</h2>
              <p className="text-neutral-400 mb-8">從軟石到立體石皮，找到最適合您空間的材料。</p>
              <button onClick={() => setCurrentPage('products')}
                className="bg-white text-neutral-900 px-8 py-3 text-sm font-medium hover:bg-neutral-100 transition-colors tracking-wider uppercase">
                前往產品頁
              </button>
            </div>
          </section>
        </div>
      )}

      {/* ── 服務 ── */}
      {currentPage === 'service' && (
        <div className="flex-1">
          <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <h1 className="text-3xl font-bold text-neutral-900 mb-10">服務項目</h1>

            {/* 訂購流程 */}
            <div className="mb-14">
              <h2 className="text-lg font-bold text-neutral-900 mb-6 text-center">訂購流程</h2>
              <div className="flex flex-col md:flex-row items-center justify-center gap-0">
                {[
                  { step: '1', title: '送出詢價', desc: '選擇商品送出詢價單', icon: (<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 14l2 2 4-4"/></svg>) },
                  { step: '2', title: '加入官方 LINE', desc: '確認訂單資訊', icon: (<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>) },
                  { step: '3', title: '完成匯款', desc: '預購商品需先支付 50% 訂金', icon: (<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>) },
                  { step: '4', title: '安排出貨', desc: '匯款確認後通知出貨', icon: (<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>) },
                ].map((item, i) => (
                  <div key={item.step} className="flex flex-col md:flex-row items-center">
                    <div className="flex flex-col items-center text-center w-40">
                      <div className="w-16 h-16 bg-neutral-900 text-white rounded-full flex items-center justify-center mb-3 shadow-lg">
                        {item.icon}
                      </div>
                      <p className="text-sm font-bold text-neutral-900 mb-1">{item.title}</p>
                      <p className="text-xs text-neutral-500 leading-snug">{item.desc}</p>
                    </div>
                    {i < 3 && (
                      <>
                        <div className="hidden md:block text-neutral-300 mx-3">
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
                        </div>
                        <div className="md:hidden text-neutral-300 my-3">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12l7 7 7-7"/></svg>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 一、材料販售 */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-neutral-900 mb-6 flex items-center gap-3">
                <span className="bg-neutral-900 text-white text-sm w-7 h-7 flex items-center justify-center">一</span>
                材料販售
              </h2>
              <div className="bg-neutral-50 border border-neutral-200 p-6 space-y-4">
                <p className="text-sm text-neutral-700 leading-relaxed flex items-start gap-2">
                  <span className="text-neutral-400 mt-0.5">*</span>
                  下訂單後請至官方 LINE 留言訂購人姓名，方便後續聯絡。
                </p>
                <p className="text-sm text-neutral-700 leading-relaxed flex items-start gap-2">
                  <span className="text-neutral-400 mt-0.5">*</span>
                  預購商品需先支付訂金 50%，若是中途取消訂單則不另退費。
                </p>
                <p className="text-sm text-neutral-700 leading-relaxed flex items-start gap-2">
                  <span className="text-neutral-400 mt-0.5">*</span>
                  完成匯款後，會再通知出貨時間。
                </p>
                <p className="text-sm text-neutral-700 leading-relaxed flex items-start gap-2">
                  <span className="text-neutral-400 mt-0.5">*</span>
                全台皆可配送，運費另計。
                </p>
                <div className="pt-2">
                  <a href="https://lin.ee/rohhrPR" target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-[#06C755] text-white px-5 py-2.5 text-sm font-medium rounded hover:bg-[#05b04c] transition-colors">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>
                    前往官方 LINE
                  </a>
                </div>
              </div>
            </div>

            {/* 二、一站式服務 */}
            <div className="mb-12">
              <h2 className="text-xl font-bold text-neutral-900 mb-6 flex items-center gap-3">
                <span className="bg-neutral-900 text-white text-sm w-7 h-7 flex items-center justify-center">二</span>
                一站式服務
              </h2>
              <div className="bg-neutral-50 border border-neutral-200 p-6">
                <p className="text-xs text-neutral-500 uppercase tracking-wider mb-4">施工報價與技術支援</p>
                <div className="space-y-4">
                  <div>
                    <h3 className="font-bold text-neutral-900 mb-2">連工帶料報價</h3>
                    <p className="text-sm text-neutral-700 leading-relaxed">
                      設計師提供圖面尺寸線上報價，給予專業建議。
                    </p>
                  </div>
                  <div className="border-t border-neutral-200 pt-4">
                    <h3 className="font-bold text-neutral-900 mb-2">一站式服務範圍</h3>
                    <div className="flex flex-wrap gap-2">
                      {['雙北', '桃園', '新竹', '台中'].map(area => (
                        <span key={area} className="bg-neutral-900 text-white text-sm px-4 py-1.5">{area}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* CTA */}
            <div className="bg-neutral-900 text-white p-8 text-center">
              <h3 className="text-lg font-bold mb-2">需要報價或諮詢？</h3>
              <p className="text-neutral-400 text-sm mb-4">歡迎透過官方 LINE 聯繫我們，提供圖面即可線上報價。</p>
              <a href="https://lin.ee/rohhrPR" target="_blank" rel="noopener noreferrer"
                className="inline-block bg-white text-neutral-900 px-6 py-3 text-sm font-medium hover:bg-neutral-100 transition-colors tracking-wider uppercase">
                立即諮詢
              </a>
            </div>
          </section>
        </div>
      )}

      {/* ── 關於材酷 ── */}
      {currentPage === 'about' && (
        <div className="flex-1">
          <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <h1 className="text-3xl font-bold text-neutral-900 mb-8">關於材酷建材 CAIKU</h1>
            <div className="space-y-8 text-neutral-600 leading-relaxed">
              <div>
                <h2 className="text-xl font-bold text-neutral-900 mb-3">品牌核心</h2>
                <p>我們專注於創新建築飾面材料，致力於打破傳統石材的沉重與施工限制。材酷 (Caiku) 品牌名稱源自對「材料」與「酷炫創意」的結合，我們相信好的建材不只能改變空間的視覺，更能大幅提升施工效率與設計價值。</p>
              </div>
              <div>
                <h2 className="text-xl font-bold text-neutral-900 mb-3">品牌定位</h2>
                <ul className="space-y-3">
                  <li><strong className="text-neutral-900">專業：</strong>提供從選材、配送到施工報價的一站式解決方案。</li>
                  <li><strong className="text-neutral-900">品質：</strong>嚴選耐候防水、防潮、室內外牆都適合使用，具美感的石材紋理。</li>
                </ul>
              </div>
              <div>
                <h2 className="text-xl font-bold text-neutral-900 mb-3">為什麼選擇材酷建材 CAIKU</h2>
                <ul className="space-y-3">
                  <li><strong className="text-neutral-900">實體展間：</strong>我們設有專業實體展間，現場提供大樣款式，讓您摸得到質感、看得到真實成色，更加安心選購。</li>
                  <li><strong className="text-neutral-900">施工友善：</strong>我們的軟石材料可使用結構膠與釘槍快速施作，大幅縮短工期。</li>
                  <li><strong className="text-neutral-900">異材質美學：</strong>包含立體石皮秋山石景連紋、軟石系列、PU九宮格等造型，滿足設計師對整體呈現的追求。</li>
                  <li><strong className="text-neutral-900">透明報價：</strong>價格公開透明，並提供專業的連工帶料諮詢，拒絕工程資訊不透明。</li>
                </ul>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ── 聯絡我們 ── */}
      {currentPage === 'contact' && (
        <div className="flex-1">
          <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <h1 className="text-3xl font-bold text-neutral-900 mb-8">聯絡我們</h1>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <MessageCircle size={22} className="text-neutral-900 flex-shrink-0 mt-1"/>
                  <div>
                    <h3 className="font-bold text-neutral-900 mb-1">官方 LINE</h3>
                    <a href="https://lin.ee/rohhrPR" target="_blank" rel="noopener noreferrer"
                      className="text-neutral-600 hover:text-neutral-900 underline">加入官方 LINE</a>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <MapPin size={22} className="text-neutral-900 flex-shrink-0 mt-1"/>
                  <div>
                    <h3 className="font-bold text-neutral-900 mb-1">展間地址</h3>
                    <p className="text-neutral-600">桃園市楊梅區楊新路三段345巷65號</p>
                    <p className="text-neutral-500 text-sm mt-1">前往展間需提前 LINE 預約</p>
                  </div>
                </div>
              </div>
              <div className="bg-neutral-50 border border-neutral-200 p-8">
                <h3 className="font-bold text-neutral-900 mb-3">預約參觀展間</h3>
                <p className="text-neutral-600 text-sm leading-relaxed mb-4">
                  歡迎透過官方 LINE 預約參觀，我們將為您安排專人導覽，讓您親手感受材料質感。
                </p>
                <a href="https://lin.ee/rohhrPR" target="_blank" rel="noopener noreferrer"
                  className="inline-block bg-neutral-900 text-white px-6 py-3 text-sm font-medium hover:bg-neutral-700 transition-colors tracking-wider uppercase">
                  LINE 預約
                </a>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ── 訂單查詢 ── */}
      {currentPage === 'order-lookup' && (
        <div className="flex-1">
          <section className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
            <h1 className="text-3xl font-bold text-neutral-900 mb-2">訂單查詢</h1>
            <p className="text-neutral-500 mb-8">請輸入下單時填寫的 Email 或聯絡電話，即可查詢所有相關訂單。</p>

            <div className="space-y-3 mb-6">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1.5">Email 或聯絡電話 *</label>
                <input
                  type="text"
                  value={lookupVerify}
                  onChange={e => setLookupVerify(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLookupOrder()}
                  placeholder="請輸入下單時填寫的 Email 或電話"
                  className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm"
                />
              </div>
              <button
                onClick={handleLookupOrder}
                disabled={lookupLoading || !lookupVerify.trim()}
                className="w-full bg-neutral-900 text-white px-6 py-3 text-sm font-medium hover:bg-neutral-700 transition-colors uppercase tracking-wider disabled:opacity-50"
              >
                {lookupLoading ? '查詢中...' : '查詢訂單'}
              </button>
            </div>

            {lookupError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm mb-6">
                {lookupError}
              </div>
            )}

            {/* 多筆訂單列表（未選取時顯示） */}
            {lookupOrders.length > 1 && !lookupSelectedId && (
              <div className="space-y-3">
                <p className="text-sm text-neutral-500 mb-2">找到 {lookupOrders.length} 筆訂單，請選擇查看：</p>
                {lookupOrders.map(o => (
                  <button key={o.id} onClick={() => selectLookupOrder(o)}
                    className="w-full flex items-center justify-between border border-neutral-200 bg-white px-5 py-4 hover:border-neutral-900 transition-colors text-left">
                    <div>
                      <p className="font-medium text-neutral-900 text-sm">{o.order_number}</p>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        {new Date(o.created_at).toLocaleString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' })}
                      </p>
                    </div>
                    <div className="text-right">
                      {o.total_amount > 0 && <p className="text-sm font-bold text-neutral-900">NT$ {o.total_amount.toLocaleString()}</p>}
                      <span className={`inline-flex mt-1 px-2 py-0.5 text-xs font-medium border ${
                        o.status === 'pending' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                        o.status === 'confirmed' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                        o.status === 'completed' ? 'bg-green-50 text-green-700 border-green-200' :
                        'bg-red-50 text-red-700 border-red-200'
                      }`}>
                        {{ pending: '待確認', confirmed: '已確認', completed: '已完成', cancelled: '已取消' }[o.status as string] || o.status}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* 單筆訂單詳細 */}
            {lookupOrder && (
              <div className="border border-neutral-200 bg-white">
                {lookupOrders.length > 1 && (
                  <button onClick={() => setLookupSelectedId(null)}
                    className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 px-6 pt-4 pb-0">
                    <ChevronLeft size={14}/> 返回訂單列表
                  </button>
                )}
                <div className="bg-neutral-50 px-6 py-4 border-b border-neutral-200">
                  <div className="flex items-center justify-between">
                    <h2 className="font-bold text-neutral-900">{lookupOrder.order_number}</h2>
                    <span className={`inline-flex px-3 py-1 text-xs font-medium border ${
                      lookupOrder.status === 'pending' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                      lookupOrder.status === 'confirmed' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                      lookupOrder.status === 'completed' ? 'bg-green-50 text-green-700 border-green-200' :
                      'bg-red-50 text-red-700 border-red-200'
                    }`}>
                      {{ pending: '待確認', confirmed: '已確認', completed: '已完成', cancelled: '已取消' }[lookupOrder.status as string] || lookupOrder.status}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500 mt-1">
                    {new Date(lookupOrder.created_at).toLocaleString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>

                <div className="px-6 py-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div><span className="text-neutral-500">姓名：</span><span className="text-neutral-900">{lookupOrder.customer_name}</span></div>
                    <div><span className="text-neutral-500">Email：</span><span className="text-neutral-900">{lookupOrder.customer_email}</span></div>
                    {lookupOrder.customer_phone && <div><span className="text-neutral-500">電話：</span><span className="text-neutral-900">{lookupOrder.customer_phone}</span></div>}
                    {lookupOrder.customer_company && <div><span className="text-neutral-500">公司：</span><span className="text-neutral-900">{lookupOrder.customer_company}</span></div>}
                  </div>

                  <div>
                    <h3 className="text-xs font-medium text-neutral-600 uppercase tracking-wider mb-2">訂購項目</h3>
                    <div className="border border-neutral-200 divide-y divide-neutral-200">
                      {(lookupOrder.order_items || []).map((item: any, i: number) => (
                        <div key={i} className="px-4 py-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {item.wallpaper?.image_url && (() => {
                              const { src, deg } = parseImgRotation(item.wallpaper.image_url);
                              return <img src={src} alt="" style={deg ? { transform: `rotate(${deg}deg)` } : undefined} className="w-10 h-10 object-cover bg-neutral-100" />;
                            })()}
                            <div>
                              <p className="text-sm text-neutral-900">{item.wallpaper?.title || '未知產品'}</p>
                              {item.wallpaper?.spec && <p className="text-xs text-neutral-500">{item.wallpaper.spec}</p>}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-neutral-900">x {item.quantity}</p>
                            {item.subtotal > 0 && <p className="text-xs text-neutral-500">NT$ {(item.subtotal || 0).toLocaleString()}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                    {lookupOrder.total_amount > 0 && (
                      <div className="text-right mt-2">
                        <div className="text-sm font-bold text-neutral-900">合計：NT$ {lookupOrder.total_amount.toLocaleString()}</div>
                        <p className="text-xs text-neutral-500 mt-0.5">* 營業稅及運費另計</p>
                      </div>
                    )}
                  </div>

                  {/* 備註（唯讀） */}
                  {lookupOrder.notes && (
                    <div>
                      <h3 className="text-xs font-medium text-neutral-600 uppercase tracking-wider mb-2">備註</h3>
                      <p className="text-sm text-neutral-700 bg-neutral-50 border border-neutral-200 px-4 py-3 whitespace-pre-wrap">{lookupOrder.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ── 產品主體 ── */}
      {currentPage === 'products' && (<>
      <div className="flex-1 flex">

        {/* ── 桌機版側邊欄 ── */}
        <aside className="hidden md:block bg-white border-r border-neutral-200 w-72 sticky top-32 h-[calc(100vh-8rem)] overflow-y-auto">
          <div className="p-8">
            <h2 className="text-lg font-bold text-neutral-800 mb-6 uppercase tracking-wider">產品分類</h2>
            <div className="space-y-1">
              <button onClick={() => { setSelectedCategory(null); resetPage(); }}
                className={`w-full text-left px-4 py-3 transition-colors group flex items-center justify-between ${selectedCategory === null ? 'text-neutral-900 font-medium' : 'text-neutral-600 hover:text-neutral-900'}`}>
                <span>全部</span>
                <span className={`opacity-0 group-hover:opacity-100 transition-opacity ${selectedCategory === null ? 'opacity-100' : ''}`}>&gt;</span>
              </button>
              {categories.map(cat => (
                <button key={cat.id} onClick={() => { setSelectedCategory(cat.name); resetPage(); }}
                  className={`w-full text-left px-4 py-3 transition-colors group flex items-center justify-between ${selectedCategory === cat.name ? 'text-neutral-900 font-medium' : 'text-neutral-600 hover:text-neutral-900'}`}>
                  <span>{cat.name}</span>
                  <span className={`opacity-0 group-hover:opacity-100 transition-opacity ${selectedCategory === cat.name ? 'opacity-100' : ''}`}>&gt;</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* 產品格線 */}
        <main className="flex-1 p-8 lg:p-12">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-neutral-300 border-t-neutral-900"/>
            </div>
          ) : productGroups.length === 0 ? (
            <div className="text-center py-16 text-neutral-500">目前沒有商品。</div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-6">
                {pagedGroups.map(group => {
                  const isMulti = group.products.length > 1;
                  const outOfStock = group.totalStock === 0;
                  return (
                    <div key={group.groupName} className="bg-neutral-50 overflow-hidden group flex flex-col">
                      {/* 圖片區 */}
                      <div
                        className="aspect-[4/3] overflow-hidden bg-neutral-100 cursor-pointer relative"
                        onClick={() => handleGroupClick(group)}
                      >
                        {(() => { const { src, deg } = parseImgRotation(group.image); return (
                        <img
                          src={src}
                          alt={group.groupName}
                          className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
                          style={deg ? { transform: `rotate(${deg}deg)` } : undefined}
                          onError={e => { (e.target as HTMLImageElement).src = PLACEHOLDER_IMG; }}
                        />); })()}
                        {/* 多規格標籤 */}
                        {isMulti && (
                          <div className="absolute top-2 left-2 bg-neutral-900/80 text-white text-xs px-2 py-1 flex items-center space-x-1">
                            <Layers size={11}/>
                            <span>{group.products.length} 種規格</span>
                          </div>
                        )}
                      </div>
                      {/* 資訊區 */}
                      <div className="p-4 bg-white flex flex-col flex-1">
                        <h3 className="font-medium text-neutral-900 mb-1 text-sm">{group.groupName}</h3>
                        <p className="text-xs text-neutral-500 mb-1">{group.category}</p>
                        {/* 單規格顯示規格 */}
                        {!isMulti && group.products[0].spec && (
                          <p className="text-xs text-neutral-400 mb-1">{group.products[0].spec} mm</p>
                        )}
                        {/* 價格 */}
                        {group.minPrice > 0 ? (
                          <p className="text-sm font-bold text-neutral-900 mb-2">
                            {isMulti && group.maxPrice > group.minPrice
                              ? `NT$ ${group.minPrice.toLocaleString()} ~ ${group.maxPrice.toLocaleString()} / ${getUnit(group.groupName)}`
                              : `NT$ ${group.minPrice.toLocaleString()} / ${getUnit(group.groupName)}`
                            }
                          </p>
                        ) : null}
                        <div className="flex items-center justify-between mt-auto pt-2">
                        
                          <button
                            onClick={() => handleGroupAddToCart(group)}
                            disabled={outOfStock}
                            className="flex items-center space-x-1 bg-neutral-900 text-white px-3 py-1.5 text-xs hover:bg-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {isMulti
                              ? <><Layers size={12}/><span>{outOfStock ? '缺貨' : '選擇規格'}</span></>
                              : <><Plus size={12}/><span>{outOfStock ? '缺貨' : '加入詢價'}</span></>
                            }
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 分頁器 */}
              {totalPages > 1 && (
                <div className="mt-10 flex flex-col items-center space-y-3">
                  <p className="text-xs text-neutral-400 uppercase tracking-wider">
                    第 {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, productGroups.length)} 項，共 {productGroups.length} 項
                  </p>
                  <div className="flex items-center space-x-1">
                    <button onClick={() => { setPage(p => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      disabled={page === 1}
                      className="px-4 py-2 border border-neutral-300 text-sm text-neutral-600 hover:border-neutral-900 hover:text-neutral-900 transition-colors disabled:opacity-30 disabled:cursor-not-allowed uppercase tracking-wider"
                    >← 上一頁</button>

                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                      .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                        if (idx > 0 && typeof arr[idx-1] === 'number' && (p as number) - (arr[idx-1] as number) > 1) acc.push('...');
                        acc.push(p); return acc;
                      }, [])
                      .map((p, i) => p === '...'
                        ? <span key={`e${i}`} className="px-3 py-2 text-neutral-300 text-sm">…</span>
                        : <button key={p}
                            onClick={() => { setPage(p as number); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                            className={`w-10 h-10 text-sm border transition-colors ${page === p ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 text-neutral-600 hover:border-neutral-900 hover:text-neutral-900'}`}
                          >{p}</button>
                      )
                    }

                    <button onClick={() => { setPage(p => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      disabled={page === totalPages}
                      className="px-4 py-2 border border-neutral-300 text-sm text-neutral-600 hover:border-neutral-900 hover:text-neutral-900 transition-colors disabled:opacity-30 disabled:cursor-not-allowed uppercase tracking-wider"
                    >下一頁 →</button>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* ── 手機版懸浮篩選按鈕 ── */}
      <button
        onClick={() => setShowDrawer(true)}
        className="md:hidden fixed bottom-6 right-6 z-40 w-14 h-14 bg-neutral-900 text-white rounded-full shadow-lg flex items-center justify-center hover:bg-neutral-700 transition-colors"
        aria-label="篩選分類"
      >
        <SlidersHorizontal size={22}/>
        {selectedCategory && (
          <span className="absolute top-1 right-1 w-3 h-3 bg-white rounded-full border-2 border-neutral-900"/>
        )}
      </button>

      {/* ── 手機版分類 Drawer ── */}
      {showDrawer && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowDrawer(false)}/>
          <div className="relative w-72 max-w-[80vw] bg-white h-full flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-6 py-5 border-b border-neutral-200">
              <h2 className="text-base font-bold text-neutral-900 uppercase tracking-wider">分類篩選</h2>
              <button onClick={() => setShowDrawer(false)} className="text-neutral-500 hover:text-neutral-900"><X size={20}/></button>
            </div>
            <div className="flex-1 overflow-y-auto py-4">
              <button
                onClick={() => { setSelectedCategory(null); resetPage(); setShowDrawer(false); }}
                className={`w-full text-left px-6 py-3 transition-colors flex items-center justify-between ${selectedCategory === null ? 'text-neutral-900 font-semibold bg-neutral-50' : 'text-neutral-600 hover:bg-neutral-50'}`}>
                <span>全部</span>
                {selectedCategory === null && <span className="text-neutral-400 text-sm">✓</span>}
              </button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => { setSelectedCategory(cat.name); resetPage(); setShowDrawer(false); }}
                  className={`w-full text-left px-6 py-3 transition-colors flex items-center justify-between ${selectedCategory === cat.name ? 'text-neutral-900 font-semibold bg-neutral-50' : 'text-neutral-600 hover:bg-neutral-50'}`}>
                  <span>{cat.name}</span>
                  {selectedCategory === cat.name && <span className="text-neutral-400 text-sm">✓</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      </>)}

      {/* ── Footer ── */}
      <footer className="bg-neutral-900 text-neutral-400 mt-16 border-t border-neutral-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <h3 className="text-white font-bold mb-4 uppercase text-sm tracking-wider">關於我們</h3>
              <p className="text-sm leading-relaxed">專注於創新建築飾面材料，打破傳統石材的沉重與施工限制。</p>
            </div>
            <div>
              <h4 className="text-white font-bold mb-4 uppercase text-sm tracking-wider">產品</h4>
              <ul className="space-y-2 text-sm">{categories.slice(0,4).map(c => <li key={c.id}><button onClick={() => { setSelectedCategory(c.name); setCurrentPage('products'); }} className="hover:text-white transition-colors">{c.name}</button></li>)}</ul>
            </div>
            <div>
              <h4 className="text-white font-bold mb-4 uppercase text-sm tracking-wider">快速連結</h4>
              <ul className="space-y-2 text-sm">
                <li><button onClick={() => { setCurrentPage('home'); window.scrollTo({ top: 0 }); }} className="hover:text-white transition-colors">首頁</button></li>
                <li><button onClick={() => { setCurrentPage('products'); window.scrollTo({ top: 0 }); }} className="hover:text-white transition-colors">產品</button></li>
                <li><button onClick={() => { setCurrentPage('about'); window.scrollTo({ top: 0 }); }} className="hover:text-white transition-colors">關於材酷</button></li>
                <li><button onClick={() => { setCurrentPage('contact'); window.scrollTo({ top: 0 }); }} className="hover:text-white transition-colors">聯絡我們</button></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-bold mb-4 uppercase text-sm tracking-wider">聯絡資訊</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="https://lin.ee/rohhrPR" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">官方 LINE</a></li>
                <li className="leading-relaxed">展間：桃園市楊梅區楊新路三段345巷65號</li>
                <li className="text-xs text-neutral-500">前往展間需提前 LINE 預約</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-neutral-800 mt-8 pt-8 text-center text-sm flex items-center justify-center gap-4">
            <p>&copy; 2025 材酷建材 CAIKU. 版權所有。</p>
            {isAuthenticated
              ? <><button onClick={() => setShowAdmin(true)} className="text-neutral-600 hover:text-white transition-colors flex items-center gap-1"><Shield size={14}/>管理後台</button>
                   <button onClick={handleLogout} className="text-neutral-600 hover:text-white transition-colors flex items-center gap-1"><LogOut size={14}/>登出</button></>
              : <button onClick={() => setShowLogin(true)} className="text-neutral-600 hover:text-white transition-colors flex items-center gap-1"><Shield size={14}/>管理員登入</button>
            }
          </div>
        </div>
      </footer>

      {/* ══════════════ 變體選擇 Modal ══════════════ */}
      {showVariantModal && selectedGroup && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setShowVariantModal(false)}>
          <div className="bg-white max-w-2xl w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-neutral-200">
              <div>
                <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">選擇規格</p>
                <h2 className="text-xl font-bold text-neutral-900">{selectedGroup.groupName}</h2>
                <p className="text-xs text-neutral-400 mt-0.5">{selectedGroup.products.length} 種規格可選</p>
              </div>
              <button onClick={() => setShowVariantModal(false)} className="text-neutral-400 hover:text-neutral-700 ml-4">
                <X size={22}/>
              </button>
            </div>
            {/* 規格列表 */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {selectedGroup.products.map(product => {
                const variantLabel = getVariantLabel(product);
                const variantImgUrls = Array.isArray(product.image_urls) && product.image_urls.length > 0
                  ? product.image_urls
                  : product.image_url
                    ? [product.image_url]
                    : [PLACEHOLDER_IMG];
                const unit = getUnit(product.title);
                return (
                  <div key={product.id} className="flex items-center space-x-4 border border-neutral-200 p-4 hover:border-neutral-400 transition-colors">
                    {/* 縮圖 */}
                    {(() => { const { src: vSrc, deg: vDeg } = parseImgRotation(variantImgUrls[0]); return (
                    <img src={vSrc} alt={variantLabel} style={vDeg ? { transform: `rotate(${vDeg}deg)` } : undefined}
                      className="w-20 h-16 object-cover bg-neutral-100 flex-shrink-0"
                      onError={e => { (e.target as HTMLImageElement).src = PLACEHOLDER_IMG; }}/>
                    ); })()}
                    {/* 規格資訊 */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-neutral-900">{variantLabel}</p>
                      {product.spec && (
                        <p className="text-xs text-neutral-500 mt-0.5">{product.spec} mm</p>
                      )}
                      {product.thickness && (
                        <p className="text-xs text-neutral-400">厚度 {product.thickness} mm</p>
                      )}
                    </div>
                    {/* 價格與按鈕 */}
                    <div className="flex flex-col items-end space-y-2 flex-shrink-0">
                      {product.price_per_piece ? (
                        <p className="text-sm font-bold text-neutral-900">
                          NT$ {product.price_per_piece.toLocaleString()} / {unit}
                        </p>
                      ) : null}
                      <div className="flex space-x-2">
                        <button
                          onClick={() => { setShowVariantModal(false); setSelectedWallpaper(product); setLightboxIdx(0); }}
                          className="border border-neutral-300 text-neutral-700 px-3 py-1.5 text-xs hover:border-neutral-900 hover:text-neutral-900 transition-colors"
                        >
                          查看詳情
                        </button>
                        <button
                          onClick={() => { setShowVariantModal(false); openAddModal(product); }}
                          disabled={product.stock === 0}
                          className="bg-neutral-900 text-white px-3 py-1.5 text-xs hover:bg-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-1"
                        >
                          <Plus size={11}/><span>{product.stock === 0 ? '缺貨' : '加入詢價'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ 產品詳細 Modal ══════════════ */}
      {selectedWallpaper && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => setSelectedWallpaper(null)}>
          <div className="bg-white max-w-5xl w-full max-h-[90vh] overflow-y-auto md:overflow-hidden md:h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="relative grid grid-cols-1 md:grid-cols-2 md:h-full">
              <button onClick={() => setSelectedWallpaper(null)} className="absolute top-4 right-4 z-10 bg-white/90 p-2 hover:bg-white">
                <X size={24} className="text-neutral-900"/>
              </button>

                {/* 圖片輪播 */}
                <div className="bg-neutral-100 flex flex-col md:h-full">
                  {/* 大圖區：固定視窗，圖片填入 */}
                  <div className="relative h-[40vw] min-h-[220px] max-h-[55vh] md:max-h-none md:flex-1">
                    {(() => { const { src, deg } = parseImgRotation(images[lightboxIdx] || PLACEHOLDER_IMG); return (
                    <img src={src} alt={selectedWallpaper.title} className="absolute inset-0 w-full h-full object-contain" style={deg ? { transform: `rotate(${deg}deg)` } : undefined} onError={e => { (e.target as HTMLImageElement).src = PLACEHOLDER_IMG; }}/>
                    ); })()}
                    {images.length > 1 && (
                      <>
                        <button onClick={() => setLightboxIdx(i => (i - 1 + images.length) % images.length)}
                          className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/80 p-2 hover:bg-white z-10"><ChevronLeft size={20}/></button>
                        <button onClick={() => setLightboxIdx(i => (i + 1) % images.length)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/80 p-2 hover:bg-white z-10"><ChevronRight size={20}/></button>
                      </>
                    )}
                  </div>
                  {/* 小圖縮圖列 */}
                  {images.length > 1 && (
                    <>
                      <div className="flex justify-center space-x-1 pt-2 pb-1 flex-shrink-0">
                        {images.map((_, i) => (
                          <button key={i} onClick={() => setLightboxIdx(i)}
                            className={`w-2 h-2 rounded-full transition-colors ${i === lightboxIdx ? 'bg-neutral-900' : 'bg-neutral-300'}`}/>
                        ))}
                      </div>
                      <div className="flex space-x-2 px-4 pb-4 pt-1 overflow-x-auto flex-shrink-0">
                        {images.map((url, i) => {
                          const { src, deg } = parseImgRotation(url);
                          return <img key={i} src={src} onClick={() => setLightboxIdx(i)}
                            style={deg ? { transform: `rotate(${deg}deg)` } : undefined}
                            className={`w-16 h-12 object-cover flex-shrink-0 cursor-pointer border-2 transition-colors ${i === lightboxIdx ? 'border-neutral-900' : 'border-transparent hover:border-neutral-400'}`}/>;
                        })}
                      </div>
                    </>
                  )}
                </div>

                {/* 產品資訊 */}
                <div className="md:h-full md:overflow-y-auto p-8 md:p-10 space-y-5">
                  <div>
                    <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">產品詳情</p>
                    <h2 className="text-2xl font-bold text-neutral-900">{selectedWallpaper.title}</h2>
                  </div>

                  <div className="border-t border-neutral-200 pt-4 space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-neutral-500">分類</span>
                      <span className="text-neutral-900">{selectedWallpaper.category}</span>
                    </div>
                    {selectedWallpaper.spec && (
                      <div className="flex justify-between">
                        <span className="text-neutral-500">規格</span>
                        <span className="text-neutral-900">{selectedWallpaper.spec} mm</span>
                      </div>
                    )}
                    {selectedWallpaper.thickness && (
                      <div className="flex justify-between">
                        <span className="text-neutral-500">厚度</span>
                        <span className="text-neutral-900">{selectedWallpaper.thickness} mm</span>
                      </div>
                    )}
                    {selectedWallpaper.price_per_piece ? (
                      <div className="flex justify-between items-center">
                        <span className="text-neutral-500">報價</span>
                        <span className="text-xl font-bold text-neutral-900">
                          NT$ {selectedWallpaper.price_per_piece.toLocaleString()} / {getUnit(selectedWallpaper.title)}
                        </span>
                      </div>
                    ) : null}
                    {selectedWallpaper.stock === 0 && (
                      <div className="flex justify-between">
                        <span className="text-neutral-500">狀態</span>
                        <span className="text-red-500 font-medium">缺貨</span>
                      </div>
                    )}
                  </div>

                  {/* 同系列其他規格 */}
                  {(() => {
                    const groupName = getGroupName(selectedWallpaper.title);
                    const siblings = wallpapers.filter(w =>
                      w.id !== selectedWallpaper.id &&
                      getGroupName(w.title) === groupName
                    );
                    if (siblings.length === 0) return null;
                    return (
                      <div className="border-t border-neutral-200 pt-4">
                        <p className="text-xs text-neutral-500 uppercase tracking-wider mb-3">同系列其他規格</p>
                        <div className="space-y-2">
                          {siblings.map(s => (
                            <button
                              key={s.id}
                              onClick={() => { setSelectedWallpaper(s); setLightboxIdx(0); }}
                              className="w-full flex items-center justify-between px-3 py-2.5 border border-neutral-200 hover:border-neutral-900 transition-colors group text-sm"
                            >
                              <div className="flex items-center space-x-3 text-left">
                                {(() => { const { src: sSrc, deg: sDeg } = parseImgRotation(s.image_url || ''); return (
                                <img src={sSrc || PLACEHOLDER_IMG} style={sDeg ? { transform: `rotate(${sDeg}deg)` } : undefined} className="w-10 h-8 object-contain bg-neutral-50" onError={e => { (e.target as HTMLImageElement).src = PLACEHOLDER_IMG; }}/>
                                ); })()}
                                <div>
                                  <p className="text-neutral-700 group-hover:text-neutral-900 font-medium">{getVariantLabel(s)}</p>
                                  {s.thickness && <p className="text-xs text-neutral-400">厚度 {s.thickness} mm</p>}
                                </div>
                              </div>
                              <div className="text-right">
                                {s.price_per_piece && (
                                  <p className="font-bold text-neutral-900">NT$ {s.price_per_piece.toLocaleString()}</p>
                                )}
                                {s.stock === 0 && (
                                  <p className="text-xs text-red-400">缺貨</p>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {selectedWallpaper.stock > 0 && (
                    <button
                      onClick={() => { setSelectedWallpaper(null); openAddModal(selectedWallpaper); }}
                      className="w-full bg-neutral-900 text-white py-3 font-medium hover:bg-neutral-700 transition-colors uppercase text-sm tracking-wider flex items-center justify-center space-x-2"
                    >
                      <ShoppingCart size={16}/><span>加入詢價單</span>
                    </button>
                  )}
                </div>
              </div>
          </div>
        </div>
      )}

      {/* ══════════════ 購物車側欄 ══════════════ */}
      {showCart && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/50" onClick={() => setShowCart(false)}/>
          <div className="w-full max-w-md bg-white flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
              <h2 className="text-lg font-bold text-neutral-900 uppercase tracking-wider">詢價單 ({cartCount})</h2>
              <button onClick={() => setShowCart(false)}><X size={20} className="text-neutral-600"/></button>
            </div>

            {cart.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">詢價單是空的</div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                  {cart.map(item => {
                    const { src: cartImgSrc, deg: cartImgDeg } = parseImgRotation(item.wallpaper.image_url || '');
                    return (
                    <div key={item.wallpaper.id} className="flex items-center space-x-3">
                      <img src={cartImgSrc || PLACEHOLDER_IMG} alt={item.wallpaper.title} style={cartImgDeg ? { transform: `rotate(${cartImgDeg}deg)` } : undefined} className="w-16 h-12 object-cover bg-neutral-100" onError={e => { (e.target as HTMLImageElement).src = PLACEHOLDER_IMG; }}/>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-neutral-900 truncate">{item.wallpaper.title}</p>
                        {item.wallpaper.price_per_piece && (
                          <p className="text-xs text-neutral-500">
                            NT$ {item.wallpaper.price_per_piece.toLocaleString()} / {getUnit(item.wallpaper.title)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center space-x-1">
                        <button onClick={() => updateCartQty(item.wallpaper.id, item.quantity - 1)} className="p-1 border border-neutral-300 hover:bg-neutral-100"><Minus size={12}/></button>
                        <span className="w-8 text-center text-sm">{item.quantity}</span>
                        <button onClick={() => updateCartQty(item.wallpaper.id, Math.min(item.quantity + 1, item.wallpaper.stock))} className="p-1 border border-neutral-300 hover:bg-neutral-100"><Plus size={12}/></button>
                      </div>
                      <button onClick={() => removeFromCart(item.wallpaper.id)} className="p-1 text-neutral-400 hover:text-red-500"><Trash2 size={14}/></button>
                    </div>
                  );})}
                </div>

                <div className="border-t border-neutral-200 px-6 py-4 space-y-3">
                  {cartTotal > 0 && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm text-neutral-600">
                        <span>小計</span>
                        <span>NT$ {cartTotal.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm text-neutral-600">
                        <span>營業稅 5%</span>
                        <span>NT$ {Math.round(cartTotal * 0.05).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between text-sm font-bold text-neutral-900 pt-1 border-t border-neutral-200">
                        <span>總計</span>
                        <span>NT$ {Math.round(cartTotal * 1.05).toLocaleString()}</span>
                      </div>
                      <p className="text-xs text-neutral-500 mt-1">* 運費另計</p>
                    </div>
                  )}
                  <button
                    onClick={() => { setShowCart(false); setShowCheckout(true); }}
                    className="w-full bg-neutral-900 text-white py-3 font-medium hover:bg-neutral-700 transition-colors uppercase text-sm tracking-wider"
                  >
                    填寫資料送出詢價
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══════════════ 結帳 Modal ══════════════ */}
      {showCheckout && !orderResult && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-neutral-200 px-6 py-5 flex justify-between items-center">
              <h2 className="text-lg font-bold text-neutral-900 uppercase tracking-wider">填寫詢價資料</h2>
              <button onClick={() => setShowCheckout(false)} className="p-1 text-neutral-400 hover:text-neutral-700 transition-colors"><X size={20}/></button>
            </div>

            <div className="px-6 py-6 space-y-5">
              {/* 詢價清單 */}
              <div className="border border-neutral-200">
                <div className="bg-neutral-50 px-4 py-3 border-b border-neutral-200">
                  <p className="text-xs font-medium text-neutral-600 uppercase tracking-wider">詢價清單</p>
                </div>
                <div className="divide-y divide-neutral-100">
                  {cart.map(item => {
                    const { src: coSrc, deg: coDeg } = parseImgRotation(item.wallpaper.image_url || '');
                    return (
                    <div key={item.wallpaper.id} className="flex items-center justify-between px-4 py-3">
                      <div className="flex items-center gap-3">
                        <img src={coSrc || PLACEHOLDER_IMG} alt="" style={coDeg ? { transform: `rotate(${coDeg}deg)` } : undefined} className="w-10 h-10 object-cover bg-neutral-100" onError={e => { (e.target as HTMLImageElement).src = PLACEHOLDER_IMG; }}/>
                        <div>
                          <p className="text-sm text-neutral-900">{item.wallpaper.title}</p>
                          <p className="text-xs text-neutral-500">x {item.quantity}</p>
                        </div>
                      </div>
                      {item.wallpaper.price_per_piece && (
                        <span className="text-sm text-neutral-900 font-medium">NT$ {(item.wallpaper.price_per_piece * item.quantity).toLocaleString()}</span>
                      )}
                    </div>
                  );})}
                </div>
                {cartTotal > 0 && (
                  <div className="border-t border-neutral-200 px-4 py-3 space-y-1">
                    <div className="flex justify-between text-sm text-neutral-600">
                      <span>小計</span><span>NT$ {cartTotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm text-neutral-600">
                      <span>營業稅 5%</span><span>NT$ {Math.round(cartTotal * 0.05).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold text-neutral-900 pt-1 border-t border-neutral-100">
                      <span>總計</span><span>NT$ {Math.round(cartTotal * 1.05).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-neutral-500 mt-1">* 運費另計</p>
                  </div>
                )}
              </div>

              {/* 客戶資料 */}
              <div>
                <p className="text-xs font-medium text-neutral-600 uppercase tracking-wider mb-3">客戶資料</p>
                <div className="space-y-3">
                  {[
                    { label: '姓名 *', key: 'name', type: 'text', required: true, placeholder: '請輸入姓名' },
                    { label: 'Email *', key: 'email', type: 'email', required: true, placeholder: '請輸入電子郵件' },
                    { label: '聯絡電話 *', key: 'phone', type: 'tel', required: true, placeholder: '請輸入聯絡電話' },
                    { label: '公司名稱', key: 'company', type: 'text', required: false, placeholder: '請輸入公司名稱' },
                    { label: '統一編號', key: 'tax_id', type: 'text', required: false, placeholder: '請輸入統一編號' },
                    { label: '送貨地址', key: 'shipping_address', type: 'text', required: false, placeholder: '請輸入送貨地址' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="block text-xs font-medium text-neutral-600 mb-1.5">{f.label}</label>
                      <input
                        type={f.type}
                        required={f.required}
                        placeholder={f.placeholder}
                        value={checkoutForm[f.key as keyof typeof checkoutForm]}
                        onChange={e => setCheckoutForm({ ...checkoutForm, [f.key]: e.target.value })}
                        className="w-full px-4 py-2.5 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm placeholder:text-neutral-400"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs font-medium text-neutral-600 mb-1.5">備註</label>
                    <textarea rows={3} value={checkoutForm.notes}
                      onChange={e => setCheckoutForm({ ...checkoutForm, notes: e.target.value })}
                      placeholder="如有特殊需求請在此說明"
                      className="w-full px-4 py-2.5 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm resize-none placeholder:text-neutral-400"/>
                  </div>
                </div>
              </div>

              <button
                onClick={handleSubmitOrder}
                disabled={submitting || !checkoutForm.name || !checkoutForm.email || !checkoutForm.phone}
                className="w-full bg-neutral-900 text-white py-3 font-medium hover:bg-neutral-700 transition-colors uppercase text-sm tracking-wider disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? '送出中...' : '確認送出詢價單'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ 訂單完成 Modal ══════════════ */}
      {orderResult && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full p-8 text-center">
            {orderResult.success ? (
              <>
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/>
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-neutral-900 mb-2">詢價單送出成功！</h3>
                <p className="text-neutral-600 mb-2">訂單編號：<span className="font-mono font-bold">{orderResult.orderNumber}</span></p>
                <p className="text-sm text-neutral-500 mb-4">我們將盡快與您聯繫確認報價細節。</p>
                <div className="bg-green-50 border border-green-200 rounded px-4 py-3 mb-6">
                  <p className="text-sm text-green-800 mb-2">請加入官方 LINE 傳送訊息確認訂單資訊，方便後續聯繫</p>
                  <a href="https://lin.ee/rohhrPR" target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-[#06C755] text-white px-5 py-2 text-sm font-medium rounded hover:bg-[#05b04c] transition-colors">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63h2.386c.349 0 .63.285.63.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/></svg>
                    加入官方 LINE
                  </a>
                </div>
              </>
            ) : (
              <>
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <X size={32} className="text-red-600"/>
                </div>
                <h3 className="text-xl font-bold text-neutral-900 mb-2">送出失敗</h3>
                {orderResult.message && (
                  <p className="text-red-600 text-sm bg-red-50 border border-red-200 px-4 py-2 mb-3">{orderResult.message}</p>
                )}
                <p className="text-neutral-600 mb-6">請稍後再試，或直接與我們聯繫。</p>
              </>
            )}
            <button
              onClick={() => { setOrderResult(null); setShowCheckout(false); }}
              className="w-full bg-neutral-900 text-white py-3 hover:bg-neutral-700 transition-colors text-sm font-medium uppercase tracking-wider"
            >
              關閉
            </button>
          </div>
        </div>
      )}

      {/* ══════════════ 數量選擇 Modal ══════════════ */}
      {addingItem && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white max-w-sm w-full p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-xs text-neutral-500 uppercase tracking-wider mb-1">加入詢價單</p>
                <h3 className="text-base font-bold text-neutral-900 leading-snug">{addingItem.title}</h3>
              </div>
              <button onClick={() => setAddingItem(null)} className="text-neutral-400 hover:text-neutral-700 ml-2 mt-0.5"><X size={18}/></button>
            </div>

            {addingItem.price_per_piece && (
              <p className="text-sm text-neutral-700 mb-1">
                單價：<span className="font-bold">NT$ {addingItem.price_per_piece.toLocaleString()}</span> / {getUnit(addingItem.title)}
                {isSetProduct(addingItem.title) && (
                  <span className="ml-2 text-xs text-amber-700 font-normal">（5 片 / 組）</span>
                )}
              </p>
            )}

            <div className="mb-5">
              <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wider mb-2">
                數量（{getUnit(addingItem.title)}）
              </label>
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setAddQty(q => Math.max(1, q - 1))}
                  className="w-9 h-9 border border-neutral-300 flex items-center justify-center hover:bg-neutral-100 transition-colors"
                ><Minus size={14}/></button>
                <input
                  type="number"
                  min={1}
                  max={addingItem.stock}
                  value={addQty}
                  onChange={e => setAddQty(Math.min(Math.max(1, parseInt(e.target.value) || 1), addingItem!.stock))}
                  className="w-16 text-center border border-neutral-300 py-2 text-sm focus:outline-none focus:border-neutral-900"
                />
                <button
                  onClick={() => setAddQty(q => Math.min(q + 1, addingItem!.stock))}
                  className="w-9 h-9 border border-neutral-300 flex items-center justify-center hover:bg-neutral-100 transition-colors"
                ><Plus size={14}/></button>
              </div>
              {/* 普通石皮換算提示 */}
              {isSetProduct(addingItem.title) && (
                <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
                  購買 {addQty} 組 = {addQty * 5} 片
                </p>
              )}
            </div>

            {addingItem.price_per_piece && (
              <div className="border-t border-neutral-100 pt-3 mb-4 space-y-1">
                <div className="flex justify-between text-sm text-neutral-600">
                  <span>小計</span>
                  <span>NT$ {(addingItem.price_per_piece * addQty).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm text-neutral-600">
                  <span>營業稅 5%</span>
                  <span>NT$ {Math.round(addingItem.price_per_piece * addQty * 0.05).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-neutral-900 pt-1 border-t border-neutral-100">
                  <span>總計</span>
                  <span>NT$ {Math.round(addingItem.price_per_piece * addQty * 1.05).toLocaleString()}</span>
                </div>
                <p className="text-xs text-neutral-500 mt-1">* 運費另計</p>
              </div>
            )}

            <div className="flex space-x-3">
              <button onClick={() => setAddingItem(null)} className="flex-1 border border-neutral-300 text-neutral-700 py-2.5 text-sm hover:bg-neutral-50 transition-colors">取消</button>
              <button
                onClick={confirmAdd}
                className="flex-1 bg-neutral-900 text-white py-2.5 text-sm font-medium hover:bg-neutral-700 transition-colors flex items-center justify-center space-x-2"
              >
                <ShoppingCart size={14}/><span>加入詢價單</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════ 成功加入 Toast ══════════════ */}
      {addedToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center space-x-3 bg-neutral-900 text-white px-5 py-3 shadow-lg animate-bounce-in">
          <CheckCircle size={18} className="text-green-400 flex-shrink-0"/>
          <div>
            <p className="text-sm font-medium">已加入詢價單</p>
            <p className="text-xs text-neutral-400 truncate max-w-[200px]">{addedToast}</p>
          </div>
          <button onClick={() => { setAddedToast(null); setShowCart(true); }} className="text-xs text-neutral-300 hover:text-white underline whitespace-nowrap ml-2">查看</button>
        </div>
      )}
    </div>
  );
}

export default App;
