// ===================================================================
//  الخادم — REST API لنظام نقاط البيع وإدارة المخازن (كافيه على البحر)
//  POS + Recipes/BOM + Inventory back-flush + Moving-Average + Governance
// ===================================================================
import express from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createReadStream } from 'node:fs';
import { db, get, all, run, tx, nowISO } from './db/database.js';
import { DB_PATH } from './db/database.js';
import { seed } from './db/seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4700;
const app = express();
app.use(express.json());

// تهيئة تلقائية لقاعدة البيانات عند الإقلاع
try { if (seed()) console.log('🌱 تم تهيئة قاعدة بيانات الكافيه وبذرها تلقائياً.'); }
catch (e) { console.error('⚠️ فشل تهيئة قاعدة البيانات:', e.message); }

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

const settingsObj = () => Object.fromEntries(all('SELECT key,value FROM settings').map(r => [r.key, r.value]));
const taxRate = () => (+(get("SELECT value FROM settings WHERE key='tax_rate'")?.value || 0)) / 100;

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
  settings: settingsObj(),
}));

// ===================================================================
//  لوحة المعلومات
// ===================================================================
app.get('/api/dashboard', auth, (req, res) => {
  const today = nowISO().slice(0, 10);
  const yest = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const dayAgg = (d) => get(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) sales, COALESCE(SUM(total-cost_total-tax),0) profit, COALESCE(SUM(guests),0) guests
    FROM orders WHERE status='paid' AND substr(created_at,1,10)=?`, d);
  const tD = dayAgg(today), yD = dayAgg(yest);
  const pct = (a, b) => b ? Math.round(((a - b) / b) * 100) : (a ? 100 : 0);

  // مبيعات آخر 14 يوماً
  const trend = all(`SELECT substr(created_at,1,10) d, COALESCE(SUM(total),0) sales, COUNT(*) orders
    FROM orders WHERE status='paid' AND created_at >= ? GROUP BY d ORDER BY d`,
    new Date(Date.now() - 13 * 864e5).toISOString());

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
  const fromD = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);
  const sales = all(`SELECT substr(created_at,1,10) d, COALESCE(SUM(total),0) sales, COALESCE(SUM(total-cost_total-tax),0) gross
    FROM orders WHERE status='paid' AND substr(created_at,1,10)>=? GROUP BY d`, fromD);
  const exp = all(`SELECT COALESCE(spent_at,substr(created_at,1,10)) d, COALESCE(SUM(amount),0) expenses
    FROM expenses WHERE COALESCE(spent_at,substr(created_at,1,10))>=? GROUP BY d`, fromD);
  const sMap = {}, eMap = {};
  sales.forEach(r => sMap[r.d] = r); exp.forEach(r => eMap[r.d] = r.expenses);
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - (days - 1 - i) * 864e5).toISOString().slice(0, 10);
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
  const id = run('INSERT INTO expenses(category_id,amount,note,spent_at,created_by,created_at) VALUES(?,?,?,?,?,?)',
    b.category_id || null, +b.amount, b.note || null, b.spent_at || nowISO().slice(0, 10), req.user.id, nowISO()).lastInsertRowid;
  res.json({ id });
});
app.delete('/api/expenses/:id', auth, admin, (req, res) => { run('DELETE FROM expenses WHERE id=?', req.params.id); res.json({ ok: true }); });

// ===================================================================
//  نقطة البيع (POS)
// ===================================================================
app.get('/api/pos/products', auth, (_q, res) => {
  res.json(all(`SELECT p.id,p.name_ar,p.price,p.cost,p.image,p.category_id,c.name_ar category,c.color,c.icon,p.track_stock
    FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.is_active=1 ORDER BY p.sort_order,p.id`));
});

function genInvoiceNo() {
  const year = nowISO().slice(0, 4);
  const n = get("SELECT COUNT(*) c FROM orders WHERE invoice_no LIKE ?", 'INV-' + year + '-%').c + 1;
  return `INV-${year}-${String(n).padStart(4, '0')}`;
}

function computeTotals(items, discount = 0) {
  let subtotal = 0, cost = 0;
  items.forEach(i => { subtotal += i.price * i.qty; cost += (i.cost || 0) * i.qty; });
  const taxable = Math.max(0, subtotal - discount);
  const tax = +(taxable * taxRate()).toFixed(2);
  const total = +(taxable + tax).toFixed(2);
  return { subtotal: +subtotal.toFixed(2), cost: +cost.toFixed(2), tax, total };
}

// إنشاء طلب (وقد يُدفع مباشرة)
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
  const tot = computeTotals(prepared, discount);
  const pay = b.status === 'paid';
  const t = nowISO();

  const out = tx(() => {
    const oid = run(`INSERT INTO orders(invoice_no,order_type,table_id,guests,waiter_id,status,subtotal,discount,tax,tip,total,cost_total,payment_method_id,paid_cash,change_due,cashier_id,note,created_at,paid_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      genInvoiceNo(), b.order_type || 'dine_in', b.table_id || null, b.guests || 1, b.waiter_id || null,
      pay ? 'paid' : (b.status === 'confirmed' ? 'confirmed' : 'open'),
      tot.subtotal, discount, tot.tax, +b.tip || 0, +(tot.total + (+b.tip || 0)).toFixed(2), tot.cost,
      pay ? (b.payment_method_id || null) : null, pay ? (+b.paid_cash || 0) : 0,
      pay ? +(((+b.paid_cash || 0) - tot.total) > 0 ? (+b.paid_cash - tot.total) : 0).toFixed(2) : 0,
      req.user.id, b.note || null, t, pay ? t : null).lastInsertRowid;
    prepared.forEach(p => run('INSERT INTO order_items(order_id,product_id,name_ar,qty,price,cost,note) VALUES(?,?,?,?,?,?,?)',
      oid, p.product_id, p.name_ar, p.qty, p.price, p.cost, p.note));
    if (pay) backflushOrder(oid);
    return oid;
  });
  logAudit(req.user.id, 'order', out, pay ? 'create_paid' : 'create');
  res.json(orderDetail(out));
});

