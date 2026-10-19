/**
 * SmileCraft Dental Studio — Public site + API
 * ------------------------------------------------------------------
 * Vercel Environment Variables (Project → Settings → Environment Variables):
 *   MONGODB_URI     →  mongodb+srv://<user>:<pass>@cluster.mongodb.net/smilecraft
 *   ADMIN_PASSWORD  →  (used by admin.js, optional here)
 *
 * Local dev:
 *   MONGODB_URI="..." node index.js
 *
 * MongoDB Atlas: whitelist 0.0.0.0/0 (Vercel uses dynamic IPs).
 * ------------------------------------------------------------------
 */
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

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

/* -------------------------------- Schemas -------------------------------- */
const BookingSchema = new mongoose.Schema({
  reference: { type: String, unique: true, index: true },
  name: { type: String, required: true, minlength: 2 },
  email: {
    type: String,
    required: true,
    lowercase: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  },
  phone: { type: String, required: true, minlength: 7, maxlength: 20 },
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

/* ------------------------------ Static Data ------------------------------ */
const SERVICES = [
  { name: 'General Checkup & Cleaning', duration: 30, price: 49, emoji: '🦷', color: '#A8E6CF' },
  { name: 'Teeth Whitening', duration: 60, price: 199, emoji: '✨', color: '#FFE29A' },
  { name: 'Braces / Aligner Consult', duration: 45, price: 75, emoji: '😁', color: '#C7B9FF' },
  { name: 'Root Canal Treatment', duration: 90, price: 299, emoji: '🩺', color: '#FFAAB8' },
  { name: 'Dental Implants', duration: 120, price: 899, emoji: '🔧', color: '#A0E7E5' },
  { name: 'Kids Dentistry', duration: 30, price: 35, emoji: '🧒', color: '#FFC3A0' },
  { name: 'Emergency Care', duration: 30, price: 89, emoji: '🚨', color: '#FFB1B1' },
];

const DENTISTS = [
  {
    name: 'Dr. Maya Sharma',
    role: 'Orthodontist',
    years: 12,
    bio: 'Invisible aligners & confident smiles.',
    img: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?w=400&q=80',
  },
  {
    name: "Dr. Liam O'Connor",
    role: 'Cosmetic Dentistry',
    years: 9,
    bio: 'Veneers, whitening, smile makeovers.',
    img: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=400&q=80',
  },
  {
    name: 'Dr. Priya Nair',
    role: 'Pediatric Dentistry',
    years: 8,
    bio: 'Fear-free visits for little smiles.',
    img: 'https://images.unsplash.com/photo-1594824476967-48c8b964273f?w=400&q=80',
  },
  {
    name: 'Dr. Noah Bennett',
    role: 'Implantologist',
    years: 15,
    bio: 'Permanent, natural-looking implants.',
    img: 'https://images.unsplash.com/photo-1612349317150-e413f6a5b16d?w=400&q=80',
  },
];

const ALL_SLOTS = [
  '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
  '12:00 PM', '12:30 PM', '01:00 PM', '01:30 PM', '02:00 PM', '02:30 PM',
  '03:00 PM', '03:30 PM', '04:00 PM', '04:30 PM', '05:00 PM', '05:30 PM',
  '06:00 PM', '06:30 PM',
];

/* --------------------------------- Helpers ------------------------------- */
function genReference() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'SCD-';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isPastDate(dateStr) {
  return dateStr < todayStr();
}
function isSunday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay() === 0;
}

/* ------------------------------- API Routes ------------------------------ */
app.get('/api/health', async (req, res) => {
  try {
    await connectDB();
    res.json({ ok: true, db: 'connected' });
  } catch (e) {
    res.status(500).json({ ok: false, db: 'disconnected', message: e.message });
  }
});

app.get('/api/services', (req, res) => {
  res.json({ success: true, data: { services: SERVICES, dentists: DENTISTS } });
});

app.get('/api/slots', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: 'Valid date required (YYYY-MM-DD)' });
    }
    if (isPastDate(date)) {
      return res.json({ success: true, data: { slots: ALL_SLOTS.map((t) => ({ time: t, available: false })) } });
    }
    if (isSunday(date)) {
      return res.json({ success: true, data: { slots: ALL_SLOTS.map((t) => ({ time: t, available: false })) } });
    }
    await connectDB();
    const taken = await Booking.find({ date, status: { $ne: 'cancelled' } }).select('time').lean();
    const takenSet = new Set(taken.map((b) => b.time));
    const slots = ALL_SLOTS.map((t) => ({ time: t, available: !takenSet.has(t) }));
    res.json({ success: true, data: { slots } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Could not load slots' });
  }
});

