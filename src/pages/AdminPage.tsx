import { useState, useEffect, useRef } from 'react';
import { computeMarginRatio, computeCostPerPiece, shouldShowMarginPreview, computeMarginPercent } from '../lib/wallpaper-utils';
import { Plus, Power, PowerOff, Edit2, Trash2, ArrowLeft, LogOut, X, ArrowUp, ArrowDown, Package, ShoppingBag, Upload, AlertCircle, CheckCircle, LayoutDashboard, FileText, RotateCw } from 'lucide-react';
import { supabase, uploadProductImage } from '../lib/supabase';
import type { Wallpaper, Order } from '../lib/supabase';
import DashboardPage from './DashboardPage';

// ===================== 型別定義 =====================

interface Category {
  id: string;
  name: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface ContactMessage {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  message: string;
  category: string;
  is_read: boolean;
  created_at: string;
  updated_at: string;
}

interface AdminPageProps {
  onBack: () => void;
  onLogout: () => void;
}



// ===================== 主元件 =====================

export default function AdminPage({ onBack, onLogout }: AdminPageProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'wallpapers' | 'categories' | 'messages' | 'orders' | 'customers'>('dashboard');
  const [wallpapers, setWallpapers] = useState<Wallpaper[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [messages, setMessages] = useState<ContactMessage[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAddCategoryForm, setShowAddCategoryForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingWallpaper, setEditingWallpaper] = useState<Wallpaper | null>(null);
  const [editingImageUrls, setEditingImageUrls] = useState<string>('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [editingOrderItems, setEditingOrderItems] = useState<any[]>([]);
  const [addProductSearch, setAddProductSearch] = useState('');
  const [viewingOrder, setViewingOrder] = useState<Order | null>(null);
  const [newWallpaper, setNewWallpaper] = useState({ title: '', category: '', image_url: '', stock: 0 });
  const [newCategory, setNewCategory] = useState({ name: '', display_order: 0 });
  const [viewingMessage, setViewingMessage] = useState<ContactMessage | null>(null);

  // ── 檔案上傳 ──
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 圖片旋轉狀態 ──
  // 使用 URL hash 儲存旋轉角度，格式: url#r90, url#r180, url#r270
  // 不需要 CORS，純 CSS 旋轉
  const [rotatingIndex, setRotatingIndex] = useState<number | null>(null);

  // ── 圖片上傳狀態 ──
  const [uploading, setUploading] = useState(false);
  const imageUploadInputRef = useRef<HTMLInputElement>(null);

  const parseRotation = (url: string): { baseUrl: string; deg: number } => {
    const match = url.match(/#r(\d+)$/);
    return match ? { baseUrl: url.replace(/#r\d+$/, ''), deg: parseInt(match[1]) } : { baseUrl: url, deg: 0 };
  };

  const rotateImage = (index: number) => {
    const urls = editingImageUrls.split('\n').map(u => u.trim()).filter(Boolean);
    const url = urls[index];
    if (!url) return;
    const { baseUrl, deg } = parseRotation(url);
    const newDeg = (deg + 90) % 360;
    const newUrls = [...urls];
    newUrls[index] = newDeg === 0 ? baseUrl : `${baseUrl}#r${newDeg}`;
    setEditingImageUrls(newUrls.join('\n'));
  };

  const deleteImage = (index: number) => {
    const urls = editingImageUrls.split('\n').map(u => u.trim()).filter(Boolean);
    const newUrls = urls.filter((_, i) => i !== index);
    setEditingImageUrls(newUrls.join('\n'));
  };

  const handleImageUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const urls = editingImageUrls.trim() ? editingImageUrls.split('\n').map(u => u.trim()).filter(Boolean) : [];
      for (let i = 0; i < files.length; i++) {
        const url = await uploadProductImage(files[i]);
        urls.push(url);
      }
      setEditingImageUrls(urls.join('\n'));
    } catch (err) {
      alert('上傳失敗：' + (err instanceof Error ? err.message : '未知錯誤'));
    } finally {
      setUploading(false);
      if (imageUploadInputRef.current) imageUploadInputRef.current.value = '';
    }
  };

  // ── 客戶管理狀態 ──
  const [dbCustomers, setDbCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [viewingCustomer, setViewingCustomer] = useState<any | null>(null);
  const [editingDbCustomer, setEditingDbCustomer] = useState<Customer | null>(null);
  const [showAddCustomerForm, setShowAddCustomerForm] = useState(false);
  const [newCustomerForm, setNewCustomerForm] = useState({ name: '', email: '', phone: '', company: '', notes: '' });
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeSourceKey, setMergeSourceKey] = useState('');   // the customer being absorbed
  const [mergeTargetKey, setMergeTargetKey] = useState('');   // the customer to keep
  const [mergingCustomer, setMergingCustomer] = useState(false);
  const [orderSourceCustomer, setOrderSourceCustomer] = useState<any | null>(null);

  // ── 訂單搜尋 ──
  const [orderFilterText, setOrderFilterText] = useState('');

  // ── 產品排序狀態 ──
  const [sortKey, setSortKey]   = useState<'title' | 'category' | 'stock' | 'price_per_piece' | 'cost_per_piece' | 'margin'  | 'is_active' | null>(null);
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('asc');
  const [filterText, setFilterText] = useState('');

  // ── 產品分頁狀態 ──
  const WALLPAPER_PAGE_SIZE = 20;
  const [wallpaperPage, setWallpaperPage] = useState(1);

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
    setWallpaperPage(1);
  };

  const sortedWallpapers = [...wallpapers]
    .filter(w => !filterText || w.title.toLowerCase().includes(filterText.toLowerCase()) || (w.category || '').toLowerCase().includes(filterText.toLowerCase()) || (w.product_code || '').toLowerCase().includes(filterText.toLowerCase()))
    .sort((a, b) => {
      if (!sortKey) return 0;
      let va: any, vb: any;
      if (sortKey === 'margin') {
        va = (a.price_per_piece && a.cost_per_piece) ? (a.price_per_piece - a.cost_per_piece) / a.price_per_piece : -1;
        vb = (b.price_per_piece && b.cost_per_piece) ? (b.price_per_piece - b.cost_per_piece) / b.price_per_piece : -1;
      } else if (sortKey === 'is_active') {
        va = a.is_active ? 1 : 0; vb = b.is_active ? 1 : 0;
      } else {
        va = (a as any)[sortKey] ?? ''; vb = (b as any)[sortKey] ?? '';
      }
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });

  const totalWallpaperPages = Math.ceil(sortedWallpapers.length / WALLPAPER_PAGE_SIZE);
  const pagedWallpapers = sortedWallpapers.slice(
    (wallpaperPage - 1) * WALLPAPER_PAGE_SIZE,
    wallpaperPage * WALLPAPER_PAGE_SIZE
  );

  // ===================== 資料載入 =====================

  useEffect(() => {
    fetchWallpapers();
    fetchCategories();
    fetchMessages();
    fetchOrders();
    fetchDbCustomers();
  }, []);

  const fetchWallpapers = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('wallpapers').select('*').order('created_at', { ascending: false });
    if (!error) setWallpapers(data || []);
    setLoading(false);
  };

  const fetchCategories = async () => {
    const { data, error } = await supabase.from('categories').select('*').order('display_order', { ascending: true });
    if (!error) setCategories(data || []);
  };

  const fetchMessages = async () => {
    const { data, error } = await supabase.from('contact_messages').select('*').order('created_at', { ascending: false });
    if (!error) setMessages(data || []);
  };

  const fetchOrders = async () => {
    const { data: ordersData, error: ordersError } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
    if (ordersError) return;
    const { data: itemsData, error: itemsError } = await supabase.from('order_items').select('*, wallpapers(*)');
    if (itemsError) return;
    const ordersWithItems = (ordersData || []).map(order => ({
      ...order,
      order_items: (itemsData || [])
        .filter((item: any) => item.order_id === order.id)
        .map((item: any) => ({ id: item.id, order_id: item.order_id, wallpaper_id: item.wallpaper_id, quantity: item.quantity, unit_price: item.unit_price, subtotal: item.subtotal, created_at: item.created_at, wallpaper: item.wallpapers }))
    }));
    setOrders(ordersWithItems);
  };

  // ===================== 客戶管理 =====================

  const fetchDbCustomers = async () => {
    const { data, error } = await supabase.from('customers').select('*').order('created_at', { ascending: false });
    if (!error) setDbCustomers(data || []);
  };

  // 從 orders 派生的客戶列表（按 email 優先、phone 次之去重）
  const derivedCustomers = (() => {
    const map = new Map<string, any>();
    orders.forEach(o => {
      const key = (o.customer_email || '').trim() || (o.customer_phone || '').trim();
      if (!key) return;
      const ex = map.get(key);
      if (ex) {
        ex.orderCount += 1;
        ex.totalAmount += o.total_amount || 0;
        if (o.created_at > ex.lastOrderAt) { ex.lastOrderAt = o.created_at; ex.name = o.customer_name; ex.company = o.customer_company || ex.company; }
      } else {
        map.set(key, { key, name: o.customer_name, email: o.customer_email || '', phone: o.customer_phone || '', company: o.customer_company || '', orderCount: 1, totalAmount: o.total_amount || 0, lastOrderAt: o.created_at });
      }
    });
    return Array.from(map.values());
  })();

  // 合併 customers table + derived：DB 記錄為主，否則顯示派生資料
  const unifiedCustomers = (() => {
    const result: any[] = [];
    const usedKeys = new Set<string>();

    // 先放 DB 記錄
    dbCustomers.forEach(c => {
      const derived = derivedCustomers.find(d =>
        (c.email && d.email && c.email === d.email) ||
        (c.phone && d.phone && c.phone === d.phone)
      );
      usedKeys.add(derived?.key || '');
      result.push({ ...c, key: derived?.key || c.id, orderCount: derived?.orderCount || 0, totalAmount: derived?.totalAmount || 0, lastOrderAt: derived?.lastOrderAt || c.created_at, hasRecord: true });
    });

    // 再加沒有 DB 記錄的派生客戶
    derivedCustomers.forEach(d => {
      if (!usedKeys.has(d.key)) {
        result.push({ ...d, id: null, notes: '', hasRecord: false });
      }
    });

    return result.sort((a, b) => b.lastOrderAt.localeCompare(a.lastOrderAt));
  })();

  const getCustomerOrders = (customer: any) =>
    orders.filter(o =>
      (customer.email && o.customer_email === customer.email) ||
      (customer.phone && o.customer_phone === customer.phone)
    );

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from('customers').insert([{ ...newCustomerForm, updated_at: new Date().toISOString() }]);
    if (error) { alert('新增失敗：' + error.message); return; }
    setNewCustomerForm({ name: '', email: '', phone: '', company: '', notes: '' });
    setShowAddCustomerForm(false);
    fetchDbCustomers();
  };

  const handleUpdateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDbCustomer) return;
    const { error } = await supabase.from('customers').update({ name: editingDbCustomer.name, email: editingDbCustomer.email, phone: editingDbCustomer.phone, company: editingDbCustomer.company, notes: editingDbCustomer.notes, updated_at: new Date().toISOString() }).eq('id', editingDbCustomer.id);
    if (error) { alert('更新失敗：' + error.message); return; }
    setEditingDbCustomer(null);
    if (viewingCustomer?.id === editingDbCustomer.id) setViewingCustomer({ ...viewingCustomer, ...editingDbCustomer });
    fetchDbCustomers();
  };

  const handleDeleteCustomer = async (id: string) => {
    if (!confirm('確定要刪除這筆客戶記錄嗎？（訂單資料不受影響）')) return;
    const { error } = await supabase.from('customers').delete().eq('id', id);
    if (error) alert('刪除失敗：' + error.message);
    else { fetchDbCustomers(); if (viewingCustomer?.id === id) setViewingCustomer(null); }
  };

  // 將 sourceKey 的所有訂單合併到 targetCustomer，並刪除 sourceKey 的 DB 記錄（若有）
  const handleMergeCustomers = async () => {
    if (!mergeSourceKey || !mergeTargetKey || mergeSourceKey === mergeTargetKey) return;
    const target = unifiedCustomers.find(c => c.key === mergeTargetKey);
    if (!target) return;
    setMergingCustomer(true);
    // 更新所有 source 訂單：改用 target 的 email/phone
    const sourceOrders = orders.filter(o =>
      (o.customer_email && o.customer_email === mergeSourceKey) ||
      (o.customer_phone && o.customer_phone === mergeSourceKey)
    );
    for (const o of sourceOrders) {
      await supabase.from('orders').update({ customer_email: target.email || o.customer_email, customer_phone: target.phone || o.customer_phone, updated_at: new Date().toISOString() }).eq('id', o.id);
    }
    // 刪除 source 的 DB 記錄（若有）
    const sourceRecord = dbCustomers.find(c => c.email === mergeSourceKey || c.phone === mergeSourceKey);
    if (sourceRecord) await supabase.from('customers').delete().eq('id', sourceRecord.id);
    await fetchOrders();
    await fetchDbCustomers();
    setMergingCustomer(false);
    setShowMergeModal(false);
    setMergeSourceKey('');
    setMergeTargetKey('');
    alert('合併完成！');
  };

  // 將某個派生客戶另存為正式客戶記錄
  const handleSaveDerivedAsCustomer = async (derived: any) => {
    const { error } = await supabase.from('customers').insert([{ name: derived.name, email: derived.email, phone: derived.phone, company: derived.company, notes: '', updated_at: new Date().toISOString() }]);
    if (error) { alert('建立失敗：' + error.message); return; }
    fetchDbCustomers();
  };

  // ===================== 批次上傳：解析 Excel =====================


  // ===================== 產品 CRUD =====================

  const handleAddWallpaper = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from('wallpapers').insert([{ title: newWallpaper.title, category: newWallpaper.category, image_url: newWallpaper.image_url, stock: newWallpaper.stock, is_active: true }]);
    if (error) { alert('新增失敗：' + error.message); return; }
    setNewWallpaper({ title: '', category: '', image_url: '', stock: 0 });
    setShowAddForm(false);
    fetchWallpapers();
  };

  const handleUpdateWallpaper = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWallpaper) return;
    const imageUrlsArray = editingImageUrls.split('\n').map(u => u.trim()).filter(Boolean);
    const coverUrl = imageUrlsArray[0] || '';
    const { error } = await supabase.from('wallpapers').update({
      title: editingWallpaper.title,
      category: editingWallpaper.category,
      image_url: coverUrl,
      image_urls: imageUrlsArray,
      stock: editingWallpaper.stock,
      updated_at: new Date().toISOString()
    }).eq('id', editingWallpaper.id);
    if (error) { alert('更新失敗：' + error.message); return; }
    setEditingWallpaper(null);
    setEditingImageUrls('');
    fetchWallpapers();
  };

  const toggleWallpaperStatus = async (id: string, cur: boolean) => {
    const { error } = await supabase.from('wallpapers').update({ is_active: !cur, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) alert('更新失敗：' + error.message);
    else fetchWallpapers();
  };

  const deleteWallpaper = async (id: string) => {
    if (!confirm('確定要刪除這項產品嗎？')) return;
    const { error } = await supabase.from('wallpapers').delete().eq('id', id);
    if (error) alert('刪除失敗：' + error.message);
    else fetchWallpapers();
  };

  // ===================== 分類 CRUD =====================

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const maxOrder = categories.length ? Math.max(...categories.map(c => c.display_order)) : -1;
    const { error } = await supabase.from('categories').insert([{ name: newCategory.name, display_order: maxOrder + 1, is_active: true }]);
    if (error) { alert('新增失敗：' + error.message); return; }
    setNewCategory({ name: '', display_order: 0 });
    setShowAddCategoryForm(false);
    fetchCategories();
  };

  const handleUpdateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory) return;
    const orderExists = categories.some(c => c.display_order === editingCategory.display_order && c.id !== editingCategory.id);
    if (orderExists) { alert('此顯示順序已存在，請使用不同的順序號碼'); return; }
    const { error } = await supabase.from('categories').update({ name: editingCategory.name, display_order: editingCategory.display_order, updated_at: new Date().toISOString() }).eq('id', editingCategory.id);
    if (error) { alert('更新失敗：' + error.message); return; }
    setEditingCategory(null);
    fetchCategories();
  };

  const toggleCategoryStatus = async (id: string, cur: boolean) => {
    const { error } = await supabase.from('categories').update({ is_active: !cur, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) alert('更新失敗：' + error.message);
    else fetchCategories();
  };

  const deleteCategory = async (id: string) => {
    if (!confirm('確定要刪除這個分類嗎？')) return;
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) alert('刪除失敗：' + error.message);
    else fetchCategories();
  };

  const moveCategoryUp = async (category: Category) => {
    const sorted = [...categories].sort((a, b) => a.display_order - b.display_order);
    const idx = sorted.findIndex(c => c.id === category.id);
    if (idx === 0) return;
    const prev = sorted[idx - 1];
    await supabase.from('categories').update({ display_order: prev.display_order }).eq('id', category.id);
    await supabase.from('categories').update({ display_order: category.display_order }).eq('id', prev.id);
    fetchCategories();
  };

  const moveCategoryDown = async (category: Category) => {
    const sorted = [...categories].sort((a, b) => a.display_order - b.display_order);
    const idx = sorted.findIndex(c => c.id === category.id);
    if (idx === sorted.length - 1) return;
    const next = sorted[idx + 1];
    await supabase.from('categories').update({ display_order: next.display_order }).eq('id', category.id);
    await supabase.from('categories').update({ display_order: category.display_order }).eq('id', next.id);
    fetchCategories();
  };

  // ===================== 訊息 =====================

  const markMessageAsRead = async (id: string) => {
    await supabase.from('contact_messages').update({ is_read: true, updated_at: new Date().toISOString() }).eq('id', id);
    fetchMessages();
  };

  const handleCloseMessageModal = () => {
    if (viewingMessage && !viewingMessage.is_read) markMessageAsRead(viewingMessage.id);
    setViewingMessage(null);
  };

  const deleteMessage = async (id: string) => {
    if (!confirm('確定要刪除這則訊息嗎？')) return;
    const { error } = await supabase.from('contact_messages').delete().eq('id', id);
    if (error) alert('刪除失敗：' + error.message);
    else fetchMessages();
  };

  // ===================== 訂單 =====================

  // 庫存模型：結帳時 DB trigger 已自動扣庫存（含 pending 狀態），
  // 因此只有進出「已取消」狀態時才需要調整庫存
  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) { alert('找不到訂單'); return; }
    const oldStatus = order.status;
    const wasCancelled = oldStatus === 'cancelled';
    const isCancelled  = newStatus === 'cancelled';
    if (wasCancelled !== isCancelled && order.order_items) {
      for (const item of order.order_items) {
        const wp = wallpapers.find(w => w.id === item.wallpaper_id);
        if (!wp) { alert(`找不到產品 ID: ${item.wallpaper_id}`); return; }
        const adj = wasCancelled && !isCancelled ? -item.quantity : item.quantity;
        const newStock = wp.stock + adj;
        if (newStock < 0) { alert(`${wp.title} 庫存不足`); return; }
        await supabase.from('wallpapers').update({ stock: newStock }).eq('id', item.wallpaper_id);
      }
    }
    const { error } = await supabase.from('orders').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', orderId);
    if (error) { alert('更新失敗：' + error.message); return; }
    fetchOrders(); fetchWallpapers();
    if (viewingOrder?.id === orderId) setViewingOrder({ ...viewingOrder, status: newStatus });
  };

  const deleteOrder = async (id: string) => {
    if (!confirm('確定要刪除這筆訂單嗎？')) return;
    const order = orders.find(o => o.id === id);
    if (!order) { alert('找不到訂單'); return; }
    // 已取消的訂單庫存已加回過，其餘狀態（含 pending）刪除時都要加回
    if (order.status !== 'cancelled' && order.order_items) {
      for (const item of order.order_items) {
        const wp = wallpapers.find(w => w.id === item.wallpaper_id);
        if (wp) await supabase.from('wallpapers').update({ stock: wp.stock + item.quantity }).eq('id', item.wallpaper_id);
      }
    }
    const { error } = await supabase.from('orders').delete().eq('id', id);
    if (error) alert('刪除失敗：' + error.message);
    else { fetchOrders(); fetchWallpapers(); }
  };

  const handleUpdateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingOrder) return;
    const original = orders.find(o => o.id === editingOrder.id);
    if (!original) { alert('找不到原始訂單'); return; }
    const wasCancelled = original.status === 'cancelled';
    const isCancelled  = editingOrder.status === 'cancelled';
    if (wasCancelled !== isCancelled && editingOrder.order_items) {
      for (const item of editingOrder.order_items) {
        const wp = wallpapers.find(w => w.id === item.wallpaper_id);
        if (!wp) { alert(`找不到產品 ID: ${item.wallpaper_id}`); return; }
        const adj = wasCancelled && !isCancelled ? -item.quantity : item.quantity;
        const newStock = wp.stock + adj;
        if (newStock < 0) { alert(`${wp.title} 庫存不足`); return; }
        await supabase.from('wallpapers').update({ stock: newStock }).eq('id', item.wallpaper_id);
      }
    }

    // Save order item changes
    const originalItemIds = (original.order_items || []).map((i: any) => i.id);
    const remaining = editingOrderItems.filter(i => i.quantity > 0);
    if (remaining.length === 0) { alert('訂單至少需要一個項目'); return; }

    // Update existing items
    for (const item of remaining) {
      if (item.id && originalItemIds.includes(item.id)) {
        const subtotal = (item.unit_price || 0) * item.quantity;
        await supabase.from('order_items').update({ quantity: item.quantity, unit_price: item.unit_price || 0, subtotal }).eq('id', item.id);
      }
    }
    // Insert new items
    const newItems = remaining.filter(i => !i.id || !originalItemIds.includes(i.id));
    for (const item of newItems) {
      const subtotal = (item.unit_price || 0) * item.quantity;
      await supabase.from('order_items').insert({ order_id: editingOrder.id, wallpaper_id: item.wallpaper_id, quantity: item.quantity, unit_price: item.unit_price || 0, subtotal });
    }
    // Delete removed items
    const remainingIds = remaining.filter(i => i.id).map(i => i.id);
    const removedIds = originalItemIds.filter((id: string) => !remainingIds.includes(id));
    if (removedIds.length > 0) {
      await supabase.from('order_items').delete().in('id', removedIds);
    }
    // Recalculate total
    const newTotal = remaining.reduce((sum, i) => sum + (i.unit_price || 0) * i.quantity, 0);

    const { error } = await supabase.from('orders').update({ customer_name: editingOrder.customer_name, customer_email: editingOrder.customer_email, customer_phone: editingOrder.customer_phone, customer_company: editingOrder.customer_company, notes: editingOrder.notes, status: editingOrder.status, total_amount: newTotal, updated_at: new Date().toISOString() }).eq('id', editingOrder.id);
    if (error) { alert('更新失敗：' + error.message); return; }
    setEditingOrder(null);
    setEditingOrderItems([]);
    fetchOrders(); fetchWallpapers();
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = { pending: 'bg-yellow-50 text-yellow-700 border-yellow-200', confirmed: 'bg-blue-50 text-blue-700 border-blue-200', completed: 'bg-green-50 text-green-700 border-green-200', cancelled: 'bg-red-50 text-red-700 border-red-200' };
    const labels: Record<string, string> = { pending: '待確認', confirmed: '已確認', completed: '已完成', cancelled: '已取消' };
    return { style: styles[status] || styles.pending, label: labels[status] || status };
  };



  // ===================== 報價單 PDF 匯出 =====================
  // 訂單資料來自前台訪客輸入，內插進 HTML 前必須轉義，防止 stored XSS
  const escapeHtml = (value: string | null | undefined): string =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const exportQuotePDF = (order: Order) => {
    const items = order.order_items || [];
    const rows = items.map(item => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5">${escapeHtml(item.wallpaper?.title) || '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;text-align:center">${escapeHtml(item.wallpaper?.spec) || '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;text-align:center">${item.quantity}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;text-align:right">NT$ ${(item.unit_price || 0).toLocaleString()}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;text-align:right">NT$ ${(item.subtotal || 0).toLocaleString()}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>報價單 ${escapeHtml(order.order_number)}</title>
    <style>body{font-family:sans-serif;font-size:13px;color:#171717;margin:40px}
    h1{font-size:22px;font-weight:700;letter-spacing:2px;margin-bottom:4px}
    table{width:100%;border-collapse:collapse;margin-top:20px}
    th{background:#171717;color:#fff;padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px}
    .totals{text-align:right;margin-top:16px;font-size:13px}
    .totals .row{display:flex;justify-content:flex-end;gap:24px;padding:3px 0;color:#525252}
    .totals .row.grand{font-size:16px;font-weight:700;color:#171717;border-top:1px solid #e5e5e5;margin-top:6px;padding-top:6px}
    .info{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:20px 0;font-size:12px}</style>
    </head><body>
    <h1>材酷建材 CAIKU</h1>
    <p style="color:#737373;font-size:12px">報價單 / Quotation</p>
    <hr style="border:none;border-top:2px solid #171717;margin:16px 0">
    <div class="info">
      <div><b>訂單編號</b>：${escapeHtml(order.order_number)}</div>
      <div><b>日期</b>：${new Date(order.created_at).toLocaleDateString('zh-TW')}</div>
      <div><b>客戶姓名</b>：${escapeHtml(order.customer_name)}</div>
      <div><b>公司</b>：${escapeHtml(order.customer_company) || '—'}</div>
      <div><b>Email</b>：${escapeHtml(order.customer_email)}</div>
      <div><b>電話</b>：${escapeHtml(order.customer_phone) || '—'}</div>
    </div>
    <table>
      <thead><tr>
        <th>產品名稱</th><th style="text-align:center">規格</th>
        <th style="text-align:center">數量</th><th style="text-align:right">單價</th><th style="text-align:right">小計</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="totals">
      <div class="row"><span>小計</span><span>NT$ ${(order.total_amount || 0).toLocaleString()}</span></div>
      <div class="row"><span>營業稅 5%</span><span>NT$ ${Math.round((order.total_amount || 0) * 0.05).toLocaleString()}</span></div>
      <div class="row grand"><span>總計</span><span>NT$ ${Math.round((order.total_amount || 0) * 1.05).toLocaleString()}</span></div>
      <div style="text-align:right;font-size:11px;color:#a3a3a3;margin-top:4px">* 運費另計</div>
    </div>
    ${order.notes ? `<p style="margin-top:20px;color:#737373;font-size:12px;white-space:pre-wrap">備註：${escapeHtml(order.notes)}</p>` : ''}
    <hr style="border:none;border-top:1px solid #e5e5e5;margin-top:40px">
    <p style="color:#a3a3a3;font-size:11px;text-align:center">© 2025 材酷建材 CAIKU</p>
    </body></html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (w) {
      w.onload = () => { URL.revokeObjectURL(url); w.print(); };
    } else {
      // Fallback: download as HTML file
      const a = document.createElement('a');
      a.href = url;
      a.download = `報價單_${order.order_number}.html`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  // ===================== JSX =====================

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* ── 頂部 ── */}
        <div className="mb-12 flex items-center justify-between border-b border-neutral-200 pb-6">
          <div className="flex items-center space-x-6">
            <button onClick={onBack} className="text-neutral-600 hover:text-neutral-900 transition-colors"><ArrowLeft size={24} /></button>
            <h1 className="text-2xl font-bold text-neutral-900 uppercase tracking-wider">管理後台</h1>
          </div>
          <div className="flex items-center space-x-4">
            {activeTab === 'wallpapers' && (
              <button onClick={() => setShowAddForm(!showAddForm)} className="flex items-center space-x-2 bg-neutral-900 text-white px-6 py-2 hover:bg-neutral-800 transition-colors uppercase text-sm tracking-wider">
                <Plus size={18} /><span>新增產品</span>
              </button>
            )}
            {activeTab === 'categories' && (
              <button onClick={() => setShowAddCategoryForm(!showAddCategoryForm)} className="flex items-center space-x-2 bg-neutral-900 text-white px-6 py-2 hover:bg-neutral-800 transition-colors uppercase text-sm tracking-wider">
                <Plus size={18} /><span>新增分類</span>
              </button>
            )}
            <button onClick={onLogout} className="text-neutral-600 hover:text-neutral-900 transition-colors"><LogOut size={20} /></button>
          </div>
        </div>

        {/* ── 分頁標籤 ── */}
        <div className="mb-8 flex space-x-8 border-b border-neutral-200 overflow-x-auto">
          {[
            { key: 'dashboard', icon: <LayoutDashboard size={18} />, label: '總覽' },
            { key: 'wallpapers', icon: <Package size={18} />, label: '產品管理' },
            { key: 'categories', icon: null, label: '分類管理' },
            { key: 'orders', icon: <ShoppingBag size={18} />, label: '訂單', badge: orders.filter(o => o.status === 'pending').length },
            { key: 'customers', icon: null, label: '客戶管理', badge: 0 },
            { key: 'messages', icon: null, label: '訊息', badge: messages.filter(m => !m.is_read).length },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`pb-4 font-medium transition-colors relative uppercase text-sm tracking-wider flex items-center space-x-2 whitespace-nowrap ${activeTab === tab.key ? 'text-neutral-900 border-b-2 border-neutral-900' : 'text-neutral-500 hover:text-neutral-900'}`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge! > 0 && <span className="bg-neutral-900 text-white text-xs px-2 py-0.5">{tab.badge}</span>}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════
            Dashboard
        ══════════════════════════════════════════ */}
        {activeTab === 'dashboard' && <DashboardPage />}


        {/* ══════════════════════════════════════════
            Add Product 表單（inline，頁面頂部）
        ══════════════════════════════════════════ */}
        {activeTab === 'wallpapers' && showAddForm && (
          <div className="bg-neutral-50 border border-neutral-200 p-8 mb-8">
            <h2 className="text-lg font-bold text-neutral-900 mb-6 uppercase tracking-wider">新增產品</h2>
            <form onSubmit={handleAddWallpaper} className="space-y-4">
              <div><label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">名稱</label>
                <input type="text" required value={newWallpaper.title} onChange={e => setNewWallpaper({...newWallpaper, title: e.target.value})} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" /></div>
              <div><label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">分類</label>
                <select required value={newWallpaper.category} onChange={e => setNewWallpaper({...newWallpaper, category: e.target.value})} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm">
                  <option value="">請選擇分類</option>
                  {categories.filter(c => c.is_active).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select></div>
              <div><label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">庫存</label>
                <input type="number" required min="0" value={newWallpaper.stock} onChange={e => setNewWallpaper({...newWallpaper, stock: parseInt(e.target.value)})} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" placeholder="0" /></div>
              <div><label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">圖片網址</label>
                <input type="url" required value={newWallpaper.image_url} onChange={e => setNewWallpaper({...newWallpaper, image_url: e.target.value})} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" placeholder="https://example.com/image.jpg" /></div>
              <div className="flex space-x-4">
                <button type="submit" className="flex-1 bg-neutral-900 text-white py-3 font-medium hover:bg-neutral-800 transition-colors uppercase text-sm tracking-wider">新增產品</button>
                <button type="button" onClick={() => setShowAddForm(false)} className="flex-1 bg-white border border-neutral-300 text-neutral-700 py-3 font-medium hover:bg-neutral-50 transition-colors uppercase text-sm tracking-wider">取消</button>
              </div>
            </form>
          </div>
        )}

        {/* ══════════════════════════════════════════
            Categories 編輯表單
        ══════════════════════════════════════════ */}
        {activeTab === 'categories' && showAddCategoryForm && (
          <div className="bg-neutral-50 border border-neutral-200 p-8 mb-8">
            <h2 className="text-lg font-bold text-neutral-900 mb-6 uppercase tracking-wider">新增分類</h2>
            <form onSubmit={handleAddCategory} className="space-y-4">
              <div><label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">分類名稱</label>
                <input type="text" required value={newCategory.name} onChange={e => setNewCategory({...newCategory, name: e.target.value})} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" /></div>
              <div className="flex space-x-4">
                <button type="submit" className="flex-1 bg-neutral-900 text-white py-3 font-medium hover:bg-neutral-800 transition-colors uppercase text-sm tracking-wider">新增分類</button>
                <button type="button" onClick={() => setShowAddCategoryForm(false)} className="flex-1 bg-white border border-neutral-300 text-neutral-700 py-3 font-medium hover:bg-neutral-50 transition-colors uppercase text-sm tracking-wider">取消</button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'categories' && editingCategory && (
          <div className="bg-neutral-50 border border-neutral-200 p-8 mb-8">
            <h2 className="text-lg font-bold text-neutral-900 mb-6 uppercase tracking-wider">編輯分類</h2>
            <form onSubmit={handleUpdateCategory} className="space-y-4">
              <div><label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">分類名稱</label>
                <input type="text" required value={editingCategory.name} onChange={e => setEditingCategory({...editingCategory, name: e.target.value})} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" /></div>
              <div><label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">排列順序</label>
                <input type="number" required value={editingCategory.display_order} onChange={e => setEditingCategory({...editingCategory, display_order: parseInt(e.target.value)})} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" /></div>
              <div className="flex space-x-4">
                <button type="submit" className="flex-1 bg-neutral-900 text-white py-3 font-medium hover:bg-neutral-800 transition-colors uppercase text-sm tracking-wider">更新</button>
                <button type="button" onClick={() => setEditingCategory(null)} className="flex-1 bg-white border border-neutral-300 text-neutral-700 py-3 font-medium hover:bg-neutral-50 transition-colors uppercase text-sm tracking-wider">取消</button>
              </div>
            </form>
          </div>
        )}

        {/* ══════════════════════════════════════════
            訂單編輯表單
        ══════════════════════════════════════════ */}
        {activeTab === 'orders' && editingOrder && (
          <div className="bg-neutral-50 border border-neutral-200 p-8 mb-8">
            <h2 className="text-lg font-bold text-neutral-900 mb-6 uppercase tracking-wider">編輯訂單</h2>
            <form onSubmit={handleUpdateOrder} className="space-y-4">
              <div><label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">客戶名稱</label>
                <input type="text" required value={editingOrder.customer_name} onChange={e => setEditingOrder({...editingOrder, customer_name: e.target.value})} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" /></div>
              <div><label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">電子郵件</label>
                <input type="email" required value={editingOrder.customer_email} onChange={e => setEditingOrder({...editingOrder, customer_email: e.target.value})} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">電話</label>
                  <input type="tel" value={editingOrder.customer_phone} onChange={e => setEditingOrder({...editingOrder, customer_phone: e.target.value})} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" /></div>
                <div><label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">公司</label>
                  <input type="text" value={editingOrder.customer_company} onChange={e => setEditingOrder({...editingOrder, customer_company: e.target.value})} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" /></div>
              </div>
              <div><label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">狀態</label>
                <select required value={editingOrder.status} onChange={e => setEditingOrder({...editingOrder, status: e.target.value})} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm">
                  <option value="pending">待確認</option>
                  <option value="confirmed">已確認</option>
                  <option value="completed">已完成</option>
                  <option value="cancelled">已取消</option>
                </select></div>
              {/* 訂購項目編輯 */}
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">訂購項目</label>
                <div className="border border-neutral-200 divide-y divide-neutral-200 mb-3">
                  {editingOrderItems.map((item, i) => (
                    <div key={i} className={`px-4 py-3 flex items-center justify-between gap-3 ${item.quantity <= 0 ? 'opacity-40' : ''}`}>
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {item.wallpaper?.image_url && (() => { const { baseUrl, deg } = parseRotation(item.wallpaper.image_url); return <img src={baseUrl} alt="" className="w-10 h-10 object-cover bg-neutral-100 shrink-0" style={deg ? { transform: `rotate(${deg}deg)` } : undefined} />; })()}
                        <div className="min-w-0">
                          <p className="text-sm text-neutral-900 truncate">{item.wallpaper?.title || '未知產品'}</p>
                          {item.wallpaper?.spec && <p className="text-xs text-neutral-500">{item.wallpaper.spec}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <label className="text-xs text-neutral-500">單價</label>
                        <input type="number" min="0" value={item.unit_price || 0}
                          onChange={e => { const arr = [...editingOrderItems]; arr[i] = { ...arr[i], unit_price: Number(e.target.value) }; setEditingOrderItems(arr); }}
                          className="w-20 px-2 py-1 border border-neutral-300 text-sm text-right" />
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" onClick={() => { const arr = [...editingOrderItems]; arr[i] = { ...arr[i], quantity: Math.max(0, arr[i].quantity - 1) }; setEditingOrderItems(arr); }}
                          className="w-7 h-7 border border-neutral-300 text-neutral-600 hover:bg-neutral-100 flex items-center justify-center text-sm">−</button>
                        <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                        <button type="button" onClick={() => { const arr = [...editingOrderItems]; arr[i] = { ...arr[i], quantity: arr[i].quantity + 1 }; setEditingOrderItems(arr); }}
                          className="w-7 h-7 border border-neutral-300 text-neutral-600 hover:bg-neutral-100 flex items-center justify-center text-sm">+</button>
                      </div>
                      <button type="button" onClick={() => { const arr = editingOrderItems.filter((_, idx) => idx !== i); setEditingOrderItems(arr); }}
                        className="p-1 text-neutral-400 hover:text-red-600 shrink-0"><Trash2 size={16} /></button>
                    </div>
                  ))}
                  {editingOrderItems.length === 0 && <div className="px-4 py-6 text-center text-neutral-400 text-sm">尚無項目</div>}
                </div>
                <div className="text-right text-sm mb-3 space-y-1">
                  {(() => {
                    const subtotal = editingOrderItems.filter(i => i.quantity > 0).reduce((sum: number, i: any) => sum + (i.unit_price || 0) * i.quantity, 0);
                    const tax = Math.round(subtotal * 0.05);
                    return <>
                      <div className="text-neutral-600">小計：NT$ {subtotal.toLocaleString()}</div>
                      <div className="text-neutral-600">營業稅 5%：NT$ {tax.toLocaleString()}</div>
                      <div className="font-bold text-neutral-900 border-t border-neutral-200 pt-1">總計：NT$ {Math.round(subtotal * 1.05).toLocaleString()}</div>
                      <div className="text-xs text-neutral-400">* 運費另計</div>
                    </>;
                  })()}
                </div>
                {/* 加入產品 */}
                <div className="relative">
                  <label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">加入產品</label>
                  <input type="text" value={addProductSearch} onChange={e => setAddProductSearch(e.target.value)}
                    placeholder="搜尋產品名稱..."
                    className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" />
                  {addProductSearch.trim() && (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-neutral-200 shadow-lg max-h-48 overflow-y-auto">
                      {wallpapers.filter(w => w.title.toLowerCase().includes(addProductSearch.toLowerCase()) || (w.product_code && w.product_code.toLowerCase().includes(addProductSearch.toLowerCase())))
                        .slice(0, 10).map(w => (
                        <button key={w.id} type="button"
                          onClick={() => {
                            setEditingOrderItems([...editingOrderItems, { wallpaper_id: w.id, wallpaper: w, quantity: 1, unit_price: w.price_per_piece || 0 }]);
                            setAddProductSearch('');
                          }}
                          className="w-full px-4 py-2 text-left hover:bg-neutral-50 flex items-center gap-3 text-sm border-b border-neutral-100 last:border-b-0">
                          {w.image_url && (() => { const { baseUrl, deg } = parseRotation(w.image_url); return <img src={baseUrl} alt="" className="w-8 h-8 object-cover bg-neutral-100" style={deg ? { transform: `rotate(${deg}deg)` } : undefined} />; })()}
                          <div>
                            <p className="text-neutral-900">{w.title}</p>
                            <p className="text-xs text-neutral-500">{w.spec || ''} {w.price_per_piece ? `NT$ ${w.price_per_piece}` : ''}</p>
                          </div>
                        </button>
                      ))}
                      {wallpapers.filter(w => w.title.toLowerCase().includes(addProductSearch.toLowerCase()) || (w.product_code && w.product_code.toLowerCase().includes(addProductSearch.toLowerCase()))).length === 0 && (
                        <div className="px-4 py-3 text-sm text-neutral-400">找不到符合的產品</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div><label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">備註</label>
                <textarea value={editingOrder.notes} onChange={e => setEditingOrder({...editingOrder, notes: e.target.value})} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" rows={4} /></div>
              <div className="flex space-x-4">
                <button type="submit" className="flex-1 bg-neutral-900 text-white py-3 font-medium hover:bg-neutral-800 transition-colors uppercase text-sm tracking-wider">更新訂單</button>
                <button type="button" onClick={() => { setEditingOrder(null); setEditingOrderItems([]); }} className="flex-1 bg-white border border-neutral-300 text-neutral-700 py-3 font-medium hover:bg-neutral-50 transition-colors uppercase text-sm tracking-wider">取消</button>
              </div>
            </form>
          </div>
        )}

        {/* ══════════════════════════════════════════
            主資料表格區
        ══════════════════════════════════════════ */}
        {loading ? (
          <div className="text-center py-12"><div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-neutral-300 border-t-neutral-900" /></div>
        ) : activeTab === 'wallpapers' ? (
          <div className="bg-white border border-neutral-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-neutral-200 flex items-center space-x-3">
              <input
                type="text"
                placeholder="搜尋產品名稱、分類、編號…"
                value={filterText}
                onChange={e => { setFilterText(e.target.value); setWallpaperPage(1); }}
                className="flex-1 max-w-sm px-4 py-2 border border-neutral-300 text-sm focus:outline-none focus:border-neutral-900"
              />
              {filterText && <button onClick={() => { setFilterText(''); setWallpaperPage(1); }} className="text-xs text-neutral-500 hover:text-neutral-900">清除</button>}
              <span className="text-xs text-neutral-400">{sortedWallpapers.length} / {wallpapers.length} 筆</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-neutral-50 border-b border-neutral-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">預覽</th>
                    {([
                      ['title',          '名稱'],
                      ['category',       '分類'],
                      ['stock',          '庫存'],
                      ['price_per_piece','報價/片'],
                      ['cost_per_piece', '成本/片'],
                      ['margin',         '毛利率'],
                      ['is_active',      '狀態'],
                    ] as [typeof sortKey, string][]).map(([key, label]) => (
                      <th key={key} onClick={() => handleSort(key)}
                        className="px-6 py-4 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider cursor-pointer hover:text-neutral-900 select-none whitespace-nowrap">
                        <span className="flex items-center space-x-1">
                          <span>{label}</span>
                          <span className="text-neutral-300">
                            {sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                          </span>
                        </span>
                      </th>
                    ))}
                    <th className="px-6 py-4 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {pagedWallpapers.map(w => (
                    <tr key={w.id} className="hover:bg-neutral-50 transition-colors">
                      <td className="px-6 py-4"><div className="w-20 h-14 bg-neutral-100 flex items-center justify-center">{(() => { const { baseUrl, deg } = parseRotation(w.image_url || ''); return <img src={baseUrl} alt={w.title} className="w-full h-full object-contain" style={deg ? { transform: `rotate(${deg}deg)` } : undefined} />; })()}</div></td>
                      <td className="px-6 py-4 text-sm text-neutral-900">{w.title}</td>
                      <td className="px-6 py-4 text-sm text-neutral-600">{w.category}</td>
                      <td className="px-6 py-4 text-sm text-neutral-600">{w.stock}</td>
                      <td className="px-6 py-4 text-sm text-neutral-900">{w.price_per_piece ? `NT$${w.price_per_piece.toLocaleString()}` : '—'}</td>
                      <td className="px-6 py-4 text-sm text-neutral-500">{w.cost_per_piece ? `NT$${w.cost_per_piece.toLocaleString()}` : '—'}</td>
                      <td className="px-6 py-4 text-sm">
                        {w.price_per_piece && w.cost_per_piece
                          ? <span className="text-green-700 font-medium">{(((w.price_per_piece - w.cost_per_piece) / w.price_per_piece) * 100).toFixed(1)}%</span>
                          : '—'}
                      </td>
                      <td className="px-6 py-4"><span className={`inline-flex px-3 py-1 text-xs font-medium ${w.is_active ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-neutral-100 text-neutral-700 border border-neutral-300'}`}>{w.is_active ? '上架' : '下架'}</span></td>
                      <td className="px-6 py-4">
                        <div className="flex space-x-2">
                          <button onClick={() => { setEditingWallpaper(w); setEditingImageUrls((w.image_urls || []).join('\n')); }} className="p-2 text-neutral-600 hover:text-neutral-900 transition-colors" title="編輯"><Edit2 size={18} /></button>
                          <button onClick={() => toggleWallpaperStatus(w.id, w.is_active)} className="p-2 text-neutral-600 hover:text-neutral-900 transition-colors" title={w.is_active ? '停用' : '啟用'}>{w.is_active ? <PowerOff size={18} /> : <Power size={18} />}</button>
                          <button onClick={() => deleteWallpaper(w.id)} className="p-2 text-neutral-600 hover:text-red-600 transition-colors" title="刪除"><Trash2 size={18} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sortedWallpapers.length === 0 && (
              <div className="text-center py-12 text-neutral-500">{filterText ? '找不到符合的產品' : '尚無產品'}</div>
            )}
            {totalWallpaperPages > 1 && (
              <div className="px-6 py-4 border-t border-neutral-200 flex items-center justify-between">
                <span className="text-xs text-neutral-400">
                  第 {(wallpaperPage - 1) * WALLPAPER_PAGE_SIZE + 1}–{Math.min(wallpaperPage * WALLPAPER_PAGE_SIZE, sortedWallpapers.length)} 筆，共 {sortedWallpapers.length} 筆
                </span>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => setWallpaperPage(p => Math.max(1, p - 1))}
                    disabled={wallpaperPage === 1}
                    className="px-3 py-1.5 border border-neutral-300 text-xs text-neutral-600 hover:border-neutral-900 hover:text-neutral-900 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >← 上一頁</button>
                  {Array.from({ length: totalWallpaperPages }, (_, i) => i + 1)
                    .filter(p => p === 1 || p === totalWallpaperPages || Math.abs(p - wallpaperPage) <= 1)
                    .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                      if (idx > 0 && typeof arr[idx - 1] === 'number' && (p as number) - (arr[idx - 1] as number) > 1) acc.push('...');
                      acc.push(p); return acc;
                    }, [])
                    .map((p, i) => p === '...'
                      ? <span key={`e${i}`} className="px-2 py-1 text-neutral-300 text-xs">…</span>
                      : <button key={p}
                          onClick={() => setWallpaperPage(p as number)}
                          className={`w-8 h-8 text-xs border transition-colors ${wallpaperPage === p ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 text-neutral-600 hover:border-neutral-900 hover:text-neutral-900'}`}
                        >{p}</button>
                    )
                  }
                  <button
                    onClick={() => setWallpaperPage(p => Math.min(totalWallpaperPages, p + 1))}
                    disabled={wallpaperPage === totalWallpaperPages}
                    className="px-3 py-1.5 border border-neutral-300 text-xs text-neutral-600 hover:border-neutral-900 hover:text-neutral-900 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >下一頁 →</button>
                </div>
              </div>
            )}
          </div>
        ) : activeTab === 'categories' ? (
          <div className="bg-white border border-neutral-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-neutral-50 border-b border-neutral-200">
                <tr>{['分類名稱','狀態','排序','操作'].map(h => (
                  <th key={h} className="px-6 py-4 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {categories.map((cat, idx) => (
                  <tr key={cat.id} className="hover:bg-neutral-50 transition-colors">
                    <td className="px-6 py-4 text-sm text-neutral-900">{cat.name}</td>
                    <td className="px-6 py-4"><span className={`inline-flex px-3 py-1 text-xs font-medium ${cat.is_active ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-neutral-100 text-neutral-700 border border-neutral-300'}`}>{cat.is_active ? '上架' : '下架'}</span></td>
                    <td className="px-6 py-4">
                      <div className="flex space-x-1">
                        <button onClick={() => moveCategoryUp(cat)} disabled={idx === 0} className="p-2 text-neutral-600 hover:text-neutral-900 disabled:opacity-30 disabled:cursor-not-allowed"><ArrowUp size={18} /></button>
                        <button onClick={() => moveCategoryDown(cat)} disabled={idx === categories.length - 1} className="p-2 text-neutral-600 hover:text-neutral-900 disabled:opacity-30 disabled:cursor-not-allowed"><ArrowDown size={18} /></button>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex space-x-2">
                        <button onClick={() => setEditingCategory(cat)} className="p-2 text-neutral-600 hover:text-neutral-900"><Edit2 size={18} /></button>
                        <button onClick={() => toggleCategoryStatus(cat.id, cat.is_active)} className="p-2 text-neutral-600 hover:text-neutral-900">{cat.is_active ? <PowerOff size={18} /> : <Power size={18} />}</button>
                        <button onClick={() => deleteCategory(cat.id)} className="p-2 text-neutral-600 hover:text-red-600"><Trash2 size={18} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {categories.length === 0 && <div className="text-center py-12 text-neutral-500">尚無分類</div>}
          </div>
        ) : activeTab === 'orders' ? (
          <div>
            {/* 搜尋列 */}
            <div className="flex items-center gap-4 mb-4">
              <input
                type="text"
                value={orderFilterText}
                onChange={e => setOrderFilterText(e.target.value)}
                placeholder="搜尋訂單編號、客戶姓名、Email、電話..."
                className="flex-1 px-4 py-2 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm"
              />
              <p className="text-sm text-neutral-500 whitespace-nowrap">
                {orderFilterText
                  ? `${orders.filter(o => [o.order_number, o.customer_name, o.customer_email, o.customer_phone].some(v => (v || '').toLowerCase().includes(orderFilterText.toLowerCase()))).length} / ${orders.length} 筆`
                  : `共 ${orders.length} 筆訂單`}
              </p>
            </div>
          <div className="bg-white border border-neutral-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-neutral-50 border-b border-neutral-200">
                <tr>{['訂單編號','客戶','產品','數量','狀態','日期','操作'].map(h => (
                  <th key={h} className="px-6 py-4 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {orders.filter(o => !orderFilterText || [o.order_number, o.customer_name, o.customer_email, o.customer_phone].some(v => (v || '').toLowerCase().includes(orderFilterText.toLowerCase()))).map(order => {
                  const badge = getStatusBadge(order.status);
                  return (
                    <tr key={order.id} className="hover:bg-neutral-50 transition-colors">
                      <td className="px-6 py-4 text-sm text-neutral-900 font-medium cursor-pointer" onClick={() => setViewingOrder(order)}>{order.order_number}</td>
                      <td className="px-6 py-4 text-sm text-neutral-600 cursor-pointer" onClick={() => setViewingOrder(order)}>{order.customer_name}</td>
                      <td className="px-6 py-4 text-sm text-neutral-600 cursor-pointer" onClick={() => setViewingOrder(order)}>
                        {order.order_items?.length ? order.order_items.map((item, i) => <div key={i}>{item.wallpaper?.title || '未知產品'}</div>) : '無項目'}
                      </td>
                      <td className="px-6 py-4 text-sm text-neutral-600 cursor-pointer" onClick={() => setViewingOrder(order)}>
                        {order.order_items?.length ? order.order_items.map((item, i) => <div key={i}>{item.quantity}</div>) : '0'}
                      </td>
                      <td className="px-6 py-4 cursor-pointer" onClick={() => setViewingOrder(order)}>
                        <span className={`inline-flex px-3 py-1 text-xs font-medium border ${badge.style}`}>{badge.label}</span>
                      </td>
                      <td className="px-6 py-4 text-sm text-neutral-600 cursor-pointer" onClick={() => setViewingOrder(order)}>
                        {new Date(order.created_at).toLocaleString('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex space-x-2">
                          <button onClick={e => { e.stopPropagation(); setEditingOrder(order); setEditingOrderItems((order.order_items || []).map((i: any) => ({ ...i }))); setAddProductSearch(''); }} className="p-2 text-neutral-600 hover:text-neutral-900" title="編輯"><Edit2 size={18} /></button>

                          <button onClick={e => { e.stopPropagation(); exportQuotePDF(order); }} className="p-2 text-neutral-600 hover:text-blue-600" title="匯出報價單"><FileText size={18} /></button>
                          <button onClick={e => { e.stopPropagation(); deleteOrder(order.id); }} className="p-2 text-neutral-600 hover:text-red-600" title="刪除"><Trash2 size={18} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {orders.length === 0 && <div className="text-center py-12 text-neutral-500">尚無訂單</div>}
          </div>
          </div>
        ) : activeTab === 'messages' ? (
          <div className="bg-white border border-neutral-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-neutral-50 border-b border-neutral-200">
                <tr>{['姓名','電子郵件','電話','公司','訊息','日期','狀態','操作'].map(h => (
                  <th key={h} className="px-6 py-4 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {messages.map(msg => (
                  <tr key={msg.id} className={`hover:bg-neutral-100 transition-colors cursor-pointer ${!msg.is_read ? 'bg-neutral-50' : ''}`}>
                    <td onClick={() => setViewingMessage(msg)} className="px-6 py-4 text-sm text-neutral-900">{msg.name}</td>
                    <td onClick={() => setViewingMessage(msg)} className="px-6 py-4 text-sm text-neutral-600">{msg.email}</td>
                    <td onClick={() => setViewingMessage(msg)} className="px-6 py-4 text-sm text-neutral-600">{msg.phone || '-'}</td>
                    <td onClick={() => setViewingMessage(msg)} className="px-6 py-4 text-sm text-neutral-600">{msg.company || '-'}</td>
                    <td onClick={() => setViewingMessage(msg)} className="px-6 py-4 text-sm text-neutral-600 max-w-md truncate">{msg.message}</td>
                    <td onClick={() => setViewingMessage(msg)} className="px-6 py-4 text-sm text-neutral-600">{new Date(msg.created_at).toLocaleString('zh-TW', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td onClick={() => setViewingMessage(msg)} className="px-6 py-4">
                      <span className={`inline-flex px-3 py-1 text-xs font-medium ${msg.is_read ? 'bg-neutral-100 text-neutral-700 border border-neutral-300' : 'bg-neutral-900 text-white'}`}>{msg.is_read ? '已讀' : '未讀'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <button onClick={e => { e.stopPropagation(); deleteMessage(msg.id); }} className="p-2 text-neutral-600 hover:text-red-600"><Trash2 size={18} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {messages.length === 0 && <div className="text-center py-12 text-neutral-500">尚無訊息</div>}
          </div>
        ) : activeTab === 'customers' ? (
          <div>
            {/* 工具列 */}
            <div className="flex items-center gap-4 mb-4">
              <input
                type="text"
                value={customerSearch}
                onChange={e => setCustomerSearch(e.target.value)}
                placeholder="搜尋姓名、Email、電話、公司…"
                className="flex-1 px-4 py-2 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm"
              />
              <button
                onClick={() => setShowAddCustomerForm(true)}
                className="flex items-center space-x-2 bg-neutral-900 text-white px-5 py-2 text-sm hover:bg-neutral-800 transition-colors uppercase tracking-wider whitespace-nowrap"
              >
                <Plus size={16} /><span>新增客戶</span>
              </button>
              <p className="text-sm text-neutral-500 whitespace-nowrap">
                共 {unifiedCustomers.length} 位
              </p>
            </div>

            {/* 新增客戶表單 */}
            {showAddCustomerForm && (
              <div className="bg-neutral-50 border border-neutral-200 p-6 mb-6">
                <h3 className="text-sm font-bold text-neutral-900 uppercase tracking-wider mb-4">新增客戶</h3>
                <form onSubmit={handleAddCustomer} className="grid grid-cols-2 gap-4">
                  <div><label className="block text-xs font-medium text-neutral-600 mb-1 uppercase tracking-wider">姓名 *</label>
                    <input required type="text" value={newCustomerForm.name} onChange={e => setNewCustomerForm({ ...newCustomerForm, name: e.target.value })} className="w-full px-3 py-2 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" /></div>
                  <div><label className="block text-xs font-medium text-neutral-600 mb-1 uppercase tracking-wider">Email</label>
                    <input type="email" value={newCustomerForm.email} onChange={e => setNewCustomerForm({ ...newCustomerForm, email: e.target.value })} className="w-full px-3 py-2 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" /></div>
                  <div><label className="block text-xs font-medium text-neutral-600 mb-1 uppercase tracking-wider">電話</label>
                    <input type="text" value={newCustomerForm.phone} onChange={e => setNewCustomerForm({ ...newCustomerForm, phone: e.target.value })} className="w-full px-3 py-2 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" /></div>
                  <div><label className="block text-xs font-medium text-neutral-600 mb-1 uppercase tracking-wider">公司</label>
                    <input type="text" value={newCustomerForm.company} onChange={e => setNewCustomerForm({ ...newCustomerForm, company: e.target.value })} className="w-full px-3 py-2 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" /></div>
                  <div className="col-span-2"><label className="block text-xs font-medium text-neutral-600 mb-1 uppercase tracking-wider">備註</label>
                    <textarea rows={2} value={newCustomerForm.notes} onChange={e => setNewCustomerForm({ ...newCustomerForm, notes: e.target.value })} className="w-full px-3 py-2 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm resize-none" /></div>
                  <div className="col-span-2 flex gap-3">
                    <button type="submit" className="bg-neutral-900 text-white px-6 py-2 text-sm hover:bg-neutral-800 transition-colors uppercase tracking-wider">建立</button>
                    <button type="button" onClick={() => setShowAddCustomerForm(false)} className="border border-neutral-300 text-neutral-700 px-6 py-2 text-sm hover:bg-neutral-50 transition-colors uppercase tracking-wider">取消</button>
                  </div>
                </form>
              </div>
            )}

            {/* 客戶列表 */}
            <div className="bg-white border border-neutral-200 overflow-hidden">
              <table className="w-full">
                <thead className="bg-neutral-50 border-b border-neutral-200">
                  <tr>{['姓名','Email','電話','公司','訂單數','消費總額','最後訂購','操作'].map(h => (
                    <th key={h} className="px-5 py-4 text-left text-xs font-medium text-neutral-600 uppercase tracking-wider">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {unifiedCustomers
                    .filter(c => !customerSearch || [c.name, c.email, c.phone, c.company].some(v => (v || '').toLowerCase().includes(customerSearch.toLowerCase())))
                    .map((c, i) => (
                    <tr key={i} className="hover:bg-neutral-50 transition-colors cursor-pointer" onClick={() => setViewingCustomer(c)}>
                      <td className="px-5 py-4 text-sm font-medium text-neutral-900">
                        <div className="flex items-center gap-2">
                          {c.name}
                          {!c.hasRecord && <span className="text-xs bg-neutral-100 text-neutral-500 border border-neutral-200 px-1.5 py-0.5">未建檔</span>}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-neutral-600">{c.email || '-'}</td>
                      <td className="px-5 py-4 text-sm text-neutral-600">{c.phone || '-'}</td>
                      <td className="px-5 py-4 text-sm text-neutral-600">{c.company || '-'}</td>
                      <td className="px-5 py-4 text-sm font-medium text-neutral-900">{c.orderCount}</td>
                      <td className="px-5 py-4 text-sm text-neutral-900">NT$ {c.totalAmount.toLocaleString()}</td>
                      <td className="px-5 py-4 text-sm text-neutral-600">{new Date(c.lastOrderAt).toLocaleString('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                      <td className="px-5 py-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {c.hasRecord && (
                            <>
                              <button onClick={() => setEditingDbCustomer({ id: c.id, name: c.name, email: c.email, phone: c.phone, company: c.company, notes: c.notes || '', created_at: c.created_at, updated_at: c.updated_at })} className="p-2 text-neutral-500 hover:text-neutral-900" title="編輯"><Edit2 size={16} /></button>
                              <button onClick={() => { setMergeSourceKey(c.key); setMergeTargetKey(''); setShowMergeModal(true); }} className="p-2 text-neutral-500 hover:text-blue-600 text-xs font-medium" title="合併客戶">合併</button>
                              <button onClick={() => handleDeleteCustomer(c.id)} className="p-2 text-neutral-500 hover:text-red-600" title="刪除記錄"><Trash2 size={16} /></button>
                            </>
                          )}
                          {!c.hasRecord && (
                            <button onClick={() => handleSaveDerivedAsCustomer(c)} className="text-xs border border-neutral-300 text-neutral-600 px-2 py-1 hover:border-neutral-900 hover:text-neutral-900 transition-colors whitespace-nowrap">建立檔案</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {unifiedCustomers.length === 0 && <div className="text-center py-12 text-neutral-500">尚無客戶資料</div>}
            </div>
          </div>
        ) : null}
      </div>

      {/* ══════════════════════════════════════════
          Edit Product Modal
      ══════════════════════════════════════════ */}
      {editingWallpaper && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-neutral-200 px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-neutral-900 uppercase tracking-wider">編輯產品</h3>
              <button onClick={() => { setEditingWallpaper(null); setEditingImageUrls(''); }} className="p-2 text-neutral-600 hover:text-neutral-900 transition-colors"><X size={20} /></button>
            </div>
            <form onSubmit={handleUpdateWallpaper} className="px-6 py-6 space-y-5">

              {/* 名稱 */}
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">名稱</label>
                <input type="text" required value={editingWallpaper.title} onChange={e => setEditingWallpaper({...editingWallpaper, title: e.target.value})} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" />
              </div>

              {/* 分類 */}
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">分類</label>
                <select required value={editingWallpaper.category} onChange={e => setEditingWallpaper({...editingWallpaper, category: e.target.value})} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm">
                  <option value="">請選擇分類</option>
                  {categories.filter(c => c.is_active).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>

              {/* 庫存 */}
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">庫存</label>
                <input type="number" required min="0" value={editingWallpaper.stock} onChange={e => setEditingWallpaper({...editingWallpaper, stock: parseInt(e.target.value)})} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" />
              </div>

              {/* 多圖網址編輯 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-neutral-600 uppercase tracking-wider">
                    圖片網址（每行一張）
                  </label>
                  <span className="text-xs text-neutral-400">
                    共 {editingImageUrls.split('\n').map(u => u.trim()).filter(Boolean).length} 張・第一行為封面
                  </span>
                </div>
                <textarea
                  value={editingImageUrls}
                  onChange={e => setEditingImageUrls(e.target.value)}
                  rows={6}
                  placeholder={"https://example.com/image1.jpg\nhttps://example.com/image2.jpg\n…"}
                  className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm font-mono resize-y"
                />
                <div className="flex items-center gap-2 mt-2">
                  <input
                    ref={imageUploadInputRef}
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={(e) => handleImageUpload(e.currentTarget.files)}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => imageUploadInputRef.current?.click()}
                    disabled={uploading}
                    className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-colors ${
                      uploading
                        ? 'bg-neutral-300 text-neutral-600 cursor-not-allowed'
                        : 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'
                    }`}
                  >
                    <Upload size={14} />
                    {uploading ? '上傳中...' : '上傳圖片'}
                  </button>
                  <span className="text-xs text-neutral-500">選擇 JPG、PNG 等圖片檔</span>
                </div>
              </div>

              {/* 圖片預覽（可拖曳排序，全部顯示）*/}
              {(() => {
                const urls = editingImageUrls.split('\n').map(u => u.trim()).filter(Boolean);
                if (urls.length === 0) return null;

                const handleDragStart = (i: number) => setDragIndex(i);
                const handleDragOver = (e: React.DragEvent, i: number) => {
                  e.preventDefault();
                  if (dragIndex === null || dragIndex === i) return;
                  const reordered = [...urls];
                  const [moved] = reordered.splice(dragIndex, 1);
                  reordered.splice(i, 0, moved);
                  setEditingImageUrls(reordered.join('\n'));
                  setDragIndex(i);
                };
                const handleDragEnd = () => setDragIndex(null);

                return (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-neutral-600 uppercase tracking-wider">
                        圖片預覽・拖曳可排序
                      </label>
                      <span className="text-xs text-neutral-400">共 {urls.length} 張</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {urls.map((url, i) => {
                        const { baseUrl, deg } = parseRotation(url);
                        return (
                        <div
                          key={url + i}
                          draggable
                          onDragStart={() => handleDragStart(i)}
                          onDragOver={e => handleDragOver(e, i)}
                          onDragEnd={handleDragEnd}
                          className={`relative aspect-square bg-neutral-100 border-2 overflow-hidden cursor-grab active:cursor-grabbing transition-all ${
                            dragIndex === i
                              ? 'opacity-40 border-neutral-400'
                              : i === 0
                              ? 'border-neutral-900'
                              : 'border-neutral-200 hover:border-neutral-400'
                          }`}
                        >
                          <img
                            src={baseUrl}
                            alt={`圖片 ${i + 1}`}
                            className="w-full h-full object-contain pointer-events-none transition-transform"
                            style={deg ? { transform: `rotate(${deg}deg)` } : undefined}
                            onError={e => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
                          />
                          {i === 0 ? (
                            <span className="absolute top-1 left-1 bg-neutral-900 text-white text-xs px-1.5 py-0.5 rounded font-medium">封面</span>
                          ) : (
                            <span className="absolute top-1 left-1 bg-black bg-opacity-50 text-white text-xs px-1 rounded">{i + 1}</span>
                          )}
                          <div className="absolute top-1 right-1 flex flex-col gap-1">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); deleteImage(i); }}
                              className="bg-red-600 bg-opacity-80 text-white p-1 rounded hover:bg-opacity-100 transition-all"
                              title="刪除此圖片"
                            >
                              <X size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); rotateImage(i); }}
                              className="bg-black bg-opacity-60 text-white p-1 rounded hover:bg-opacity-80 transition-all"
                              title={`旋轉 90°${deg ? ` (目前 ${deg}°)` : ''}`}
                            >
                              <RotateCw size={14} />
                            </button>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-neutral-400 mt-2">拖曳圖片可調整順序，第一張為封面</p>
                  </div>
                );
              })()}

              {/* 操作按鈕 */}
              <div className="flex space-x-4 pt-2">
                <button type="submit" className="flex-1 bg-neutral-900 text-white py-3 font-medium hover:bg-neutral-800 transition-colors uppercase text-sm tracking-wider">更新</button>
                <button type="button" onClick={() => { setEditingWallpaper(null); setEditingImageUrls(''); }} className="flex-1 bg-white border border-neutral-300 text-neutral-700 py-3 font-medium hover:bg-neutral-50 transition-colors uppercase text-sm tracking-wider">取消</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── 訊息 Modal ── */}
      {viewingMessage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-neutral-200 px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-neutral-900 uppercase tracking-wider">訊息詳情</h3>
              <button onClick={handleCloseMessageModal} className="p-2 text-neutral-600 hover:text-neutral-900"><X size={20} /></button>
            </div>
            <div className="px-6 py-6 space-y-6">
              {[['姓名', viewingMessage.name], ['電子郵件', viewingMessage.email], ['電話', viewingMessage.phone || '-'], ['公司', viewingMessage.company || '-']].map(([label, val]) => (
                <div key={label}><label className="block text-xs font-medium text-neutral-600 uppercase tracking-wider mb-2">{label}</label><p className="text-sm text-neutral-900">{val}</p></div>
              ))}
              <div><label className="block text-xs font-medium text-neutral-600 uppercase tracking-wider mb-2">訊息內容</label><p className="text-sm text-neutral-900 whitespace-pre-wrap">{viewingMessage.message}</p></div>
              <div><label className="block text-xs font-medium text-neutral-600 uppercase tracking-wider mb-2">日期</label><p className="text-sm text-neutral-900">{new Date(viewingMessage.created_at).toLocaleString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p></div>
            </div>
            <div className="sticky bottom-0 bg-neutral-50 border-t border-neutral-200 px-6 py-4">
              <button onClick={handleCloseMessageModal} className="w-full bg-neutral-900 text-white py-3 hover:bg-neutral-800 transition-colors text-sm font-medium uppercase tracking-wider">關閉</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 訂單 Modal ── */}
      {viewingOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-neutral-200 px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-neutral-900 uppercase tracking-wider">訂單詳情</h3>
              <button onClick={() => { setViewingOrder(null); if (orderSourceCustomer) { setViewingCustomer(orderSourceCustomer); setOrderSourceCustomer(null); } }} className="p-2 text-neutral-600 hover:text-neutral-900"><X size={20} /></button>
            </div>
            <div className="px-6 py-6 space-y-6">
              {[['訂單編號', viewingOrder.order_number], ['客戶名稱', viewingOrder.customer_name], ['電子郵件', viewingOrder.customer_email], ['電話', viewingOrder.customer_phone || '-'], ['公司', viewingOrder.customer_company || '-']].map(([label, val]) => (
                <div key={label}><label className="block text-xs font-medium text-neutral-600 uppercase tracking-wider mb-2">{label}</label><p className="text-sm text-neutral-900 font-medium">{val}</p></div>
              ))}
              <div>
                <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wider mb-2">訂單項目</label>
                <div className="border border-neutral-200 divide-y divide-neutral-200">
                  {viewingOrder.order_items?.length ? viewingOrder.order_items.map((item, i) => (
                    <div key={i} className="px-4 py-3 flex justify-between items-center">
                      <span className="text-sm text-neutral-900">{item.wallpaper?.title || '未知產品'}</span>
                      <span className="text-sm text-neutral-600">數量：{item.quantity}</span>
                    </div>
                  )) : <div className="px-4 py-3 text-sm text-neutral-500">無項目</div>}
                </div>
              </div>
              {viewingOrder.total_amount > 0 && (
                <div>
                  <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wider mb-2">金額</label>
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between text-neutral-600"><span>小計</span><span>NT$ {viewingOrder.total_amount.toLocaleString()}</span></div>
                    <div className="flex justify-between text-neutral-600"><span>營業稅 5%</span><span>NT$ {Math.round(viewingOrder.total_amount * 0.05).toLocaleString()}</span></div>
                    <div className="flex justify-between font-bold text-neutral-900 border-t border-neutral-200 pt-1"><span>總計</span><span>NT$ {Math.round(viewingOrder.total_amount * 1.05).toLocaleString()}</span></div>
                    <p className="text-xs text-neutral-400">* 運費另計</p>
                  </div>
                </div>
              )}
              {viewingOrder.notes && <div><label className="block text-xs font-medium text-neutral-600 uppercase tracking-wider mb-2">備註</label><p className="text-sm text-neutral-900 whitespace-pre-wrap">{viewingOrder.notes}</p></div>}
              <div>
                <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wider mb-2">狀態</label>
                <select value={viewingOrder.status} onChange={e => updateOrderStatus(viewingOrder.id, e.target.value)} className="px-4 py-2 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm">
                  <option value="pending">待確認</option>
                  <option value="confirmed">已確認</option>
                  <option value="completed">已完成</option>
                  <option value="cancelled">已取消</option>
                </select>
              </div>
              <div><label className="block text-xs font-medium text-neutral-600 uppercase tracking-wider mb-2">訂購日期</label>
                <p className="text-sm text-neutral-900">{new Date(viewingOrder.created_at).toLocaleString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p></div>
            </div>
            <div className="sticky bottom-0 bg-neutral-50 border-t border-neutral-200 px-6 py-4">
              <button onClick={() => { setViewingOrder(null); if (orderSourceCustomer) { setViewingCustomer(orderSourceCustomer); setOrderSourceCustomer(null); } }} className="w-full bg-neutral-900 text-white py-3 hover:bg-neutral-800 transition-colors text-sm font-medium uppercase tracking-wider">關閉</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 客戶詳情 Modal ── */}
      {viewingCustomer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-neutral-200 px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-neutral-900 uppercase tracking-wider">{viewingCustomer.name}</h3>
                {!viewingCustomer.hasRecord && <span className="text-xs text-neutral-400">未建立客戶檔案</span>}
              </div>
              <button onClick={() => setViewingCustomer(null)} className="p-2 text-neutral-600 hover:text-neutral-900"><X size={20} /></button>
            </div>
            <div className="px-6 py-6 space-y-6">
              {/* 基本資料 */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                {[['Email', viewingCustomer.email], ['電話', viewingCustomer.phone], ['公司', viewingCustomer.company]].map(([label, val]) => (
                  <div key={label}><label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">{label}</label><p className="text-neutral-900">{val || '-'}</p></div>
                ))}
                <div><label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">訂單數 / 消費總額</label><p className="text-neutral-900 font-medium">{viewingCustomer.orderCount} 筆 / NT$ {viewingCustomer.totalAmount.toLocaleString()}</p></div>
                {viewingCustomer.notes && <div className="col-span-2"><label className="block text-xs font-medium text-neutral-500 uppercase tracking-wider mb-1">備註</label><p className="text-neutral-700 whitespace-pre-wrap">{viewingCustomer.notes}</p></div>}
              </div>

              {/* 訂單列表 */}
              <div>
                <h4 className="text-xs font-medium text-neutral-600 uppercase tracking-wider mb-3">相關訂單</h4>
                {(() => {
                  const custOrders = getCustomerOrders(viewingCustomer);
                  if (custOrders.length === 0) return <p className="text-sm text-neutral-400">尚無訂單記錄</p>;
                  return (
                    <div className="border border-neutral-200 divide-y divide-neutral-200">
                      {custOrders.map(o => {
                        const badge = getStatusBadge(o.status);
                        return (
                          <div key={o.id} onClick={() => { setOrderSourceCustomer(viewingCustomer); setViewingCustomer(null); setViewingOrder(o); }} className="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-neutral-50 transition-colors">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-sm font-medium text-neutral-900">{o.order_number}</span>
                                <span className={`inline-flex px-2 py-0.5 text-xs font-medium border ${badge.style}`}>{badge.label}</span>
                              </div>
                              <p className="text-xs text-neutral-500">
                                {(o.order_items || []).map((it: any) => it.wallpaper?.title || '未知產品').join('、')}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-medium text-neutral-900">NT$ {(o.total_amount || 0).toLocaleString()}</p>
                              <p className="text-xs text-neutral-500">{new Date(o.created_at).toLocaleString('zh-TW', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
            <div className="sticky bottom-0 bg-neutral-50 border-t border-neutral-200 px-6 py-4 flex gap-3">
              {viewingCustomer.hasRecord ? (
                <>
                  <button onClick={() => { setEditingDbCustomer({ id: viewingCustomer.id, name: viewingCustomer.name, email: viewingCustomer.email, phone: viewingCustomer.phone, company: viewingCustomer.company, notes: viewingCustomer.notes || '', created_at: viewingCustomer.created_at, updated_at: viewingCustomer.updated_at }); setViewingCustomer(null); }} className="flex-1 bg-neutral-900 text-white py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors uppercase tracking-wider">編輯資料</button>
                  <button onClick={() => { setMergeSourceKey(viewingCustomer.key); setMergeTargetKey(''); setShowMergeModal(true); setViewingCustomer(null); }} className="flex-1 border border-neutral-300 text-neutral-700 py-2.5 text-sm font-medium hover:bg-neutral-50 transition-colors uppercase tracking-wider">合併客戶</button>
                </>
              ) : (
                <button onClick={() => { handleSaveDerivedAsCustomer(viewingCustomer); setViewingCustomer(null); }} className="flex-1 bg-neutral-900 text-white py-2.5 text-sm font-medium hover:bg-neutral-800 transition-colors uppercase tracking-wider">建立客戶檔案</button>
              )}
              <button onClick={() => setViewingCustomer(null)} className="px-6 border border-neutral-300 text-neutral-700 py-2.5 text-sm font-medium hover:bg-neutral-50 transition-colors uppercase tracking-wider">關閉</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 編輯客戶 Modal ── */}
      {editingDbCustomer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white max-w-lg w-full">
            <div className="border-b border-neutral-200 px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-neutral-900 uppercase tracking-wider">編輯客戶</h3>
              <button onClick={() => setEditingDbCustomer(null)} className="p-2 text-neutral-600 hover:text-neutral-900"><X size={20} /></button>
            </div>
            <form onSubmit={handleUpdateCustomer} className="px-6 py-6 space-y-4">
              <div><label className="block text-xs font-medium text-neutral-600 mb-1 uppercase tracking-wider">姓名 *</label>
                <input required type="text" value={editingDbCustomer.name} onChange={e => setEditingDbCustomer({ ...editingDbCustomer, name: e.target.value })} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-xs font-medium text-neutral-600 mb-1 uppercase tracking-wider">Email</label>
                  <input type="email" value={editingDbCustomer.email} onChange={e => setEditingDbCustomer({ ...editingDbCustomer, email: e.target.value })} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" /></div>
                <div><label className="block text-xs font-medium text-neutral-600 mb-1 uppercase tracking-wider">電話</label>
                  <input type="text" value={editingDbCustomer.phone} onChange={e => setEditingDbCustomer({ ...editingDbCustomer, phone: e.target.value })} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" /></div>
              </div>
              <div><label className="block text-xs font-medium text-neutral-600 mb-1 uppercase tracking-wider">公司</label>
                <input type="text" value={editingDbCustomer.company} onChange={e => setEditingDbCustomer({ ...editingDbCustomer, company: e.target.value })} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm" /></div>
              <div><label className="block text-xs font-medium text-neutral-600 mb-1 uppercase tracking-wider">備註</label>
                <textarea rows={3} value={editingDbCustomer.notes} onChange={e => setEditingDbCustomer({ ...editingDbCustomer, notes: e.target.value })} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm resize-none" /></div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="flex-1 bg-neutral-900 text-white py-3 text-sm font-medium hover:bg-neutral-800 transition-colors uppercase tracking-wider">更新</button>
                <button type="button" onClick={() => setEditingDbCustomer(null)} className="flex-1 border border-neutral-300 text-neutral-700 py-3 text-sm font-medium hover:bg-neutral-50 transition-colors uppercase tracking-wider">取消</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── 合併客戶 Modal ── */}
      {showMergeModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white max-w-lg w-full">
            <div className="border-b border-neutral-200 px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-neutral-900 uppercase tracking-wider">合併客戶</h3>
              <button onClick={() => setShowMergeModal(false)} className="p-2 text-neutral-600 hover:text-neutral-900"><X size={20} /></button>
            </div>
            <div className="px-6 py-6 space-y-5">
              <p className="text-sm text-neutral-600">選擇「被合併客戶」後，其所有訂單將轉移至「保留客戶」，被合併的客戶檔案將刪除。</p>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">被合併的客戶（將消失）</label>
                <select value={mergeSourceKey} onChange={e => setMergeSourceKey(e.target.value)} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm">
                  <option value="">請選擇</option>
                  {unifiedCustomers.map((c, i) => (
                    <option key={i} value={c.key}>{c.name}（{c.email || c.phone}）— {c.orderCount} 筆訂單</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-2 uppercase tracking-wider">保留的客戶（訂單將合入此客戶）</label>
                <select value={mergeTargetKey} onChange={e => setMergeTargetKey(e.target.value)} className="w-full px-4 py-3 border border-neutral-300 focus:outline-none focus:border-neutral-900 text-sm">
                  <option value="">請選擇</option>
                  {unifiedCustomers.filter(c => c.key !== mergeSourceKey).map((c, i) => (
                    <option key={i} value={c.key}>{c.name}（{c.email || c.phone}）— {c.orderCount} 筆訂單</option>
                  ))}
                </select>
              </div>
              {mergeSourceKey && mergeTargetKey && (
                <div className="bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800">
                  將把「{unifiedCustomers.find(c => c.key === mergeSourceKey)?.name}」的所有訂單合入「{unifiedCustomers.find(c => c.key === mergeTargetKey)?.name}」，此操作無法復原。
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={handleMergeCustomers}
                  disabled={!mergeSourceKey || !mergeTargetKey || mergeSourceKey === mergeTargetKey || mergingCustomer}
                  className="flex-1 bg-neutral-900 text-white py-3 text-sm font-medium hover:bg-neutral-800 transition-colors uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
                >{mergingCustomer ? '合併中…' : '確認合併'}</button>
                <button onClick={() => setShowMergeModal(false)} className="flex-1 border border-neutral-300 text-neutral-700 py-3 text-sm font-medium hover:bg-neutral-50 transition-colors uppercase tracking-wider">取消</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
