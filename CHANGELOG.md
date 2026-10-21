# Changelog

## 1.2.0 - 2026-10-21

- Monitor endpoints with `--watch`, UTC timestamps, failure/recovery transitions,
  check pass percentages, outage counts, and bounded memory.
- Stream human-readable, NDJSON, or CSV monitoring output; preserve completed
  samples and write a summary when interrupted.
- Create and share explicit JSON configs with `--init` and `--config`, editor
  schema support, environment placeholders, and documented CLI overrides.
- Save passing benchmark baselines and fail CI on total P95 regressions, with
  request fingerprints to reject mismatched methods, headers, bodies, and URLs.
- Default monitoring and baseline runs to HTTP 2xx checks; preserve ordinary
  timing behavior and existing JSON/CSV formats.
- Protect configs, request bodies, and baseline input files from output writes;
  never overwrite starter configs or saved baselines.
- Add local-server tests for configuration, monitoring, cancellation, exports,
  baseline compatibility, and regression exit codes.

## 1.1.0 - 2026-10-16

- Benchmark repeated requests with warmups and configurable intervals.
- Compare multiple URLs in sequential rounds with status counts and mean, median,
  p95, min/max, and standard deviation timings.
- Add per-request HTTP status, total latency, and TTFB checks for CI workflows.
- Send literal, JSON, or binary file request bodies for POST/PATCH and other APIs.
- Export per-sample CSV or JSON reports to stdout or a UTF-8 file.
- Preserve failed samples, exclude warmups, and support cancellation with Ctrl+C.
- Keep the original single-request command and JSON report compatible.

## 1.0.0 - 2026-10-16

- Turn the original PowerShell function into a cross-platform npm CLI.
- Report DNS, TCP, TLS, server response, TTFB, download, and total timings.
- Include HTTP status, remote IP, HTTP version, and redirect information.
- Add JSON output, optional redirects, headers, HEAD/custom methods, and timeouts.
- Preserve curl exit codes and keep plain-HTTP TLS timings at zero.
- Include local-server tests and CI for Windows, macOS, and Linux.
- Add shareable npm archives, GitHub releases, and npm trusted-publishing setup.