app.post('/api/bookings', async (req, res) => {
  try {
    const { name, email, phone, service, dentist, date, time, notes } = req.body || {};
    if (!name || name.trim().length < 2) return res.status(400).json({ success: false, message: 'Please enter your full name.' });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, message: 'Please enter a valid email.' });
    if (!phone || phone.trim().length < 7) return res.status(400).json({ success: false, message: 'Please enter a valid phone number.' });
    if (!service || !SERVICES.find((s) => s.name === service)) return res.status(400).json({ success: false, message: 'Please choose a valid service.' });
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ success: false, message: 'Please pick a valid date.' });
    if (isPastDate(date)) return res.status(400).json({ success: false, message: 'That date has already passed.' });
    if (isSunday(date)) return res.status(400).json({ success: false, message: 'We are closed on Sundays.' });
    if (!time || !ALL_SLOTS.includes(time)) return res.status(400).json({ success: false, message: 'Please pick a valid time slot.' });

    await connectDB();

    const dup = await Booking.findOne({ date, time, status: { $ne: 'cancelled' } });
    if (dup) return res.status(409).json({ success: false, message: 'That slot was just taken. Please pick another.' });

    const ref = genReference();
    const booking = await Booking.create({
      reference: ref,
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      service,
      dentist: dentist || 'No preference',
      date,
      time,
      notes: (notes || '').slice(0, 400),
      status: 'pending',
    });

    res.status(201).json({ success: true, data: { booking } });
  } catch (e) {
    if (e && e.code === 11000) {
      return res.status(409).json({ success: false, message: 'Reference collision — please retry.' });
    }
    res.status(500).json({ success: false, message: 'Could not save booking. Please try again.' });
  }
});

