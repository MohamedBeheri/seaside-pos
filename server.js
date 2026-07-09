// ===================================================================
//  الخادم — REST API لنظام نقاط البيع وإدارة المخازن (كافيه على البحر)
//  POS + Recipes/BOM + Inventory back-flush + Moving-Average + Governance
// ===================================================================
import express from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { db, get, all, run, tx, nowISO, reopenDb, DB_PATH } from './db/database.js';
import { seed, migrate } from './db/seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4700;
const app = express();
app.use(express.json({ limit: '6mb' }));   // يسمح برفع لوجو مخصص base64

// تهيئة تلقائية لقاعدة البيانات عند الإقلاع + ترحيل الميزات الجديدة
try {
  if (seed()) console.log('🌱 تم تهيئة قاعدة بيانات الكافيه وبذرها تلقائياً.');
  migrate();
} catch (e) { console.error('⚠️ فشل تهيئة قاعدة البيانات:', e.message); }

// ---------- مصادقة وصلاحيات ----------
function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const sess = token && get('SELECT * FROM sessions WHERE token=?', token);
  if (!sess) return res.status(401).json({ error: 'غير مصرح — سجّل الدخول' });
  const u = get(`SELECT u.*, r.key role_key, r.name_ar role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?`, sess.user_id);
  if (!u || !u.is_active) return res.status(401).json({ error: 'الحساب غير مفعّل' });
  req.user = u; next();
}
const requireRole = (...keys) => (req, res, next) =>
  keys.includes(req.user.role_key) ? next() : res.status(403).json({ error: 'هذا الإجراء غير متاح لدورك' });
const admin = requireRole('admin');
// إشعار: لمستخدم محدد أو لكل من يحمل دوراً معيناً
function notify({ user_id = null, role_key = null, type = 'system', icon = '🔔', title, body = null, ref_type = null, ref_id = null }) {
  run('INSERT INTO notifications(user_id,role_key,type,icon,title,body,ref_type,ref_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    user_id, role_key, type, icon, title, body, ref_type, ref_id, nowISO());
}

const logAudit = (a, ty, id, ac, d = {}) =>
  run('INSERT INTO audit_log(actor_id,entity_type,entity_id,action,diff,created_at) VALUES(?,?,?,?,?,?)', a, ty, id, ac, JSON.stringify(d), nowISO());

// ===================================================================
//  الواتساب: إرسال رسائل عبر WhatsApp Cloud API (أو وضع تطوير محلي)
// ===================================================================
// تطبيع رقم مصري لصيغة الواتساب الدولية: 01xxxxxxxxx → 201xxxxxxxxx
function waNormalize(phone, countryCode = '20') {
  let p = (phone || '').replace(/[^\d]/g, '');
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('0')) p = countryCode + p.slice(1);          // محلي → دولي
  else if (!p.startsWith(countryCode) && p.length <= 10) p = countryCode + p;
  return p;
}
// آخر كود تطويري مُرسل (يُعرض للأدمن/المطوّر عندما لا يوجد اتصال واتساب حقيقي)
let LAST_DEV_OTP = null;
async function sendWhatsApp(phone, text) {
  const token = process.env.WA_TOKEN, phoneId = process.env.WA_PHONE_ID;
  const to = waNormalize(phone, settingsObj().wa_country || '20');
  if (!token || !phoneId) {
    // وضع التطوير: لا اتصال حقيقي — نسجّل الرسالة (تظهر في اللوج وتُرجَع للواجهة)
    console.log(`\n📲 [WhatsApp DEV] → +${to}\n${text}\n`);
    return { dev: true, to };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    });
    const d = await res.json();
    if (!res.ok) console.error('⚠️ WhatsApp send failed:', JSON.stringify(d));
    return { ok: res.ok, to, response: d };
  } catch (e) { console.error('⚠️ WhatsApp error:', e.message); return { error: e.message, to }; }
}
const waConnected = () => !!(process.env.WA_TOKEN && process.env.WA_PHONE_ID);

// ---------- مصادقة العميل (المتجر) عبر جلسة منفصلة ----------
function shopAuth(req, res, next) {
  const token = (req.headers['x-shop-token'] || '').trim();
  const sess = token && get('SELECT * FROM customer_sessions WHERE token=?', token);
  if (!sess) return res.status(401).json({ error: 'سجّل الدخول برقم موبايلك أولاً' });
  const c = get('SELECT * FROM customers WHERE id=? AND is_active=1', sess.customer_id);
  if (!c) return res.status(401).json({ error: 'الحساب غير موجود' });
  req.customer = c; next();
}
// نفس الشيء لكن اختياري (يمرر req.customer إن وُجد)
function shopAuthOptional(req, _res, next) {
  const token = (req.headers['x-shop-token'] || '').trim();
  const sess = token && get('SELECT * FROM customer_sessions WHERE token=?', token);
  if (sess) req.customer = get('SELECT * FROM customers WHERE id=? AND is_active=1', sess.customer_id) || null;
  next();
}

const settingsObj = () => Object.fromEntries(all('SELECT key,value FROM settings').map(r => [r.key, r.value]));
// تاريخ اليوم المحلي (أو قبله بـ off يوم) بصيغة YYYY-MM-DD — متوافق مع nowISO المحلي
const localDay = (off = 0) => { const d = new Date(Date.now() - off * 864e5); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const taxRate = () => (+(get("SELECT value FROM settings WHERE key='tax_rate'")?.value || 0)) / 100;

// ---------- الخزينة والورديات ونقاط الولاء (مساعدات) ----------
const openShiftOf = (userId) => get("SELECT * FROM shifts WHERE user_id=? AND status='open'", userId);

// تسجيل حركة خزينة على طريقة دفع (موجب=إيداع، سالب=صرف)
function moneyMove({ method_id, amount, ref_type, ref_id = null, note = null, user_id = null, shift_id = null }) {
  if (!method_id || !+amount) return;
  run('INSERT INTO money_movements(method_id,amount,ref_type,ref_id,note,shift_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
    method_id, +(+amount).toFixed(2), ref_type, ref_id, note, shift_id, user_id, nowISO());
}
const methodBalance = (id) => {
  const m = get('SELECT opening_balance FROM payment_methods WHERE id=?', id);
  const s = get('SELECT COALESCE(SUM(amount),0) s FROM money_movements WHERE method_id=?', id).s;
  return +(((m?.opening_balance) || 0) + s).toFixed(2);
};

// إعدادات نقاط الولاء
function pointsCfg() {
  const s = settingsObj();
  return {
    enabled: s.points_enabled === '1',
    perCur: +s.points_per_currency || 0,      // نقاط لكل 1 وحدة عملة
    value: +s.point_value || 0,               // قيمة النقطة بالعملة
    minRedeem: +s.points_min_redeem || 0,
    maxPct: +s.points_max_discount_pct || 100,
  };
}
function logPoints(customer_id, points, kind, note, ref_type, ref_id, by) {
  if (!customer_id || !points) return;
  run('UPDATE customers SET points=ROUND(points+?,2) WHERE id=?', +points, customer_id);
  run('INSERT INTO points_log(customer_id,points,kind,note,ref_type,ref_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
    customer_id, +points, kind, note, ref_type, ref_id, by, nowISO());
}
// مولّد أرقام مستندات موحّد: RCP-2026-0001 ...
function genDocNo(table, col, prefix) {
  const year = nowISO().slice(0, 4);
  const n = get(`SELECT COUNT(*) c FROM ${table} WHERE ${col} LIKE ?`, `${prefix}-${year}-%`).c + 1;
  return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
}

// ---------- منطق التكلفة والوصفات ----------
function recipeCost(productId) {
  const rows = all('SELECT pr.qty, m.avg_cost FROM product_recipes pr JOIN raw_materials m ON m.id=pr.material_id WHERE pr.product_id=?', productId);
  return rows.reduce((s, r) => s + r.qty * r.avg_cost, 0);
}
function recomputeProductCost(productId) {
  run('UPDATE products SET cost=? WHERE id=?', +recipeCost(productId).toFixed(3), productId);
}
// إعادة حساب تكلفة كل صنف يستخدم مادة معيّنة (بعد تغيّر متوسط تكلفتها)
function recomputeProductsUsing(materialId) {
  all('SELECT DISTINCT product_id pid FROM product_recipes WHERE material_id=?', materialId).forEach(r => recomputeProductCost(r.pid));
}

// ---------- الخصم التلقائي (Back-flush) ----------
function backflushOrder(orderId) {
  const items = all('SELECT oi.*, p.track_stock FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?', orderId);
  const t = nowISO();
  for (const it of items) {
    if (!it.product_id || it.track_stock === 0) continue;
    const recipe = all('SELECT pr.material_id, pr.qty, m.warehouse_id, m.avg_cost FROM product_recipes pr JOIN raw_materials m ON m.id=pr.material_id WHERE pr.product_id=?', it.product_id);
    for (const r of recipe) {
      const used = r.qty * it.qty;
      const mat = get('SELECT qty FROM raw_materials WHERE id=?', r.material_id);
      const bal = +(mat.qty - used).toFixed(4);
      run('UPDATE raw_materials SET qty=? WHERE id=?', bal, r.material_id);
      run(`INSERT INTO inventory_transactions(material_id,warehouse_id,type,qty,unit_cost,balance,ref_type,ref_id,note,created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?)`, r.material_id, r.warehouse_id, 'sale', -used, r.avg_cost, bal, 'order', orderId, 'خصم بيع: ' + it.name_ar, t);
    }
  }
}
// عكس الخصم (إرجاع المكونات للمخزن) — عند تعديل/إلغاء فاتورة مدفوعة
function restockOrder(orderId) {
  const items = all('SELECT oi.*, p.track_stock FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?', orderId);
  const t = nowISO();
  for (const it of items) {
    if (!it.product_id || it.track_stock === 0) continue;
    const recipe = all('SELECT pr.material_id, pr.qty, m.warehouse_id, m.avg_cost FROM product_recipes pr JOIN raw_materials m ON m.id=pr.material_id WHERE pr.product_id=?', it.product_id);
    for (const r of recipe) {
      const back = r.qty * it.qty;
      const mat = get('SELECT qty FROM raw_materials WHERE id=?', r.material_id);
      const bal = +(mat.qty + back).toFixed(4);
      run('UPDATE raw_materials SET qty=? WHERE id=?', bal, r.material_id);
      run(`INSERT INTO inventory_transactions(material_id,warehouse_id,type,qty,unit_cost,balance,ref_type,ref_id,note,created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?)`, r.material_id, r.warehouse_id, 'adjust', back, r.avg_cost, bal, 'order', orderId, 'إرجاع تعديل فاتورة: ' + it.name_ar, t);
    }
  }
}

// ===================================================================
//  المصادقة
// ===================================================================
app.get('/api/health', (_q, res) => res.json({ ok: true, time: nowISO() }));

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = get('SELECT * FROM users WHERE email=? AND is_active=1', email);
  if (!u || !bcrypt.compareSync(password || '', u.password_hash))
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  const token = randomUUID();
  run('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)', token, u.id, nowISO());
  res.json({ token, user: me(u.id) });
});
const me = (id) => get(`SELECT u.id,u.full_name,u.email,u.pin,r.key role_key,r.name_ar role_name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?`, id);
app.post('/api/logout', auth, (req, res) => { run('DELETE FROM sessions WHERE token=?', (req.headers.authorization || '').replace('Bearer ', '')); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json(me(req.user.id)));

// بيانات مرجعية للواجهة
app.get('/api/meta', auth, (_q, res) => res.json({
  categories: all('SELECT id,name_ar,icon,color FROM categories WHERE is_active=1 ORDER BY sort_order,id'),
  tables: all('SELECT id,name_ar,seats FROM tables WHERE is_active=1 ORDER BY sort_order,id'),
  payment_methods: all("SELECT id,name_ar,name_en,icon,kind FROM payment_methods WHERE is_active=1 AND show_in_pos=1 ORDER BY sort_order,id"),
  warehouses: all('SELECT id,name_ar,kind FROM warehouses WHERE is_active=1 ORDER BY sort_order,id'),
  units: all('SELECT id,name_ar,symbol FROM units WHERE is_active=1 ORDER BY id'),
  waiters: all("SELECT u.id,u.full_name FROM users u WHERE u.is_active=1 ORDER BY u.full_name"),
  taxes: all('SELECT id,name_ar,name_en,rate,show_on_receipt FROM taxes WHERE is_active=1 AND rate>0 ORDER BY sort_order,id'),
  settings: settingsObj(),
}));

// ===================================================================
//  لوحة المعلومات
// ===================================================================
app.get('/api/dashboard', auth, (req, res) => {
  const today = localDay(0);
  const yest = localDay(1);
  const dayAgg = (d) => get(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) sales, COALESCE(SUM(total-cost_total-tax),0) profit, COALESCE(SUM(guests),0) guests
    FROM orders WHERE status='paid' AND substr(created_at,1,10)=?`, d);
  const tD = dayAgg(today), yD = dayAgg(yest);
  const pct = (a, b) => b ? Math.round(((a - b) / b) * 100) : (a ? 100 : 0);

  // مبيعات آخر 14 يوماً
  const trend = all(`SELECT substr(created_at,1,10) d, COALESCE(SUM(total),0) sales, COUNT(*) orders
    FROM orders WHERE status='paid' AND substr(created_at,1,10) >= ? GROUP BY d ORDER BY d`,
    localDay(13));

  const topProducts = all(`SELECT oi.name_ar, SUM(oi.qty) qty, SUM(oi.qty*oi.price) sales
    FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status='paid'
    GROUP BY oi.name_ar ORDER BY qty DESC LIMIT 6`);
  const byPayment = all(`SELECT pm.name_ar, pm.icon, COUNT(*) cnt, COALESCE(SUM(o.total),0) total
    FROM orders o JOIN payment_methods pm ON pm.id=o.payment_method_id WHERE o.status='paid'
    GROUP BY pm.id ORDER BY total DESC`);
  const recent = all(`SELECT o.id,o.invoice_no,o.order_type,o.status,o.total,o.created_at,t.name_ar table_name
    FROM orders o LEFT JOIN tables t ON t.id=o.table_id ORDER BY o.id DESC LIMIT 8`);
  const lowStock = all(`SELECT id,name_ar,qty,reorder_point FROM raw_materials WHERE is_active=1 AND qty<=reorder_point ORDER BY (qty/NULLIF(reorder_point,0)) LIMIT 10`);

  res.json({
    today: { orders: tD.orders, sales: tD.sales, profit: tD.profit, guests: tD.guests,
      ordersPct: pct(tD.orders, yD.orders), salesPct: pct(tD.sales, yD.sales), profitPct: pct(tD.profit, yD.profit) },
    avgOrder: tD.orders ? tD.sales / tD.orders : 0,
    trend, topProducts, byPayment, recent, lowStock,
    lowStockCount: get('SELECT COUNT(*) c FROM raw_materials WHERE is_active=1 AND qty<=reorder_point').c,
  });
});

// سلسلة المبيعات/صافي الربح بفلتر مدة (للوحة)
app.get('/api/dashboard/series', auth, admin, (req, res) => {
  const days = Math.min(180, Math.max(1, +req.query.days || 14));
  const fromD = localDay(days - 1);
  const sales = all(`SELECT substr(created_at,1,10) d, COALESCE(SUM(total),0) sales, COALESCE(SUM(total-cost_total-tax),0) gross
    FROM orders WHERE status='paid' AND substr(created_at,1,10)>=? GROUP BY d`, fromD);
  const exp = all(`SELECT COALESCE(spent_at,substr(created_at,1,10)) d, COALESCE(SUM(amount),0) expenses
    FROM expenses WHERE COALESCE(spent_at,substr(created_at,1,10))>=? GROUP BY d`, fromD);
  const sMap = {}, eMap = {};
  sales.forEach(r => sMap[r.d] = r); exp.forEach(r => eMap[r.d] = r.expenses);
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = localDay(days - 1 - i);
    const s = sMap[d] || { sales: 0, gross: 0 }; const e = eMap[d] || 0;
    out.push({ d, sales: s.sales, gross: s.gross, expenses: e, net: +(s.gross - e).toFixed(2) });
  }
  res.json(out);
});

// ===================================================================
//  المصروفات
// ===================================================================
app.get('/api/expense-cats', auth, (_q, res) => res.json(all('SELECT id,name_ar,icon FROM expense_categories WHERE is_active=1 ORDER BY sort_order,id')));
app.get('/api/expenses', auth, admin, (req, res) => {
  const from = req.query.from || '0000', to = (req.query.to || '9999') + '￿';
  const rows = all(`SELECT e.*, ec.name_ar category, ec.icon, u.full_name by_name FROM expenses e
    LEFT JOIN expense_categories ec ON ec.id=e.category_id LEFT JOIN users u ON u.id=e.created_by
    WHERE COALESCE(e.spent_at,substr(e.created_at,1,10))>=? AND COALESCE(e.spent_at,substr(e.created_at,1,10))<=? ORDER BY e.id DESC`, from, to);
  const byCat = all(`SELECT ec.name_ar, ec.icon, COALESCE(SUM(e.amount),0) total FROM expenses e
    LEFT JOIN expense_categories ec ON ec.id=e.category_id
    WHERE COALESCE(e.spent_at,substr(e.created_at,1,10))>=? AND COALESCE(e.spent_at,substr(e.created_at,1,10))<=? GROUP BY ec.id ORDER BY total DESC`, from, to);
  res.json({ rows, total: rows.reduce((s, r) => s + r.amount, 0), byCat });
});
app.post('/api/expenses', auth, admin, (req, res) => {
  const b = req.body || {};
  if (!(+b.amount > 0)) return res.status(400).json({ error: 'أدخل قيمة المصروف' });
  const shift = openShiftOf(req.user.id);
  const id = tx(() => {
    const eid = run('INSERT INTO expenses(category_id,amount,note,spent_at,created_by,created_at,method_id) VALUES(?,?,?,?,?,?,?)',
      b.category_id || null, +b.amount, b.note || null, b.spent_at || nowISO().slice(0, 10), req.user.id, nowISO(), b.method_id || null).lastInsertRowid;
    if (b.method_id) moneyMove({ method_id: b.method_id, amount: -(+b.amount), ref_type: 'expense', ref_id: eid,
      note: 'مصروف: ' + (b.note || ''), user_id: req.user.id, shift_id: shift?.id || null });
    return eid;
  });
  res.json({ id });
});
app.delete('/api/expenses/:id', auth, admin, (req, res) => {
  const e = get('SELECT * FROM expenses WHERE id=?', req.params.id);
  if (!e) return res.status(404).json({ error: 'غير موجود' });
  tx(() => {
    // عكس حركة الخزينة إن وُجدت
    if (e.method_id) moneyMove({ method_id: e.method_id, amount: +e.amount, ref_type: 'adjust', ref_id: e.id,
      note: 'إلغاء مصروف', user_id: req.user.id, shift_id: openShiftOf(req.user.id)?.id || null });
    run('DELETE FROM expenses WHERE id=?', e.id);
  });
  res.json({ ok: true });
});

// ===================================================================
//  نقطة البيع (POS)
// ===================================================================
app.get('/api/pos/products', auth, (_q, res) => {
  res.json(all(`SELECT p.id,p.name_ar,p.price,p.cost,p.image,p.category_id,c.name_ar category,c.color,c.icon,p.track_stock,p.sku,p.barcode
    FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.is_active=1 ORDER BY p.sort_order,p.id`));
});

function genInvoiceNo() {
  const year = nowISO().slice(0, 4);
  const n = get("SELECT COUNT(*) c FROM orders WHERE invoice_no LIKE ?", 'INV-' + year + '-%').c + 1;
  return `INV-${year}-${String(n).padStart(4, '0')}`;
}

// الضرائب المفعّلة (قيمة مضافة / خدمة / ...) — تُحسب كلٌّ منها على الوعاء بعد الخصم
const activeTaxes = () => all('SELECT * FROM taxes WHERE is_active=1 AND rate>0 ORDER BY sort_order,id');
function computeTotals(items, discount = 0) {
  let subtotal = 0, cost = 0;
  items.forEach(i => { subtotal += i.price * i.qty; cost += (i.cost || 0) * i.qty; });
  const taxable = Math.max(0, subtotal - discount);
  const taxes = activeTaxes().map(tx => ({
    name: tx.name_ar, name_en: tx.name_en || tx.name_ar, rate: tx.rate,
    show: tx.show_on_receipt ? 1 : 0, amount: +(taxable * tx.rate / 100).toFixed(2),
  }));
  const tax = +taxes.reduce((s, tx) => s + tx.amount, 0).toFixed(2);
  const total = +(taxable + tax).toFixed(2);
  return { subtotal: +subtotal.toFixed(2), cost: +cost.toFixed(2), tax, total, taxes };
}

// خصم النقاط المسموح به لعميل على إجمالي معيّن (يُحسب من الخادم — منع تلاعب)
function computePointsRedeem(customer_id, points_used, grossTotal) {
  const cfg = pointsCfg();
  if (!cfg.enabled || !customer_id || !(+points_used > 0)) return { points: 0, discount: 0 };
  const cust = get('SELECT points FROM customers WHERE id=?', customer_id);
  if (!cust) return { points: 0, discount: 0 };
  let pts = Math.min(+points_used, cust.points);
  if (pts < cfg.minRedeem) return { points: 0, discount: 0 };
  const maxDisc = grossTotal * (cfg.maxPct / 100);
  let disc = pts * cfg.value;
  if (disc > maxDisc) { disc = maxDisc; pts = cfg.value ? disc / cfg.value : 0; }
  return { points: +pts.toFixed(2), discount: +disc.toFixed(2) };
}

// إنشاء طلب (وقد يُدفع مباشرة — نقدي كامل أو جزئي أو آجل على عميل)
app.post('/api/orders', auth, (req, res) => {
  const b = req.body || {};
  const items = (b.items || []).filter(i => i.product_id && i.qty > 0);
  if (!items.length) return res.status(400).json({ error: 'أضف صنفاً واحداً على الأقل' });
  // اجلب الأسعار والتكلفة من قاعدة البيانات (منع التلاعب من الواجهة)
  const prepared = items.map(i => {
    const p = get('SELECT id,name_ar,price,cost FROM products WHERE id=?', i.product_id);
    if (!p) throw new Error('صنف غير موجود');
    return { product_id: p.id, name_ar: p.name_ar, qty: +i.qty, price: p.price, cost: p.cost, note: i.note || null };
  });
  const discount = +b.discount || 0;
  const customerId = b.customer_id || null;
  // خصم النقاط (يُحسب على الإجمالي قبل النقاط)
  const gross = computeTotals(prepared, discount);
  const redeem = computePointsRedeem(customerId, b.points_used, gross.total);
  const tot = redeem.discount ? computeTotals(prepared, discount + redeem.discount) : gross;
  const pay = b.status === 'paid';
  const t = nowISO();
  const tip = +b.tip || 0;
  const grandTotal = +(tot.total + tip).toFixed(2);

  // المحصَّل الآن: كامل / جزئي / صفر (آجل) — الجزئي والآجل يتطلبان عميلاً
  const tendered = pay ? (+b.paid_cash || 0) : 0;
  const received = pay ? Math.min(tendered, grandTotal) : 0;
  const remaining = pay ? +(grandTotal - received).toFixed(2) : grandTotal;
  if (pay && remaining > 0 && !customerId)
    return res.status(400).json({ error: 'البيع الآجل/الجزئي يتطلب اختيار عميل' });
  const payStatus = !pay ? 'unpaid' : (remaining <= 0 ? 'paid' : (received > 0 ? 'partial' : 'credit'));
  const shift = openShiftOf(req.user.id);
  const cfg = pointsCfg();
  const earned = (pay && cfg.enabled && customerId) ? +(grandTotal * cfg.perCur).toFixed(2) : 0;

  const out = tx(() => {
    const oid = run(`INSERT INTO orders(invoice_no,order_type,table_id,guests,waiter_id,status,subtotal,discount,tax,tip,total,cost_total,payment_method_id,paid_cash,change_due,cashier_id,note,created_at,paid_at,
      customer_id,paid_amount,payment_status,shift_id,points_earned,points_used,points_discount,tax_detail)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      genInvoiceNo(), b.order_type || 'dine_in', b.table_id || null, b.guests || 1, b.waiter_id || null,
      pay ? 'paid' : (b.status === 'confirmed' ? 'confirmed' : 'open'),
      tot.subtotal, discount, tot.tax, tip, grandTotal, tot.cost,
      pay ? (b.payment_method_id || null) : null, tendered,
      pay ? +((tendered - grandTotal) > 0 ? (tendered - grandTotal) : 0).toFixed(2) : 0,
      req.user.id, b.note || null, t, pay ? t : null,
      customerId, received, payStatus, shift?.id || null, earned, redeem.points, redeem.discount,
      JSON.stringify(tot.taxes)).lastInsertRowid;
    prepared.forEach(p => run('INSERT INTO order_items(order_id,product_id,name_ar,qty,price,cost,note) VALUES(?,?,?,?,?,?,?)',
      oid, p.product_id, p.name_ar, p.qty, p.price, p.cost, p.note));
    if (pay) {
      backflushOrder(oid);
      if (received > 0) moneyMove({ method_id: b.payment_method_id, amount: received, ref_type: 'order', ref_id: oid,
        note: 'تحصيل فاتورة', user_id: req.user.id, shift_id: shift?.id || null });
      if (redeem.points > 0) logPoints(customerId, -redeem.points, 'redeem', 'استبدال نقاط في فاتورة', 'order', oid, req.user.id);
      if (earned > 0) logPoints(customerId, earned, 'earn', 'نقاط مكتسبة من فاتورة', 'order', oid, req.user.id);
    }
    return oid;
  });
  logAudit(req.user.id, 'order', out, pay ? 'create_paid' : 'create');
  res.json(orderDetail(out));
});

