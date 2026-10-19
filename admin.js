/**
 * SmileCraft Dental Studio — Admin dashboard
 * ------------------------------------------------------------------
 * URL:   /admin
 * Env:   MONGODB_URI, ADMIN_PASSWORD
 * Login: enter the value of ADMIN_PASSWORD (fallback "smilecraft2025" if unset).
 * ------------------------------------------------------------------
 */
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

/* ----------------------------- DB Connection ----------------------------- */
async function connectDB() {
  if (!global.__mongo) global.__mongo = {};
  if (global.__mongo.conn) return global.__mongo.conn;
  if (global.__mongo.promise) return global.__mongo.promise;

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Database not configured (MONGODB_URI missing)');

  mongoose.set('strictQuery', true);
  global.__mongo.promise = mongoose
    .connect(uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 8000 })
    .then((m) => {
      global.__mongo.conn = m;
      return m;
    })
    .catch((err) => {
      global.__mongo.promise = null;
      throw err;
    });

  return global.__mongo.promise;
}

/* -------------------------------- Schema --------------------------------- */
const BookingSchema = new mongoose.Schema({
  reference: { type: String, unique: true, index: true },
  name: { type: String, required: true, minlength: 2 },
  email: { type: String, required: true, lowercase: true },
  phone: { type: String, required: true },
  service: { type: String, required: true },
  dentist: { type: String, default: 'No preference' },
  date: { type: String, required: true },
  time: { type: String, required: true },
  notes: { type: String, maxlength: 400, default: '' },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'completed', 'cancelled'],
    default: 'pending',
  },
  createdAt: { type: Date, default: Date.now },
});
const Booking =
  mongoose.models.Booking || mongoose.model('Booking', BookingSchema);

const SERVICE_PRICE = {
  'General Checkup & Cleaning': 49,
  'Teeth Whitening': 199,
  'Braces / Aligner Consult': 75,
  'Root Canal Treatment': 299,
  'Dental Implants': 899,
  'Kids Dentistry': 35,
  'Emergency Care': 89,
};

/* --------------------------------- Auth ---------------------------------- */
const ADMIN_PW = process.env.ADMIN_PASSWORD || 'smilecraft2025';
const TOKEN_TTL = 12 * 60 * 60 * 1000;

function makeToken() {
  const payload = 'admin:' + Date.now();
  const sig = crypto.createHmac('sha256', ADMIN_PW).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64') + '.' + sig;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [enc, sig] = parts;
  let payload;
  try {
    payload = Buffer.from(enc, 'base64').toString();
  } catch {
    return false;
  }
  const [role, ts] = payload.split(':');
  if (role !== 'admin') return false;
  if (Date.now() - parseInt(ts, 10) > TOKEN_TTL) return false;
  const expected = crypto.createHmac('sha256', ADMIN_PW).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function requireAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!verifyToken(token)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

/* -------------------------------- Admin API ------------------------------ */
app.post('/admin/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ success: false, message: 'Password required' });
  if (password !== ADMIN_PW) {
    return res.status(401).json({ success: false, message: 'Wrong password' });
  }
  res.json({ success: true, data: { token: makeToken() } });
});

