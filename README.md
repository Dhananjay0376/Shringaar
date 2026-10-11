<div align="center">

<img src="public/dev-earring-test.png" alt="Shringaar Virtual Try-On" width="120" />

# ✨ Shringaar — Virtual Try-On for Jewellery

**A multi-vendor jewellery storefront with AR-powered virtual try-on.**  
Built for small sellers who currently sell over WhatsApp — now with a beautiful public storefront, QR codes per piece, and a try-on experience that runs entirely in the customer's browser.

[![React](https://img.shields.io/badge/React-18.3-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite&logoColor=white)](https://vitejs.dev)
[![Supabase](https://img.shields.io/badge/Supabase-Backend-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![FastAPI](https://img.shields.io/badge/FastAPI-Python-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-Face%20Tracking-4285F4?logo=google&logoColor=white)](https://mediapipe.dev)

---

</div>

## 🌟 What is Shringaar?

Shringaar is a platform designed for **small jewellery sellers** — artisans and shop owners who typically sell through WhatsApp photos. It gives them a professional online presence without requiring technical knowledge.

**For sellers:**
- A guided onboarding flow to create a store and upload products in batches
- A dashboard with traffic analytics (store visits, product views, try-on starts, contact clicks)
- Auto-generated QR codes for each product — print, share, display in-store
- A public storefront URL to share with customers

**For customers:**
- Browse a seller's catalogue on any device
- Try on earrings virtually using their phone camera — **no app download, no image upload, all on-device**

> **Not** a marketplace. There is no checkout, no payments, no orders — just catalogue + storefront + AR try-on.

---

## 🚀 Features

| Feature | Details |
|---|---|
| 🏪 **Multi-vendor storefronts** | Each seller gets a unique public URL and store page |
| 💎 **Product catalogue** | Batch upload products by category with AI-generated descriptions |
| 📱 **AR Virtual Try-On** | Real-time face tracking via MediaPipe — earrings overlay live on camera |
| 🔗 **QR Codes** | Per-product QR codes — scan to view or try on |
| 📊 **Analytics dashboard** | Traffic metrics — views, try-on starts, outbound clicks |
| 🔒 **Privacy-first** | No face data leaves the device. Zero uploads during try-on |
| 🎨 **Demo mode** | Works fully without Supabase — seeded demo data, labelled clearly |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Frontend (Vite + React)                │
│                                                          │
│  features/marketing   → Landing page                     │
│  features/onboarding  → Sign in · Create store · Upload  │
│  features/seller      → Dashboard · Products · Analytics │
│  features/storefront  → Public store · Public product    │
│  features/try-on      → AR engine (MediaPipe + Three.js) │
└──────────────────────┬──────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          │                         │
   ┌──────▼──────┐         ┌────────▼────────┐
   │  Supabase   │         │  FastAPI Backend │
   │             │         │                  │
   │  Auth (RLS) │         │  Image → Try-On  │
   │  DB + Views │         │  Asset Pipeline  │
   │  Storage    │         │  (bg removal,    │
   └─────────────┘         │   2D/3D assets)  │
                           └──────────────────┘
```

**Service boundary** (the load-bearing idea):

```
Pages → Hooks → SellerService (interface) → Adapter
```

Three adapters, one interface — **Demo** (localStorage, no config needed), **Supabase** (production), chosen automatically based on env vars. Every read is tagged `dataSource: 'demo' | 'live'` so the UI can always be honest.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| UI | React 18 + TypeScript 5.6 (strict) |
| Build | Vite 5 |
| Routing | React Router 6 |
| Styling | Hand-written CSS with design tokens (no Tailwind, no UI kit) |
| Database & Auth | Supabase (PostgreSQL + RLS + Storage) |
| Face Tracking | MediaPipe Tasks Vision `1.1.0` (pinned) |
| 3D Rendering | Three.js (lazy-loaded) |
| AI Descriptions | Google Gemini API (`@google/genai`) |
| Backend | FastAPI (Python 3.10+) |
| Tests | Vitest (frontend) · pytest (backend, 158 tests) |

---

## ⚡ Getting Started

### Frontend

**Prerequisites:** Node 18+, npm

```bash
# Clone
git clone https://github.com/Dhananjay0376/Shringaar.git
cd Shringaar

# Install
npm install

# Run in demo mode (no config needed)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) — the app runs fully in **demo mode** with seeded data, clearly labelled.

#### With Supabase (production mode)

Create a `.env.local` file:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_ASSET_API_URL=http://localhost:8000   # optional — asset processing backend
```

Apply migrations:
```bash
supabase db push
```

### Backend (Asset Processing)

**Prerequisites:** Python 3.10+

```bash
cd backend
pip install -r requirements.txt

# Run
uvicorn app.main:app --reload --port 8000
```

- API docs → [http://localhost:8000/docs](http://localhost:8000/docs)
- Health check → [http://localhost:8000/health](http://localhost:8000/health)

See [`backend/README.md`](backend/README.md) for full backend documentation.

---

## 📁 Project Structure

```
shringar-try-on/
├── src/
│   ├── features/
│   │   ├── marketing/       # Landing page
│   │   ├── onboarding/      # Sign-in, create store, batch upload
│   │   ├── seller/          # Dashboard, products, analytics, settings
│   │   ├── storefront/      # Public store & product pages
│   │   └── try-on/          # AR engine
│   ├── components/
│   │   ├── ui/              # Button, Card, Modal, Toast, Badge…
│   │   └── storefront/      # Storefront canvas
│   ├── lib/                 # Shared utilities, domain types, hooks
│   ├── routes/              # paths.ts + router.tsx
│   └── styles/              # CSS design tokens → app styles
├── backend/                 # FastAPI asset processing service
├── supabase/migrations/     # 8 SQL migration files
└── memory/                  # Architecture & decision docs
```

---

## 🧪 Testing

```bash
# Frontend
npm test               # run once
npm run test:watch     # watch mode
npm run check          # typecheck + test

# Backend
cd backend
python -m pytest app/tests/ -q   # 158 tests, ~14 seconds
```

---

## 🔒 Privacy & Security

- **Try-on is fully on-device.** No camera frame, image, or landmark is ever uploaded.
- **Ownership is enforced in the database** via Supabase Row-Level Security — not client-side filtering.
- **No secret keys enter `src/`** — only `VITE_`-prefixed public config.
- The asset backend accepts product photographs only — no face images.

---

## 🗺️ Routes

| Group | Paths |
|---|---|
| Marketing | `/` · `/get-started` · `/sign-in` |
| Onboarding | `/onboarding/store` · `/onboarding/ready` · `/onboarding/products` |
| Seller | `/seller/dashboard` · `/collection` · `/products` · `/products/new` · `/products/:id/edit` · `/store` · `/analytics` · `/settings` |
| Public | `/:storeSlug` · `/:storeSlug/p/:productId` · `/p/:productId` · `/tryon/:productId` · `/tryon/lab` |

---

## 🤝 Contributing

1. Fork the repo → [github.com/Dhananjay0376/Shringaar](https://github.com/Dhananjay0376/Shringaar)
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes
4. Push and open a Pull Request

> See [`memory/architecture.md`](memory/architecture.md) and [`memory/decisions.md`](memory/decisions.md) before making structural changes — the layering rules must not be violated.

---

## 📄 License

This project is built for the **Smart India Hackathon (SIH)**. All rights reserved.

---

<div align="center">

Made with ❤️ for Indian jewellery artisans

</div>