const orderDetail = (id) => {
  const o = get(`SELECT o.*, t.name_ar table_name, pm.name_ar payment_name, pm.name_en payment_name_en, pm.kind payment_kind, pm.icon payment_icon,
    cu.full_name cashier_name, wu.full_name waiter_name, c.name_ar customer_name, c.phone customer_phone, c.points customer_points FROM orders o
    LEFT JOIN tables t ON t.id=o.table_id LEFT JOIN payment_methods pm ON pm.id=o.payment_method_id
    LEFT JOIN users cu ON cu.id=o.cashier_id LEFT JOIN users wu ON wu.id=o.waiter_id
    LEFT JOIN customers c ON c.id=o.customer_id WHERE o.id=?`, id);
  if (o) {
    o.items = all('SELECT * FROM order_items WHERE order_id=? ORDER BY id', id);
    o.payments = all(`SELECT ip.*, pm.name_ar method_name FROM invoice_payments ip LEFT JOIN payment_methods pm ON pm.id=ip.method_id
      WHERE ip.kind='sale' AND ip.invoice_id=? ORDER BY ip.id`, id);
  }
  return o;
};

app.get('/api/orders', auth, (req, res) => {
  const f = [], p = [];
  if (req.query.status) { f.push(' AND o.status=?'); p.push(req.query.status); }
  if (req.query.type) { f.push(' AND o.order_type=?'); p.push(req.query.type); }
  if (req.query.from && req.query.to) { f.push(' AND substr(o.created_at,1,10) BETWEEN ? AND ?'); p.push(req.query.from, req.query.to); }
  else if (req.query.from) { f.push(' AND substr(o.created_at,1,10)>=?'); p.push(req.query.from); }
  else if (req.query.to) { f.push(' AND substr(o.created_at,1,10)<=?'); p.push(req.query.to); }
  else if (req.query.date) { f.push(' AND substr(o.created_at,1,10)=?'); p.push(req.query.date); }
  if (req.query.pay_status) { f.push(' AND o.payment_status=?'); p.push(req.query.pay_status); }
  if (req.query.customer) { f.push(' AND o.customer_id=?'); p.push(req.query.customer); }
  // آجل/جزئي فقط (المتبقي > 0)
  if (req.query.due === '1') f.push(" AND o.status='paid' AND o.payment_status IN('partial','credit')");
  // بحث ذكي: يتجاهل الشرطات/المسافات ويطابق رقم الفاتورة كاملاً أو جزء منه (مثال: "74" أو "0074" أو "INV-2026-0074")، وكذلك اسم الطاولة أو العميل أو رقم الطلب
  if (req.query.q) {
    const raw = req.query.q.trim();
    const norm = raw.replace(/[\s-]/g, '').toUpperCase();
    f.push(` AND (UPPER(REPLACE(REPLACE(o.invoice_no,'-',''),' ','')) LIKE ? OR o.id=? OR t.name_ar LIKE ? OR c.name_ar LIKE ? OR c.phone LIKE ?)`);
    p.push('%' + norm + '%', +raw || 0, '%' + raw + '%', '%' + raw + '%', '%' + raw + '%');
  }
  res.json(all(`SELECT o.id,o.invoice_no,o.order_type,o.status,o.total,o.created_at,o.guests,o.source,o.qr_name,
    o.paid_amount,o.payment_status,ROUND(o.total-o.paid_amount,2) remaining,
    t.name_ar table_name, pm.name_ar payment_name, c.name_ar customer_name FROM orders o
    LEFT JOIN tables t ON t.id=o.table_id LEFT JOIN payment_methods pm ON pm.id=o.payment_method_id
    LEFT JOIN customers c ON c.id=o.customer_id
    WHERE 1=1 ${f.join('')} ORDER BY o.id DESC LIMIT 200`, ...p));
});
app.get('/api/orders/:id', auth, (req, res) => {
  const o = orderDetail(req.params.id);
  if (!o) return res.status(404).json({ error: 'الطلب غير موجود' });
  res.json(o);
});

// حذف فاتورة نهائياً (أدمن فقط)
app.delete('/api/orders/:id', auth, admin, (req, res) => {
  const o = get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (!o) return res.status(404).json({ error: 'الطلب غير موجود' });
  tx(() => {
    run('DELETE FROM order_items WHERE order_id=?', o.id);
    run('DELETE FROM orders WHERE id=?', o.id);
  });
  logAudit(req.user.id, 'order', o.id, 'delete', { invoice: o.invoice_no });
  res.json({ ok: true });
});

// دفع طلب مفتوح/مؤكد (كامل أو جزئي أو آجل على عميل)
app.post('/api/orders/:id/pay', auth, (req, res) => {
  const o = get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (!o) return res.status(404).json({ error: 'غير موجود' });
  if (o.status === 'paid') return res.status(400).json({ error: 'الطلب مدفوع بالفعل' });
  if (o.status === 'cancelled') return res.status(400).json({ error: 'الطلب ملغي' });
  const b = req.body || {};
  const t = nowISO();
  const customerId = b.customer_id || o.customer_id || null;
  const total = +(o.total - o.tip + (+b.tip || 0)).toFixed(2);
  const tendered = +b.paid_cash || 0;
  const received = Math.min(tendered, total);
  const remaining = +(total - received).toFixed(2);
  if (remaining > 0 && !customerId) return res.status(400).json({ error: 'البيع الآجل/الجزئي يتطلب اختيار عميل' });
  const payStatus = remaining <= 0 ? 'paid' : (received > 0 ? 'partial' : 'credit');
  const change = +((tendered - total) > 0 ? (tendered - total) : 0).toFixed(2);
  const shift = openShiftOf(req.user.id);
  const cfg = pointsCfg();
  const earned = (cfg.enabled && customerId) ? +(total * cfg.perCur).toFixed(2) : 0;
  tx(() => {
    run(`UPDATE orders SET status='paid', payment_method_id=?, paid_cash=?, change_due=?, tip=?, total=?, cashier_id=?, paid_at=?,
      customer_id=?, paid_amount=?, payment_status=?, shift_id=COALESCE(shift_id,?), points_earned=? WHERE id=?`,
      b.payment_method_id || null, tendered, change, +b.tip || 0, total, req.user.id, t,
      customerId, received, payStatus, shift?.id || null, earned, o.id);
    backflushOrder(o.id);
    if (received > 0) moneyMove({ method_id: b.payment_method_id, amount: received, ref_type: 'order', ref_id: o.id,
      note: 'تحصيل فاتورة', user_id: req.user.id, shift_id: shift?.id || null });
    if (earned > 0) logPoints(customerId, earned, 'earn', 'نقاط مكتسبة من فاتورة', 'order', o.id, req.user.id);
  });
  logAudit(req.user.id, 'order', o.id, 'pay');
  res.json(orderDetail(o.id));
});

// سداد المتبقي من فاتورة آجلة/جزئية
app.post('/api/orders/:id/settle', auth, (req, res) => {
  const o = get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (!o) return res.status(404).json({ error: 'غير موجود' });
  if (o.status !== 'paid' || o.payment_status === 'paid') return res.status(400).json({ error: 'لا يوجد متبقٍ على هذه الفاتورة' });
  const b = req.body || {};
  const remaining = +(o.total - o.paid_amount).toFixed(2);
  const amount = Math.min(+b.amount || 0, remaining);
  if (!(amount > 0)) return res.status(400).json({ error: 'أدخل مبلغاً صحيحاً' });
  if (!b.method_id) return res.status(400).json({ error: 'اختر طريقة الدفع' });
  const shift = openShiftOf(req.user.id);
  const newPaid = +(o.paid_amount + amount).toFixed(2);
  const newStatus = newPaid >= o.total ? 'paid' : 'partial';
  tx(() => {
    run('INSERT INTO invoice_payments(kind,invoice_id,amount,method_id,note,shift_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
      'sale', o.id, amount, b.method_id, b.note || null, shift?.id || null, req.user.id, nowISO());
    run('UPDATE orders SET paid_amount=?, payment_status=?, payment_method_id=COALESCE(payment_method_id,?) WHERE id=?', newPaid, newStatus, b.method_id, o.id);
    moneyMove({ method_id: b.method_id, amount, ref_type: 'invoice_payment', ref_id: o.id,
      note: `سداد آجل ${o.invoice_no}`, user_id: req.user.id, shift_id: shift?.id || null });
  });
  logAudit(req.user.id, 'order', o.id, 'settle', { amount });
  res.json(orderDetail(o.id));
});

app.post('/api/orders/:id/cancel', auth, (req, res) => {
  const o = get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (!o) return res.status(404).json({ error: 'غير موجود' });
  if (o.status === 'paid' && req.user.role_key !== 'admin') return res.status(400).json({ error: 'لا يمكن إلغاء طلب مدفوع — الأدمن فقط' });
  tx(() => {
    if (o.status === 'paid') {
      restockOrder(o.id);   // أدمن يلغي فاتورة مدفوعة → إرجاع المخزون
      // عكس الحركة المالية والنقاط
      if (o.paid_amount > 0 && o.payment_method_id) moneyMove({ method_id: o.payment_method_id, amount: -o.paid_amount,
        ref_type: 'order', ref_id: o.id, note: `إلغاء فاتورة ${o.invoice_no}`, user_id: req.user.id,
        shift_id: openShiftOf(req.user.id)?.id || null });
      if (o.customer_id && o.points_earned > 0) logPoints(o.customer_id, -o.points_earned, 'manual_remove', 'إلغاء فاتورة', 'order', o.id, req.user.id);
      if (o.customer_id && o.points_used > 0) logPoints(o.customer_id, +o.points_used, 'manual_add', 'إلغاء فاتورة — استرداد نقاط', 'order', o.id, req.user.id);
    }
    run("UPDATE orders SET status='cancelled', note=? WHERE id=?", (req.body?.reason || o.note), o.id);
  });
  logAudit(req.user.id, 'order', o.id, 'cancel', { reason: req.body?.reason });
  res.json({ ok: true });
});

// تعديل فاتورة مدفوعة — الأدمن فقط (يعكس المخزون القديم ويطبّق الجديد)
app.put('/api/orders/:id', auth, admin, (req, res) => {
  const o = get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (!o) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (o.status === 'cancelled') return res.status(400).json({ error: 'الطلب ملغي' });
  const b = req.body || {};
  const items = (b.items || []).filter(i => i.product_id && i.qty > 0);
  if (!items.length) return res.status(400).json({ error: 'أضف صنفاً واحداً على الأقل' });
  const prepared = items.map(i => {
    const p = get('SELECT id,name_ar,price,cost FROM products WHERE id=?', i.product_id);
    if (!p) throw new Error('صنف غير موجود');
    return { product_id: p.id, name_ar: p.name_ar, qty: +i.qty, price: p.price, cost: p.cost, note: i.note || null };
  });
  const discount = b.discount !== undefined ? +b.discount : o.discount;
  const tot = computeTotals(prepared, discount);
  const wasPaid = o.status === 'paid';
  tx(() => {
    if (wasPaid) restockOrder(o.id);                      // عكس الخصم القديم
    run('DELETE FROM order_items WHERE order_id=?', o.id);
    prepared.forEach(p => run('INSERT INTO order_items(order_id,product_id,name_ar,qty,price,cost,note,kds_status) VALUES(?,?,?,?,?,?,?,?)',
      o.id, p.product_id, p.name_ar, p.qty, p.price, p.cost, p.note, 'served'));
    const tip = b.tip !== undefined ? +b.tip : o.tip;
    const total = +(tot.total + tip).toFixed(2);
    const change = wasPaid ? +(((o.paid_cash || 0) - total) > 0 ? (o.paid_cash - total) : 0).toFixed(2) : o.change_due;
    run('UPDATE orders SET subtotal=?,discount=?,tax=?,tip=?,total=?,cost_total=?,change_due=?,tax_detail=? WHERE id=?',
      tot.subtotal, discount, tot.tax, tip, total, tot.cost, change, JSON.stringify(tot.taxes), o.id);
    if (wasPaid) backflushOrder(o.id);                    // تطبيق الخصم الجديد
  });
  logAudit(req.user.id, 'order', o.id, 'edit_paid', { by: req.user.full_name });
  notify({ role_key: 'admin', type: 'system', icon: '✏️', title: `تعديل فاتورة ${o.invoice_no}`, body: `عدّلها ${req.user.full_name}`, ref_type: 'order', ref_id: o.id });
  res.json(orderDetail(o.id));
});

// ===================================================================
//  شاشة المطبخ (KDS)
// ===================================================================
// شاشة محطة (kitchen | bar) — تعرض أصناف المحطة فقط من الطلبات الجارية/المدفوعة
function stationBoard(station) {
  // طلبات QR غير المقبولة بعد (source=qr AND open) لا تظهر للمطبخ إلا بعد قبول الكاشير
  const orders = all(`SELECT o.id,o.invoice_no,o.order_type,o.created_at,t.name_ar table_name
    FROM orders o LEFT JOIN tables t ON t.id=o.table_id
    WHERE o.status IN('open','confirmed','paid') AND NOT(o.source='qr' AND o.status='open')
    ORDER BY o.id DESC LIMIT 60`);
  orders.forEach(o => o.items = all(`SELECT oi.id,oi.name_ar,oi.qty,oi.note,oi.kds_status, COALESCE(p.station,'bar') station
    FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id
    WHERE oi.order_id=? AND COALESCE(p.station,'bar')=? ORDER BY oi.id`, o.id, station));
  return orders.filter(o => o.items.length && o.items.some(i => i.kds_status !== 'served')).reverse();
}
app.get('/api/kds', auth, (_q, res) => res.json(stationBoard('kitchen')));
app.get('/api/bar', auth, (_q, res) => res.json(stationBoard('bar')));
app.post('/api/order-items/:id/status', auth, (req, res) => {
  const valid = ['new', 'preparing', 'ready', 'served'];
  if (!valid.includes(req.body?.status)) return res.status(400).json({ error: 'حالة غير صالحة' });
  run('UPDATE order_items SET kds_status=? WHERE id=?', req.body.status, req.params.id);
  res.json({ ok: true });
});

