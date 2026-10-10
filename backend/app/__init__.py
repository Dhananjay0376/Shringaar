"""Shringaar asset-processing backend.

A standalone FastAPI service that turns a seller's ordinary jewellery photograph into a
transparent try-on asset through an observable, staged processing job.

It is deliberately separate from the Vite frontend: the frontend talks to it over HTTP via
`VITE_ASSET_API_URL`, and keeps working unchanged when that variable is unset.
"""

__version__ = "0.1.0"
