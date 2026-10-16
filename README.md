# curltime

See where an HTTP request spends its time, straight from your terminal.

`curltime` turns curl's timing data into a readable report: DNS lookup, TCP
connection, TLS handshake, server response, time to first byte, download, and
total time. It also reports the HTTP status, remote IP, and HTTP version.

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

You can also install the first release directly from GitHub:

```sh
npm install --global https://github.com/legend048/curltime/releases/download/v1.0.0/curltime-1.0.0.tgz
```

You can also send someone the `curltime-1.0.0.tgz` release file. They can install
it with `npm install --global ./curltime-1.0.0.tgz`.

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
Only HTTP and HTTPS are supported. Each invocation makes one transfer; redirects
are followed only with `-L`, with a maximum of ten redirects.

| Option | Behavior |
| --- | --- |
| `--json` | Print a JSON object with numeric timings in milliseconds |
| `-L`, `--location` | Follow redirects |
| `-I`, `--head` | Use HEAD instead of GET |
| `-H`, `--header <header>` | Add a header; repeat for multiple headers |
| `-X`, `--request <method>` | Choose an HTTP method; request bodies are not supported |
| `-m`, `--timeout <seconds>` | Whole-transfer timeout; default 30 seconds |
| `--connect-timeout <seconds>` | Connection timeout; default 10 seconds |
| `--fail` | Fail on HTTP status 400 or higher |
| `-h`, `--help` | Print usage |
| `-v`, `--version` | Print the installed version |

The response body is discarded. TLS verification stays enabled. curl's proxy
environment variables still apply, while `.curlrc` is ignored for predictable
output. With `-L`, curl can forward custom headers to redirect destinations;
use sensitive custom headers only with destinations you trust.

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

`--json` writes only the report to stdout; errors go to stderr. Its shape is:

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

Exit status is zero for completed transfers, including HTTP error responses
unless `--fail` is used. Invalid arguments exit with 2, local setup errors with
1, and curl failures retain curl's exit code (for example, 6 for DNS failure,
22 for `--fail`, 28 for a timeout, or 47 for too many redirects).

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
