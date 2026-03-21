const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');

const dbDir = fs.existsSync('/var/data') ? '/var/data' : __dirname;
const adapter = new FileSync(path.join(dbDir, 'db.json'));
const db = low(adapter);

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

function nextId(collection) {
  const ids = db.get(collection).map('id').value();
  return ids.length === 0 ? 1 : Math.max(...ids) + 1;
}

function nowLocal() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

db.defaults({
  products: [],
  stock: [],
  orders: [],
  deliveries: [],
  deliveryItems: []
}).write();

if (db.get('products').value().length === 0) {
  const initialProducts = [
    { sku: 'White',         category: 'Oversized Boxy Tee', stock: { XS:1, S:3, M:3, L:0, XL:2, XXL:0 } },
    { sku: 'Black',         category: 'Oversized Boxy Tee', stock: { XS:0, S:1, M:1, L:0, XL:0, XXL:0 } },
    { sku: 'Vintage White', category: 'Oversized Boxy Tee', stock: { XS:0, S:2, M:4, L:6, XL:2, XXL:0 } },
    { sku: 'Vintage Black', category: 'Oversized Boxy Tee', stock: { XS:0, S:1, M:3, L:3, XL:2, XXL:0 } },
    { sku: 'Navy',          category: 'Oversized Boxy Tee', stock: { XS:2, S:2, M:3, L:2, XL:3, XXL:0 } },
    { sku: 'Cold Blue',     category: 'Oversized Boxy Tee', stock: { XS:0, S:0, M:0, L:0, XL:1, XXL:0 } },
    { sku: 'Pigment Grey',  category: 'Oversized Boxy Tee', stock: { XS:0, S:2, M:3, L:2, XL:2, XXL:0 } },
    { sku: 'Wild Green',    category: 'Oversized Boxy Tee', stock: { XS:0, S:1, M:1, L:0, XL:0, XXL:0 } },
    { sku: 'Light Grey',    category: 'Oversized Boxy Tee', stock: { XS:0, S:1, M:3, L:0, XL:0, XXL:0 } },
    { sku: 'Vintage Olive', category: 'Oversized Boxy Tee', stock: { XS:0, S:0, M:0, L:0, XL:0, XXL:0 } },
    { sku: 'Vintage Dune',  category: 'Oversized Boxy Tee', stock: { XS:0, S:0, M:0, L:0, XL:1, XXL:0 } },
    { sku: 'Grey Marl',     category: 'Oversized Boxy Tee', stock: { XS:0, S:2, M:0, L:0, XL:0, XXL:0 } },
    { sku: 'White',         category: 'Regular Tee',        stock: { XS:0, S:0, M:0, L:0, XL:0, XXL:0 } },
    { sku: 'Light Grey',    category: 'Regular Tee',        stock: { XS:0, S:0, M:0, L:0, XL:0, XXL:0 } },
  ];

  let pid = 1, sid = 1;
  const products = [];
  const stock = [];

  for (const item of initialProducts) {
    const productId = pid++;
    products.push({ id: productId, name: item.sku, sku: item.sku, category: item.category, price: 129, active: 1 });
    for (const size of SIZES) {
      stock.push({ id: sid++, product_id: productId, size, quantity: item.stock[size] !== undefined ? item.stock[size] : 0 });
    }
  }

  db.set('products', products).write();
  db.set('stock', stock).write();
  console.log('Baza danych zainicjowana danymi startowymi.');
}

