#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import { parseArgs, help } from '../src/args.js';
import { benchmark, formatBenchmark, formatCsv, formatReport, measure, resultExitCode, terminalText,
  watch, formatWatchEvent, formatWatchCsv, initConfig,
  requestFingerprint, readBaseline, createBaseline, saveBaseline, compareBaseline, formatBaselineComparison } from '../src/index.js';
import { prepareRequest } from '../src/request.js';
import { validateFileDestinations } from '../src/files.js';

const controller = new AbortController();
process.stdout.on('error', error => {
  // A downstream consumer such as `head` may finish before a live monitor does.
  controller.abort();
  process.exitCode = error.code === 'EPIPE' ? 0 : 1;
});
let interruptedCode;
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => {
    interruptedCode = code;
    controller.abort();
  });
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(help);
  } else if (options.version) {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(version);
  } else if (options.init) {
    const path = await initConfig(options.config);
    console.log(`Created ${terminalText(path)}. Edit its URLs, then run curltime --config "${terminalText(path)}".`);
  } else {
    await validateFileDestinations(options);
    const settings = await prepareRequest({ ...options, signal: controller.signal });
    if (options.watch) {
      const file = options.output ? await open(options.output, 'w') : null;
      let first = true;
      try {
        const summary = await watch(options.urls, { ...settings, onEvent: async event => {
          if (options.csv && event.type === 'summary') {
            console.error(formatWatchEvent(event));
            return;
          }
          const output = options.json ? JSON.stringify(event)
            : options.csv ? formatWatchCsv(event, first) : formatWatchEvent(event);
          first = false;
          if (file) await file.writeFile(`${output}\n`, 'utf8');
          else await new Promise((resolve, reject) => process.stdout.write(`${output}\n`, error => error ? reject(error) : resolve()));
        } });
        process.exitCode = interruptedCode || resultExitCode(summary);
      } finally {
        await file?.close();
      }
      if (options.output) console.error(`Report written to ${terminalText(options.output)}`);
    } else {
      const fingerprint = options.baseline || options.saveBaseline ? requestFingerprint(settings) : undefined;
      const baseline = options.baseline ? await readBaseline(options.baseline, options.urls, fingerprint) : undefined;
      const report = options.benchmark
        ? await benchmark(options.urls, settings)
        : await measure(options.url, settings);
      if (baseline) {
        report.comparison = compareBaseline(report, baseline, options.maxRegression);
        report.checks.passed &&= report.comparison.passed;
      }
      const output = options.json ? JSON.stringify(report, null, 2)
        : options.csv ? formatCsv(report)
          : options.benchmark ? formatBenchmark(report) + (report.comparison ? `\n\n${formatBaselineComparison(report.comparison)}` : '') : formatReport(report);
      if (options.output) {
        await writeFile(options.output, `${output}\n`, 'utf8');
        console.error(`Report written to ${terminalText(options.output)}`);
      } else {
        console.log(output);
      }
      if (options.csv && report.comparison) console.error(formatBaselineComparison(report.comparison));
      process.exitCode = interruptedCode || resultExitCode(report);
      if (options.saveBaseline) {
        if (report.checks.passed) {
          await saveBaseline(options.saveBaseline, createBaseline(report, fingerprint));
          console.error(`Baseline saved to ${terminalText(options.saveBaseline)}`);
        } else {
          console.error('Baseline was not saved because the benchmark failed.');
        }
      }
    }
  }
} catch (error) {
  if (error.code === 'EPIPE') {
    process.exitCode = 0;
  } else {
    console.error(`curltime: ${interruptedCode ? 'Interrupted.' : terminalText(error.message)}`);
    process.exitCode = interruptedCode || error.exitCode || 1;
  }
}
