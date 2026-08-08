# Public Release Audit

Date: 2026-08-05
Repository: `qShan1/shangjia-tool`

## Scope

This audit covers the source snapshot prepared for the public GitHub repository. Runtime data is intentionally excluded from the repository: `data/`, `browser_data/`, `logs/`, `output/`, `trajectory_history/`, `update_backup/`, `venv/`, `__pycache__/`, Playwright records, databases, keys, and startup logs.

The confirmed public donation images `static/assets/wx.jpg` and `static/assets/zfb.jpg` are retained.

## Fixed Before Release

### Medium: verification screenshot freshness helpers were missing

The test suite referenced `_get_latest_risk_log_epoch_for_account` and `_evaluate_screenshot_freshness`, but the functions were absent from `reply_server.py`. This could allow stale verification screenshots to be mishandled and left eight tests failing. The UTC timestamp lookup, stale threshold, and missing-file handling are now implemented.

### Low: outdated test double

The slider verification test stub did not accept the newer `preferred_domain_suffixes` keyword used by `_snapshot_context_cookies`. The stub now accepts additional keyword arguments.

## Open Findings

### High: default credentials and signing secrets

`reply_server.py` contains default authentication values, and both Docker Compose files provide fallback administrator and JWT secret values. A deployment that does not override these values is exposed to credential guessing and token forgery. Before production use, require strong environment-provided values and fail startup when they are missing or unchanged defaults.

### High: service binds to all network interfaces

`global_config.yml` configures the web service with host `0.0.0.0`, and the Docker Compose files publish the application ports. Keep the admin service behind a firewall or reverse proxy, restrict published ports, and require HTTPS for non-local access.

### Medium: test dependency is not declared

The environment has no `pytest` module, so `pytest` was not runnable. The repository tests are runnable with the standard-library `unittest` runner; add the preferred test runner to development requirements if pytest is intended to be supported.

### Low: generated and legacy artifacts in the source snapshot

The working directory contained large logs, runtime profiles, backups, caches, and local browser state. They are excluded by `.gitignore` for the public repository, but can still be removed locally in a separate cleanup operation after confirming the service is stopped.

### Low: formatting debt

`git diff --check` reports many pre-existing trailing-whitespace lines in the imported source. This is non-functional and was left unchanged to avoid a broad formatting-only diff.

## Verification

- Python compilation: passed for the core modules and utilities.
- Release precheck: passed; 74 hot-update files detected before the audit changes.
- Standard-library tests: originally 9 errors; 8 missing-helper errors and 1 stale test-stub error were addressed. Final rerun passed: 44 tests, 0 failures.
- No runtime account data or private browser state is included in the staged public snapshot.
