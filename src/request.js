import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { devNull } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class CurlTimeError extends Error {
  constructor(message, exitCode = 1, options) {
    super(message, options);
    this.name = 'CurlTimeError';
    this.exitCode = exitCode;
  }
}

export function normalizeUrl(input) {
  if (typeof input !== 'string' || !input.trim() || /[\x00-\x20\x7f]/.test(input)) {
    throw new CurlTimeError('Provide a valid HTTP or HTTPS URL without whitespace.', 2);
  }
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new CurlTimeError(`Invalid URL: ${input}`, 2);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new CurlTimeError('Only HTTP and HTTPS URLs are supported.', 2);
  }
  return parsed.href;
}

export function validateOptions(options = {}) {
  const timeout = positiveSeconds(options.timeout ?? 30, '--timeout');
  const connectTimeout = positiveSeconds(options.connectTimeout ?? 10, '--connect-timeout');
  const headers = options.headers ?? [];
  if (!Array.isArray(headers) || headers.some(header =>
    typeof header !== 'string' || !header.length || header.startsWith('@') || /[\r\n\0]/.test(header))) {
    throw new CurlTimeError('Headers must be single-line strings; @file headers are not supported.', 2);
  }
  if (options.method !== undefined && typeof options.method !== 'string') {
    throw new CurlTimeError('Provide a valid HTTP method.', 2);
  }
  const method = options.method?.toUpperCase();
  if (method !== undefined && !/^[!#$%&'*+.^_`|~0-9A-Z-]+$/.test(method)) {
    throw new CurlTimeError('Provide a valid HTTP method.', 2);
  }
  if (options.head && method && method !== 'HEAD') {
    throw new CurlTimeError('--head cannot be combined with a different --request method.', 2);
  }
  const bodies = ['data', 'dataFile', 'jsonBody'].filter(key => options[key] !== undefined);
  if (bodies.length > 1) {
    throw new CurlTimeError('Use only one of --data, --data-file, or --json-body.', 2);
  }
  if (bodies.length && (options.head || method === 'HEAD')) {
    throw new CurlTimeError('HEAD requests cannot have a request body.', 2);
  }
  if (options.data !== undefined && typeof options.data !== 'string' && !Buffer.isBuffer(options.data)) {
    throw new CurlTimeError('--data must be text or a Buffer.', 2);
  }
  if (options.dataFile !== undefined && (typeof options.dataFile !== 'string' || !options.dataFile.length)) {
    throw new CurlTimeError('--data-file requires a file path.', 2);
  }
  if (options.jsonBody !== undefined) {
    try {
      if (typeof options.jsonBody !== 'string') throw new Error();
      JSON.parse(options.jsonBody);
    } catch {
      throw new CurlTimeError('--json-body requires valid JSON.', 2);
    }
  }
  const maxTotal = options.maxTotal === undefined ? undefined : positiveSeconds(options.maxTotal, '--max-total (ms)');
  const maxTtfb = options.maxTtfb === undefined ? undefined : positiveSeconds(options.maxTtfb, '--max-ttfb (ms)');
  let expectStatus;
  if (options.expectStatus !== undefined) {
    if (typeof options.expectStatus !== 'string' && typeof options.expectStatus !== 'number') {
      throw new CurlTimeError('--expect-status requires HTTP codes or classes, such as 200,204 or 2xx.', 2);
    }
    expectStatus = String(options.expectStatus).toLowerCase().split(',').map(value => value.trim());
    if (expectStatus.some(value => !/^[1-5](?:\d{2}|xx)$/.test(value))) {
      throw new CurlTimeError('--expect-status requires HTTP codes or classes, such as 200,204 or 2xx.', 2);
    }
    expectStatus = expectStatus.join(',');
  }
  return { ...options, timeout, connectTimeout, headers, method, maxTotal, maxTtfb, expectStatus };
}

function positiveSeconds(value, flag) {
  if (!['string', 'number'].includes(typeof value) ||
      !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(value)) ||
      !Number.isFinite(Number(value)) || Number(value) <= 0) {
    throw new CurlTimeError(`${flag} must be a positive number.`, 2);
  }
  return Number(value);
}

export function buildCurlArgs(url, options = {}) {
  const target = normalizeUrl(url);
  const settings = validateOptions(options);
  const args = [
    '--disable', // Must be first: ignore .curlrc so one report always means one request.
    '--silent', '--show-error', '--globoff',
    '--output', devNull, '--write-out', '%{json}',
    '--proto', '=http,https', '--proto-redir', '=http,https',
    '--max-time', String(settings.timeout),
    '--connect-timeout', String(settings.connectTimeout),
    '--max-redirs', '10',
  ];
  if (settings.follow) args.push('--location');
  if (settings.head || settings.method === 'HEAD') args.push('--head');
  if (settings.method) args.push('--request', settings.method);
  if (settings.fail) args.push('--fail');
  const headers = [...settings.headers];
  if (settings.jsonBody !== undefined) {
    for (const [name, value] of [['Content-Type', 'application/json'], ['Accept', 'application/json']]) {
      if (!headers.some(header => new RegExp(`^${name}\\s*[:;]`, 'i').test(header))) headers.push(`${name}: ${value}`);
    }
  }
  for (const header of headers) args.push('--header', header);
  if (settings.data !== undefined || settings.dataFile !== undefined || settings.jsonBody !== undefined) {
    args.push('--data-binary', '@-');
  }
  args.push('--url', target);
  return args;
}

