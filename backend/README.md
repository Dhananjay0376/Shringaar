# Shringaar — jewellery asset processing backend

A small FastAPI service that turns a seller's ordinary product photograph into a **transparent
try-on asset**, through a staged job the seller can watch, review and approve.

It is deliberately separate from the Vite frontend. The frontend talks to it over HTTP when
`VITE_ASSET_API_URL` is set, and keeps working unchanged when it is not.

---

## What this service does, and what it does not

Stated first, because the distinction is the whole point of the design.

**It does:**

- Validate an upload by its actual bytes — format, dimensions, integrity, decompression bombs — and
  normalise EXIF orientation.
- Separate the item from the background and write a **genuinely transparent PNG**.
- Count the items in the image (single / pair / multiple) using connected-component analysis, and
  ask the seller to confirm when the evidence is weak.
- Crop each item to its own asset, preserving aspect ratio, with padding.
- Optionally produce a 3D file, behind a provider interface, validated before it is offered.
- Park the job at `awaiting_review` and require an explicit approval before any asset is usable.

**It does not:**

- Run a trained segmentation model. The default provider is a border-median colour key with an Otsu
  split — real, deterministic image processing, explicitly reported as `ml: false`.
- Reconstruct 3D geometry from a photograph. **No such provider is wired up in this milestone.** The
  mock 3D provider emits a cutout on a flat card, and labels itself as a billboard with
  `reconstruction: false`.
- Authenticate anyone. See *Security posture* below.
- Persist jobs across a restart, or share them between processes.

---

## Requirements

Python 3.10+ (developed and tested on 3.13). Install:

```bash
pip install -r requirements.txt
```

Every dependency is already present in the development environment, so this is a no-op there.

## Running

From `backend/`:

```bash
uvicorn app.main:app --reload --port 8000
```

Then:

- Interactive API docs — <http://localhost:8000/docs>
- Health, including which providers are live — <http://localhost:8000/health>

Configuration comes from the environment; every value has a working default. See
`.env.example` for the full list. `ASSET_DATA_DIR` (default `data/`) holds uploads and generated
assets and is gitignored.

## Tests

```bash
python -m pytest app/tests/ -q
```

158 tests, roughly 14 seconds. They run against synthetic images generated in `app/tests/images.py`
— the service never needs network access, a GPU, or a real photograph to be verified.

| File | Covers |
|---|---|
| `test_workflow.py` | The MVP path end to end: upload → review → approve/reject, with the transparency of the delivered asset measured rather than assumed. |
| `test_validation.py` | Upload validation: MIME by content not filename, size and pixel caps, decompression bombs, truncated files, EXIF orientation. |
| `test_providers.py` | What each provider actually computes, and that its labelling is honest in both directions. |
| `test_glb.py` | The GLB writer and validator — including that every failure mode gets its own reason. |
| `test_storage.py` | Path safety, short-write detection, cleanup. |
| `test_retry.py` | Retry, approval and rejection transitions. |

---

## How a job flows

```
POST /api/jobs ──▶ uploaded
                     │
                     ▼
   validating ─▶ preprocessing ─▶ segmenting ─▶ generating_2d ─▶ generating_3d ─▶ validating_assets
                     │                                                              │
                     └──────────────── failed ◀─────────────────────────────────────┘
                                                                                    │
                                                                            awaiting_review
                                                                                    │
                                                                    approved ◀──────┴──────▶ rejected
```

- `generating_3d` is **skipped** (with a recorded reason) when 3D was not requested or no provider
  is available. A 3D failure never fails the job — the 2D asset is already valid.
- If validation discards a generated 3D file, the `generating_3d` stage is **corrected to `failed`**,
  so the record never claims output that no longer exists.
- A job that fails for a transient reason is retryable; one that failed for a permanent reason
  (an unsupported file, an empty upload) is not, and the API refuses the retry rather than offering
  a button that always fails.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Service version, live providers, 3D flag, writability. |
| `POST` | `/api/jobs` | Upload one image (`multipart/form-data`) and start processing. |
| `GET` | `/api/jobs?limit=` | Recent jobs, newest first. |
| `GET` | `/api/jobs/{id}` | Poll a job. Cheap enough to call every second. |
| `POST` | `/api/jobs/{id}/approve` | Approve chosen assets — the gate before try-on. |
| `POST` | `/api/jobs/{id}/reject` | Reject with a reason; clears any approval. |
| `POST` | `/api/jobs/{id}/retry` | Re-run a retryable failure against the preserved original. |
| `DELETE` | `/api/jobs/{id}` | Drop a job and its files. Operator/test use. |
| `GET` | `/files/{path}` | Serve a stored asset. Traversal-checked. |

