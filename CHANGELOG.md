# Changelog

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
