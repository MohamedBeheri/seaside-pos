// ===================================================================
//  واجهة seaside — POS + مخازن + وصفات + حوكمة (ثنائي اللغة + ثيم)
// ===================================================================
const APP_BUILD = '2026-07-09.1';
console.log('seaside POS — build ' + APP_BUILD);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const root = $('#root');
let TOKEN = localStorage.getItem('cafe_token') || null;
let ME = null, META = null, charts = {};
let LANG = localStorage.getItem('cafe_lang') || 'ar';
let THEME = localStorage.getItem('cafe_theme') || 'light';

// ---------- الترجمة (عربي → إنجليزي) ----------
const I18N = {
  'نظام نقاط البيع وإدارة المخازن': 'POS & Inventory System', 'البريد الإلكتروني': 'Email', 'كلمة المرور': 'Password', 'دخول': 'Sign in', 'تسجيل الخروج': 'Sign out',
  'حسابات تجريبية (اضغط للتعبئة):': 'Demo accounts (click to fill):', 'مدير': 'Manager', 'كاشير': 'Cashier', 'نادل': 'Waiter', 'شيف': 'Chef',
  'العمليات': 'Operations', 'المخزون والمشتريات': 'Inventory & Purchasing', 'الإدارة': 'Management',
  'نقطة البيع': 'Point of Sale', 'شاشة المطبخ': 'Kitchen Display', 'شاشة البار': 'Bar Display', 'الطلبات والفواتير': 'Orders & Invoices',
  'طلبات الشراء': 'Purchase requests', 'الإشعارات': 'Notifications', 'طلب شراء': 'Purchase request', '+ طلب شراء': '+ Purchase request',
  'المادة المطلوبة': 'Requested material', 'الكمية المطلوبة': 'Requested qty', 'إرسال الطلب': 'Send request', 'تم إرسال طلب الشراء ✅': 'Purchase request sent ✅',
  'مادة من المخزن': 'Material from stock', 'أو اكتب اسم مادة جديدة': 'or type a new material name', 'تنفيذ': 'Fulfill', 'رفض': 'Reject', 'قيد الانتظار': 'Pending', 'تم التنفيذ': 'Fulfilled', 'مرفوض': 'Rejected',
  'لا طلبات شراء': 'No purchase requests', 'لا إشعارات': 'No notifications', 'تعليم الكل كمقروء': 'Mark all read', 'الطالب': 'Requested by',
  'المخزون': 'Inventory', 'المشتريات': 'Purchases', 'التوالف والهدر': 'Waste', 'الجرد': 'Stock Count',
  'لوحة المعلومات': 'Dashboard', 'الأصناف والوصفات': 'Products & Recipes', 'المصروفات': 'Expenses', 'تقارير الحوكمة': 'Governance Reports', 'الموظفون': 'Staff', 'الإعدادات': 'Settings',
  'ملخص المبيعات': 'Sales summary', 'صافي الربح': 'Net profit', 'فئة المصروف': 'Expense category', 'قيمة المصروف': 'Amount', 'تاريخ المصروف': 'Date', '+ مصروف جديد': '+ New expense', 'تسجيل مصروف': 'Log expense', 'إجمالي المصروفات': 'Total expenses', 'لا مصروفات': 'No expenses', 'آخر ٧ أيام': 'Last 7 days', 'آخر ١٤ يوم': 'Last 14 days', 'آخر ٣٠ يوم': 'Last 30 days', 'تعديل الفاتورة (أدمن)': 'Edit invoice (admin)', 'حفظ تعديل الفاتورة': 'Save invoice edit', 'تم تعديل الفاتورة ✅': 'Invoice updated ✅',
  'حفظ': 'Save', 'إلغاء': 'Cancel', 'تعديل': 'Edit', 'حذف': 'Delete', 'إضافة': 'Add', 'عرض': 'View', 'تأكيد': 'Confirm', 'إغلاق': 'Close', 'تحديث': 'Refresh',
  'تم الحفظ ✅': 'Saved ✅', 'حُذف': 'Deleted', 'الاسم مطلوب': 'Name is required',
  // لوحة المعلومات
  'نظرة لحظية على مبيعات وأرباح اليوم': "Today's live sales & profit overview",
  'طلبات اليوم': "Today's orders", 'مبيعات اليوم': "Today's sales", 'أرباح اليوم (بعد التكلفة)': "Today's profit (after cost)", 'متوسط الفاتورة': 'Avg. ticket',
  'عن أمس': 'vs yesterday', 'مبيعات آخر ١٤ يوم': 'Sales — last 14 days', 'طرق الدفع': 'Payment methods', 'الأكثر مبيعاً': 'Top sellers',
  'الصنف': 'Item', 'الكمية': 'Qty', 'المبيعات': 'Sales', 'مواد قاربت النفاد': 'Low stock items', 'المادة': 'Material', 'المتبقي': 'Remaining', 'حد الطلب': 'Reorder pt',
  'كل المخزون في أمان ✅': 'All stock is healthy ✅', 'أحدث الطلبات': 'Latest orders', 'الفاتورة': 'Invoice', 'النوع': 'Type', 'الطاولة': 'Table',
  'الإجمالي': 'Total', 'الحالة': 'Status', 'الوقت': 'Time', '🧾 فتح الكاشير': '🧾 Open POS', 'لا بيانات': 'No data', 'لا طلبات': 'No orders',
  // POS
  '🔍 ابحث عن صنف…': '🔍 Search items…', 'الكل': 'All', '🛒 السلة فارغة': '🛒 Cart is empty', 'اضغط على الأصناف لإضافتها': 'Tap items to add them', 'لا أصناف': 'No items',
  '— الطاولة —': '— Table —', '— النادل —': '— Waiter —', 'الإجمالي الفرعي': 'Subtotal', 'خصم': 'Discount', 'ضريبة': 'Tax', 'المطلوب': 'Total due',
  '👨‍🍳 للمطبخ': '👨‍🍳 To kitchen', '💵 الدفع': '💵 Pay', '+ ملاحظة': '+ note', 'عدد الأفراد': 'Guests',
  '💵 إتمام الدفع': '💵 Complete payment', 'المبلغ المدفوع (نقداً)': 'Cash received', 'الباقي': 'Change', 'بقشيش (اختياري)': 'Tip (optional)', '✅ تأكيد الدفع والطباعة': '✅ Confirm & print',
  'أضف صنفاً واحداً على الأقل': 'Add at least one item', 'تم الدفع ✅ — ': 'Paid ✅ — ', 'أُرسل للمطبخ — ': 'Sent to kitchen — ',
  'تم الدفع وأُرسل للتحضير ✅ — ': 'Paid & sent to prep ✅ — ',
  'ملاحظة / تعديل (مثال: بدون بصل، إضافي شوت):': 'Note / modifier (e.g. no onion, extra shot):', 'قيمة الخصم:': 'Discount amount:',
  // الطلبات
  'سجل كل الطلبات مع إمكانية الفلترة': 'All orders with filtering', 'كل الحالات': 'All statuses', 'كل الأنواع': 'All types', 'مسح الفلتر': 'Clear filter', 'الدفع': 'Payment',
  'لا طلبات بهذا الفلتر': 'No orders for this filter', '🖨️ طباعة': '🖨️ Print', '💵 دفع': '💵 Pay', 'إلغاء الطلب': 'Cancel order', 'إلغاء هذا الطلب؟': 'Cancel this order?',
  'الإجمالي شامل الضريبة': 'Total incl. tax', 'أُلغي الطلب': 'Order cancelled',
  // KDS
  'الطلبات الجارية — اضغط على الصنف لتغيير حالته': 'Active orders — tap an item to advance it', '🔄 تحديث': '🔄 Refresh', 'لا طلبات في المطبخ حالياً 🎉': 'No active kitchen orders 🎉',
  // الأصناف والوصفات
  'عرّف الأصناف واربطها بمكوناتها الخام (الوصفة) لتُخصم تلقائياً عند البيع': 'Define products and link them to raw materials (recipe) for auto-deduction on sale',
  '+ صنف جديد': '+ New product', 'التصنيف': 'Category', 'السعر': 'Price', 'تكلفة المكونات': 'Ingredient cost', 'هامش الربح': 'Margin', 'خصم مخزون': 'Stock', '🧪 الوصفة': '🧪 Recipe',
  'صنف جديد': 'New product', 'تعديل صنف': 'Edit product', 'اسم الصنف': 'Product name', 'الأيقونة (إيموجي)': 'Icon (emoji)', '— بدون —': '— None —', 'سعر البيع': 'Sell price',
  'خصم المكونات من المخزن عند البيع': 'Deduct ingredients from stock on sale', 'صنف مُفعّل (يظهر في الكاشير)': 'Active (shown in POS)', 'حذف الصنف نهائياً؟': 'Delete product permanently?',
  'حدّد المكونات الخام والكمية بالوحدة الصغرى. تُخصم تلقائياً من المخزن لحظة البيع.': 'Set raw materials and quantity in the base unit. Auto-deducted from stock at sale time.',
  '+ إضافة مكوّن': '+ Add ingredient', 'تكلفة المكونات للصنف': 'Recipe cost', '💾 حفظ وتحديث التكلفة': '💾 Save & update cost', 'لا مكونات بعد — أضف مكوّناً': 'No ingredients yet — add one',
  'حُفظت الوصفة — التكلفة: ': 'Recipe saved — cost: ', 'سعر البيع': 'Sell price', 'هامش': 'margin', 'متوفر': 'in stock', '⚠️منخفض': '⚠️low',
  // المخزون
  'أرصدة المواد الخام بالوحدة الصغرى وقيمتها': 'Raw material balances and value', '📜 حركة المخزن': '📜 Stock ledger', '+ مادة خام': '+ Raw material', 'كل المخازن': 'All warehouses',
  'عدد المواد': 'Materials', 'قيمة المخزون': 'Stock value', 'مواد تحت حد الطلب': 'Below reorder pt', 'الكود': 'Code', 'المخزن': 'Warehouse', 'الرصيد': 'Balance',
  'متوسط التكلفة': 'Avg. cost', 'منخفض': 'Low', 'متوفر': 'OK', 'مادة خام جديدة': 'New raw material', 'تعديل مادة خام': 'Edit raw material', 'الوحدة الصغرى': 'Base unit',
  'الرصيد الحالي': 'Current balance', 'متوسط التكلفة (للوحدة)': 'Avg. cost (per unit)', 'حد إعادة الطلب': 'Reorder point', 'لا مواد': 'No materials',
  '📜 حركة المخزن (آخر ٢٠٠)': '📜 Stock ledger (last 200)', 'لا حركات': 'No movements',
  // المشتريات
  'استلام فواتير الموردين — يُحدّث المخزون ومتوسط التكلفة تلقائياً': 'Receive supplier invoices — auto-updates stock & moving-average cost', '+ فاتورة شراء': '+ Purchase invoice',
  'الرقم': 'No.', 'المورد': 'Supplier', 'عدد البنود': 'Lines', 'لا مشتريات بعد': 'No purchases yet', '🚚 فاتورة شراء جديدة': '🚚 New purchase invoice', 'المخزن المستلِم': 'Receiving warehouse',
  'رقم الفاتورة': 'Invoice no.', 'ضريبة الفاتورة': 'Invoice tax', 'البنود': 'Lines', '+ بند': '+ Line', 'إجمالي الفاتورة': 'Invoice total', '💾 استلام وتحديث المخزون': '💾 Receive & update stock',
  'تم الاستلام وتحديث المخزون ✅': 'Received & stock updated ✅',
  // التوالف
  'سجّل المواد التالفة لفصلها عن المبيعات وضبط الأرباح': 'Log spoiled materials to separate them from sales', '+ تسجيل تالف': '+ Log waste', 'التكلفة المهدرة': 'Wasted cost',
  'السبب': 'Reason', 'بواسطة': 'By', 'لا توالف مسجلة ✅': 'No waste logged ✅', '🗑️ تسجيل مادة تالفة': '🗑️ Log spoiled material', 'الكمية التالفة': 'Wasted qty', 'تسجيل وخصم': 'Log & deduct',
  'انتهاء صلاحية': 'Expired', 'خطأ تحضير': 'Prep error', 'كسر / سقوط': 'Breakage', 'إرجاع عميل': 'Customer return', 'أخرى': 'Other', 'سُجّل التالف — التكلفة: ': 'Waste logged — cost: ',
  // الجرد
  'طابِق الرصيد الدفتري مع الفعلي لكشف الهدر والعجز': 'Match book vs physical balance to detect variance', '+ جرد جديد': '+ New count', 'مفتوح': 'Open', 'مغلق': 'Closed',
  'إدخال الجرد': 'Enter count', 'عرض الفروقات': 'View variance', 'لا عمليات جرد': 'No counts', '🔍 بدء جرد جديد': '🔍 Start new count', 'بدء الجرد': 'Start count',
  'سيتم تجميد الرصيد الدفتري الحالي لكل مادة كمرجع للمقارنة.': 'Current book balance for each material will be frozen as reference.',
  'دفتري': 'Book', 'فعلي': 'Actual', 'الفرق': 'Diff', 'قيمة الفرق': 'Diff value', 'صافي فرق الجرد (− عجز / + فائض)': 'Net variance (− short / + over)', '💾 حفظ مؤقت': '💾 Save draft',
  '✅ إنهاء واعتماد الفروقات': '✅ Close & post variance', 'إغلاق النافذة': 'Close window', 'حُفظ مؤقتاً': 'Draft saved', 'إنهاء الجرد واعتماد الفروقات كتسويات مخزنية؟': 'Close count and post variances as adjustments?',
  'تم اعتماد الجرد ✅': 'Count posted ✅',
  // التقارير
  'الربحية والهدر وأداء الموردين': 'Profitability, waste and supplier performance', 'من': 'From', 'إلى': 'To', 'صافي الربح': 'Net profit', 'نسبة الهدر من التكلفة': 'Waste % of cost',
  '💹 المبيعات والأرباح يومياً': '💹 Daily sales & profit', '🥡 حسب نوع الطلب': '🥡 By order type', '🍽️ ربحية الأصناف': '🍽️ Product profitability', 'التكلفة': 'Cost',
  'تقرير الهدر والعجز': 'Waste & variance', 'تكلفة التوالف': 'Waste cost', 'عجز الجرد': 'Count shortage', 'فائض الجرد': 'Count surplus', '🚚 أداء الموردين': '🚚 Supplier performance',
  'الفواتير': 'Invoices', 'آخر توريد': 'Last supply', 'لا مبيعات بالفترة': 'No sales in range', 'لا هدر مسجل ✅': 'No waste logged ✅', 'لا موردين': 'No suppliers', 'كمية الهدر': 'Waste qty',
  'مبيعات': 'Sales', 'ربح': 'Profit',
  // الموظفون
  'إضافة الموظفين وتحديد أدوارهم وصلاحياتهم': 'Add staff and set their roles & permissions', '+ موظف جديد': '+ New staff', 'الاسم': 'Name', 'البريد': 'Email', 'الدور': 'Role',
  'مفعّل': 'Active', 'موقوف': 'Disabled', 'موظف جديد': 'New staff', 'تعديل موظف': 'Edit staff', 'كلمة المرور (اتركها فارغة لعدم التغيير)': 'Password (leave empty to keep)', 'PIN سريع': 'Quick PIN',
  // الإعدادات
  'بيانات الكافيه والضريبة، وكل القوائم الديناميكية': 'Cafe info, tax and all dynamic lists', '🏪 بيانات المكان والفاتورة': '🏪 Place & receipt info', 'اسم المكان': 'Place name',
  'الشعار / الوصف': 'Tagline', 'نسبة الضريبة %': 'Tax rate %', 'العملة': 'Currency', 'العنوان': 'Address', 'الهاتف': 'Phone', 'تذييل الفاتورة': 'Receipt footer', '💾 حفظ الإعدادات': '💾 Save settings',
  '🗂️ القوائم الديناميكية': '🗂️ Dynamic lists', 'حُفظت الإعدادات ✅': 'Settings saved ✅',
  '🏷️ التصنيفات': '🏷️ Categories', '🪑 الطاولات': '🪑 Tables', '💳 طرق الدفع': '💳 Payment methods', '📏 الوحدات': '📏 Units', '🏬 المخازن': '🏬 Warehouses', '🚚 الموردون': '🚚 Suppliers',
  'الاسم': 'Name', 'أيقونة': 'Icon', 'لون': 'Color', 'ترتيب': 'Order', 'مقاعد': 'Seats', 'الرمز': 'Symbol', 'هاتف': 'Phone', 'ملاحظات': 'Notes', 'مفعّل': 'Active',
  'تأكيد': 'Confirm', 'لا بيانات': 'No data',
  'حذف': 'Delete', 'تم حذف الفاتورة': 'Invoice deleted',
  '⚠️ منطقة الخطر': '⚠️ Danger Zone',
  'مسح جميع الفواتير والحركات المالية': 'Delete all invoices & financial records',
  'هذا الإجراء سيحذف جميع الطلبات والفواتير والمشتريات والمصروفات وحركات المخزون والجرد نهائياً. لن يمس المنتجات أو الأصناف أو التصنيفات أو المخزون.': 'This will permanently delete all orders, invoices, purchases, expenses, inventory transactions and stock counts. Products, categories and inventory will NOT be affected.',
  '🗑️ مسح الحركات المالية': '🗑️ Delete Financial Records',
  'تم مسح جميع الحركات المالية ✅': 'All financial records deleted ✅',
};
const loc = () => LANG === 'en' ? 'en-GB' : 'ar-EG';
const t = (s) => LANG === 'en' ? (I18N[s] ?? s) : s;
const L = (ar, en) => LANG === 'en' ? en : ar;

// ---------- API ----------
async function api(path, { method = 'GET', body } = {}) {
  const o = { method, headers: {} };
  if (TOKEN) o.headers.Authorization = 'Bearer ' + TOKEN;
  if (body) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
  const r = await fetch('/api' + path, o);
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && ME) { logout(); throw new Error('Session expired'); }
  if (!r.ok) throw new Error(d.error || 'Error');
  return d;
}