// ===================================================================
//  الإشعارات (كل المستويات)
// ===================================================================
const notifWhere = 'n.user_id=? OR n.role_key=?';
app.get('/api/notifications', auth, (req, res) => res.json(all(
  `SELECT * FROM notifications n WHERE ${notifWhere} ORDER BY n.id DESC LIMIT 100`, req.user.id, req.user.role_key)));
app.get('/api/notifications/count', auth, (req, res) => res.json({
  count: get(`SELECT COUNT(*) c FROM notifications n WHERE (${notifWhere}) AND n.is_read=0`, req.user.id, req.user.role_key).c }));
app.post('/api/notifications/:id/read', auth, (req, res) => {
  run(`UPDATE notifications SET is_read=1 WHERE id=? AND (${notifWhere})`, req.params.id, req.user.id, req.user.role_key); res.json({ ok: true });
});
app.post('/api/notifications/read-all', auth, (req, res) => {
  run(`UPDATE notifications SET is_read=1 WHERE ${notifWhere}`, req.user.id, req.user.role_key); res.json({ ok: true });
});

// ===================================================================
//  طلبات الشراء (المطبخ/البار → الأدمن/مدير المشتريات)
// ===================================================================
app.get('/api/purchase-requests', auth, (req, res) => {
  const mine = req.user.role_key !== 'admin' ? ' AND pr.requested_by=?' : '';
  const p = req.user.role_key !== 'admin' ? [req.user.id] : [];
  res.json(all(`SELECT pr.*, m.name_ar material, un.symbol unit, ru.full_name requested_name, hu.full_name handled_name
    FROM purchase_requests pr LEFT JOIN raw_materials m ON m.id=pr.material_id LEFT JOIN units un ON un.id=m.unit_id
    LEFT JOIN users ru ON ru.id=pr.requested_by LEFT JOIN users hu ON hu.id=pr.handled_by
    WHERE 1=1 ${mine} ORDER BY pr.id DESC LIMIT 100`, ...p));
});
app.post('/api/purchase-requests', auth, (req, res) => {
  const b = req.body || {};
  const mat = b.material_id ? get('SELECT name_ar FROM raw_materials WHERE id=?', b.material_id) : null;
  const name = mat ? mat.name_ar : (b.custom_name || '').trim();
  if (!name) return res.status(400).json({ error: 'حدّد المادة المطلوبة' });
  const station = ['kitchen', 'bar'].includes(req.user.role_key) ? req.user.role_key : (b.station || null);
  const id = run(`INSERT INTO purchase_requests(material_id,custom_name,qty,station,note,status,requested_by,created_at)
    VALUES(?,?,?,?,?, 'pending', ?,?)`, b.material_id || null, mat ? null : name, +b.qty || 1, station, b.note || null, req.user.id, nowISO()).lastInsertRowid;
  notify({ role_key: 'admin', type: 'purchase_request', icon: '🛒', title: `طلب شراء جديد: ${name}`,
    body: `الكمية: ${(+b.qty || 1)} — من ${station === 'kitchen' ? 'المطبخ' : station === 'bar' ? 'البار' : 'موظف'} (${req.user.full_name})`,
    ref_type: 'purchase_request', ref_id: id });
  logAudit(req.user.id, 'purchase_request', id, 'create', { name });
  res.json({ id });
});
app.post('/api/purchase-requests/:id/:action', auth, admin, (req, res) => {
  const pr = get('SELECT * FROM purchase_requests WHERE id=?', req.params.id);
  if (!pr) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (pr.status !== 'pending') return res.status(400).json({ error: 'الطلب تمت معالجته' });
  const action = req.params.action === 'reject' ? 'rejected' : 'fulfilled';
  run('UPDATE purchase_requests SET status=?, handled_by=?, handled_at=? WHERE id=?', action, req.user.id, nowISO(), pr.id);
  if (pr.requested_by) notify({ user_id: pr.requested_by, type: 'purchase_request', icon: action === 'fulfilled' ? '✅' : '❌',
    title: action === 'fulfilled' ? 'تم تنفيذ طلب الشراء' : 'رُفض طلب الشراء',
    body: pr.custom_name || (get('SELECT name_ar FROM raw_materials WHERE id=?', pr.material_id) || {}).name_ar || '', ref_type: 'purchase_request', ref_id: pr.id });
  res.json({ ok: true });
});

// ===================================================================
//  الأصناف والوصفات (Products & Recipes/BOM)
// ===================================================================
app.get('/api/products', auth, (_q, res) => res.json(all(`SELECT p.*, c.name_ar category,
  (SELECT COUNT(*) FROM product_recipes pr JOIN raw_materials m ON m.id=pr.material_id WHERE pr.product_id=p.id) ingredients,
  (SELECT COUNT(*) FROM product_recipes pr JOIN raw_materials m ON m.id=pr.material_id WHERE pr.product_id=p.id AND m.qty<=m.reorder_point) low_ing
  FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.sort_order,p.id`)));

// تنبيهات نقص المكونات (مع الأصناف المتأثرة)
app.get('/api/alerts', auth, (_q, res) => {
  const low = all(`SELECT m.id,m.name_ar,m.qty,m.reorder_point,un.symbol unit,w.name_ar warehouse
    FROM raw_materials m LEFT JOIN units un ON un.id=m.unit_id LEFT JOIN warehouses w ON w.id=m.warehouse_id
    WHERE m.is_active=1 AND m.qty<=m.reorder_point ORDER BY (m.qty/NULLIF(m.reorder_point,0))`);
  low.forEach(m => m.products = all(`SELECT DISTINCT p.name_ar FROM product_recipes pr JOIN products p ON p.id=pr.product_id WHERE pr.material_id=? LIMIT 10`, m.id).map(x => x.name_ar));
  res.json({ low, count: low.length });
});

app.get('/api/products/:id', auth, (req, res) => {
  const p = get('SELECT * FROM products WHERE id=?', req.params.id);
  if (!p) return res.status(404).json({ error: 'غير موجود' });
  p.recipe = all(`SELECT pr.id,pr.material_id,pr.qty,m.name_ar,m.avg_cost,m.qty stock,m.reorder_point,
    un.symbol unit, w.name_ar warehouse FROM product_recipes pr JOIN raw_materials m ON m.id=pr.material_id
    LEFT JOIN units un ON un.id=m.unit_id LEFT JOIN warehouses w ON w.id=m.warehouse_id WHERE pr.product_id=?`, req.params.id);
  res.json(p);
});

app.post('/api/products', auth, admin, (req, res) => {
  const b = req.body || {};
  if (!b.name_ar) return res.status(400).json({ error: 'اسم الصنف مطلوب' });
  if (b.barcode && get('SELECT 1 v FROM products WHERE barcode=?', b.barcode)) return res.status(400).json({ error: 'الباركود مستخدم لصنف آخر' });
  const id = run('INSERT INTO products(name_ar,category_id,price,image,track_stock,station,sort_order,created_at,sku,barcode,is_new,is_featured,show_online) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    b.name_ar, b.category_id || null, +b.price || 0, b.image || '🍽️', b.track_stock ?? 1, b.station === 'kitchen' ? 'kitchen' : 'bar', +b.sort_order || 0, nowISO(),
    b.sku || null, b.barcode || null, b.is_new ? 1 : 0, b.is_featured ? 1 : 0, b.show_online ?? 1).lastInsertRowid;
  // توليد تلقائي إن تُرك فارغاً (كما في الأنظمة التجارية)
  run('UPDATE products SET sku=COALESCE(sku,?), barcode=COALESCE(barcode,?) WHERE id=?',
    'PRD-' + String(id).padStart(6, '0'), String(2000000000000 + id), id);
  res.json({ id });
});
app.put('/api/products/:id', auth, admin, (req, res) => {
  const b = req.body || {}; const a = get('SELECT * FROM products WHERE id=?', req.params.id);
  if (!a) return res.status(404).json({ error: 'غير موجود' });
  if (b.barcode && get('SELECT 1 v FROM products WHERE barcode=? AND id<>?', b.barcode, a.id)) return res.status(400).json({ error: 'الباركود مستخدم لصنف آخر' });
  run('UPDATE products SET name_ar=?,category_id=?,price=?,image=?,track_stock=?,station=?,is_active=?,sort_order=?,sku=?,barcode=?,is_new=?,is_featured=?,show_online=? WHERE id=?',
    b.name_ar ?? a.name_ar, b.category_id ?? a.category_id, b.price ?? a.price, b.image ?? a.image,
    b.track_stock ?? a.track_stock, b.station ?? a.station, b.is_active ?? a.is_active, b.sort_order ?? a.sort_order,
    b.sku ?? a.sku, b.barcode ?? a.barcode, b.is_new ?? a.is_new, b.is_featured ?? a.is_featured, b.show_online ?? a.show_online, a.id);
  res.json({ ok: true });
});
// ---------- رفع صورة منتج (data URL → ملف في public/uploads/products) ----------
const PRODUCT_IMG_DIR = join(__dirname, 'public', 'uploads', 'products');
const PROD_IMG_EXTS = ['png', 'jpg', 'jpeg', 'webp'];
app.post('/api/products/:id/image', auth, admin, (req, res) => {
  const p = get('SELECT id FROM products WHERE id=?', req.params.id);
  if (!p) return res.status(404).json({ error: 'الصنف غير موجود' });
  const mm = (req.body?.data || '').match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
  if (!mm) return res.status(400).json({ error: 'ارفع صورة PNG أو JPG أو WEBP' });
  const buf = Buffer.from(mm[2], 'base64');
  if (buf.length > 3 * 1024 * 1024) return res.status(400).json({ error: 'الحد الأقصى لحجم الصورة 3MB' });
  if (!existsSync(PRODUCT_IMG_DIR)) mkdirSync(PRODUCT_IMG_DIR, { recursive: true });
  const ext = mm[1] === 'jpeg' ? 'jpg' : mm[1];
  PROD_IMG_EXTS.forEach(e => { try { rmSync(join(PRODUCT_IMG_DIR, `p${p.id}.${e}`)); } catch {} });   // امسح القديم
  writeFileSync(join(PRODUCT_IMG_DIR, `p${p.id}.${ext}`), buf);
  const path = `/uploads/products/p${p.id}.${ext}?v=${Date.now().toString(36)}`;
  run('UPDATE products SET image=? WHERE id=?', path, p.id);
  logAudit(req.user.id, 'product', p.id, 'image_upload');
  res.json({ image: path });
});
app.delete('/api/products/:id/image', auth, admin, (req, res) => {
  const p = get('SELECT id FROM products WHERE id=?', req.params.id);
  if (!p) return res.status(404).json({ error: 'الصنف غير موجود' });
  PROD_IMG_EXTS.forEach(e => { try { rmSync(join(PRODUCT_IMG_DIR, `p${p.id}.${e}`)); } catch {} });
  run("UPDATE products SET image='🍽️' WHERE id=?", p.id);
  res.json({ ok: true });
});

app.delete('/api/products/:id', auth, admin, (req, res) => {
  PROD_IMG_EXTS.forEach(e => { try { rmSync(join(PRODUCT_IMG_DIR, `p${req.params.id}.${e}`)); } catch {} });  // امسح صورته
  tx(() => {
    // فك ربط سجل المبيعات القديم (الاسم محفوظ نسخة في order_items فالتقارير لا تتأثر) وإلا رفضت القاعدة الحذف
    run('UPDATE order_items SET product_id=NULL WHERE product_id=?', req.params.id);
    run('DELETE FROM product_recipes WHERE product_id=?', req.params.id);
    run('DELETE FROM products WHERE id=?', req.params.id);
  });
  logAudit(req.user.id, 'product', +req.params.id, 'delete');
  res.json({ ok: true });
});

// تصدير الأصناف مع مكونات كل صنف (للتحميل Excel)
app.get('/api/products-export', auth, admin, (_q, res) => {
  const prods = all(`SELECT p.id,p.name_ar,p.price,p.cost,p.station,p.is_active,p.track_stock,c.name_ar category
    FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.sort_order,p.id`);
  prods.forEach(p => p.recipe = all(`SELECT m.name_ar, pr.qty, un.symbol unit FROM product_recipes pr
    JOIN raw_materials m ON m.id=pr.material_id LEFT JOIN units un ON un.id=m.unit_id WHERE pr.product_id=?`, p.id));
  res.json(prods);
});

// حفظ الوصفة كاملة وتحديث التكلفة
app.put('/api/products/:id/recipe', auth, admin, (req, res) => {
  const pid = +req.params.id;
  if (!get('SELECT 1 v FROM products WHERE id=?', pid)) return res.status(404).json({ error: 'غير موجود' });
  const lines = (req.body?.recipe || []).filter(l => l.material_id && +l.qty > 0);
  tx(() => {
    run('DELETE FROM product_recipes WHERE product_id=?', pid);
    lines.forEach(l => run('INSERT INTO product_recipes(product_id,material_id,qty) VALUES(?,?,?)', pid, l.material_id, +l.qty));
    recomputeProductCost(pid);
  });
  res.json({ cost: get('SELECT cost FROM products WHERE id=?', pid).cost });
});

// ===================================================================
//  المواد الخام
// ===================================================================
app.get('/api/materials', auth, (_q, res) => res.json(all(`SELECT m.*, un.symbol unit, un.name_ar unit_name, w.name_ar warehouse,
  pu.symbol purchase_unit, pu.name_ar purchase_unit_name,
  (m.qty<=m.reorder_point) AS low FROM raw_materials m LEFT JOIN units un ON un.id=m.unit_id
  LEFT JOIN units pu ON pu.id=m.purchase_unit_id LEFT JOIN warehouses w ON w.id=m.warehouse_id ORDER BY m.name_ar`)));

app.post('/api/materials', auth, admin, (req, res) => {
  const b = req.body || {};
  if (!b.name_ar) return res.status(400).json({ error: 'اسم المادة مطلوب' });
  const id = run('INSERT INTO raw_materials(code,name_ar,unit_id,warehouse_id,qty,avg_cost,reorder_point,purchase_unit_id,purchase_factor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    b.code || null, b.name_ar, b.unit_id || null, b.warehouse_id || null, +b.qty || 0, +b.avg_cost || 0, +b.reorder_point || 0,
    b.purchase_unit_id || b.unit_id || null, +b.purchase_factor || 1, nowISO()).lastInsertRowid;
  res.json({ id });
});
app.put('/api/materials/:id', auth, admin, (req, res) => {
  const b = req.body || {}; const a = get('SELECT * FROM raw_materials WHERE id=?', req.params.id);
  if (!a) return res.status(404).json({ error: 'غير موجود' });
  run('UPDATE raw_materials SET code=?,name_ar=?,unit_id=?,warehouse_id=?,reorder_point=?,purchase_unit_id=?,purchase_factor=?,is_active=? WHERE id=?',
    b.code ?? a.code, b.name_ar ?? a.name_ar, b.unit_id ?? a.unit_id, b.warehouse_id ?? a.warehouse_id,
    b.reorder_point ?? a.reorder_point, b.purchase_unit_id ?? a.purchase_unit_id, +b.purchase_factor || a.purchase_factor || 1, b.is_active ?? a.is_active, a.id);
  // تعديل الرصيد يدوياً (تسوية)
  if (b.qty !== undefined && +b.qty !== a.qty) {
    const diff = +(+b.qty - a.qty).toFixed(4);
    run('UPDATE raw_materials SET qty=? WHERE id=?', +b.qty, a.id);
    run(`INSERT INTO inventory_transactions(material_id,warehouse_id,type,qty,unit_cost,balance,ref_type,note,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`, a.id, a.warehouse_id, 'adjust', diff, a.avg_cost, +b.qty, 'adjust', 'تسوية يدوية', nowISO());
  }
  if (b.avg_cost !== undefined && +b.avg_cost !== a.avg_cost) {
    run('UPDATE raw_materials SET avg_cost=? WHERE id=?', +b.avg_cost, a.id);
    recomputeProductsUsing(a.id);
  }
  res.json({ ok: true });
});

// ===================================================================
//  المشتريات (Moving Average Cost)
// ===================================================================
app.get('/api/purchases', auth, admin, (_q, res) => res.json(all(`SELECT pu.*, s.name_ar supplier, w.name_ar warehouse,
  ROUND(pu.total-pu.paid_amount,2) remaining, pm.name_ar method_name,
  (SELECT COUNT(*) FROM purchase_items WHERE purchase_id=pu.id) lines FROM purchases pu
  LEFT JOIN suppliers s ON s.id=pu.supplier_id LEFT JOIN warehouses w ON w.id=pu.warehouse_id
  LEFT JOIN payment_methods pm ON pm.id=pu.payment_method_id ORDER BY pu.id DESC LIMIT 100`)));

// كشف حساب مورد: فواتيره + دفعاته + الرصيد المستحق
app.get('/api/suppliers/:id/statement', auth, admin, (req, res) => {
  const s = get('SELECT * FROM suppliers WHERE id=?', req.params.id);
  if (!s) return res.status(404).json({ error: 'غير موجود' });
  const invoices = all(`SELECT pu.id,pu.ref,pu.total,pu.paid_amount,ROUND(pu.total-pu.paid_amount,2) remaining,pu.payment_status,pu.created_at
    FROM purchases pu WHERE pu.supplier_id=? ORDER BY pu.id DESC`, req.params.id);
  const payments = all(`SELECT ip.*, pm.name_ar method_name FROM invoice_payments ip
    JOIN purchases pu ON pu.id=ip.invoice_id AND ip.kind='purchase'
    LEFT JOIN payment_methods pm ON pm.id=ip.method_id WHERE pu.supplier_id=? ORDER BY ip.id DESC`, req.params.id);
  res.json({ supplier: s, invoices, payments,
    totalDue: +invoices.reduce((x, r) => x + r.remaining, 0).toFixed(2),
    totalInvoices: +invoices.reduce((x, r) => x + r.total, 0).toFixed(2) });
});

app.get('/api/purchases/:id', auth, admin, (req, res) => {
  const pu = get(`SELECT pu.*, s.name_ar supplier, w.name_ar warehouse FROM purchases pu
    LEFT JOIN suppliers s ON s.id=pu.supplier_id LEFT JOIN warehouses w ON w.id=pu.warehouse_id WHERE pu.id=?`, req.params.id);
  if (!pu) return res.status(404).json({ error: 'غير موجود' });
  pu.items = all(`SELECT pi.*, m.name_ar, un.symbol unit FROM purchase_items pi JOIN raw_materials m ON m.id=pi.material_id
    LEFT JOIN units un ON un.id=m.unit_id WHERE pi.purchase_id=?`, req.params.id);
  res.json(pu);
});

