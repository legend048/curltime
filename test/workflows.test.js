import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, test } from 'node:test';
import { compareBaseline, createBaseline, loadConfig, requestFingerprint, watch } from '../src/index.js';
import { parseArgs } from '../src/args.js';

const cli = fileURLToPath(new URL('../bin/curltime.js', import.meta.url));
let directory;
let server;
let base;
let requests;
let statusCodes;
let requestHook;
const environment = { ...process.env, NO_PROXY: '*', no_proxy: '*' };

function run(...args) {
  return new Promise(resolve => execFile(process.execPath, [cli, ...args], {
    encoding: 'utf8', timeout: 15000, cwd: directory, env: environment,
  }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr })));
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'curltime-workflows-'));
  server = createServer((req, res) => {
    const entry = { url: req.url, headers: req.headers, body: [] };
    requests.push(entry);
    requestHook?.();
    req.on('data', chunk => entry.body.push(chunk));
    req.on('end', () => {
      entry.body = Buffer.concat(entry.body).toString();
      if (req.url === '/reset') return req.socket.destroy();
      if (req.url === '/hang') return;
      res.statusCode = statusCodes.shift() ?? 200;
      if (req.url === '/slow') {
        const timer = setTimeout(() => res.end('ok'), 120);
        res.on('close', () => clearTimeout(timer));
      } else res.end('ok');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => { requests = []; statusCodes = []; requestHook = undefined; });
after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
});

test('config initialization is usable offline and never overwrites a file', async () => {
  const result = await run('--init');
  assert.equal(result.code, 0, result.stderr);
  const path = join(directory, 'curltime.config.json');
  const text = await readFile(path, 'utf8');
  assert.equal(JSON.parse(text).version, 1);
  const again = await run('--init');
  assert.equal(again.code, 2);
  assert.match(again.stderr, /already exists/);
  assert.equal(await readFile(path, 'utf8'), text);
  assert.equal(requests.length, 0);
});

test('config merges CLI overrides, replaces headers, and resolves paths beside the config', async () => {
  const path = join(directory, 'checks.json');
  await writeFile(join(directory, 'body.txt'), 'literal file bytes');
  await writeFile(path, JSON.stringify({ version: 1, urls: [`${base}/configured`], options: {
    repeat: 3, headers: ['X-Source: config'], dataFile: './body.txt', json: true, output: './configured-output.json',
  } }));
  const result = await run('--config', path, '-n', '2', '-H', 'X-Source: cli', `${base}/overridden`);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '');
  const report = JSON.parse(await readFile(join(directory, 'configured-output.json'), 'utf8'));
  assert.equal(report.repeat, 2);
  assert.deepEqual(requests.map(req => req.url), ['/overridden', '/overridden']);
  assert.ok(requests.every(req => req.headers['x-source'] === 'cli' && req.body === 'literal file bytes'));
});

test('config environment substitution is literal and missing variables fail before requests', async () => {
  const path = join(directory, 'env.json');
  await writeFile(path, JSON.stringify({ version: 1, urls: ['${SERVICE_URL}'], options: { headers: ['Authorization: Bearer ${SERVICE_TOKEN}'] } }));
  const value = 'literal $(not-executed) ${NOT_EXPANDED_AGAIN}';
  const config = loadConfig(path, { SERVICE_URL: base, SERVICE_TOKEN: value });
  assert.equal(config.urls[0], base);
  assert.equal(config.options.headers[0], `Authorization: Bearer ${value}`);
  assert.throws(() => loadConfig(path, {}), /SERVICE_URL|SERVICE_TOKEN/);
  const result = await run('--config', path);
  assert.equal(result.code, 2);
  assert.doesNotMatch(result.stderr, /literal/);
  assert.equal(requests.length, 0);
});

test('config rejects typos, wrong types, invalid values, and incompatible modes', async () => {
  const path = join(directory, 'invalid.json');
  for (const options of [{ timeot: 1 }, { watch: 'false' }, { repeat: '2' }, { repeat: 0 }, { headers: [1] }]) {
    await writeFile(path, JSON.stringify({ version: 1, urls: [base], options }));
    const result = await run('--config', path);
    assert.equal(result.code, 2, JSON.stringify(options));
  }
  for (const args of [
    ['--watch', '--interval=0'], ['--watch', '--warmup=1'], ['--watch', '--baseline=x'],
    ['--max-regression=2'], ['--baseline=x', '--max-regression=-1'], ['--baseline=x', '--save-baseline=y'],
    ['--init', base], ['--save-baseline=x', base, base],
  ]) assert.throws(() => parseArgs(args.includes(base) ? args : [...args, base]), error => error.exitCode === 2);
  const watchOptions = parseArgs(['--watch', base]);
  assert.equal(watchOptions.repeat, undefined);
  assert.equal(watchOptions.interval, 5);
  assert.equal(watchOptions.expectStatus, '2xx');
  assert.equal(requests.length, 0);
});

