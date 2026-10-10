# Project overview

**Last updated:** 2026-10-11
**Status of this file:** verified from the codebase and the landing copy. Business model detail not
visible in the code is marked *unverified*.

---

## What Shringaar is

A **multi-vendor jewellery catalogue and storefront** with **virtual try-on**. A small jewellery
seller — the kind who currently sells over WhatsApp with photographs — gets a public storefront, a
QR code per piece, and a customer-facing try-on experience that runs in the customer's browser.

It is **not** a marketplace with checkout. See *Out of scope* below.

## Who it is for

- **The seller.** Small, often non-technical jewellery sellers. Onboarded through a guided flow:
  landing → sign in → create store → photograph pieces in category batches → dashboard.
  The design brief for the landing page was a supplied reference page whose *theme and fonts* were
  extracted, not its content (`task.md` stage 9, `design.md`).
- **The customer.** A shopper who arrives at a storefront or product link, usually from a shared
  WhatsApp message or a QR code. Signed out. On a phone. They are the audience for `/tryon/:productId`.

## Business model

*Partially verified, partially unverified — read the markers.*

- **Verified in code:** each seller owns exactly one store today (enforced by a partial unique index
  on `stores.owner_id`), and every product belongs to a store. Sellers reach customers through a
  public URL + a per-product QR code.
- **Verified in code:** the dashboard's commercial readouts are *traffic* metrics (store visits,
  product views, try-on starts, outbound clicks, contact clicks) — not orders or revenue.
- **Unverified:** how Shringaar itself charges sellers. No subscription, billing, plan, or pricing
  entity exists anywhere in `src/` or in the migrations. Do not assume one.

## Scope — what the product deliberately is

From `arch.md` §1.7:

- Catalogue + storefront + analytics surface for the seller.
- A per-product public URL that identifies exactly one product; a per-store public URL that
  identifies exactly one store.
- An AR try-on client for **earrings** (see [`ar-engine.md`](./ar-engine.md)).

## Out of scope by decision

- Payments, checkout, delivery, marketplace purchasing, order management.
- Multipage marketing/SEO infrastructure. There is one landing page, and no SSR or prerender.
- A second theme. The cream paper is the identity; dark *bands* exist, a dark *mode* does not.

## Core requirements that are easy to lose

1. **Demo data must be labelled.** Every read carries `dataSource: 'demo' | 'live'`; demo-derived
   metrics render a "Demo data" badge and demo writes are described as *"saved in this browser only"*.
2. **The seller dashboard never talks to a database directly.** UI → hooks → `SellerService`
   interface → adapter.
3. **A product photo is not a 3D model**, and no screen may imply otherwise.
4. **Ownership is enforced in the database**, not in client-side filtering.
5. **Try-on runs on-device.** No frame, image, or landmark is uploaded.

See [`decisions.md`](./decisions.md) for why, and `arch.md` §1 for the canonical short version.
