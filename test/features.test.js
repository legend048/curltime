import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { unlinkSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, test } from 'node:test';
import { benchmark, buildCurlArgs, checkReport, formatCsv, measure, summarize, validateBenchmarkOptions } from '../src/index.js';
import { parseArgs } from '../src/args.js';

const cli = fileURLToPath(new URL('../bin/curltime.js', import.meta.url));
const requests = [];
let server;
let baseUrl;
let directory;
let onRequest;

function run(...args) {
  return new Promise(resolve => {
    execFile(process.execPath, [cli, ...args], {
      encoding: 'utf8', timeout: 15000,
      env: { ...process.env, NO_PROXY: '*', no_proxy: '*' },
    }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }));
  });
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'curltime-features-'));
  server = createServer((request, response) => {
    const entry = { url: request.url, method: request.method, headers: request.headers, at: performance.now() };
    requests.push(entry);
    onRequest?.();
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      entry.body = Buffer.concat(chunks);
      if (request.url === '/reset') return request.socket.destroy();
      if (request.url === '/warmup' && requests.length === 1) response.statusCode = 503;
      if (request.url.startsWith('/status/')) response.statusCode = Number(request.url.split('/').at(-1));
      if (request.url === '/delay') {
        const timer = setTimeout(() => response.end('delayed'), 150);
        response.on('close', () => clearTimeout(timer));
      } else {
        response.end('ok');
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => { requests.length = 0; onRequest = undefined; });
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});

test('statistics use interpolated percentiles and include population deviation', () => {
  const values = [40, 10, 30, 20];
  assert.deepEqual(summarize(values), { min: 10, mean: 25, p50: 25, p95: 38.5, max: 40, stddev: 11.18 });
  assert.deepEqual(values, [40, 10, 30, 20]);
  assert.deepEqual(summarize([7]), { min: 7, mean: 7, p50: 7, p95: 7, max: 7, stddev: 0 });
  assert.equal(summarize([]), null);
  assert.throws(() => summarize([NaN]));
});

test('checks support status classes and inclusive latency limits', () => {
  const report = { httpStatus: 204, timings: { total: 150, ttfb: 100 } };
  assert.equal(checkReport(report, { expectStatus: '2xx,304', maxTotal: 150, maxTtfb: 100 }).passed, true);
  const failed = checkReport(report, { expectStatus: 200, maxTotal: 149, maxTtfb: 99 });
  assert.equal(failed.passed, false);
  assert.equal(failed.failures.length, 3);
});

test('new argument combinations are validated before making requests', () => {
  for (const args of [
    ['--repeat=0'], ['--repeat=1.5'], ['--repeat=1001'], ['--warmup=-1'], ['--interval=3601'],
    ['--expect-status=600'], ['--expect-status=200,'], ['--max-total=0'], ['--max-ttfb=oops'],
    ['--json', '--csv'], ['--json-body={broken}'], ['--data=x', '--data-file=a'],
    ['--data=x', '--json-body={}'], ['-I', '--data='], ['--request=HEAD', '--json-body={}'],
  ]) {
    assert.throws(() => parseArgs([...args, baseUrl]), error => error.exitCode === 2, args.join(' '));
  }
  assert.equal(parseArgs(['--data=', baseUrl]).data, '');
  assert.equal(parseArgs(['--json-body=-1', baseUrl]).jsonBody, '-1');
  const comparison = parseArgs(['-n', '3', 'example.com', 'example.org']);
  assert.equal(comparison.benchmark, true);
  assert.equal(comparison.repeat, 3);
  assert.equal(comparison.urls.length, 2);
  assert.throws(() => validateBenchmarkOptions({ repeat: [2] }));
  assert.throws(() => validateBenchmarkOptions({ interval: [1] }));
});

