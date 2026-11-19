"""Job posting shape returned by Phase 3.

The API schema is `app.schemas.job.JobAnalysis`. This module records the
Mongo collection name for a later persistence step. Phase 3 returns the
analysis in the HTTP response and does not require MongoDB, matching the
Phase 2 resume route.
"""

JOB_COLLECTION = "jobs"
