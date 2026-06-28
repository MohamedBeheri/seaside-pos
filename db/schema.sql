-- ===================================================================
--  مخطط قاعدة بيانات نظام نقاط البيع وإدارة المخازن — كافيه على البحر
--  كل شيء ديناميكي: التصنيفات، الأصناف، المكونات، المخازن، الموردون، الإعدادات
-- ===================================================================

-- ---------- الأدوار والمستخدمون ----------
CREATE TABLE IF NOT EXISTS roles (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  key       TEXT UNIQUE NOT NULL,         -- manager | branch_manager | cashier | waiter | chef
  name_ar   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name     TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role_id       INTEGER NOT NULL REFERENCES roles(id),
  pin           TEXT,                       -- رقم سري سريع للكاشير (اختياري)
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- ---------- المخازن (متعددة: مركزي/مطبخ/بار) ----------
CREATE TABLE IF NOT EXISTS warehouses (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar   TEXT NOT NULL,
  kind      TEXT NOT NULL DEFAULT 'sub',   -- main | kitchen | bar | sub
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ---------- وحدات القياس (ديناميكية: جرام/مليلتر/حبة/كوب...) ----------
CREATE TABLE IF NOT EXISTS units (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar  TEXT NOT NULL,                  -- جرام
  symbol   TEXT NOT NULL,                  -- ج
  is_active INTEGER NOT NULL DEFAULT 1
);

-- ---------- المواد الخام (بالوحدة الصغرى) ----------
CREATE TABLE IF NOT EXISTS raw_materials (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT UNIQUE,
  name_ar       TEXT NOT NULL,
  unit_id       INTEGER REFERENCES units(id),
  warehouse_id  INTEGER REFERENCES warehouses(id),  -- المخزن الافتراضي للمادة
  qty           REAL NOT NULL DEFAULT 0,    -- الرصيد الدفتري الحالي بالوحدة الصغرى
  avg_cost      REAL NOT NULL DEFAULT 0,    -- متوسط التكلفة المتحرك للوحدة الصغرى
  reorder_point REAL NOT NULL DEFAULT 0,    -- حد إعادة الطلب
  purchase_unit_id INTEGER REFERENCES units(id),  -- وحدة الشراء (كرتونة/كيلو/صندوق)
  purchase_factor  REAL NOT NULL DEFAULT 1,       -- كم وحدة صغرى داخل وحدة الشراء الواحدة
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

-- ---------- تصنيفات المنيو (ديناميكية) ----------
CREATE TABLE IF NOT EXISTS categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar   TEXT NOT NULL,
  icon      TEXT DEFAULT '🍽️',
  color     TEXT DEFAULT '#0FB5BA',
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ---------- الأصناف (منتجات المنيو) ----------
CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar       TEXT NOT NULL,
  category_id   INTEGER REFERENCES categories(id),
  price         REAL NOT NULL DEFAULT 0,    -- سعر البيع
  cost          REAL NOT NULL DEFAULT 0,    -- تكلفة المكونات (تُحسب من الوصفة)
  image         TEXT,                       -- إيموجي أو رابط صورة
  color         TEXT DEFAULT '#0FB5BA',
  is_active     INTEGER NOT NULL DEFAULT 1,
  track_stock   INTEGER NOT NULL DEFAULT 1, -- هل يُخصم من المخزن عند البيع؟
  station       TEXT NOT NULL DEFAULT 'bar', -- محطة التحضير: kitchen | bar
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

-- ---------- الوصفة / قائمة المكونات (BOM) ----------
CREATE TABLE IF NOT EXISTS product_recipes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES raw_materials(id),
  qty         REAL NOT NULL DEFAULT 0       -- الكمية المستهلكة بالوحدة الصغرى
);

-- ---------- الموردون ----------
CREATE TABLE IF NOT EXISTS suppliers (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar   TEXT NOT NULL,
  phone     TEXT,
  notes     TEXT,
  is_active INTEGER NOT NULL DEFAULT 1
);

-- ---------- المشتريات (فواتير الموردين) ----------
CREATE TABLE IF NOT EXISTS purchases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ref         TEXT,                          -- رقم الفاتورة
  supplier_id INTEGER REFERENCES suppliers(id),
  warehouse_id INTEGER REFERENCES warehouses(id),
  subtotal    REAL NOT NULL DEFAULT 0,
  tax         REAL NOT NULL DEFAULT 0,
  total       REAL NOT NULL DEFAULT 0,
  notes       TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES raw_materials(id),
  qty         REAL NOT NULL,                 -- الكمية الواردة بالوحدة الصغرى
  unit_cost   REAL NOT NULL                  -- تكلفة الوحدة الصغرى في هذه الفاتورة
);

-- ---------- حركة المخزن (دفتر الأستاذ للمخزون) ----------
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES raw_materials(id),
  warehouse_id INTEGER REFERENCES warehouses(id),
  type        TEXT NOT NULL,                 -- purchase | sale | waste | adjust | count
  qty         REAL NOT NULL,                 -- موجب=وارد، سالب=منصرف
  unit_cost   REAL NOT NULL DEFAULT 0,
  balance     REAL NOT NULL DEFAULT 0,       -- الرصيد بعد الحركة
  ref_type    TEXT,                          -- order | purchase | waste | count
  ref_id      INTEGER,
  note        TEXT,
  created_at  TEXT NOT NULL
);

