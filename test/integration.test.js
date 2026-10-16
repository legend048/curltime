import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const cli = fileURLToPath(new URL('../bin/curltime.js', import.meta.url));
let server;
let baseUrl;

function run(...args) {
  return new Promise(resolve => {
    execFile(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, NO_PROXY: '*', no_proxy: '*' },
    }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }));
  });
}

before(async () => {
  server = createServer((request, response) => {
    if (request.url === '/redirect' || request.url === '/loop') {
      response.writeHead(302, { Location: request.url === '/loop' ? '/loop' : '/' });
    } else if (request.url === '/blocked-redirect') {
      response.writeHead(302, { Location: 'file:///not-a-real-file' });
    } else if (request.url === '/slow') {
      const timer = setTimeout(() => response.end('done'), 2000);
      response.on('close', () => clearTimeout(timer));
      return;
    } else if (request.url === '/missing') {
      response.writeHead(404);
    } else if (request.url === '/headers') {
      response.writeHead(request.headers['x-test'] === 'space & ; $(not-a-command)' ? 200 : 400);
    } else if (request.url === '/head') {
      response.writeHead(request.method === 'HEAD' ? 200 : 405);
    } else if (request.url === '/method') {
      response.writeHead(request.method === 'OPTIONS' ? 204 : 405);
    }
    response.end('This response body must never appear in the report.');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

test('real curl returns a structured timing report and discards the body', async () => {
  const result = await run('--json', baseUrl);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.httpStatus, 200);
  assert.equal(report.unit, 'ms');
  assert.equal(report.remoteIp, '127.0.0.1');
  assert.equal(report.timings.tls, 0);
  assert.ok(Object.values(report.timings).every(value => Number.isFinite(value) && value >= 0));
  assert.ok(report.timings.total >= report.timings.ttfb);
  assert.doesNotMatch(result.stdout, /response body/);
});

test('readable output keeps the familiar field labels', async () => {
  const result = await run(baseUrl);
  assert.equal(result.code, 0, result.stderr);
  for (const label of ['DNS (ms)', 'TCP (ms)', 'SSL/TLS (ms)', 'Server Response (ms)', 'TTFB (ms)', 'Download (ms)', 'Total (ms)', 'HTTP Status', 'Remote IP', 'HTTP Version']) {
    assert.ok(result.stdout.includes(label), label);
  }
});

test('redirects are opt-in and report the final URL when followed', async () => {
  const initial = await run('--json', `${baseUrl}/redirect`);
  assert.equal(initial.code, 0, initial.stderr);
  assert.equal(JSON.parse(initial.stdout).httpStatus, 302);
  const followed = await run('-L', '--json', `${baseUrl}/redirect`);
  assert.equal(followed.code, 0, followed.stderr);
  const report = JSON.parse(followed.stdout);
  assert.equal(report.httpStatus, 200);
  assert.equal(report.redirects, 1);
  assert.equal(report.effectiveUrl, `${baseUrl}/`);
});

test('redirect loops and non-HTTP redirects fail', async () => {
  const loop = await run('-L', `${baseUrl}/loop`);
  assert.equal(loop.code, 47, loop.stderr);
  const blocked = await run('-L', `${baseUrl}/blocked-redirect`);
  assert.notEqual(blocked.code, 0);
  assert.match(blocked.stderr, /disabled|not supported/i);
});

test('headers are passed literally without a shell', async () => {
  const result = await run('--json', '-H', 'X-Test: space & ; $(not-a-command)', `${baseUrl}/headers`);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).httpStatus, 200);
});

test('HEAD and custom methods work', async () => {
  for (const option of ['-I', '--request=HEAD']) {
    const result = await run('--json', option, `${baseUrl}/head`);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).httpStatus, 200);
  }
  const custom = await run('--json', '-X', 'OPTIONS', `${baseUrl}/method`);
  assert.equal(custom.code, 0, custom.stderr);
  assert.equal(JSON.parse(custom.stdout).httpStatus, 204);
});

test('HTTP errors are reported normally unless --fail is requested', async () => {
  const result = await run('--json', `${baseUrl}/missing`);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).httpStatus, 404);
  const failed = await run('--fail', `${baseUrl}/missing`);
  assert.equal(failed.code, 22, failed.stderr);
  assert.equal(failed.stdout, '');
});

test('timeouts return curl exit code 28 on stderr', async () => {
  const result = await run('--timeout', '0.1', `${baseUrl}/slow`);
  assert.equal(result.code, 28, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /timed out|timeout/i);
});

test('help, version, and invalid arguments do not need a network request', async () => {
  assert.match((await run('--help')).stdout, /Usage: curltime/);
  assert.match((await run('--version')).stdout, /^\d+\.\d+\.\d+\s*$/);
  const invalid = await run('--timeout', '0', baseUrl);
  assert.equal(invalid.code, 2);
  assert.equal(invalid.stdout, '');
});
