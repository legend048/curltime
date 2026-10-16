#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { parseArgs, help } from '../src/args.js';
import { benchmark, formatBenchmark, formatCsv, formatReport, measure, resultExitCode, terminalText } from '../src/index.js';

const controller = new AbortController();
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
  } else {
    const settings = { ...options, signal: controller.signal };
    const report = options.benchmark
      ? await benchmark(options.urls, settings)
      : await measure(options.url, settings);
    const output = options.json ? JSON.stringify(report, null, 2)
      : options.csv ? formatCsv(report)
        : options.benchmark ? formatBenchmark(report) : formatReport(report);
    if (options.output) {
      await writeFile(options.output, `${output}\n`, 'utf8');
      console.error(`Report written to ${terminalText(options.output)}`);
    } else {
      console.log(output);
    }
    process.exitCode = interruptedCode || resultExitCode(report);
  }
} catch (error) {
  console.error(`curltime: ${interruptedCode ? 'Interrupted.' : terminalText(error.message)}`);
  process.exitCode = interruptedCode || error.exitCode || 1;
}