// ---------- مساعدات ----------
const esc = (s) => (s ?? '').toString().replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cur = () => (META?.settings?.currency || 'EGP');
const money = (n) => (+n || 0).toLocaleString(loc(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + cur();
const num = (n, d = 0) => (+n || 0).toLocaleString(loc(), { maximumFractionDigits: d });
const dt = (s) => s ? new Date(s).toLocaleString(loc(), { dateStyle: 'short', timeStyle: 'short' }) : '—';
const dDay = (s) => s ? new Date(s).toLocaleDateString(loc(), { day: '2-digit', month: 'short' }) : '—';
const ago = (s) => { const m = Math.floor((Date.now() - new Date(s)) / 60000); return m < 1 ? t('الآن') : m < 60 ? L(`منذ ${m} د`, `${m}m ago`) : L(`منذ ${Math.floor(m / 60)} س`, `${Math.floor(m / 60)}h ago`); };
const todayStr = () => new Date().toISOString().slice(0, 10);

function toast(msg, kind = 'ok') { const x = document.createElement('div'); x.className = 'toast ' + kind; x.textContent = msg; document.body.appendChild(x); setTimeout(() => x.remove(), 3200); }
function modal(html, cls = '') { const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.innerHTML = `<div class="modal ${cls}">${html}</div>`; bg.addEventListener('mousedown', e => { if (e.target === bg) bg.remove(); }); document.body.appendChild(bg); return bg; }
function confirmDialog(msg, onYes, danger = true) {
  const m = modal(`<h3>${t('تأكيد')}</h3><p style="color:var(--text2);margin-bottom:8px">${esc(msg)}</p>
    <div class="modal-actions"><button class="btn btn-ghost" id="c-no">${t('إلغاء')}</button>
    <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="c-yes">${t('تأكيد')}</button></div>`);
  $('#c-no', m).onclick = () => m.remove();
  $('#c-yes', m).onclick = () => { m.remove(); onYes(); };
}
const STATUS = { open: ['مفتوح', 'Open'], confirmed: ['بالمطبخ', 'In kitchen'], paid: ['مدفوع', 'Paid'], cancelled: ['ملغي', 'Cancelled'], new: ['جديد', 'New'], preparing: ['تحضير', 'Preparing'], ready: ['جاهز', 'Ready'], served: ['تم التقديم', 'Served'] };
const TYPE = { dine_in: ['🪑 صالة', '🪑 Dine-in'], takeaway: ['🥡 تيك أواي', '🥡 Takeaway'], delivery: ['🛵 توصيل', '🛵 Delivery'] };
const LL = (m, k) => m[k] ? m[k][LANG === 'en' ? 1 : 0] : k;
const stBadge = (s) => `<span class="badge-st st-${s}">${LL(STATUS, s)}</span>`;

// ---------- لوجو seaside (الصورة الأصلية) ----------
const logoMark = (cls = '') => `<img src="/logo.jpeg" class="logo-img ${cls}" alt="seaside">`;

// ---------- لغة وثيم ----------
function setLang(l) {
  LANG = l; localStorage.setItem('cafe_lang', l);
  document.documentElement.lang = l; document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
  if (ME) { renderShell(); route(); } else renderLogin();
}
function setTheme(th) {
  THEME = th; localStorage.setItem('cafe_theme', th);
  document.documentElement.setAttribute('data-theme', th);
  $$('.theme-ic').forEach(b => b.textContent = th === 'dark' ? '☀️' : '🌙');
}
const langBtn = (id) => `<button class="t-btn" id="${id}" title="AR / EN">${LANG === 'en' ? 'ع' : 'EN'}</button>`;
const themeBtn = (id) => `<button class="t-btn theme-ic" id="${id}" title="theme">${THEME === 'dark' ? '☀️' : '🌙'}</button>`;

// ===================================================================
//  الدخول
// ===================================================================
function renderLogin() {
  root.innerHTML = `<div class="login-wrap"><div class="login-card">
    <div class="login-top">${langBtn('lg-lang')}${themeBtn('lg-theme')}</div>
    ${logoMark('login-logo-img')}
    <div class="sub">${t('نظام نقاط البيع وإدارة المخازن')}</div>
    <form id="lf">
      <div class="field"><label>${t('البريد الإلكتروني')}</label><input id="email" type="email" placeholder="email@example.com" autocomplete="username"></div>
      <div class="field"><label>${t('كلمة المرور')}</label><input id="pass" type="password" autocomplete="current-password"></div>
      <button class="btn btn-primary btn-block btn-lg" type="submit">${t('دخول')}</button>
      <div class="err" id="le"></div>
    </form>
    <div class="build-tag">v${APP_BUILD}</div>
  </div></div>`;
  $('#lg-lang').onclick = () => setLang(LANG === 'en' ? 'ar' : 'en');
  $('#lg-theme').onclick = () => setTheme(THEME === 'dark' ? 'light' : 'dark');
  $('#lf').onsubmit = async (e) => {
    e.preventDefault(); $('#le').textContent = '';
    try {
      const d = await api('/login', { method: 'POST', body: { email: $('#email').value.trim(), password: $('#pass').value } });
      TOKEN = d.token; localStorage.setItem('cafe_token', TOKEN); await boot();
    } catch (err) { $('#le').textContent = err.message; }
  };
}
function logout() { TOKEN = null; localStorage.removeItem('cafe_token'); ME = null; location.hash = ''; renderLogin(); }

// ===================================================================
//  التنقل والهيكل
// ===================================================================
const NAV = [
  { sec: 'العمليات' },
  { id: 'pos', ic: '🧾', t: 'نقطة البيع', roles: ['admin', 'cashier'] },
  { id: 'kds', ic: '👨‍🍳', t: 'شاشة المطبخ', roles: ['admin', 'kitchen'] },
  { id: 'bar', ic: '🍹', t: 'شاشة البار', roles: ['admin', 'bar'] },
  { id: 'orders', ic: '📋', t: 'الطلبات والفواتير', roles: ['admin', 'cashier', 'kitchen', 'bar'] },
  { id: 'requests', ic: '🛒', t: 'طلبات الشراء', roles: ['admin', 'kitchen', 'bar'] },
  { id: 'notifications', ic: '🔔', t: 'الإشعارات', roles: ['admin', 'cashier', 'kitchen', 'bar'] },
  { sec: 'المخزون والمشتريات' },
  { id: 'inventory', ic: '📦', t: 'المخزون', roles: ['admin'] },
  { id: 'purchases', ic: '🚚', t: 'المشتريات', roles: ['admin'] },
  { id: 'waste', ic: '🗑️', t: 'التوالف والهدر', roles: ['admin'] },
  { id: 'stockcount', ic: '🔍', t: 'الجرد', roles: ['admin'] },
  { sec: 'الإدارة' },
  { id: 'dashboard', ic: '📊', t: 'لوحة المعلومات', roles: ['admin'] },
  { id: 'products', ic: '🍽️', t: 'الأصناف والوصفات', roles: ['admin'] },
  { id: 'expenses', ic: '💸', t: 'المصروفات', roles: ['admin'] },
  { id: 'reports', ic: '📈', t: 'تقارير الحوكمة', roles: ['admin'] },
  { id: 'staff', ic: '👥', t: 'الموظفون', roles: ['admin'] },
  { id: 'config', ic: '⚙️', t: 'الإعدادات', roles: ['admin'] },
];
const can = (id) => { if (ME.role_key === 'admin') return true; return (ME.permissions || []).includes(id); };
const firstRoute = () => (NAV.find(n => n.id && can(n.id)) || { id: 'pos' }).id;

function renderShell() {
  const items = NAV.map(n => {
    if (n.sec) return `<div class="sec">${t(n.sec)}</div>`;
    if (!can(n.id)) return '';
    return `<a href="#/${n.id}" data-r="${n.id}"><span class="ic">${n.ic}</span> ${t(n.t)}<span class="badge hidden" id="badge-${n.id}"></span></a>`;
  }).join('');
  root.innerHTML = `<div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="sb-brand"><span class="sb-logo-pill">${logoMark('sb-logo')}</span><div class="t">${esc(META.settings.cafe_name || 'seaside')}<small>${esc(META.settings.tagline || '')}</small></div></div>
      <nav class="nav">${items}</nav>
      <div class="sb-foot">
        <div class="sb-clock" id="clock"></div>
        <div class="sb-toggles"><button id="sb-lang">${LANG === 'en' ? 'العربية' : 'English'}</button><button id="sb-theme">${THEME === 'dark' ? '☀️ Light' : '🌙 Dark'}</button></div>
        <div class="u"><div class="av">${esc((ME.full_name || '?')[0])}</div><div><div class="nm">${esc(ME.full_name)}</div><div class="rl">${esc(ME.role_name)}</div></div></div>
        <a class="logout" id="logout">↩ ${t('تسجيل الخروج')}</a>
        <div class="build-tag sb">v${APP_BUILD}</div>
      </div>
    </aside>
    <main class="main" id="view"><div class="loading">…</div></main></div>`;
  $('#logout').onclick = logout;
  $('#sb-lang').onclick = () => setLang(LANG === 'en' ? 'ar' : 'en');
  $('#sb-theme').onclick = () => setTheme(THEME === 'dark' ? 'light' : 'dark');
  $$('.nav a').forEach(a => a.onclick = () => { $('#sidebar').classList.remove('open'); });
  startClock();
}
let clockTimer = null;
function startClock() {
  if (clockTimer) clearInterval(clockTimer);
  const tick = () => { const el = $('#clock'); if (!el) return clearInterval(clockTimer); const d = new Date();
    el.innerHTML = `<div class="tm">${d.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>${d.toLocaleDateString(loc(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`; };
  tick(); clockTimer = setInterval(tick, 1000);
}
function setActive() { $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.r === (location.hash.split('/')[1] || ''))); }
function refreshKDSBadge() {
  if (!ME) return;
  if (can('kds')) api('/kds').then(o => { const b = $('#badge-kds'); if (b) { const n = o.length; b.textContent = n; b.classList.toggle('hidden', !n); } }).catch(() => {});
  if (can('bar')) api('/bar').then(o => { const b = $('#badge-bar'); if (b) { const n = o.length; b.textContent = n; b.classList.toggle('hidden', !n); } }).catch(() => {});
}
function refreshNotifBadge() {
  if (!ME) return;
  api('/notifications/count').then(d => { const b = $('#badge-notifications'); if (b) { b.textContent = d.count; b.classList.toggle('hidden', !d.count); } }).catch(() => {});
  if (can('requests')) api('/purchase-requests').then(rs => { const pend = rs.filter(r => r.status === 'pending').length; const rb = $('#badge-requests'); if (rb) { rb.textContent = pend; rb.classList.toggle('hidden', !pend); } }).catch(() => {});
}
let ALERTS = { low: [], count: 0 };
function refreshAlertsBadge() {
  if (!ME || !can('inventory')) return;
  api('/alerts').then(d => { ALERTS = d; const b = $('#badge-inventory'); if (b) { b.textContent = d.count; b.classList.toggle('hidden', !d.count); } }).catch(() => {});
}
function showAlerts() {
  const d = ALERTS;
  modal(`<h3>🔔 ${L('تنبيهات نقص المخزون', 'Low-stock alerts')} ${d.count ? `<span class="chip low">${d.count}</span>` : ''}</h3>
    ${d.low.length ? d.low.map(m => `<div style="padding:11px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;font-weight:700"><span>⚠️ ${esc(m.name_ar)}</span><span style="color:var(--red)">${num(m.qty, 1)} ${esc(m.unit || '')} / ${num(m.reorder_point, 1)}</span></div>
      ${m.products.length ? `<div style="font-size:12px;color:var(--text2);margin-top:4px">${L('يؤثر على', 'Affects')}: ${m.products.map(esc).join('، ')}</div>` : ''}
    </div>`).join('') : `<div class="empty">${L('كل المخزون في أمان ✅', 'All stock is healthy ✅')}</div>`}
    <div class="modal-actions"><button class="btn btn-ghost" onclick="this.closest('.modal-bg').remove()">${t('إغلاق')}</button>
    ${can('purchases') ? `<button class="btn btn-primary" onclick="this.closest('.modal-bg').remove();location.hash='#/purchases'">🚚 ${L('شراء', 'Purchase')}</button>` : ''}</div>`, 'wide');
}

const ROUTES = {};
async function route() {
  if (!ME) return;
  const id = location.hash.split('/')[1] || firstRoute();
  if (!can(id)) { location.hash = '#/' + firstRoute(); return; }
  setActive();
  const view = $('#view'); view.innerHTML = '<div class="loading">…</div>';
  try { await (ROUTES[id] || ROUTES.pos)(view); } catch (e) { view.innerHTML = `<div class="card"><p style="color:var(--red)">⚠️ ${esc(e.message)}</p></div>`; }
  refreshKDSBadge(); refreshAlertsBadge(); refreshNotifBadge();
}
window.addEventListener('hashchange', route);

async function boot() {
  ME = await api('/me'); META = await api('/meta');
  renderShell();
  if (!location.hash || !can(location.hash.split('/')[1])) location.hash = '#/' + firstRoute();
  route();
  setInterval(() => { refreshKDSBadge(); refreshAlertsBadge(); refreshNotifBadge(); }, 20000);
}

