import { setTimeout as delay } from 'node:timers/promises';
import { CurlTimeError, measure, normalizeUrl, prepareRequest } from './request.js';

export function validateBenchmarkOptions(options = {}) {
  const integer = (value, name, min, max) => {
    if (!['string', 'number'].includes(typeof value) || !/^(0|[1-9]\d*)$/.test(String(value)) || !Number.isSafeInteger(Number(value)) ||
        Number(value) < min || Number(value) > max) {
      throw new CurlTimeError(`${name} must be an integer from ${min} to ${max}.`, 2);
    }
    return Number(value);
  };
  const repeat = integer(options.repeat ?? 1, '--repeat', 1, 1000);
  const warmup = integer(options.warmup ?? 0, '--warmup', 0, 1000);
  const interval = options.interval ?? 0;
  if (!['string', 'number'].includes(typeof interval) || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(interval)) ||
      !Number.isFinite(Number(interval)) || Number(interval) < 0 || Number(interval) > 3600) {
    throw new CurlTimeError('--interval must be a number from 0 to 3600 seconds.', 2);
  }
  return { ...options, repeat, warmup, interval: Number(interval) };
}

/** Percentiles use linear interpolation; stddev is the population deviation. */
export function summarize(values) {
  if (!values.length) return null;
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
    throw new CurlTimeError('Timings must be finite, non-negative numbers.');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const round = value => Math.round(value * 100) / 100;
  const percentile = fraction => {
    const index = (sorted.length - 1) * fraction;
    const lower = Math.floor(index);
    return round(sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower));
  };
  return {
    min: round(sorted[0]), mean: round(mean), p50: percentile(0.5), p95: percentile(0.95), max: round(sorted.at(-1)),
    stddev: round(Math.sqrt(sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length)),
  };
}

export async function benchmark(urls, options = {}) {
  const targets = typeof urls === 'string' ? [urls] : urls;
  if (!Array.isArray(targets) || !targets.length || targets.length > 50) {
    throw new CurlTimeError('Provide between 1 and 50 URLs.', 2);
  }
  // Validate every target and read any body file before the first request.
  const normalized = targets.map(normalizeUrl);
  const settings = await prepareRequest(validateBenchmarkOptions(options));
  const results = normalized.map(url => ({ url, warmupFailures: 0, samples: [] }));
  const rounds = settings.warmup + settings.repeat;

  for (let round = 0; round < rounds; round++) {
    if (round > 0 && settings.interval > 0) {
      await delay(settings.interval * 1000, undefined, { signal: settings.signal });
    }
    for (const result of results) {
      settings.signal?.throwIfAborted();
      const warming = round < settings.warmup;
      try {
        const report = await measure(result.url, settings);
        if (!warming) result.samples.push({ iteration: round - settings.warmup + 1, report });
      } catch (error) {
        if (settings.signal?.aborted) throw error;
        // Local setup errors cannot improve with another sample.
        if (!error.isTransferError || error.exitCode === 2) throw error;
        if (warming) result.warmupFailures++;
        else result.samples.push({ iteration: round - settings.warmup + 1, error: { message: error.message, exitCode: error.exitCode || 1 } });
      }
    }
  }

  for (const result of results) {
    const reports = result.samples.filter(sample => sample.report).map(sample => sample.report);
    result.attempts = result.samples.length;
    result.completed = reports.length;
    result.passed = reports.filter(report => report.checks?.passed !== false).length;
    result.failed = result.attempts - result.passed;
    result.statusCodes = {};
    for (const report of reports) result.statusCodes[report.httpStatus] = (result.statusCodes[report.httpStatus] ?? 0) + 1;
    result.timings = Object.fromEntries(['dns', 'tcp', 'tls', 'server', 'ttfb', 'download', 'total']
      .map(key => [key, summarize(reports.map(report => report.timings[key]))]));
  }

  return {
    mode: 'benchmark', unit: 'ms', repeat: settings.repeat, warmup: settings.warmup,
    results, checks: { passed: results.every(result => result.failed === 0) },
  };
}