export async function measure(url, options = {}) {
  const target = normalizeUrl(url);
  const settings = await prepareRequest(options);
  const args = buildCurlArgs(target, settings);
  let stdout;
  let stderr;
  try {
    const execution = execFileAsync(process.platform === 'win32' ? 'curl.exe' : 'curl', args, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      signal: settings.signal,
    });
    // Keep bodies out of process arguments and preserve binary files exactly.
    // An early curl failure may close stdin before the body finishes writing.
    execution.child.stdin.on('error', () => {});
    execution.child.stdin.end(settings.data ?? settings.jsonBody);
    ({ stdout, stderr } = await execution);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new CurlTimeError('curl was not found. Install curl 7.70+ and make sure it is on your PATH.', 1, { cause: error });
    }
    const detail = error.stderr?.trim() || error.message;
    const code = typeof error.code === 'number' && error.code > 0 ? error.code : 1;
    const failure = new CurlTimeError(detail, code, { cause: error });
    failure.isTransferError = typeof error.code === 'number' && error.code > 0;
    throw failure;
  }

  let data;
  try {
    data = JSON.parse(stdout);
  } catch (error) {
    throw new CurlTimeError(`Unable to read curl timings. curl 7.70+ is required.${stderr ? ` ${stderr.trim()}` : ''}`, 1, { cause: error });
  }
  const report = createReport(target, data);
  if (hasChecks(settings)) report.checks = checkReport(report, settings);
  return report;
}

export async function prepareRequest(options = {}) {
  const settings = validateOptions(options);
  if (settings.dataFile !== undefined) {
    try {
      settings.data = await readFile(settings.dataFile);
      delete settings.dataFile;
    } catch (error) {
      throw new CurlTimeError(`Cannot read request body file: ${settings.dataFile} (${error.code || error.message}).`, 2, { cause: error });
    }
  }
  return settings;
}

export function hasChecks(options) {
  return options.expectStatus !== undefined || options.maxTotal !== undefined || options.maxTtfb !== undefined;
}

export function checkReport(report, options = {}) {
  const settings = validateOptions(options);
  const failures = [];
  if (settings.expectStatus !== undefined) {
    const actual = String(report.httpStatus);
    const matches = settings.expectStatus.split(',').some(expected =>
      expected.endsWith('xx') ? actual.length === 3 && actual[0] === expected[0] : actual === expected);
    if (!matches) failures.push(`Expected HTTP ${settings.expectStatus}; received ${actual}.`);
  }
  for (const [key, limit, label] of [['total', settings.maxTotal, 'Total'], ['ttfb', settings.maxTtfb, 'TTFB']]) {
    if (limit !== undefined && report.timings[key] > limit) {
      failures.push(`${label} ${report.timings[key].toFixed(2)} ms exceeds ${limit} ms.`);
    }
  }
  return { passed: failures.length === 0, failures };
}

export function createReport(url, data) {
  const read = key => {
    if (typeof data?.[key] !== 'number' || !Number.isFinite(data[key]) || data[key] < 0) {
      throw new CurlTimeError(`curl returned an invalid ${key} timing. curl 7.70+ is required.`);
    }
    return data[key];
  };
  const dns = read('time_namelookup');
  const connect = read('time_connect');
  const tls = read('time_appconnect');
  const ready = read('time_pretransfer');
  const firstByte = read('time_starttransfer');
  const total = read('time_total');
  const ms = seconds => Math.round(Math.max(0, seconds) * 100000) / 100;

  return {
    url,
    effectiveUrl: data.url_effective || url,
    unit: 'ms',
    timings: {
      dns: ms(dns),
      tcp: ms(connect - dns),
      tls: tls > 0 ? ms(tls - connect) : 0,
      server: ms(firstByte - ready),
      ttfb: ms(firstByte),
      download: ms(total - firstByte),
      total: ms(total),
    },
    httpStatus: data.response_code ?? data.http_code,
    remoteIp: data.remote_ip || '',
    httpVersion: String(data.http_version ?? ''),
    redirects: data.num_redirects ?? 0,
  };
}

export function terminalText(value) {
  return String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}

export function formatReport(report) {
  const rows = [
    ['URL', report.url],
    ...(report.redirects ? [['Final URL', report.effectiveUrl]] : []),
    ['DNS (ms)', report.timings.dns.toFixed(2)],
    ['TCP (ms)', report.timings.tcp.toFixed(2)],
    ['SSL/TLS (ms)', report.timings.tls.toFixed(2)],
    ['Server Response (ms)', report.timings.server.toFixed(2)],
    ['TTFB (ms)', report.timings.ttfb.toFixed(2)],
    ['Download (ms)', report.timings.download.toFixed(2)],
    ['Total (ms)', report.timings.total.toFixed(2)],
    ['HTTP Status', report.httpStatus],
    ['Remote IP', report.remoteIp],
    ['HTTP Version', report.httpVersion],
    ['Redirects', report.redirects],
  ];
  if (report.checks) rows.push(['Checks', report.checks.passed ? 'PASS' : 'FAIL']);
  const lines = rows.map(([label, value]) => `${label.padEnd(21)} : ${terminalText(value)}`);
  for (const failure of report.checks?.failures ?? []) lines.push(`  - ${terminalText(failure)}`);
  return lines.join('\n');
}
