import { CurlTimeError, normalizeUrl, validateOptions } from './index.js';

export const help = `Usage: curltime [options] <url>

Show DNS, TCP, TLS, server response, TTFB, download, and total request timings.
Bare hostnames use HTTPS. Requires Node.js 22+ and curl 7.70+ on PATH.

Options:
  --json                      Print a machine-readable JSON report
  -L, --location              Follow redirects (at most 10)
  -I, --head                  Send a HEAD request instead of GET
  -H, --header <header>       Add a request header; can be repeated
  -X, --request <method>      Set the HTTP method (no request body)
  -m, --timeout <seconds>     Limit the whole request (default: 30)
  --connect-timeout <seconds> Limit connection setup (default: 10)
  --fail                     Exit with curl code 22 for HTTP 400+ responses
  -h, --help                 Show this help
  -v, --version              Show the installed version

Examples:
  curltime https://example.com
  curltime -L --json https://example.com
  curltime -H "Accept: application/json" https://api.example.com

Update: npm install --global curltime@latest`;

const booleanFlags = new Map([
  ['--json', 'json'], ['-L', 'follow'], ['--location', 'follow'],
  ['-I', 'head'], ['--head', 'head'], ['--fail', 'fail'],
  ['-h', 'help'], ['--help', 'help'], ['-v', 'version'], ['--version', 'version'],
]);

const valueFlags = new Map([
  ['-H', 'header'], ['--header', 'header'], ['-X', 'method'], ['--request', 'method'],
  ['-m', 'timeout'], ['--timeout', 'timeout'], ['--connect-timeout', 'connectTimeout'],
]);

export function parseArgs(argv) {
  const options = { headers: [] };
  const positional = [];
  let endOfOptions = false;

  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (endOfOptions) {
      positional.push(argument);
      continue;
    }
    if (argument === '--') {
      endOfOptions = true;
      continue;
    }
    const equalIndex = argument.startsWith('--') ? argument.indexOf('=') : -1;
    const flag = equalIndex < 0 ? argument : argument.slice(0, equalIndex);
    if (booleanFlags.has(flag)) {
      if (equalIndex >= 0) throw new CurlTimeError(`${flag} does not take a value.`, 2);
      options[booleanFlags.get(flag)] = true;
    } else if (valueFlags.has(flag)) {
      const value = equalIndex < 0 ? argv[++i] : argument.slice(equalIndex + 1);
      if (value === undefined || value === '' || value.startsWith('-')) {
        throw new CurlTimeError(`${flag} requires a value.`, 2);
      }
      const key = valueFlags.get(flag);
      if (key === 'header') options.headers.push(value);
      else options[key] = value;
    } else if (argument.startsWith('-')) {
      throw new CurlTimeError(`Unknown option: ${argument}. Run curltime --help.`, 2);
    } else {
      positional.push(argument);
    }
  }

  if (options.help || options.version) return options;
  if (positional.length !== 1) {
    throw new CurlTimeError('Provide exactly one URL. Run curltime --help for examples.', 2);
  }
  options.url = normalizeUrl(positional[0]);
  return { ...options, ...validateOptions(options) };
}
