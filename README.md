# curltime

Find slow HTTP requests, compare endpoints, and catch latency regressions from your terminal.

`curltime` turns curl's timing data into a readable report: DNS lookup, TCP
connection, TLS handshake, server response, time to first byte, download, and
total time. Repeat requests for median and p95 timings, compare multiple URLs,
test APIs with request bodies, or fail a CI job when a response misses your requirements.

Works in PowerShell, Command Prompt, Bash, and zsh on Windows, macOS, and Linux.
No npm dependencies. Requests are made by your system's curl.

```text
$ curltime https://example.com

URL                   : https://example.com/
DNS (ms)              : 12.30
TCP (ms)              : 28.40
SSL/TLS (ms)          : 44.10
Server Response (ms)  : 65.20
TTFB (ms)             : 150.80
Download (ms)         : 0.70
Total (ms)            : 151.50
HTTP Status           : 200
Remote IP             : 93.184.215.14
HTTP Version          : 2
Redirects             : 0
```

The values above are illustrative; your results depend on your connection.

| Need | Command |
| --- | --- |
| Find where one request is slow | `curltime https://example.com` |
| Check typical and tail latency | `curltime -n 20 --warmup 2 https://example.com` |
| Compare endpoints | `curltime -n 10 https://example.com https://www.example.com` |
| Check a deployment in CI | `curltime --expect-status 2xx --max-total 500 https://example.com` |
| Export results for analysis | `curltime -n 20 --csv -o timings.csv https://example.com` |

## Install

