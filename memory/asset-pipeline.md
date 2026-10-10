# Asset pipeline

**Last updated:** 2026-10-11
**Read this before answering any question about "uploading a picture and getting a 3D model".**

---

## The headline fact

> **Uploading a PNG or JPEG does not create a 3D model.**

Two separate things exist, and conflating them is the mistake this file exists to prevent:

1. **In the browser app (`src/`)** — nothing converts an image into geometry. No photogrammetry, no
   generative model, no depth estimation, no mesh reconstruction. This is unchanged.
2. **In `backend/`** — a service exists that converts a product photograph into (a) a **transparent
   2D cut-out** and (b) optionally a **flat-card `.glb`** holding that cut-out on a quad. The flat
   card is a *billboard*: `reconstruction: false`, `is_billboard: true`, no depth inferred, no
   backside, no measurement. It is a real, valid GLB that renders — and it is **not a model of the
   piece**.

**There is still no real image-to-3D model wired up.** The provider interface for one exists
(`Model3DGenerator`), and the only implementation is the flat-card generator. A genuine
reconstruction (TripoSR or similar) needs a GPU and model weights, both explicitly deferred — see
`tasks.md`. Do not describe the flat card as a reconstruction, and do not describe the 2D cut-out as
3D.

The rule is stated to sellers in the upload UI and recorded as a content rule in `design.md` §7
(*"A photo is not a 3D model"*).

---

## The backend asset service (`backend/`)

Added 2026-10-10/11. A separate FastAPI process, mock-backed, no AWS, no GPU, no paid API, no
external model download. The dashboard reaches it only when `VITE_ASSET_API_URL` is set; when it is
unset every existing upload path still works and the "cut out of a photo" panel is simply not
rendered.

**What is real and what is simulated** — `ASSET_PROVIDER` selects the set, and `/health` reports
which is live:

| Provider set | Background removal | Item detection | 3D |
| --- | --- | --- | --- |
| `baseline` *(default)* | real: border-median key + Otsu split | real connected components | not available |
| `mock` | **simulated**: drawn ellipses, `SIMULATED` burned into the pixels | real connected-component code over a synthetic mask — labelled simulated anyway | flat-card GLB, simulated |

Every simulated result is labelled through to the review payload, and a mocked cut-out carries the
word `SIMULATED` burned into its own pixels, so it is identifiable even outside its JSON.

`ASSET_MOCK_ITEM_COUNT` (1–3, default 1) sets how many ellipses the mock draws, so the single / pair
/ multiple branches — and the low-confidence confirmation prompt — are reachable over HTTP and not
only from a unit test. `/health` reports it as `providers.background_items`.

**Pipeline states:** `uploaded → queued → validating → preprocessing → segmenting → generating_2d →
generating_3d (optional) → validating_assets → awaiting_review → approved`, plus terminal `failed`
(retryable) and `rejected`.

