// CI-only preparation. Start from a clean checkout; generated config is not committed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const identifier = 'io.github.t0mmax.readest';
const oldIdentifier = 'com.bilingify.readest';
const scheme = 'readest-selfhost';
const configPath = path.join(app, 'src-tauri/tauri.conf.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.productName = 'Readest Selfhost';
config.identifier = identifier;
config.build.beforeBuildCommand = 'pnpm build';
config.bundle.createUpdaterArtifacts = false;
config.plugins.updater = {
  pubkey: '',
  endpoints: ['https://github.com/T0m-max/readest/releases/latest/download/latest.json'],
};
config.plugins['deep-link'].desktop.schemes = [scheme];
config.plugins['deep-link'].mobile = [{ scheme: [scheme], appLink: false }];
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
// Single-instance identity on Linux is compiled into the native binary.
const rustPath = path.join(app, 'src-tauri/src/lib.rs');
fs.writeFileSync(rustPath, fs.readFileSync(rustPath, 'utf8').replace(
  `const SINGLE_INSTANCE_DBUS_ID: &str = "${oldIdentifier}";`,
  `const SINGLE_INSTANCE_DBUS_ID: &str = "${identifier}";`,
));
const envPath = path.join(app, '.env.tauri');
const env = fs.readFileSync(envPath, 'utf8')
  .replaceAll(`DBUS_ID=${oldIdentifier}`, `DBUS_ID=${identifier}`)
  .split('\n')
  .filter((line) => !/^NEXT_PUBLIC_(SELFHOST_BUILD|DISABLE_UPDATER)=/.test(line))
  .join('\n').trimEnd();
fs.writeFileSync(envPath, `${env}\nNEXT_PUBLIC_SELFHOST_BUILD=true\nNEXT_PUBLIC_DISABLE_UPDATER=true\n`);

if (process.argv.includes('--android')) {
  // Android init generates the untracked Gradle scaffolding. Restore the upstream
  // app sources first, then relocate them, retaining Readest's custom Gradle rules.
  const androidApp = path.join(app, 'src-tauri/gen/android/app');
  for (const file of fs.readdirSync(androidApp, { recursive: true })) {
    const full = path.join(androidApp, file);
    if (fs.statSync(full).isFile() && /\.(kt|kts|xml|pro|properties)$/.test(file)) {
      let text = fs.readFileSync(full, 'utf8').replaceAll(oldIdentifier, identifier);
      text = text.replaceAll('android:scheme="readest"', `android:scheme="${scheme}"`);
      fs.writeFileSync(full, text);
    }
  }
  const oldJava = path.join(androidApp, 'src/main/java/com/bilingify/readest');
  const newJava = path.join(androidApp, 'src/main/java/io/github/t0mmax/readest');
  if (fs.existsSync(oldJava)) {
    fs.mkdirSync(newJava, { recursive: true });
    fs.cpSync(oldJava, newJava, { recursive: true });
    fs.rmSync(oldJava, { recursive: true });
  }
}
console.log(`Prepared ${config.productName} (${identifier}); automatic updates disabled.`);
