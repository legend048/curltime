import { setTimeout as delay } from 'node:timers/promises';
import { CurlTimeError, measure, normalizeUrl, prepareRequest, terminalText, validateOptions } from './request.js';
import { validateBenchmarkOptions } from './benchmark.js';

export function validateWatchOptions(options = {}) {
  if (options.baseline || options.saveBaseline || options.maxRegression !== undefined) {
    throw new CurlTimeError('Baseline comparisons use benchmarks; remove --watch.', 2);
  }
  const settings = validateBenchmarkOptions(validateOptions({ ...options, interval: options.interval ?? 5, expectStatus: options.expectStatus ?? '2xx' }));
  if (settings.warmup) throw new CurlTimeError('--watch does not use warmups; remove --warmup.', 2);
  if (settings.interval < 0.1) throw new CurlTimeError('--watch requires an interval of at least 0.1 seconds.', 2);
  return { ...settings, repeat: options.repeat === undefined ? undefined : settings.repeat };
}

/** Stream events with backpressure. Keep constant memory per target, even on long runs. */
export async function watch(urls, options = {}) {
  const targets = typeof urls === 'string' ? [urls] : urls;
  if (!Array.isArray(targets) || !targets.length || targets.length > 50) throw new CurlTimeError('Provide between 1 and 50 URLs.', 2);
  const normalized = targets.map(normalizeUrl);
  const settings = await prepareRequest(validateWatchOptions(options));
  if (options.onEvent !== undefined && typeof options.onEvent !== 'function') throw new CurlTimeError('onEvent must be a function.', 2);
  const emit = async event => { await options.onEvent?.(event); };
  const startedAt = new Date().toISOString();
  const results = normalized.map(url => ({ url, attempts: 0, completed: 0, passed: 0, failed: 0,
    outages: 0, recoveries: 0, state: 'UNKNOWN', meanTotal: null, minTotal: null, maxTotal: null }));
  let rounds = 0;
  let exitCode = 0;
  let transferExitCode;
  monitoring: for (let round = 1; settings.repeat === undefined || round <= settings.repeat; round++) {
    if (round > 1) {
      try {
        await delay(settings.interval * 1000, undefined, { signal: settings.signal });
      } catch (error) {
        if (settings.signal?.aborted) break monitoring;
        throw error;
      }
    }
    for (const target of results) {
      let report;
      let error;
      try {
        settings.signal?.throwIfAborted();
        report = await measure(target.url, settings);
      } catch (failure) {
        if (settings.signal?.aborted) break monitoring;
        if (!failure.isTransferError || failure.exitCode === 2) throw failure;
        error = { message: failure.message, exitCode: failure.exitCode };
      }
      const passed = !error && report.checks.passed;
      const previous = target.state;
      const state = passed ? 'UP' : 'DOWN';
      const transition = previous === 'DOWN' && passed ? 'RECOVERED'
        : previous === 'UP' && !passed ? 'FAILED' : previous === 'UNKNOWN' ? state : null;
      if (!passed && previous !== 'DOWN') target.outages++;
      if (transition === 'RECOVERED') target.recoveries++;
      target.state = state;
      target.attempts++;
      target[passed ? 'passed' : 'failed']++;
      if (report) {
        target.completed++;
        const total = report.timings.total;
        target.meanTotal = (target.meanTotal ?? 0) + (total - (target.meanTotal ?? 0)) / target.completed;
        target.minTotal = target.minTotal === null ? total : Math.min(target.minTotal, total);
        target.maxTotal = target.maxTotal === null ? total : Math.max(target.maxTotal, total);
      }
      if (error) transferExitCode ??= error.exitCode;
      if (!passed) exitCode = 3;
      await emit({ type: 'sample', timestamp: new Date().toISOString(), round, url: target.url,
        state, transition, ...(error ? { error } : { report }) });
    }
    rounds = round;
  }
  const summary = {
    type: 'summary', mode: 'watch', unit: 'ms', startedAt, endedAt: new Date().toISOString(),
    rounds, interrupted: Boolean(settings.signal?.aborted), exitCode: transferExitCode ?? exitCode,
    results: results.map(target => ({ ...target, meanTotal: target.meanTotal === null ? null : Math.round(target.meanTotal * 100) / 100,
      availability: target.attempts ? Math.round(target.passed / target.attempts * 10000) / 100 : null })),
    checks: { passed: results.every(target => target.failed === 0) },
  };
  await emit(summary);
  return summary;
}

export function formatWatchEvent(event) {
  if (event.type === 'summary') {
    const lines = [`Monitoring ${event.interrupted ? 'stopped' : 'finished'} after ${event.rounds} complete round(s).`];
    for (const target of event.results) {
      lines.push(`${terminalText(target.url)}  ${target.state}  ${target.passed}/${target.attempts} checks passed (${target.availability ?? '-'}%)  outages=${target.outages} recoveries=${target.recoveries}  mean=${target.meanTotal ?? '-'} ms`);
    }
    return lines.join('\n');
  }
  const detail = event.error?.message ?? `HTTP ${event.report.httpStatus}  total=${event.report.timings.total.toFixed(2)} ms  TTFB=${event.report.timings.ttfb.toFixed(2)} ms${event.report.checks.failures.length ? `  ${event.report.checks.failures.join(' ')}` : ''}`;
  return `${event.timestamp}  ${(event.transition || event.state).padEnd(9)} #${event.round}  ${terminalText(event.url)}  ${terminalText(detail)}`;
}
