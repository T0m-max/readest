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
const artifactRun = process.env.SELFHOST_ARTIFACT_RUN_ID;
if (artifactRun) assert.match(artifactRun, /^\d+$/);
const tag = artifactRun ? process.env.SELFHOST_DRAFT_TAG : `selfhost-v${version}-${process.env.GITHUB_RUN_NUMBER}-${process.env.GITHUB_RUN_ATTEMPT}`;
assert.match(tag ?? '', /^selfhost-v[\w.-]+$/);
if (artifactRun) {
  const draft = JSON.parse(execFileSync('gh', [
    'release', 'view', tag, '--repo', repository, '--json', 'isDraft,targetCommitish',
  ], { encoding: 'utf8' }));
  assert.equal(draft.isDraft, true, 'Recovery requires an unpublished draft');
  assert.equal(draft.targetCommitish, commit, 'Draft must target the original build commit');
}
const assetSizeLimit = 2 ** 31;
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
    const oversized = fs.statSync(file).size >= assetSizeLimit;
    assert.ok(!oversized || file.endsWith('.apk'), `Release asset must be under 2 GiB: ${file}`);
    const name = `${artifact}-${path.basename(file).replace(/[^\w.-]/g, '-')}${oversized ? '.zip' : ''}`;
    const destination = path.join(staging, name);
    assert.ok(!fs.existsSync(destination), `Duplicate release asset: ${name}`);
    if (oversized) {
      // Preserve the APK bytes and signature while meeting GitHub's asset limit.
      execFileSync('zip', ['-q', '-j', destination, file], { stdio: 'inherit' });
    } else {
      fs.copyFileSync(file, destination);
    }
    assert.ok(fs.statSync(destination).size < assetSizeLimit, `Release asset must be under 2 GiB: ${name}`);
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
  ...(artifactRun ? [`Original build: https://github.com/${repository}/actions/runs/${artifactRun}`] : []),
  '',
  'Download the installer for your platform below. If the APK is provided as .apk.zip, extract it before installation; its signature is unchanged.',
  'Desktop packages are unsigned. Android uses a debug signature unless release-signing secrets are configured.',
  'Automatic updates are disabled. SHA256SUMS contains the checksums of all installers.',
  '',
].join('\n'));

// Keep the release private until every installer has finished uploading.
if (artifactRun) {
  // Older builds can contain workflows differing from main. Uploading to the
  // existing draft works with GITHUB_TOKEN; publishing it uses the owner's UI.
  execFileSync('gh', ['release', 'upload', tag, '--repo', repository, '--clobber', ...assets], { stdio: 'inherit' });
} else {
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
}

const url = `https://github.com/${repository}/releases/tag/${tag}`;
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, artifactRun
    ? `Installers uploaded to draft \`${tag}\`. Review the assets and publish it from GitHub Releases.\n`
    : `[Download Readest Selfhost](${url})\n`);
}
console.log(url);
