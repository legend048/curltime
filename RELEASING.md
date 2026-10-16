# Publishing and releasing curltime

The repository, npm package, and executable are named `curltime`. The package
is public and MIT licensed. `dist/curltime-<version>.tgz` is an installable file
that can be shared even before npm publication.

## First npm publication

The maintainer needs an npm account allowed to publish the `curltime` name. A
registry lookup found that name unclaimed during setup; npm decides availability
at publication time.

From the repository root:

```sh
npm login --registry=https://registry.npmjs.org
npm whoami
npm ci
npm test
npm pack --dry-run
npm publish --access public
```

Complete any npm browser sign-in or two-factor authentication prompt yourself.
Do not commit npm tokens or put them in issue reports. `publishConfig` points
publication at the public npm registry.

Verify the listing with `npm view curltime version` and test it in a fresh
terminal with `npx curltime@latest --version`. The public listing is
https://www.npmjs.com/package/curltime. After the first publication, simplify
the README's installation section to lead with `npm install --global curltime`.

## Set up automatic npm publishing

The `Publish to npm` GitHub Actions workflow uses npm trusted publishing, which
exchanges GitHub's identity for short-lived credentials. It does not require an
`NPM_TOKEN` repository secret. Configure it after the first npm publication:

1. Open the npm package's **Settings**, then **Trusted Publisher**.
2. Select **GitHub Actions**.
3. Set owner to `legend048`, repository to `curltime`, and workflow filename to
   `publish.yml`. Leave the environment name empty; this workflow does not use one.
4. Save the publisher settings. Keep npm account two-factor authentication enabled.

To publish the already-created first tag after setup, run **Actions > Publish
to npm > Run workflow**, choose `main`, and enter `v1.0.0`. Skip this if 1.0.0
was already published manually: npm versions cannot be overwritten.

Later, publishing a GitHub release triggers the workflow automatically. The
release pipeline tests all three operating systems. The publishing workflow
checks that the tag matches `package.json`, runs the tests on Linux, and
publishes with npm provenance. If trusted publishing has
not been configured, npm publishing will fail; GitHub release downloads remain
usable. See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

## Release an update

1. Merge the change to `main` and let CI pass.
2. Add release notes to `CHANGELOG.md` and commit them.
3. Bump the version and create the tag:

   ```sh
   npm version patch
   git push origin main --follow-tags
   ```

   Use `minor` for compatible features or `major` for breaking changes.
   `npm version` updates both manifests and creates a version commit and tag.

4. The `Package release` workflow tests, packs, and creates a **draft** GitHub
   release with the `.tgz` attached. Review the draft and publish it in GitHub.
5. Publishing that release starts `Publish to npm`, once trusted publishing is
   configured. Verify the published version using `npm view curltime version`.

Users update with `npm install --global curltime@latest`. Offline users install
the new `.tgz`. To share a local package manually, run:

```sh
npm test
npm pack --pack-destination dist
```

Create the `dist` directory first if it does not exist. The npm `files` allowlist
includes only runtime code, package metadata, README, and license. Tests,
workflows, local npm configuration, and environment files are excluded.