Requirements: [Node.js 22 or newer](https://nodejs.org/) and
[curl 7.70 or newer](https://curl.se/download.html) on your `PATH`. Recent Windows
and macOS versions include curl; on Ubuntu/Debian, use `sudo apt install curl`.
Check with `node --version` and `curl --version` (`curl.exe --version` in Windows
PowerShell, where `curl` may be an alias).

Install from [npm](https://www.npmjs.com/package/curltime):

```sh
npm install --global curltime
curltime https://example.com
```

Or run it without a permanent global installation:

```sh
npx curltime https://example.com
```

You can also install this release directly from GitHub:

```sh
npm install --global https://github.com/legend048/curltime/releases/download/v1.1.0/curltime-1.1.0.tgz
```

You can also send someone the `curltime-1.1.0.tgz` release file. They can install
it with `npm install --global ./curltime-1.1.0.tgz`.

### Replacing an existing PowerShell function

If your PowerShell profile already defines a `curltime` function, that function
takes precedence over the installed command. Remove that function definition
from `$PROFILE` and open a new terminal. To try the npm command immediately on
Windows without editing your profile, run `curltime.cmd https://example.com`.
`Get-Command curltime -All` shows which command PowerShell is using.

## Use

```sh
curltime example.com
curltime -L https://example.com
curltime --json https://example.com
curltime --timeout 5 --connect-timeout 2 https://example.com
curltime -I https://example.com
curltime -H "Accept: application/json" https://api.github.com
curltime --fail https://example.com
curltime --help
```

Bare hostnames use HTTPS. Quote URLs containing shell characters such as `&`.
Only HTTP and HTTPS are supported. By default, the command makes one transfer.
Redirects are followed only with `-L`, with a maximum of ten redirects per transfer.

| Option | Behavior |
| --- | --- |
| `--json` | Print a JSON object with numeric timings in milliseconds |
| `--csv` | Print a CSV row for every measured sample, including failures |
| `-o`, `--output <file>` | Write the report to a UTF-8 file instead of stdout |
| `-n`, `--repeat <count>` | Run 1-1000 measured requests per URL; default 1 |
| `--warmup <count>` | Run 0-1000 excluded warmup requests per URL; default 0 |
| `--interval <seconds>` | Pause between rounds; default 0, maximum 3600 |
| `--expect-status <codes>` | Accept HTTP codes or classes, such as `200,204` or `2xx,304` |
| `--max-total <ms>` | Require each measured total time to stay at or below this limit |
| `--max-ttfb <ms>` | Require each measured TTFB to stay at or below this limit |
| `-L`, `--location` | Follow redirects |
| `-I`, `--head` | Use HEAD instead of GET |
| `-H`, `--header <header>` | Add a header; repeat for multiple headers |
| `-X`, `--request <method>` | Choose an HTTP method |
| `-d`, `--data <text>` | Send a literal body; defaults to POST |
| `--data-file <file>` | Send the exact bytes of a file; defaults to POST |
| `--json-body <json>` | Send valid JSON with JSON headers; defaults to POST |
| `-m`, `--timeout <seconds>` | Whole-transfer timeout; default 30 seconds |
| `--connect-timeout <seconds>` | Connection timeout; default 10 seconds |
| `--fail` | Fail on HTTP status 400 or higher |
| `-h`, `--help` | Print usage |
| `-v`, `--version` | Print the installed version |

The response body is discarded. TLS verification stays enabled. curl's proxy
environment variables still apply, while `.curlrc` is ignored for predictable
output. With `-L`, curl can forward custom headers to redirect destinations;
use sensitive custom headers only with destinations you trust.

## Common workflows

### Repeat requests and compare endpoints

```sh
curltime -n 20 --warmup 2 https://example.com
curltime -n 10 https://example.com https://www.example.com
curltime -n 5 --interval 1 https://example.com
```

Benchmarks show the mean, median (P50), P95, minimum, maximum, and standard
deviation of total request time, plus HTTP status counts and passed sample counts.
A single-URL benchmark also shows a summary for every timing phase. JSON includes
all measured samples and phase statistics for every URL.

Requests run **sequentially**, one request per URL in each round, in the order
given. `--interval` pauses after a round completes. Each sample starts a fresh
curl process and connection; OS DNS caches and server caches can still be warm.
Warmups exercise those caches but do not reuse a curl connection. This measures
individual request latency, not concurrent load or requests per second. Use up
to 50 URLs and press Ctrl+C to stop a run.

P50 and P95 use linear interpolation between sorted samples. Standard deviation
uses the population formula. Warmups are excluded from all measured statistics.
Failed warmup transfers are counted separately. Measured transfer failures remain
in the results and fail the run, while their unavailable timings are excluded
from statistics. If every transfer fails, timing statistics are `null` in JSON
and `-` in the table. Completed responses that fail an HTTP or latency check
still contribute their timings.

### Check deployments in CI

```sh
curltime --expect-status 2xx --max-total 500 --max-ttfb 300 https://example.com
curltime -n 5 --expect-status 200,204 --max-total 500 --json https://example.com
```

Every measured request must meet every supplied requirement. Limits are inclusive
and expressed in milliseconds. A failed check keeps the timing report and exits
with **3**, so it can fail a CI step. JSON adds `checks.passed` and a `checks.failures`
array to each checked response. Network failures retain curl's exit code.

Without `--expect-status` or `--fail`, a completed HTTP 404/500 response counts as
a successful transfer, as in curl. Use `--expect-status` to inspect those responses
while enforcing acceptable statuses. `--fail` instead treats HTTP 400+ as curl
errors (exit 22) and discards their timing report.

### Time POST, PATCH, and JSON APIs

```sh
curltime --data "name=demo" https://api.example.com/items
curltime --json-body '{"name":"demo"}' https://api.example.com/items
curltime -X PATCH --data-file payload.json -H "Content-Type: application/json" https://api.example.com/items/1
```

Choose one body option. Bodies default to POST unless `-X` selects another
method; HEAD cannot have a body. `--data` sends text literally, including a
leading `@`. `--data-file` reads a file once per invocation and preserves its
bytes. `--json-body` validates JSON and adds `Content-Type: application/json`
and `Accept: application/json`, unless you override those headers with `-H`.
Use a body file when your shell makes inline JSON quoting awkward.

Bodies are sent through curl's stdin, not placed in curl's process arguments.
When combined with benchmarks, the body is sent for **every warmup and measured
request**, to every supplied URL. POST/PATCH endpoints may change data each time.

### Export or share reports

```sh
curltime -n 20 --csv -o timings.csv https://example.com
curltime -n 10 --json -o timings.json https://example.com https://www.example.com
```

CSV includes the URL, iteration, HTTP status, remote IP, HTTP version, all timing
phases, passed state, exit code, and error text. It contains measured samples only,
including failed transfers. Use either `--json` or `--csv`. Without `-o`, output
goes to stdout for piping; with `-o`, stdout stays empty and the file path is
reported on stderr. Existing output files are replaced, and the destination
directory must already exist. A failed check still writes the report file.

### Read the timings

| Field | Meaning for a single direct request |
| --- | --- |
| DNS | Time to resolve the hostname |
| TCP | Connection time after DNS |
| SSL/TLS | TLS handshake time after TCP; zero for plain HTTP |
| Server Response | Wait between curl being ready to transfer and the first response byte |
| TTFB | Time from the start through the first response byte, including connection setup |
| Download | Time from the first response byte to transfer completion |
| Total | Complete transfer duration |

TTFB is cumulative, so do not add it to the other phases. Proxy negotiation,
connection reuse, and redirects can affect phase attribution. With `-L`, curl
accumulates several timings across requests; the phase differences are
approximations, not a per-hop waterfall. Total includes the redirect chain.
The HTTP version depends on the curl build and server.

### JSON and JavaScript

For a single request without checks, `--json` retains the original report shape:

```json
{
  "url": "https://example.com/",
  "effectiveUrl": "https://example.com/",
  "unit": "ms",
  "timings": {
    "dns": 12.3,
    "tcp": 28.4,
    "tls": 44.1,
    "server": 65.2,
    "ttfb": 150.8,
    "download": 0.7,
    "total": 151.5
  },
  "httpStatus": 200,
  "remoteIp": "93.184.215.14",
  "httpVersion": "2",
  "redirects": 0
}
```

For use in a Node.js project, install locally with `npm install curltime`:

```js
import { measure } from 'curltime';

const report = await measure('https://example.com', {
  follow: true,
  timeout: 5,
  headers: ['Accept: text/html'],
});
console.log(report.timings.total);
```

For repeated requests or multiple endpoints, use `benchmark`:

```js
import { benchmark, formatCsv, resultExitCode } from 'curltime';

const result = await benchmark(['https://example.com', 'https://www.example.com'], {
  repeat: 10,
  warmup: 2,
  expectStatus: '2xx',
  maxTotal: 500,
});
console.log(result.results[0].timings.total.p95);
console.log(formatCsv(result));
process.exitCode = resultExitCode(result);
```

The benchmark JSON object contains `mode: "benchmark"`, `unit`, `repeat`,
`warmup`, `results`, and overall `checks.passed`. Each target in `results` has
its URL, attempts/completed/passed/failed counts, warmup transfer failure count,
status counts, phase statistics, and samples. A sample contains its `iteration`
and either `report` or `error: { message, exitCode }`. Supplying `--repeat`,
`--warmup`, or `--interval`, or more than one URL, selects this shape. Both
`measure` and `benchmark` accept an `AbortSignal` as the `signal` option.

Exit status is zero for completed transfers, including HTTP error responses
unless a status or latency check fails, or `--fail` is used. Invalid arguments
and unreadable body files exit with 2; local setup/output errors with 1; failed
checks with 3; and curl failures retain curl's exit code (for example, 6 for DNS
failure, 22 for `--fail`, 28 for a timeout, or 47 for too many redirects). In a
benchmark, a curl error takes precedence over failed checks; the first such
error in URL/sample order supplies the exit code. Ctrl+C exits with 130 and
stops the active curl process; an interrupted run does not write a partial report.

## Update or uninstall

Once installed from npm, get the newest release with:

```sh
npm install --global curltime@latest
curltime --version
```

For GitHub or offline installations, install the new version's `.tgz` file
with the same `npm install --global` command. Find versions on the
[releases page](https://github.com/legend048/curltime/releases).

To remove the command: `npm uninstall --global curltime`.

## Contribute and release

Bug reports and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md)
for development and [RELEASING.md](RELEASING.md) for npm listing and future releases.

[MIT licensed](LICENSE). Created by [legend048](https://github.com/legend048),
based on a personal PowerShell function.
