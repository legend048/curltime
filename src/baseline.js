import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { buildCurlArgs, CurlTimeError, normalizeUrl, terminalText } from './request.js';

/** Call with prepared request options so body files are hashed by their bytes. */
export function requestFingerprint(options = {}) {
  if (options.dataFile !== undefined) throw new CurlTimeError('Prepare the body file before creating a baseline fingerprint.', 2);
  const args = buildCurlArgs('https://curltime.invalid/', options);
  args[args.indexOf('--output') + 1] = '<discard>'; // Same fingerprint on every OS.
  const body = options.data ?? options.jsonBody;
  const bodyHash = body === undefined ? null : createHash('sha256').update(body).digest('hex');
  return createHash('sha256').update(JSON.stringify({ args, bodyHash })).digest('hex');
}

export function validateBaseline(baseline, urls, requestHash) {
  const invalid = () => { throw new CurlTimeError('Invalid baseline. Create one with --save-baseline using curltime 1.2 or later.', 2); };
  if (!baseline || baseline.kind !== 'curltime-baseline' || baseline.version !== 1 || baseline.unit !== 'ms' ||
      !/^[a-f0-9]{64}$/.test(baseline.requestHash ?? '') || !Array.isArray(baseline.targets) ||
      !baseline.targets.length || baseline.targets.length > 50) invalid();
  const seen = new Set();
  for (const target of baseline.targets) {
    if (!target || typeof target.url !== 'string' || normalizeUrl(target.url) !== target.url || seen.has(target.url) ||
        !Number.isInteger(target.samples) || target.samples < 1 || target.samples > 1000 ||
        typeof target.p95TotalMs !== 'number' || !Number.isFinite(target.p95TotalMs) || target.p95TotalMs < 0) invalid();
    seen.add(target.url);
  }
  if (requestHash !== undefined && baseline.requestHash !== requestHash) {
    throw new CurlTimeError('Baseline request settings differ. Use the same method, headers, body, redirects, and timeouts as the saved run.', 2);
  }
  if (urls !== undefined && (urls.length !== seen.size || new Set(urls).size !== urls.length || urls.some(url => !seen.has(url)))) {
    throw new CurlTimeError('Baseline URLs differ. Provide the same set of URLs as the saved run.', 2);
  }
  return baseline;
}

export async function readBaseline(path, urls, requestHash) {
  let baseline;
  try {
    baseline = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new CurlTimeError(`Cannot read baseline: ${path} (${error.code || 'invalid JSON'}).`, 2, { cause: error });
  }
  return validateBaseline(baseline, urls, requestHash);
}

export function createBaseline(report, requestHash) {
  if (report.mode !== 'benchmark' || !report.checks.passed || report.results.some(target => target.failed || !target.completed)) {
    throw new CurlTimeError('Only a benchmark with all checks passing can become a baseline.', 3);
  }
  return validateBaseline({
    kind: 'curltime-baseline', version: 1, unit: 'ms', createdAt: new Date().toISOString(), requestHash,
    repeat: report.repeat, warmup: report.warmup,
    targets: report.results.map(target => ({ url: target.url, samples: target.completed, p95TotalMs: target.timings.total.p95 })),
  });
}

export async function saveBaseline(path, baseline) {
  validateBaseline(baseline);
  try {
    await writeFile(path, `${JSON.stringify(baseline, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    throw new CurlTimeError(error.code === 'EEXIST' ? `Baseline already exists: ${path}. Choose a new path to preserve your reference.`
      : `Cannot save baseline: ${path} (${error.code || error.message}).`, 2, { cause: error });
  }
}

export function compareBaseline(report, baseline, maxRegression = 20) {
  if (report.mode !== 'benchmark') throw new CurlTimeError('Baseline comparisons require a benchmark.', 2);
  validateBaseline(baseline, report.results.map(target => target.url));
  if (typeof maxRegression !== 'number' || !Number.isFinite(maxRegression) || maxRegression < 0) {
    throw new CurlTimeError('The regression limit must be a non-negative percentage.', 2);
  }
  const targets = report.results.map(target => {
    const reference = baseline.targets.find(entry => entry.url === target.url);
    const previous = reference.p95TotalMs;
    const current = target.timings.total?.p95 ?? null;
    const limit = previous + previous * (maxRegression / 100);
    const changePercent = current === null || previous === 0 ? null : Math.round((current - previous) / previous * 10000) / 100;
    return { url: target.url, baselineSamples: reference.samples, currentSamples: target.completed,
      baselineP95: previous, currentP95: current, changePercent,
      passed: target.failed === 0 && current !== null && current <= limit };
  });
  return { metric: 'total.p95', maxRegression, targets, passed: targets.every(target => target.passed) };
}

export function formatBaselineComparison(comparison) {
  const lines = [`Baseline: total P95, allowed increase ${comparison.maxRegression}% (${comparison.passed ? 'PASS' : 'FAIL'})`];
  for (const target of comparison.targets) {
    const change = target.changePercent === null ? 'n/a' : `${target.changePercent >= 0 ? '+' : ''}${target.changePercent}%`;
    lines.push(`  ${target.passed ? 'PASS' : 'FAIL'} ${terminalText(target.url)}  ${target.baselineP95.toFixed(2)} -> ${target.currentP95?.toFixed(2) ?? '-'} ms (${change})  samples=${target.baselineSamples}/${target.currentSamples}`);
  }
  return lines.join('\n');
}