const orderDetail = (id) => {
  const o = get(`SELECT o.*, t.name_ar table_name, pm.name_ar payment_name, pm.name_en payment_name_en, pm.kind payment_kind, pm.icon payment_icon,
    cu.full_name cashier_name, wu.full_name waiter_name FROM orders o
    LEFT JOIN tables t ON t.id=o.table_id LEFT JOIN payment_methods pm ON pm.id=o.payment_method_id
    LEFT JOIN users cu ON cu.id=o.cashier_id LEFT JOIN users wu ON wu.id=o.waiter_id WHERE o.id=?`, id);
  if (o) o.items = all('SELECT * FROM order_items WHERE order_id=? ORDER BY id', id);
  return o;
};

app.get('/api/orders', auth, (req, res) => {
  const f = [], p = [];
  if (req.query.status) { f.push(' AND o.status=?'); p.push(req.query.status); }
  if (req.query.type) { f.push(' AND o.order_type=?'); p.push(req.query.type); }
  if (req.query.date) { f.push(' AND substr(o.created_at,1,10)=?'); p.push(req.query.date); }
  // بحث ذكي: يتجاهل الشرطات/المسافات ويطابق رقم الفاتورة كاملاً أو جزء منه (مثال: "74" أو "0074" أو "INV-2026-0074")، وكذلك اسم الطاولة أو رقم الطلب
  if (req.query.q) {
    const raw = req.query.q.trim();
    const norm = raw.replace(/[\s-]/g, '').toUpperCase();
    f.push(` AND (UPPER(REPLACE(REPLACE(o.invoice_no,'-',''),' ','')) LIKE ? OR o.id=? OR t.name_ar LIKE ?)`);
    p.push('%' + norm + '%', +raw || 0, '%' + raw + '%');
  }
  res.json(all(`SELECT o.id,o.invoice_no,o.order_type,o.status,o.total,o.created_at,o.guests,
    t.name_ar table_name, pm.name_ar payment_name FROM orders o
    LEFT JOIN tables t ON t.id=o.table_id LEFT JOIN payment_methods pm ON pm.id=o.payment_method_id
    WHERE 1=1 ${f.join('')} ORDER BY o.id DESC LIMIT 200`, ...p));
});
app.get('/api/orders/:id', auth, (req, res) => {
  const o = orderDetail(req.params.id);
  if (!o) return res.status(404).json({ error: 'الطلب غير موجود' });
  res.json(o);
});

