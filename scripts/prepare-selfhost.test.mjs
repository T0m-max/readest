import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// Exercise on a disposable fixture so tests never patch the developer's checkout.
test('prepares independent native identity, update URLs and Android sources', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readest-selfhost-'));
  try {
    const app = path.join(root, 'apps/readest-app');
    const write = (file, data) => {
      const full = path.join(app, file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, data);
    };
    write('scripts/prepare-selfhost.mjs', fs.readFileSync('apps/readest-app/scripts/prepare-selfhost.mjs'));
    write('src-tauri/tauri.conf.json', fs.readFileSync('apps/readest-app/src-tauri/tauri.conf.json'));
    write('src-tauri/src/lib.rs', 'const SINGLE_INSTANCE_DBUS_ID: &str = "com.bilingify.readest";');
    write('.env.tauri', 'DBUS_ID=com.bilingify.readest\n');
    write('src-tauri/gen/android/app/build.gradle.kts', 'namespace = "com.bilingify.readest"');
    write('src-tauri/gen/android/app/src/main/java/com/bilingify/readest/MainActivity.kt', 'package com.bilingify.readest');
    const script = path.join(app, 'scripts/prepare-selfhost.mjs');
    execFileSync(process.execPath, [script, '--android']);
    const conf = JSON.parse(fs.readFileSync(path.join(app, 'src-tauri/tauri.conf.json')));
    assert.equal(conf.identifier, 'io.github.t0mmax.readest');
    assert.equal(conf.bundle.createUpdaterArtifacts, false);
    assert.deepEqual(conf.plugins['deep-link'].desktop.schemes, ['readest-selfhost']);
    assert.equal(conf.plugins.updater.pubkey, '');
    assert.match(conf.plugins.updater.endpoints[0], /github.com\/T0m-max\/readest/);
    assert.equal(conf.build.beforeBuildCommand, 'pnpm build');
    assert.match(fs.readFileSync(path.join(app, '.env.tauri'), 'utf8'), /NEXT_PUBLIC_DISABLE_UPDATER=true/);
    assert.equal(fs.existsSync(path.join(app, 'src-tauri/gen/android/app/src/main/java/com/bilingify/readest')), false);
    assert.match(fs.readFileSync(path.join(app, 'src-tauri/gen/android/app/src/main/java/io/github/t0mmax/readest/MainActivity.kt'), 'utf8'), /package io.github.t0mmax.readest/);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test('Android workflow relocates Java before Tauri init and restores upstream app sources', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readest-android-init-'));
  try {
    const app = path.join(root, 'apps/readest-app');
    const write = (file, data) => {
      const full = path.join(app, file);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, data);
    };
    write('scripts/prepare-selfhost.mjs', fs.readFileSync('apps/readest-app/scripts/prepare-selfhost.mjs'));
    write('src-tauri/tauri.conf.json', fs.readFileSync('apps/readest-app/src-tauri/tauri.conf.json'));
    write('src-tauri/src/lib.rs', 'const SINGLE_INSTANCE_DBUS_ID: &str = "com.bilingify.readest";');
    write('.env.tauri', 'DBUS_ID=com.bilingify.readest\n');
    write('src-tauri/gen/android/app/build.gradle.kts', 'namespace = "com.bilingify.readest"');
    write('src-tauri/gen/android/app/src/main/java/com/bilingify/readest/MainActivity.kt', 'package com.bilingify.readest\n// upstream custom activity');
    execFileSync('git', ['init', '--quiet', root]);
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture'], { cwd: root });
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    const pnpm = path.join(bin, 'pnpm');
    fs.writeFileSync(pnpm, `#!${process.execPath}
const fs = require('node:fs');
const assert = require('node:assert/strict');
if (process.argv.slice(2, 5).join(' ') === 'tauri android init') {
  const id = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json')).identifier;
  const activity = 'src-tauri/gen/android/app/src/main/java/' + id.replaceAll('.', '/') + '/MainActivity.kt';
  assert.ok(fs.existsSync(activity), 'Tauri init requires the Java directory matching the configured identifier');
  assert.ok(fs.readFileSync(activity, 'utf8').includes('package ' + id), 'Java package must match the identifier before init');
}
`);
    fs.chmodSync(pnpm, 0o755);
    const workflow = fs.readFileSync('.github/workflows/build-selfhost.yml', 'utf8');
    const prepare = workflow.match(/      - name: Prepare Android project\n[\s\S]*?        run: \|\n((?:          .+\n)+)/)?.[1];
    assert.ok(prepare, 'workflow must include Android preparation');
    execFileSync('bash', ['-e', '-c', prepare.replace(/^          /gm, '')], {
      cwd: app,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, LC_ALL: 'C' },
      stdio: 'pipe',
    });
    const activity = path.join(app, 'src-tauri/gen/android/app/src/main/java/io/github/t0mmax/readest/MainActivity.kt');
    assert.match(fs.readFileSync(activity, 'utf8'), /upstream custom activity/);
    assert.match(fs.readFileSync(activity, 'utf8'), /package io.github.t0mmax.readest/);
    assert.match(fs.readFileSync(path.join(app, 'src-tauri/gen/android/app/build.gradle.kts'), 'utf8'), /namespace = "io.github.t0mmax.readest"/);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