app.get('/api/bookings/:reference', async (req, res) => {
  try {
    await connectDB();
    const b = await Booking.findOne({ reference: req.params.reference.toUpperCase() }).lean();
    if (!b) return res.status(404).json({ success: false, message: 'Booking not found' });
    res.json({ success: true, data: { booking: b } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Lookup failed' });
  }
});

/* ------------------------------ Public HTML ------------------------------ */
const PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>SmileCraft Dental Studio — Bright Smiles, Gentle Care</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Poppins:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
<style>
:root{
  --bg:#FFF9F5; --ink:#2E2A4A; --muted:#6F6A8A;
  --mint:#A8E6CF; --mint-d:#63CBA8; --sky:#A0E7E5; --lav:#C7B9FF;
  --peach:#FFC3A0; --blush:#FFAAB8; --sun:#FFE29A;
  --card:linear-gradient(145deg,#ffffff,#f3eefe);
  --clay:8px 8px 24px rgba(163,177,198,.45), -8px -8px 24px rgba(255,255,255,.95), inset -4px -4px 10px rgba(163,177,198,.18), inset 4px 4px 10px rgba(255,255,255,.9);
  --clay-sm:4px 4px 12px rgba(163,177,198,.4), -4px -4px 12px rgba(255,255,255,.9), inset -2px -2px 6px rgba(163,177,198,.15), inset 2px 2px 6px rgba(255,255,255,.85);
  --clay-press:inset 6px 6px 12px rgba(163,177,198,.4), inset -6px -6px 12px rgba(255,255,255,.9);
  --radius:32px;
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Poppins',sans-serif;background:var(--bg);color:var(--ink);line-height:1.6;overflow-x:hidden}
h1,h2,h3,h4{font-family:'Fredoka',sans-serif;font-weight:600;line-height:1.2;letter-spacing:-.5px}
a{color:inherit;text-decoration:none}
img{max-width:100%;display:block}
.container{max-width:1180px;margin:0 auto;padding:0 24px}
section{padding:90px 0;position:relative}

/* Background blobs */
.blob{position:absolute;border-radius:50%;filter:blur(60px);opacity:.55;pointer-events:none;z-index:0}
.blob.b1{width:420px;height:420px;background:var(--mint);top:-120px;left:-120px;animation:float 8s ease-in-out infinite}
.blob.b2{width:380px;height:380px;background:var(--lav);top:120px;right:-120px;animation:float 10s ease-in-out infinite reverse}
.blob.b3{width:340px;height:340px;background:var(--peach);bottom:-100px;left:20%;animation:float 9s ease-in-out infinite}
.blob.b4{width:300px;height:300px;background:var(--sun);bottom:-80px;right:15%;animation:float 11s ease-in-out infinite reverse}
@keyframes float{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-25px) rotate(6deg)}}

/* Navbar */
.nav{position:sticky;top:16px;z-index:50;margin:16px auto 0;max-width:1180px;padding:14px 22px;display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,.75);backdrop-filter:blur(14px);border-radius:24px;box-shadow:var(--clay-sm)}
.logo{display:flex;align-items:center;gap:10px;font-family:'Fredoka',sans-serif;font-size:1.35rem;font-weight:700}
.logo-badge{width:44px;height:44px;border-radius:16px;display:grid;place-items:center;font-size:1.3rem;background:linear-gradient(145deg,#8BE3C6,#63CBA8);box-shadow:var(--clay-sm)}
.nav-links{display:flex;gap:26px;font-weight:500;font-size:.94rem}
.nav-links a{opacity:.8;transition:.2s}
.nav-links a:hover{opacity:1;transform:translateY(-1px)}
.nav-right{display:flex;align-items:center;gap:12px}
.phone-pill{display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:16px;background:#fff;box-shadow:var(--clay-sm);font-weight:500;font-size:.9rem}
.btn{display:inline-flex;align-items:center;gap:8px;padding:14px 26px;border:none;border-radius:20px;font-family:inherit;font-weight:600;font-size:.95rem;cursor:pointer;transition:transform .15s ease,box-shadow .15s ease;box-shadow:var(--clay-sm);color:#fff;background:linear-gradient(145deg,#8BE3C6,#63CBA8)}
.btn:hover{transform:translateY(-2px)}
.btn:active{transform:translateY(2px);box-shadow:var(--clay-press)}
.btn.sec{background:linear-gradient(145deg,#D9CFFF,#B9A6FF);color:var(--ink)}
.btn.ghost{background:#fff;color:var(--ink)}
.btn.lg{padding:16px 32px;font-size:1rem}
.menu-btn{display:none;width:44px;height:44px;border-radius:14px;background:#fff;box-shadow:var(--clay-sm);border:none;font-size:1.3rem;cursor:pointer}

/* Hero */
.hero{padding-top:60px;display:grid;grid-template-columns:1.1fr 1fr;gap:60px;align-items:center;position:relative;z-index:1}
.hero-chip{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:100px;background:#fff;box-shadow:var(--clay-sm);font-size:.85rem;font-weight:500;margin-bottom:22px}
.hero h1{font-size:clamp(2.2rem,4.5vw,3.8rem);margin-bottom:18px}
.grad{background:linear-gradient(135deg,#63CBA8,#7B68EE 55%,#FF8FAB);-webkit-background-clip:text;background-clip:text;color:transparent}
.hero p.lead{color:var(--muted);font-size:1.08rem;max-width:520px;margin-bottom:32px}
.hero-cta{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:32px}
.trust{display:flex;gap:14px;flex-wrap:wrap}
.trust .pill{padding:10px 16px;border-radius:14px;background:#fff;box-shadow:var(--clay-sm);font-size:.85rem;font-weight:500}
.hero-visual{position:relative;display:flex;justify-content:center;align-items:center;height:520px}
.hero-blob{width:420px;height:420px;background:linear-gradient(145deg,#A8E6CF,#C7B9FF);border-radius:62% 38% 55% 45% / 45% 55% 45% 55%;position:relative;box-shadow:var(--clay);overflow:hidden;animation:blobMorph 12s ease-in-out infinite}
.hero-blob img{width:100%;height:100%;object-fit:cover;mix-blend-mode:multiply;opacity:.9}
@keyframes blobMorph{0%,100%{border-radius:62% 38% 55% 45% / 45% 55% 45% 55%}50%{border-radius:45% 55% 40% 60% / 55% 45% 60% 40%}}
.float-badge{position:absolute;background:#fff;padding:12px 18px;border-radius:18px;box-shadow:var(--clay);font-size:.85rem;font-weight:600;display:flex;align-items:center;gap:8px;animation:float 6s ease-in-out infinite}
.float-badge.tl{top:20px;left:0;animation-delay:.2s}
.float-badge.tr{top:80px;right:0;animation-delay:1s}
.float-badge.bl{bottom:80px;left:10px;animation-delay:2s}

/* Reveal */
.reveal{opacity:0;transform:translateY(30px);transition:opacity .7s ease,transform .7s ease}
.reveal.in{opacity:1;transform:none}

/* Stats */
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:22px;margin-top:20px;position:relative;z-index:1}
.stat{padding:30px 24px;border-radius:26px;background:var(--card);box-shadow:var(--clay);text-align:center}
.stat .num{font-family:'Fredoka',sans-serif;font-size:2.2rem;font-weight:700;background:linear-gradient(135deg,#63CBA8,#7B68EE);-webkit-background-clip:text;background-clip:text;color:transparent}
.stat .lbl{color:var(--muted);font-size:.9rem;margin-top:4px;font-weight:500}

/* Section heads */
.section-head{text-align:center;max-width:640px;margin:0 auto 50px}
.section-head h2{font-size:clamp(1.9rem,3.5vw,2.7rem);margin-bottom:12px}
.section-head p{color:var(--muted);font-size:1.02rem}

/* Services */
.services{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:22px;position:relative;z-index:1}
.service{padding:28px 24px;border-radius:26px;background:var(--card);box-shadow:var(--clay);transition:transform .25s ease,box-shadow .25s ease;position:relative;overflow:hidden}
.service:hover{transform:translateY(-6px) rotate(-.5deg)}
.service-icon{width:64px;height:64px;border-radius:22px;display:grid;place-items:center;font-size:1.8rem;margin-bottom:18px;box-shadow:var(--clay-sm)}
.service h3{font-size:1.1rem;margin-bottom:8px}
.service .meta{color:var(--muted);font-size:.85rem;margin-bottom:14px}
.service .price{font-family:'Fredoka',sans-serif;font-size:1.3rem;font-weight:600;color:var(--mint-d)}
.service .book-link{display:inline-flex;align-items:center;gap:4px;font-weight:600;font-size:.9rem;margin-top:12px;color:var(--ink);cursor:pointer}
.service .book-link:hover{color:var(--mint-d)}

/* Dentists */
.dentists{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:22px;position:relative;z-index:1}
.dentist{padding:26px 22px;border-radius:26px;background:var(--card);box-shadow:var(--clay);text-align:center;transition:transform .25s}
.dentist:hover{transform:translateY(-6px)}
.dentist img{width:120px;height:120px;border-radius:50%;object-fit:cover;margin:0 auto 16px;box-shadow:var(--clay-sm);border:4px solid #fff}
.dentist h3{font-size:1.05rem;margin-bottom:4px}
.dentist .role{color:var(--mint-d);font-weight:600;font-size:.85rem;margin-bottom:8px}
.dentist .bio{color:var(--muted);font-size:.88rem;margin-bottom:14px}
.dentist .btn{padding:10px 18px;font-size:.82rem}

/* Why */
.why{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:22px;position:relative;z-index:1}
.why-card{padding:26px 22px;border-radius:24px;background:var(--card);box-shadow:var(--clay);transition:transform .25s}
.why-card:hover{transform:scale(1.03)}
.why-card .emoji{font-size:2rem;margin-bottom:12px}
.why-card h4{font-size:1.02rem;margin-bottom:6px}
.why-card p{color:var(--muted);font-size:.88rem}

/* Booking */
.booking-wrap{display:grid;grid-template-columns:1fr 1.4fr;gap:30px;position:relative;z-index:1}
.steps{background:var(--card);border-radius:var(--radius);box-shadow:var(--clay);padding:36px 30px;height:fit-content;position:sticky;top:110px}
.steps h3{font-size:1.35rem;margin-bottom:8px}
.steps p.sub{color:var(--muted);font-size:.9rem;margin-bottom:28px}
.step{display:flex;gap:16px;margin-bottom:22px;align-items:flex-start}
.step .dot{width:40px;height:40px;border-radius:14px;display:grid;place-items:center;font-weight:700;font-family:'Fredoka',sans-serif;background:#fff;box-shadow:var(--clay-sm);flex-shrink:0;transition:.3s}
.step.active .dot{background:linear-gradient(145deg,#8BE3C6,#63CBA8);color:#fff}
.step .txt h4{font-size:.98rem}
.step .txt p{color:var(--muted);font-size:.85rem}
.form-card{background:var(--card);border-radius:var(--radius);box-shadow:var(--clay);padding:36px 32px;position:relative}
.form-card .row{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.field{display:flex;flex-direction:column;gap:6px}
.field.full{grid-column:1 / -1}
label{font-size:.85rem;font-weight:600;color:var(--ink)}
input,select,textarea{padding:14px 16px;border-radius:16px;border:none;background:#fff;box-shadow:var(--clay-sm);font-family:inherit;font-size:.92rem;color:var(--ink);transition:.2s;outline:none}
input:focus,select:focus,textarea:focus{box-shadow:inset 4px 4px 10px rgba(163,177,198,.35),inset -4px -4px 10px rgba(255,255,255,.95)}
textarea{resize:vertical;min-height:80px}
.err{color:#E5457B;font-size:.78rem;font-weight:500;display:none}
.field.invalid input,.field.invalid select,.field.invalid textarea{box-shadow:0 0 0 2px #FFAAB8,var(--clay-sm);animation:shake .4s}
.field.invalid .err{display:block}
@keyframes shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
.slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:10px;margin-top:8px}
.slot{padding:11px 6px;border-radius:14px;border:none;background:#fff;box-shadow:var(--clay-sm);font-family:inherit;font-size:.82rem;font-weight:600;cursor:pointer;transition:.2s;color:var(--ink)}
.slot:hover:not(:disabled){transform:translateY(-2px)}
.slot.selected{backg
