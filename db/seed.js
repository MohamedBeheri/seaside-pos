// ===================================================================
//  بذر قاعدة البيانات — نظام كافيه على البحر
//  CLI:  npm run seed    |    npm run reset (يمسح ثم يبذر)
//  برمجياً: import { seed } from './db/seed.js'; seed();
// ===================================================================
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db, get, all, run, nowISO, DB_PATH } from './database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ===================================================================
//  ترحيل (Migration) — يضيف الأعمدة/الفهارس الجديدة لقاعدة موجودة بأمان
// ===================================================================
export function migrate() {
  const hasCol = (table, col) => all(`PRAGMA table_info(${table})`).some(c => c.name === col);
  const addCol = (table, col, ddl) => { if (!hasCol(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`); };

  // الطلبات: عميل + آجل/جزئي + وردية + نقاط
  addCol('orders', 'customer_id',     'INTEGER REFERENCES customers(id)');
  addCol('orders', 'paid_amount',     'REAL NOT NULL DEFAULT 0');       // المحصَّل فعلاً
  addCol('orders', 'payment_status',  "TEXT NOT NULL DEFAULT 'paid'"); // paid | partial | credit
  addCol('orders', 'shift_id',        'INTEGER REFERENCES shifts(id)');
  addCol('orders', 'points_earned',   'REAL NOT NULL DEFAULT 0');
  addCol('orders', 'points_used',     'REAL NOT NULL DEFAULT 0');
  addCol('orders', 'points_discount', 'REAL NOT NULL DEFAULT 0');

  // المشتريات: سداد جزئي/آجل + طريقة دفع
  addCol('purchases', 'paid_amount',       'REAL NOT NULL DEFAULT 0');
  addCol('purchases', 'payment_status',    "TEXT NOT NULL DEFAULT 'paid'");
  addCol('purchases', 'payment_method_id', 'INTEGER REFERENCES payment_methods(id)');

  // المنتجات: SKU وباركود
  addCol('products', 'sku',     'TEXT');
  addCol('products', 'barcode', 'TEXT');

  // طرق الدفع: رصيد افتتاحي + بيانات حساب
  addCol('payment_methods', 'opening_balance', 'REAL NOT NULL DEFAULT 0');
  addCol('payment_methods', 'account_no',   'TEXT');
  addCol('payment_methods', 'account_name', 'TEXT');

  // المصروفات: تُصرف من طريقة دفع (خزينة)
  addCol('expenses', 'method_id', 'INTEGER REFERENCES payment_methods(id)');

  // طلبات QR من الطاولات: رمز لكل طاولة + مصدر الطلب وبيانات الضيف
  addCol('tables', 'qr_token', 'TEXT');
  addCol('orders', 'source',   "TEXT NOT NULL DEFAULT 'pos'");   // pos | qr
  addCol('orders', 'qr_name',  'TEXT');                          // اسم الضيف (اختياري)
  addCol('orders', 'qr_phone', 'TEXT');
  addCol('orders', 'qr_address', 'TEXT');                        // عنوان التوصيل (طلبات أونلاين)
  addCol('orders', 'tax_detail', 'TEXT');                        // تفصيل الضرائب JSON وقت البيع

  // حساب العميل على المتجر: تأكيد الرقم بالـ OTP
  addCol('customers', 'phone_verified', 'INTEGER NOT NULL DEFAULT 0');
  // المنتجات: علامات العرض في المتجر (جديد/مميّز)
  addCol('products', 'is_new', 'INTEGER NOT NULL DEFAULT 0');
  addCol('products', 'is_featured', 'INTEGER NOT NULL DEFAULT 0');
  addCol('products', 'show_online', 'INTEGER NOT NULL DEFAULT 1');
  // التصنيفات: صورة الفئة + إظهارها في المتجر
  addCol('categories', 'image', 'TEXT');
  addCol('categories', 'show_online', 'INTEGER NOT NULL DEFAULT 1');

  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)');

  // القيم القديمة: الفواتير المدفوعة سابقاً تعتبر محصلة بالكامل
  run("UPDATE orders SET paid_amount=total WHERE status='paid' AND paid_amount=0 AND payment_status='paid'");
  run('UPDATE purchases SET paid_amount=total WHERE paid_amount=0 AND payment_status=\'paid\'');

  // SKU وباركود تلقائيان للمنتجات القديمة
  all('SELECT id FROM products WHERE sku IS NULL OR barcode IS NULL').forEach(p => {
    run('UPDATE products SET sku=COALESCE(sku,?), barcode=COALESCE(barcode,?) WHERE id=?',
      'PRD-' + String(p.id).padStart(6, '0'), String(2000000000000 + p.id), p.id);
  });

  // رمز QR فريد لكل طاولة قديمة بدون رمز
  all('SELECT id FROM tables WHERE qr_token IS NULL').forEach(tb => {
    run('UPDATE tables SET qr_token=? WHERE id=?', randomUUID().replace(/-/g, '').slice(0, 20), tb.id);
  });

  // الضرائب: ترحيل نسبة tax_rate القديمة إلى جدول الضرائب المتعدد (مرة واحدة)
  if (get('SELECT COUNT(*) c FROM taxes').c === 0) {
    const oldRate = +(get("SELECT value FROM settings WHERE key='tax_rate'")?.value || 0);
    run('INSERT INTO taxes(name_ar,name_en,rate,is_active,show_on_receipt,sort_order) VALUES(?,?,?,?,?,?)',
      'ضريبة القيمة المضافة', 'VAT', oldRate > 0 ? oldRate : 14, oldRate > 0 ? 1 : 0, 1, 0);
    run('INSERT INTO taxes(name_ar,name_en,rate,is_active,show_on_receipt,sort_order) VALUES(?,?,?,?,?,?)',
      'ضريبة الخدمة', 'Service', 12, 0, 1, 1);
  }

  // إعدادات افتراضية جديدة (لا تمس الموجود)
  const defs = {
    points_enabled: '0',          // تفعيل نظام النقاط
    points_per_currency: '1',     // نقاط لكل 1 وحدة عملة مدفوعة
    point_value: '0.10',          // قيمة النقطة بالعملة عند الاستبدال
    points_min_redeem: '10',      // أقل نقاط يمكن استبدالها
    points_max_discount_pct: '50', // أقصى نسبة خصم بالنقاط من الفاتورة
    receipt_size: '80mm',         // 80mm | A4
    barcode_w_mm: '38', barcode_h_mm: '25', barcode_per_row: '2',
    shift_require: '1',           // إلزام الكاشير بفتح وردية قبل البيع
    theme_preset: 'seaside',      // seaside | berry | ocean | forest | royal | sunset
    theme_glass: '0',             // الوضع الشفاف (زجاجي)
    online_ordering: '1',         // تفعيل الطلب أونلاين (دليفري) من موقع العميل
    delivery_fee: '20',           // مصاريف التوصيل الافتراضية
    shop_require_login: '1',      // إلزام العميل بتسجيل الدخول (تأكيد الرقم) قبل الطلب
    wa_country: '20',             // كود الدولة للواتساب (مصر)
    shop_hero_title: 'أطلب دلوقتي أونلاين',
    shop_hero_sub: 'أشهى المنتجات توصلك لحد باب البيت',
  };
  const ins = db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
  Object.entries(defs).forEach(([k, v]) => ins.run(k, v));
}

// يبني الـ Schema (idempotent) ويعبّئ البيانات الأولية مرة واحدة.
export function seed({ verbose = false } = {}) {
  db.exec(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));
  if (get('SELECT COUNT(*) c FROM users').c > 0) return false;

  const t = nowISO();
  const hash = (p) => bcrypt.hashSync(p, 10);
  db.exec('BEGIN');
  try {
    // ---------- الأدوار (٤ مستويات) والمستخدمون ----------
    const roles = [
      ['admin', 'أدمن / مدير'], ['cashier', 'كاشير'], ['kitchen', 'مطبخ'], ['bar', 'بار'],
    ];
    const rId = {};
    const insRole = db.prepare('INSERT INTO roles(key,name_ar) VALUES(?,?)');
    roles.forEach(r => rId[r[0]] = insRole.run(r[0], r[1]).lastInsertRowid);

    const insU = db.prepare('INSERT INTO users(full_name,email,password_hash,role_id,pin,is_active,created_at) VALUES(?,?,?,?,?,1,?)');
    const uManager = insU.run('مدير الكافيه', 'admin@seaside.com', hash('admin123'), rId.admin, '9999', t).lastInsertRowid;
    const uCashier = insU.run('كاشير الوردية', 'cashier@seaside.com', hash('pass123'), rId.cashier, '1234', t).lastInsertRowid;
    insU.run('شيف المطبخ', 'kitchen@seaside.com', hash('pass123'), rId.kitchen, '2222', t);
    insU.run('باريستا البار', 'bar@seaside.com', hash('pass123'), rId.bar, '3333', t);

    // ---------- المخازن ----------
    const insW = db.prepare('INSERT INTO warehouses(name_ar,kind,sort_order) VALUES(?,?,?)');
    const wMain = insW.run('المخزن الرئيسي', 'main', 0).lastInsertRowid;
    const wKitchen = insW.run('مخزن المطبخ', 'kitchen', 1).lastInsertRowid;
    const wBar = insW.run('بار المشروبات', 'bar', 2).lastInsertRowid;

    // ---------- الوحدات ----------
    const insUnit = db.prepare('INSERT INTO units(name_ar,symbol) VALUES(?,?)');
    const u = {};
    [['جرام', 'ج'], ['مليلتر', 'مل'], ['حبة', 'حبة'], ['شريحة', 'شريحة'], ['كوب', 'كوب'],
     ['كيلو', 'كجم'], ['لتر', 'لتر'], ['كرتونة', 'كرتونة'], ['صندوق', 'صندوق']]
      .forEach(x => u[x[0]] = insUnit.run(x[0], x[1]).lastInsertRowid);

    // ---------- المواد الخام ----------
    const insM = db.prepare('INSERT INTO raw_materials(code,name_ar,unit_id,warehouse_id,qty,avg_cost,reorder_point,purchase_unit_id,purchase_factor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)');
    const M = {};
    // [مفتاح, اسم, وحدة, مخزن, رصيد, تكلفة الوحدة الصغرى, حد الطلب, (وحدة الشراء), (معامل التحويل)]
    const PURCH = { bun: ['كيلو', 1000], milk: ['لتر', 1000], choco: ['لتر', 1000], cup: ['كرتونة', 1000], lid: ['كرتونة', 1000], flour: ['كيلو', 1000], sugar: ['كيلو', 1000] };
    const mats = [
      ['bun', 'بن مطحون', 'جرام', wBar, 5000, 0.30, 1000],
      ['milk', 'حليب كامل الدسم', 'مليلتر', wBar, 20000, 0.014, 5000],
      ['choco', 'صوص شوكولاتة', 'مليلتر', wBar, 600, 0.05, 800],
      ['caramel', 'صوص كراميل', 'مليلتر', wBar, 3000, 0.06, 700],
      ['vanilla', 'صوص فانيليا', 'مليلتر', wBar, 3000, 0.06, 700],
      ['hazelnut', 'صوص بندق', 'مليلتر', wBar, 3000, 0.06, 700],
      ['lotus', 'صوص لوتس', 'مليلتر', wBar, 2500, 0.08, 600],
      ['pistachio', 'صوص فستق', 'مليلتر', wBar, 2000, 0.09, 600],
      ['ice', 'ثلج', 'جرام', wBar, 30000, 0.002, 4000],
      ['sugar', 'سكر', 'جرام', wBar, 10000, 0.02, 2000],
      ['water', 'مياه نقية', 'مليلتر', wBar, 50000, 0.003, 8000],
      ['cup', 'كوب ورقي', 'حبة', wBar, 800, 1.20, 150],
      ['lid', 'غطاء كوب', 'حبة', wBar, 800, 0.40, 150],
      ['teabag', 'فلتر شاي', 'حبة', wBar, 500, 0.50, 100],
      ['lemon', 'ليمون', 'حبة', wBar, 200, 1.50, 40],
      ['mint', 'نعناع', 'جرام', wBar, 1000, 0.08, 200],
      ['mango', 'مانجو', 'جرام', wBar, 6000, 0.06, 1500],
      ['straw', 'فراولة', 'جرام', wBar, 5000, 0.07, 1200],
      ['redbull', 'ريد بُل (علبة)', 'حبة', wBar, 200, 18, 40],
      ['pepsi', 'بيبسي (علبة)', 'حبة', wBar, 300, 7, 60],
      ['waterbottle', 'مياه (زجاجة)', 'حبة', wBar, 400, 4, 80],
      ['flour', 'دقيق', 'جرام', wKitchen, 15000, 0.018, 3000],
      ['mozz', 'جبن موتزاريلا', 'جرام', wKitchen, 6000, 0.12, 1500],
      ['sauce', 'صلصة بيتزا', 'جرام', wKitchen, 4000, 0.04, 800],
      ['box', 'علبة كرتون', 'حبة', wMain, 500, 1.50, 100],
    ];
    mats.forEach(m => { const pu = PURCH[m[0]]; M[m[0]] = insM.run('RM-' + m[0].toUpperCase(), m[1], u[m[2]], m[3], m[4], m[5], m[6], pu ? u[pu[0]] : u[m[2]], pu ? pu[1] : 1, t).lastInsertRowid; });

    // ---------- التصنيفات (من قائمة seaside الحقيقية) ----------
    const insC = db.prepare('INSERT INTO categories(name_ar,icon,color,sort_order) VALUES(?,?,?,?)');
    const C = {}; const catIcon = {};
    [['تركى', '☕', '#A9744F'], ['كابتشينو', '☕', '#B07B52'], ['لاتيه', '🥛', '#C89B6F'],
     ['موكا', '☕', '#8B5E3C'], ['شوكولاتة ساخنة', '🍫', '#7B4B2A'], ['Iced Chocolate', '🧊', '#5AA9C4'],
     ['قهوة مثلجة', '🧊', '#0EA5C4'], ['فرابوتشينو اسبريسو', '🥤', '#3FB8AF'], ['ميلك بليند', '🥛', '#9AC8D8'],
     ['شاى', '🍵', '#2E8B57'], ['موخيتو', '🍹', '#19B36B'], ['مشروبات غازية', '🥤', '#E0564B'],
     ['عصير طبيعى', '🍹', '#F2A65A'], ['حلويات', '🍰', '#E89AC7']]
      .forEach((c, i) => { C[c[0]] = insC.run(c[0], c[1], c[2], i).lastInsertRowid; catIcon[c[0]] = c[1]; });

    // ---------- الأصناف الحقيقية (87 صنف) + وصفات نموذجية مربوطة بالمخزون ----------
    const insP = db.prepare('INSERT INTO products(name_ar,category_id,price,image,track_stock,station,sort_order,created_at) VALUES(?,?,?,?,?,?,?,?)');
    const insR = db.prepare('INSERT INTO product_recipes(product_id,material_id,qty) VALUES(?,?,?)');
    const ICON = { 'Pepsi': '🥤', 'Water': '💧', 'Red Bull': '⚡', 'Red Bull Coconut': '⚡', 'Red Bull Peach': '⚡', 'Red Bull Watermelon': '⚡', 'بيتزا': '🍕', 'Mango': '🥭', 'Strawberry': '🍓', 'Orange': '🍊', 'Guava': '🫐' };
    // وصفات نموذجية (يبني الباقي المستخدم من محرر الوصفة)
    const RECIPES = {
      'Espresso': [['bun', 18], ['cup', 1], ['lid', 1]],
      'Espresso Macchiato': [['bun', 18], ['milk', 50], ['cup', 1], ['lid', 1]],
      'Cappuccino (M)': [['bun', 18], ['milk', 150], ['cup', 1], ['lid', 1]],
      'Cappuccino (S)': [['bun', 18], ['milk', 120], ['cup', 1], ['lid', 1]],
      'Americano (M)': [['bun', 18], ['water', 150], ['cup', 1], ['lid', 1]],
      'Americano (S)': [['bun', 18], ['water', 120], ['cup', 1], ['lid', 1]],
      'Cafe Latte (M)': [['bun', 18], ['milk', 200], ['cup', 1], ['lid', 1]],
      'CafeLatte (S)': [['bun', 18], ['milk', 150], ['cup', 1], ['lid', 1]],
      'Caramel Latte (M)': [['bun', 18], ['milk', 200], ['caramel', 20], ['cup', 1], ['lid', 1]],
      'Vanilla Latte (M)': [['bun', 18], ['milk', 200], ['vanilla', 20], ['cup', 1], ['lid', 1]],
      'Hazelnut Latte (M)': [['bun', 18], ['milk', 200], ['hazelnut', 20], ['cup', 1], ['lid', 1]],
      'Lotus Latte  (M)': [['bun', 18], ['milk', 200], ['lotus', 20], ['cup', 1], ['lid', 1]],
      'Cafe Mocha (M)': [['bun', 18], ['milk', 180], ['choco', 30], ['cup', 1], ['lid', 1]],
      'Hot Chocolate (M)': [['milk', 200], ['choco', 40], ['cup', 1], ['lid', 1]],
      'Hot Chocolate (S)': [['milk', 150], ['choco', 30], ['cup', 1], ['lid', 1]],
      'Ice-Latte (M)': [['bun', 18], ['milk', 150], ['ice', 120], ['cup', 1], ['lid', 1]],
      'Ice Mocha (M)': [['bun', 18], ['milk', 150], ['choco', 30], ['ice', 120], ['cup', 1], ['lid', 1]],
      'Ice-Americano (M)': [['bun', 18], ['water', 120], ['ice', 120], ['cup', 1], ['lid', 1]],
      'Ice-Chocolate (M)': [['milk', 150], ['choco', 40], ['ice', 120], ['cup', 1], ['lid', 1]],
      'ICED PISTACHIO LATTE (M)': [['bun', 18], ['milk', 180], ['pistachio', 20], ['ice', 120], ['cup', 1], ['lid', 1]],
      'Black Tea': [['teabag', 1], ['water', 200], ['cup', 1], ['lid', 1]],
      'Green Tea': [['teabag', 1], ['water', 200], ['cup', 1], ['lid', 1]],
      'Classic Mojitio': [['lemon', 1], ['mint', 8], ['sugar', 25], ['water', 200], ['ice', 100], ['cup', 1], ['lid', 1]],
      'Mango': [['mango', 200], ['sugar', 15], ['water', 80], ['ice', 60], ['cup', 1], ['lid', 1]],
      'Strawberry': [['straw', 200], ['sugar', 15], ['water', 80], ['ice', 60], ['cup', 1], ['lid', 1]],
      'Red Bull': [['redbull', 1], ['cup', 1]],
      'Pepsi': [['pepsi', 1]],
      'Water': [['waterbottle', 1]],
      'بيتزا': [['flour', 200], ['mozz', 80], ['sauce', 50], ['box', 1]],
    };
    const MENU = [
      ['بيتزا', 'حلويات', 0],
      ['French Coffe.', 'تركى', 60], ['Turkish Coffee (M)', 'تركى', 50], ['Turkish Coffee (S)', 'تركى', 45],
      ['Turkish coffee  herbs(s)', 'تركى', 50], ['Turkish coffee  herbs(M)', 'تركى', 55],
      ['Americano (M)', 'كابتشينو', 75], ['Americano (S)', 'كابتشينو', 65], ['Cappuccino (M)', 'كابتشينو', 100],
      ['Cappuccino (S)', 'كابتشينو', 90], ['Cortado', 'كابتشينو', 75], ['Espresso Macchiato', 'كابتشينو', 65],
      ['Espresso', 'كابتشينو', 65], ['Flat White', 'كابتشينو', 90],
      ['Cafe Latte (M)', 'لاتيه', 100], ['CafeLatte (S)', 'لاتيه', 90], ['Caramel Latte (M)', 'لاتيه', 130],
      ['Caramel Latte (S)', 'لاتيه', 120], ['Caramel Macchito (M)', 'لاتيه', 130], ['Caramel Macchito (S)', 'لاتيه', 120],
      ['Hazelnut Latte (M)', 'لاتيه', 130], ['Hazelnut Latte (S)', 'لاتيه', 120], ['Lotus Latte  (M)', 'لاتيه', 130],
      ['Lotus Latte (S)', 'لاتيه', 120], ['Vanilla Latte (M)', 'لاتيه', 130], ['Vanilla Latte (S)', 'لاتيه', 120],
      ['Ice-Chocolate (M)', 'Iced Chocolate', 120], ['Ice-Chocolate (S)', 'Iced Chocolate', 110],
      ['Ice-White chocolate  (S)', 'Iced Chocolate', 120], ['Ice-White chocolate (M)', 'Iced Chocolate', 110],
      ['Hot Chocolate (M)', 'شوكولاتة ساخنة', 120], ['Hot Chocolate (S)', 'شوكولاتة ساخنة', 110],
      ['White hot chocolate (M)', 'شوكولاتة ساخنة', 120], ['White hot chocolate (S)', 'شوكولاتة ساخنة', 110],
      ['Cafe Mocha (M)', 'موكا', 130], ['Cafe Mocha (S)', 'موكا', 120], ['White Mocha (M)', 'موكا', 130], ['White Mocha (S)', 'موكا', 120],
      ['Black Tea', 'شاى', 35], ['Earl Grey', 'شاى', 60], ['Green Tea', 'شاى', 40], ['Milk Tea', 'شاى', 50],
      ['Classic Mojitio', 'موخيتو', 85], ['Pineapple Mojitio', 'موخيتو', 95], ['Strawberry Mojitio', 'موخيتو', 95],
      ['Caramel frappe (M)', 'فرابوتشينو اسبريسو', 130], ['Caramel frappe (S)', 'فرابوتشينو اسبريسو', 120],
      ['Coffee frappe (M)', 'فرابوتشينو اسبريسو', 130], ['Coffee frappe (S)', 'فرابوتشينو اسبريسو', 120],
      ['Mocha frappe (M)', 'فرابوتشينو اسبريسو', 130], ['Mocha frappe (S)', 'فرابوتشينو اسبريسو', 120],
      ['White Mocha frappe (M)', 'فرابوتشينو اسبريسو', 130], ['White Mocha frappe (S)', 'فرابوتشينو اسبريسو', 120],
      ['frappe Vanilla (M)', 'فرابوتشينو اسبريسو', 130], ['frappe Vanilla (S)', 'فرابوتشينو اسبريسو', 120],
      ['Caramel Milk Blend (M)', 'ميلك بليند', 140], ['Caramel Milk Blend (S)', 'ميلك بليند', 130],
      ['Chocolate Milk Blend (M)', 'ميلك بليند', 140], ['Chocolate Milk Blend (S)', 'ميلك بليند', 130],
      ['Ice Mocha (M)', 'قهوة مثلجة', 130], ['Ice Mocha (S)', 'قهوة مثلجة', 120], ['Ice White Mocha (M)', 'قهوة مثلجة', 130],
      ['Ice White Mocha (S)', 'قهوة مثلجة', 120], ['Ice-Americano (M)', 'قهوة مثلجة', 100], ['Ice-Americano (S)', 'قهوة مثلجة', 90],
      ['Ice-Caramel Latte (M)', 'قهوة مثلجة', 130], ['Ice-Caramel Latte (S)', 'قهوة مثلجة', 120],
      ['Ice-Caramel Macchito (M)', 'قهوة مثلجة', 130], ['Ice-Caramel Macchito (S)', 'قهوة مثلجة', 120],
      ['Ice-Hazelnut Latte (M)', 'قهوة مثلجة', 130], ['Ice-Hazelnut Latte (S)', 'قهوة مثلجة', 120],
      ['Ice-Latte (M)', 'قهوة مثلجة', 120], ['Ice-Latte (S)', 'قهوة مثلجة', 130],
      ['Ice-Vanilla Latte (M)', 'قهوة مثلجة', 130], ['Ice-Vanilla Latte (S)', 'قهوة مثلجة', 120],
      ['ICED PISTACHIO LATTE (S)', 'قهوة مثلجة', 120], ['ICED PISTACHIO LATTE (M)', 'قهوة مثلجة', 130],
      ['Red Bull', 'مشروبات غازية', 80], ['Red Bull Coconut', 'مشروبات غازية', 80], ['Red Bull Peach', 'مشروبات غازية', 80],
      ['Red Bull Watermelon', 'مشروبات غازية', 80], ['Pepsi', 'مشروبات غازية', 35], ['Water', 'مشروبات غازية', 25],
      ['Guava', 'عصير طبيعى', 60], ['Strawberry', 'عصير طبيعى', 70], ['Orange', 'عصير طبيعى', 55], ['Mango', 'عصير طبيعى', 70],
    ];
    let pSort = 0;
    const updCost = db.prepare('UPDATE products SET cost=? WHERE id=?');
    const KITCHEN_CATS = ['حلويات'];   // الأكل → المطبخ، باقي المشروبات → البار
    MENU.forEach(([name, cat, price]) => {
      const icon = ICON[name] || catIcon[cat] || '☕';
      const station = KITCHEN_CATS.includes(cat) ? 'kitchen' : 'bar';
      const pid = insP.run(name, C[cat], price, icon, 1, station, pSort++, t).lastInsertRowid;
      const recipe = RECIPES[name];
      if (recipe) {
        let cost = 0;
        recipe.forEach(([k, q]) => { insR.run(pid, M[k], q); cost += (mats.find(mm => mm[0] === k)[5]) * q; });
        updCost.run(+cost.toFixed(3), pid);
      }
    });

    // ---------- فئات المصروفات + أمثلة ----------
    const insEC = db.prepare('INSERT INTO expense_categories(name_ar,icon,sort_order) VALUES(?,?,?)');
    const ecId = {};
    [['إيجار', '🏠'], ['كهرباء', '⚡'], ['مياه', '💧'], ['رواتب', '👥'], ['صيانة', '🔧'], ['تسويق', '📣'], ['نثرية', '🧾']]
      .forEach((c, i) => ecId[c[0]] = insEC.run(c[0], c[1], i).lastInsertRowid);
    const insEx = db.prepare('INSERT INTO expenses(category_id,amount,note,spent_at,created_by,created_at) VALUES(?,?,?,?,?,?)');
    const today = new Date().toISOString().slice(0, 10);
    insEx.run(ecId['كهرباء'], 1200, 'فاتورة كهرباء الشهر', today, uManager, t);
    insEx.run(ecId['إيجار'], 8000, 'إيجار المحل', today, uManager, t);
    insEx.run(ecId['نثرية'], 350, 'مستلزمات نظافة', today, uManager, t);

    // ---------- الموردون ----------
    const insSup = db.prepare('INSERT INTO suppliers(name_ar,phone,notes) VALUES(?,?,?)');
    insSup.run('شركة البن الذهبي', '01000000001', 'بن وقهوة');
    insSup.run('ألبان الوادي', '01000000002', 'حليب ومنتجات ألبان');
    insSup.run('سوبر ماركت الجملة', '01000000003', 'مستلزمات متنوعة');

    // ---------- طرق الدفع (نقدي + انستاباي) ----------
    const insPM = db.prepare('INSERT INTO payment_methods(name_ar,name_en,icon,kind,show_in_pos,sort_order) VALUES(?,?,?,?,?,?)');
    const pmCash = insPM.run('نقدي', 'Cash', '💵', 'cash', 1, 0).lastInsertRowid;
    insPM.run('انستاباي', 'InstaPay', '📱', 'transfer', 1, 1);

    // ---------- الطاولات ----------
    const insT = db.prepare('INSERT INTO tables(name_ar,seats,sort_order) VALUES(?,?,?)');
    const T = [];
    for (let i = 1; i <= 4; i++) T.push(insT.run('تراس بحري ' + i, 4, i).lastInsertRowid);
    for (let i = 1; i <= 6; i++) T.push(insT.run('داخلي ' + i, 4, 10 + i).lastInsertRowid);

    // ---------- الإعدادات ----------
    const insSet = db.prepare('INSERT INTO settings(key,value) VALUES(?,?)');
    const settings = {
      cafe_name: 'seaside', tagline: 'AMOUN BEACH', currency: 'EGP',
      tax_rate: '0', service_charge: '0', address: '', phone: '1008308391',
      receipt_footer: 'Thank you for your visit! — شكراً لزيارتك',
      // عناصر الفاتورة الديناميكية (1=يظهر) — التوكن والهاتف مخفيان كما هو مطلوب
      receipt_fields: JSON.stringify({
        logo: 1, tagline: 1, address: 0, phone: 0, datetime: 1, order_no: 1,
        token: 0, order_type: 1, table: 1, cashier: 1, waiter: 0, qr: 0, footer: 1, ref: 1,
      }),
      receipt_extra_lines: '',   // أسطر إضافية يحددها المستخدم (سطر لكل عنصر)
    };
    Object.entries(settings).forEach(([k, v]) => insSet.run(k, v));

    // ---------- طلبات تاريخية مبدئية (لإظهار لوحة المعلومات) ----------
    const prods = db.prepare('SELECT id,name_ar,price,cost FROM products').all();
    const taxRate = 0;
    const insO = db.prepare(`INSERT INTO orders(invoice_no,order_type,table_id,guests,waiter_id,status,subtotal,discount,tax,tip,total,cost_total,payment_method_id,paid_cash,change_due,cashier_id,created_at,paid_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insOI = db.prepare('INSERT INTO order_items(order_id,product_id,name_ar,qty,price,cost,kds_status) VALUES(?,?,?,?,?,?,?)');
    let invSeq = 0;
    const types = ['dine_in', 'takeaway', 'delivery'];
    for (let d = 6; d >= 0; d--) {
      const orders = 8 + (d % 4);            // عدد طلبات اليوم
      for (let n = 0; n < orders; n++) {
        const day = new Date(); day.setDate(day.getDate() - d);
        day.setHours(10 + (n % 11), (n * 13) % 60, 0, 0);
        const iso = day.toISOString();
        const lines = 1 + ((n + d) % 3);
        let subtotal = 0, costTotal = 0;
        const picks = [];
        for (let l = 0; l < lines; l++) {
          const p = prods[(n * 3 + l * 5 + d) % prods.length];
          const qty = 1 + (l % 2);
          subtotal += p.price * qty; costTotal += p.cost * qty;
          picks.push([p, qty]);
        }
        const tax = +(subtotal * taxRate).toFixed(2);
        const total = +(subtotal + tax).toFixed(2);
        invSeq++;
        const oid = insO.run('INV-2026-' + String(invSeq).padStart(4, '0'), types[n % 3],
          n % 2 ? T[n % T.length] : null, 1 + (n % 4), null, 'paid',
          +subtotal.toFixed(2), 0, tax, 0, total, +costTotal.toFixed(2),
          pmCash, total, 0, uCashier, iso, iso).lastInsertRowid;
        picks.forEach(([p, qty]) => insOI.run(oid, p.id, p.name_ar, qty, p.price, p.cost, 'served'));
      }
    }

    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }

  if (verbose) console.log('🌱 تم بذر بيانات الكافيه بنجاح.');
  return true;
}

// ---------- تشغيل من سطر الأوامر ----------
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  if (process.argv.includes('--reset')) {
    ['', '-shm', '-wal'].forEach(s => { try { if (existsSync(DB_PATH + s)) rmSync(DB_PATH + s); } catch {} });
    console.log('🗑️  تم حذف قاعدة البيانات القديمة.');
    process.exit(0);
  }
  const did = seed({ verbose: true });
  console.log(did ? '✅ اكتمل البذر.' : 'ℹ️ القاعدة مبذورة بالفعل — لا تغيير.');
}
