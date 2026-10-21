import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CurlTimeError } from './request.js';

const booleanKeys = ['follow', 'head', 'fail', 'json', 'csv', 'watch'];
const numberKeys = ['timeout', 'connectTimeout', 'repeat', 'warmup', 'interval', 'maxTotal', 'maxTtfb', 'maxRegression'];
const stringKeys = ['method', 'data', 'dataFile', 'jsonBody', 'output', 'baseline', 'saveBaseline'];
const allowed = new Set([...booleanKeys, ...numberKeys, ...stringKeys, 'headers', 'expectStatus']);

/** Explicit JSON only. CLI options replace corresponding config options. */
export function loadConfig(path, environment = process.env) {
  let config;
  try {
    const text = readFileSync(path, 'utf8');
    config = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new CurlTimeError(`Cannot read JSON config: ${path} (${error.code || 'invalid JSON'}).`, 2, { cause: error });
  }
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(config) || config.version !== 1 || Object.keys(config).some(key => !['$schema', 'version', 'urls', 'options'].includes(key))) {
    throw new CurlTimeError('Config must have version: 1 and only $schema, version, urls, and options fields.', 2);
  }
  if (!Array.isArray(config.urls) || !config.urls.length || config.urls.length > 50 || config.urls.some(url => typeof url !== 'string')) {
    throw new CurlTimeError('Config urls must contain between 1 and 50 URL strings.', 2);
  }
  if (config.$schema !== undefined && typeof config.$schema !== 'string') throw new CurlTimeError('Config $schema must be a string.', 2);
  const options = config.options === undefined ? {} : config.options;
  if (!object(options)) throw new CurlTimeError('Config options must be an object.', 2);
  for (const [key, value] of Object.entries(options)) {
    if (!allowed.has(key)) throw new CurlTimeError(`Unknown config option: ${key}. Run curltime --help.`, 2);
    const valid = booleanKeys.includes(key) ? typeof value === 'boolean'
      : numberKeys.includes(key) ? typeof value === 'number' && Number.isFinite(value)
        : stringKeys.includes(key) ? typeof value === 'string'
          : key === 'headers' ? Array.isArray(value) && value.every(header => typeof header === 'string')
            : typeof value === 'string' || typeof value === 'number';
    if (!valid) throw new CurlTimeError(`Invalid type for config option: ${key}.`, 2);
  }
  // Interpolate once; values from the environment are never evaluated as code.
  const expand = value => typeof value === 'string' ? value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
    if (environment[name] === undefined) throw new CurlTimeError(`Config requires environment variable ${name}.`, 2);
    return environment[name];
  }) : value;
  const expanded = Object.fromEntries(Object.entries(options).map(([key, value]) =>
    [key, Array.isArray(value) ? value.map(expand) : expand(value)]));
  for (const key of ['dataFile', 'output', 'baseline', 'saveBaseline']) {
    if (expanded[key] !== undefined) {
      if (!expanded[key].trim()) throw new CurlTimeError(`Config ${key} requires a file path.`, 2);
      expanded[key] = resolve(dirname(resolve(path)), expanded[key]);
    }
  }
  return { urls: config.urls.map(expand), options: expanded };
}

export async function initConfig(path = 'curltime.config.json') {
  const config = {
    $schema: 'https://raw.githubusercontent.com/legend048/curltime/main/schema/curltime.schema.json',
    version: 1,
    urls: ['https://example.com'],
    options: { expectStatus: '2xx', maxTotal: 1000, timeout: 10 },
  };
  try {
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    throw new CurlTimeError(error.code === 'EEXIST' ? `Config already exists: ${path}. Choose a different --config path.`
      : `Cannot create config: ${path} (${error.code || error.message}).`, 2, { cause: error });
  }
  return path;
}