**Verified end-to-end against the live service on 2026-10-11** (mock set, `ASSET_ENABLE_3D=true`,
`ASSET_MOCK_ITEM_COUNT=2`, demo-mode dashboard on 5201, service on 8140): a 520×360 synthetic
two-jhumka PNG was uploaded, validated from its decoded bytes, cut out, separated into **2 items**
(roles `left` / `right`), given one flat-card GLB each, and reached review. `POST
/api/jobs/{id}/approve` returned 200 and the job settled `approved` with **only the chosen asset
`approved=true`** — the sibling cut-out and both 3D files stayed `false`. Declaring "One piece" for
the same pair drove the confirmation prompt ("You said this is a single item, but two separate
pieces were found…"), and "Run again with this" created a **new** job that resolved cleanly.

**Not yet built, and not claimed:** real background removal (rembg / U²-Net is feasible —
`onnxruntime` is installed), real 3D reconstruction, Supabase `processing_jobs` / `assets` tables
with RLS, AWS/SQS/GPU deployment, and authentication on the service. It binds loopback and has no
auth; see the "Security posture" section of `backend/README.md` before exposing it.

**Known inconsistency:** the browser validator caps uploads at **5 MB** (`src/lib/files.ts`) while
the service accepts **12 MB** (`ASSET_MAX_UPLOAD_BYTES`). The frontend therefore refuses files the
backend would take. Not yet reconciled.

---

## The two asset kinds, kept strictly separate

`arch.md` §1.5 and §8. This separation is a requirement, not a preference.

| | **Product image** | **Try-on asset** |
| --- | --- | --- |
| Field | `product_image_url` | `try_on_asset_url` + `try_on_asset_kind` + `try_on_anchor` |
| What it is | A composed catalogue photograph | Placement material for the AR client |
| Used by | Storefront cards, product page, dashboard | `/tryon/:productId` only |
| Relation | **The product image is never used as a try-on fallback.** It is a composed shot, not a cut-out. |

`TryOnAsset.kind` is a typed union — `'none' | 'image' | 'glb' | 'usdz'` — carried through as a
**declared** value. It is never inferred from a file extension on read ("a guess dressed as a
mapping").

### What each kind actually does

| Kind | Renderer | Result |
| --- | --- | --- |
| `image` (PNG/JPEG/WebP/AVIF) | `canvas2d` | The flat picture drawn onto the video at the estimated ear position. A **2D overlay**, not a model: no depth, does not turn with the head, cannot be viewed from the side. |
| `glb` | `three`, **only after validation passes** | A real 3D model, lit, positioned by the anchor. |
| `usdz` | none | *"USDZ models are not supported by this viewer yet."* No viewer here parses it. |
| `none` | none | The product page shows the "no try-on asset" branch. |

**A PNG is genuinely useful for try-on** — that part is real and it works. It is just not 3D.

---

## Upload path

`src/lib/files.ts` — the shared validators, reused by the lab's file picker.

```ts
MAX_IMAGE_BYTES = 5 * 1024 * 1024     // 5 MB
MAX_MODEL_BYTES = 25 * 1024 * 1024    // 25 MB — .glb
MAX_USDZ_BYTES  = 15 * 1024 * 1024    // 15 MB — .usdz
MAX_TRACKED_DATA_URL_BYTES = 400 * 1024  // larger images are preview-only in demo mode

IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif']
MODEL_MIME_TYPES = ['model/gltf-binary', 'model/vnd.usdz+zip']
```

- `validateImageFile` / `validateModelFile` return a **message or `null`**, and the message names the
  actual size against the actual limit — never "Invalid file".
- `readImageFile` returns `{ dataUrl, width, height, previewOnly }`. The real dimensions are captured
  because the storefront needs an aspect ratio before the image finishes loading.
- Validation happens **before** the upload, so the seller gets a useful message rather than a 400.

Client-side validation is a courtesy. The **buckets enforce the same limits server-side** — see
[`database-and-auth.md`](./database-and-auth.md).

---

## GLB validation

`try-on/assets/validate.ts` — `inspectGlbBytes(bytes: Uint8Array)`, **pure over bytes** and fully
testable against hand-built buffers. This is what "validate the asset, do not trust the URL" means in
practice.

Checks in order, each returning a **distinct** reason:

1. At least a 12-byte header.
2. Bytes `0..3` are the ASCII `glTF` signature.
3. `uint32 LE` at `4` is version **2** (version 1 gets its own message).
4. The header's declared length is **≤** the bytes actually present — a cut-short download is a
   transfer problem, not a modelling one, and says so.
5. Declared length is big enough for at least one chunk header.
6. Chunk 0's type is **JSON** (`0x4E4F534A`).
7. The JSON chunk's end does not overrun either the real or the **declared** length — the shape a
   hand-edited or concatenated file takes.
8. The JSON chunk parses.
9. The parsed document is a non-null, non-array object.
10. `meshes` is a non-empty array. A valid GLB describing nothing to draw would reach Three.js as an
    **empty scene that looks exactly like a rendering failure** — the most confusing outcome
    available, and the one worth preventing.

`byteOffset` is honoured when constructing the `DataView`: a `Uint8Array` sliced out of a larger
buffer is common, and ignoring the offset would read the wrong bytes on the second slice.

`unchecked` is a real state and is **not** treated as valid. `chooseRenderer` returns `none` for it.

---

## Storage

Three public buckets, defined in `supabase/migrations/`. Both the size limit and the MIME allowlist
live on the bucket, so they cannot be bypassed by a client that skips the form.

| Bucket | Public | Limit | MIME allowlist |
| --- | --- | --- | --- |
| `product-images` | yes | 5 MiB | jpeg, png, webp, avif |
| `tryon-assets` | yes | 25 MiB (sized for a `.glb`) | jpeg, png, webp, avif, `model/gltf-binary`, `model/vnd.usdz+zip`, `application/octet-stream` (browsers routinely send this for `.glb`) |
| `store-logos` | yes | 2 MiB | jpeg, png, webp, avif |

All three are public, so objects are fetchable by URL. The SELECT storage policies exist for the
**authenticated API** paths (listing a folder, confirming an upload landed) and are scoped to the
caller's own prefix, so bucket listing does not become a directory of every seller's inventory.
See `database-and-auth.md` for the policy set.

**Object paths follow the convention `{auth.uid()}/{product_id}/{uuid}.{ext}`.** The leading segment
is the owner's user id, which makes the write policy a string comparison against `auth.uid()`
(`(storage.foldername(name))[1] = auth.uid()::text`) rather than a join. That is what the storage
policies key on.

---

## Approval / review state

`products.ar_status` — the enum is `('needs_asset', 'ready', 'needs_review')`; `needs_asset` is the
default. There is no `rejected` value.

It is deliberately **not** a duplicate of `try_on_asset_kind`:
- `kind` records **what asset exists**.
- `ar_status` records **whether anyone has checked it**. A crawled product can arrive with a perfectly
  good `kind` and still need `needs_review`. Website import (Phase 8) is the reason it exists.

**`ar_status` is currently unread and unwritten by TypeScript.** The client spec requires validating
the asset itself rather than trusting a flag, so the render path measures the bytes instead. It is
exposed on the public `storefront_products` view.

---

## Fallback behaviour

There is **no silent fallback**. Every refusal names its own reason:

| Situation | What the customer sees |
| --- | --- |
| Category has no solver | *"Try-on is not available for this category yet."* |
| Anchor contradicts the category | Names the anchor the category requires |
| Invalid `.glb` | *"This piece's 3D model could not be used (reason)."* |
| Unchecked `.glb` | *"This piece's 3D model has not been verified yet, so it cannot be shown."* |
| `usdz` | *"USDZ models are not supported by this viewer yet."* |
| No asset at all | The product page's "no try-on asset for this piece yet" branch |

An invalid `.glb` does **not** fall back to a flat overlay: the `ArAsset` carries exactly one URL and
for a `.glb` it points at a model, which `drawImage` cannot draw. See `decisions.md`.

The external seam is preserved: if `VITE_TRYON_BASE_URL` is set, the product page links out to that
host instead of the in-repo route. Unset (the normal case) it links in-app.