`POST /api/jobs` accepts, besides `file`: `name`, `category`, `item_configuration`
(`auto`\|`single`\|`pair`\|`multiple`), `anchor`, `generate_3d`, `output_long_edge` (64–4096).

Example:

```bash
curl -F "file=@earrings.png" -F "item_configuration=pair" -F "name=Kundan jhumka" \
     http://localhost:8000/api/jobs
```

---

## Providers

A provider set is three replaceable pieces — background removal, item detection, 3D generation —
each reporting a `ProviderInfo` with **two separate booleans**: `simulated` (did real work happen?)
and `ml` (was it a trained model?). Two booleans rather than one, because the baseline provider is
real but not ML, and collapsing them would make both claims meaningless.

| Provider | Real work? | ML? | Notes |
|---|---|---|---|
| `baseline` *(default)* | yes | no | Border-median key + Otsu split + speckle removal; connected components for item counting. |
| `mock` | no | no | Fixed synthetic output, stamped with a visible watermark in the pixels. For exercising the workflow. |

Switch with `ASSET_PROVIDER=mock`. Everything downstream of a simulated provider is labelled
simulated through to the review payload, and a mocked cutout carries the word `SIMULATED` burned
into its own pixels, so it is identifiable even outside its JSON.

The mock's cutout mask is a set of drawn ellipses, so its item count is a setting rather than
something derived from the image: `ASSET_MOCK_ITEM_COUNT=2` (1–3, default 1). It exists so the
single / pair / multiple branches can be driven over HTTP and not only from a test that builds the
provider by hand — the pair case is the one the review screen exists for. `/health` reports the
effective value as `providers.background_items`, so which branch a run will exercise is never a
guess. This knob is a property of the *mock*; it has no meaning for a real remover, which discovers
its own item count.

Adding a real background remover (rembg / U²-Net, via the already-available `onnxruntime`) means
implementing one Protocol in `app/providers/` and registering it in `app/providers/__init__.py`.
Nothing in the pipeline or the API changes.

---

## Security posture — read before exposing this

**This service has no authentication.** Every job is reachable by anyone who knows its id, and ids
are random but not secret. That is acceptable *only* because it is meant to run on a developer's own
machine, on loopback.

The spec's ownership rule — a seller must not be able to access or approve another seller's assets —
is enforced by **Supabase RLS in the next milestone**, when jobs move into a table. An in-memory
store has no owner column and no session to check against, so enforcing it here would be security
theatre. Do not put this service on a public interface before that work lands.

What *is* enforced here:

- Uploads are read in chunks against a byte cap, so a huge request is refused rather than buffered.
- Dimensions are checked from the header before decode, so a decompression bomb is rejected on its
  declared size.
- `GET /files/{path}` resolves and containment-checks every path; traversal and absolute paths are
  refused.
- **No face images or camera recordings are accepted or stored.** The pipeline takes product
  photographs. The try-on engine runs in the browser and uploads nothing.

---

## Known limitations

- **No real ML.** Background removal and item detection are deterministic algorithms, honestly
  labelled. They work well on the format the upload form recommends (one item, plain contrasting
  background) and poorly on a busy background, a reflective surface, or a fine chain against a
  similar colour. When they fail they say so rather than emitting an almost-empty cutout.
- **No real 3D.** No image-to-3D model is wired up. TripoSR or similar needs a GPU and model
  weights; the provider interface is ready for it, the model is not here.
- **Jobs live in memory.** They do not survive a restart, and two workers would not share a list.
  The store is isolated behind `app/jobs.py` for exactly that reason.
- **Storage is local disk.** Behind a small interface (`app/storage.py`) so object storage can
  replace it.
- **Asset URLs are absolute**, built from `ASSET_PUBLIC_BASE_URL`, so they are correct for the
  client that can reach this host and wrong for any other.
- **`ar_status` is not written.** The pipeline deliberately does not mark a product try-on-ready;
  that is a seller action after approval, and the storefront validates the asset itself.

## Repository layout

```
backend/
  app/
    main.py           app factory, CORS, lifespan
    config.py         environment-backed settings (frozen dataclass)
    schemas.py        the whole API contract — jobs, stages, assets, failures
    jobs.py           in-memory store, state transitions, retry/approve/reject rules
    storage.py        local filesystem storage, path containment
    api/routes.py     the HTTP surface (thin: no image logic)
    pipeline/
      orchestrator.py stage sequencing and every policy decision
      glb.py          glTF 2.0 binary writer and validator
      stages/         validate.py · detect.py · prepare2d.py
    providers/
      base.py         the Protocols and the Outcome type
      baseline.py     real, deterministic, non-ML
      mock.py         labelled simulation
    tests/            155 tests and the synthetic fixtures they run on
```
