"""Pipeline stages.

Each module here is pure with respect to the job store: it takes inputs and returns a result or a
coded `Outcome` failure. Sequencing, retries and terminal-state policy live in the orchestrator, so
a stage can be unit-tested without a job, a server or a filesystem.
"""
