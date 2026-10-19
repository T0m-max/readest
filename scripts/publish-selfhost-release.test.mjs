import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./publish-selfhost-release.mjs', import.meta.url));
const validator = fileURLToPath(new URL('./validate-selfhost-build.mjs', import.meta.url));
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
if (process.argv[2] === 'api') console.log(process.env[process.argv[3].includes('/jobs?') ? 'MOCK_JOBS' : 'MOCK_RUN']);
if (process.argv[3] === 'view') console.log(JSON.stringify({ isDraft: process.env.PUBLIC_RELEASE !== '1', targetCommitish: process.env.DRAFT_COMMIT || 'a'.repeat(40) }));
`);
  fs.chmodSync(path.join(root, 'bin/gh'), 0o755);
  return {
    root,
    run(extraEnv = {}, scriptFile = script) {
      return spawnSync(process.execPath, [scriptFile], {
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
          GITHUB_OUTPUT: path.join(root, 'output.txt'),
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

test('losslessly compresses an APK at the 2 GiB limit before publishing', () => {
  const f = fixture();
  try {
    const apk = path.join(f.root, 'selfhost-artifacts/readest-selfhost-android-apk/nested/app-universal-debug.apk');
    fs.truncateSync(apk, 2 ** 31);
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    const archive = 'release-assets/readest-selfhost-android-apk-app-universal-debug.apk.zip';
    assert.ok(f.calls()[0].includes(archive), 'oversized APK must be uploaded as a ZIP');
    assert.ok(!f.calls()[0].some(arg => arg.endsWith('.apk')));
    assert.ok(fs.statSync(path.join(f.root, archive)).size < 2 ** 31);
    execFileSync('unzip', ['-t', archive], { cwd: f.root });
    assert.match(execFileSync('unzip', ['-l', archive], { cwd: f.root, encoding: 'utf8' }), /2147483648\s+.*app-universal-debug\.apk/);
    const sums = fs.readFileSync(path.join(f.root, 'release-assets/SHA256SUMS'), 'utf8');
    assert.match(sums, /app-universal-debug\.apk\.zip/);
  } finally { f.clean(); }
});

test('recovery validates the build source and refuses failed or missing platform jobs', () => {
  const run = {
    path: '.github/workflows/build-selfhost.yml',
    head_branch: 'feat/self-hosted-server',
    head_sha: 'a'.repeat(40),
    event: 'workflow_dispatch',
    status: 'completed',
  };
  const jobs = ['verify', 'android', ...Array.from({ length: 5 }, (_, i) => `desktop (${i})`)]
    .map(name => ({ name, conclusion: 'success' }));
  for (const variant of ['valid', 'wrong-branch', 'wrong-workflow', 'failed-platform', 'missing-platform']) {
    const f = fixture();
    try {
      const result = f.run({
        SELFHOST_ARTIFACT_RUN_ID: '39235930740',
        MOCK_RUN: JSON.stringify({ ...run,
          ...(variant === 'wrong-branch' ? { head_branch: 'main' } : {}),
          ...(variant === 'wrong-workflow' ? { path: '.github/workflows/release.yml' } : {}),
        }),
        MOCK_JOBS: JSON.stringify({ jobs: jobs
          .filter(job => variant !== 'missing-platform' || job.name !== 'android')
          .map(job => variant === 'failed-platform' && job.name === 'android' ? { ...job, conclusion: 'failure' } : job) }),
      }, validator);
      if (variant === 'valid') {
        assert.equal(result.status, 0, result.stderr);
        assert.equal(fs.readFileSync(path.join(f.root, 'output.txt'), 'utf8'), `commit=${'a'.repeat(40)}\n`);
      } else {
        assert.notEqual(result.status, 0, variant);
        assert.equal(fs.existsSync(path.join(f.root, 'output.txt')), false);
      }
    } finally { f.clean(); }
  }
});

test('recovery only uploads installers to the matching unpublished draft', () => {
  const f = fixture();
  try {
    const result = f.run({ SELFHOST_ARTIFACT_RUN_ID: '39235930740', SELFHOST_DRAFT_TAG: 'selfhost-v0.12.16-3-1' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(f.calls().map(call => call[1]), ['view', 'upload']);
    assert.equal(f.calls()[1][2], 'selfhost-v0.12.16-3-1');
    assert.ok(f.calls()[1].includes('--clobber'));
    assert.match(fs.readFileSync(path.join(f.root, 'release-assets/RELEASE_NOTES.md'), 'utf8'), /actions\/runs\/39235930740/);
  } finally { f.clean(); }
});

test('recovery refuses to overwrite a public release or a different source commit', () => {
  for (const extra of [{ PUBLIC_RELEASE: '1' }, { DRAFT_COMMIT: 'b'.repeat(40) }]) {
    const f = fixture();
    try {
      const result = f.run({ SELFHOST_ARTIFACT_RUN_ID: '39235930740', SELFHOST_DRAFT_TAG: 'selfhost-v0.12.16-3-1', ...extra });
      assert.notEqual(result.status, 0);
      assert.deepEqual(f.calls().map(call => call[1]), ['view']);
    } finally { f.clean(); }
  }
});