-- ---------- التوالف والهدر ----------
CREATE TABLE IF NOT EXISTS waste_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES raw_materials(id),
  warehouse_id INTEGER REFERENCES warehouses(id),
  qty         REAL NOT NULL,
  cost        REAL NOT NULL DEFAULT 0,       -- التكلفة المهدرة
  reason      TEXT,                          -- انتهاء صلاحية | خطأ تحضير | كسر ...
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL
);

-- ---------- الطاولات ----------
CREATE TABLE IF NOT EXISTS tables (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar   TEXT NOT NULL,                   -- طاولة 1 / تراس بحري 3
  seats     INTEGER NOT NULL DEFAULT 4,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ---------- طرق الدفع (ديناميكية) ----------
CREATE TABLE IF NOT EXISTS payment_methods (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar   TEXT NOT NULL,                   -- نقدي | انستاباي | فيزا ...
  name_en   TEXT,                            -- اسم إنجليزي للفاتورة
  icon      TEXT DEFAULT '💵',
  kind      TEXT NOT NULL DEFAULT 'cash',    -- cash (يحسب الباقي) | transfer (تحويل/أونلاين)
  show_in_pos INTEGER NOT NULL DEFAULT 1,    -- يظهر في شاشة الدفع؟
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ---------- الطلبات / الفواتير ----------
CREATE TABLE IF NOT EXISTS orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no    TEXT,                          -- INV-2026-0001
  order_type    TEXT NOT NULL DEFAULT 'dine_in', -- dine_in | takeaway | delivery
  table_id      INTEGER REFERENCES tables(id),
  guests        INTEGER DEFAULT 1,
  waiter_id     INTEGER REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'open',  -- open | confirmed | paid | cancelled
  subtotal      REAL NOT NULL DEFAULT 0,
  discount      REAL NOT NULL DEFAULT 0,
  tax           REAL NOT NULL DEFAULT 0,
  tip           REAL NOT NULL DEFAULT 0,
  total         REAL NOT NULL DEFAULT 0,
  cost_total    REAL NOT NULL DEFAULT 0,       -- إجمالي تكلفة المكونات (للربح)
  payment_method_id INTEGER REFERENCES payment_methods(id),
  paid_cash     REAL DEFAULT 0,
  change_due    REAL DEFAULT 0,
  cashier_id    INTEGER REFERENCES users(id),
  note          TEXT,
  created_at    TEXT NOT NULL,
  paid_at       TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  INTEGER REFERENCES products(id),
  name_ar     TEXT NOT NULL,                  -- نسخة الاسم وقت البيع
  qty         REAL NOT NULL DEFAULT 1,
  price       REAL NOT NULL,                  -- سعر الوحدة وقت البيع
  cost        REAL NOT NULL DEFAULT 0,        -- تكلفة الوحدة وقت البيع
  note        TEXT,                           -- تعديلات: بدون بصل ...
  kds_status  TEXT NOT NULL DEFAULT 'new'     -- new | preparing | ready | served
);

-- ---------- الجرد الفعلي (Variance) ----------
CREATE TABLE IF NOT EXISTS stock_counts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_id INTEGER REFERENCES warehouses(id),
  status      TEXT NOT NULL DEFAULT 'open',   -- open | closed
  note        TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL,
  closed_at   TEXT
);

CREATE TABLE IF NOT EXISTS stock_count_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  count_id    INTEGER NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES raw_materials(id),
  book_qty    REAL NOT NULL DEFAULT 0,        -- الرصيد الدفتري لحظة الجرد
  actual_qty  REAL,                            -- الجرد الفعلي
  unit_cost   REAL NOT NULL DEFAULT 0
);

-- ---------- الإعدادات العامة (مفتاح/قيمة — ديناميكي) ----------
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ---------- سجل التدقيق ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES users(id),
  entity_type TEXT,
  entity_id   INTEGER,
  action      TEXT,
  diff        TEXT,
  created_at  TEXT NOT NULL
);

-- ---------- المصروفات (فئات + حركات) ----------
CREATE TABLE IF NOT EXISTS expense_categories (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name_ar   TEXT NOT NULL,
  icon      TEXT DEFAULT '💸',
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS expenses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES expense_categories(id),
  amount      REAL NOT NULL DEFAULT 0,
  note        TEXT,
  spent_at    TEXT,                            -- تاريخ المصروف (يوم)
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL
);

-- ---------- الإشعارات (كل المستويات) ----------
CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id),   -- مستلم محدد (أو NULL)
  role_key    TEXT,                            -- أو موجّه لكل دور (admin/kitchen/bar...)
  type        TEXT,                            -- purchase_request | low_stock | order | expense | system
  icon        TEXT DEFAULT '🔔',
  title       TEXT NOT NULL,
  body        TEXT,
  ref_type    TEXT, ref_id INTEGER,
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

-- ---------- طلبات الشراء (من المطبخ/البار → مدير المشتريات/الأدمن) ----------
CREATE TABLE IF NOT EXISTS purchase_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id  INTEGER REFERENCES raw_materials(id),  -- مادة معرّفة (أو NULL)
  custom_name  TEXT,                                  -- اسم حر لو مادة جديدة
  qty          REAL NOT NULL DEFAULT 1,
  station      TEXT,                                  -- kitchen | bar
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',       -- pending | fulfilled | rejected
  requested_by INTEGER REFERENCES users(id),
  handled_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL,
  handled_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orderitems_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_invtx_material ON inventory_transactions(material_id);
CREATE INDEX IF NOT EXISTS idx_recipe_product ON product_recipes(product_id);
