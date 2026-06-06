import { useState, useEffect } from 'react';
import { TrendingUp, Package, ShoppingBag, AlertTriangle, BarChart2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Wallpaper, Order } from '../lib/supabase';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';

const LOW_STOCK_THRESHOLD = 10;

const COLORS = ['#171717','#404040','#737373','#a3a3a3','#d4d4d4','#e5e5e5'];

export default function DashboardPage() {
  const [wallpapers, setWallpapers] = useState<Wallpaper[]>([]);
  const [orders, setOrders]         = useState<Order[]>([]);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    const [{ data: wpData }, { data: ordersData }, { data: itemsData }] = await Promise.all([
      supabase.from('wallpapers').select('*'),
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('order_items').select('*, wallpapers(*)'),
    ]);

    const ordersWithItems = (ordersData || []).map(o => ({
      ...o,
      order_items: (itemsData || [])
        .filter((i: any) => i.order_id === o.id)
        .map((i: any) => ({ ...i, wallpaper: i.wallpapers }))
    }));

    setWallpapers(wpData || []);
    setOrders(ordersWithItems);
    setLoading(false);
  };

  // ── 統計計算 ──
  const completedOrders  = orders.filter(o => o.status === 'completed');
  const pendingOrders    = orders.filter(o => o.status === 'pending');
  const totalRevenue     = completedOrders.reduce((s, o) => s + (o.total_amount || 0), 0);
  const pendingRevenue   = pendingOrders.reduce((s, o) => s + (o.total_amount || 0), 0);
  const lowStockItems    = wallpapers.filter(w => w.is_active && w.stock <= LOW_STOCK_THRESHOLD);

  // 各分類銷售比例（用 completed orders 的 order_items）
  const categorySales: Record<string, number> = {};
  completedOrders.forEach(o => {
    (o.order_items || []).forEach((item: any) => {
      const cat = item.wallpaper?.category || '未分類';
      categorySales[cat] = (categorySales[cat] || 0) + (item.subtotal || 0);
    });
  });
  const pieData = Object.entries(categorySales).map(([name, value]) => ({ name, value }));

  // 各產品利潤排行（Top 10）
  const profitData = wallpapers
    .filter(w => w.cost_per_piece && w.price_per_piece)
    .map(w => ({
      name: w.title.length > 12 ? w.title.slice(0, 12) + '…' : w.title,
      fullName: w.title,
      profit: Math.round((w.price_per_piece! - w.cost_per_piece!) * 100) / 100,
      margin: Math.round(((w.price_per_piece! - w.cost_per_piece!) / w.price_per_piece!) * 1000) / 10,
    }))
    .sort((a, b) => b.margin - a.margin)
    .slice(0, 10);

  // 月度訂單金額（近6個月）
  const monthlyData: Record<string, number> = {};
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}`;
    monthlyData[key] = 0;
  }
  orders.forEach(o => {
    const d = new Date(o.created_at);
    const key = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}`;
    if (key in monthlyData) monthlyData[key] += o.total_amount || 0;
  });
  const monthlyChartData = Object.entries(monthlyData).map(([month, amount]) => ({ month, amount }));

  if (loading) return (
    <div className="text-center py-12">
      <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-neutral-300 border-t-neutral-900"/>
    </div>
  );

  return (
    <div className="space-y-8">

      {/* ── KPI 卡片 ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: '已完成訂單收入', value: `NT$ ${totalRevenue.toLocaleString()}`, icon: <TrendingUp size={20}/>, sub: `${completedOrders.length} 筆訂單` },
          { label: '待確認訂單金額', value: `NT$ ${pendingRevenue.toLocaleString()}`, icon: <ShoppingBag size={20}/>, sub: `${pendingOrders.length} 筆待處理` },
          { label: '活躍產品', value: wallpapers.filter(w => w.is_active).length, icon: <Package size={20}/>, sub: `共 ${wallpapers.length} 筆產品` },
          { label: '低庫存警示', value: lowStockItems.length, icon: <AlertTriangle size={20}/>, sub: `庫存 ≤ ${LOW_STOCK_THRESHOLD} 片`, alert: lowStockItems.length > 0 },
        ].map((card, i) => (
          <div key={i} className={`p-5 border ${card.alert ? 'border-red-200 bg-red-50' : 'border-neutral-200 bg-white'}`}>
            <div className={`flex items-center justify-between mb-3 ${card.alert ? 'text-red-600' : 'text-neutral-500'}`}>
              <span className="text-xs uppercase tracking-wider font-medium">{card.label}</span>
              {card.icon}
            </div>
            <p className={`text-2xl font-bold ${card.alert ? 'text-red-700' : 'text-neutral-900'}`}>{card.value}</p>
            <p className="text-xs text-neutral-500 mt-1">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* ── 月度訂單趨勢 ── */}
      <div className="bg-white border border-neutral-200 p-6">
        <h3 className="text-sm font-bold text-neutral-900 uppercase tracking-wider mb-6 flex items-center space-x-2">
          <BarChart2 size={16}/><span>近 6 個月訂單金額</span>
        </h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={monthlyChartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5"/>
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#737373' }}/>
            <YAxis tick={{ fontSize: 11, fill: '#737373' }} tickFormatter={v => `NT$${(v/1000).toFixed(0)}k`}/>
            <Tooltip formatter={(v: number | string | undefined) => [`NT$ ${Number(v ?? 0).toLocaleString()}`, '訂單金額']}/>
            <Bar dataKey="amount" fill="#171717" radius={[2,2,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* ── 各分類銷售比例 ── */}
        <div className="bg-white border border-neutral-200 p-6">
          <h3 className="text-sm font-bold text-neutral-900 uppercase tracking-wider mb-6">各分類銷售比例</h3>
          {pieData.length === 0 ? (
            <p className="text-neutral-400 text-sm text-center py-8">尚無已完成訂單資料</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0)*100).toFixed(0)}%`} labelLine={false}>
                  {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}
                </Pie>
                <Tooltip formatter={(v: number | string | undefined) => `NT$ ${Number(v ?? 0).toLocaleString()}`}/>
                <Legend/>
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* ── 產品毛利率排行 ── */}
        <div className="bg-white border border-neutral-200 p-6">
          <h3 className="text-sm font-bold text-neutral-900 uppercase tracking-wider mb-6">產品毛利率 TOP 10</h3>
          {profitData.length === 0 ? (
            <p className="text-neutral-400 text-sm text-center py-8">尚無成本資料，請先執行 migration</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={profitData} layout="vertical" margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5"/>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#737373' }} tickFormatter={v => `${v}%`} domain={[0, 100]}/>
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#737373' }} width={80}/>
                <Tooltip formatter={(v: number | string | undefined) => [`${v ?? 0}%`, '毛利率']} labelFormatter={(l) => profitData.find(d => d.name === l)?.fullName || l}/>
                <Bar dataKey="margin" fill="#171717" radius={[0,2,2,0]}/>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── 低庫存警示 ── */}
      {lowStockItems.length > 0 && (
        <div className="bg-white border border-red-200 p-6">
          <h3 className="text-sm font-bold text-red-700 uppercase tracking-wider mb-4 flex items-center space-x-2">
            <AlertTriangle size={16}/><span>低庫存警示（≤ {LOW_STOCK_THRESHOLD} 片）</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {lowStockItems.map(w => (
              <div key={w.id} className="flex items-center justify-between bg-red-50 px-4 py-3 border border-red-100">
                <div>
                  <p className="text-sm font-medium text-neutral-900">{w.title}</p>
                  <p className="text-xs text-neutral-500">{w.category}</p>
                </div>
                <span className={`text-sm font-bold ${w.stock === 0 ? 'text-red-600' : 'text-orange-600'}`}>
                  {w.stock === 0 ? '缺貨' : `${w.stock} 片`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 最新訂單 ── */}
      <div className="bg-white border border-neutral-200">
        <div className="px-6 py-4 border-b border-neutral-200">
          <h3 className="text-sm font-bold text-neutral-900 uppercase tracking-wider">最新 10 筆訂單</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-neutral-50">
            <tr>{['訂單編號','客戶','金額','狀態','日期'].map(h => (
              <th key={h} className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {orders.slice(0, 10).map(o => {
              const statusStyle: Record<string, string> = {
                pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
                confirmed: 'bg-blue-50 text-blue-700 border-blue-200',
                completed: 'bg-green-50 text-green-700 border-green-200',
                cancelled: 'bg-red-50 text-red-700 border-red-200',
              };
              const statusLabel: Record<string, string> = { pending: 'Pending', confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' };
              return (
                <tr key={o.id} className="hover:bg-neutral-50">
                  <td className="px-6 py-3 font-mono text-xs text-neutral-700">{o.order_number}</td>
                  <td className="px-6 py-3 text-neutral-900">{o.customer_name}</td>
                  <td className="px-6 py-3 text-neutral-900 font-medium">
                    {o.total_amount ? `NT$ ${o.total_amount.toLocaleString()}` : '—'}
                  </td>
                  <td className="px-6 py-3">
                    <span className={`inline-flex px-2 py-0.5 text-xs font-medium border ${statusStyle[o.status] || statusStyle.pending}`}>
                      {statusLabel[o.status] || o.status}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-neutral-500 text-xs">
                    {new Date(o.created_at).toLocaleDateString('zh-TW')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {orders.length === 0 && <p className="text-center py-8 text-neutral-400 text-sm">尚無訂單</p>}
      </div>
    </div>
  );
}