// ===================================================================
//  لوحة المعلومات
// ===================================================================
ROUTES.dashboard = async (view) => {
  const d = await api('/dashboard');
  const delta = (p) => p === 0 ? '' : `<div class="delta ${p > 0 ? 'up' : 'down'}">${p > 0 ? '▲' : '▼'} ${Math.abs(p)}% ${t('عن أمس')}</div>`;
  view.innerHTML = `
    <div class="page-head"><div><h2>📊 ${t('لوحة المعلومات')}</h2><div class="crumb">${t('نظرة لحظية على مبيعات وأرباح اليوم')}</div></div>
      <div class="head-actions"><button class="btn btn-primary" onclick="location.hash='#/pos'">${t('🧾 فتح الكاشير')}</button></div></div>
    <div class="kpi-grid">
      <div class="kpi"><div class="lbl">${t('طلبات اليوم')}</div><div class="val">${num(d.today.orders)}</div>${delta(d.today.ordersPct)}<span class="ic">🧾</span></div>
      <div class="kpi sand"><div class="lbl">${t('مبيعات اليوم')}</div><div class="val">${money(d.today.sales)}</div>${delta(d.today.salesPct)}<span class="ic">💰</span></div>
      <div class="kpi green"><div class="lbl">${t('أرباح اليوم (بعد التكلفة)')}</div><div class="val">${money(d.today.profit)}</div>${delta(d.today.profitPct)}<span class="ic">📈</span></div>
      <div class="kpi amber"><div class="lbl">${t('متوسط الفاتورة')}</div><div class="val">${money(d.avgOrder)}</div><span class="ic">🧮</span></div>
    </div>
    <div class="card"><h3 style="justify-content:space-between"><span>📈 ${t('ملخص المبيعات')}</span><span class="period-tabs" id="pt-sales">${periodTabs()}</span></h3><canvas id="ch-trend" height="90"></canvas></div>
    <div class="grid-2">
      <div class="card"><h3 style="justify-content:space-between"><span>💰 ${t('صافي الربح')}</span><span class="period-tabs" id="pt-net">${periodTabs()}</span></h3><canvas id="ch-net" height="120"></canvas></div>
      <div class="card"><h3>💳 ${t('طرق الدفع')}</h3><canvas id="ch-pay" height="120"></canvas></div>
    </div>
    <div class="grid-2">
      <div class="card"><h3>⭐ ${t('الأكثر مبيعاً')}</h3>
        <div class="t-wrap"><table><thead><tr><th>${t('الصنف')}</th><th>${t('الكمية')}</th><th>${t('المبيعات')}</th></tr></thead><tbody>
        ${d.topProducts.map(p => `<tr><td>${esc(p.name_ar)}</td><td class="t-num">${num(p.qty)}</td><td class="t-num">${money(p.sales)}</td></tr>`).join('') || `<tr><td colspan="3" class="empty">${t('لا بيانات')}</td></tr>`}
        </tbody></table></div></div>
      <div class="card"><h3>⚠️ ${t('مواد قاربت النفاد')} ${d.lowStockCount ? `<span class="chip low">${d.lowStockCount}</span>` : ''}</h3>
        <div class="t-wrap"><table><thead><tr><th>${t('المادة')}</th><th>${t('المتبقي')}</th><th>${t('حد الطلب')}</th></tr></thead><tbody>
        ${d.lowStock.map(m => `<tr><td>${esc(m.name_ar)}</td><td class="t-num" style="color:var(--red)">${num(m.qty, 1)}</td><td class="t-num">${num(m.reorder_point, 1)}</td></tr>`).join('') || `<tr><td colspan="3" class="empty">${t('كل المخزون في أمان ✅')}</td></tr>`}
        </tbody></table></div></div>
    </div>
    <div class="card"><h3>🕒 ${t('أحدث الطلبات')}</h3>
      <div class="t-wrap"><table><thead><tr><th>${t('الفاتورة')}</th><th>${t('النوع')}</th><th>${t('الطاولة')}</th><th>${t('الإجمالي')}</th><th>${t('الحالة')}</th><th>${t('الوقت')}</th></tr></thead><tbody>
      ${d.recent.map(o => `<tr><td>${esc(o.invoice_no || '#' + o.id)}</td><td>${LL(TYPE, o.order_type)}</td><td>${esc(o.table_name || '—')}</td><td class="t-num">${money(o.total)}</td><td>${stBadge(o.status)}</td><td style="color:var(--text3)">${ago(o.created_at)}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">${t('لا طلبات')}</td></tr>`}
      </tbody></table></div></div>`;

  Object.values(charts).forEach(c => c.destroy()); charts = {};
  charts.pay = new Chart($('#ch-pay'), { type: 'doughnut', data: { labels: d.byPayment.map(p => p.name_ar), datasets: [{ data: d.byPayment.map(p => p.total), backgroundColor: ['#0FB5BA', '#F2A65A', '#18A558', '#5C7A82', '#E2563B'] }] }, options: { plugins: { legend: { position: 'bottom', labels: { font: { family: fontFam() } } } } } });
  drawSeries('sales', 14); drawSeries('net', 14);
  $$('#pt-sales button').forEach(b => b.onclick = () => { $$('#pt-sales button').forEach(x => x.classList.toggle('active', x === b)); drawSeries('sales', +b.dataset.d); });
  $$('#pt-net button').forEach(b => b.onclick = () => { $$('#pt-net button').forEach(x => x.classList.toggle('active', x === b)); drawSeries('net', +b.dataset.d); });
};
const periodTabs = () => [['7', 'آخر ٧ أيام'], ['14', 'آخر ١٤ يوم'], ['30', 'آخر ٣٠ يوم']].map(p => `<button data-d="${p[0]}" class="${p[0] === '14' ? 'active' : ''}">${L(p[1], p[0] + 'd')}</button>`).join('');
async function drawSeries(which, days) {
  const data = await api('/dashboard/series?days=' + days).catch(() => []);
  const labels = data.map(x => dDay(x.d));
  if (which === 'sales') {
    if (charts.trend) charts.trend.destroy();
    charts.trend = new Chart($('#ch-trend'), { type: 'line', data: { labels, datasets: [{ label: t('المبيعات'), data: data.map(x => x.sales), borderColor: '#0FB5BA', backgroundColor: 'rgba(15,181,186,.14)', fill: true, tension: .35, borderWidth: 2.5, pointRadius: 2 }] }, options: chOpts() });
  } else {
    if (charts.net) charts.net.destroy();
    charts.net = new Chart($('#ch-net'), { type: 'bar', data: { labels, datasets: [{ label: t('صافي الربح'), data: data.map(x => x.net), backgroundColor: data.map(x => x.net < 0 ? '#E2563B' : '#18A558') }] }, options: chOpts() });
  }
}
const fontFam = () => LANG === 'en' ? 'Inter' : 'IBM Plex Sans Arabic';
const chOpts = () => ({ plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { font: { family: fontFam() } } }, x: { ticks: { font: { family: fontFam() } } } } });

// ===================================================================
//  نقطة البيع (POS)
// ===================================================================
let CART = [], POS_PRODUCTS = [], POS_CAT = null, POS_STATE = { type: 'dine_in', table_id: '', guests: 1, waiter_id: '', discount: 0 };

ROUTES.pos = async (view) => {
  POS_PRODUCTS = await api('/pos/products');
  view.innerHTML = `<div class="pos">
    <div class="pos-menu">
      <div class="pos-search"><input id="pos-q" placeholder="${t('🔍 ابحث عن صنف…')}"></div>
      <div class="cat-chips" id="cat-chips"></div>
      <div class="prod-grid" id="prod-grid"></div>
    </div>
    <div class="cart" id="cart"></div>
  </div>`;
  renderCats(); renderProducts(); renderCart();
  $('#pos-q').oninput = renderProducts;
};
function renderCats() {
  const cats = META.categories;
  $('#cat-chips').innerHTML = `<button class="cat-chip ${POS_CAT === null ? 'active' : ''}" data-c="">${t('الكل')}</button>` +
    cats.map(c => `<button class="cat-chip ${POS_CAT === c.id ? 'active' : ''}" data-c="${c.id}">${c.icon || ''} ${esc(c.name_ar)}</button>`).join('');
  $$('#cat-chips .cat-chip').forEach(b => b.onclick = () => { POS_CAT = b.dataset.c ? +b.dataset.c : null; renderCats(); renderProducts(); });
}
function renderProducts() {
  const q = ($('#pos-q')?.value || '').trim();
  let list = POS_PRODUCTS.filter(p => (POS_CAT === null || p.category_id === POS_CAT) && (!q || p.name_ar.includes(q)));
  $('#prod-grid').innerHTML = list.map(p => `<div class="prod-card" data-id="${p.id}">
    <span class="cat-dot" style="background:${p.color || '#0FB5BA'}"></span>
    <span class="emoji">${p.image || '🍽️'}</span><span class="nm">${esc(p.name_ar)}</span><span class="pr">${money(p.price)}</span></div>`).join('')
    || `<div class="empty" style="grid-column:1/-1">${t('لا أصناف')}</div>`;
  $$('#prod-grid .prod-card').forEach(c => c.onclick = () => addToCart(+c.dataset.id));
}
function addToCart(pid) {
  const p = POS_PRODUCTS.find(x => x.id === pid);
  const line = CART.find(c => c.product_id === pid && !c.note);
  if (line) line.qty++; else CART.push({ product_id: pid, name: p.name_ar, price: p.price, cost: p.cost, image: p.image, qty: 1, note: '' });
  renderCart();
}
function cartTotals() {
  const subtotal = CART.reduce((s, c) => s + c.price * c.qty, 0);
  const discount = +POS_STATE.discount || 0;
  const taxable = Math.max(0, subtotal - discount);
  const tax = taxable * ((+META.settings.tax_rate || 0) / 100);
  return { subtotal, discount, tax, total: taxable + tax };
}
function renderCart() {
  const tot = cartTotals();
  const isDine = POS_STATE.type === 'dine_in';
  const taxRate = +META.settings.tax_rate || 0;
  $('#cart').innerHTML = `
    <div class="cart-head">
      <div class="type-tabs">
        ${['dine_in', 'takeaway', 'delivery'].map(k => `<button data-t="${k}" class="${POS_STATE.type === k ? 'active' : ''}">${LL(TYPE, k)}</button>`).join('')}
      </div>
      <div class="cart-meta">
        ${isDine ? `<select id="c-table"><option value="">${t('— الطاولة —')}</option>${META.tables.map(x => `<option value="${x.id}" ${POS_STATE.table_id == x.id ? 'selected' : ''}>${esc(x.name_ar)}</option>`).join('')}</select>
        <input id="c-guests" type="number" min="1" value="${POS_STATE.guests}" style="max-width:70px" title="${t('عدد الأفراد')}">` : ''}
        <select id="c-waiter"><option value="">${t('— النادل —')}</option>${META.waiters.map(w => `<option value="${w.id}" ${POS_STATE.waiter_id == w.id ? 'selected' : ''}>${esc(w.full_name)}</option>`).join('')}</select>
      </div>
    </div>
    <div class="cart-items" id="cart-items">
      ${CART.length ? CART.map((c, i) => `<div class="ci">
        <div class="ci-nm"><div class="n">${c.image || ''} ${esc(c.name)}</div><div class="note" data-n="${i}">${c.note ? '📝 ' + esc(c.note) : t('+ ملاحظة')}</div></div>
        <div class="qtybox"><button data-m="${i}">−</button><span class="q">${c.qty}</span><button data-p="${i}">+</button></div>
        <div class="ci-pr">${money(c.price * c.qty)}</div><button class="ci-x" data-x="${i}">✕</button></div>`).join('')
      : `<div class="cart-empty">${t('🛒 السلة فارغة')}<br><small>${t('اضغط على الأصناف لإضافتها')}</small></div>`}
    </div>
    <div class="cart-foot">
      <div class="sumline"><span>${t('الإجمالي الفرعي')}</span><span class="t-num">${money(tot.subtotal)}</span></div>
      <div class="sumline"><span>${t('خصم')} <a id="c-disc" style="color:var(--sea-deep);cursor:pointer">✎</a></span><span class="t-num">${money(tot.discount)}</span></div>
      ${taxRate ? `<div class="sumline"><span>${t('ضريبة')} (${num(taxRate)}%)</span><span class="t-num">${money(tot.tax)}</span></div>` : ''}
      <div class="sumline total"><span>${t('المطلوب')}</span><span class="t-num">${money(tot.total)}</span></div>
      <div class="cart-actions">
        ${['admin', 'cashier'].includes(ME.role_key) ? `<button class="btn btn-ghost" id="c-send" ${CART.length ? '' : 'disabled'}>${L('👨‍🍳 إرسال للتحضير', '👨‍🍳 Send to prep')}</button>` : ''}
        <button class="btn btn-primary btn-block" id="c-pay" ${CART.length ? '' : 'disabled'}>${t('💵 الدفع')}</button>
      </div>
    </div>`;

  $$('.type-tabs button').forEach(b => b.onclick = () => { POS_STATE.type = b.dataset.t; renderCart(); });
  $$('#cart-items [data-p]').forEach(b => b.onclick = () => { CART[+b.dataset.p].qty++; renderCart(); });
  $$('#cart-items [data-m]').forEach(b => b.onclick = () => { const i = +b.dataset.m; if (--CART[i].qty <= 0) CART.splice(i, 1); renderCart(); });
  $$('#cart-items [data-x]').forEach(b => b.onclick = () => { CART.splice(+b.dataset.x, 1); renderCart(); });
  $$('#cart-items [data-n]').forEach(b => b.onclick = () => { const i = +b.dataset.n; const v = prompt(t('ملاحظة / تعديل (مثال: بدون بصل، إضافي شوت):'), CART[i].note || ''); if (v !== null) { CART[i].note = v.trim(); renderCart(); } });
  const tbl = $('#c-table'); if (tbl) tbl.onchange = () => POS_STATE.table_id = tbl.value;
  const g = $('#c-guests'); if (g) g.onchange = () => POS_STATE.guests = +g.value || 1;
  const w = $('#c-waiter'); if (w) w.onchange = () => POS_STATE.waiter_id = w.value;
  $('#c-disc').onclick = () => { const v = prompt(t('قيمة الخصم:'), POS_STATE.discount || 0); if (v !== null) { POS_STATE.discount = Math.max(0, +v || 0); renderCart(); } };
  const sendBtn = $('#c-send'); if (sendBtn) sendBtn.onclick = sendToKitchen;
  $('#c-pay').onclick = openPayment;
}
function orderPayload(status) {
  return {
    items: CART.map(c => ({ product_id: c.product_id, qty: c.qty, note: c.note || null })),
    order_type: POS_STATE.type, table_id: POS_STATE.type === 'dine_in' ? (POS_STATE.table_id || null) : null,
    guests: POS_STATE.guests, waiter_id: POS_STATE.waiter_id || null, discount: POS_STATE.discount || 0, status,
  };
}
async function sendToKitchen() {
  try { const o = await api('/orders', { method: 'POST', body: orderPayload('confirmed') });
    toast(t('أُرسل للمطبخ — ') + o.invoice_no); clearCart(); refreshKDSBadge();
  } catch (e) { toast(e.message, 'err'); }
}
function clearCart() { CART = []; POS_STATE.discount = 0; POS_STATE.table_id = ''; renderCart(); }

// نافذة الدفع — نقدي أو انستاباي (حسب طرق الدفع المفعّلة)
function payMethodsHTML(selId) {
  return `<div class="pay-methods">${META.payment_methods.map(p => `<button type="button" class="pay-m ${p.id === selId ? 'active' : ''}" data-pm="${p.id}" data-kind="${p.kind}"><span class="e">${p.icon || '💳'}</span> ${L(p.name_ar, p.name_en || p.name_ar)}</button>`).join('')}</div>`;
}
function openPayment() {
  const tot = cartTotals();
  const methods = META.payment_methods;
  let method = methods[0] || { id: null, kind: 'cash' };
  let tendered = Math.ceil(tot.total), tip = 0;
  const m = modal(`<h3>${t('💵 إتمام الدفع')}</h3>
    ${payMethodsHTML(method.id)}
    <div class="sumline total"><span>${t('المطلوب')}</span><span class="t-num">${money(tot.total)}</span></div>
    <div id="pay-cash-box">
      <div class="field"><label>${t('المبلغ المدفوع (نقداً)')}</label><input id="tendered" type="number" value="${tendered}"></div>
      <div class="change-big" id="change">${t('الباقي')}: ${money(tendered - tot.total)}</div>
    </div>
    <div id="pay-ref-box" class="hidden"><div class="field"><label>${L('رقم مرجع التحويل (اختياري)', 'Transfer reference (optional)')}</label><input id="pay-ref" placeholder="InstaPay ref"></div></div>
    <div class="field"><label>${t('بقشيش (اختياري)')}</label><input id="tip" type="number" value="0"></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="p-x">${t('إلغاء')}</button>
      <button class="btn btn-primary btn-lg" id="p-go">${t('✅ تأكيد الدفع والطباعة')}</button></div>`);
  const syncMethod = () => {
    const cash = method.kind === 'cash';
    $('#pay-cash-box', m).classList.toggle('hidden', !cash);
    $('#pay-ref-box', m).classList.toggle('hidden', cash);
  };
  const upd = () => { tendered = +$('#tendered', m).value || 0; tip = +$('#tip', m).value || 0; const ch = tendered - (tot.total + tip); $('#change', m).textContent = t('الباقي') + ': ' + money(ch > 0 ? ch : 0); };
  $$('.pay-m', m).forEach(b => b.onclick = () => { method = methods.find(x => x.id === +b.dataset.pm); $$('.pay-m', m).forEach(x => x.classList.toggle('active', x === b)); syncMethod(); });
  $('#tendered', m).oninput = upd; $('#tip', m).oninput = upd; syncMethod();
  $('#p-x', m).onclick = () => m.remove();
  $('#p-go', m).onclick = async () => {
    $('#p-go', m).disabled = true;
    try {
      const cash = method.kind === 'cash';
      const ref = cash ? null : ($('#pay-ref', m).value.trim() || null);
      const body = { ...orderPayload('paid'), payment_method_id: method.id, paid_cash: cash ? tendered : tot.total, tip, note: ref ? 'InstaPay: ' + ref : undefined };
      const o = await api('/orders', { method: 'POST', body });
      m.remove(); toast(t('تم الدفع وأُرسل للتحضير ✅ — ') + o.invoice_no); printReceipt(o); clearCart(); refreshKDSBadge();
    } catch (e) { $('#p-go', m).disabled = false; toast(e.message, 'err'); }
  };
}

// ===================================================================
//  الفاتورة الحرارية — محتواها بالإنجليزية + لوجو seaside + نقدي
// ===================================================================
function receiptFields() {
  try { return JSON.parse(META.settings.receipt_fields || '{}'); } catch { return {}; }
}
function receiptHTML(o) {
  const s = META.settings;
  const F = receiptFields();
  const em = (n) => (+n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + cur();
  const edt = (x) => x ? new Date(x).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '';
  const ttype = { dine_in: 'Dine-in', takeaway: 'Takeaway', delivery: 'Delivery' };
  const extra = (s.receipt_extra_lines || '').split('\n').map(x => x.trim()).filter(Boolean);
  return `<div class="receipt">
    <div class="r-c">${F.logo !== 0 ? logoMark('r-logo-img') : ''}<h2>${esc(s.cafe_name || 'seaside')}</h2>
      ${F.tagline !== 0 && s.tagline ? `<div>${esc(s.tagline)}</div>` : ''}
      ${F.address && s.address ? `<div>${esc(s.address)}</div>` : ''}
      ${F.phone && s.phone ? `<div>Phone: ${esc(s.phone)}</div>` : ''}
      ${extra.map(l => `<div>${esc(l)}</div>`).join('')}</div>
    <div class="r-line"></div>
    ${F.order_no !== 0 ? `<div><b>Order ${esc(o.invoice_no)}</b>${F.datetime !== 0 ? ' &nbsp; ' + edt(o.created_at) : ''}</div>` : ''}
    ${F.token ? `<div>Token: ${o.id}</div>` : ''}
    ${F.order_type !== 0 || (F.table !== 0 && o.table_name) ? `<div>${F.order_type !== 0 ? (ttype[o.order_type] || '') : ''}${F.table !== 0 && o.table_name ? ' — ' + esc(o.table_name) : ''}</div>` : ''}
    ${F.cashier !== 0 && o.cashier_name ? `<div>Cashier: ${esc(o.cashier_name)}</div>` : ''}
    ${F.waiter && o.waiter_name ? `<div>Waiter: ${esc(o.waiter_name)}</div>` : ''}
    <div class="r-line"></div>
    <table><tr style="font-weight:700"><td>Qty</td><td>Item</td><td style="text-align:right">Amount</td></tr>
    ${o.items.map(i => `<tr><td>${i.qty}</td><td>${esc(i.name_ar)}${i.note ? `<br><small>↳ ${esc(i.note)}</small>` : ''}</td><td style="text-align:right">${em(i.price * i.qty)}</td></tr>`).join('')}</table>
    <div class="r-line"></div>
    <table>
      <tr><td>Subtotal</td><td style="text-align:right">${em(o.subtotal)}</td></tr>
      ${o.discount ? `<tr><td>Discount</td><td style="text-align:right">-${em(o.discount)}</td></tr>` : ''}
      ${o.tax ? `<tr><td>Tax</td><td style="text-align:right">${em(o.tax)}</td></tr>` : ''}
      ${o.tip ? `<tr><td>Tip</td><td style="text-align:right">${em(o.tip)}</td></tr>` : ''}
      <tr class="r-tot"><td>Total</td><td style="text-align:right">${em(o.total)}</td></tr>
    </table>
    <div class="r-line"></div>
    <table>
      <tr style="font-weight:700"><td>Date &amp; time</td><td>Method</td><td style="text-align:right">Amount</td></tr>
      <tr><td>${edt(o.paid_at || o.created_at)}</td><td>${esc(o.payment_name_en || o.payment_name || 'Cash')}</td><td style="text-align:right">${em(o.payment_kind === 'cash' ? (o.paid_cash || o.total) : o.total)}</td></tr>
      ${o.payment_kind === 'cash' && o.change_due ? `<tr><td>Change</td><td></td><td style="text-align:right">${em(o.change_due)}</td></tr>` : ''}
    </table>
    <div class="r-line"></div>
    ${F.barcode !== 0 ? `<div class="r-c r-barcode-wrap"><svg id="r-barcode"></svg></div>` : ''}
    <div class="r-c r-footer">${F.ref !== 0 ? `Ref: ${esc(o.invoice_no)}-${o.id}<br>` : ''}${F.footer !== 0 ? esc(s.receipt_footer || 'Thank you for your visit!') : ''}</div>
  </div>`;
}
function setPrintPage(css) { const s = $('#print-page-style'); if (s) s.textContent = css; }
function renderReceiptBarcode(o) {
  const el = document.getElementById('r-barcode');
  if (!el || typeof JsBarcode === 'undefined') return;
  try { JsBarcode(el, o.invoice_no, { format: 'CODE128', lineColor: '#000', width: 1.4, height: 34, fontSize: 11, margin: 0, textMargin: 4 }); } catch (e) { /* تجاهل لو فشلت المكتبة */ }
}
// أغلب درايفرات الطابعات الحرارية 80mm تعرض مقاسات ورق ثابتة فقط (50/60/80/100/130/150/180/200/230/250/270/297mm)
// ولا تقبل أي طول حر، فنقرّب لأقرب مقاس قياسي أكبر من ارتفاع الفاتورة بدل رقم عشوائي قد يُرفض أو يُهمَل
const THERMAL_HEIGHTS_MM = [50, 60, 80, 100, 130, 150, 180, 200, 230, 250, 270, 297, 350, 420, 500];
function roundToStandardHeight(mm) { return THERMAL_HEIGHTS_MM.find(h => h >= mm) || (Math.ceil(mm / 50) * 50); }
function printReceipt(o) {
  const pa = $('#print-area'); pa.innerHTML = receiptHTML(o); pa.classList.remove('hidden');
  renderReceiptBarcode(o);
  // المتصفح لا يدعم "auto" لطول الصفحة بشكل موثوق (يرجع لطول A4 ‎297mm‏ ويقسّم الفاتورة على عدة صفحات)،
  // لذلك نحسب ارتفاع الفاتورة الفعلي بعد رسم الباركود، ونقرّبه لأقرب مقاس قياسي يدعمه درايفر الطابعة.
  const receiptEl = pa.querySelector('.receipt');
  const heightPx = receiptEl ? receiptEl.offsetHeight : 600;
  const heightMM = roundToStandardHeight(Math.ceil(heightPx * 25.4 / 96) + 12);
  setPrintPage(`@page{size:80mm ${heightMM}mm;margin:0}`);
  const done = () => { pa.classList.add('hidden'); pa.innerHTML = ''; setPrintPage(''); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done); setTimeout(() => window.print(), 150);
}

// ===================================================================
//  الطلبات والفواتير
// ===================================================================
ROUTES.orders = async (view) => {
  view.innerHTML = `<div class="page-head"><div><h2>📋 ${t('الطلبات والفواتير')}</h2><div class="crumb">${t('سجل كل الطلبات مع إمكانية الفلترة')}</div></div></div>
    <div class="toolbar">
      <input type="search" id="o-search" placeholder="${L('🔍 بحث برقم الفاتورة أو الطاولة…', '🔍 Search by invoice no. or table…')}" style="min-width:230px">
      <label style="font-size:13px;color:var(--text2)">${L('من','From')}</label><input type="date" id="o-from" value="${todayStr()}">
      <label style="font-size:13px;color:var(--text2)">${L('إلى','To')}</label><input type="date" id="o-to" value="${todayStr()}">
      <select id="o-status"><option value="">${t('كل الحالات')}</option>${['open', 'confirmed', 'paid', 'cancelled'].map(s => `<option value="${s}">${LL(STATUS, s)}</option>`).join('')}</select>
      <select id="o-type"><option value="">${t('كل الأنواع')}</option>${Object.keys(TYPE).map(k => `<option value="${k}">${LL(TYPE, k)}</option>`).join('')}</select>
      <button class="btn btn-ghost btn-sm" id="o-clear">${t('مسح الفلتر')}</button>
    </div><div id="o-list"></div>`;
  let searchTimer = null;
  const load = async () => {
    const q = new URLSearchParams();
    const query = $('#o-search').value.trim();
    if (query) q.set('q', query);
    else { if ($('#o-from').value) q.set('from', $('#o-from').value); if ($('#o-to').value) q.set('to', $('#o-to').value); }
    if ($('#o-status').value) q.set('status', $('#o-status').value);
    if ($('#o-type').value) q.set('type', $('#o-type').value);
    const rows = await api('/orders?' + q);
    $('#o-list').innerHTML = `<div class="card"><div class="t-wrap"><table><thead><tr><th>${t('الفاتورة')}</th><th>${t('النوع')}</th><th>${t('الطاولة')}</th><th>${t('الإجمالي')}</th><th>${t('الدفع')}</th><th>${t('الحالة')}</th><th>${t('الوقت')}</th><th></th></tr></thead><tbody>
      ${rows.map(o => `<tr><td>${esc(o.invoice_no || '#' + o.id)}</td><td>${LL(TYPE, o.order_type)}</td><td>${esc(o.table_name || '—')}</td>
        <td class="t-num">${money(o.total)}</td><td>${esc(o.payment_name || '—')}</td><td>${stBadge(o.status)}</td><td style="color:var(--text3)">${dt(o.created_at)}</td>
        <td><button class="btn btn-ghost btn-sm" data-o="${o.id}">${t('عرض')}</button>${can('delete_orders') ? `<button class="btn btn-danger btn-sm" data-del="${o.id}" style="margin-inline-start:4px">${t('حذف')}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="8" class="empty">${query ? L('لا نتائج لبحثك', 'No results for your search') : t('لا طلبات بهذا الفلتر')}</td></tr>`}
      </tbody></table></div></div>`;
    $$('#o-list [data-o]').forEach(b => b.onclick = () => openOrder(+b.dataset.o));
    $$('#o-list [data-del]').forEach(b => b.onclick = () => confirmDialog(L('هل أنت متأكد من حذف هذه الفاتورة نهائياً؟','Are you sure you want to permanently delete this invoice?'), async () => { await api('/orders/' + b.dataset.del, { method: 'DELETE' }); toast(L('تم حذف الفاتورة','Invoice deleted')); load(); }));
  };
  ['o-from', 'o-to', 'o-status', 'o-type'].forEach(id => $('#' + id).onchange = load);
  $('#o-search').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(load, 280); };
  $('#o-clear').onclick = () => { $('#o-search').value = ''; $('#o-from').value = ''; $('#o-to').value = ''; $('#o-status').value = ''; $('#o-type').value = ''; load(); };
  load();
};
async function openOrder(id) {
  const o = await api('/orders/' + id);
  const m = modal(`<h3>🧾 ${esc(o.invoice_no)}</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">${stBadge(o.status)}<span class="chip">${LL(TYPE, o.order_type)}</span>${o.table_name ? `<span class="chip">${esc(o.table_name)}</span>` : ''}<span class="chip">${dt(o.created_at)}</span></div>
    <div class="t-wrap"><table><thead><tr><th>${t('الصنف')}</th><th>${t('الكمية')}</th><th>${t('السعر')}</th><th>${t('الإجمالي')}</th></tr></thead><tbody>
      ${o.items.map(i => `<tr><td>${esc(i.name_ar)}${i.note ? `<br><small style="color:var(--sand-deep)">↳ ${esc(i.note)}</small>` : ''}</td><td class="t-num">${i.qty}</td><td class="t-num">${money(i.price)}</td><td class="t-num">${money(i.price * i.qty)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="cost-summary"><div>${t('الإجمالي شامل الضريبة')}</div><div class="big">${money(o.total)}</div></div>
    <div class="modal-actions">
      ${o.status !== 'cancelled' && (o.status !== 'paid' || can('edit_orders')) ? `<button class="btn btn-danger" id="o-cancel">${t('إلغاء الطلب')}</button>` : ''}
      ${o.status === 'paid' && can('edit_orders') ? `<button class="btn btn-sand" id="o-edit">✏️ ${t('تعديل الفاتورة')}</button>` : ''}
      <button class="btn btn-ghost" id="o-print">${t('🖨️ طباعة')}</button>
      ${o.status !== 'paid' && o.status !== 'cancelled' ? `<button class="btn btn-primary" id="o-pay">${t('💵 دفع')}</button>` : ''}
    </div>`, 'wide');
  $('#o-print', m).onclick = () => printReceipt(o);
  const pb = $('#o-pay', m); if (pb) pb.onclick = () => { m.remove(); payExisting(o); };
  const eb = $('#o-edit', m); if (eb) eb.onclick = () => { m.remove(); editPaidOrder(o); };
  const cb = $('#o-cancel', m); if (cb) cb.onclick = () => confirmDialog(t('إلغاء هذا الطلب؟'), async () => { await api(`/orders/${o.id}/cancel`, { method: 'POST', body: {} }); m.remove(); toast(t('أُلغي الطلب')); route(); });
}
// تعديل فاتورة مدفوعة — الأدمن فقط
async function editPaidOrder(o) {
  const prods = await api('/pos/products');
  let lines = o.items.map(i => ({ product_id: i.product_id, name: i.name_ar, price: i.price, qty: i.qty, note: i.note || '' }));
  let discount = o.discount || 0;
  const m = modal(`<h3>✏️ ${t('تعديل الفاتورة (أدمن)')} — ${esc(o.invoice_no)}</h3>
    <p style="color:var(--text2);font-size:13px;margin-bottom:10px">${L('عدّل الكميات أو احذف أصناف؛ النظام يصحّح المخزون تلقائياً.', 'Edit quantities or remove items; stock is corrected automatically.')}</p>
    <div id="eo-lines"></div>
    <div class="field" style="margin-top:8px"><label>${L('أضف صنف', 'Add item')}</label><select id="eo-add"><option value="">— ${t('إضافة')} —</option>${prods.map(p => `<option value="${p.id}">${esc(p.name_ar)} — ${money(p.price)}</option>`).join('')}</select></div>
    <div class="row"><div class="field"><label>${t('خصم')}</label><input id="eo-disc" type="number" value="${discount}"></div></div>
    <div class="cost-summary"><div>${t('الإجمالي')}</div><div class="big" id="eo-total">—</div></div>
    <div class="err" id="eo-e"></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="eo-x">${t('إلغاء')}</button><button class="btn btn-primary" id="eo-save">${t('حفظ تعديل الفاتورة')}</button></div>`, 'wide');
  const taxRate = +META.settings.tax_rate || 0;
  const draw = () => {
    $('#eo-lines', m).innerHTML = lines.map((l, i) => `<div class="pu-line" style="grid-template-columns:1fr 70px 100px 34px">
      <div style="font-weight:600">${esc(l.name)}</div>
      <input type="number" min="0" data-q="${i}" value="${l.qty}">
      <div class="t-num" style="align-self:center">${money(l.price * l.qty)}</div>
      <button class="btn btn-danger btn-sm" data-x="${i}">✕</button></div>`).join('') || `<div class="empty">${t('لا أصناف')}</div>`;
    const sub = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const taxable = Math.max(0, sub - (+$('#eo-disc', m).value || 0));
    $('#eo-total', m).textContent = money(taxable + taxable * (taxRate / 100));
    $$('#eo-lines [data-q]', m).forEach(inp => inp.oninput = () => { lines[+inp.dataset.q].qty = +inp.value || 0; draw(); });
    $$('#eo-lines [data-x]', m).forEach(b => b.onclick = () => { lines.splice(+b.dataset.x, 1); draw(); });
  };
  draw();
  $('#eo-disc', m).oninput = draw;
  $('#eo-add', m).onchange = () => { const p = prods.find(x => x.id === +$('#eo-add', m).value); if (p) { lines.push({ product_id: p.id, name: p.name_ar, price: p.price, qty: 1, note: '' }); draw(); } $('#eo-add', m).value = ''; };
  $('#eo-x', m).onclick = () => m.remove();
  $('#eo-save', m).onclick = async () => {
    const items = lines.filter(l => l.qty > 0).map(l => ({ product_id: l.product_id, qty: l.qty, note: l.note }));
    if (!items.length) return $('#eo-e', m).textContent = t('أضف صنفاً واحداً على الأقل');
    try { await api('/orders/' + o.id, { method: 'PUT', body: { items, discount: +$('#eo-disc', m).value || 0 } }); m.remove(); toast(t('تم تعديل الفاتورة ✅')); route(); } catch (e) { $('#eo-e', m).textContent = e.message; }
  };
}
// دفع طلب قائم — نقدي أو انستاباي
function payExisting(o) {
  const methods = META.payment_methods;
  let method = methods[0] || { id: null, kind: 'cash' };
  const m = modal(`<h3>💵 ${t('💵 دفع')} ${esc(o.invoice_no)}</h3>
    ${payMethodsHTML(method.id)}
    <div class="sumline total"><span>${t('المطلوب')}</span><span>${money(o.total)}</span></div>
    <div id="pay-cash-box"><div class="field"><label>${t('المبلغ المدفوع (نقداً)')}</label><input id="tendered" type="number" value="${Math.ceil(o.total)}"></div>
      <div class="change-big" id="change"></div></div>
    <div id="pay-ref-box" class="hidden"><div class="field"><label>${L('رقم مرجع التحويل (اختياري)', 'Transfer reference (optional)')}</label><input id="pay-ref" placeholder="InstaPay ref"></div></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="x">${t('إلغاء')}</button><button class="btn btn-primary" id="go">${t('تأكيد')}</button></div>`);
  const syncMethod = () => { const cash = method.kind === 'cash'; $('#pay-cash-box', m).classList.toggle('hidden', !cash); $('#pay-ref-box', m).classList.toggle('hidden', cash); };
  const upd = () => { const ch = (+$('#tendered', m).value || 0) - o.total; $('#change', m).textContent = t('الباقي') + ': ' + money(ch > 0 ? ch : 0); };
  $$('.pay-m', m).forEach(b => b.onclick = () => { method = methods.find(x => x.id === +b.dataset.pm); $$('.pay-m', m).forEach(x => x.classList.toggle('active', x === b)); syncMethod(); });
  upd(); syncMethod(); $('#tendered', m).oninput = upd;
  $('#x', m).onclick = () => m.remove();
  $('#go', m).onclick = async () => {
    try {
      const cash = method.kind === 'cash';
      const r = await api(`/orders/${o.id}/pay`, { method: 'POST', body: { payment_method_id: method.id, paid_cash: cash ? (+$('#tendered', m).value || 0) : o.total } });
      m.remove(); toast(t('تم الدفع وأُرسل للتحضير ✅ — ') + r.invoice_no); printReceipt(r); route();
    } catch (e) { toast(e.message, 'err'); }
  };
}

// ===================================================================
//  شاشات المحطات (المطبخ + البار) — نفس النموذج
// ===================================================================
function stationScreen(view, station) {
  const isKitchen = station === 'kitchen';
  const ep = isKitchen ? '/kds' : '/bar';
  const title = isKitchen ? t('شاشة المطبخ') : t('شاشة البار');
  const icon = isKitchen ? '👨‍🍳' : '🍹';
  const render = async () => {
    const orders = await api(ep);
    view.innerHTML = `<div class="page-head"><div><h2>${icon} ${title}</h2><div class="crumb">${t('الطلبات الجارية — اضغط على الصنف لتغيير حالته')}</div></div>
      <div class="head-actions"><button class="btn btn-sand" id="st-req">${t('+ طلب شراء')}</button><button class="btn btn-ghost" id="kds-refresh">${t('🔄 تحديث')}</button></div></div>
      <div class="kds-grid">${orders.map(o => `<div class="kds-card">
        <div class="kh"><span class="inv">${esc(o.invoice_no)} ${LL(TYPE, o.order_type)}</span><span class="ago">${esc(o.table_name || '')} • ${ago(o.created_at)}</span></div>
        ${o.items.map(i => `<div class="kds-item ${i.kds_status === 'served' || i.kds_status === 'ready' ? 'done' : ''}" data-i="${i.id}" data-s="${i.kds_status}">
          <div class="ki-nm">${i.qty}× ${esc(i.name_ar)}${i.note ? `<small>↳ ${esc(i.note)}</small>` : ''}</div>${stBadge(i.kds_status)}</div>`).join('')}
        </div>`).join('') || `<div class="card"><div class="empty">${t('لا طلبات في المطبخ حالياً 🎉')}</div></div>`}</div>`;
    $('#kds-refresh').onclick = render;
    $('#st-req').onclick = () => openPurchaseRequest();
    $$('.kds-item').forEach(it => it.onclick = async () => {
      const flow = { new: 'preparing', preparing: 'ready', ready: 'served', served: 'served' };
      await api(`/order-items/${it.dataset.i}/status`, { method: 'POST', body: { status: flow[it.dataset.s] } });
      render(); refreshKDSBadge();
    });
  };
  render();
}
ROUTES.kds = (view) => stationScreen(view, 'kitchen');
ROUTES.bar = (view) => stationScreen(view, 'bar');

// نافذة طلب شراء (من المطبخ/البار/الأدمن)
async function openPurchaseRequest() {
  const materials = await api('/materials');
  const m = modal(`<h3>🛒 ${t('طلب شراء')}</h3>
    <div class="field"><label>${t('مادة من المخزن')}</label><select id="pr-mat"><option value="">— ${t('أو اكتب اسم مادة جديدة')} —</option>${materials.map(x => `<option value="${x.id}">${esc(x.name_ar)} (${x.unit || ''}) — ${num(x.qty, 1)}</option>`).join('')}</select></div>
    <div class="field"><label>${t('أو اكتب اسم مادة جديدة')}</label><input id="pr-name" placeholder="${L('مثال: أكواب ٣٦٠ مل', 'e.g. cups 360ml')}"></div>
    <div class="row"><div class="field"><label>${t('الكمية المطلوبة')}</label><input id="pr-qty" type="number" step="any" value="1"></div>
      <div class="field"><label>${t('ملاحظات')}</label><input id="pr-note"></div></div>
    <div class="err" id="pr-e"></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="pr-x">${t('إلغاء')}</button><button class="btn btn-primary" id="pr-go">${t('إرسال الطلب')}</button></div>`);
  $('#pr-x', m).onclick = () => m.remove();
  $('#pr-go', m).onclick = async () => {
    const body = { material_id: +$('#pr-mat', m).value || null, custom_name: $('#pr-name', m).value.trim(), qty: +$('#pr-qty', m).value || 1, note: $('#pr-note', m).value.trim() };
    if (!body.material_id && !body.custom_name) return $('#pr-e', m).textContent = t('حدّد المادة المطلوبة');
    try { await api('/purchase-requests', { method: 'POST', body }); m.remove(); toast(t('تم إرسال طلب الشراء ✅')); if (location.hash.includes('requests')) route(); } catch (e) { $('#pr-e', m).textContent = e.message; }
  };
}

// ===================================================================
//  شاشة طلبات الشراء
// ===================================================================
const PR_STATUS = { pending: ['قيد الانتظار', 'Pending', 'amber'], fulfilled: ['تم التنفيذ', 'Fulfilled', 'green'], rejected: ['مرفوض', 'Rejected', 'red'] };
ROUTES.requests = async (view) => {
  const isAdmin = can('staff');
  const render = async () => {
    const rows = await api('/purchase-requests');
    view.innerHTML = `<div class="page-head"><div><h2>🛒 ${t('طلبات الشراء')}</h2><div class="crumb">${isAdmin ? L('طلبات المطبخ والبار — نفّذها لتحديث المخزون', 'Kitchen & bar requests — fulfill to update stock') : L('طلباتك للمخزن', 'Your stock requests')}</div></div>
      <div class="head-actions"><button class="btn btn-primary" id="pr-new">${t('+ طلب شراء')}</button></div></div>
      <div class="card"><div class="t-wrap"><table><thead><tr><th>#</th><th>${t('المادة')}</th><th>${t('الكمية')}</th><th>${L('المحطة', 'Station')}</th><th>${t('الطالب')}</th><th>${t('الحالة')}</th><th>${t('الوقت')}</th>${isAdmin ? '<th></th>' : ''}</tr></thead><tbody>
      ${rows.map(r => { const st = PR_STATUS[r.status] || PR_STATUS.pending; return `<tr>
        <td>#${r.id}</td><td><b>${esc(r.material || r.custom_name)}</b>${r.note ? `<br><small style="color:var(--text2)">${esc(r.note)}</small>` : ''}</td>
        <td class="t-num">${num(r.qty, 1)} ${esc(r.unit || '')}</td><td>${r.station === 'kitchen' ? '👨‍🍳' : r.station === 'bar' ? '🍹' : ''} ${r.station ? (r.station === 'kitchen' ? L('مطبخ', 'Kitchen') : L('بار', 'Bar')) : '—'}</td>
        <td>${esc(r.requested_name || '')}</td><td><span class="chip ${st[2] === 'green' ? 'ok' : st[2] === 'red' ? 'low' : ''}">${L(st[0], st[1])}</span></td>
        <td style="color:var(--text3)">${dt(r.created_at)}</td>
        ${isAdmin ? `<td style="white-space:nowrap">${r.status === 'pending' ? `<button class="btn btn-primary btn-sm" data-f="${r.id}">${t('تنفيذ')}</button> <button class="btn btn-ghost btn-sm" data-rj="${r.id}">${t('رفض')}</button>` : (esc(r.handled_name || '—'))}</td>` : ''}</tr>`; }).join('') || `<tr><td colspan="${isAdmin ? 8 : 7}" class="empty">${t('لا طلبات شراء')}</td></tr>`}
      </tbody></table></div></div>`;
    $('#pr-new').onclick = () => openPurchaseRequest();
    $$('#view [data-f]', view).forEach(b => b.onclick = async () => { await api(`/purchase-requests/${b.dataset.f}/fulfill`, { method: 'POST', body: {} }); toast(t('تم التنفيذ')); render(); refreshNotifBadge(); });
    $$('#view [data-rj]', view).forEach(b => b.onclick = async () => { await api(`/purchase-requests/${b.dataset.rj}/reject`, { method: 'POST', body: {} }); toast(t('مرفوض')); render(); });
  };
  render();
};

// ===================================================================
//  شاشة الإشعارات
// ===================================================================
ROUTES.notifications = async (view) => {
  const rows = await api('/notifications');
  view.innerHTML = `<div class="page-head"><div><h2>🔔 ${t('الإشعارات')}</h2><div class="crumb">${L('كل التنبيهات والعمليات على مستواك', 'All alerts and operations for your level')}</div></div>
    <div class="head-actions"><button class="btn btn-ghost" id="n-read">${t('تعليم الكل كمقروء')}</button></div></div>
    <div class="card">${rows.length ? rows.map(n => `<div class="notif ${n.is_read ? '' : 'unread'}">
      <span class="n-ic">${n.icon || '🔔'}</span>
      <div class="n-body"><div class="n-title">${esc(n.title)}</div>${n.body ? `<div class="n-text">${esc(n.body)}</div>` : ''}<div class="n-time">${dt(n.created_at)}</div></div>
      ${n.is_read ? '' : '<span class="n-dot"></span>'}</div>`).join('') : `<div class="empty">${t('لا إشعارات')}</div>`}</div>`;
  $('#n-read').onclick = async () => { await api('/notifications/read-all', { method: 'POST', body: {} }); toast(t('تم الحفظ ✅')); refreshNotifBadge(); route(); };
  api('/notifications/read-all', { method: 'POST', body: {} }).then(refreshNotifBadge);
};

// ===================================================================
//  الأصناف والوصفات
// ===================================================================
ROUTES.products = async (view) => {
  const prods = await api('/products');
  prods.forEach(p => p.margin = p.price ? ((p.price - p.cost) / p.price * 100) : 0);
  let sortKey = null, sortDir = 1, query = '';
  const COLS = [
    { k: 'name_ar', t: 'الصنف' }, { k: 'category', t: 'التصنيف' }, { k: 'price', t: 'السعر' },
    { k: 'cost', t: 'تكلفة المكونات' }, { k: 'margin', t: 'هامش الربح' }, { k: 'track_stock', t: 'خصم مخزون' },
  ];
  view.innerHTML = `<div class="page-head"><div><h2>🍽️ ${t('الأصناف والوصفات')}</h2><div class="crumb">${t('عرّف الأصناف واربطها بمكوناتها الخام (الوصفة) لتُخصم تلقائياً عند البيع')}</div></div>
    <div class="head-actions"><button class="btn btn-ghost" id="p-export">⬇ ${L('تصدير الأصناف والمكونات', 'Export items & ingredients')}</button><button class="btn btn-primary" id="p-new">${t('+ صنف جديد')}</button></div></div>
    <div class="toolbar"><input type="search" id="p-q" placeholder="${t('🔍 ابحث عن صنف…')}" style="min-width:240px"><span class="chip" id="p-count"></span></div>
    <div class="card"><div class="t-wrap"><table><thead><tr>
      ${COLS.map(c => `<th class="th-sort" data-k="${c.k}">${t(c.t)} <span class="s-ar"><span class="up">▲</span><span class="dn">▼</span></span></th>`).join('')}<th></th>
    </tr></thead><tbody id="p-body"></tbody></table></div></div>`;

  const drawBody = () => {
    let list = prods.filter(p => !query || p.name_ar.toLowerCase().includes(query) || (p.category || '').toLowerCase().includes(query));
    if (sortKey) list = [...list].sort((a, b) => {
      const va = a[sortKey] ?? '', vb = b[sortKey] ?? '';
      const cmp = (typeof va === 'number' && typeof vb === 'number') ? va - vb : String(va).localeCompare(String(vb), 'ar');
      return cmp * sortDir;
    });
    $('#p-count').textContent = num(list.length) + ' / ' + num(prods.length);
    $('#p-body').innerHTML = list.map(p => `<tr>
      <td><b>${p.image || ''} ${esc(p.name_ar)}</b>${p.low_ing ? `<span class="ing-warn" title="${L('مكوّن قارب على النفاد', 'ingredient running low')}">⚠️ ${L('مكوّن منخفض', 'low ingredient')}</span>` : ''}</td>
      <td>${esc(p.category || '—')}</td><td class="t-num">${money(p.price)}</td>
      <td class="t-num">${money(p.cost)}</td><td><span class="chip ${p.margin < 40 ? 'low' : 'ok'}">${num(p.margin, 0)}%</span></td>
      <td>${p.track_stock ? '✅' : '—'}</td>
      <td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" data-r="${p.id}">${t('🧪 الوصفة')}</button> <button class="btn btn-ghost btn-sm" data-e="${p.id}">${t('تعديل')}</button> <button class="btn btn-danger btn-sm" data-del="${p.id}" title="${t('حذف')}">🗑</button></td></tr>`).join('')
      || `<tr><td colspan="7" class="empty">${t('لا أصناف')}</td></tr>`;
    $$('#p-body [data-e]').forEach(b => b.onclick = () => editProduct(prods.find(p => p.id === +b.dataset.e)));
    $$('#p-body [data-r]').forEach(b => b.onclick = () => editRecipe(+b.dataset.r));
    $$('#p-body [data-del]').forEach(b => b.onclick = () => {
      const p = prods.find(x => x.id === +b.dataset.del);
      confirmDialog(L(`حذف «${p.name_ar}» نهائياً؟`, `Delete "${p.name_ar}" permanently?`), async () => {
        try { await api('/products/' + p.id, { method: 'DELETE' }); prods.splice(prods.indexOf(p), 1); toast(t('حُذف')); drawBody(); }
        catch (e) { toast(e.message, 'err'); }
      });
    });
  };
  const drawArrows = () => $$('.th-sort').forEach(th => {
    th.classList.toggle('asc', th.dataset.k === sortKey && sortDir === 1);
    th.classList.toggle('desc', th.dataset.k === sortKey && sortDir === -1);
  });
  $$('.th-sort').forEach(th => th.onclick = () => {
    if (sortKey === th.dataset.k) { if (sortDir === 1) sortDir = -1; else { sortKey = null; sortDir = 1; } }
    else { sortKey = th.dataset.k; sortDir = 1; }
    drawArrows(); drawBody();
  });
  $('#p-q').oninput = () => { query = $('#p-q').value.trim().toLowerCase(); drawBody(); };
  $('#p-new').onclick = () => editProduct(null);
  $('#p-export').onclick = async () => {
    const data = await api('/products-export');
    exportExcel('seaside-products-' + todayStr(), data.map(p => ({
      [L('الصنف', 'Item')]: p.name_ar,
      [L('التصنيف', 'Category')]: p.category || '',
      [L('السعر', 'Price')]: p.price,
      [L('تكلفة المكونات', 'Ingredient cost')]: p.cost,
      [L('المحطة', 'Station')]: p.station === 'kitchen' ? L('مطبخ', 'Kitchen') : L('بار', 'Bar'),
      [L('مفعّل', 'Active')]: p.is_active ? '✓' : '✗',
      [L('المكونات (الوصفة)', 'Ingredients (recipe)')]: p.recipe.map(r => `${r.name_ar} × ${num(r.qty, 2)} ${r.unit || ''}`).join(' ؛ ') || '—',
    })));
  };
  drawBody();
};
function editProduct(p) {
  const cats = META.categories;
  const m = modal(`<h3>${p ? t('تعديل صنف') : t('صنف جديد')}</h3>
    <div class="row"><div class="field"><label>${t('اسم الصنف')}</label><input id="f-name" value="${esc(p?.name_ar || '')}"></div>
      <div class="field"><label>${t('الأيقونة (إيموجي)')}</label><input id="f-img" value="${esc(p?.image || '🍽️')}" style="max-width:90px"></div></div>
    <div class="row"><div class="field"><label>${t('التصنيف')}</label><select id="f-cat"><option value="">${t('— بدون —')}</option>${cats.map(c => `<option value="${c.id}" ${p?.category_id == c.id ? 'selected' : ''}>${c.icon} ${esc(c.name_ar)}</option>`).join('')}</select></div>
      <div class="field"><label>${t('سعر البيع')}</label><input id="f-price" type="number" value="${p?.price || 0}"></div></div>
    <div class="field"><label>${L('محطة التحضير', 'Prep station')}</label><select id="f-station">
      <option value="bar" ${p?.station !== 'kitchen' ? 'selected' : ''}>🍹 ${L('البار', 'Bar')}</option>
      <option value="kitchen" ${p?.station === 'kitchen' ? 'selected' : ''}>👨‍🍳 ${L('المطبخ', 'Kitchen')}</option></select></div>
    <div class="field"><label><input type="checkbox" id="f-track" ${p?.track_stock !== 0 ? 'checked' : ''} style="width:auto"> ${t('خصم المكونات من المخزن عند البيع')}</label></div>
    ${p ? `<div class="field"><label><input type="checkbox" id="f-active" ${p.is_active ? 'checked' : ''} style="width:auto"> ${t('صنف مُفعّل (يظهر في الكاشير)')}</label></div>` : ''}
    <div class="err" id="pe"></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="f-x">${t('إلغاء')}</button><button class="btn btn-primary" id="f-save">${t('حفظ')}</button></div>`);
  $('#f-x', m).onclick = () => m.remove();
  $('#f-save', m).onclick = async () => {
    const body = { name_ar: $('#f-name', m).value.trim(), image: $('#f-img', m).value.trim(), category_id: +$('#f-cat', m).value || null, price: +$('#f-price', m).value || 0, station: $('#f-station', m).value, track_stock: $('#f-track', m).checked ? 1 : 0 };
    if (p) body.is_active = $('#f-active', m).checked ? 1 : 0;
    if (!body.name_ar) return $('#pe', m).textContent = t('الاسم مطلوب');
    try { await api(p ? '/products/' + p.id : '/products', { method: p ? 'PUT' : 'POST', body }); m.remove(); toast(t('تم الحفظ ✅')); route(); } catch (e) { $('#pe', m).textContent = e.message; }
  };
}
async function editRecipe(pid) {
  const [p, materials] = await Promise.all([api('/products/' + pid), api('/materials')]);
  let lines = p.recipe.map(r => ({ material_id: r.material_id, qty: r.qty }));
  const m = modal(`<h3>🧪 ${L('وصفة', 'Recipe')}: ${esc(p.name_ar)}</h3>
    <p style="color:var(--text2);font-size:13px;margin-bottom:14px">${t('حدّد المكونات الخام والكمية بالوحدة الصغرى. تُخصم تلقائياً من المخزن لحظة البيع.')}</p>
    <div id="rl"></div>
    <button class="btn btn-ghost btn-sm" id="r-add">${t('+ إضافة مكوّن')}</button>
    <div class="cost-summary"><div>${t('تكلفة المكونات للصنف')}<div class="profit-tag" id="r-margin"></div></div><div class="big" id="r-cost">—</div></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="r-x">${t('إلغاء')}</button><button class="btn btn-primary" id="r-save">${t('💾 حفظ وتحديث التكلفة')}</button></div>`, 'wide');
  const matOpts = (sel) => materials.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name_ar)} (${x.unit || ''})</option>`).join('');
  const draw = () => {
    $('#rl', m).innerHTML = lines.map((l, i) => {
      const mat = materials.find(x => x.id === l.material_id) || materials[0];
      const lineCost = (mat?.avg_cost || 0) * l.qty;
      return `<div class="recipe-line">
        <select data-mi="${i}">${matOpts(l.material_id)}</select>
        <input type="number" step="any" data-qi="${i}" value="${l.qty}" placeholder="${t('الكمية')}">
        <div class="rl-cost">${money(lineCost)}<br><small>${mat?.unit || ''} • ${mat?.low ? t('⚠️منخفض') : t('متوفر')}</small></div>
        <button class="btn btn-danger btn-sm" data-di="${i}">✕</button></div>`;
    }).join('') || `<div class="empty">${t('لا مكونات بعد — أضف مكوّناً')}</div>`;
    const cost = lines.reduce((s, l) => { const mat = materials.find(x => x.id === l.material_id); return s + (mat?.avg_cost || 0) * l.qty; }, 0);
    $('#r-cost', m).textContent = money(cost);
    const margin = p.price ? ((p.price - cost) / p.price * 100) : 0;
    $('#r-margin', m).textContent = `${t('سعر البيع')} ${money(p.price)} • ${t('هامش')} ${num(margin, 0)}%`;
    $$('#rl [data-mi]', m).forEach(s => s.onchange = () => { lines[+s.dataset.mi].material_id = +s.value; draw(); });
    $$('#rl [data-qi]', m).forEach(inp => inp.oninput = () => { lines[+inp.dataset.qi].qty = +inp.value || 0; draw(); });
    $$('#rl [data-di]', m).forEach(b => b.onclick = () => { lines.splice(+b.dataset.di, 1); draw(); });
  };
  draw();
  $('#r-add', m).onclick = () => { lines.push({ material_id: materials[0]?.id, qty: 1 }); draw(); };
  $('#r-x', m).onclick = () => m.remove();
  $('#r-save', m).onclick = async () => { try { const r = await api(`/products/${pid}/recipe`, { method: 'PUT', body: { recipe: lines } }); m.remove(); toast(t('حُفظت الوصفة — التكلفة: ') + money(r.cost)); route(); } catch (e) { toast(e.message, 'err'); } };
}

// ===================================================================
//  المخزون
// ===================================================================
ROUTES.inventory = async (view) => {
  view.innerHTML = `<div class="page-head"><div><h2>📦 ${t('المخزون')}</h2><div class="crumb">${t('أرصدة المواد الخام بالوحدة الصغرى وقيمتها')}</div></div>
    <div class="head-actions"><button class="btn btn-ghost" id="inv-alerts">🔔 ${L('تنبيهات', 'Alerts')}</button><button class="btn btn-ghost" id="inv-units">📏 ${L('الوحدات', 'Units')}</button>${can('purchases') ? `<button class="btn btn-ghost" id="inv-tx">${t('📜 حركة المخزن')}</button>` : ''}<button class="btn btn-primary" id="inv-mat">${t('+ مادة خام')}</button></div></div>
    <div class="toolbar"><select id="inv-wh"><option value="">${t('كل المخازن')}</option>${META.warehouses.map(w => `<option value="${w.id}">${esc(w.name_ar)}</option>`).join('')}</select></div>
    <div class="kpi-grid" id="inv-kpi"></div>
    <div class="card"><div class="t-wrap"><table><thead><tr><th>${t('الكود')}</th><th>${t('المادة')}</th><th>${t('المخزن')}</th><th>${t('الرصيد')}</th><th>${t('متوسط التكلفة')}</th><th>${t('قيمة المخزون')}</th><th>${t('الحالة')}</th><th></th></tr></thead><tbody id="inv-body"></tbody></table></div></div>`;
  const load = async () => {
    const w = $('#inv-wh').value;
    const d = await api('/inventory' + (w ? '?warehouse=' + w : ''));
    $('#inv-kpi').innerHTML = `
      <div class="kpi"><div class="lbl">${t('عدد المواد')}</div><div class="val">${num(d.rows.length)}</div><span class="ic">📦</span></div>
      <div class="kpi green"><div class="lbl">${t('قيمة المخزون')}</div><div class="val">${money(d.totalValue)}</div><span class="ic">💰</span></div>
      <div class="kpi amber"><div class="lbl">${t('مواد تحت حد الطلب')}</div><div class="val">${num(d.lowCount)}</div><span class="ic">⚠️</span></div>`;
    $('#inv-body').innerHTML = d.rows.map(mm => {
      const ratio = mm.reorder_point ? Math.min(100, mm.qty / (mm.reorder_point * 2) * 100) : 100;
      const cls = mm.low ? 'low' : (ratio < 60 ? 'mid' : '');
      return `<tr><td style="color:var(--text3)">${esc(mm.code || '')}</td><td><b>${esc(mm.name_ar)}</b><div class="bar"><span class="${cls}" style="width:${ratio}%"></span></div></td>
        <td>${esc(mm.warehouse || '—')}</td><td class="t-num">${num(mm.qty, 1)} ${esc(mm.unit || '')}</td><td class="t-num">${money(mm.avg_cost)}</td>
        <td class="t-num">${money(mm.value)}</td><td>${mm.low ? `<span class="chip low">${t('منخفض')}</span>` : `<span class="chip ok">${t('متوفر')}</span>`}</td>
        <td><button class="btn btn-ghost btn-sm" data-m='${mm.id}'>${t('تعديل')}</button></td></tr>`;
    }).join('') || `<tr><td colspan="8" class="empty">${t('لا مواد')}</td></tr>`;
    $$('#inv-body [data-m]', view).forEach(b => b.onclick = () => editMaterial(d.rows.find(x => x.id === +b.dataset.m)));
  };
  $('#inv-wh').onchange = load;
  $('#inv-mat').onclick = () => editMaterial(null);
  $('#inv-alerts').onclick = showAlerts;
  $('#inv-units').onclick = manageUnits;
  const txBtn = $('#inv-tx'); if (txBtn) txBtn.onclick = showTransactions;
  load();
};
async function manageUnits() {
  const m = modal(`<h3>📏 ${L('إدارة الوحدات', 'Manage units')}</h3>
    <p style="color:var(--text2);font-size:13px;margin-bottom:12px">${L('الوحدات الصغرى المستخدمة لقياس المواد الخام (جرام، مليلتر، حبة...).', 'Base units for measuring raw materials (gram, ml, piece...).')}</p>
    <div id="um-body"></div>
    <div class="row" style="margin-top:12px;align-items:end">
      <div class="field" style="margin:0"><label>${L('وحدة جديدة', 'New unit')}</label><input id="nu-name" placeholder="${L('الاسم', 'Name')}"></div>
      <div class="field" style="margin:0;max-width:100px"><label>${L('الرمز', 'Symbol')}</label><input id="nu-sym"></div>
      <button class="btn btn-primary" id="nu-add">${t('إضافة')}</button>
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" id="um-x">${t('إغلاق')}</button></div>`, 'wide');
  const render = async () => {
    const units = await api('/admin/units');
    $('#um-body', m).innerHTML = `<div class="t-wrap"><table><thead><tr><th>${L('الاسم', 'Name')}</th><th>${L('الرمز', 'Symbol')}</th><th>${L('مفعّل', 'Active')}</th><th></th></tr></thead><tbody>
      ${units.map(u => `<tr>
        <td><input data-n="${u.id}" value="${esc(u.name_ar)}" style="width:100%;padding:6px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface2);color:var(--text)"></td>
        <td><input data-s="${u.id}" value="${esc(u.symbol)}" style="width:70px;padding:6px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface2);color:var(--text)"></td>
        <td><input type="checkbox" data-a="${u.id}" ${u.is_active ? 'checked' : ''}></td>
        <td><button class="btn btn-ghost btn-sm" data-save="${u.id}">${t('حفظ')}</button></td></tr>`).join('')}
    </tbody></table></div>`;
    $$('#um-body [data-save]', m).forEach(b => b.onclick = async () => {
      const id = b.dataset.save;
      await api('/admin/units/' + id, { method: 'PUT', body: { name_ar: $(`[data-n="${id}"]`, m).value, symbol: $(`[data-s="${id}"]`, m).value, is_active: $(`[data-a="${id}"]`, m).checked ? 1 : 0 } });
      toast(t('تم الحفظ ✅')); META = await api('/meta');
    });
  };
  $('#um-x', m).onclick = () => m.remove();
  $('#nu-add', m).onclick = async () => {
    const name = $('#nu-name', m).value.trim(); if (!name) return;
    await api('/admin/units', { method: 'POST', body: { name_ar: name, symbol: $('#nu-sym', m).value.trim() || name, is_active: 1 } });
    $('#nu-name', m).value = ''; $('#nu-sym', m).value = ''; META = await api('/meta'); render();
  };
  render();
};
function editMaterial(mat) {
  const m = modal(`<h3>${mat ? t('تعديل مادة خام') : t('مادة خام جديدة')}</h3>
    <div class="row"><div class="field"><label>${L('اسم المادة', 'Material name')}</label><input id="m-name" value="${esc(mat?.name_ar || '')}"></div>
      <div class="field"><label>${t('الكود')}</label><input id="m-code" value="${esc(mat?.code || '')}"></div></div>
    <div class="row"><div class="field"><label>${t('الوحدة الصغرى')}</label><select id="m-unit">${META.units.map(u => `<option value="${u.id}" ${mat?.unit_id == u.id ? 'selected' : ''}>${esc(u.name_ar)} (${u.symbol})</option>`).join('')}</select></div>
      <div class="field"><label>${t('المخزن')}</label><select id="m-wh">${META.warehouses.map(w => `<option value="${w.id}" ${mat?.warehouse_id == w.id ? 'selected' : ''}>${esc(w.name_ar)}</option>`).join('')}</select></div></div>
    <div class="row" style="background:var(--sea-light);padding:10px;border-radius:10px">
      <div class="field" style="margin:0"><label>${L('وحدة الشراء', 'Purchase unit')}</label><select id="m-punit">${META.units.map(u => `<option value="${u.id}" ${(mat?.purchase_unit_id || mat?.unit_id) == u.id ? 'selected' : ''}>${esc(u.name_ar)} (${u.symbol})</option>`).join('')}</select></div>
      <div class="field" style="margin:0"><label>${L('الوحدة الصغرى داخل وحدة الشراء', 'Base units per purchase unit')}</label><input id="m-pfactor" type="number" step="any" value="${mat?.purchase_factor ?? 1}"></div></div>
    <div style="font-size:12px;color:var(--text2);margin:-4px 0 8px">${L('مثال: لو الشراء بالكيلو والوحدة الصغرى جرام → اكتب 1000', 'e.g. buy by kilo, base unit gram → enter 1000')}</div>
    <div class="row"><div class="field"><label>${t('الرصيد الحالي')}</label><input id="m-qty" type="number" step="any" value="${mat?.qty ?? 0}"></div>
      <div class="field"><label>${t('متوسط التكلفة (للوحدة)')}</label><input id="m-cost" type="number" step="any" value="${mat?.avg_cost ?? 0}"></div>
      <div class="field"><label>${t('حد إعادة الطلب')}</label><input id="m-re" type="number" step="any" value="${mat?.reorder_point ?? 0}"></div></div>
    <div class="err" id="me"></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="m-x">${t('إلغاء')}</button><button class="btn btn-primary" id="m-save">${t('حفظ')}</button></div>`, 'wide');
  $('#m-x', m).onclick = () => m.remove();
  $('#m-save', m).onclick = async () => {
    const body = { name_ar: $('#m-name', m).value.trim(), code: $('#m-code', m).value.trim(), unit_id: +$('#m-unit', m).value, warehouse_id: +$('#m-wh', m).value, qty: +$('#m-qty', m).value || 0, avg_cost: +$('#m-cost', m).value || 0, reorder_point: +$('#m-re', m).value || 0, purchase_unit_id: +$('#m-punit', m).value, purchase_factor: +$('#m-pfactor', m).value || 1 };
    if (!body.name_ar) return $('#me', m).textContent = t('الاسم مطلوب');
    try { await api(mat ? '/materials/' + mat.id : '/materials', { method: mat ? 'PUT' : 'POST', body }); m.remove(); toast(t('تم الحفظ ✅')); route(); } catch (e) { $('#me', m).textContent = e.message; }
  };
}
async function showTransactions() {
  const rows = await api('/inventory/transactions');
  const TX = { purchase: ['🟢 ' + L('شراء', 'Purchase'), 'var(--green)'], sale: ['🔵 ' + L('بيع', 'Sale'), 'var(--sea-deep)'], waste: ['🔴 ' + L('تالف', 'Waste'), 'var(--red)'], adjust: ['🟡 ' + L('تسوية', 'Adjust'), 'var(--amber)'], count: ['🟣 ' + L('جرد', 'Count'), '#9b59b6'] };
  modal(`<h3>${t('📜 حركة المخزن (آخر ٢٠٠)')}</h3><div class="t-wrap" style="max-height:60vh;overflow:auto"><table><thead><tr><th>${t('المادة')}</th><th>${t('النوع')}</th><th>${t('الكمية')}</th><th>${t('الرصيد')}</th><th>${L('المرجع', 'Ref')}</th><th>${t('الوقت')}</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r.material)}</td><td style="color:${(TX[r.type] || [])[1]}">${(TX[r.type] || [r.type])[0]}</td>
      <td class="t-num" style="color:${r.qty < 0 ? 'var(--red)' : 'var(--green)'}">${r.qty > 0 ? '+' : ''}${num(r.qty, 1)} ${esc(r.unit || '')}</td>
      <td class="t-num">${num(r.balance, 1)}</td><td style="font-size:12px;color:var(--text2)">${esc(r.note || '')}</td><td style="color:var(--text3);font-size:12px">${dt(r.created_at)}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">${t('لا حركات')}</td></tr>`}
  </tbody></table></div><div class="modal-actions"><button class="btn btn-ghost" onclick="this.closest('.modal-bg').remove()">${t('إغلاق')}</button></div>`, 'xwide');
}

// ===================================================================
//  المشتريات
// ===================================================================
ROUTES.purchases = async (view) => {
  const rows = await api('/purchases');
  view.innerHTML = `<div class="page-head"><div><h2>🚚 ${t('المشتريات')}</h2><div class="crumb">${t('استلام فواتير الموردين — يُحدّث المخزون ومتوسط التكلفة تلقائياً')}</div></div>
    <div class="head-actions"><button class="btn btn-primary" id="pu-new">${t('+ فاتورة شراء')}</button></div></div>
    <div class="card"><div class="t-wrap"><table><thead><tr><th>${t('الرقم')}</th><th>${t('المورد')}</th><th>${t('المخزن')}</th><th>${t('عدد البنود')}</th><th>${t('الإجمالي')}</th><th>${t('الوقت')}</th></tr></thead><tbody>
    ${rows.map(p => `<tr><td>${esc(p.ref || '#' + p.id)}</td><td>${esc(p.supplier || '—')}</td><td>${esc(p.warehouse || '—')}</td><td class="t-num">${p.lines}</td><td class="t-num">${money(p.total)}</td><td style="color:var(--text3)">${dt(p.created_at)}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">${t('لا مشتريات بعد')}</td></tr>`}
    </tbody></table></div></div>`;
  $('#pu-new').onclick = newPurchase;
};
async function newPurchase() {
  const [materials, suppliers] = await Promise.all([api('/materials'), api('/admin/suppliers')]);
  const matById = (id) => materials.find(x => x.id === id) || {};
  const defCost = (mat, unit) => unit === 'purchase' ? +((mat.avg_cost || 0) * (mat.purchase_factor || 1)).toFixed(3) : (mat.avg_cost || 0);
  const newLine = (id) => { const mt = matById(id); const unit = (mt.purchase_factor > 1) ? 'purchase' : 'base'; return { material_id: id, unit, qty: 1, unit_cost: defCost(mt, unit) }; };
  let items = [newLine(materials[0]?.id)];
  const m = modal(`<h3>${t('🚚 فاتورة شراء جديدة')}</h3>
    <div class="row"><div class="field"><label>${t('المورد')}</label><select id="pu-sup"><option value="">${t('— بدون —')}</option>${suppliers.map(s => `<option value="${s.id}">${esc(s.name_ar)}</option>`).join('')}</select></div>
      <div class="field"><label>${t('المخزن المستلِم')}</label><select id="pu-wh">${META.warehouses.map(w => `<option value="${w.id}">${esc(w.name_ar)}</option>`).join('')}</select></div></div>
    <div class="row"><div class="field"><label>${t('رقم الفاتورة')}</label><input id="pu-ref"></div><div class="field"><label>${t('ضريبة الفاتورة')}</label><input id="pu-tax" type="number" value="0"></div></div>
    <div style="font-weight:700;margin:6px 0;color:var(--sea-deep)">${t('البنود')} <span style="font-weight:400;font-size:12px;color:var(--text2)">${L('اختر وحدة الشراء — النظام يحوّلها تلقائياً للمخزن', 'pick purchase unit — auto-converted to stock')}</span></div><div id="pu-lines"></div>
    <button class="btn btn-ghost btn-sm" id="pu-add">${t('+ بند')}</button>
    <div class="cost-summary"><div>${t('إجمالي الفاتورة')}</div><div class="big" id="pu-total">—</div></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="pu-x">${t('إلغاء')}</button><button class="btn btn-primary" id="pu-save">${t('💾 استلام وتحديث المخزون')}</button></div>`, 'wide');
  const opts = (sel) => materials.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name_ar)}</option>`).join('');
  const total = () => money(items.reduce((s, l) => s + l.qty * l.unit_cost, 0) + (+$('#pu-tax', m).value || 0));
  const draw = () => {
    $('#pu-lines', m).innerHTML = items.map((l, i) => {
      const mt = matById(l.material_id); const factor = mt.purchase_factor || 1;
      const baseQty = l.unit === 'purchase' ? l.qty * factor : l.qty;
      const baseCost = l.unit === 'purchase' ? (l.unit_cost / (factor || 1)) : l.unit_cost;
      const conv = l.unit === 'purchase' && factor > 1 ? `<div class="pu-conv">= ${num(baseQty, 1)} ${esc(mt.unit || '')} • ${money(baseCost)}/${esc(mt.unit || '')}</div>` : '';
      return `<div class="pu-line">
        <select data-mi="${i}">${opts(l.material_id)}</select>
        <select data-ui="${i}"><option value="purchase" ${l.unit === 'purchase' ? 'selected' : ''}>${esc(mt.purchase_unit || mt.unit || '')}</option><option value="base" ${l.unit === 'base' ? 'selected' : ''}>${esc(mt.unit || '')}</option></select>
        <input type="number" step="any" data-qi="${i}" value="${l.qty}" placeholder="${t('الكمية')}">
        <input type="number" step="any" data-ci="${i}" value="${l.unit_cost}" placeholder="${L('سعر الوحدة', 'unit price')}">
        <button class="btn btn-danger btn-sm" data-di="${i}">✕</button>${conv}</div>`;
    }).join('');
    $('#pu-total', m).textContent = total();
    $$('#pu-lines [data-mi]', m).forEach(s => s.onchange = () => { const i = +s.dataset.mi; items[i] = newLine(+s.value); draw(); });
    $$('#pu-lines [data-ui]', m).forEach(s => s.onchange = () => { const i = +s.dataset.ui; items[i].unit = s.value; items[i].unit_cost = defCost(matById(items[i].material_id), s.value); draw(); });
    $$('#pu-lines [data-qi]', m).forEach(inp => inp.oninput = () => { items[+inp.dataset.qi].qty = +inp.value || 0; draw(); });
    $$('#pu-lines [data-ci]', m).forEach(inp => inp.oninput = () => { items[+inp.dataset.ci].unit_cost = +inp.value || 0; $('#pu-total', m).textContent = total(); });
    $$('#pu-lines [data-di]', m).forEach(b => b.onclick = () => { items.splice(+b.dataset.di, 1); draw(); });
  };
  draw();
  $('#pu-tax', m).oninput = () => $('#pu-total', m).textContent = total();
  $('#pu-add', m).onclick = () => { items.push(newLine(materials[0]?.id)); draw(); };
  $('#pu-x', m).onclick = () => m.remove();
  $('#pu-save', m).onclick = async () => {
    try { await api('/purchases', { method: 'POST', body: { supplier_id: +$('#pu-sup', m).value || null, warehouse_id: +$('#pu-wh', m).value, ref: $('#pu-ref', m).value.trim(), tax: +$('#pu-tax', m).value || 0, items } });
      m.remove(); toast(t('تم الاستلام وتحديث المخزون ✅')); route(); } catch (e) { toast(e.message, 'err'); }
  };
}