// دفع طلب مفتوح/مؤكد
app.post('/api/orders/:id/pay', auth, (req, res) => {
  const o = get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (!o) return res.status(404).json({ error: 'غير موجود' });
  if (o.status === 'paid') return res.status(400).json({ error: 'الطلب مدفوع بالفعل' });
  if (o.status === 'cancelled') return res.status(400).json({ error: 'الطلب ملغي' });
  const b = req.body || {};
  const t = nowISO();
  const change = +(((+b.paid_cash || 0) - o.total) > 0 ? (+b.paid_cash - o.total) : 0).toFixed(2);
  tx(() => {
    run(`UPDATE orders SET status='paid', payment_method_id=?, paid_cash=?, change_due=?, tip=?, total=?, cashier_id=?, paid_at=? WHERE id=?`,
      b.payment_method_id || null, +b.paid_cash || 0, change, +b.tip || 0,
      +(o.total - o.tip + (+b.tip || 0)).toFixed(2), req.user.id, t, o.id);
    backflushOrder(o.id);
  });
  logAudit(req.user.id, 'order', o.id, 'pay');
  res.json(orderDetail(o.id));
});

app.post('/api/orders/:id/cancel', auth, (req, res) => {
  const o = get('SELECT * FROM orders WHERE id=?', req.params.id);
  if (!o) return res.status(404).json({ error: 'غير موجود' });
  if (o.status === 'paid' && req.user.role_key !== 'admin') return res.status(400).json({ error: 'لا يمكن إلغاء طلب مدفوع — الأدمن فقط' });
  if (o.status === 'paid') restockOrder(o.id);   // أدمن يلغي فاتورة مدفوعة → إرجاع المخزون
  run("UPDATE orders SET status='cancelled', note=? WHERE id=?", (req.body?.reason || o.note), o.id);
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
    run('UPDATE orders SET subtotal=?,discount=?,tax=?,tip=?,total=?,cost_total=?,change_due=? WHERE id=?',
      tot.subtotal, discount, tot.tax, tip, total, tot.cost, change, o.id);
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
  const orders = all(`SELECT o.id,o.invoice_no,o.order_type,o.created_at,t.name_ar table_name
    FROM orders o LEFT JOIN tables t ON t.id=o.table_id
    WHERE o.status IN('open','confirmed','paid') ORDER BY o.id DESC LIMIT 60`);
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
  const id = run('INSERT INTO products(name_ar,category_id,price,image,track_stock,station,sort_order,created_at) VALUES(?,?,?,?,?,?,?,?)',
    b.name_ar, b.category_id || null, +b.price || 0, b.image || '🍽️', b.track_stock ?? 1, b.station === 'kitchen' ? 'kitchen' : 'bar', +b.sort_order || 0, nowISO()).lastInsertRowid;
  res.json({ id });
});
app.put('/api/products/:id', auth, admin, (req, res) => {
  const b = req.body || {}; const a = get('SELECT * FROM products WHERE id=?', req.params.id);
  if (!a) return res.status(404).json({ error: 'غير موجود' });
  run('UPDATE products SET name_ar=?,category_id=?,price=?,image=?,track_stock=?,station=?,is_active=?,sort_order=? WHERE id=?',
    b.name_ar ?? a.name_ar, b.category_id ?? a.category_id, b.price ?? a.price, b.image ?? a.image,
    b.track_stock ?? a.track_stock, b.station ?? a.station, b.is_active ?? a.is_active, b.sort_order ?? a.sort_order, a.id);
  res.json({ ok: true });
});
app.delete('/api/products/:id', auth, admin, (req, res) => {
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
  (SELECT COUNT(*) FROM purchase_items WHERE purchase_id=pu.id) lines FROM purchases pu
  LEFT JOIN suppliers s ON s.id=pu.supplier_id LEFT JOIN warehouses w ON w.id=pu.warehouse_id ORDER BY pu.id DESC LIMIT 100`)));

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
  const out = tx(() => {
    const pid = run(`INSERT INTO purchases(ref,supplier_id,warehouse_id,subtotal,tax,total,notes,created_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`, b.ref || null, b.supplier_id || null, b.warehouse_id || null,
      +subtotal.toFixed(2), tax, +(subtotal + tax).toFixed(2), b.notes || null, req.user.id, t).lastInsertRowid;
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
    COALESCE(SUM(tax),0) tax, COALESCE(SUM(discount),0) discount, COALESCE(SUM(total-tax-cost_total),0) profit
    FROM orders WHERE status='paid' AND created_at>=? AND created_at<=?`, from, to);
  const byDay = all(`SELECT substr(created_at,1,10) d, COALESCE(SUM(total),0) sales, COALESCE(SUM(total-tax-cost_total),0) profit, COUNT(*) orders
    FROM orders WHERE status='paid' AND created_at>=? AND created_at<=? GROUP BY d ORDER BY d`, from, to);
  const byProduct = all(`SELECT oi.name_ar, SUM(oi.qty) qty, SUM(oi.qty*oi.price) sales, SUM(oi.qty*oi.cost) cost,
    SUM(oi.qty*(oi.price-oi.cost)) margin FROM order_items oi JOIN orders o ON o.id=oi.order_id
    WHERE o.status='paid' AND o.created_at>=? AND o.created_at<=? GROUP BY oi.name_ar ORDER BY sales DESC`, from, to);
  const byType = all(`SELECT order_type, COUNT(*) cnt, COALESCE(SUM(total),0) total FROM orders
    WHERE status='paid' AND created_at>=? AND created_at<=? GROUP BY order_type`, from, to);
  res.json({ summary, byDay, byProduct, byType });
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
//  لوحة الإدارة — جداول ديناميكية (إضافة/تعديل أي بيانات)
// ===================================================================
const TABLES = {
  categories: ['name_ar', 'icon', 'color', 'is_active', 'sort_order'],
  tables: ['name_ar', 'seats', 'is_active', 'sort_order'],
  'payment-methods': ['name_ar', 'name_en', 'icon', 'kind', 'show_in_pos', 'is_active', 'sort_order'],
  units: ['name_ar', 'symbol', 'is_active'],
  warehouses: ['name_ar', 'kind', 'is_active', 'sort_order'],
  suppliers: ['name_ar', 'phone', 'notes', 'is_active'],
  'expense-categories': ['name_ar', 'icon', 'is_active', 'sort_order'],
};
const TBL = (k) => k === 'payment-methods' ? 'payment_methods' : k === 'expense-categories' ? 'expense_categories' : k;
const numCols = new Set(['seats', 'sort_order', 'is_active']);

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

// الإعدادات العامة
app.get('/api/settings', auth, admin, (_q, res) => res.json(settingsObj()));
app.put('/api/settings', auth, admin, (req, res) => {
  const up = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  Object.entries(req.body || {}).forEach(([k, v]) => up.run(k, String(v)));
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

// --- مؤقت: تحميل قاعدة البيانات (أدمن فقط) ---
app.get('/api/download-db', auth, admin, (_req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename=cafe_pos.db');
  res.setHeader('Content-Type', 'application/octet-stream');
  createReadStream(DB_PATH).pipe(res);
});

// ملفات ثابتة + SPA — بدون كاش طويل عشان أي تحديث يوصل فوراً بدون كاش قديم في المتصفح
app.use(express.static(join(__dirname, 'public'), { etag: true, lastModified: true, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.get('*', (_q, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(join(__dirname, 'public', 'index.html')); });
app.listen(PORT, () => console.log(`\n🌊 نظام كافيه على البحر يعمل على:  http://localhost:${PORT}\n`));