test('watch emits failures and recoveries and retains summary counts without sample history', async () => {
  statusCodes = [200, 503, 503, 200];
  const events = [];
  const summary = await watch(base, { repeat: 4, interval: 0.1, onEvent: event => events.push(event) });
  assert.deepEqual(events.slice(0, -1).map(event => event.transition), ['UP', 'FAILED', null, 'RECOVERED']);
  assert.equal(events.at(-1), summary);
  assert.equal(summary.results[0].passed, 2);
  assert.equal(summary.results[0].failed, 2);
  assert.equal(summary.results[0].availability, 50);
  assert.equal(summary.results[0].outages, 1);
  assert.equal(summary.results[0].recoveries, 1);
  assert.equal(summary.results[0].state, 'UP');
  assert.equal(summary.results[0].samples, undefined);
  assert.equal(summary.exitCode, 3, 'recovery must not hide an earlier failed check');
});

test('watch NDJSON streams samples and a summary; curl failures do not stop other endpoints', async () => {
  const result = await run('--watch', '-n', '2', '--interval=.1', '--json', `${base}/reset`, base);
  assert.ok([52, 56].includes(result.code), result.stderr);
  const events = result.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(events.length, 5);
  assert.equal(events[0].type, 'sample');
  assert.ok(events[0].error);
  const summary = events.at(-1);
  assert.equal(summary.type, 'summary');
  assert.equal(summary.results[0].meanTotal, null);
  assert.equal(summary.results[0].outages, 1);
  assert.equal(summary.results[1].passed, 2);
  assert.equal(summary.rounds, 2);
});

test('watch files stream CSV with one header and put the summary on stderr', async () => {
  const path = join(directory, 'monitor.csv');
  const result = await run('--watch', '-n', '2', '--interval=.1', '--csv', '-o', path, base);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '');
  const csv = await readFile(path, 'utf8');
  assert.equal(csv.trim().split('\n').length, 3);
  assert.match(csv, /^timestamp,state,transition,url,iteration,/);
  assert.match(csv, /,UP,UP,/);
  assert.match(result.stderr, /2\/2 checks passed/);
});

test('watch cancellation flushes a summary during intervals and during an active transfer', async () => {
  const controller = new AbortController();
  const events = [];
  const result = await watch(base, { interval: 30, signal: controller.signal, onEvent(event) {
    events.push(event);
    if (event.type === 'sample') setTimeout(() => controller.abort(), 30);
  } });
  assert.equal(result.interrupted, true);
  assert.equal(result.rounds, 1);
  assert.equal(events.at(-1).type, 'summary');
  assert.equal(requests.length, 1);
  const active = new AbortController();
  requestHook = () => active.abort();
  const cancelled = await watch(`${base}/hang`, { signal: active.signal });
  assert.equal(cancelled.interrupted, true);
  assert.equal(cancelled.results[0].attempts, 0, 'a cancelled transfer is not an outage');
  const preCancelled = await watch(base, { signal: AbortSignal.abort() });
  assert.equal(preCancelled.results[0].availability, null);
  assert.equal(requests.length, 2);
});

test('CLI SIGINT preserves streaming output and exits with 130', { skip: process.platform === 'win32' }, async () => {
  const child = spawn(process.execPath, [cli, '--watch', '--interval=30', '--json', base], { env: environment });
  let output = '';
  let signalled = false;
  child.stdout.on('data', data => {
    output += data;
    if (!signalled && output.includes('\n')) { signalled = true; child.kill('SIGINT'); }
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    const code = await new Promise(resolve => child.once('close', resolve));
    assert.equal(code, 130);
    const events = output.trim().split('\n').map(JSON.parse);
    assert.equal(events.at(-1).interrupted, true);
  } finally { clearTimeout(timeout); }
});

test('watch awaits consumers and reports callback failures instead of swallowing them', async () => {
  const controller = new AbortController();
  await assert.rejects(watch(base, { repeat: 2, interval: 0.1, onEvent: async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
    controller.abort();
    throw new Error('cannot write report');
  }, signal: controller.signal }), /cannot write report/);
  assert.equal(requests.length, 1);
});

test('watch exits quietly when a pipe consumer closes early', async () => {
  const child = spawn(process.execPath, [cli, '--watch', '--interval=.1', '--json', base], { env: environment });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.once('data', () => child.stdout.destroy());
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    const code = await new Promise(resolve => child.once('close', resolve));
    assert.equal(code, 0, stderr);
    assert.equal(stderr, '');
  } finally { clearTimeout(timeout); }
});

function fakeReport(p95 = 100, failed = 0) {
  return { mode: 'benchmark', repeat: 10, warmup: 0, checks: { passed: !failed }, results: [
    { url: `${base}/`, completed: p95 === null ? 0 : 10, failed, timings: { total: p95 === null ? null : { p95 } } },
  ] };
}

