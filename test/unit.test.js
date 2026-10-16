import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs } from '../src/args.js';
import { buildCurlArgs, createReport, formatReport, normalizeUrl, terminalText } from '../src/index.js';

const timingData = {
  time_namelookup: 0.01, time_connect: 0.04, time_appconnect: 0.09,
  time_pretransfer: 0.1, time_starttransfer: 0.3, time_total: 0.35,
  http_code: 200, remote_ip: '127.0.0.1', http_version: '2', num_redirects: 0,
};

test('reports distinct connection phases in milliseconds', () => {
  const report = createReport('https://example.com/', timingData);
  assert.deepEqual(report.timings, { dns: 10, tcp: 30, tls: 50, server: 200, ttfb: 300, download: 50, total: 350 });
  assert.equal(report.httpStatus, 200);
  assert.match(formatReport(report), /SSL\/TLS \(ms\)\s+: 50.00/);
});

test('plain HTTP has zero TLS time and rounding never creates negative phases', () => {
  const report = createReport('http://example.com/', {
    ...timingData, time_appconnect: 0, time_connect: 0.0099999,
  });
  assert.equal(report.timings.tls, 0);
  assert.equal(report.timings.tcp, 0);
});

test('rejects missing or invalid curl measurements', () => {
  for (const value of [undefined, NaN, -1, '0.5']) {
    assert.throws(() => createReport('https://example.com/', { ...timingData, time_total: value }), /invalid time_total/);
  }
});

test('normalizes bare hosts and accepts HTTP, HTTPS, ports, and IPv6', () => {
  assert.equal(normalizeUrl('example.com/test?a=b'), 'https://example.com/test?a=b');
  assert.equal(normalizeUrl('http://[::1]:8080/'), 'http://[::1]:8080/');
  assert.equal(normalizeUrl('localhost:8080'), 'https://localhost:8080/');
  for (const input of ['', 'a b', 'https://', 'file:///etc/passwd', 'ftp://example.com']) {
    assert.throws(() => normalizeUrl(input));
  }
});

test('parses options before and after URL with repeated headers', () => {
  const options = parseArgs(['-L', 'example.com', '--json', '-H', 'Accept: text/plain', '--header=X-Test: value', '--timeout=1.5', '-X', 'head']);
  assert.equal(options.url, 'https://example.com/');
  assert.equal(options.follow, true);
  assert.equal(options.json, true);
  assert.equal(options.timeout, 1.5);
  assert.deepEqual(options.headers, ['Accept: text/plain', 'X-Test: value']);
  assert.equal(options.method, 'HEAD');
});

test('invalid invocations fail before making a request', () => {
  for (const args of [[], ['--unknown', 'a.com'], ['--timeout'],
    ['--timeout', '0', 'a.com'], ['--timeout=NaN', 'a.com'], ['--timeout=Infinity', 'a.com'],
    ['--timeout=-1', 'a.com'], ['--json=true', 'a.com'], ['-H', '@secrets', 'a.com'],
    ['-H', 'X-Test: a\r\nInjected: b', 'a.com'], ['-I', '-X', 'POST', 'a.com']]) {
    assert.throws(() => parseArgs(args), error => error.exitCode === 2);
  }
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['--version']).version, true);
});

test('curl arguments disable local config, URL globbing, and non-HTTP redirects', () => {
  const args = buildCurlArgs('https://example.com/?x=[1-2]&y=$(echo)', { method: 'HEAD', follow: true });
  assert.equal(args[0], '--disable');
  assert.ok(args.includes('--globoff'));
  assert.ok(args.includes('--head'));
  assert.ok(args.includes('--location'));
  assert.equal(args[args.indexOf('--proto-redir') + 1], '=http,https');
  assert.equal(args.at(-1), 'https://example.com/?x=[1-2]&y=$(echo)');
});

test('terminal output neutralizes escape sequences', () => {
  assert.equal(terminalText('\x1b[31mvalue\nnext'), ' [31mvalue next');
});