// ===================================================================
//  التوالف والهدر
// ===================================================================
ROUTES.waste = async (view) => {
  const [rows, materials] = await Promise.all([api('/waste'), api('/materials')]);
  view.innerHTML = `<div class="page-head"><div><h2>🗑️ ${t('التوالف والهدر')}</h2><div class="crumb">${t('سجّل المواد التالفة لفصلها عن المبيعات وضبط الأرباح')}</div></div>
    <div class="head-actions"><button class="btn btn-sand" id="w-new">${t('+ تسجيل تالف')}</button></div></div>
    <div class="card"><div class="t-wrap"><table><thead><tr><th>${t('المادة')}</th><th>${t('الكمية')}</th><th>${t('التكلفة المهدرة')}</th><th>${t('السبب')}</th><th>${t('بواسطة')}</th><th>${t('الوقت')}</th></tr></thead><tbody>
    ${rows.map(w => `<tr><td>${esc(w.material)}</td><td class="t-num">${num(w.qty, 1)} ${esc(w.unit || '')}</td><td class="t-num" style="color:var(--red)">${money(w.cost)}</td><td>${esc(w.reason || '')}</td><td>${esc(w.by_name || '')}</td><td style="color:var(--text3)">${dt(w.created_at)}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">${t('لا توالف مسجلة ✅')}</td></tr>`}
    </tbody></table></div></div>`;
  $('#w-new').onclick = () => {
    const reasons = ['انتهاء صلاحية', 'خطأ تحضير', 'كسر / سقوط', 'إرجاع عميل', 'أخرى'];
    const m = modal(`<h3>${t('🗑️ تسجيل مادة تالفة')}</h3>
      <div class="field"><label>${t('المادة')}</label><select id="w-mat">${materials.map(x => `<option value="${x.id}">${esc(x.name_ar)} (${x.unit || ''}) — ${num(x.qty, 1)}</option>`).join('')}</select></div>
      <div class="row"><div class="field"><label>${t('الكمية التالفة')}</label><input id="w-qty" type="number" step="any" value="1"></div>
        <div class="field"><label>${t('السبب')}</label><select id="w-reason">${reasons.map(r => `<option value="${r}">${t(r)}</option>`).join('')}</select></div></div>
      <div class="err" id="we"></div>
      <div class="modal-actions"><button class="btn btn-ghost" id="w-x">${t('إلغاء')}</button><button class="btn btn-sand" id="w-save">${t('تسجيل وخصم')}</button></div>`);
    $('#w-x', m).onclick = () => m.remove();
    $('#w-save', m).onclick = async () => { try { const r = await api('/waste', { method: 'POST', body: { material_id: +$('#w-mat', m).value, qty: +$('#w-qty', m).value, reason: $('#w-reason', m).value } }); m.remove(); toast(t('سُجّل التالف — التكلفة: ') + money(r.cost), 'warn'); route(); } catch (e) { $('#we', m).textContent = e.message; } };
  };
};

// ===================================================================
//  الجرد (Variance)
// ===================================================================
ROUTES.stockcount = async (view) => {
  const rows = await api('/stock-counts');
  view.innerHTML = `<div class="page-head"><div><h2>🔍 ${t('الجرد')}</h2><div class="crumb">${t('طابِق الرصيد الدفتري مع الفعلي لكشف الهدر والعجز')}</div></div>
    <div class="head-actions"><button class="btn btn-primary" id="sc-new">${t('+ جرد جديد')}</button></div></div>
    <div class="card"><div class="t-wrap"><table><thead><tr><th>#</th><th>${t('المخزن')}</th><th>${t('الحالة')}</th><th>${t('عدد المواد')}</th><th>${t('بواسطة')}</th><th>${t('الوقت')}</th><th></th></tr></thead><tbody>
    ${rows.map(s => `<tr><td>#${s.id}</td><td>${esc(s.warehouse || t('الكل'))}</td><td>${s.status === 'open' ? `<span class="chip">${t('مفتوح')}</span>` : `<span class="chip ok">${t('مغلق')}</span>`}</td><td class="t-num">${s.lines}</td><td>${esc(s.by_name || '')}</td><td style="color:var(--text3)">${dt(s.created_at)}</td>
      <td><button class="btn btn-ghost btn-sm" data-s="${s.id}">${s.status === 'open' ? t('إدخال الجرد') : t('عرض الفروقات')}</button></td></tr>`).join('') || `<tr><td colspan="7" class="empty">${t('لا عمليات جرد')}</td></tr>`}
    </tbody></table></div></div>`;
  $('#sc-new').onclick = () => {
    const m = modal(`<h3>${t('🔍 بدء جرد جديد')}</h3>
      <div class="field"><label>${t('المخزن')}</label><select id="sc-wh"><option value="">${t('كل المخازن')}</option>${META.warehouses.map(w => `<option value="${w.id}">${esc(w.name_ar)}</option>`).join('')}</select></div>
      <p style="color:var(--text2);font-size:13px">${t('سيتم تجميد الرصيد الدفتري الحالي لكل مادة كمرجع للمقارنة.')}</p>
      <div class="modal-actions"><button class="btn btn-ghost" id="sc-x">${t('إلغاء')}</button><button class="btn btn-primary" id="sc-go">${t('بدء الجرد')}</button></div>`);
    $('#sc-x', m).onclick = () => m.remove();
    $('#sc-go', m).onclick = async () => { const r = await api('/stock-counts', { method: 'POST', body: { warehouse_id: +$('#sc-wh', m).value || null } }); m.remove(); openCount(r.id); };
  };
  $$('#view [data-s]', view).forEach(b => b.onclick = () => openCount(+b.dataset.s));
};
async function openCount(id) {
  const sc = await api('/stock-counts/' + id);
  const closed = sc.status === 'closed';
  const m = modal(`<h3>🔍 ${L('جرد', 'Count')} #${sc.id} — ${esc(sc.warehouse || t('كل المخازن'))} ${closed ? `<span class="chip ok">${t('مغلق')}</span>` : `<span class="chip">${t('مفتوح')}</span>`}</h3>
    ${closed ? '' : `<input id="sc-q" placeholder="${L('🔍 ابحث عن مادة…', '🔍 Search material…')}" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:10px;background:var(--surface2);color:var(--text);margin-bottom:8px">
    <div style="font-size:13px;color:var(--text2);margin-bottom:8px">${L('أدخل الكمية الفعلية الموجودة بالمخزن. المواد غير المُدخلة تبقى كما هي.', 'Enter the actual quantity in stock. Un-entered materials stay unchanged.')} <b id="sc-prog"></b></div>`}
    <div class="t-wrap" style="max-height:50vh;overflow:auto"><table><thead><tr><th>${t('المادة')}</th><th>${t('دفتري')}</th><th>${t('فعلي')}</th><th>${t('الفرق')}</th><th>${t('قيمة الفرق')}</th></tr></thead><tbody id="sc-body"></tbody></table></div>
    <div class="cost-summary"><div>${t('صافي فرق الجرد (− عجز / + فائض)')}</div><div class="big" id="sc-net">—</div></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="sc-cx">${t('إغلاق النافذة')}</button>
      ${closed ? '' : `<button class="btn btn-ghost" id="sc-save">${t('💾 حفظ مؤقت')}</button><button class="btn btn-primary" id="sc-close">${t('✅ إنهاء واعتماد الفروقات')}</button>`}</div>`, 'xwide');
  const rowHTML = (i) => {
    const actual = i.actual_qty;
    const diff = actual === null || actual === undefined ? null : +(actual - i.book_qty).toFixed(3);
    const val = diff === null ? 0 : diff * i.unit_cost;
    return `<td>${esc(i.name_ar)}</td><td class="t-num">${num(i.book_qty, 1)} ${esc(i.unit || '')}</td>
      <td>${closed ? num(actual, 1) : `<input type="number" step="any" data-i="${i.id}" value="${actual ?? ''}" style="width:90px;padding:6px;border:1.5px solid var(--border);border-radius:8px;background:var(--surface2);color:var(--text)">`}</td>
      <td class="t-num diff" style="color:${diff === null ? 'var(--text3)' : diff < 0 ? 'var(--red)' : diff > 0 ? 'var(--green)' : 'var(--text2)'}">${diff === null ? '—' : (diff > 0 ? '+' : '') + num(diff, 1)}</td>
      <td class="t-num dval">${diff === null ? '—' : money(val)}</td>`;
  };
  const recalc = () => {
    let net = 0, counted = 0;
    sc.items.forEach(i => { if (i.actual_qty !== null && i.actual_qty !== undefined) { counted++; net += (i.actual_qty - i.book_qty) * i.unit_cost; } });
    $('#sc-net', m).textContent = money(net); $('#sc-net', m).style.color = net < 0 ? 'var(--red)' : net > 0 ? 'var(--green)' : 'var(--text)';
    const pg = $('#sc-prog', m); if (pg) pg.textContent = `(${counted}/${sc.items.length})`;
  };
  // رسم الصفوف مرة واحدة (بدون إعادة بناء عند الكتابة → لا يضيع التركيز)
  $('#sc-body', m).innerHTML = sc.items.map(i => `<tr data-row="${i.id}">${rowHTML(i)}</tr>`).join('');
  recalc();
  $$('#sc-body [data-i]', m).forEach(inp => inp.oninput = () => {
    const it = sc.items.find(x => x.id === +inp.dataset.i);
    it.actual_qty = inp.value === '' ? null : +inp.value;
    const tr = inp.closest('tr'); const diff = it.actual_qty === null ? null : +(it.actual_qty - it.book_qty).toFixed(3);
    const dc = $('.diff', tr), vc = $('.dval', tr);
    dc.textContent = diff === null ? '—' : (diff > 0 ? '+' : '') + num(diff, 1);
    dc.style.color = diff === null ? 'var(--text3)' : diff < 0 ? 'var(--red)' : diff > 0 ? 'var(--green)' : 'var(--text2)';
    vc.textContent = diff === null ? '—' : money(diff * it.unit_cost);
    recalc();
  });
  const sq = $('#sc-q', m); if (sq) sq.oninput = () => { const q = sq.value.trim(); $$('#sc-body tr', m).forEach(tr => { const it = sc.items.find(x => x.id === +tr.dataset.row); tr.style.display = (!q || it.name_ar.includes(q)) ? '' : 'none'; }); };
  $('#sc-cx', m).onclick = () => m.remove();
  const save = async () => api('/stock-counts/' + id, { method: 'PUT', body: { items: sc.items.map(i => ({ id: i.id, actual_qty: i.actual_qty })) } });
  if (!closed) {
    $('#sc-save', m).onclick = async () => { await save(); toast(t('حُفظ مؤقتاً')); };
    $('#sc-close', m).onclick = () => confirmDialog(t('إنهاء الجرد واعتماد الفروقات كتسويات مخزنية؟'), async () => { await save(); await api(`/stock-counts/${id}/close`, { method: 'POST', body: {} }); m.remove(); toast(t('تم اعتماد الجرد ✅')); route(); }, false);
  }
}

// ===================================================================
//  المصروفات
// ===================================================================
ROUTES.expenses = async (view) => {
  const cats = await api('/expense-cats');
  const from = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  view.innerHTML = `<div class="page-head"><div><h2>💸 ${t('المصروفات')}</h2><div class="crumb">${L('سجّل المصروفات (إيجار، كهرباء…) لتُخصم من صافي الربح', 'Log expenses (rent, electricity…) deducted from net profit')}</div></div>
    <div class="head-actions"><button class="btn btn-primary" id="ex-new">${t('+ مصروف جديد')}</button></div></div>
    <div class="toolbar">${t('من')} <input type="date" id="ex-from" value="${from}"> ${t('إلى')} <input type="date" id="ex-to" value="${todayStr()}"></div>
    <div id="ex-body"><div class="loading">…</div></div>`;
  const load = async () => {
    const d = await api(`/expenses?from=${$('#ex-from').value}&to=${$('#ex-to').value}`);
    $('#ex-body').innerHTML = `
      <div class="kpi-grid">
        <div class="kpi amber"><div class="lbl">${t('إجمالي المصروفات')}</div><div class="val">${money(d.total)}</div><span class="ic">💸</span></div>
        ${d.byCat.slice(0, 3).map(c => `<div class="kpi"><div class="lbl">${c.icon || ''} ${esc(c.name_ar || '—')}</div><div class="val">${money(c.total)}</div></div>`).join('')}
      </div>
      <div class="card"><div class="t-wrap"><table><thead><tr><th>${t('تاريخ المصروف')}</th><th>${t('فئة المصروف')}</th><th>${t('قيمة المصروف')}</th><th>${t('ملاحظات')}</th><th>${t('بواسطة')}</th><th></th></tr></thead><tbody>
        ${d.rows.map(e => `<tr><td>${esc(e.spent_at || dDay(e.created_at))}</td><td>${e.icon || ''} ${esc(e.category || '—')}</td><td class="t-num" style="color:var(--amber)">${money(e.amount)}</td><td>${esc(e.note || '')}</td><td>${esc(e.by_name || '')}</td><td><button class="btn btn-ghost btn-sm" data-del="${e.id}">${t('حذف')}</button></td></tr>`).join('') || `<tr><td colspan="6" class="empty">${t('لا مصروفات')}</td></tr>`}
      </tbody></table></div></div>`;
    $$('#ex-body [data-del]').forEach(b => b.onclick = () => confirmDialog(L('حذف هذا المصروف؟', 'Delete this expense?'), async () => { await api('/expenses/' + b.dataset.del, { method: 'DELETE' }); toast(t('حُذف')); load(); }));
  };
  $('#ex-from').onchange = load; $('#ex-to').onchange = load;
  $('#ex-new').onclick = () => {
    const m = modal(`<h3>💸 ${t('تسجيل مصروف')}</h3>
      <div class="row"><div class="field"><label>${t('فئة المصروف')}</label><select id="x-cat">${cats.map(c => `<option value="${c.id}">${c.icon || ''} ${esc(c.name_ar)}</option>`).join('')}</select></div>
        <div class="field"><label>${t('قيمة المصروف')}</label><input id="x-amt" type="number" step="any"></div></div>
      <div class="row"><div class="field"><label>${t('تاريخ المصروف')}</label><input id="x-date" type="date" value="${todayStr()}"></div>
        <div class="field"><label>${t('ملاحظات')}</label><input id="x-note"></div></div>
      <div class="err" id="x-e"></div>
      <div class="modal-actions"><button class="btn btn-ghost" id="x-x">${t('إلغاء')}</button><button class="btn btn-primary" id="x-save">${t('حفظ')}</button></div>`);
    $('#x-x', m).onclick = () => m.remove();
    $('#x-save', m).onclick = async () => {
      const body = { category_id: +$('#x-cat', m).value, amount: +$('#x-amt', m).value || 0, spent_at: $('#x-date', m).value, note: $('#x-note', m).value.trim() };
      if (!(body.amount > 0)) return $('#x-e', m).textContent = L('أدخل قيمة المصروف', 'Enter amount');
      try { await api('/expenses', { method: 'POST', body }); m.remove(); toast(t('تم الحفظ ✅')); load(); } catch (e) { $('#x-e', m).textContent = e.message; }
    };
  };
  load();
};

// ===================================================================
//  تقارير الحوكمة
// ===================================================================
function exportExcel(filename, rows) {
  if (!rows || !rows.length) return toast(L('لا بيانات للتصدير', 'No data to export'), 'warn');
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = Object.keys(rows[0]).map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Report');
  XLSX.writeFile(wb, filename + '.xlsx');
}
function exportPDF(title, columns, rows, kpis) {
  const head = `<div class="rd-head">${logoMark('rd-logo')}<div class="rd-title"><h1>${esc(META.settings.cafe_name || 'seaside')}</h1><div>${esc(title)}</div><small>${new Date().toLocaleString('en-GB')}</small></div></div>`;
  const kpisHTML = kpis && kpis.length ? `<div class="rd-kpis">${kpis.map(k => `<div><span>${esc(k.lbl)}</span><b>${esc(k.val)}</b></div>`).join('')}</div>` : '';
  const table = `<table class="rd-table"><thead><tr>${columns.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${columns.map(c => `<td>${esc(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const pa = $('#print-area'); pa.innerHTML = `<div class="report-doc">${head}${kpisHTML}${table}</div>`; pa.classList.remove('hidden');
  setPrintPage('@page{size:A4;margin:14mm}');
  const done = () => { pa.classList.add('hidden'); pa.innerHTML = ''; setPrintPage(''); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done); setTimeout(() => window.print(), 150);
}

const REPORTS = [
  { k: 'sales', t: ['تقرير المبيعات', 'Sales report'] },
  { k: 'products', t: ['تقرير الأصناف', 'Products report'] },
  { k: 'categories', t: ['تقرير الفئات', 'Categories report'] },
  { k: 'payments', t: ['تقرير طرق الدفع', 'Payment methods'] },
  { k: 'cancelled', t: ['الطلبات الملغاة', 'Cancelled orders'] },
  { k: 'inventory_moves', t: ['حركة المخزون', 'Inventory movements'], mat: true },
  { k: 'purchases', t: ['تقرير المشتريات', 'Purchases report'], mat: true },
  { k: 'variance', t: ['الهدر والعجز', 'Waste & variance'] },
  { k: 'suppliers', t: ['أداء الموردين', 'Suppliers'] },
];
const TXLABEL = { purchase: ['شراء', 'Purchase'], sale: ['بيع', 'Sale'], waste: ['تالف', 'Waste'], adjust: ['تسوية', 'Adjust'], count: ['جرد', 'Count'] };

ROUTES.reports = async (view) => {
  const from = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
  let curR = 'sales';
  const materials = await api('/materials').catch(() => []);
  view.innerHTML = `<div class="page-head"><div><h2>📈 ${t('تقارير الحوكمة')}</h2><div class="crumb">${L('اختر التقرير وصدّره PDF أو Excel — عليه لوجو المكان', 'Pick a report and export to PDF or Excel — with the place logo')}</div></div></div>
    <div class="rep-layout">
      <div class="rep-main">
        <div class="toolbar">${t('من')} <input type="date" id="r-from" value="${from}"> ${t('إلى')} <input type="date" id="r-to" value="${todayStr()}">
          <select id="r-material" class="hidden"><option value="">${L('كل المواد', 'All materials')}</option>${materials.map(x => `<option value="${x.id}">${esc(x.name_ar)}</option>`).join('')}</select>
          <button class="btn btn-primary btn-sm" id="r-go">${t('تحديث')}</button>
          <span style="flex:1;min-width:10px"></span>
          <button class="btn btn-ghost btn-sm" id="r-xls">⬇ Excel</button>
          <button class="btn btn-ghost btn-sm" id="r-pdf">🖨️ PDF</button>
        </div>
        <div id="r-body"><div class="loading">…</div></div>
      </div>
      <div class="rep-list" id="rep-list"><div class="rep-list-h">${L('التقارير', 'Reports')}</div>${REPORTS.map(r => `<button class="rep-item ${r.k === curR ? 'active' : ''}" data-r="${r.k}">📄 ${L(r.t[0], r.t[1])}</button>`).join('')}</div>
    </div>`;
  let current = { title: '', columns: [], rows: [], kpis: [] };
  const load = async () => {
    const rep = REPORTS.find(r => r.k === curR); const title = L(rep.t[0], rep.t[1]);
    $('#r-material').classList.toggle('hidden', !rep.mat);
    const mat = rep.mat && $('#r-material').value ? '&material=' + $('#r-material').value : '';
    const f = $('#r-from').value, tt = $('#r-to').value, qs = `?from=${f}&to=${tt}${mat}`;
    const body = $('#r-body'); body.innerHTML = '<div class="loading">…</div>';
    let kpis = [], columns = [], rows = [];
    try {
      if (curR === 'sales') {
        const d = await api('/reports/sales' + qs); const s = d.summary;
        kpis = [{ lbl: t('المبيعات'), val: money(s.sales) }, { lbl: t('تكلفة المكونات'), val: money(s.cost) }, { lbl: t('صافي الربح'), val: money(s.profit) }, { lbl: L('عدد الطلبات', 'Orders'), val: num(s.orders) }];
        columns = [{ key: 'd', label: t('الوقت') }, { key: 'orders', label: L('عدد الطلبات', 'Orders') }, { key: 'sales', label: t('المبيعات') }, { key: 'profit', label: t('صافي الربح') }];
        rows = d.byDay.map(x => ({ d: dDay(x.d), orders: num(x.orders), sales: money(x.sales), profit: money(x.profit) }));
      } else if (curR === 'products') {
        const d = await api('/reports/sales' + qs);
        columns = [{ key: 'name', label: t('الصنف') }, { key: 'qty', label: t('الكمية') }, { key: 'sales', label: t('المبيعات') }, { key: 'cost', label: t('التكلفة') }, { key: 'margin', label: t('هامش الربح') }];
        rows = d.byProduct.map(p => ({ name: p.name_ar, qty: num(p.qty), sales: money(p.sales), cost: money(p.cost), margin: money(p.margin) }));
      } else if (curR === 'categories') {
        const d = await api('/reports/categories' + qs);
        columns = [{ key: 'name', label: L('الفئة', 'Category') }, { key: 'qty', label: t('الكمية') }, { key: 'sales', label: t('المبيعات') }, { key: 'cost', label: t('التكلفة') }];
        rows = d.map(c => ({ name: (c.icon || '') + ' ' + c.name_ar, qty: num(c.qty), sales: money(c.sales), cost: money(c.cost) }));
      } else if (curR === 'payments') {
        const d = await api('/reports/payments' + qs);
        columns = [{ key: 'name', label: L('طريقة الدفع', 'Method') }, { key: 'cnt', label: L('عدد الطلبات', 'Orders') }, { key: 'total', label: t('الإجمالي') }];
        rows = d.map(p => ({ name: (p.icon || '') + ' ' + p.name_ar, cnt: num(p.cnt), total: money(p.total) }));
      } else if (curR === 'cancelled') {
        const d = await api('/reports/cancelled' + qs);
        columns = [{ key: 'inv', label: t('الفاتورة') }, { key: 'total', label: t('الإجمالي') }, { key: 'table', label: t('الطاولة') }, { key: 'by', label: t('بواسطة') }, { key: 'note', label: L('السبب', 'Reason') }, { key: 'date', label: t('الوقت') }];
        rows = d.map(o => ({ inv: o.invoice_no, total: money(o.total), table: o.table_name || '—', by: o.by_name || '—', note: o.note || '—', date: dt(o.created_at) }));
      } else if (curR === 'inventory_moves') {
        const d = await api('/reports/inventory-moves' + qs);
        columns = [{ key: 'date', label: t('الوقت') }, { key: 'material', label: t('المادة') }, { key: 'type', label: t('النوع') }, { key: 'qty', label: t('الكمية') }, { key: 'balance', label: t('الرصيد') }, { key: 'note', label: L('المرجع', 'Ref') }];
        rows = d.map(r => ({ date: dt(r.created_at), material: r.material, type: LL(TXLABEL, r.type), qty: (r.qty > 0 ? '+' : '') + num(r.qty, 1) + ' ' + (r.unit || ''), balance: num(r.balance, 1), note: r.note || '—' }));
      } else if (curR === 'purchases') {
        const d = await api('/reports/purchases' + qs);
        const tot = d.reduce((s, r) => s + r.total, 0);
        kpis = [{ lbl: L('عدد البنود', 'Lines'), val: num(d.length) }, { lbl: t('الإجمالي'), val: money(tot) }];
        columns = [{ key: 'date', label: t('الوقت') }, { key: 'ref', label: t('رقم الفاتورة') }, { key: 'supplier', label: t('المورد') }, { key: 'material', label: t('المادة') }, { key: 'qty', label: t('الكمية') }, { key: 'cost', label: L('سعر الوحدة', 'Unit cost') }, { key: 'total', label: t('الإجمالي') }];
        rows = d.map(r => ({ date: dDay(r.created_at), ref: r.ref || '—', supplier: r.supplier || '—', material: r.material, qty: num(r.qty, 1) + ' ' + (r.unit || ''), cost: money(r.unit_cost), total: money(r.total) }));
      } else if (curR === 'variance') {
        const d = await api('/reports/variance' + qs);
        kpis = [{ lbl: t('تكلفة التوالف'), val: money(d.wasteTotal) }, { lbl: t('عجز الجرد'), val: money(d.shortage) }, { lbl: t('فائض الجرد'), val: money(d.surplus) }, { lbl: t('نسبة الهدر من التكلفة'), val: num(d.wastePct, 1) + '%' }];
        columns = [{ key: 'name', label: t('المادة') }, { key: 'qty', label: t('كمية الهدر') }, { key: 'cost', label: t('التكلفة') }];
        rows = d.waste.map(w => ({ name: w.name_ar, qty: num(w.qty, 1), cost: money(w.cost) }));
      } else if (curR === 'suppliers') {
        const d = await api('/reports/suppliers');
        columns = [{ key: 'name', label: t('المورد') }, { key: 'inv', label: t('الفواتير') }, { key: 'total', label: t('الإجمالي') }, { key: 'last', label: t('آخر توريد') }];
        rows = d.map(s => ({ name: s.name_ar, inv: num(s.invoices), total: money(s.total), last: s.last ? dDay(s.last) : '—' }));
      }
    } catch (e) { body.innerHTML = `<div class="card"><p style="color:var(--red)">⚠️ ${esc(e.message)}</p></div>`; return; }
    current = { title, columns, rows, kpis };
    body.innerHTML = `
      ${kpis.length ? `<div class="kpi-grid">${kpis.map((k, i) => `<div class="kpi ${['', 'sand', 'green', 'amber'][i % 4]}"><div class="lbl">${esc(k.lbl)}</div><div class="val">${esc(k.val)}</div></div>`).join('')}</div>` : ''}
      <div class="card"><h3>${esc(title)} <span class="chip">${rows.length}</span></h3>
        <div class="t-wrap"><table><thead><tr>${columns.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>
          ${rows.length ? rows.map(r => `<tr>${columns.map(c => `<td class="${/\d/.test(String(r[c.key])) ? 't-num' : ''}">${esc(r[c.key])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}" class="empty">${t('لا بيانات')}</td></tr>`}
        </tbody></table></div></div>`;
  };
  $('#r-go').onclick = load;
  $('#r-material').onchange = load;
  $('#r-xls').onclick = () => { const out = current.rows.map(r => { const o = {}; current.columns.forEach(c => o[c.label] = r[c.key]); return o; }); exportExcel('seaside-' + curR + '-' + todayStr(), out); };
  $('#r-pdf').onclick = () => current.rows.length ? exportPDF(current.title, current.columns, current.rows, current.kpis) : toast(L('لا بيانات للتصدير', 'No data to export'), 'warn');
  $$('#rep-list .rep-item').forEach(b => b.onclick = () => { curR = b.dataset.r; $$('#rep-list .rep-item').forEach(x => x.classList.toggle('active', x === b)); load(); });
  load();
};

// ===================================================================
//  الموظفون
// ===================================================================
ROUTES.staff = async (view) => {
  const ALL_PERMS = [
    { g: L('الشاشات','Screens'), items: [
      { k: 'pos', l: L('نقطة البيع','POS') }, { k: 'orders', l: L('الطلبات','Orders') }, { k: 'requests', l: L('طلبات الشراء','Purchase Requests') },
      { k: 'notifications', l: L('الإشعارات','Notifications') }, { k: 'inventory', l: L('المخزون','Inventory') }, { k: 'purchases', l: L('المشتريات','Purchases') },
      { k: 'waste', l: L('التوالف','Waste') }, { k: 'stockcount', l: L('الجرد','Stock Count') }, { k: 'dashboard', l: L('لوحة المعلومات','Dashboard') },
      { k: 'products', l: L('الأصناف','Products') }, { k: 'expenses', l: L('المصروفات','Expenses') }, { k: 'reports', l: L('التقارير','Reports') },
      { k: 'staff', l: L('الموظفون','Staff') }, { k: 'config', l: L('الإعدادات','Settings') },
    ]},
    { g: L('إجراءات','Actions'), items: [
      { k: 'delete_orders', l: L('حذف الفواتير','Delete Invoices') }, { k: 'edit_orders', l: L('تعديل الفواتير','Edit Invoices') },
      { k: 'reset_financials', l: L('مسح السجلات المالية','Reset Financial Records') },
    ]},
  ];
  const [staff, roles] = await Promise.all([api('/staff'), api('/roles')]);
  view.innerHTML = `<div class="page-head"><div><h2>👥 ${t('الموظفون')}</h2><div class="crumb">${t('إضافة الموظفين وتحديد أدوارهم وصلاحياتهم')}</div></div>
    <div class="head-actions"><button class="btn btn-primary" id="s-new">${t('+ موظف جديد')}</button></div></div>
    <div class="card"><div class="t-wrap"><table><thead><tr><th>${t('الاسم')}</th><th>${t('البريد')}</th><th>${t('الدور')}</th><th>PIN</th><th>${t('الحالة')}</th><th></th></tr></thead><tbody>
    ${staff.map(u => `<tr><td><b>${esc(u.full_name)}</b></td><td style="color:var(--text2)">${esc(u.email)}</td><td><span class="chip">${esc(u.role_name)}</span></td><td>${esc(u.pin || '—')}</td><td>${u.is_active ? `<span class="chip ok">${t('مفعّل')}</span>` : `<span class="chip low">${t('موقوف')}</span>`}</td><td><button class="btn btn-ghost btn-sm" data-u="${u.id}">${t('تعديل')}</button></td></tr>`).join('')}
    </tbody></table></div></div>
    <div class="card" style="margin-top:16px"><h3>🔑 ${L('الأدوار والصلاحيات','Roles & Permissions')}</h3>
      <p class="crumb" style="margin-bottom:12px">${L('أضف أدواراً جديدة وحدّد صلاحيات كل دور. الأدمن يملك كل الصلاحيات تلقائياً.','Add new roles and set permissions. Admin has all permissions by default.')}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        ${roles.map(r => `<button class="btn ${r.key === 'admin' ? 'btn-ghost' : 'btn-sand'} btn-sm" data-r="${r.id}">${esc(r.name_ar)} ${r.key === 'admin' ? '👑' : '✏️'}</button>`).join('')}
        <button class="btn btn-primary btn-sm" id="r-new">+ ${L('دور جديد','New Role')}</button>
      </div>
    </div>`;
  const form = (u) => {
    const m = modal(`<h3>${u ? t('تعديل موظف') : t('موظف جديد')}</h3>
      <div class="field"><label>${t('الاسم')}</label><input id="u-name" value="${esc(u?.full_name || '')}"></div>
      <div class="row"><div class="field"><label>${t('البريد')}</label><input id="u-email" value="${esc(u?.email || '')}" ${u ? 'disabled' : ''}></div>
        <div class="field"><label>${t('الدور')}</label><select id="u-role">${roles.map(r => `<option value="${r.id}" ${u?.role_key === r.key ? 'selected' : ''}>${esc(r.name_ar)}</option>`).join('')}</select></div></div>
      <div class="row"><div class="field"><label>${u ? t('كلمة المرور (اتركها فارغة لعدم التغيير)') : t('كلمة المرور')}</label><input id="u-pass" type="text"></div>
        <div class="field"><label>${t('PIN سريع')}</label><input id="u-pin" value="${esc(u?.pin || '')}"></div></div>
      ${u ? `<div class="field"><label><input type="checkbox" id="u-active" ${u.is_active ? 'checked' : ''} style="width:auto"> ${t('مفعّل')}</label></div>` : ''}
      <div class="err" id="ue"></div>
      <div class="modal-actions"><button class="btn btn-ghost" id="u-x">${t('إلغاء')}</button><button class="btn btn-primary" id="u-save">${t('حفظ')}</button></div>`);
    $('#u-x', m).onclick = () => m.remove();
    $('#u-save', m).onclick = async () => {
      const body = { full_name: $('#u-name', m).value.trim(), role_id: +$('#u-role', m).value, pin: $('#u-pin', m).value.trim() };
      if (!u) { body.email = $('#u-email', m).value.trim(); body.password = $('#u-pass', m).value; }
      else { if ($('#u-pass', m).value) body.password = $('#u-pass', m).value; body.is_active = $('#u-active', m).checked ? 1 : 0; }
      try { await api(u ? '/staff/' + u.id : '/staff', { method: u ? 'PUT' : 'POST', body }); m.remove(); toast(t('تم الحفظ ✅')); route(); } catch (e) { $('#ue', m).textContent = e.message; }
    };
  };
  const roleForm = (r) => {
    const isNew = !r;
    const perms = r?.permissions || [];
    const m = modal(`<h3>${isNew ? L('دور جديد','New Role') : L('تعديل دور: ','Edit Role: ') + esc(r.name_ar)}</h3>
      <div class="row"><div class="field"><label>${L('الاسم','Name')}</label><input id="r-name" value="${esc(r?.name_ar || '')}"></div>
      <div class="field"><label>${L('المفتاح (إنجليزي)','Key (English)')}</label><input id="r-key" value="${esc(r?.key || '')}" ${isNew ? '' : 'disabled'} placeholder="owner"></div></div>
      <h4 style="margin:12px 0 8px">${L('الصلاحيات','Permissions')}</h4>
      ${ALL_PERMS.map(g => `<div style="margin-bottom:12px"><b style="color:var(--text2);font-size:.85rem">${g.g}</b>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:4px 12px;margin-top:4px">
        ${g.items.map(p => `<label style="display:flex;align-items:center;gap:6px;font-size:.9rem;cursor:pointer"><input type="checkbox" class="rp-cb" value="${p.k}" ${perms.includes(p.k) ? 'checked' : ''} style="width:auto"> ${p.l}</label>`).join('')}
        </div></div>`).join('')}
      <div class="err" id="re"></div>
      <div class="modal-actions"><button class="btn btn-ghost" id="r-x">${t('إلغاء')}</button><button class="btn btn-primary" id="r-save">${t('حفظ')}</button></div>`);
    $('#r-x', m).onclick = () => m.remove();
    $('#r-save', m).onclick = async () => {
      const body = { name_ar: $('#r-name', m).value.trim(), permissions: [...$$('.rp-cb', m)].filter(c => c.checked).map(c => c.value) };
      if (isNew) body.key = $('#r-key', m).value.trim().toLowerCase().replace(/\s+/g, '_');
      if (!body.name_ar) return ($('#re', m).textContent = L('الاسم مطلوب','Name is required'));
      if (isNew && !body.key) return ($('#re', m).textContent = L('المفتاح مطلوب','Key is required'));
      try { await api(isNew ? '/roles' : '/roles/' + r.id, { method: isNew ? 'POST' : 'PUT', body }); m.remove(); toast(t('تم الحفظ ✅')); route(); } catch (e) { $('#re', m).textContent = e.message; }
    };
  };
  $('#s-new').onclick = () => form(null);
  $$('#view [data-u]', view).forEach(b => b.onclick = () => form(staff.find(u => u.id === +b.dataset.u)));
  $('#r-new').onclick = () => roleForm(null);
  $$('#view [data-r]', view).forEach(b => { const r = roles.find(x => x.id === +b.dataset.r); if (r?.key !== 'admin') b.onclick = () => roleForm(r); });
};

// ===================================================================
//  الإعدادات (عامة + جداول ديناميكية)
// ===================================================================
const ADMIN_TABS = [
  { k: 'categories', t: '🏷️ التصنيفات', cols: [['name_ar', 'الاسم', 'text'], ['icon', 'أيقونة', 'text'], ['color', 'لون', 'color'], ['sort_order', 'ترتيب', 'number'], ['is_active', 'مفعّل', 'bool']] },
  { k: 'tables', t: '🪑 الطاولات', cols: [['name_ar', 'الاسم', 'text'], ['seats', 'مقاعد', 'number'], ['sort_order', 'ترتيب', 'number'], ['is_active', 'مفعّل', 'bool']] },
  { k: 'payment-methods', t: '💳 طرق الدفع', cols: [['name_ar', 'الاسم', 'text'], ['name_en', 'الاسم بالإنجليزية', 'text'], ['icon', 'أيقونة', 'text'], ['kind', 'النوع (cash/transfer)', 'text'], ['show_in_pos', 'يظهر في الدفع', 'bool'], ['sort_order', 'ترتيب', 'number'], ['is_active', 'مفعّل', 'bool']] },
  { k: 'units', t: '📏 الوحدات', cols: [['name_ar', 'الاسم', 'text'], ['symbol', 'الرمز', 'text'], ['is_active', 'مفعّل', 'bool']] },
  { k: 'warehouses', t: '🏬 المخازن', cols: [['name_ar', 'الاسم', 'text'], ['kind', 'النوع', 'text'], ['sort_order', 'ترتيب', 'number'], ['is_active', 'مفعّل', 'bool']] },
  { k: 'suppliers', t: '🚚 الموردون', cols: [['name_ar', 'الاسم', 'text'], ['phone', 'هاتف', 'text'], ['notes', 'ملاحظات', 'text'], ['is_active', 'مفعّل', 'bool']] },
  { k: 'expense-categories', t: '💸 فئات المصروفات', cols: [['name_ar', 'الاسم', 'text'], ['icon', 'أيقونة', 'text'], ['sort_order', 'ترتيب', 'number'], ['is_active', 'مفعّل', 'bool']] },
];
ROUTES.config = async (view) => {
  const s = await api('/settings');
  view.innerHTML = `<div class="page-head"><div><h2>⚙️ ${t('الإعدادات')}</h2><div class="crumb">${t('بيانات الكافيه والضريبة، وكل القوائم الديناميكية')}</div></div></div>
    <div class="card"><h3>${t('🏪 بيانات المكان والفاتورة')}</h3>
      <div class="row"><div class="field"><label>${t('اسم المكان')}</label><input id="st-cafe_name" value="${esc(s.cafe_name || '')}"></div><div class="field"><label>${t('الشعار / الوصف')}</label><input id="st-tagline" value="${esc(s.tagline || '')}"></div></div>
      <div class="row"><div class="field"><label>${t('نسبة الضريبة %')}</label><input id="st-tax_rate" type="number" value="${esc(s.tax_rate || 0)}"></div><div class="field"><label>${t('العملة')}</label><input id="st-currency" value="${esc(s.currency || '')}"></div></div>
      <div class="row"><div class="field"><label>${t('العنوان')}</label><input id="st-address" value="${esc(s.address || '')}"></div><div class="field"><label>${t('الهاتف')}</label><input id="st-phone" value="${esc(s.phone || '')}"></div></div>
      <div class="field"><label>${t('تذييل الفاتورة')}</label><input id="st-receipt_footer" value="${esc(s.receipt_footer || '')}"></div>
      <button class="btn btn-primary" id="st-save">${t('💾 حفظ الإعدادات')}</button>
    </div>
    <div class="card"><h3>🧾 ${L('عناصر الفاتورة — تحكّم ديناميكي', 'Receipt elements — dynamic')}</h3>
      <p class="crumb" style="margin-bottom:12px">${L('فعّل/ألغِ العناصر اللي تظهر في الفاتورة المطبوعة (اللوجو دائماً متاح).', 'Toggle which elements appear on the printed receipt.')}</p>
      <div class="rfields" id="rfields"></div>
      <div class="field" style="margin-top:14px"><label>${L('أسطر إضافية في الفاتورة (سطر لكل عنصر — مثل: واي فاي، إنستجرام)', 'Extra receipt lines (one per line — e.g. Wifi, Instagram)')}</label>
        <textarea id="st-extra" rows="3" style="width:100%;padding:10px 12px;border:1.5px solid var(--border);border-radius:10px;background:var(--surface2);color:var(--text)">${esc(s.receipt_extra_lines || '')}</textarea></div>
      <button class="btn btn-primary" id="rf-save">${L('💾 حفظ الفاتورة', '💾 Save receipt')}</button>
    </div>
    <div class="card"><h3>${t('🗂️ القوائم الديناميكية')}</h3>
      <div class="cat-chips" id="adm-tabs">${ADMIN_TABS.map((a, i) => `<button class="cat-chip ${i === 0 ? 'active' : ''}" data-k="${a.k}">${t(a.t)}</button>`).join('')}</div>
      <div id="adm-body"></div></div>
    <div class="card" style="border:2px solid #e53935">
      <h3 style="color:#e53935">${t('⚠️ منطقة الخطر')}</h3>
      <p style="margin-bottom:12px">${t('هذا الإجراء سيحذف جميع الطلبات والفواتير والمشتريات والمصروفات وحركات المخزون والجرد نهائياً. لن يمس المنتجات أو الأصناف أو التصنيفات أو المخزون.')}</p>
      <button class="btn" id="btn-reset-fin" style="background:#e53935;color:#fff">${t('🗑️ مسح الحركات المالية')}</button>
    </div>`;
  $('#st-save').onclick = async () => {
    const body = {}; ['cafe_name', 'tagline', 'tax_rate', 'currency', 'address', 'phone', 'receipt_footer'].forEach(k => body[k] = $('#st-' + k).value);
    await api('/settings', { method: 'PUT', body }); META = await api('/meta'); toast(t('حُفظت الإعدادات ✅')); renderShell(); route();
  };
  // ---- بناء الفاتورة الديناميكي ----
  const RFIELDS = [['logo', 'اللوجو', 'Logo'], ['tagline', 'الوصف', 'Tagline'], ['address', 'العنوان', 'Address'], ['phone', 'الهاتف', 'Phone'], ['datetime', 'التاريخ والوقت', 'Date & time'], ['order_no', 'رقم الطلب', 'Order no.'], ['token', 'رقم التوكن', 'Token'], ['order_type', 'نوع الطلب', 'Order type'], ['table', 'الطاولة', 'Table'], ['cashier', 'الكاشير', 'Cashier'], ['waiter', 'النادل', 'Waiter'], ['barcode', 'الباركود', 'Barcode'], ['footer', 'تذييل الفاتورة', 'Footer'], ['ref', 'مرجع الفاتورة', 'Ref']];
  let RF = {}; try { RF = JSON.parse(s.receipt_fields || '{}'); } catch { RF = {}; }
  $('#rfields').innerHTML = RFIELDS.map(f => `<label class="rfield"><input type="checkbox" data-rf="${f[0]}" ${RF[f[0]] !== 0 ? 'checked' : ''}> ${L(f[1], f[2])}</label>`).join('');
  $('#rf-save').onclick = async () => {
    const fields = {}; $$('#rfields [data-rf]').forEach(c => fields[c.dataset.rf] = c.checked ? 1 : 0);
    await api('/settings', { method: 'PUT', body: { receipt_fields: JSON.stringify(fields), receipt_extra_lines: $('#st-extra').value } });
    META = await api('/meta'); toast(L('حُفظت إعدادات الفاتورة ✅', 'Receipt settings saved ✅'));
  };
  $('#btn-reset-fin').onclick = async () => {
    const msg = L('هذا الإجراء لا يمكن التراجع عنه!\nسيحذف كل الفواتير والمشتريات والمصروفات والحركات المالية.\nالمنتجات والتصنيفات والمخزون لن تتأثر.\n\nاكتب "مسح" للتأكيد:', 'This cannot be undone!\nAll orders, purchases, expenses and financial records will be deleted.\nProducts, categories and inventory will NOT be affected.\n\nType "delete" to confirm:');
    const ans = prompt(msg);
    if (ans !== 'مسح' && ans !== 'delete') return;
    if (!confirm(L('⚠️ تأكيد نهائي: هل أنت متأكد من مسح جميع الحركات المالية؟', '⚠️ Final confirmation: Are you sure you want to delete all financial records?'))) return;
    await api('/admin/reset-financials', { method: 'POST', body: { confirm: 'DELETE_FINANCIALS' } });
    toast(t('تم مسح جميع الحركات المالية ✅'));
  };
  let curK = ADMIN_TABS[0].k;
  const loadTab = async () => {
    const tab = ADMIN_TABS.find(a => a.k === curK);
    const rows = await api('/admin/' + curK);
    $('#adm-body').innerHTML = `<div style="text-align:end;margin-bottom:10px"><button class="btn btn-primary btn-sm" id="adm-add">${t('إضافة')}</button></div>
      <div class="t-wrap"><table><thead><tr>${tab.cols.map(c => `<th>${t(c[1])}</th>`).join('')}<th></th></tr></thead><tbody>
      ${rows.map(r => `<tr>${tab.cols.map(c => `<td>${c[2] === 'bool' ? (r[c[0]] ? '✅' : '—') : c[2] === 'color' ? `<span style="display:inline-block;width:16px;height:16px;border-radius:4px;background:${esc(r[c[0]])};vertical-align:middle"></span> ${esc(r[c[0]])}` : esc(r[c[0]] ?? '')}</td>`).join('')}<td><button class="btn btn-ghost btn-sm" data-id="${r.id}">${t('تعديل')}</button></td></tr>`).join('') || `<tr><td colspan="${tab.cols.length + 1}" class="empty">${t('لا بيانات')}</td></tr>`}
      </tbody></table></div>`;
    $('#adm-add').onclick = () => admForm(tab, null);
    $$('#adm-body [data-id]').forEach(b => b.onclick = () => admForm(tab, rows.find(r => r.id === +b.dataset.id)));
  };
  const admForm = (tab, row) => {
    const m = modal(`<h3>${t(tab.t)} — ${row ? t('تعديل') : t('إضافة')}</h3>
      ${tab.cols.map(c => c[2] === 'bool'
        ? `<div class="field"><label><input type="checkbox" id="a-${c[0]}" ${(row ? row[c[0]] : 1) ? 'checked' : ''} style="width:auto"> ${t(c[1])}</label></div>`
        : `<div class="field"><label>${t(c[1])}</label><input id="a-${c[0]}" type="${c[2] === 'number' ? 'number' : c[2] === 'color' ? 'color' : 'text'}" value="${esc(row ? (row[c[0]] ?? '') : (c[2] === 'color' ? '#0FB5BA' : ''))}"></div>`).join('')}
      <div class="modal-actions"><button class="btn btn-ghost" id="a-x">${t('إلغاء')}</button><button class="btn btn-primary" id="a-save">${t('حفظ')}</button></div>`);
    $('#a-x', m).onclick = () => m.remove();
    $('#a-save', m).onclick = async () => {
      const body = {}; tab.cols.forEach(c => body[c[0]] = c[2] === 'bool' ? ($('#a-' + c[0], m).checked ? 1 : 0) : c[2] === 'number' ? +$('#a-' + c[0], m).value || 0 : $('#a-' + c[0], m).value);
      await api(row ? `/admin/${tab.k}/${row.id}` : '/admin/' + tab.k, { method: row ? 'PUT' : 'POST', body });
      m.remove(); META = await api('/meta'); toast(t('تم الحفظ ✅')); loadTab();
    };
  };
  $$('#adm-tabs .cat-chip').forEach(b => b.onclick = () => { curK = b.dataset.k; $$('#adm-tabs .cat-chip').forEach(x => x.classList.toggle('active', x === b)); loadTab(); });
  loadTab();
};

// ---------- إقلاع ----------
if (TOKEN) boot().catch(() => renderLogin()); else renderLogin();
