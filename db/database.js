// ===================================================================
//  طبقة الاتصال بقاعدة البيانات (node:sqlite المدمج في Node 22.5+)
// ===================================================================
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.DB_PATH || join(__dirname, 'cafe_pos.db');

function open() {
  const d = new DatabaseSync(DB_PATH);
  d.exec('PRAGMA foreign_keys = ON;');
  d.exec('PRAGMA journal_mode = WAL;');
  return d;
}

export let db = open();

// إعادة فتح القاعدة بعد استبدال الملف (استرجاع نسخة احتياطية)
export function reopenDb() {
  try { db.close(); } catch {}
  db = open();
}

// مساعدات مختصرة (تقرأ db وقت الاستدعاء — آمنة مع reopenDb)
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);
export const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
// وقت محلي (وليس UTC) — حتى يطابق فلترة "اليوم" في الشاشات تاريخَ مصر الفعلي
// (طلب الساعة 1 صباحاً كان يُسجل UTC على تاريخ اليوم السابق فيختفي من فلتر النهاردة)
export const nowISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().replace('Z', '');
};