test('benchmarks compare targets in rounds and exclude warmups from samples', async () => {
  const result = await run('-n', '3', '--warmup', '1', '--json', `${baseUrl}/one`, `${baseUrl}/two`);
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.mode, 'benchmark');
  assert.equal(report.results.length, 2);
  assert.deepEqual(requests.map(request => request.url), ['/one', '/two', '/one', '/two', '/one', '/two', '/one', '/two']);
  for (const target of report.results) {
    assert.equal(target.attempts, 3);
    assert.equal(target.completed, 3);
    assert.equal(target.passed, 3);
    assert.equal(target.failed, 0);
    assert.deepEqual(target.samples.map(sample => sample.iteration), [1, 2, 3]);
    assert.deepEqual(target.statusCodes, { 200: 3 });
    assert.ok(target.timings.total.p95 >= target.timings.total.p50);
    assert.ok(target.timings.total.max >= target.timings.total.p95);
  }
});

test('comparison output is readable and shows summary columns', async () => {
  const result = await run(baseUrl, `${baseUrl}/status/204`);
  assert.equal(result.code, 0, result.stderr);
  for (const value of ['Passed', 'Mean', 'P50', 'P95', 'Stddev', '1/1', 'Checks: PASS']) assert.ok(result.stdout.includes(value));
  const row = result.stdout.split('\n').find(line => line.startsWith(baseUrl));
  assert.ok(row.includes('  1/1'), 'data rows must use the same aligned columns as the header');
  assert.ok(row.includes('200(1)'));
});

test('failed transfers stay visible and are excluded from timing statistics', async () => {
  const result = await run('-n', '2', '--json', `${baseUrl}/reset`, baseUrl);
  assert.ok([52, 56].includes(result.code), result.stderr);
  const report = JSON.parse(result.stdout);
  const failed = report.results[0];
  assert.equal(failed.completed, 0);
  assert.equal(failed.failed, 2);
  assert.equal(failed.timings.total, null);
  assert.equal(failed.samples.length, 2);
  assert.ok(failed.samples.every(sample => sample.error.exitCode > 0));
  assert.equal(report.results[1].completed, 2);
  assert.equal(report.checks.passed, false);
});

test('failed warmups are counted separately and do not fail successful measured samples', async () => {
  const result = await run('-n', '2', '--warmup', '1', '--fail', '--json', `${baseUrl}/warmup`);
  assert.equal(result.code, 0, result.stderr);
  const target = JSON.parse(result.stdout).results[0];
  assert.equal(target.warmupFailures, 1);
  assert.equal(target.failed, 0);
  assert.equal(target.completed, 2);
});

test('CI checks retain reports and use exit 3 for status or latency violations', async () => {
  const failed = await run('--expect-status', '2xx', '--json', `${baseUrl}/status/503`);
  assert.equal(failed.code, 3, failed.stderr);
  assert.equal(JSON.parse(failed.stdout).httpStatus, 503);
  assert.equal(JSON.parse(failed.stdout).checks.passed, false);
  const slow = await run('--max-total', '1', '--max-ttfb', '1', '--json', `${baseUrl}/delay`);
  assert.equal(slow.code, 3, slow.stderr);
  assert.equal(JSON.parse(slow.stdout).checks.failures.length, 2);
  const passing = await run('--expect-status=2xx,304', '--json', `${baseUrl}/status/304`);
  assert.equal(passing.code, 0, passing.stderr);
});

test('HTTP check failures remain in benchmark stats and CSV output', async () => {
  const result = await run('-n', '2', '--expect-status=200', '--json', `${baseUrl}/status/503`);
  assert.equal(result.code, 3, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.results[0].completed, 2);
  assert.equal(report.results[0].failed, 2);
  assert.deepEqual(report.results[0].statusCodes, { 503: 2 });
  assert.ok(report.results[0].timings.total);
  const csv = formatCsv(report);
  assert.match(csv, /false,3,Expected HTTP 200; received 503\./);
});

test('literal POST bodies are sent exactly and are not curl file references', async () => {
  const payload = '@not-a-file & $(not-a-command)\nhello';
  const result = await run('--data', payload, '--json', `${baseUrl}/body`);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].body.toString(), payload);
  assert.doesNotMatch(result.stdout, /not-a-command/);
  const args = buildCurlArgs(baseUrl, { data: payload });
  assert.equal(args.includes(payload), false);
  assert.ok(args.includes('@-'));
});

