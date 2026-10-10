"""FastAPI application.

Composition only: build the provider set once, mount the routers, configure CORS.

Two things this file deliberately does not do:

* **It is not authenticated.** See `app/api/routes.py` — the service is built to run on a
  developer's machine, bound to loopback. `ASSET_CORS_ORIGINS` restricts which browser origins may
  call it, but CORS is a browser rule, not an access control: it stops nothing else. Do not put this
  on a public interface.
* **It holds no secrets.** No remote provider is wired up, so there is nothing to configure and
  nothing to leak.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .api.routes import files_router, router
from .config import ensure_dirs, settings
from .jobs import store
from .providers import build_providers


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    ensure_dirs()
    try:
        yield
    finally:
        # Releasing the pool on shutdown keeps a reload from leaving worker threads behind.
        store.shutdown()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Shringaar asset pipeline",
        version=__version__,
        summary=(
            "Turns a product photograph into a transparent, reviewable try-on asset. Simulated "
            "providers are labelled as such in every response."
        ),
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    app.state.providers = build_providers(settings)
    app.include_router(router)
    app.include_router(files_router)
    return app


app = create_app()
