# Contributing

Install Node.js 22+ and curl 7.70+, then:

```sh
git clone https://github.com/legend048/curltime.git
cd curltime
npm ci
npm test
node bin/curltime.js https://example.com
```

There is no build step and no npm dependency to install. `npm ci` validates the
lockfile. To try the command globally from your checkout, run `npm link`.
Unlink it with `npm uninstall --global curltime` when finished.

The CLI is in `bin/curltime.js`, argument parsing in `src/args.js`, and curl
execution, request bodies, and checks in `src/request.js`. `src/benchmark.js`
handles rounds and statistics, `src/output.js` formats exports, and `src/index.js`
exports the public API. Tests use Node's built-in
test runner and a local HTTP server, so they do not need an internet connection.
The real curl executable must be available.

Keep errors on stderr and JSON reports free of extra text. Preserve curl's exit
codes, avoid invoking a shell, and document any change to CLI options or JSON
fields. Add a regression test when fixing a bug, update `CHANGELOG.md`, and open
a pull request against `main`. CI tests Windows, macOS, and Linux on Node 22/24.

When reporting a bug, include your operating system, Node version, curl version,
the command, and the output. Remove credentials or sensitive URLs from examples.
