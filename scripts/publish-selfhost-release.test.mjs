import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./publish-selfhost-release.mjs', import.meta.url));
const packages = {
  'windows-x64': ['Readest Setup.exe'],
  'windows-arm64': ['Readest Setup.exe'],
  'macos-universal': ['Readest.dmg'],
  'linux-x64': ['readest.deb', 'readest.rpm'],
  'linux-arm64': ['readest.deb', 'readest.rpm'],
  'android-apk': ['app-universal-debug.apk'],
};

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readest-release-'));
  fs.mkdirSync(path.join(root, 'apps/readest-app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'apps/readest-app/package.json'), '{"version":"0.12.16"}');
  for (const [platform, files] of Object.entries(packages)) {
    const dir = path.join(root, 'selfhost-artifacts', `readest-selfhost-${platform}`, 'nested');
    fs.mkdirSync(dir, { recursive: true });
    for (const file of files) fs.writeFileSync(path.join(dir, file), `${platform}/${file}`);
  }
  fs.mkdirSync(path.join(root, 'bin'));
  fs.writeFileSync(path.join(root, 'bin/gh'), `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync('gh-calls.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.env.FAIL_UPLOAD === '1') process.exit(1);
`);
  fs.chmodSync(path.join(root, 'bin/gh'), 0o755);
  return {
    root,
    run(extraEnv = {}) {
      return spawnSync(process.execPath, [script], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
          GITHUB_REPOSITORY: 'T0m-max/readest',
          SELFHOST_BUILD_SHA: 'a'.repeat(40),
          GITHUB_RUN_NUMBER: '3',
          GITHUB_RUN_ATTEMPT: '2',
          GITHUB_STEP_SUMMARY: path.join(root, 'summary.md'),
          ...extraEnv,
        },
      });
    },
    calls() {
      const file = path.join(root, 'gh-calls.jsonl');
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse) : [];
    },
    clean() { fs.rmSync(root, { recursive: true }); },
  };
}

test('publishes all six platforms from the pinned commit with unique assets and checksums', () => {
  const f = fixture();
  try {
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    const [create, publish] = f.calls();
    assert.deepEqual(create.slice(0, 3), ['release', 'create', 'selfhost-v0.12.16-3-2']);
    assert.equal(create[create.indexOf('--target') + 1], 'a'.repeat(40));
    assert.ok(create.includes('--draft'));
    assert.ok(create.includes('--prerelease'));
    assert.ok(create.includes('--latest=false'));
    assert.equal(create.filter(arg => /\.(exe|dmg|deb|rpm|apk)$/.test(arg)).length, 8);
    assert.ok(create.includes('release-assets/readest-selfhost-windows-x64-Readest-Setup.exe'));
    assert.ok(create.includes('release-assets/readest-selfhost-windows-arm64-Readest-Setup.exe'));
    for (const line of fs.readFileSync(path.join(f.root, 'release-assets/SHA256SUMS'), 'utf8').trim().split('\n')) {
      const [hash, name] = line.split('  ');
      assert.equal(hash, createHash('sha256').update(fs.readFileSync(path.join(f.root, 'release-assets', name))).digest('hex'));
    }
    assert.deepEqual(publish, ['release', 'edit', 'selfhost-v0.12.16-3-2', '--repo', 'T0m-max/readest', '--draft=false']);
    assert.match(fs.readFileSync(path.join(f.root, 'summary.md'), 'utf8'), /releases\/tag\/selfhost-v0.12.16-3-2/);
  } finally { f.clean(); }
});

test('does not create a release when a platform package is missing', () => {
  const f = fixture();
  try {
    fs.rmSync(path.join(f.root, 'selfhost-artifacts/readest-selfhost-linux-arm64'), { recursive: true });
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /readest-selfhost-linux-arm64/);
    assert.deepEqual(f.calls(), []);
  } finally { f.clean(); }
});

test('does not publish a partial draft when the asset upload fails', () => {
  const f = fixture();
  try {
    assert.notEqual(f.run({ FAIL_UPLOAD: '1' }).status, 0);
    assert.equal(f.calls().length, 1);
    assert.equal(f.calls()[0][1], 'create');
  } finally { f.clean(); }
});