module.exports = {
  SIZES,

  // ── PRODUCTS ──────────────────────────────────────────────────
  getActiveProductsWithStock() {
    const products = db.get('products').filter({ active: 1 }).sortBy(['category', 'id']).value();
    return this._attachStock(products);
  },

  getAllProductsWithStock() {
    const products = db.get('products').sortBy(['category', 'id']).value();
    return this._attachStock(products);
  },

  getAllActiveProducts() {
    return db.get('products').filter({ active: 1 }).sortBy(['category', 'id']).value();
  },

  getProduct(id) {
    return db.get('products').find({ id: parseInt(id) }).value();
  },

  addProduct({ name, sku, category, price }) {
    const id = nextId('products');
    db.get('products').push({ id, name, sku, category, price: parseFloat(price) || 129, active: 1 }).write();
    let sid = nextId('stock');
    const stockEntries = SIZES.map(size => ({ id: sid++, product_id: id, size, quantity: 0 }));
    db.get('stock').push(...stockEntries).write();
    return id;
  },

  toggleProductActive(productId) {
    const pid = parseInt(productId);
    const current = db.get('products').find({ id: pid }).value();
    if (!current) return null;
    const newActive = current.active ? 0 : 1;
    db.get('products').find({ id: pid }).assign({ active: newActive }).write();
    return newActive;
  },

  _attachStock(products) {
    return products.map(p => {
      const stockRows = db.get('stock').filter({ product_id: p.id }).value();
      const stock = {};
      for (const row of stockRows) stock[row.size] = row.quantity;
      return { ...p, stock };
    });
  },

  // ── STOCK ─────────────────────────────────────────────────────
  updateStock(productId, size, quantity) {
    const pid = parseInt(productId);
    const qty = Math.max(0, parseInt(quantity) || 0);
    const existing = db.get('stock').find({ product_id: pid, size }).value();
    if (existing) {
      db.get('stock').find({ product_id: pid, size }).assign({ quantity: qty }).write();
    } else {
      db.get('stock').push({ id: nextId('stock'), product_id: pid, size, quantity: qty }).write();
    }
  },

  addToStock(productId, size, quantity) {
    const pid = parseInt(productId);
    const qty = parseInt(quantity) || 0;
    const existing = db.get('stock').find({ product_id: pid, size }).value();
    if (existing) {
      db.get('stock').find({ product_id: pid, size }).assign({ quantity: Math.max(0, existing.quantity + qty) }).write();
    } else {
      db.get('stock').push({ id: nextId('stock'), product_id: pid, size, quantity: qty }).write();
    }
  },

  decreaseStock(productId, size, quantity) {
    const pid = parseInt(productId);
    const qty = parseInt(quantity) || 1;
    const existing = db.get('stock').find({ product_id: pid, size }).value();
    if (existing) {
      db.get('stock').find({ product_id: pid, size }).assign({ quantity: Math.max(0, existing.quantity - qty) }).write();
    }
  },

  getStockQty(productId, size) {
    const row = db.get('stock').find({ product_id: parseInt(productId), size }).value();
    return row ? row.quantity : 0;
  },

  getTotalStock() {
    return db.get('stock').sumBy('quantity').value();
  },

  getLowStock() {
    const items = db.get('stock').filter(s => s.quantity === 1).value();
    return items.map(s => {
      const p = db.get('products').find({ id: s.product_id }).value();
      return { ...s, sku: p ? p.sku : '', category: p ? p.category : '' };
    });
  },

  // ── ORDERS ────────────────────────────────────────────────────
  getOrders(statusFilter) {
    let orders = db.get('orders').value();
    if (statusFilter) orders = orders.filter(o => o.status === statusFilter);
    orders = orders.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    return orders.map(o => {
      const p = db.get('products').find({ id: o.product_id }).value();
      return { ...o, sku: p ? p.sku : '', category: p ? p.category : '' };
    });
  },

  getRecentOrders(limit) {
    const orders = db.get('orders').value()
      .slice().sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit);
    return orders.map(o => {
      const p = db.get('products').find({ id: o.product_id }).value();
      return { ...o, sku: p ? p.sku : '', category: p ? p.category : '' };
    });
  },

  createOrder({ customerName, customerContact, productId, size, price, notes }) {
    const id = nextId('orders');
    db.get('orders').push({
      id,
      customer_name: customerName,
      customer_contact: customerContact,
      product_id: parseInt(productId),
      size,
      quantity: 1,
      price: parseFloat(price) || 0,
      status: 'new',
      notes: notes || null,
      created_at: nowLocal(),
      paid_at: null,
      shipped_at: null
    }).write();
    return id;
  },

  updateOrderStatus(orderId, newStatus) {
    const oid = parseInt(orderId);
    const order = db.get('orders').find({ id: oid }).value();
    if (!order) return false;

    const prevStatus = order.status;
    const update = { status: newStatus };

    if (newStatus === 'confirmed' && prevStatus === 'new') {
      this.decreaseStock(order.product_id, order.size, order.quantity);
    }
    if (newStatus === 'cancelled' && ['confirmed', 'paid', 'shipped'].includes(prevStatus)) {
      this.addToStock(order.product_id, order.size, order.quantity);
    }
    if (newStatus === 'paid') update.paid_at = nowLocal();
    if (newStatus === 'shipped') update.shipped_at = nowLocal();

    db.get('orders').find({ id: oid }).assign(update).write();
    return true;
  },

  deleteOrder(orderId) {
    const oid = parseInt(orderId);
    const order = db.get('orders').find({ id: oid }).value();
    if (!order) return false;
    if (['confirmed', 'paid', 'shipped'].includes(order.status)) {
      this.addToStock(order.product_id, order.size, order.quantity);
    }
    db.get('orders').remove({ id: oid }).write();
    return true;
  },

  getDashboardStats() {
    const orders = db.get('orders').value();
    const totalStock = this.getTotalStock();
    const newOrders = orders.filter(o => o.status === 'new').length;
    const confirmedOrders = orders.filter(o => o.status === 'confirmed').length;
    const paidOrders = orders.filter(o => o.status === 'paid').length;
    const revenue = orders
      .filter(o => ['paid', 'shipped'].includes(o.status))
      .reduce((sum, o) => sum + (o.price * o.quantity), 0);
    const lowStock = db.get('stock').filter(s => s.quantity === 1).value().length;
    return { totalStock, newOrders, confirmedOrders, paidOrders, revenue, lowStock };
  },

  getBestColors(limit) {
    const orders = db.get('orders').filter(o => o.status !== 'cancelled').value();
    const counts = {};
    for (const o of orders) {
      const p = db.get('products').find({ id: o.product_id }).value();
      if (p) counts[p.sku] = (counts[p.sku] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([sku, cnt]) => ({ sku, cnt }));
  },

  getOrderCounts() {
    const orders = db.get('orders').value();
    return {
      total: orders.length,
      new: orders.filter(o => o.status === 'new').length,
      confirmed: orders.filter(o => o.status === 'confirmed').length,
      paid: orders.filter(o => o.status === 'paid').length,
      shipped: orders.filter(o => o.status === 'shipped').length,
      cancelled: orders.filter(o => o.status === 'cancelled').length
    };
  },

  // ── DELIVERIES ────────────────────────────────────────────────
  getDeliveries(limit) {
    const deliveries = db.get('deliveries').value()
      .slice().sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit || 10);
    return deliveries.map(d => {
      const items = db.get('deliveryItems').filter({ delivery_id: d.id }).value();
      const totalItems = items.reduce((s, i) => s + i.quantity, 0);
      return { ...d, total_items: totalItems };
    });
  },

  createDelivery({ date, notes, items }) {
    const id = nextId('deliveries');
    db.get('deliveries').push({ id, date, notes: notes || null, created_at: nowLocal() }).write();

    let diid = nextId('deliveryItems');
    for (const { productId, size, quantity } of items) {
      if (quantity > 0) {
        db.get('deliveryItems').push({ id: diid++, delivery_id: id, product_id: parseInt(productId), size, quantity }).write();
        this.addToStock(productId, size, quantity);
      }
    }
    return id;
  }
};