test('baseline comparison has inclusive limits, handles zero references, and never passes failures', () => {
  const baseline = createBaseline(fakeReport(), requestFingerprint());
  assert.equal(compareBaseline(fakeReport(120), baseline, 20).passed, true);
  assert.equal(compareBaseline(fakeReport(120.01), baseline, 20).passed, false);
  assert.equal(compareBaseline(fakeReport(80), baseline).targets[0].changePercent, -20);
  assert.equal(compareBaseline(fakeReport(80, 1), baseline).passed, false);
  assert.equal(compareBaseline(fakeReport(null, 10), baseline).targets[0].currentP95, null);
  const zero = createBaseline(fakeReport(0), requestFingerprint());
  assert.equal(compareBaseline(fakeReport(0), zero).passed, true);
  assert.equal(compareBaseline(fakeReport(0.01), zero).passed, false);
  assert.equal(compareBaseline(fakeReport(1), zero).targets[0].changePercent, null);
  assert.throws(() => createBaseline(fakeReport(10, 1), requestFingerprint()));
});

test('baseline fingerprints cover bodies and settings without embedding credentials', () => {
  const fingerprint = requestFingerprint({ headers: ['Authorization: secret'], data: 'hello' });
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(fingerprint, requestFingerprint({ headers: ['Authorization: secret'], data: Buffer.from('hello') }));
  for (const options of [{ data: 'changed' }, { follow: true }, { timeout: 5 }, { method: 'HEAD' }, { headers: ['Authorization: new'] }]) {
    assert.notEqual(fingerprint, requestFingerprint(options));
  }
  assert.throws(() => requestFingerprint({ dataFile: 'file.txt' }), /Prepare/);
});

test('baseline saving, regression checks, JSON, and CSV work end to end', async () => {
  const path = join(directory, 'before.json');
  const saved = await run('-n', '2', '--save-baseline', path, '--json', `${base}/slow`);
  assert.equal(saved.code, 0, saved.stderr);
  const baseline = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(baseline.targets[0].samples, 2);
  assert.equal(baseline.kind, 'curltime-baseline');
  // A deterministic low reference avoids flaky latency comparisons across OSes.
  baseline.targets[0].p95TotalMs = 1;
  await writeFile(path, JSON.stringify(baseline));
  const result = await run('-n', '2', '--baseline', path, '--json', `${base}/slow`);
  assert.equal(result.code, 3, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.comparison.metric, 'total.p95');
  assert.equal(report.comparison.passed, false);
  assert.equal(report.checks.passed, false);
  const csv = await run('-n', '1', '--baseline', path, '--csv', `${base}/slow`);
  assert.equal(csv.code, 3, csv.stderr);
  assert.match(csv.stdout, /^url,iteration,/);
  assert.match(csv.stderr, /Baseline: total P95.*FAIL/);
});

test('mismatched or corrupt baselines fail before networking and existing references are preserved', async () => {
  const path = join(directory, 'reference.json');
  const baseline = createBaseline(fakeReport(), requestFingerprint());
  const original = JSON.stringify(baseline);
  await writeFile(path, original);
  for (const args of [
    ['--baseline', path, '--data=changed', base],
    ['--baseline', path, `${base}/different`],
    ['--save-baseline', path, base],
  ]) {
    const result = await run(...args);
    assert.equal(result.code, 2, result.stderr);
  }
  assert.equal(await readFile(path, 'utf8'), original);
  baseline.targets[0].p95TotalMs = -1;
  await writeFile(path, JSON.stringify(baseline));
  assert.equal((await run('--baseline', path, base)).code, 2);
  assert.equal(requests.length, 0);
});

test('failed benchmarks cannot be saved as baselines', async () => {
  const path = join(directory, 'failed-baseline.json');
  statusCodes = [503];
  const result = await run('-n', '1', '--expect-status=2xx', '--save-baseline', path, '--json', base);
  assert.equal(result.code, 3, result.stderr);
  assert.equal(JSON.parse(result.stdout).checks.passed, false);
  assert.match(result.stderr, /was not saved/);
  await assert.rejects(readFile(path), error => error.code === 'ENOENT');
});

test('output paths cannot overwrite config, body, baseline, or another output', async () => {
  const path = join(directory, 'protected.json');
  const original = JSON.stringify({ version: 1, urls: [base] });
  await writeFile(path, original);
  for (const args of [
    ['--config', path, '-o', path], ['--data-file', path, '-o', path, base],
    ['--baseline', path, '-o', path, base], ['--save-baseline', 'new.json', '-o', 'new.json', base],
    ['--watch', '--config', path, '-o', path],
  ]) assert.equal((await run(...args)).code, 2);
  assert.equal(await readFile(path, 'utf8'), original);
  assert.equal(requests.length, 0);
});
