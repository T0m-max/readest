import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const repository = process.env.GITHUB_REPOSITORY;
const commit = process.env.SELFHOST_BUILD_SHA ?? '';
assert.equal(repository, 'T0m-max/readest');
assert.match(commit, /^[a-f0-9]{40}$/);
assert.match(process.env.GITHUB_RUN_NUMBER ?? '', /^\d+$/);
assert.match(process.env.GITHUB_RUN_ATTEMPT ?? '', /^\d+$/);
const { version } = JSON.parse(fs.readFileSync('apps/readest-app/package.json', 'utf8'));
const tag = `selfhost-v${version}-${process.env.GITHUB_RUN_NUMBER}-${process.env.GITHUB_RUN_ATTEMPT}`;
const requiredPackages = {
  'windows-x64': ['.exe'],
  'windows-arm64': ['.exe'],
  'macos-universal': ['.dmg'],
  'linux-x64': ['.deb', '.rpm'],
  'linux-arm64': ['.deb', '.rpm'],
  'android-apk': ['.apk'],
};
const staging = 'release-assets';
fs.mkdirSync(staging);
const assets = [];
const checksums = [];

for (const [platform, extensions] of Object.entries(requiredPackages)) {
  const artifact = `readest-selfhost-${platform}`;
  const root = path.join('selfhost-artifacts', artifact);
  const files = fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && extensions.includes(path.extname(entry.name)))
    .map(entry => path.join(entry.parentPath, entry.name))
    .sort();
  for (const extension of extensions) {
    assert.ok(files.some(file => file.endsWith(extension)), `${artifact} is missing ${extension}`);
  }
  for (const file of files) {
    const name = `${artifact}-${path.basename(file).replace(/[^\w.-]/g, '-')}`;
    const destination = path.join(staging, name);
    assert.ok(!fs.existsSync(destination), `Duplicate release asset: ${name}`);
    fs.copyFileSync(file, destination);
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(destination)) hash.update(chunk);
    checksums.push(`${hash.digest('hex')}  ${name}`);
    assets.push(destination);
  }
}

const checksumFile = path.join(staging, 'SHA256SUMS');
fs.writeFileSync(checksumFile, `${checksums.join('\n')}\n`);
assets.push(checksumFile);
const notesFile = path.join(staging, 'RELEASE_NOTES.md');
fs.writeFileSync(notesFile, [
  'Self-hosted client build from `feat/self-hosted-server`.',
  `Source commit: \`${commit}\`.`,
  '',
  'Download the installer for your platform below; the APK can be downloaded directly.',
  'Desktop packages are unsigned. Android uses a debug signature unless release-signing secrets are configured.',
  'Automatic updates are disabled. SHA256SUMS contains the checksums of all installers.',
  '',
].join('\n'));

// Keep the release private until every installer has finished uploading.
execFileSync('gh', [
  'release', 'create', tag,
  '--repo', repository,
  '--target', commit,
  '--title', `Readest Selfhost ${version} (build ${process.env.GITHUB_RUN_NUMBER}.${process.env.GITHUB_RUN_ATTEMPT})`,
  '--notes-file', notesFile,
  '--draft', '--prerelease', '--latest=false',
  ...assets,
], { stdio: 'inherit' });
execFileSync('gh', [
  'release', 'edit', tag, '--repo', repository, '--draft=false',
], { stdio: 'inherit' });

const url = `https://github.com/${repository}/releases/tag/${tag}`;
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `[Download Readest Selfhost](${url})\n`);
}
console.log(url);