app.get('/admin/api/stats', requireAuth, async (req, res) => {
  try {
    await connectDB();
    const [all, todayCount] = await Promise.all([
      Booking.find().lean(),
      Booking.countDocuments({
        date: new Date().toISOString().split('T')[0],
        status: { $ne: 'cancelled' },
      }),
    ]);
    const counts = { pending: 0, confirmed: 0, completed: 0, cancelled: 0 };
    let revenue = 0;
    all.forEach((b) => {
      if (counts[b.status] !== undefined) counts[b.status]++;
      if (b.status === 'completed') revenue += SERVICE_PRICE[b.service] || 0;
    });
    res.json({
      success: true,
      data: {
        total: all.length,
        todayCount,
        revenue,
        ...counts,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to load stats' });
  }
});

app.get('/admin/api/bookings', requireAuth, async (req, res) => {
  try {
    await connectDB();
    const { status, date, search } = req.query;
    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const filter = {};
    if (status && ['pending', 'confirmed', 'completed', 'cancelled'].includes(status)) {
      filter.status = status;
    }
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) filter.date = date;
    if (search && search.trim()) {
      const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { reference: rx }];
    }
    const [items, total] = await Promise.all([
      Booking.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Booking.countDocuments(filter),
    ]);
    res.json({ success: true, data: { items, total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to load bookings' });
  }
});

app.patch('/admin/api/bookings/:id', requireAuth, async (req, res) => {
  try {
    await connectDB();
    const { status } = req.body || {};
    if (!['pending', 'confirmed', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const b = await Booking.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!b) return res.status(404).json({ success: false, message: 'Booking not found' });
    res.json({ success: true, data: { booking: b } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Update failed' });
  }
});

app.delete('/admin/api/bookings/:id', requireAuth, async (req, res) => {
  try {
    await connectDB();
    const b = await Booking.findByIdAndDelete(req.params.id);
    if (!b) return res.status(404).json({ success: false, message: 'Booking not found' });
    res.json({ success: true, data: { deleted: b._id } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Delete failed' });
  }
});

app.get('/admin/api/export', requireAuth, async (req, res) => {
  try {
    await connectDB();
    const rows = await Booking.find().sort({ createdAt: -1 }).lean();
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const headers = ['reference', 'name', 'email', 'phone', 'service', 'dentist', 'date', 'time', 'status', 'notes', 'createdAt'];
    const csv = [headers.join(',')]
      .concat(rows.map((r) => headers.map((h) => esc(r[h])).join(',')))
      .join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="smilecraft-bookings-${Date.now()}.csv"`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ success: false, message: 'Export failed' });
  }
});

/* ------------------------------- Admin HTML ------------------------------ */
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>SmileCraft — Admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
<style>
:root{
  --bg:#F5F1FF; --ink:#2E2A4A; --muted:#6F6A8A;
  --mint:#A8E6CF; --mint-d:#63CBA8; --lav:#C7B9FF; --lav-d:#8B7BEE;
  --card:linear-gradient(145deg,#ffffff,#f3eefe);
  --clay:8px 8px 24px rgba(163,177,198,.45), -8px -8px 24px rgba(255,255,255,.95), inset -4px -4px 10px rgba(163,177,198,.18), inset 4px 4px 10px rgba(255,255,255,.9);
  --clay-sm:4px 4px 12px rgba(163,177,198,.4), -4px -4px 12px rgba(255,255,255,.9), inset -2px -2px 6px rgba(163,177,198,.15), inset 2px 2px 6px rgba(255,255,255,.85);
  --clay-press:inset 6px 6px 12px rgba(163,177,198,.4), inset -6px -6px 12px rgba(255,255,255,.9);
}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Poppins',sans-serif;background:var(--bg);color:var(--ink);line-height:1.5;min-height:100vh}
h1,h2,h3,h4{font-family:'Fredoka',sans-serif;font-weight:600;letter-spacing:-.4px}
a{color:inherit;text-decoration:none}
button{font-family:inherit;cursor:pointer;border:none}

/* Login */
.login-wrap{min-height:100vh;display:grid;place-items:center;padding:24px;background:
  radial-gradient(circle at 15% 20%, rgba(199,185,255,.5), transparent 40%),
  radial-gradient(circle at 85% 80%, rgba(168,230,207,.5), transparent 40%),var(--bg)}
.login-card{width:100%;max-width:420px;background:var(--card);border-radius:32px;padding:44px 36px;box-shadow:var(--clay);text-align:center}
.login-card .logo{width:72px;height:72px;border-radius:22px;display:grid;place-items:center;font-size:2rem;margin:0 auto 18px;background:linear-gradient(145deg,#8BE3C6,#63CBA8);box-shadow:var(--clay-sm)}
.login-card h1{font-size:1.6rem;margin-bottom:8px}
.login-card p{color:var(--muted);font-size:.9rem;margin-bottom:26px}
.login-card .field{display:flex;flex-direction:column;gap:6px;text-align:left;margin-bottom:14px}
.login-card label{font-size:.85rem;font-weight:600}
.login-card input{padding:14px 16px;border-radius:16px;border:none;background:#fff;box-shadow:var(--clay-sm);font-family:inherit;font-size:.95rem;outline:none}
.login-card input:focus{box-shadow:inset 4px 4px 10px rgba(163,177,198,.35),inset -4px -4px 10px rgba(255,255,255,.95)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:14px 22px;border-radius:18px;font-weight:600;font-size:.92rem;color:#fff;background:linear-gradient(145deg,#8BE3C6,#63CBA8);box-shadow:var(--clay-sm);transition:transform .15s}
.btn:hover{transform:translateY(-2px)}
.btn:active{transform:translateY(2px);box-shadow:var(--clay-press)}
.btn.block{width:100%}
.btn.sec{background:linear-gradient(145deg,#D9CFFF,#B9A6FF);color:var(--ink)}
.btn.ghost{background:#fff;color:var(--ink)}
.btn.danger{background:linear-gradient(145deg,#FFB1C1,#F07290)}
.btn.sm{padding:8px 14px;font-size:.8rem;border-radius:12px}
.login-card .btn{width:100%;padding:16px;margin-top:8px}
.errm{color:#E5457B;font-size:.82rem;min-height:20px;margin-top:8px}
.shake{animation:shake .4s}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}

/* Dashboard */
.dash{display:none;min-height:100vh}
.dash.on{display:grid;grid-template-columns:260px 1fr}
.side{background:var(--card);padding:26px 22px;box-shadow:4px 0 20px rgba(163,177,198,.25);display:flex;flex-direction:column;gap:8px;position:sticky;top:0;height:100vh}
.side .brand{display:flex;align-items:center;gap:10px;font-family:'Fredoka',sans-serif;font-size:1.2rem;font-weight:700;padding:0 8px;margin-bottom:22px}
.side .brand .logo{width:42px;height:42px;border-radius:14px;display:grid;place-items:center;font-size:1.2rem;background:linear-gradient(145deg,#8BE3C6,#63CBA8)}
.nav-item{display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:14px;font-weight:500;color:var(--muted);cursor:pointer;transition:.2s}
.nav-item:hover{background:#fff;color:var(--ink)}
.nav-item.active{background:linear-gradient(145deg,#D9CFFF,#B9A6FF);color:var(--ink);box-shadow:var(--clay-sm)}
.side .spacer{flex:1}
.main{padding:28px;overflow-x:hidden}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:26px;flex-wrap:wrap}
.topbar h1{font-size:1.7rem}
.topbar .right{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.search{display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:14px;background:#fff;box-shadow:var(--clay-sm)}
.search input{border:none;outline:none;background:transparent;font-family:inherit;font-size:.9rem;width:220px}

/* Stats */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:16px;margin-bottom:24px}
.stat{background:var(--card);border-radius:22px;padding:20px;box-shadow:var(--clay-sm);display:flex;gap:14px;align-items:center}
.stat .ic{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;font-size:1.3rem;flex-shrink:0}
.stat .info .lbl{font-size:.78rem;color:var(--muted);font-weight:500}
.stat .info .num{font-family:'Fredoka',sans-serif;font-size:1.6rem;font-weight:700}

/* Filters */
.filters{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap;align-items:center}
.tab{padding:9px 16px;border-radius:12px;background:#fff;box-shadow:var(--clay-sm);font-size:.85rem;font-weight:500;color:var(--muted);cursor:pointer;transition:.2s}
.tab.active{background:linear-gradient(145deg,#8BE3C6,#63CBA8);color:#fff}
.date-in{padding:9px 14px;border-radius:12px;border:none;background:#fff;box-shadow:var(--clay-sm);font-family:inherit;font-size:.85rem;outline:none}

/* Table */
.table-card{background:var(--card);border-radius:24px;box-shadow:var(--clay);overflow:hidden}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:.88rem}
th,td{padding:14px 16px;text-align:left;white-space:nowrap}
th{background:rgba(199,185,255,.18);font-weight:600;font-size:.78rem;text-transform:uppercase;letter-spacing:.5px;color:var(--muted)}
tbody tr{border-top:1px solid rgba(163,177,198,.15);transition:.15s}
tbody tr:hover{background:rgba(168,230,207,.12)}
td.wrap{white-space:normal;max-width:260px}
.badge{padding:5px 10px;border-radius:100px;font-size:.75rem;font-weight:600;display:inline-block}
.badge.pending{background:#FFF3CC;color:#A87A00}
.badge.confirmed{background:#D4F5E4;color:#0F7A4A}
.badge.completed{background:#DCE8FF;color:#1E4FBF}
.badge.cancelled{background:#FFE0E8;color:#B22B5B}
.actions{display:flex;gap:6px;flex-wrap:wrap}
.empty{text-align:center;padding:60px 20px;color:var(--muted)}
.empty .big{font-size:3rem;margin-bottom:12px}
.pager{display:flex;justify-content:space-between;align-items:center;padding:14px 20px;font-size:.85rem;color:var(--muted);border-top:1px solid rgba(163,177,198,.15)}
.pager button{padding:8px 14px;border-radius:12px;background:#fff;box-shadow:var(--clay-sm);font-size:.82rem}
.pager button:disabled{opacity:.4;cursor:not-allowed}

/* Chart */
.chart-card{background:var(--card);border-radius:24px;padding:22px;box-shadow:var(--clay-sm);margin-bottom:20px;display:grid;grid-template-columns:180px 1fr;gap:26px;align-items:center}
.donut{width:180px;height:180px;border-radius:50%;position:relative;margin:auto;background:conic-gradient(#FFF3CC 0deg,#D4F5E4 0deg,#DCE8FF 0deg,#FFE0E8 0deg)}
.donut::before{content:'';position:absolute;inset:24px;background:#fff;border-radius:50%;box-shadow:inset 4px 4px 10px rgba(163,177,198,.3)}
.donut .center{position:absolute;inset:0;display:grid;place-items:center;font-family:'Fredoka',sans-serif;font-size:1.4rem;font-weight:700;color:var(--ink)}
.legend{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.legend .item{display:flex;align-items:center;gap:10px;font-size:.85rem}
.legend .dot{width:12px;height:12px;border-radius:4px}

/* Toast */
.toast{position:fixed;bottom:24px;right:24px;background:#fff;padding:14px 20px;border-radius:16px;box-shadow:var(--clay);font-size:.9rem;font-weight:500;opacity:0;transform:translateY(20px);transition:.3s;z-index:200;max-width:340px}
.toast.show{opacity:1;transform:none}
.toast.err{color:#B22B5B;box-shadow:0 0 0 2px #FFE0E8,var(--clay)}

/* Modal */
.modal{position:fixed;inset:0;background:rgba(46,42,74,.4);backdrop-filter:blur(4px);display:none;place-items:center;z-index:150;padding:20px}
.modal.on{display:grid}
.modal-card{background:var(--card);border-radius:26px;padding:32px;max-width:400px;width:100%;box-shadow:var(--clay);text-align:center}
.modal-card h3{margin-bottom:10px}
.modal-card p{color:var(--muted);font-size:.92rem;margin-bottom:22px}
.modal-card .row{display:flex;gap:10px;justify-content:center}

/* Responsive */
@media (max-width:900px){
  .dash.on{grid-template-columns:1fr}
  .side{position:fixed;bottom:0;left:0;right:0;top:auto;height:auto;flex-direction:row;padding:12px;gap:6px;box-shadow:0 -4px 20px rgba(163,177,198,.25);z-index:50}
  .side .brand,.side .spacer{display:none}
  .nav-item{flex:1;justify-content:center;padding:10px;font-size:.8rem;flex-direction:column;gap:4px}
  .main{padding:20px 16px 100px}
  .topbar h1{font-size:1.4rem}
  .search input{width:140px}
  .chart-card{grid-template-columns:1fr;text-align:center}
  th,td{padding:10px 12px;font-size:.82rem}
}
</style>
</head>
<body>

<!-- Login -->
<div class="login-wrap" id="loginScreen">
  <form class="login-card" id="loginForm">
    <div class="logo">🦷</div>
    <h1>SmileCraft Admin</h1>
    <p>Enter your admin password to continue.</p>
    <div class="field"><label>Password</label><input type="password" id="pw" placeholder="••••••••" required /></div>
    <button type="submit" class="btn">Enter Dashboard →</button>
    <div class="errm" id="loginErr"></div>
  </form>
</div>

<!-- Dashboard -->
<div class="dash" id="dash">
  <aside class="side">
    <div class="brand"><span class="logo">🦷</span> SmileCraft</div>
    <div class="nav-item active" data-tab="overview">📊 Overview</div>
    <div class="nav-item" data-tab="bookings">📅 Bookings</div>
    <div class="nav-item" data-tab="calendar">🗓️ Calendar</div>
    <div class="spacer"></div>
    <div class="nav-item" id="logoutBtn">🚪 Logout</div>
  </aside>

  <main class="main">
    <div class="topbar">
      <h1 id="title">Overview</h1>
      <div class="right">
        <div class="search">🔍<input type="text" id="searchInput" placeholder="Search name, phone, ref…" /></div>
        <button class="btn ghost sm" id="refreshBtn">🔄 Refresh</button>
        <button class="btn sm" id="exportBtn">⬇ Export CSV</button>
      </div>
    </div>

    <div class="stats" id="statsGrid"></div>

    <div class="chart-card">
      <div class="donut" id="donut"><div class="center" id="donutTotal">0</div></div>
      <div>
        <h3 style="margin-bottom:14px">Status Breakdown</h3>
        <div class="legend" id="legend"></div>
      </div>
    </div>

    <div class="filters">
      <div class="tab active" data-status="">All</div>
      <div class="tab" data-status="pending">Pending</div>
      <div class="tab" data-status="confirmed">Confirmed</div>
      <div class="tab" data-status="completed">Completed</div>
      <div class="tab" data-status="cancelled">Cancelled</div>
      <input type="date" class="date-in" id="dateFilter" />
    </div>

    <div class="table-card">
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Ref</th><th>Patient</th><th>Service</th><th>Dentist</th><th>Date</th><th>Time</th><th>Status</th><th>Actions</th>
          </tr></thead>
          <tbody id="rows"><tr><td colspan="8"><div class="empty">Loading…</div></td></tr></tbody>
        </table>
      </div>
      <div class="pager">
        <span id="pageInfo">—</span>
        <div style="display:flex;gap:8px">
          <button id="prevBtn">← Prev</button>
          <button id="nextBtn">Next →</button>
        
