import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

test('order history, numbering and inventory reversals', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'seaside-orders-'));
  process.env.DB_PATH = join(dir, 'test.db');
  process.env.PORT = '0';
  const { server } = await import('../server.js');
  const { db, get, all, run } = await import('../db/database.js');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  if (!server.listening) await once(server, 'listening');
  let token;
  async function request(method, path, body, expected = 200) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || '') },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    assert.equal(response.status, expected, text);
    return JSON.parse(text);
  }
  token = (await request('POST', '/login', { email: 'admin@seaside.com', password: 'admin123' })).token;
  const recipe = get('SELECT pr.* FROM product_recipes pr JOIN products p ON p.id=pr.product_id WHERE p.track_stock=1 LIMIT 1');
  run('UPDATE products SET price=20 WHERE id=?', recipe.product_id);
  const items = [{ product_id: recipe.product_id, qty: 1 }];
  const order = () => request('POST', '/orders', { items });
  const first = await order();
  const second = await order();
  await request('DELETE', '/orders/' + first.id);
  const third = await order();
  assert.equal(Number(third.invoice_no.split('-').pop()), Number(second.invoice_no.split('-').pop()) + 1);

  const stock = () => all('SELECT id, qty FROM raw_materials ORDER BY id');
  const before = stock();
  const paid = await request('POST', '/orders', { items, status: 'paid', paid_cash: 100000, payment_method_id: 1 });
  const path = '/orders/' + paid.id;
  await request('DELETE', path, undefined, 409);
  await request('PUT', path, { items, discount: 5 }, 409);
  assert.equal((await request('GET', path)).total, paid.total);
  const afterSale = stock();
  assert.notDeepEqual(afterSale, before);
  run('UPDATE product_recipes SET qty=qty*2 WHERE product_id=?', recipe.product_id);
  await request('PUT', path, { items });
  const afterEdit = stock();
  assert.notDeepEqual(afterEdit, afterSale);
  await request('PUT', path, { items });
  assert.deepEqual(stock(), afterEdit);
  run('DELETE FROM product_recipes WHERE product_id=?', recipe.product_id);
  await request('POST', path + '/cancel', {});
  assert.deepEqual(stock(), before);
  await request('DELETE', path, undefined, 409);
  assert.equal((await request('GET', path)).status, 'cancelled');

  const customer = await request('POST', '/customers', { name_ar: 'Test customer' });
  const method = get('SELECT id FROM payment_methods WHERE id<>1 LIMIT 1');
  const partial = await request('POST', '/orders', { items, status: 'paid', customer_id: customer.id, paid_cash: 1, payment_method_id: 1 });
  await request('POST', '/returns/sales', { order_id: partial.id,
    items: [{ order_item_id: partial.items[0].id, qty: 1 }] }, 409);
  await request('POST', '/orders/' + partial.id + '/settle', { amount: partial.total - 1, method_id: method.id });
  await request('POST', '/orders/' + partial.id + '/cancel', {});
  const balances = all(`SELECT method_id, ROUND(SUM(amount),2) AS net FROM money_movements
    WHERE ref_id=? AND ref_type IN ('order','invoice_payment') GROUP BY method_id`, partial.id);
  assert.equal(balances.length, 2);
  assert.ok(balances.every(row => row.net === 0));

  run('UPDATE taxes SET is_active=1, rate=14 WHERE id=(SELECT MIN(id) FROM taxes)');
  const returned = await request('POST', '/orders', { items: [...items, ...items, ...items],
    discount: 10, tip: 3, status: 'paid', paid_cash: 1000, payment_method_id: 1 });
  const refund = (lines, expected) => request('POST', '/returns/sales',
    { order_id: returned.id, method_id: 1, items: lines }, expected);
  const lines = returned.items.map(item => ({ order_item_id: item.id, qty: 1 }));
  await refund([lines[0], lines[0]], 400);
  const firstRefund = await refund([lines[0]]);
  // Simulate a pre-migration return without an original line reference.
  run('UPDATE sales_return_items SET order_item_id=NULL WHERE return_id=?', firstRefund.id);
  await refund([lines[0]], 400);
  const secondRefund = await refund([lines[1]]);
  const thirdRefund = await refund([lines[2]]);
  assert.equal(firstRefund.total, Math.round((returned.total - 3) * 100 / 3) / 100);
  assert.equal(Math.round((firstRefund.total + secondRefund.total + thirdRefund.total) * 100),
    Math.round((returned.total - 3) * 100));
  await request('POST', '/orders/' + returned.id + '/cancel', {}, 409);
  await request('PUT', '/orders/' + returned.id, { items }, 409);
});
