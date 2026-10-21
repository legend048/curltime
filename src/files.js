import { realpath, stat } from 'node:fs/promises';
import { dirname, basename, resolve } from 'node:path';
import { CurlTimeError } from './request.js';

async function canonical(path) {
  const absolute = resolve(path);
  let result;
  try {
    result = await realpath(absolute);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    result = dirname(absolute) === absolute ? absolute : resolve(await canonical(dirname(absolute)), basename(absolute));
  }
  return process.platform === 'win32' ? result.toLowerCase() : result;
}

/** Protect input files from accidental output truncation, including symlink aliases. */
export async function validateFileDestinations(options) {
  const inputs = ['config', 'dataFile', 'baseline'].filter(key => options[key]).map(key => options[key]);
  const destinations = ['output', 'saveBaseline'].filter(key => options[key]).map(key => options[key]);
  const seen = new Set(await Promise.all(inputs.map(canonical)));
  for (const path of destinations) {
    const key = await canonical(path);
    if (seen.has(key)) throw new CurlTimeError('Report and baseline destinations must differ from each other and from input files.', 2);
    seen.add(key);
  }
  if (options.saveBaseline) {
    try {
      await stat(options.saveBaseline);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    throw new CurlTimeError(`Baseline already exists: ${options.saveBaseline}. Choose a new path to preserve your reference.`, 2);
  }
}
