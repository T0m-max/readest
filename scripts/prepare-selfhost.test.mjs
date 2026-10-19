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
