import { CurlTimeError, normalizeUrl, validateOptions } from './request.js';
import { validateBenchmarkOptions } from './benchmark.js';
import { loadConfig } from './config.js';
import { validateWatchOptions } from './watch.js';

export const help = `Usage: curltime [options] <url> [url ...]

Show DNS, TCP, TLS, server response, TTFB, download, and total request timings.
Bare hostnames use HTTPS. Requires Node.js 22+ and curl 7.70+ on PATH.

Options:
  --json                      Print a machine-readable JSON report
  --csv                       Print one CSV row per measured request
  -o, --output <file>          Write the report to a UTF-8 file
  -n, --repeat <count>         Benchmark 1-1000 requests per URL
  --warmup <count>            Run 0-1000 excluded warmup requests per URL
  --interval <seconds>        Pause between rounds (default: 0)
  --watch                     Monitor until Ctrl+C; --repeat limits rounds
  --config <file>             Load URLs and options from a JSON config
  --init                      Create a starter config (never overwrites)
  --save-baseline <file>      Save a passing benchmark (default: 10 requests)
  --baseline <file>           Compare total P95 latency with a saved baseline
  --max-regression <percent>  Allowed P95 increase (default: 20)
  --expect-status <codes>     Require status codes/classes, e.g. 200,204 or 2xx
  --max-total <ms>            Fail a check if any total time exceeds this
  --max-ttfb <ms>             Fail a check if any TTFB exceeds this
  -L, --location              Follow redirects (at most 10)
  -I, --head                  Send a HEAD request instead of GET
  -H, --header <header>       Add a request header; can be repeated
  -X, --request <method>      Set the HTTP method
  -d, --data <text>           Send a literal body; defaults to POST
  --data-file <file>          Send a file's exact bytes; defaults to POST
  --json-body <json>          Send JSON with JSON headers; defaults to POST
  -m, --timeout <seconds>     Limit the whole request (default: 30)
  --connect-timeout <seconds> Limit connection setup (default: 10)
  --fail                     Exit with curl code 22 for HTTP 400+ responses
  -h, --help                 Show this help
  -v, --version              Show the installed version

Examples:
  curltime https://example.com
  curltime -n 10 --warmup 2 https://example.com
  curltime -n 5 https://example.com https://www.example.com
  curltime --expect-status 2xx --max-total 500 https://example.com
  curltime -n 10 --csv -o timings.csv https://example.com
  curltime --watch --interval 5 https://example.com/health
  curltime --init
  curltime --config curltime.config.json
  curltime -n 20 --save-baseline before.json https://example.com
  curltime -n 20 --baseline before.json https://example.com

Multiple URLs are compared in sequential rounds. Ctrl+C stops an active run.
Checks failing on completed requests exit with 3; curl errors keep their code.
Watch defaults: HTTP 2xx, 5-second pauses; --json streams NDJSON events.

Update: npm install --global curltime@latest`;

const booleanFlags = new Map([
  ['--json', 'json'], ['--csv', 'csv'], ['-L', 'follow'], ['--location', 'follow'],
  ['-I', 'head'], ['--head', 'head'], ['--fail', 'fail'],
  ['-h', 'help'], ['--help', 'help'], ['-v', 'version'], ['--version', 'version'],
  ['--watch', 'watch'], ['--init', 'init'],
]);

const valueFlags = new Map([
  ['-H', 'header'], ['--header', 'header'], ['-X', 'method'], ['--request', 'method'],
  ['-m', 'timeout'], ['--timeout', 'timeout'], ['--connect-timeout', 'connectTimeout'],
  ['-n', 'repeat'], ['--repeat', 'repeat'], ['--warmup', 'warmup'], ['--interval', 'interval'],
  ['--expect-status', 'expectStatus'], ['--max-total', 'maxTotal'], ['--max-ttfb', 'maxTtfb'],
  ['-d', 'data'], ['--data', 'data'], ['--data-file', 'dataFile'], ['--json-body', 'jsonBody'],
  ['-o', 'output'], ['--output', 'output'],
  ['--config', 'config'], ['--save-baseline', 'saveBaseline'], ['--baseline', 'baseline'],
  ['--max-regression', 'maxRegression'],
]);

export function parseArgs(argv) {
  let options = {};
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
      const key = valueFlags.get(flag);
      if (value === undefined || (value === '' && key !== 'data') ||
          (equalIndex < 0 && value.startsWith('-') && key !== 'data' && key !== 'jsonBody')) {
        throw new CurlTimeError(`${flag} requires a value.`, 2);
      }
      if (key === 'header') (options.headers ??= []).push(value);
      else options[key] = value;
    } else if (argument.startsWith('-')) {
      throw new CurlTimeError(`Unknown option: ${argument}. Run curltime --help.`, 2);
    } else {
      positional.push(argument);
    }
  }

  if (options.help || options.version) return options;
  if (options.init) {
    if (positional.length || Object.keys(options).some(key => !['init', 'config'].includes(key))) {
      throw new CurlTimeError('--init accepts only an optional --config destination.', 2);
    }
    return options;
  }
  if (options.config) {
    const config = loadConfig(options.config);
    options = { ...config.options, ...options };
    if (!positional.length) positional.push(...config.urls);
  }
  if (!positional.length || positional.length > 50) {
    throw new CurlTimeError('Provide between 1 and 50 URLs. Run curltime --help for examples.', 2);
  }
  if (options.json && options.csv) throw new CurlTimeError('Choose either --json or --csv.', 2);
  for (const key of ['baseline', 'saveBaseline', 'output']) {
    if (options[key] !== undefined && (typeof options[key] !== 'string' || !options[key].trim())) {
      throw new CurlTimeError(`${key} requires a file path.`, 2);
    }
  }
  if (options.baseline && options.saveBaseline) throw new CurlTimeError('Use --baseline or --save-baseline in separate runs.', 2);
  if (options.baseline || options.saveBaseline) {
    if (new Set(positional.map(normalizeUrl)).size !== positional.length) throw new CurlTimeError('Baseline runs require unique URLs.', 2);
    options.repeat ??= 10;
    options.expectStatus ??= '2xx';
  }
  if (options.maxRegression !== undefined && !options.baseline) throw new CurlTimeError('--max-regression requires --baseline.', 2);
  if (options.baseline) {
    const value = options.maxRegression ?? 20;
    if (!['string', 'number'].includes(typeof value) || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(value)) || !Number.isFinite(Number(value))) {
      throw new CurlTimeError('--max-regression must be a non-negative percentage.', 2);
    }
    options.maxRegression = Number(value);
  }
  options.benchmark = Boolean(options.baseline || options.saveBaseline || positional.length > 1 || options.repeat !== undefined || options.warmup !== undefined || options.interval !== undefined);
  options.urls = positional.map(normalizeUrl);
  options.url = normalizeUrl(positional[0]);
  return options.watch ? validateWatchOptions(options) : validateBenchmarkOptions(validateOptions(options));
}
