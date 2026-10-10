"""The processing pipeline.

`orchestrator.run_job` is the only entry point. The stages below it each do one thing and are
independently testable; `glb.py` is the 3D container logic the validation stage and the writers
share.
"""

from __future__ import annotations

from .orchestrator import run_job

__all__ = ["run_job"]
