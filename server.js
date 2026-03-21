require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'somablanks2025';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-secret-key-in-production';

function makeToken() {
  const payload = 'auth';
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  if (!token) return false;
  const expected = makeToken();
  return token === expected;
}

const COLOR_MAP = {
  'White': '#F8F8F8',
  'Black': '#1C1C1C',
  'Vintage White': '#EDE8DC',
  'Vintage Black': '#2C2826',
  'Navy': '#1B3A5C',
  'Cold Blue': '#A8C4D4',
  'Pigment Grey': '#7A7A7A',
  'Wild Green': '#4A7C59',
  'Light Grey': '#C0C0C0',
  'Vintage Olive': '#6B6B3A',
  'Vintage Dune': '#C4A882',
  'Grey Marl': '#909090'
};

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(require('cookie-parser')());

function requireAuth(req, res, next) {
  if (verifyToken(req.cookies && req.cookies['soma_auth'])) return next();
  res.redirect('/login');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

function groupByCategory(products) {
  const byCategory = {};
  for (const p of products) {
    if (!byCategory[p.category]) byCategory[p.category] = [];
    byCategory[p.category].push({ ...p, color: COLOR_MAP[p.sku] || '#999999' });
  }
  return byCategory;
}

// ── PUBLIC ────────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  const products = db.getActiveProductsWithStock();
  const byCategory = groupByCategory(products);
  res.render('customer', { byCategory, sizes: SIZES });
});

app.post('/zamow', (req, res) => {
  const { customer_name, customer_contact, product_id, size, notes } = req.body;
  if (!customer_name || !customer_contact || !product_id || !size) {
    return res.status(400).json({ success: false, message: 'Wypełnij wszystkie wymagane pola.' });
  }
  const product = db.getProduct(product_id);
  if (!product || !product.active) {
    return res.status(404).json({ success: false, message: 'Produkt nie istnieje.' });
  }
  const qty = db.getStockQty(product_id, size);
  if (qty <= 0) {
    return res.status(400).json({ success: false, message: 'Wybrany rozmiar jest niedostępny.' });
  }
  db.createOrder({
    customerName: customer_name,
    customerContact: customer_contact,
    productId: product_id,
    size,
    price: product.price,
    notes
  });
  res.json({ success: true, message: 'Dziękujemy! Odezwiemy się wkrótce przez Facebook / SMS.' });
});

// ── AUTH ──────────────────────────────────────────────────────────────────────

app.get('/login', (req, res) => {
  if (verifyToken(req.cookies['soma_auth'])) return res.redirect('/admin');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    res.cookie('soma_auth', makeToken(), {
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax'
    });
    res.redirect('/admin');
  } else {
    res.render('login', { error: 'Nieprawidłowe hasło.' });
  }
});

app.get('/wyloguj', (req, res) => {
  res.clearCookie('soma_auth');
  res.redirect('/login');
});

// ── ADMIN DASHBOARD ───────────────────────────────────────────────────────────

app.get('/admin', requireAuth, (req, res) => {
  const stats = db.getDashboardStats();
  const recentOrders = db.getRecentOrders(5);
  const lowStockItems = db.getLowStock();
  const bestColors = db.getBestColors(3);
  res.render('dashboard', { ...stats, recentOrders, lowStockItems, bestColors, colorMap: COLOR_MAP, formatDate });
});

// ── ADMIN MAGAZYN ─────────────────────────────────────────────────────────────

app.get('/admin/magazyn', requireAuth, (req, res) => {
  const products = db.getAllProductsWithStock();
  const byCategory = groupByCategory(products);
  res.render('inventory', { byCategory, sizes: SIZES });
});

app.post('/admin/magazyn/aktualizuj', requireAuth, (req, res) => {
  const { product_id, size, quantity } = req.body;
  const qty = parseInt(quantity, 10);
  if (isNaN(qty) || qty < 0) return res.status(400).json({ success: false, message: 'Nieprawidłowa ilość.' });
  db.updateStock(product_id, size, qty);
  res.json({ success: true });
});

app.post('/admin/magazyn/dodaj', requireAuth, (req, res) => {
  const { name, sku, category, price } = req.body;
  if (!sku || !category) return res.redirect('/admin/magazyn');
  db.addProduct({ name: name || sku, sku, category, price: parseFloat(price) || 129 });
  res.redirect('/admin/magazyn');
});

app.post('/admin/magazyn/ukryj', requireAuth, (req, res) => {
  const newActive = db.toggleProductActive(req.body.product_id);
  if (newActive === null) return res.status(404).json({ success: false });
  res.json({ success: true, active: newActive });
});

// ── ADMIN ZAMÓWIENIA ──────────────────────────────────────────────────────────

app.get('/admin/zamowienia', requireAuth, (req, res) => {
  const statusFilter = req.query.status || '';
  const orders = db.getOrders(statusFilter);
  const counts = db.getOrderCounts();
  res.render('orders', { orders, statusFilter, counts, colorMap: COLOR_MAP, formatDate });
});

app.post('/admin/zamowienia/status', requireAuth, (req, res) => {
  const { order_id, status } = req.body;
  const ok = db.updateOrderStatus(order_id, status);
  if (!ok) return res.status(404).json({ success: false, message: 'Zamówienie nie znalezione.' });
  res.json({ success: true });
});

app.post('/admin/zamowienia/usun', requireAuth, (req, res) => {
  const ok = db.deleteOrder(req.body.order_id);
  if (!ok) return res.status(404).json({ success: false });
  res.json({ success: true });
});

// ── ADMIN DOSTAWA ─────────────────────────────────────────────────────────────

app.get('/admin/dostawa', requireAuth, (req, res) => {
  const products = db.getActiveProductsWithStock();
  const deliveries = db.getDeliveries(10);
  const today = new Date().toISOString().split('T')[0];
  res.render('delivery', { products, sizes: SIZES, deliveries, today, formatDate, colorMap: COLOR_MAP });
});

app.post('/admin/dostawa', requireAuth, (req, res) => {
  const { date, notes } = req.body;
  if (!date) return res.redirect('/admin/dostawa');

  const items = [];
  for (const key of Object.keys(req.body)) {
    const match = key.match(/^qty_(\d+)_(.+)$/);
    if (!match) continue;
    const qty = parseInt(req.body[key], 10);
    if (qty > 0) items.push({ productId: match[1], size: match[2], quantity: qty });
  }

  db.createDelivery({ date, notes, items });
  res.redirect('/admin/dostawa');
});

// ── START ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✅ Soma Blanks działa na http://localhost:${PORT}`);
  console.log(`   Panel admina: http://localhost:${PORT}/login`);
});