app.post('/api/purchases', auth, admin, (req, res) => {
  const b = req.body || {};
  const items = (b.items || []).filter(i => i.material_id && +i.qty > 0);
  if (!items.length) return res.status(400).json({ error: 'أضف بنداً واحداً على الأقل' });
  const tax = +b.tax || 0;
  // إجمالي الفاتورة بقيمة ما أدخله المستخدم (بوحدة الشراء أو الصغرى)
  const subtotal = items.reduce((s, i) => s + (+i.qty) * (+i.unit_cost), 0);
  const t = nowISO();
  const total = +(subtotal + tax).toFixed(2);
  // السداد: كامل (افتراضي) أو جزئي أو آجل
  const paidAmount = b.paid_amount !== undefined ? Math.min(+b.paid_amount || 0, total) : total;
  const payStatus = paidAmount >= total ? 'paid' : (paidAmount > 0 ? 'partial' : 'credit');
  const shift = openShiftOf(req.user.id);
  const out = tx(() => {
    const pid = run(`INSERT INTO purchases(ref,supplier_id,warehouse_id,subtotal,tax,total,notes,created_by,created_at,paid_amount,payment_status,payment_method_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, b.ref || null, b.supplier_id || null, b.warehouse_id || null,
      +subtotal.toFixed(2), tax, total, b.notes || null, req.user.id, t,
      paidAmount, payStatus, b.payment_method_id || null).lastInsertRowid;
    if (paidAmount > 0 && b.payment_method_id) moneyMove({ method_id: b.payment_method_id, amount: -paidAmount,
      ref_type: 'purchase', ref_id: pid, note: 'سداد فاتورة شراء' + (b.ref ? ' ' + b.ref : ''), user_id: req.user.id, shift_id: shift?.id || null });
    for (const i of items) {
      const mat = get('SELECT qty,avg_cost,warehouse_id,purchase_factor FROM raw_materials WHERE id=?', i.material_id);
      // التحويل: لو الإدخال بوحدة الشراء → اضرب في المعامل (qty) واقسم التكلفة عليه
      const inPurchase = i.unit === 'purchase';
      const factor = inPurchase ? (+mat.purchase_factor || 1) : 1;
      const recvQty = +(+i.qty * factor).toFixed(4);              // الكمية بالوحدة الصغرى
      const unitCost = +(+i.unit_cost / factor).toFixed(6);       // تكلفة الوحدة الصغرى
      const newQty = +(mat.qty + recvQty).toFixed(4);
      // متوسط التكلفة المتحرك
      const newAvg = newQty > 0 ? +(((mat.qty * mat.avg_cost) + (recvQty * unitCost)) / newQty).toFixed(4) : unitCost;
      run('UPDATE raw_materials SET qty=?, avg_cost=? WHERE id=?', newQty, newAvg, i.material_id);
      run('INSERT INTO purchase_items(purchase_id,material_id,qty,unit_cost) VALUES(?,?,?,?)', pid, i.material_id, recvQty, unitCost);
      run(`INSERT INTO inventory_transactions(material_id,warehouse_id,type,qty,unit_cost,balance,ref_type,ref_id,note,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`, i.material_id, b.warehouse_id || mat.warehouse_id, 'purchase', recvQty, unitCost, newQty, 'purchase', pid, b.ref || 'فاتورة شراء', t);
      recomputeProductsUsing(i.material_id);
    }
    return pid;
  });
  logAudit(req.user.id, 'purchase', out, 'create');
  res.json({ id: out });
});

// سداد المتبقي من فاتورة شراء آجلة/جزئية
app.post('/api/purchases/:id/settle', auth, admin, (req, res) => {
  const pu = get('SELECT * FROM purchases WHERE id=?', req.params.id);
  if (!pu) return res.status(404).json({ error: 'غير موجود' });
  const remaining = +(pu.total - pu.paid_amount).toFixed(2);
  if (remaining <= 0) return res.status(400).json({ error: 'الفاتورة مسددة بالكامل' });
  const b = req.body || {};
  const amount = Math.min(+b.amount || 0, remaining);
  if (!(amount > 0)) return res.status(400).json({ error: 'أدخل مبلغاً صحيحاً' });
  if (!b.method_id) return res.status(400).json({ error: 'اختر طريقة الدفع' });
  const shift = openShiftOf(req.user.id);
  const newPaid = +(pu.paid_amount + amount).toFixed(2);
  tx(() => {
    run('INSERT INTO invoice_payments(kind,invoice_id,amount,method_id,note,shift_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',
      'purchase', pu.id, amount, b.method_id, b.note || null, shift?.id || null, req.user.id, nowISO());
    run('UPDATE purchases SET paid_amount=?, payment_status=?, payment_method_id=COALESCE(payment_method_id,?) WHERE id=?',
      newPaid, newPaid >= pu.total ? 'paid' : 'partial', b.method_id, pu.id);
    moneyMove({ method_id: b.method_id, amount: -amount, ref_type: 'invoice_payment', ref_id: pu.id,
      note: `سداد مشتريات ${pu.ref || '#' + pu.id}`, user_id: req.user.id, shift_id: shift?.id || null });
  });
  logAudit(req.user.id, 'purchase', pu.id, 'settle', { amount });
  res.json({ ok: true });
});

// ===================================================================
//  المخزون: المستويات والحركة والتنبيهات
// ===================================================================
app.get('/api/inventory', auth, (req, res) => {
  const wh = req.query.warehouse;
  const rows = all(`SELECT m.id,m.code,m.name_ar,m.qty,m.avg_cost,m.reorder_point,un.symbol unit,w.name_ar warehouse,w.id warehouse_id,
    (m.qty*m.avg_cost) value, (m.qty<=m.reorder_point) low FROM raw_materials m
    LEFT JOIN units un ON un.id=m.unit_id LEFT JOIN warehouses w ON w.id=m.warehouse_id
    WHERE m.is_active=1 ${wh ? 'AND m.warehouse_id=' + (+wh) : ''} ORDER BY low DESC, m.name_ar`);
  res.json({ rows, totalValue: rows.reduce((s, r) => s + (r.value || 0), 0), lowCount: rows.filter(r => r.low).length });
});
app.get('/api/inventory/transactions', auth, (req, res) => {
  const f = [], p = [];
  if (req.query.material) { f.push(' AND it.material_id=?'); p.push(req.query.material); }
  if (req.query.type) { f.push(' AND it.type=?'); p.push(req.query.type); }
  res.json(all(`SELECT it.*, m.name_ar material, un.symbol unit, w.name_ar warehouse FROM inventory_transactions it
    JOIN raw_materials m ON m.id=it.material_id LEFT JOIN units un ON un.id=m.unit_id LEFT JOIN warehouses w ON w.id=it.warehouse_id
    WHERE 1=1 ${f.join('')} ORDER BY it.id DESC LIMIT 200`, ...p));
});

// ===================================================================
//  التوالف والهدر
// ===================================================================
app.get('/api/waste', auth, admin, (_q, res) => res.json(all(`SELECT wl.*, m.name_ar material, un.symbol unit, w.name_ar warehouse, u.full_name by_name
  FROM waste_log wl JOIN raw_materials m ON m.id=wl.material_id LEFT JOIN units un ON un.id=m.unit_id
  LEFT JOIN warehouses w ON w.id=wl.warehouse_id LEFT JOIN users u ON u.id=wl.created_by ORDER BY wl.id DESC LIMIT 100`)));

app.post('/api/waste', auth, admin, (req, res) => {
  const b = req.body || {};
  const mat = get('SELECT * FROM raw_materials WHERE id=?', b.material_id);
  if (!mat) return res.status(400).json({ error: 'مادة غير موجودة' });
  const qty = +b.qty; if (!(qty > 0)) return res.status(400).json({ error: 'الكمية غير صحيحة' });
  const cost = +(qty * mat.avg_cost).toFixed(3);
  const t = nowISO();
  tx(() => {
    const bal = +(mat.qty - qty).toFixed(4);
    run('UPDATE raw_materials SET qty=? WHERE id=?', bal, mat.id);
    run('INSERT INTO waste_log(material_id,warehouse_id,qty,cost,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?)',
      mat.id, mat.warehouse_id, qty, cost, b.reason || 'غير محدد', req.user.id, t);
    run(`INSERT INTO inventory_transactions(material_id,warehouse_id,type,qty,unit_cost,balance,ref_type,note,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`, mat.id, mat.warehouse_id, 'waste', -qty, mat.avg_cost, bal, 'waste', 'تالف: ' + (b.reason || ''), t);
  });
  res.json({ ok: true, cost });
});

// ===================================================================
//  الجرد الفعلي (Variance)
// ===================================================================
app.get('/api/stock-counts', auth, admin, (_q, res) => res.json(all(`SELECT sc.*, w.name_ar warehouse, u.full_name by_name,
  (SELECT COUNT(*) FROM stock_count_items WHERE count_id=sc.id) lines FROM stock_counts sc
  LEFT JOIN warehouses w ON w.id=sc.warehouse_id LEFT JOIN users u ON u.id=sc.created_by ORDER BY sc.id DESC`)));

app.post('/api/stock-counts', auth, admin, (req, res) => {
  const wh = req.body?.warehouse_id || null;
  const t = nowISO();
  const id = tx(() => {
    const cid = run('INSERT INTO stock_counts(warehouse_id,status,note,created_by,created_at) VALUES(?,?,?,?,?)',
      wh, 'open', req.body?.note || null, req.user.id, t).lastInsertRowid;
    const mats = all(`SELECT id,qty,avg_cost FROM raw_materials WHERE is_active=1 ${wh ? 'AND warehouse_id=' + (+wh) : ''}`);
    mats.forEach(m => run('INSERT INTO stock_count_items(count_id,material_id,book_qty,actual_qty,unit_cost) VALUES(?,?,?,?,?)',
      cid, m.id, m.qty, null, m.avg_cost));
    return cid;
  });
  res.json({ id });
});

app.get('/api/stock-counts/:id', auth, admin, (req, res) => {
  const sc = get(`SELECT sc.*, w.name_ar warehouse FROM stock_counts sc LEFT JOIN warehouses w ON w.id=sc.warehouse_id WHERE sc.id=?`, req.params.id);
  if (!sc) return res.status(404).json({ error: 'غير موجود' });
  sc.items = all(`SELECT ci.*, m.name_ar, un.symbol unit FROM stock_count_items ci JOIN raw_materials m ON m.id=ci.material_id
    LEFT JOIN units un ON un.id=m.unit_id WHERE ci.count_id=? ORDER BY m.name_ar`, req.params.id);
  res.json(sc);
});

// حفظ الكميات الفعلية
app.put('/api/stock-counts/:id', auth, admin, (req, res) => {
  const sc = get('SELECT * FROM stock_counts WHERE id=?', req.params.id);
  if (!sc || sc.status !== 'open') return res.status(400).json({ error: 'الجرد مغلق أو غير موجود' });
  (req.body?.items || []).forEach(i => {
    if (i.id !== undefined) run('UPDATE stock_count_items SET actual_qty=? WHERE id=? AND count_id=?',
      i.actual_qty === '' || i.actual_qty === null ? null : +i.actual_qty, i.id, sc.id);
  });
  res.json({ ok: true });
});

// إغلاق الجرد → تطبيق الفروقات كتسويات
app.post('/api/stock-counts/:id/close', auth, admin, (req, res) => {
  const sc = get('SELECT * FROM stock_counts WHERE id=?', req.params.id);
  if (!sc || sc.status !== 'open') return res.status(400).json({ error: 'الجرد مغلق أو غير موجود' });
  const items = all('SELECT * FROM stock_count_items WHERE count_id=? AND actual_qty IS NOT NULL', sc.id);
  const t = nowISO();
  tx(() => {
    items.forEach(i => {
      const diff = +(i.actual_qty - i.book_qty).toFixed(4);
      if (diff !== 0) {
        run('UPDATE raw_materials SET qty=? WHERE id=?', i.actual_qty, i.material_id);
        run(`INSERT INTO inventory_transactions(material_id,warehouse_id,type,qty,unit_cost,balance,ref_type,ref_id,note,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?)`, i.material_id, sc.warehouse_id, 'count', diff, i.unit_cost, i.actual_qty, 'count', sc.id,
          'تسوية جرد ' + (diff > 0 ? 'فائض' : 'عجز'), t);
      }
    });
    run("UPDATE stock_counts SET status='closed', closed_at=? WHERE id=?", t, sc.id);
  });
  res.json({ ok: true });
});

// ===================================================================
//  التقارير والحوكمة
// ===================================================================
app.get('/api/reports/sales', auth, admin, (req, res) => {
  const from = req.query.from || '0000', to = (req.query.to || '9999') + '￿';
  const summary = get(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) sales, COALESCE(SUM(cost_total),0) cost,
    COALESCE(SUM(tax),0) tax, COALESCE(SUM(discount),0) discount, COALESCE(SUM(tip),0) tip_delivery,
    COALESCE(SUM(paid_amount),0) collected, COALESCE(SUM(total-paid_amount),0) due,
    COALESCE(SUM(total-tax-cost_total-tip),0) profit
    FROM orders WHERE status='paid' AND created_at>=? AND created_at<=?`, from, to);
  const byDay = all(`SELECT substr(created_at,1,10) d, COALESCE(SUM(total),0) sales, COALESCE(SUM(cost_total),0) cost,
    COALESCE(SUM(total-tax-cost_total-tip),0) profit, COUNT(*) orders
    FROM orders WHERE status='paid' AND created_at>=? AND created_at<=? GROUP BY d ORDER BY d`, from, to);
  const byProduct = all(`SELECT oi.name_ar, SUM(oi.qty) qty, SUM(oi.qty*oi.price) sales, SUM(oi.qty*oi.cost) cost,
    SUM(oi.qty*(oi.price-oi.cost)) margin FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE o.status='paid' AND o.created_at>=? AND o.created_at<=? GROUP BY oi.name_ar ORDER BY sales DESC`, from, to);
  // نوع الطلب مع تفاصيل مالية كاملة (تكلفة/ربح/توصيل)
  const byType = all(`SELECT order_type, COUNT(*) cnt, COALESCE(SUM(total),0) total,
    COALESCE(SUM(cost_total),0) cost, COALESCE(SUM(tip),0) tip_delivery,
    COALESCE(SUM(total-tax-cost_total-tip),0) profit FROM orders
    WHERE status='paid' AND created_at>=? AND created_at<=? GROUP BY order_type`, from, to);
  // مصدر الطلب (POS/QR طاولة/دليفري أونلاين)
  const bySource = all(`SELECT source, order_type, COUNT(*) cnt, COALESCE(SUM(total),0) total
    FROM orders WHERE status='paid' AND created_at>=? AND created_at<=? GROUP BY source,order_type ORDER BY total DESC`, from, to);
  // ملخص الكاشير: مبيعات كل واحد
  const byCashier = all(`SELECT u.full_name, COUNT(*) cnt, COALESCE(SUM(o.total),0) total, COALESCE(SUM(o.paid_amount),0) collected
    FROM orders o LEFT JOIN users u ON u.id=o.cashier_id WHERE o.status='paid' AND o.created_at>=? AND o.created_at<=?
    GROUP BY o.cashier_id ORDER BY total DESC`, from, to);
  res.json({ summary, byDay, byProduct, byType, bySource, byCashier });
});

// ---------- تقارير مالية جديدة ----------
// حركة الخزينة الشاملة (كل الطرق أو طريقة محددة)
app.get('/api/reports/treasury', auth, admin, (req, res) => {
  const from = req.query.from || '0000', to = (req.query.to || '9999') + '￿';
  const f = [], p = [from, to];
  if (req.query.method) { f.push(' AND mm.method_id=?'); p.push(req.query.method); }
  const rows = all(`SELECT mm.created_at, pm.name_ar method, mm.ref_type, mm.amount, mm.note, u.full_name by_name
    FROM money_movements mm JOIN payment_methods pm ON pm.id=mm.method_id LEFT JOIN users u ON u.id=mm.created_by
    WHERE mm.created_at>=? AND mm.created_at<=? ${f.join('')} ORDER BY mm.id DESC`, ...p);
  const inflow = rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const outflow = rows.filter(r => r.amount < 0).reduce((s, r) => s + Math.abs(r.amount), 0);
  const byType = all(`SELECT ref_type, COUNT(*) cnt, COALESCE(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END),0) inflow,
    COALESCE(SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END),0) outflow FROM money_movements mm
    WHERE created_at>=? AND created_at<=? ${req.query.method ? 'AND method_id=' + (+req.query.method) : ''} GROUP BY ref_type ORDER BY inflow+outflow DESC`, from, to);
  res.json({ rows, inflow, outflow, net: +(inflow - outflow).toFixed(2), byType });
});

// سندات القبض والصرف (تقرير)
app.get('/api/reports/vouchers', auth, admin, (req, res) => {
  const from = req.query.from || '0000', to = (req.query.to || '9999') + '￿';
  const rows = all(`SELECT v.voucher_no, v.kind, v.party_name, v.amount, pm.name_ar method, v.note, v.status, v.created_at, u.full_name by_name
    FROM vouchers v LEFT JOIN payment_methods pm ON pm.id=v.method_id LEFT JOIN users u ON u.id=v.created_by
    WHERE v.created_at>=? AND v.created_at<=? ORDER BY v.id DESC`, from, to);
  const receipts = rows.filter(r => r.kind === 'receipt' && r.status === 'done').reduce((s, r) => s + r.amount, 0);
  const payments = rows.filter(r => r.kind === 'payment' && r.status === 'done').reduce((s, r) => s + r.amount, 0);
  res.json({ rows, receipts, payments, net: +(receipts - payments).toFixed(2) });
});

// الفواتير الآجلة والجزئية والمستحقات
app.get('/api/reports/due', auth, admin, (req, res) => {
  const from = req.query.from || '0000', to = (req.query.to || '9999') + '￿';
  const rows = all(`SELECT o.invoice_no, o.total, o.paid_amount, ROUND(o.total-o.paid_amount,2) remaining,
    o.payment_status, o.created_at, c.name_ar customer, c.phone
    FROM orders o LEFT JOIN customers c ON c.id=o.customer_id
    WHERE o.status='paid' AND o.payment_status IN('partial','credit') AND o.total-o.paid_amount>0
    AND o.created_at>=? AND o.created_at<=? ORDER BY o.id DESC`, from, to);
  const totalDue = rows.reduce((s, r) => s + r.remaining, 0);
  const byCustomer = all(`SELECT c.name_ar, c.phone, COUNT(*) invoices, COALESCE(SUM(o.total-o.paid_amount),0) remaining
    FROM orders o JOIN customers c ON c.id=o.customer_id
    WHERE o.status='paid' AND o.payment_status IN('partial','credit') AND o.total-o.paid_amount>0
    AND o.created_at>=? AND o.created_at<=? GROUP BY c.id ORDER BY remaining DESC`, from, to);
  res.json({ rows, totalDue: +totalDue.toFixed(2), byCustomer });
});

// الورديات (تقرير Z شامل لكل الفترة)
app.get('/api/reports/shifts', auth, admin, (req, res) => {
  const from = req.query.from || '0000', to = (req.query.to || '9999') + '￿';
  const rows = all(`SELECT s.*, u.full_name user_name FROM shifts s JOIN users u ON u.id=s.user_id
    WHERE s.opened_at>=? AND s.opened_at<=? ORDER BY s.id DESC`, from, to);
  const varTotal = rows.reduce((s, r) => s + (r.variance || 0), 0);
  const shortage = rows.filter(r => r.variance < 0).reduce((s, r) => s + Math.abs(r.variance), 0);
  const surplus = rows.filter(r => r.variance > 0).reduce((s, r) => s + r.variance, 0);
  res.json({ rows, shortage: +shortage.toFixed(2), surplus: +surplus.toFixed(2), variance: +varTotal.toFixed(2) });
});

// المرتجعات الشاملة (مبيعات + مشتريات)
app.get('/api/reports/returns', auth, admin, (req, res) => {
  const from = req.query.from || '0000', to = (req.query.to || '9999') + '￿';
  const sales = all(`SELECT sr.return_no, o.invoice_no orig, sr.total, sr.reason, sr.created_at, c.name_ar customer, u.full_name by_name
    FROM sales_returns sr LEFT JOIN orders o ON o.id=sr.order_id LEFT JOIN customers c ON c.id=sr.customer_id
    LEFT JOIN users u ON u.id=sr.created_by
    WHERE sr.created_at>=? AND sr.created_at<=? ORDER BY sr.id DESC`, from, to);
  const purchases = all(`SELECT pr.return_no, pu.ref orig, pr.total, pr.reason, pr.created_at, s.name_ar supplier, u.full_name by_name
    FROM purchase_returns pr LEFT JOIN purchases pu ON pu.id=pr.purchase_id LEFT JOIN suppliers s ON s.id=pr.supplier_id
    LEFT JOIN users u ON u.id=pr.created_by
    WHERE pr.created_at>=? AND pr.created_at<=? ORDER BY pr.id DESC`, from, to);
  res.json({ sales, purchases,
    salesTotal: +sales.reduce((s, r) => s + r.total, 0).toFixed(2),
    purchasesTotal: +purchases.reduce((s, r) => s + r.total, 0).toFixed(2) });
});

// المصروفات (تقرير)
app.get('/api/reports/expenses', auth, admin, (req, res) => {
  const from = req.query.from || '0000', to = (req.query.to || '9999') + '￿';
  const rows = all(`SELECT e.spent_at, e.amount, e.note, ec.name_ar category, ec.icon, pm.name_ar method, u.full_name by_name
    FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id
    LEFT JOIN payment_methods pm ON pm.id=e.method_id LEFT JOIN users u ON u.id=e.created_by
    WHERE COALESCE(e.spent_at,substr(e.created_at,1,10))>=? AND COALESCE(e.spent_at,substr(e.created_at,1,10))<=?
    ORDER BY e.id DESC`, from.slice(0, 10), to.slice(0, 10));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const byCategory = all(`SELECT ec.name_ar, ec.icon, COUNT(*) cnt, COALESCE(SUM(e.amount),0) total
    FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id
    WHERE COALESCE(e.spent_at,substr(e.created_at,1,10))>=? AND COALESCE(e.spent_at,substr(e.created_at,1,10))<=?
    GROUP BY ec.id ORDER BY total DESC`, from.slice(0, 10), to.slice(0, 10));
  res.json({ rows, total: +total.toFixed(2), byCategory });
});

// نقاط الولاء (تقرير)
app.get('/api/reports/points', auth, admin, (req, res) => {
  const from = req.query.from || '0000', to = (req.query.to || '9999') + '￿';
  const rows = all(`SELECT pl.*, c.name_ar customer, u.full_name by_name FROM points_log pl
    JOIN customers c ON c.id=pl.customer_id LEFT JOIN users u ON u.id=pl.created_by
    WHERE pl.created_at>=? AND pl.created_at<=? ORDER BY pl.id DESC`, from, to);
  const earned = rows.filter(r => r.kind === 'earn').reduce((s, r) => s + r.points, 0);
  const redeemed = rows.filter(r => r.kind === 'redeem').reduce((s, r) => s + Math.abs(r.points), 0);
  const manualAdd = rows.filter(r => r.kind === 'manual_add').reduce((s, r) => s + r.points, 0);
  const manualRem = rows.filter(r => r.kind === 'manual_remove').reduce((s, r) => s + Math.abs(r.points), 0);
  const activeCustomers = get(`SELECT COUNT(*) c FROM customers WHERE points>0`).c;
  const totalPoints = get(`SELECT COALESCE(SUM(points),0) t FROM customers`).t;
  res.json({ rows, earned, redeemed, manualAdd, manualRem, activeCustomers, totalPoints });
});

// اليومية المالية الموحّدة (Journal): كل الحركات المالية موحدة في تقرير واحد
app.get('/api/reports/journal', auth, admin, (req, res) => {
  const from = req.query.from || '0000', to = (req.query.to || '9999') + '￿';
  // موحد: مبيعات + سندات + مصروفات + مشتريات + سدادات + مرتجعات
  const items = [];
  all(`SELECT o.invoice_no ref, o.total amount, o.created_at, o.order_type, o.payment_status,
    pm.name_ar method, c.name_ar party, u.full_name by_name
    FROM orders o LEFT JOIN payment_methods pm ON pm.id=o.payment_method_id
    LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.cashier_id
    WHERE o.status='paid' AND o.created_at>=? AND o.created_at<=?`, from, to).forEach(r =>
    items.push({ type: 'sale', date: r.created_at, ref: r.invoice_no, amount: r.amount, method: r.method,
      party: r.party || '—', by_name: r.by_name, note: r.order_type }));
  all(`SELECT v.voucher_no ref, v.amount, v.kind, v.created_at, pm.name_ar method, v.party_name party, v.note, u.full_name by_name
    FROM vouchers v LEFT JOIN payment_methods pm ON pm.id=v.method_id LEFT JOIN users u ON u.id=v.created_by
    WHERE v.status='done' AND v.created_at>=? AND v.created_at<=?`, from, to).forEach(r =>
    items.push({ type: r.kind === 'receipt' ? 'voucher_in' : 'voucher_out', date: r.created_at, ref: r.ref,
      amount: r.kind === 'receipt' ? r.amount : -r.amount, method: r.method, party: r.party, by_name: r.by_name, note: r.note }));
  all(`SELECT e.amount, e.note, e.created_at, ec.name_ar category, pm.name_ar method, u.full_name by_name
    FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id
    LEFT JOIN payment_methods pm ON pm.id=e.method_id LEFT JOIN users u ON u.id=e.created_by
    WHERE e.created_at>=? AND e.created_at<=?`, from, to).forEach(r =>
    items.push({ type: 'expense', date: r.created_at, ref: r.category || '—', amount: -r.amount,
      method: r.method, party: r.category || '—', by_name: r.by_name, note: r.note }));
  all(`SELECT pu.ref, pu.total amount, pu.paid_amount, pu.created_at, pm.name_ar method, s.name_ar supplier, u.full_name by_name
    FROM purchases pu LEFT JOIN payment_methods pm ON pm.id=pu.payment_method_id
    LEFT JOIN suppliers s ON s.id=pu.supplier_id LEFT JOIN users u ON u.id=pu.created_by
    WHERE pu.paid_amount>0 AND pu.created_at>=? AND pu.created_at<=?`, from, to).forEach(r =>
    items.push({ type: 'purchase', date: r.created_at, ref: r.ref || '—', amount: -r.paid_amount,
      method: r.method, party: r.supplier || '—', by_name: r.by_name }));
  items.sort((a, b) => b.date.localeCompare(a.date));
  const inflow = items.filter(i => i.amount > 0).reduce((s, i) => s + i.amount, 0);
  const outflow = items.filter(i => i.amount < 0).reduce((s, i) => s + Math.abs(i.amount), 0);
  res.json({ items, inflow: +inflow.toFixed(2), outflow: +outflow.toFixed(2), net: +(inflow - outflow).toFixed(2) });
});

// تقرير العملاء (رصيد كل عميل + نقاطه + مشترياته)
app.get('/api/reports/customers', auth, admin, (_q, res) => {
  const rows = all(`SELECT c.name_ar, c.phone, c.points,
    (SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id AND o.status='paid') orders_count,
    (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.customer_id=c.id AND o.status='paid') total_sales,
    (SELECT COALESCE(SUM(o.total-o.paid_amount),0) FROM orders o WHERE o.customer_id=c.id AND o.status='paid') balance_due
    FROM customers c WHERE c.is_active=1 ORDER BY total_sales DESC`);
  res.json({ rows,
    totalCustomers: rows.length,
    totalSales: +rows.reduce((s, r) => s + r.total_sales, 0).toFixed(2),
    totalDue: +rows.reduce((s, r) => s + r.balance_due, 0).toFixed(2),
    totalPoints: +rows.reduce((s, r) => s + r.points, 0).toFixed(2) });
});

app.get('/api/reports/variance', auth, admin, (req, res) => {
  // الهدر: التوالف + قيمة فروقات الجرد (العجز)
  const from = req.query.from || '0000', to = (req.query.to || '9999') + '￿';
  const waste = all(`SELECT m.name_ar, SUM(wl.qty) qty, SUM(wl.cost) cost FROM waste_log wl JOIN raw_materials m ON m.id=wl.material_id
    WHERE wl.created_at>=? AND wl.created_at<=? GROUP BY m.id ORDER BY cost DESC`, from, to);
  const wasteTotal = waste.reduce((s, r) => s + r.cost, 0);
  const countVar = all(`SELECT m.name_ar, SUM(it.qty) qty, SUM(it.qty*it.unit_cost) value FROM inventory_transactions it
    JOIN raw_materials m ON m.id=it.material_id WHERE it.type='count' AND it.created_at>=? AND it.created_at<=?
    GROUP BY m.id HAVING SUM(it.qty)<>0 ORDER BY value`, from, to);
  const shortage = countVar.filter(r => r.value < 0).reduce((s, r) => s + Math.abs(r.value), 0);
  const surplus = countVar.filter(r => r.value > 0).reduce((s, r) => s + r.value, 0);
  const salesCost = get(`SELECT COALESCE(SUM(cost_total),0) c FROM orders WHERE status='paid' AND created_at>=? AND created_at<=?`, from, to).c;
  res.json({ waste, wasteTotal, countVar, shortage, surplus, salesCost,
    wastePct: salesCost ? (wasteTotal / salesCost) * 100 : 0 });
});

// أداء الموردين
app.get('/api/reports/suppliers', auth, admin, (_q, res) => res.json(all(`SELECT s.name_ar, COUNT(pu.id) invoices,
  COALESCE(SUM(pu.total),0) total, MAX(pu.created_at) last FROM suppliers s LEFT JOIN purchases pu ON pu.supplier_id=s.id
  GROUP BY s.id ORDER BY total DESC`)));

// ===================================================================
//  قائمة الدخل الشاملة (P&L) — مبيعات، تكلفة البضاعة، مصروفات، مخزون، ذمم
//  كل رقم بالفترة المحددة إلا "المخزون الحالي" و"الذمم" فهي لحظية (حتى الآن)
// ===================================================================
app.get('/api/reports/pnl', auth, admin, (req, res) => {
  const from = req.query.from || '0000', to = (req.query.to || '9999') + '￿';

  // ---------- الإيرادات ----------
  const salesAgg = get(`SELECT COUNT(*) orders, COALESCE(SUM(subtotal),0) gross,
    COALESCE(SUM(discount),0) discount, COALESCE(SUM(tax),0) tax, COALESCE(SUM(tip),0) other,
    COALESCE(SUM(total),0) grand, COALESCE(SUM(paid_amount),0) collected
    FROM orders WHERE status='paid' AND created_at>=? AND created_at<=?`, from, to);
  const salesReturnsAgg = get(`SELECT COUNT(*) cnt, COALESCE(SUM(total),0) total
    FROM sales_returns WHERE created_at>=? AND created_at<=?`, from, to);
  const netSales = +(salesAgg.gross - salesAgg.discount - salesReturnsAgg.total).toFixed(2);
  const totalRevenue = +(netSales + salesAgg.other).toFixed(2);

  // ---------- تكلفة البضاعة المباعة (COGS) ----------
  const ingredientsCost = get(`SELECT COALESCE(SUM(cost_total),0) c FROM orders
    WHERE status='paid' AND created_at>=? AND created_at<=?`, from, to).c;
  // عكس تكلفة المرتجعات المُعاد تخزينها (قلّلت من الاستهلاك الفعلي)
  const returnedCost = get(`SELECT COALESCE(SUM(sri.qty*sri.cost),0) c FROM sales_return_items sri
    JOIN sales_returns sr ON sr.id=sri.return_id WHERE sr.restock=1 AND sr.created_at>=? AND sr.created_at<=?`, from, to).c;
  const wasteCost = get(`SELECT COALESCE(SUM(cost),0) c FROM waste_log WHERE created_at>=? AND created_at<=?`, from, to).c;
  const countVar = get(`SELECT COALESCE(SUM(qty*unit_cost),0) v FROM inventory_transactions
    WHERE type='count' AND created_at>=? AND created_at<=?`, from, to).v;   // سالب=عجز (يزيد التكلفة)، موجب=فائض (يقلّلها)
  const countShortage = countVar < 0 ? +Math.abs(countVar).toFixed(2) : 0;
  const countSurplus = countVar > 0 ? +countVar.toFixed(2) : 0;
  const totalCogs = +(ingredientsCost - returnedCost + wasteCost + countShortage - countSurplus).toFixed(2);
  const grossProfit = +(totalRevenue - totalCogs).toFixed(2);

  // ---------- المصروفات التشغيلية ----------
  const opexByCat = all(`SELECT ec.name_ar, ec.icon, COALESCE(SUM(e.amount),0) total FROM expenses e
    LEFT JOIN expense_categories ec ON ec.id=e.category_id
    WHERE COALESCE(e.spent_at,substr(e.created_at,1,10))>=? AND COALESCE(e.spent_at,substr(e.created_at,1,10))<=?
    GROUP BY ec.id ORDER BY total DESC`, from.slice(0, 10), to.slice(0, 10));
  const opexTotal = +opexByCat.reduce((s, r) => s + r.total, 0).toFixed(2);
  const netProfit = +(grossProfit - opexTotal).toFixed(2);

  // ---------- المشتريات خلال الفترة (منفصلة عن COGS — شراء ≠ استهلاك) ----------
  const purchasesAgg = get(`SELECT COUNT(*) cnt, COALESCE(SUM(total),0) total, COALESCE(SUM(paid_amount),0) paid
    FROM purchases WHERE created_at>=? AND created_at<=?`, from, to);
  const purchaseReturnsAgg = get(`SELECT COUNT(*) cnt, COALESCE(SUM(total),0) total
    FROM purchase_returns WHERE created_at>=? AND created_at<=?`, from, to);

  // ---------- المخزون الحالي (لحظي — وليس تاريخي) ----------
  const inv = get(`SELECT COUNT(*) items, COALESCE(SUM(qty*avg_cost),0) value FROM raw_materials WHERE is_active=1`);
  const lowStock = get(`SELECT COUNT(*) c FROM raw_materials WHERE is_active=1 AND qty<=reorder_point`).c;

  // ---------- الذمم (لحظية: كل الفواتير المفتوحة، بلا قيد بالفترة) ----------
  const receivables = get(`SELECT COUNT(*) cnt, COALESCE(SUM(total-paid_amount),0) v FROM orders
    WHERE status='paid' AND payment_status IN('partial','credit') AND total>paid_amount`);
  const payables = get(`SELECT COUNT(*) cnt, COALESCE(SUM(total-paid_amount),0) v FROM purchases
    WHERE payment_status IN('partial','credit') AND total>paid_amount`);

  // ---------- نسب ومؤشرات ----------
  const pct = (a, b) => b ? +((a / b) * 100).toFixed(1) : 0;

  res.json({
    from, to,
    revenue: {
      grossSales: +salesAgg.gross.toFixed(2), discount: +salesAgg.discount.toFixed(2),
      salesReturns: salesReturnsAgg.total, otherRevenue: +salesAgg.other.toFixed(2),
      netSales, totalRevenue, taxCollected: +salesAgg.tax.toFixed(2),
      ordersCount: salesAgg.orders, avgOrderValue: salesAgg.orders ? +(salesAgg.grand / salesAgg.orders).toFixed(2) : 0,
    },
    cogs: {
      ingredientsCost: +ingredientsCost.toFixed(2), returnedCost: +returnedCost.toFixed(2),
      wasteCost: +wasteCost.toFixed(2), countShortage, countSurplus, total: totalCogs,
    },
    grossProfit, grossMarginPct: pct(grossProfit, totalRevenue),
    opex: { byCategory: opexByCat, total: opexTotal },
    netProfit, netMarginPct: pct(netProfit, totalRevenue),
    cogsPctOfSales: pct(totalCogs, netSales),          // "فود كوست" — أهم مؤشر لمطاعم/كافيهات
    wastePctOfCogs: pct(wasteCost, totalCogs),
    wastePctOfSales: pct(wasteCost, netSales),
    purchases: { count: purchasesAgg.cnt, total: +purchasesAgg.total.toFixed(2), paid: +purchasesAgg.paid.toFixed(2),
      due: +(purchasesAgg.total - purchasesAgg.paid).toFixed(2) },
    purchaseReturns: purchaseReturnsAgg,
    inventory: { value: +inv.value.toFixed(2), itemsCount: inv.items, lowStockCount: lowStock },
    receivables: { count: receivables.cnt, value: +receivables.v.toFixed(2) },
    payables: { count: payables.cnt, value: +payables.v.toFixed(2) },
  });
});

// المبيعات حسب الفئة
app.get('/api/reports/categories', auth, admin, (req, res) => {
  const from = req.query.from || '0000', to = (req.query.to || '9999') + '￿';
  res.json(all(`SELECT c.name_ar, c.icon, SUM(oi.qty) qty, COALESCE(SUM(oi.qty*oi.price),0) sales, COALESCE(SUM(oi.qty*oi.cost),0) cost
    FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id LEFT JOIN categories c ON c.id=p.category_id
    WHERE o.status='paid' AND o.created_at>=? AND o.created_at<=? GROUP BY c.id ORDER BY sales DESC`, from, to));
});

// المبيعات حسب طريقة الدفع
app.get('/api/reports/payments', auth, admin, (req, res) => {
  const from = req.query.from || '0000', to = (req.query.to || '9999') + '￿';
  res.json(all(`SELECT pm.name_ar, pm.icon, COUNT(*) cnt, COALESCE(SUM(o.total),0) total
    FROM orders o JOIN payment_methods pm ON pm.id=o.payment_method_id
    WHERE o.status='paid' AND o.created_at>=? AND o.created_at<=? GROUP BY pm.id ORDER BY total DESC`, from, to));
});

// الطلبات الملغاة
app.get('/api/reports/cancelled', auth, admin, (req, res) => {
  const from = req.query.from || '0000', to = (req.query.to || '9999') + '￿';
  res.json(all(`SELECT o.invoice_no, o.total, o.created_at, o.note, t.name_ar table_name, u.full_name by_name
    FROM orders o LEFT JOIN tables t ON t.id=o.table_id LEFT JOIN users u ON u.id=o.cashier_id
    WHERE o.status='cancelled' AND o.created_at>=? AND o.created_at<=? ORDER BY o.id DESC`, from, to));
});

// حركة المخزون (بفلاتر: مدة + مادة + نوع الحركة)
app.get('/api/reports/inventory-moves', auth, admin, (req, res) => {
  const from = req.query.from || '0000', to = (req.query.to || '9999') + '￿';
  const f = [], p = [];
  if (req.query.material) { f.push(' AND it.material_id=?'); p.push(req.query.material); }
  if (req.query.type) { f.push(' AND it.type=?'); p.push(req.query.type); }
  res.json(all(`SELECT it.created_at, m.name_ar material, it.type, it.qty, it.balance, it.unit_cost, un.symbol unit, it.note
    FROM inventory_transactions it JOIN raw_materials m ON m.id=it.material_id LEFT JOIN units un ON un.id=m.unit_id
    WHERE it.created_at>=? AND it.created_at<=? ${f.join('')} ORDER BY it.id DESC LIMIT 1000`, from, to, ...p));
});

// تفاصيل المشتريات (بفلاتر: مدة + مورّد + مادة)
app.get('/api/reports/purchases', auth, admin, (req, res) => {
  const from = req.query.from || '0000', to = (req.query.to || '9999') + '￿';
  const f = [], p = [];
  if (req.query.supplier) { f.push(' AND pu.supplier_id=?'); p.push(req.query.supplier); }
  if (req.query.material) { f.push(' AND pi.material_id=?'); p.push(req.query.material); }
  res.json(all(`SELECT pu.created_at, pu.ref, s.name_ar supplier, m.name_ar material, pi.qty, pi.unit_cost,
    (pi.qty*pi.unit_cost) total, un.symbol unit FROM purchase_items pi JOIN purchases pu ON pu.id=pi.purchase_id
    JOIN raw_materials m ON m.id=pi.material_id LEFT JOIN suppliers s ON s.id=pu.supplier_id LEFT JOIN units un ON un.id=m.unit_id
    WHERE pu.created_at>=? AND pu.created_at<=? ${f.join('')} ORDER BY pu.id DESC LIMIT 1000`, from, to, ...p));
});

// ===================================================================
//  العملاء
// ===================================================================
app.get('/api/customers', auth, (req, res) => {
  const q = (req.query.q || '').trim();
  const f = q ? ' AND (c.name_ar LIKE ? OR c.phone LIKE ?)' : '';
  const p = q ? ['%' + q + '%', '%' + q + '%'] : [];
  res.json(all(`SELECT c.*,
    (SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id AND o.status='paid') orders_count,
    (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.customer_id=c.id AND o.status='paid') total_sales,
    (SELECT COALESCE(SUM(o.total-o.paid_amount),0) FROM orders o WHERE o.customer_id=c.id AND o.status='paid') balance_due
    FROM customers c WHERE c.is_active=1 ${f} ORDER BY c.id DESC LIMIT 300`, ...p));
});
app.get('/api/customers/:id', auth, (req, res) => {
  const c = get('SELECT * FROM customers WHERE id=?', req.params.id);
  if (!c) return res.status(404).json({ error: 'غير موجود' });
  c.orders = all(`SELECT o.id,o.invoice_no,o.total,o.paid_amount,ROUND(o.total-o.paid_amount,2) remaining,o.payment_status,o.created_at
    FROM orders o WHERE o.customer_id=? AND o.status='paid' ORDER BY o.id DESC LIMIT 100`, c.id);
  c.points_log = all(`SELECT pl.*, u.full_name by_name FROM points_log pl LEFT JOIN users u ON u.id=pl.created_by
    WHERE pl.customer_id=? ORDER BY pl.id DESC LIMIT 100`, c.id);
  c.balance_due = +c.orders.reduce((s, o) => s + o.remaining, 0).toFixed(2);
  res.json(c);
});
app.post('/api/customers', auth, (req, res) => {
  const b = req.body || {};
  if (!b.name_ar) return res.status(400).json({ error: 'اسم العميل مطلوب' });
  if (b.phone && get('SELECT 1 v FROM customers WHERE phone=? AND is_active=1', b.phone))
    return res.status(400).json({ error: 'رقم الهاتف مسجل لعميل آخر' });
  const id = run('INSERT INTO customers(name_ar,phone,email,address,notes,created_at) VALUES(?,?,?,?,?,?)',
    b.name_ar, b.phone || null, b.email || null, b.address || null, b.notes || null, nowISO()).lastInsertRowid;
  res.json({ id });
});
app.put('/api/customers/:id', auth, admin, (req, res) => {
  const b = req.body || {}; const a = get('SELECT * FROM customers WHERE id=?', req.params.id);
  if (!a) return res.status(404).json({ error: 'غير موجود' });
  run('UPDATE customers SET name_ar=?,phone=?,email=?,address=?,notes=?,is_active=? WHERE id=?',
    b.name_ar ?? a.name_ar, b.phone ?? a.phone, b.email ?? a.email, b.address ?? a.address,
    b.notes ?? a.notes, b.is_active ?? a.is_active, a.id);
  res.json({ ok: true });
});
app.delete('/api/customers/:id', auth, admin, (req, res) => {
  run('UPDATE customers SET is_active=0 WHERE id=?', req.params.id);   // حذف ناعم — التاريخ محفوظ
  res.json({ ok: true });
});

// ===================================================================
//  الخزينة: أرصدة طرق الدفع + كشف حساب + تسوية
// ===================================================================
app.get('/api/treasury', auth, admin, (_q, res) => {
  const methods = all('SELECT * FROM payment_methods ORDER BY sort_order,id');
  methods.forEach(m => {
    const agg = get(`SELECT COALESCE(SUM(CASE WHEN amount>0 THEN amount END),0) inflow,
      COALESCE(SUM(CASE WHEN amount<0 THEN -amount END),0) outflow, COUNT(*) moves
      FROM money_movements WHERE method_id=?`, m.id);
    m.inflow = agg.inflow; m.outflow = agg.outflow; m.moves = agg.moves;
    m.balance = +((m.opening_balance || 0) + agg.inflow - agg.outflow).toFixed(2);
    m.last_move = get('SELECT note,amount,created_at FROM money_movements WHERE method_id=? ORDER BY id DESC LIMIT 1', m.id) || null;
  });
  res.json({ methods, total: +methods.filter(m => m.is_active).reduce((s, m) => s + m.balance, 0).toFixed(2) });
});
app.get('/api/treasury/:id/statement', auth, admin, (req, res) => {
  const m = get('SELECT * FROM payment_methods WHERE id=?', req.params.id);
  if (!m) return res.status(404).json({ error: 'غير موجود' });
  const from = req.query.from || '0000', to = (req.query.to || '9999') + '￿';
  // الرصيد قبل بداية المدة
  const before = get('SELECT COALESCE(SUM(amount),0) s FROM money_movements WHERE method_id=? AND created_at<?', m.id, from).s;
  let running = +((m.opening_balance || 0) + before).toFixed(2);
  const rows = all(`SELECT mm.*, u.full_name by_name FROM money_movements mm LEFT JOIN users u ON u.id=mm.created_by
    WHERE mm.method_id=? AND mm.created_at>=? AND mm.created_at<=? ORDER BY mm.id`, m.id, from, to);
  const opening = running;
  rows.forEach(r => { running = +(running + r.amount).toFixed(2); r.balance = running; });
  res.json({ method: m, opening, closing: running, rows: rows.reverse() });
});
app.post('/api/treasury/adjust', auth, admin, (req, res) => {
  const b = req.body || {};
  if (!b.method_id || !+b.amount) return res.status(400).json({ error: 'حدد الطريقة والمبلغ' });
  moneyMove({ method_id: b.method_id, amount: +b.amount, ref_type: 'adjust', note: b.note || 'تسوية يدوية',
    user_id: req.user.id, shift_id: openShiftOf(req.user.id)?.id || null });
  logAudit(req.user.id, 'treasury', +b.method_id, 'adjust', { amount: +b.amount });
  res.json({ balance: methodBalance(+b.method_id) });
});

// ===================================================================
//  سندات القبض والصرف
// ===================================================================
app.get('/api/vouchers', auth, admin, (req, res) => {
  const f = [], p = [];
  if (req.query.kind) { f.push(' AND v.kind=?'); p.push(req.query.kind); }
  if (req.query.q) { f.push(' AND (v.voucher_no LIKE ? OR v.party_name LIKE ?)'); p.push('%' + req.query.q + '%', '%' + req.query.q + '%'); }
  res.json(all(`SELECT v.*, pm.name_ar method_name, u.full_name by_name FROM vouchers v
    LEFT JOIN payment_methods pm ON pm.id=v.method_id LEFT JOIN users u ON u.id=v.created_by
    WHERE 1=1 ${f.join('')} ORDER BY v.id DESC LIMIT 200`, ...p));
});
app.post('/api/vouchers', auth, (req, res) => {
  const b = req.body || {};
  if (!['receipt', 'payment'].includes(b.kind)) return res.status(400).json({ error: 'نوع سند غير صالح' });
  if (!(+b.amount > 0)) return res.status(400).json({ error: 'أدخل المبلغ' });
  if (!b.method_id) return res.status(400).json({ error: 'اختر طريقة الدفع' });
  // اسم الطرف: نسخة نصية + مرجع اختياري (عميل/مورد/طرف عام)
  let partyName = (b.party_name || '').trim();
  if (!partyName && b.party_kind && b.party_id) {
    const tbl = { customer: 'customers', supplier: 'suppliers', party: 'parties' }[b.party_kind];
    partyName = tbl ? (get(`SELECT name_ar FROM ${tbl} WHERE id=?`, b.party_id)?.name_ar || '') : '';
  }
  if (!partyName) return res.status(400).json({ error: 'حدد الطرف (الاسم)' });
  const shift = openShiftOf(req.user.id);
  const no = genDocNo('vouchers', 'voucher_no', b.kind === 'receipt' ? 'RCP' : 'PAY');
  const id = tx(() => {
    const vid = run(`INSERT INTO vouchers(voucher_no,kind,party_kind,party_id,party_name,amount,method_id,note,status,shift_id,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,'done',?,?,?)`, no, b.kind, b.party_kind || 'other', b.party_id || null, partyName,
      +b.amount, b.method_id, b.note || null, shift?.id || null, req.user.id, nowISO()).lastInsertRowid;
    moneyMove({ method_id: b.method_id, amount: b.kind === 'receipt' ? +b.amount : -(+b.amount),
      ref_type: 'voucher', ref_id: vid, note: `${b.kind === 'receipt' ? 'سند قبض' : 'سند صرف'} ${no} — ${partyName}`,
      user_id: req.user.id, shift_id: shift?.id || null });
    return vid;
  });
  logAudit(req.user.id, 'voucher', id, 'create', { kind: b.kind, amount: +b.amount });
  res.json({ id, voucher_no: no });
});
app.post('/api/vouchers/:id/cancel', auth, admin, (req, res) => {
  const v = get('SELECT * FROM vouchers WHERE id=?', req.params.id);
  if (!v) return res.status(404).json({ error: 'غير موجود' });
  if (v.status === 'cancelled') return res.status(400).json({ error: 'السند ملغي بالفعل' });
  tx(() => {
    run("UPDATE vouchers SET status='cancelled' WHERE id=?", v.id);
    // عكس الحركة المالية
    moneyMove({ method_id: v.method_id, amount: v.kind === 'receipt' ? -v.amount : +v.amount,
      ref_type: 'voucher', ref_id: v.id, note: `إلغاء ${v.voucher_no}`, user_id: req.user.id,
      shift_id: openShiftOf(req.user.id)?.id || null });
  });
  logAudit(req.user.id, 'voucher', v.id, 'cancel');
  res.json({ ok: true });
});

// ===================================================================
//  الأطراف العامة (جهات غير العملاء/الموردين)
// ===================================================================
app.get('/api/parties', auth, admin, (req, res) => {
  const q = (req.query.q || '').trim();
  const f = q ? ' AND (p.name_ar LIKE ? OR p.phone LIKE ?)' : '';
  const pr = q ? ['%' + q + '%', '%' + q + '%'] : [];
  const rows = all(`SELECT p.* FROM parties p WHERE p.is_active=1 ${f} ORDER BY p.id DESC LIMIT 300`, ...pr);
  rows.forEach(p => {
    const agg = get(`SELECT COALESCE(SUM(CASE WHEN kind='receipt' AND status='done' THEN amount END),0) receipts,
      COALESCE(SUM(CASE WHEN kind='payment' AND status='done' THEN amount END),0) payments
      FROM vouchers WHERE party_kind='party' AND party_id=?`, p.id);
    p.receipts = agg.receipts; p.payments = agg.payments;
    p.balance = +(agg.receipts - agg.payments).toFixed(2);
  });
  res.json(rows);
});
app.post('/api/parties', auth, (req, res) => {
  const b = req.body || {};
  if (!b.name_ar) return res.status(400).json({ error: 'اسم الطرف مطلوب' });
  const id = run('INSERT INTO parties(name_ar,kind,phone,address,notes,created_at) VALUES(?,?,?,?,?,?)',
    b.name_ar, b.kind || 'general', b.phone || null, b.address || null, b.notes || null, nowISO()).lastInsertRowid;
  res.json({ id });
});
app.put('/api/parties/:id', auth, admin, (req, res) => {
  const b = req.body || {}; const a = get('SELECT * FROM parties WHERE id=?', req.params.id);
  if (!a) return res.status(404).json({ error: 'غير موجود' });
  run('UPDATE parties SET name_ar=?,kind=?,phone=?,address=?,notes=?,is_active=? WHERE id=?',
    b.name_ar ?? a.name_ar, b.kind ?? a.kind, b.phone ?? a.phone, b.address ?? a.address,
    b.notes ?? a.notes, b.is_active ?? a.is_active, a.id);
  res.json({ ok: true });
});
app.delete('/api/parties/:id', auth, admin, (req, res) => {
  run('UPDATE parties SET is_active=0 WHERE id=?', req.params.id);
  res.json({ ok: true });
});

// ===================================================================
//  المرتجعات: مبيعات (إرجاع مكونات + رد مبلغ) ومشتريات (خصم مواد + استرداد)
// ===================================================================
app.get('/api/returns/sales', auth, admin, (_q, res) => {
  const rows = all(`SELECT sr.*, o.invoice_no, c.name_ar customer_name, pm.name_ar method_name, u.full_name by_name,
    (SELECT COUNT(*) FROM sales_return_items WHERE return_id=sr.id) lines
    FROM sales_returns sr LEFT JOIN orders o ON o.id=sr.order_id LEFT JOIN customers c ON c.id=sr.customer_id
    LEFT JOIN payment_methods pm ON pm.id=sr.method_id LEFT JOIN users u ON u.id=sr.created_by ORDER BY sr.id DESC LIMIT 200`);
  res.json(rows);
});
app.get('/api/returns/sales/:id', auth, admin, (req, res) => {
  const r = get(`SELECT sr.*, o.invoice_no, c.name_ar customer_name FROM sales_returns sr
    LEFT JOIN orders o ON o.id=sr.order_id LEFT JOIN customers c ON c.id=sr.customer_id WHERE sr.id=?`, req.params.id);
  if (!r) return res.status(404).json({ error: 'غير موجود' });
  r.items = all('SELECT * FROM sales_return_items WHERE return_id=?', r.id);
  res.json(r);
});
// إنشاء مرتجع مبيعات: بنود من فاتورة أصلية، بكميات لا تتجاوز المباع (ناقص المرتجع سابقاً)
app.post('/api/returns/sales', auth, (req, res) => {
  const b = req.body || {};
  const o = get('SELECT * FROM orders WHERE id=?', b.order_id);
  if (!o || o.status !== 'paid') return res.status(400).json({ error: 'اختر فاتورة مدفوعة' });
  const lines = (b.items || []).filter(i => i.order_item_id && +i.qty > 0);
  if (!lines.length) return res.status(400).json({ error: 'حدد أصنافاً للإرجاع' });
  const restock = b.restock === 0 || b.restock === false ? 0 : 1;
  const shift = openShiftOf(req.user.id);
  const t = nowISO();

  const prepared = lines.map(l => {
    const oi = get('SELECT * FROM order_items WHERE id=? AND order_id=?', l.order_item_id, o.id);
    if (!oi) throw new Error('بند غير موجود بالفاتورة');
    const returnedBefore = get(`SELECT COALESCE(SUM(sri.qty),0) q FROM sales_return_items sri
      JOIN sales_returns sr ON sr.id=sri.return_id WHERE sr.order_id=? AND sri.product_id IS ?`, o.id, oi.product_id).q;
    const maxQty = Math.max(0, oi.qty - returnedBefore);
    const qty = Math.min(+l.qty, maxQty);
    if (qty <= 0) throw new Error(`الكمية المرتجعة تتجاوز المتاح للصنف: ${oi.name_ar}`);
    return { oi, qty };
  });
  const total = +prepared.reduce((s, x) => s + x.qty * x.oi.price, 0).toFixed(2);
  const no = genDocNo('sales_returns', 'return_no', 'SRT');

  const id = tx(() => {
    const rid = run(`INSERT INTO sales_returns(return_no,order_id,customer_id,total,method_id,reason,restock,shift_id,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`, no, o.id, o.customer_id, total, b.method_id || null, b.reason || null,
      restock, shift?.id || null, req.user.id, t).lastInsertRowid;
    prepared.forEach(({ oi, qty }) => {
      run('INSERT INTO sales_return_items(return_id,product_id,name_ar,qty,price,cost) VALUES(?,?,?,?,?,?)',
        rid, oi.product_id, oi.name_ar, qty, oi.price, oi.cost);
      // إرجاع مكونات الوصفة للمخزن (بنسبة الكمية المرتجعة)
      if (restock && oi.product_id) {
        const recipe = all(`SELECT pr.material_id, pr.qty, m.warehouse_id, m.avg_cost FROM product_recipes pr
          JOIN raw_materials m ON m.id=pr.material_id WHERE pr.product_id=?`, oi.product_id);
        for (const r of recipe) {
          const back = r.qty * qty;
          const mat = get('SELECT qty FROM raw_materials WHERE id=?', r.material_id);
          const bal = +(mat.qty + back).toFixed(4);
          run('UPDATE raw_materials SET qty=? WHERE id=?', bal, r.material_id);
          run(`INSERT INTO inventory_transactions(material_id,warehouse_id,type,qty,unit_cost,balance,ref_type,ref_id,note,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)`, r.material_id, r.warehouse_id, 'adjust', back, r.avg_cost, bal,
            'sales_return', rid, 'مرتجع بيع: ' + oi.name_ar, t);
        }
      }
    });
    // رد المبلغ من الخزينة
    if (b.method_id && total > 0) moneyMove({ method_id: b.method_id, amount: -total, ref_type: 'sales_return',
      ref_id: rid, note: `مرتجع مبيعات ${no} (${o.invoice_no})`, user_id: req.user.id, shift_id: shift?.id || null });
    return rid;
  });
  logAudit(req.user.id, 'sales_return', id, 'create', { total });
  notify({ role_key: 'admin', type: 'system', icon: '↩️', title: `مرتجع مبيعات ${no}`, body: `قيمة ${total} من ${o.invoice_no}`, ref_type: 'sales_return', ref_id: id });
  res.json({ id, return_no: no, total });
});

app.get('/api/returns/purchases', auth, admin, (_q, res) => {
  res.json(all(`SELECT pr.*, s.name_ar supplier, pu.ref purchase_ref, pm.name_ar method_name, u.full_name by_name,
    (SELECT COUNT(*) FROM purchase_return_items WHERE return_id=pr.id) lines
    FROM purchase_returns pr LEFT JOIN suppliers s ON s.id=pr.supplier_id LEFT JOIN purchases pu ON pu.id=pr.purchase_id
    LEFT JOIN payment_methods pm ON pm.id=pr.method_id LEFT JOIN users u ON u.id=pr.created_by ORDER BY pr.id DESC LIMIT 200`));
});
// مرتجع مشتريات: خصم مواد من المخزن + استرداد مبلغ للخزينة
app.post('/api/returns/purchases', auth, admin, (req, res) => {
  const b = req.body || {};
  const lines = (b.items || []).filter(i => i.material_id && +i.qty > 0);
  if (!lines.length) return res.status(400).json({ error: 'حدد مواد للإرجاع' });
  const pu = b.purchase_id ? get('SELECT * FROM purchases WHERE id=?', b.purchase_id) : null;
  const t = nowISO();
  const no = genDocNo('purchase_returns', 'return_no', 'PRT');
  const prepared = lines.map(l => {
    const m = get('SELECT * FROM raw_materials WHERE id=?', l.material_id);
    if (!m) throw new Error('مادة غير موجودة');
    const qty = +l.qty;
    if (qty > m.qty) throw new Error(`الكمية المرتجعة أكبر من الرصيد: ${m.name_ar}`);
    const cost = l.unit_cost !== undefined && +l.unit_cost > 0 ? +l.unit_cost : m.avg_cost;
    return { m, qty, cost };
  });
  const total = +prepared.reduce((s, x) => s + x.qty * x.cost, 0).toFixed(2);
  const id = tx(() => {
    const rid = run(`INSERT INTO purchase_returns(return_no,purchase_id,supplier_id,total,method_id,reason,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?)`, no, b.purchase_id || null, b.supplier_id || pu?.supplier_id || null, total,
      b.method_id || null, b.reason || null, req.user.id, t).lastInsertRowid;
    prepared.forEach(({ m, qty, cost }) => {
      run('INSERT INTO purchase_return_items(return_id,material_id,qty,unit_cost) VALUES(?,?,?,?)', rid, m.id, qty, cost);
      const bal = +(m.qty - qty).toFixed(4);
      run('UPDATE raw_materials SET qty=? WHERE id=?', bal, m.id);
      run(`INSERT INTO inventory_transactions(material_id,warehouse_id,type,qty,unit_cost,balance,ref_type,ref_id,note,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`, m.id, m.warehouse_id, 'adjust', -qty, cost, bal, 'purchase_return', rid, 'مرتجع شراء', t);
    });
    if (b.method_id && total > 0) moneyMove({ method_id: b.method_id, amount: total, ref_type: 'purchase_return',
      ref_id: rid, note: `مرتجع مشتريات ${no}`, user_id: req.user.id, shift_id: openShiftOf(req.user.id)?.id || null });
    return rid;
  });
  logAudit(req.user.id, 'purchase_return', id, 'create', { total });
  res.json({ id, return_no: no, total });
});

// ===================================================================
//  نقاط الولاء
// ===================================================================
app.get('/api/points/log', auth, admin, (_q, res) => {
  res.json(all(`SELECT pl.*, c.name_ar customer_name, u.full_name by_name FROM points_log pl
    JOIN customers c ON c.id=pl.customer_id LEFT JOIN users u ON u.id=pl.created_by ORDER BY pl.id DESC LIMIT 300`));
});
app.post('/api/points/manual', auth, admin, (req, res) => {
  const b = req.body || {};
  const c = get('SELECT * FROM customers WHERE id=?', b.customer_id);
  if (!c) return res.status(400).json({ error: 'اختر عميلاً' });
  const pts = +b.points || 0;
  if (!pts) return res.status(400).json({ error: 'أدخل عدد النقاط' });
  if (pts < 0 && Math.abs(pts) > c.points) return res.status(400).json({ error: 'رصيد النقاط لا يكفي' });
  logPoints(c.id, pts, pts > 0 ? 'manual_add' : 'manual_remove', b.note || null, 'manual', null, req.user.id);
  logAudit(req.user.id, 'points', c.id, pts > 0 ? 'add' : 'remove', { pts });
  res.json({ points: get('SELECT points FROM customers WHERE id=?', c.id).points });
});

// ===================================================================
//  الورديات وتقفيل العهدة
// ===================================================================
// ملخص وردية: المبيعات/التحصيل حسب الطريقة + النقدية المتوقعة بالدرج
function shiftSummary(shift) {
  const moves = all(`SELECT mm.*, pm.name_ar method_name, pm.kind method_kind FROM money_movements mm
    JOIN payment_methods pm ON pm.id=mm.method_id WHERE mm.shift_id=? ORDER BY mm.id`, shift.id);
  const byMethod = {};
  moves.forEach(m => {
    byMethod[m.method_id] ??= { method_id: m.method_id, name: m.method_name, kind: m.method_kind, inflow: 0, outflow: 0 };
    if (m.amount > 0) byMethod[m.method_id].inflow += m.amount; else byMethod[m.method_id].outflow += -m.amount;
  });
  const methods = Object.values(byMethod).map(m => ({ ...m, net: +(m.inflow - m.outflow).toFixed(2),
    inflow: +m.inflow.toFixed(2), outflow: +m.outflow.toFixed(2) }));
  // النقدية: صافي حركات الطرق النقدية داخل الوردية + العهدة الافتتاحية
  const cashNet = methods.filter(m => m.kind === 'cash').reduce((s, m) => s + m.net, 0);
  const expected_cash = +(shift.opening_float + cashNet).toFixed(2);
  const orders = get(`SELECT COUNT(*) cnt, COALESCE(SUM(total),0) sales, COALESCE(SUM(paid_amount),0) collected,
    COALESCE(SUM(total-paid_amount),0) credit FROM orders WHERE shift_id=? AND status='paid'`, shift.id);
  const cancelled = get(`SELECT COUNT(*) cnt FROM orders WHERE shift_id=? AND status='cancelled'`, shift.id).cnt;
  const returns = get(`SELECT COUNT(*) cnt, COALESCE(SUM(total),0) total FROM sales_returns WHERE shift_id=?`, shift.id);
  const vouchers = all(`SELECT kind, COUNT(*) cnt, COALESCE(SUM(amount),0) total FROM vouchers WHERE shift_id=? AND status='done' GROUP BY kind`, shift.id);
  return { methods, expected_cash, cash_net: +cashNet.toFixed(2), orders, cancelled, returns, vouchers, moves_count: moves.length };
}

app.get('/api/shifts', auth, (req, res) => {
  const mine = req.user.role_key !== 'admin' || req.query.mine === '1';
  const f = mine ? ' WHERE s.user_id=' + (+req.user.id) : '';
  res.json(all(`SELECT s.*, u.full_name user_name, cu.full_name closed_by_name FROM shifts s
    JOIN users u ON u.id=s.user_id LEFT JOIN users cu ON cu.id=s.closed_by ${f} ORDER BY s.id DESC LIMIT 100`));
});
app.get('/api/shifts/current', auth, (req, res) => {
  const s = openShiftOf(req.user.id);
  if (!s) return res.json({ open: false, require: settingsObj().shift_require === '1' });
  res.json({ open: true, shift: s, summary: shiftSummary(s) });
});
app.post('/api/shifts/open', auth, (req, res) => {
  if (openShiftOf(req.user.id)) return res.status(400).json({ error: 'لديك وردية مفتوحة بالفعل — أغلقها أولاً' });
  const b = req.body || {};
  const id = run('INSERT INTO shifts(user_id,opening_float,note,opened_at) VALUES(?,?,?,?)',
    req.user.id, +b.opening_float || 0, b.note || null, nowISO()).lastInsertRowid;
  logAudit(req.user.id, 'shift', id, 'open', { opening_float: +b.opening_float || 0 });
  notify({ role_key: 'admin', type: 'system', icon: '⏱️', title: `فتح وردية — ${req.user.full_name}`,
    body: `عهدة افتتاحية: ${+b.opening_float || 0}`, ref_type: 'shift', ref_id: id });
  res.json({ id });
});
app.get('/api/shifts/:id', auth, (req, res) => {
  const s = get(`SELECT s.*, u.full_name user_name, cu.full_name closed_by_name FROM shifts s
    JOIN users u ON u.id=s.user_id LEFT JOIN users cu ON cu.id=s.closed_by WHERE s.id=?`, req.params.id);
  if (!s) return res.status(404).json({ error: 'غير موجود' });
  if (req.user.role_key !== 'admin' && s.user_id !== req.user.id) return res.status(403).json({ error: 'غير مصرح' });
  res.json({ shift: s, summary: shiftSummary(s) });
});
// تقفيل الوردية وتسليم العهدة: جرد الدرج الفعلي وحساب العجز/الزيادة
app.post('/api/shifts/:id/close', auth, (req, res) => {
  const s = get('SELECT * FROM shifts WHERE id=?', req.params.id);
  if (!s) return res.status(404).json({ error: 'غير موجود' });
  if (s.status !== 'open') return res.status(400).json({ error: 'الوردية مغلقة بالفعل' });
  if (req.user.role_key !== 'admin' && s.user_id !== req.user.id) return res.status(403).json({ error: 'غير مصرح' });
  const b = req.body || {};
  const counted = +b.counted_cash;
  if (isNaN(counted) || counted < 0) return res.status(400).json({ error: 'أدخل النقدية المعدودة بالدرج' });
  const sum = shiftSummary(s);
  const variance = +(counted - sum.expected_cash).toFixed(2);
  tx(() => {
    run(`UPDATE shifts SET status='closed', expected_cash=?, counted_cash=?, variance=?, close_note=?, closed_by=?, closed_at=? WHERE id=?`,
      sum.expected_cash, counted, variance, b.close_note || null, req.user.id, nowISO(), s.id);
    // تسوية العجز/الزيادة على أول طريقة نقدية حتى تطابق الدفاتر الواقع
    if (variance !== 0) {
      const cashM = get("SELECT id FROM payment_methods WHERE kind='cash' AND is_active=1 ORDER BY sort_order,id LIMIT 1");
      if (cashM) moneyMove({ method_id: cashM.id, amount: variance, ref_type: 'shift', ref_id: s.id,
        note: variance > 0 ? 'زيادة تقفيل وردية' : 'عجز تقفيل وردية', user_id: req.user.id, shift_id: s.id });
    }
  });
  logAudit(req.user.id, 'shift', s.id, 'close', { expected: sum.expected_cash, counted, variance });
  notify({ role_key: 'admin', type: 'system', icon: variance < 0 ? '🚨' : '✅',
    title: `تقفيل وردية — ${req.user.full_name}`,
    body: `متوقع ${sum.expected_cash} / معدود ${counted} — ${variance === 0 ? 'مطابق' : (variance > 0 ? 'زيادة ' + variance : 'عجز ' + Math.abs(variance))}`,
    ref_type: 'shift', ref_id: s.id });
  res.json({ ok: true, expected_cash: sum.expected_cash, counted_cash: counted, variance });
});

// ===================================================================
//  QR الطاولات: منيو عام + طلبات العملاء من الطاولة
// ===================================================================
const genTableToken = () => randomUUID().replace(/-/g, '').slice(0, 20);

// (عام — بدون مصادقة) المنيو: بطاولة عبر رمزها (QR) أو بدون رمز (دليفري أونلاين)
app.get('/api/public/menu', (req, res) => {
  const s = settingsObj();
  let table = null;
  if (req.query.t) {
    const tb = get('SELECT id,name_ar FROM tables WHERE qr_token=? AND is_active=1', req.query.t);
    if (!tb) return res.status(404).json({ error: 'رمز الطاولة غير صالح — اطلب من الكاشير' });
    table = { id: tb.id, name: tb.name_ar };
  } else if (s.online_ordering !== '1') {
    return res.status(403).json({ error: 'الطلب أونلاين متوقف حالياً — نستقبلك في المكان 🌊' });
  }
  const products = all(`SELECT p.id,p.name_ar,p.price,p.image,p.category_id,p.is_new,p.is_featured FROM products p
    WHERE p.is_active=1 AND p.show_online=1 ORDER BY p.sort_order,p.id`);
  // الأكثر مبيعاً (من الطلبات المدفوعة)
  const topSelling = all(`SELECT oi.product_id id FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE o.status='paid' AND oi.product_id IS NOT NULL GROUP BY oi.product_id ORDER BY SUM(oi.qty) DESC LIMIT 12`).map(r => r.id);
  res.json({
    cafe: { name: s.cafe_name || 'seaside', tagline: s.tagline || '', currency: s.currency || 'EGP',
      phone: s.phone || '', custom_logo: existsSync(CUSTOM_LOGO), theme_preset: s.theme_preset || 'seaside',
      delivery_fee: +s.delivery_fee || 0, online_ordering: s.online_ordering === '1',
      require_login: s.shop_require_login === '1', wa: waConnected(),
      hero_title: s.shop_hero_title || '', hero_sub: s.shop_hero_sub || '', points_enabled: s.points_enabled === '1' },
    taxes: activeTaxes().map(tx => ({ name: tx.name_ar, rate: tx.rate, show: tx.show_on_receipt ? 1 : 0 })),
    table,
    categories: all(`SELECT id,name_ar,icon,image FROM categories WHERE is_active=1 AND show_online=1 ORDER BY sort_order,id`),
    products,
    newIds: products.filter(p => p.is_new).map(p => p.id),
    featuredIds: products.filter(p => p.is_featured).map(p => p.id),
    topIds: topSelling,
  });
});

// ===================================================================
//  حسابات العملاء (المتجر): تسجيل دخول بالموبايل + OTP واتساب
// ===================================================================
const genOTP = () => String(Math.floor(1000 + Math.random() * 9000));   // 4 أرقام
// إرسال كود التحقق
app.post('/api/shop/otp/send', async (req, res) => {
  const phone = (req.body?.phone || '').trim();
  if (!/^0?1[0-9]{9}$/.test(phone.replace(/\s/g, ''))) return res.status(400).json({ error: 'أدخل رقم موبايل مصري صحيح (11 رقم)' });
  // حد إرسال: كود واحد كل 45 ثانية لنفس الرقم
  const recent = get(`SELECT created_at FROM otp_codes WHERE phone=? ORDER BY id DESC LIMIT 1`, phone);
  if (recent && (Date.now() - new Date(recent.created_at).getTime()) < 45e3)
    return res.status(429).json({ error: 'انتظر قليلاً قبل طلب كود جديد' });
  const code = genOTP();
  const expires = new Date(Date.now() + 5 * 60e3).toISOString();
  run('DELETE FROM otp_codes WHERE phone=?', phone);   // كود واحد فعّال لكل رقم
  run('INSERT INTO otp_codes(phone,code,expires_at,created_at) VALUES(?,?,?,?)', phone, code, expires, nowISO());
  const s = settingsObj();
  const wa = await sendWhatsApp(phone, `${s.cafe_name || 'المتجر'}\nكود تفعيل حسابك: ${code}\nصالح لمدة 5 دقائق. لا تشاركه مع أحد.`);
  if (wa.dev) LAST_DEV_OTP = { phone, code };
  // في وضع التطوير نُرجع الكود ليجربه المطوّر؛ في الإنتاج (واتساب متصل) لا نُرجعه
  res.json({ sent: true, dev: !!wa.dev, ...(wa.dev ? { dev_code: code } : {}) });
});
// التحقق من الكود → إنشاء/جلب حساب العميل + جلسة
app.post('/api/shop/otp/verify', (req, res) => {
  const phone = (req.body?.phone || '').trim();
  const code = (req.body?.code || '').trim();
  const rec = get(`SELECT * FROM otp_codes WHERE phone=? ORDER BY id DESC LIMIT 1`, phone);
  if (!rec) return res.status(400).json({ error: 'اطلب كود التحقق أولاً' });
  if (new Date(rec.expires_at) < new Date()) return res.status(400).json({ error: 'انتهت صلاحية الكود — اطلب كوداً جديداً' });
  if (rec.attempts >= 5) return res.status(429).json({ error: 'محاولات كثيرة — اطلب كوداً جديداً' });
  if (rec.code !== code) {
    run('UPDATE otp_codes SET attempts=attempts+1 WHERE id=?', rec.id);
    return res.status(400).json({ error: 'الكود غير صحيح' });
  }
  run('DELETE FROM otp_codes WHERE phone=?', phone);
  // أنشئ العميل أو اجلبه، وأكّد رقمه
  let c = get('SELECT * FROM customers WHERE phone=?', phone);
  if (!c) {
    const id = run('INSERT INTO customers(name_ar,phone,phone_verified,created_at) VALUES(?,?,1,?)',
      (req.body?.name || '').trim() || 'عميل', phone, nowISO()).lastInsertRowid;
    c = get('SELECT * FROM customers WHERE id=?', id);
  } else {
    run('UPDATE customers SET phone_verified=1, is_active=1 WHERE id=?', c.id);
    if (req.body?.name && (c.name_ar === 'عميل' || !c.name_ar)) run('UPDATE customers SET name_ar=? WHERE id=?', req.body.name.trim(), c.id);
  }
  const token = randomUUID();
  run('INSERT INTO customer_sessions(token,customer_id,created_at) VALUES(?,?,?)', token, c.id, nowISO());
  res.json({ token, customer: { id: c.id, name: c.name_ar, phone: c.phone, points: c.points || 0 } });
});
// بيانات العميل الحالي + نقاطه + طلباته
app.get('/api/shop/me', shopAuth, (req, res) => {
  const c = req.customer;
  const orders = all(`SELECT o.id,o.invoice_no,o.total,o.status,o.payment_status,o.order_type,o.created_at
    FROM orders o WHERE o.customer_id=? ORDER BY o.id DESC LIMIT 30`, c.id);
  const points_log = all(`SELECT points,kind,note,created_at FROM points_log WHERE customer_id=? ORDER BY id DESC LIMIT 30`, c.id);
  res.json({ id: c.id, name: c.name_ar, phone: c.phone, points: c.points || 0, orders, points_log });
});
app.put('/api/shop/me', shopAuth, (req, res) => {
  const b = req.body || {};
  run('UPDATE customers SET name_ar=COALESCE(?,name_ar), address=COALESCE(?,address) WHERE id=?',
    (b.name || '').trim() || null, (b.address || '').trim() || null, req.customer.id);
  res.json({ ok: true });
});
app.post('/api/shop/logout', shopAuth, (req, res) => {
  run('DELETE FROM customer_sessions WHERE token=?', (req.headers['x-shop-token'] || '').trim());
  res.json({ ok: true });
});

// ---------- داشبورد إدارة المتجر (أدمن) ----------
app.get('/api/shop-admin/overview', auth, admin, (req, res) => {
  const today = localDay(0);
  const stats = {
    customers: get('SELECT COUNT(*) c FROM customers WHERE phone_verified=1').c,
    onlineOrdersToday: get(`SELECT COUNT(*) c FROM orders WHERE source='qr' AND order_type='delivery' AND substr(created_at,1,10)=?`, today).c,
    onlineSales: get(`SELECT COALESCE(SUM(total),0) s FROM orders WHERE source='qr' AND order_type='delivery' AND status='paid'`).s,
    pendingOnline: get(`SELECT COUNT(*) c FROM orders WHERE source='qr' AND order_type='delivery' AND status='open'`).c,
  };
  // العملاء المسجّلون + إحصاءاتهم
  const customers = all(`SELECT c.id,c.name_ar,c.phone,c.points,c.created_at,
    (SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id AND o.source='qr') orders_count,
    (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.customer_id=c.id AND o.status='paid') total_spent
    FROM customers c WHERE c.phone_verified=1 ORDER BY c.id DESC LIMIT 200`);
  res.json({ stats, customers, wa_connected: waConnected(),
    wa_dev_last: LAST_DEV_OTP, base_url: `${req.protocol}://${req.get('host')}` });
});
// المنتجات المعروضة أونلاين مع علاماتها (للإدارة السريعة)
app.get('/api/shop-admin/products', auth, admin, (_q, res) => {
  res.json(all(`SELECT p.id,p.name_ar,p.price,p.image,p.is_new,p.is_featured,p.show_online,c.name_ar category
    FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.is_active=1 ORDER BY p.sort_order,p.id`));
});
// تبديل علامة منتج (جديد/مميّز/معروض) بسرعة
app.post('/api/shop-admin/products/:id/flag', auth, admin, (req, res) => {
  const { flag, value } = req.body || {};
  if (!['is_new', 'is_featured', 'show_online'].includes(flag)) return res.status(400).json({ error: 'علامة غير معروفة' });
  run(`UPDATE products SET ${flag}=? WHERE id=?`, value ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
// (عام + مصادقة عميل اختيارية) إنشاء طلب: من الطاولة (t) أو دليفري أونلاين (mode=delivery)
app.post('/api/public/orders', shopAuthOptional, (req, res) => {
  const b = req.body || {};
  const s = settingsObj();
  const isDelivery = b.mode === 'delivery';
  const cust = req.customer || null;   // عميل مسجّل دخوله (إن وُجد)
  let tb = null;
  if (isDelivery) {
    if (s.online_ordering !== '1') return res.status(403).json({ error: 'الطلب أونلاين متوقف حالياً' });
    // إلزام تسجيل الدخول (تأكيد الرقم بالـ OTP) قبل الطلب أونلاين
    if (s.shop_require_login === '1' && !cust) return res.status(401).json({ error: 'سجّل الدخول برقم موبايلك أولاً' });
    const nm = (b.name || cust?.name_ar || '').trim(), ph = (cust?.phone || b.phone || '').trim(), ad = (b.address || '').trim();
    if (!nm || !ph || !ad) return res.status(400).json({ error: 'الاسم ورقم الموبايل والعنوان مطلوبة للتوصيل' });
    b.name = nm; b.phone = ph; b.address = ad;
  } else {
    tb = get('SELECT id,name_ar FROM tables WHERE qr_token=? AND is_active=1', b.t || '');
    if (!tb) return res.status(404).json({ error: 'رمز الطاولة غير صالح' });
  }
  const items = (b.items || []).filter(i => i.product_id && +i.qty > 0).slice(0, 50);
  if (!items.length) return res.status(400).json({ error: 'أضف صنفاً واحداً على الأقل' });
  // حماية من الإغراق: 3 طلبات مفتوحة كحد أقصى لكل طاولة/رقم موبايل في الدقيقة
  const recent = isDelivery
    ? get(`SELECT COUNT(*) c FROM orders WHERE source='qr' AND qr_phone=? AND status='open' AND created_at>?`,
        b.phone.trim(), new Date(Date.now() - 60e3).toISOString()).c
    : get(`SELECT COUNT(*) c FROM orders WHERE source='qr' AND table_id=? AND status='open' AND created_at>?`,
        tb.id, new Date(Date.now() - 60e3).toISOString()).c;
  if (recent >= 3) return res.status(429).json({ error: 'تم استلام طلبك بالفعل — انتظر قليلاً' });
  const prepared = items.map(i => {
    const p = get('SELECT id,name_ar,price,cost FROM products WHERE id=? AND is_active=1', i.product_id);
    if (!p) throw new Error('صنف غير موجود');
    return { product_id: p.id, name_ar: p.name_ar, qty: Math.min(+i.qty, 50), price: p.price, cost: p.cost, note: (i.note || '').slice(0, 120) || null };
  });
  const tot = computeTotals(prepared, 0);
  const deliveryFee = isDelivery ? (+s.delivery_fee || 0) : 0;   // تُخزن في حقل tip (مصاريف توصيل)
  const grandTotal = +(tot.total + deliveryFee).toFixed(2);
  const t = nowISO();
  const id = tx(() => {
    const oid = run(`INSERT INTO orders(invoice_no,order_type,table_id,guests,status,subtotal,discount,tax,tip,total,cost_total,created_at,source,qr_name,qr_phone,qr_address,note,tax_detail,customer_id,paid_amount,payment_status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,'unpaid')`,
      genInvoiceNo(), isDelivery ? 'delivery' : 'dine_in', tb?.id || null, Math.min(+b.guests || 1, 30), 'open',
      tot.subtotal, 0, tot.tax, deliveryFee, grandTotal, tot.cost, t, 'qr',
      (b.name || '').slice(0, 60) || null, (b.phone || '').slice(0, 20) || null,
      isDelivery ? (b.address || '').slice(0, 250) : null,
      (b.note || '').slice(0, 200) || null, JSON.stringify(tot.taxes), cust?.id || null).lastInsertRowid;
    prepared.forEach(p => run('INSERT INTO order_items(order_id,product_id,name_ar,qty,price,cost,note) VALUES(?,?,?,?,?,?,?)',
      oid, p.product_id, p.name_ar, p.qty, p.price, p.cost, p.note));
    return oid;
  });
  const o = get('SELECT invoice_no,total FROM orders WHERE id=?', id);
  const src = isDelivery ? `دليفري 🛵 ${b.name}` : tb.name_ar;
  ['admin', 'cashier'].forEach(rk => notify({ role_key: rk, type: 'qr_order', icon: isDelivery ? '🛵' : '📲',
    title: `طلب ${isDelivery ? 'دليفري' : 'QR'} جديد — ${src}`, body: `${o.invoice_no} — ${o.total}`, ref_type: 'order', ref_id: id }));
  res.json({ id, invoice_no: o.invoice_no, total: o.total, delivery_fee: deliveryFee });
});
// (عام) متابعة حالة الطلب: بالرمز (طاولة) أو برقم الموبايل (دليفري)
app.get('/api/public/orders/:id/status', (req, res) => {
  const o = req.query.t
    ? get(`SELECT o.id,o.invoice_no,o.status,o.total,o.payment_status FROM orders o
        JOIN tables tb ON tb.id=o.table_id WHERE o.id=? AND o.source='qr' AND tb.qr_token=?`, req.params.id, req.query.t)
    : get(`SELECT id,invoice_no,status,total,payment_status FROM orders
        WHERE id=? AND source='qr' AND qr_phone=?`, req.params.id, req.query.p || '');
  if (!o) return res.status(404).json({ error: 'غير موجود' });
  res.json(o);
});

// (مصادقة) شاشة طلبات QR للكاشير/الأدمن — بفلتر النوع (طاولات/دليفري)
app.get('/api/qr-orders', auth, (req, res) => {
  // kind=tables → طاولات فقط (dine_in)، kind=delivery → دليفري فقط
  const f = req.query.kind === 'delivery' ? " AND o.order_type='delivery'"
    : req.query.kind === 'tables' ? " AND o.order_type<>'delivery'" : '';
  const rows = all(`SELECT o.*, t.name_ar table_name FROM orders o LEFT JOIN tables t ON t.id=o.table_id
    WHERE o.source='qr' ${f} ORDER BY (o.status='open') DESC, o.id DESC LIMIT 80`);
  rows.forEach(o => o.items = all('SELECT id,name_ar,qty,price,note FROM order_items WHERE order_id=? ORDER BY id', o.id));
  res.json(rows);
});
// عدّادات منفصلة: إجمالي + طاولات + دليفري
app.get('/api/qr-orders/count', auth, (_q, res) => {
  const tables = get(`SELECT COUNT(*) c FROM orders WHERE source='qr' AND status='open' AND order_type<>'delivery'`).c;
  const delivery = get(`SELECT COUNT(*) c FROM orders WHERE source='qr' AND status='open' AND order_type='delivery'`).c;
  res.json({ count: tables + delivery, tables, delivery });
});
// قبول الطلب → يذهب للمطبخ/البار + إشعار واتساب للعميل
app.post('/api/qr-orders/:id/accept', auth, (req, res) => {
  const o = get(`SELECT * FROM orders WHERE id=? AND source='qr'`, req.params.id);
  if (!o) return res.status(404).json({ error: 'غير موجود' });
  if (o.status !== 'open') return res.status(400).json({ error: 'الطلب تمت معالجته بالفعل' });
  run(`UPDATE orders SET status='confirmed', waiter_id=COALESCE(waiter_id,?) WHERE id=?`, req.body?.waiter_id || null, o.id);
  logAudit(req.user.id, 'order', o.id, 'qr_accept');
  // إشعار واتساب: طلبك اتقبل وجاري التحضير
  if (o.qr_phone) {
    const s = settingsObj();
    const eta = o.order_type === 'delivery' ? 'وهيوصلك في أقرب وقت 🛵' : 'وهيتجهز حالاً 👨‍🍳';
    sendWhatsApp(o.qr_phone, `${s.cafe_name || 'المتجر'}\n✅ تم قبول طلبك ${o.invoice_no}\nجاري تجهيزه ${eta}\nإجمالي: ${o.total} ${s.currency || 'ج.م'}\nشكراً لطلبك 🌟`);
  }
  res.json({ ok: true });
});
// رفض الطلب + إشعار واتساب
app.post('/api/qr-orders/:id/reject', auth, (req, res) => {
  const o = get(`SELECT * FROM orders WHERE id=? AND source='qr'`, req.params.id);
  if (!o) return res.status(404).json({ error: 'غير موجود' });
  if (o.status !== 'open') return res.status(400).json({ error: 'الطلب تمت معالجته بالفعل' });
  run(`UPDATE orders SET status='cancelled', note=COALESCE(?,note) WHERE id=?`, req.body?.reason || null, o.id);
  logAudit(req.user.id, 'order', o.id, 'qr_reject', { reason: req.body?.reason });
  if (o.qr_phone) {
    const s = settingsObj();
    sendWhatsApp(o.qr_phone, `${s.cafe_name || 'المتجر'}\nنعتذر، تعذّر قبول طلبك ${o.invoice_no}${req.body?.reason ? '\nالسبب: ' + req.body.reason : ''}\nبرجاء التواصل معنا.`);
  }
  res.json({ ok: true });
});

// (مصادقة/أدمن) الطاولات مع روابط QR — يولّد رمزاً لأي طاولة بدون رمز
app.get('/api/tables-qr', auth, admin, (req, res) => {
  all('SELECT id FROM tables WHERE qr_token IS NULL').forEach(tb =>
    run('UPDATE tables SET qr_token=? WHERE id=?', genTableToken(), tb.id));
  const base = `${req.protocol}://${req.get('host')}`;
  const rows = all('SELECT id,name_ar,seats,is_active,qr_token FROM tables ORDER BY sort_order,id');
  rows.forEach(tb => {
    tb.url = `${base}/menu?t=${tb.qr_token}`;
    tb.pending = get(`SELECT COUNT(*) c FROM orders WHERE source='qr' AND status='open' AND table_id=?`, tb.id).c;
  });
  res.json(rows);
});
// إعادة توليد رمز طاولة (يُبطل الكود المطبوع القديم)
app.post('/api/tables-qr/:id/regenerate', auth, admin, (req, res) => {
  const tk = genTableToken();
  run('UPDATE tables SET qr_token=? WHERE id=?', tk, req.params.id);
  logAudit(req.user.id, 'table', +req.params.id, 'qr_regenerate');
  res.json({ qr_token: tk });
});

// ===================================================================
//  النسخ الاحتياطي
// ===================================================================
const BACKUP_DIR = join(__dirname, 'db', 'backups');
const safeBackupName = (n) => /^backup-[\w.-]+\.db$/.test(n || '');
function createBackup() {
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });
  const name = 'backup-' + nowISO().replace(/[:T]/g, '-').slice(0, 19) + '.db';
  db.exec(`VACUUM INTO '${join(BACKUP_DIR, name).replace(/'/g, "''")}'`);
  return name;
}
app.get('/api/backup/list', auth, admin, (_q, res) => {
  if (!existsSync(BACKUP_DIR)) return res.json([]);
  res.json(readdirSync(BACKUP_DIR).filter(safeBackupName).map(f => {
    const st = statSync(join(BACKUP_DIR, f));
    return { name: f, size: st.size, created_at: st.mtime.toISOString() };
  }).sort((a, b) => b.created_at.localeCompare(a.created_at)));
});
app.post('/api/backup/create', auth, admin, (req, res) => {
  const name = createBackup();
  logAudit(req.user.id, 'backup', null, 'create', { name });
  res.json({ name });
});
app.get('/api/backup/download/:name', auth, admin, (req, res) => {
  const n = req.params.name;
  if (!safeBackupName(n) || !existsSync(join(BACKUP_DIR, n))) return res.status(404).json({ error: 'غير موجود' });
  res.download(join(BACKUP_DIR, n));
});
app.delete('/api/backup/:name', auth, admin, (req, res) => {
  const n = req.params.name;
  if (!safeBackupName(n)) return res.status(400).json({ error: 'اسم غير صالح' });
  try { rmSync(join(BACKUP_DIR, n)); } catch {}
  res.json({ ok: true });
});
// استرجاع نسخة: يأخذ نسخة أمان من الوضع الحالي أولاً ثم يستبدل الملف ويعيد فتح القاعدة
app.post('/api/backup/restore', auth, admin, (req, res) => {
  const n = req.body?.name;
  if (!safeBackupName(n) || !existsSync(join(BACKUP_DIR, n))) return res.status(404).json({ error: 'النسخة غير موجودة' });
  const safety = createBackup();   // نسخة أمان قبل الاسترجاع
  db.close();
  ['-shm', '-wal'].forEach(s => { try { rmSync(DB_PATH + s); } catch {} });
  copyFileSync(join(BACKUP_DIR, n), DB_PATH);
  reopenDb();
  migrate();   // تأكد من توافق النسخة المسترجعة مع أحدث مخطط
  logAudit(req.user.id, 'backup', null, 'restore', { name: n, safety });
  res.json({ ok: true, safety });
});
const TABLES = {
  categories: ['name_ar', 'icon', 'color', 'is_active', 'sort_order'],
  tables: ['name_ar', 'seats', 'is_active', 'sort_order'],
  'payment-methods': ['name_ar', 'name_en', 'icon', 'kind', 'show_in_pos', 'is_active', 'sort_order', 'opening_balance', 'account_no', 'account_name'],
  units: ['name_ar', 'symbol', 'is_active'],
  warehouses: ['name_ar', 'kind', 'is_active', 'sort_order'],
  suppliers: ['name_ar', 'phone', 'notes', 'is_active'],
  'expense-categories': ['name_ar', 'icon', 'is_active', 'sort_order'],
  taxes: ['name_ar', 'name_en', 'rate', 'is_active', 'show_on_receipt', 'sort_order'],
};
const TBL = (k) => k === 'payment-methods' ? 'payment_methods' : k === 'expense-categories' ? 'expense_categories' : k;
const numCols = new Set(['seats', 'sort_order', 'is_active', 'rate', 'show_on_receipt']);

app.get('/api/admin/:table', auth, admin, (req, res) => {
  if (!TABLES[req.params.table]) return res.status(404).json({ error: 'جدول غير معروف' });
  res.json(all(`SELECT * FROM ${TBL(req.params.table)} ORDER BY id`));
});
app.post('/api/admin/:table', auth, admin, (req, res) => {
  const cols = TABLES[req.params.table]; if (!cols) return res.status(404).json({ error: 'غير معروف' });
  const b = req.body || {};
  const vals = cols.map(c => c === 'is_active' ? (b[c] ?? 1) : (b[c] ?? (numCols.has(c) ? 0 : '')));
  run(`INSERT INTO ${TBL(req.params.table)}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, ...vals);
  res.json({ ok: true });
});
app.put('/api/admin/:table/:id', auth, admin, (req, res) => {
  const cols = TABLES[req.params.table]; if (!cols) return res.status(404).json({ error: 'غير معروف' });
  const b = req.body || {}; const sets = cols.filter(c => b[c] !== undefined);
  if (!sets.length) return res.json({ ok: true });
  run(`UPDATE ${TBL(req.params.table)} SET ${sets.map(c => c + '=?').join(',')} WHERE id=?`, ...sets.map(c => b[c]), req.params.id);
  res.json({ ok: true });
});
// حذف — مسموح للضرائب فقط (لا مراجع خارجية عليها؛ تفاصيلها منسوخة في الطلبات)
app.delete('/api/admin/:table/:id', auth, admin, (req, res) => {
  if (req.params.table !== 'taxes') return res.status(403).json({ error: 'الحذف غير متاح لهذا الجدول — عطّله بدلاً من حذفه' });
  run('DELETE FROM taxes WHERE id=?', req.params.id);
  res.json({ ok: true });
});

// الإعدادات العامة
app.get('/api/settings', auth, admin, (_q, res) => res.json(settingsObj()));
app.put('/api/settings', auth, admin, (req, res) => {
  const up = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  Object.entries(req.body || {}).forEach(([k, v]) => up.run(k, String(v)));
  res.json({ ok: true });
});

// ===================================================================
//  الهوية والثيم (Branding) — عامة بدون مصادقة لشاشة الدخول
// ===================================================================
const CUSTOM_LOGO = join(__dirname, 'public', 'logo-custom.png');
app.get('/api/branding', (_q, res) => {
  const s = settingsObj();
  res.json({
    cafe_name: s.cafe_name || 'seaside', tagline: s.tagline || '',
    theme_preset: s.theme_preset || 'seaside',
    theme_glass: s.theme_glass || '0',
    custom_logo: existsSync(CUSTOM_LOGO),
  });
});
// رفع لوجو مخصص (data URL) — يظهر في الدخول والقائمة والفاتورة
app.post('/api/branding/logo', auth, admin, (req, res) => {
  const data = req.body?.data || '';
  const m = data.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
  if (!m) return res.status(400).json({ error: 'ارفع صورة PNG أو JPG أو WEBP' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4 * 1024 * 1024) return res.status(400).json({ error: 'الحد الأقصى لحجم اللوجو 4MB' });
  writeFileSync(CUSTOM_LOGO, buf);
  logAudit(req.user.id, 'branding', null, 'logo_upload', { size: buf.length });
  res.json({ ok: true });
});
app.delete('/api/branding/logo', auth, admin, (req, res) => {
  try { rmSync(CUSTOM_LOGO); } catch {}
  logAudit(req.user.id, 'branding', null, 'logo_delete');
  res.json({ ok: true });
});

// ===================================================================
//  الموظفون (Staff)
// ===================================================================
app.get('/api/staff', auth, admin, (_q, res) => res.json(all(`SELECT u.id,u.full_name,u.email,u.pin,u.is_active,r.key role_key,r.name_ar role_name
  FROM users u JOIN roles r ON r.id=u.role_id ORDER BY u.id`)));
app.get('/api/roles', auth, admin, (_q, res) => res.json(all('SELECT id,key,name_ar FROM roles ORDER BY id')));
app.post('/api/staff', auth, admin, (req, res) => {
  const b = req.body || {};
  if (!b.full_name || !b.email || !b.password || !b.role_id) return res.status(400).json({ error: 'الاسم والبريد وكلمة المرور والدور مطلوبة' });
  if (get('SELECT 1 v FROM users WHERE email=?', b.email)) return res.status(400).json({ error: 'البريد مستخدم بالفعل' });
  run('INSERT INTO users(full_name,email,password_hash,role_id,pin,is_active,created_at) VALUES(?,?,?,?,?,1,?)',
    b.full_name, b.email, bcrypt.hashSync(b.password, 10), b.role_id, b.pin || null, nowISO());
  res.json({ ok: true });
});
app.put('/api/staff/:id', auth, admin, (req, res) => {
  const b = req.body || {}; const a = get('SELECT * FROM users WHERE id=?', req.params.id);
  if (!a) return res.status(404).json({ error: 'غير موجود' });
  run('UPDATE users SET full_name=?,role_id=?,pin=?,is_active=? WHERE id=?',
    b.full_name ?? a.full_name, b.role_id ?? a.role_id, b.pin ?? a.pin, b.is_active ?? a.is_active, a.id);
  if (b.password) run('UPDATE users SET password_hash=? WHERE id=?', bcrypt.hashSync(b.password, 10), a.id);
  res.json({ ok: true });
});

// مسح الفواتير والحركات المالية فقط (أدمن + تأكيد)
app.post('/api/admin/reset-financials', auth, admin, (req, res) => {
  if (req.body?.confirm !== 'DELETE_FINANCIALS') return res.status(400).json({ error: 'مطلوب تأكيد العملية' });
  tx(() => {
    run('DELETE FROM order_items');
    run('DELETE FROM orders');
    run('DELETE FROM purchase_items');
    run('DELETE FROM purchases');
    run('DELETE FROM purchase_requests');
    run('DELETE FROM expenses');
    run('DELETE FROM inventory_transactions');
    run('DELETE FROM waste_log');
    run('DELETE FROM stock_count_items');
    run('DELETE FROM stock_counts');
    run('DELETE FROM audit_log');
    run('DELETE FROM notifications');
    run("DELETE FROM sqlite_sequence WHERE name IN ('orders','order_items','purchases','purchase_items','expenses','inventory_transactions','waste_log','stock_counts','stock_count_items','audit_log','notifications','purchase_requests')");
  });
  logAudit(req.user.id, 'system', 0, 'reset_financials', { by: req.user.email });
  res.json({ ok: true });
});
// ملفات ثابتة + SPA — بدون كاش طويل عشان أي تحديث يوصل فوراً بدون كاش قديم في المتصفح
app.use(express.static(join(__dirname, 'public'), { etag: true, lastModified: true, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
// منيو العميل عبر QR الطاولة (صفحة عامة مستقلة عن نظام الإدارة)
app.get('/menu', (_q, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(join(__dirname, 'public', 'menu.html')); });
app.get('*', (_q, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(join(__dirname, 'public', 'index.html')); });
app.listen(PORT, () => console.log(`\n🌊 نظام كافيه على البحر يعمل على:  http://localhost:${PORT}\n`));
