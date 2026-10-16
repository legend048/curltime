#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { parseArgs, help } from '../src/args.js';
import { formatReport, measure, terminalText } from '../src/index.js';

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(help);
  } else if (options.version) {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    console.log(version);
  } else {
    const report = await measure(options.url, options);
    console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
  }
} catch (error) {
  console.error(`curltime: ${terminalText(error.message)}`);
  process.exitCode = error.exitCode || 1;
}
