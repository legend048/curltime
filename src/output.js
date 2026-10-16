import { terminalText } from './request.js';

export function resultExitCode(result) {
  if (result.mode !== 'benchmark') return result.checks?.passed === false ? 3 : 0;
  for (const target of result.results) {
    const error = target.samples.find(sample => sample.error)?.error;
    if (error) return error.exitCode;
  }
  return result.checks.passed ? 0 : 3;
}

export function formatBenchmark(result) {
  const headings = ['URL', 'Passed', 'HTTP (count)', 'Mean', 'P50', 'P95', 'Min', 'Max', 'Stddev'];
  const rows = result.results.map(target => {
    const stats = target.timings.total;
    const statuses = Object.entries(target.statusCodes).map(([code, count]) => `${code}(${count})`).join(', ') || '-';
    return [terminalText(target.url), `${target.passed}/${target.attempts}`, statuses,
      ...['mean', 'p50', 'p95', 'min', 'max', 'stddev'].map(key => stats ? stats[key].toFixed(2) : '-')];
  });
  const widths = headings.map((heading, column) => Math.max(heading.length, ...rows.map(row => row[column].length)));
  const formatRow = row => row.map((cell, column) => column ? cell.padStart(widths[column]) : cell.padEnd(widths[column])).join('  ');
  const lines = [
    `${result.repeat} measured request(s) per URL; ${result.warmup} warmup round(s). Total times in ms.`,
    '', formatRow(headings), widths.map(width => '-'.repeat(width)).join('  '), ...rows.map(formatRow),
    '', `Checks: ${result.checks.passed ? 'PASS' : 'FAIL'}`,
  ];
  if (result.results.length === 1 && result.results[0].completed > 0) {
    lines.push('', 'Phase                   Mean       P50       P95 (ms)');
    for (const [key, label] of [['dns', 'DNS'], ['tcp', 'TCP'], ['tls', 'SSL/TLS'],
      ['server', 'Server Response'], ['ttfb', 'TTFB'], ['download', 'Download']]) {
      const stats = result.results[0].timings[key];
      lines.push(`${label.padEnd(18)}${['mean', 'p50', 'p95'].map(stat => stats[stat].toFixed(2).padStart(10)).join('')}`);
    }
  }
  for (const target of result.results) {
    const failures = target.samples.filter(sample => sample.error || sample.report.checks?.passed === false);
    if (target.warmupFailures) lines.push(`  ${terminalText(target.url)}: ${target.warmupFailures} warmup transfer(s) failed (excluded).`);
    for (const sample of failures.slice(0, 5)) {
      const detail = sample.error?.message ?? sample.report.checks.failures.join(' ');
      lines.push(`  ${terminalText(target.url)} #${sample.iteration}: ${terminalText(detail)}`);
    }
    if (failures.length > 5) lines.push(`  ... ${failures.length - 5} more failed samples; use --json or --csv for all results.`);
  }
  return lines.join('\n');
}

export function formatCsv(result) {
  const columns = ['url', 'iteration', 'http_status', 'remote_ip', 'http_version',
    'dns_ms', 'tcp_ms', 'tls_ms', 'server_ms', 'ttfb_ms', 'download_ms', 'total_ms', 'passed', 'exit_code', 'error'];
  const samples = result.mode === 'benchmark'
    ? result.results.flatMap(target => target.samples.map(sample => ({ url: target.url, ...sample })))
    : [{ url: result.url, iteration: 1, report: result }];
  const rows = samples.map(({ url, iteration, report, error }) => [
    url, iteration, report?.httpStatus ?? '', report?.remoteIp ?? '', report?.httpVersion ?? '',
    ...['dns', 'tcp', 'tls', 'server', 'ttfb', 'download', 'total'].map(key => report?.timings[key] ?? ''),
    !error && report.checks?.passed !== false,
    error?.exitCode ?? resultExitCode(report),
    error?.message ?? report.checks?.failures.join(' ') ?? '',
  ]);
  const cell = value => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns, ...rows].map(row => row.map(cell).join(',')).join('\n');
}