test('JSON bodies set useful headers and respect explicit overrides', async () => {
  const payload = '{"message":"hello"}';
  const result = await run('--json-body', payload, '-X', 'PATCH', '--json', `${baseUrl}/body`);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests[0].method, 'PATCH');
  assert.equal(requests[0].headers['content-type'], 'application/json');
  assert.equal(requests[0].headers.accept, 'application/json');
  assert.equal(requests[0].body.toString(), payload);
  const override = await run('--json-body={}', '-H', 'content-type: application/custom+json', '-H', 'Accept: text/plain', baseUrl);
  assert.equal(override.code, 0, override.stderr);
  assert.equal(requests[1].headers['content-type'], 'application/custom+json');
  assert.equal(requests[1].headers.accept, 'text/plain');
});

test('binary body files are loaded once and replayed for every benchmark sample', async () => {
  const path = join(directory, 'payload.bin');
  const payload = Buffer.from([0, 10, 13, 127, 128, 255]);
  await writeFile(path, payload);
  onRequest = () => { if (requests.length === 1) unlinkSync(path); };
  const result = await benchmark(baseUrl, { dataFile: path, repeat: 2 });
  assert.equal(result.checks.passed, true);
  assert.equal(requests.length, 2);
  for (const request of requests) assert.deepEqual(request.body, payload);
});

test('invalid body files and later invalid URLs fail before any transfer', async () => {
  const missing = await run('--data-file', join(directory, 'missing.bin'), baseUrl);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /Cannot read request body file/);
  const invalid = await run(baseUrl, 'file:///not-http');
  assert.equal(invalid.code, 2);
  assert.equal(requests.length, 0);
});

test('CSV exports contain measured samples only, with correct escaping', async () => {
  const output = join(directory, 'timings.csv');
  const result = await run('-n', '2', '--warmup', '1', '--csv', '-o', output, `${baseUrl}/a,b`);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '');
  const csv = await readFile(output, 'utf8');
  assert.equal(csv.trim().split('\n').length, 3);
  assert.match(csv, /dns_ms,tcp_ms,tls_ms,server_ms,ttfb_ms,download_ms,total_ms/);
  assert.ok(csv.includes(`"${baseUrl}/a,b",1,200`));
  const errors = formatCsv({ mode: 'benchmark', results: [{ url: baseUrl, samples: [
    { iteration: 1, error: { exitCode: 7, message: 'error,\n"quoted"' } },
  ] }] });
  assert.ok(errors.includes('false,7,"error,\n""quoted"""'));
});

test('single-request CSV and JSON file exports keep their exit status', async () => {
  const csv = await run('--csv', baseUrl);
  assert.equal(csv.code, 0, csv.stderr);
  assert.equal(csv.stdout.trim().split('\n').length, 2);
  const path = join(directory, 'failed.json');
  const result = await run('--json', '--expect-status=200', '-o', path, `${baseUrl}/status/404`);
  assert.equal(result.code, 3, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(await readFile(path, 'utf8')).checks.passed, false);
});

test('intervals pause between rounds', async () => {
  const result = await run('-n', '2', '--interval', '0.3', '--json', baseUrl);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(requests[1].at - requests[0].at >= 280);
});

test('programmatic benchmarks can be cancelled without starting more requests', async () => {
  const controller = new AbortController();
  onRequest = () => controller.abort();
  await assert.rejects(benchmark(`${baseUrl}/delay`, { repeat: 10, signal: controller.signal }));
  assert.equal(requests.length, 1);
});

test('cancellation also stops an interval wait and a pre-cancelled request', async () => {
  const controller = new AbortController();
  onRequest = () => { setTimeout(() => controller.abort(), 100).unref(); };
  await assert.rejects(benchmark(baseUrl, { repeat: 2, interval: 30, signal: controller.signal }));
  assert.equal(requests.length, 1);
  requests.length = 0;
  await assert.rejects(measure(baseUrl, { signal: AbortSignal.abort() }));
  assert.equal(requests.length, 0);
});
