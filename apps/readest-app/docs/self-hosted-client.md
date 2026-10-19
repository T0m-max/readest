# Self-hosted Readest clients

This fork ports the custom-server client from
[luoji12103/readest-self-hosted](https://github.com/luoji12103/readest-self-hosted)
to the current official Readest source (application version 0.12.16). Official
history and workflows remain available. Changes live on `feat/self-hosted-server`.

## Select a server

In the desktop or Android app, open **Settings → Server**, or **Self-hosted
server** on the sign-in screen. Enter the HTTPS URL, test it, then save.
Saving or resetting clears the previous login and reloads the app, so the API,
Supabase client and synchronization endpoints all start with the selected server.
Local books are retained. Accounts and cloud libraries belong to their server;
this setting does not migrate them.

Discovery checks these paths under the entered URL, in order:

1. `/.well-known/readest-client-config.json`
2. `/api/public/runtime-config`
3. `/runtime-config.js` (the official Docker WebUI runtime configuration)

The JSON format is:

```json
{
  "apiBaseUrl": "https://reader.example.com",
  "supabaseUrl": "https://auth.example.com",
  "supabaseAnonKey": "YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY"
}
```

The script form must be a JSON assignment to
`window.__READEST_RUNTIME_CONFIG`. The client parses it as data, without
executing JavaScript. Discovery requests have timeouts and response size limits.

If the deployment does not publish this information, select **Official Docker
compatibility** and enter its public Supabase URL and anon/publishable key. The
API URL defaults to the server URL. Connection testing and saving probe `/api/sync`
(200, 401 or 403 accepted) and Supabase `/auth/v1/settings` before saving.
Service-role keys, secret keys and private server settings must never be entered.
Production clients require HTTPS with a valid certificate. Web clients continue
using their deployed configuration; the override is native-client only.

Configure the Supabase redirect allowlist to include
`readest-selfhost://auth-callback` for OAuth and email links. Enable and configure
the desired providers on that Supabase deployment. Its public endpoints must
allow the native WebView origins where browser requests are used. The independent
app does not inherit the official app's Apple/Google provider registrations.

## Build with GitHub Actions

The **Build self-hosted clients** workflow is manual. Validate the web app and
Apple Silicon client locally before starting the full platform matrix. After
the workflow is present on the default branch, use **Actions → Build self-hosted
clients → Run workflow** and select the branch to package. Failed jobs can be
rerun from the run page. No iOS job is included.

Download the ZIPs from the run's **Artifacts** section (retained for 14 days):

| Artifact | Package |
| --- | --- |
| `readest-selfhost-windows-x64` | NSIS installer |
| `readest-selfhost-windows-arm64` | ARM64 NSIS installer |
| `readest-selfhost-macos-universal` | Intel + Apple Silicon DMG |
| `readest-selfhost-linux-x64` | DEB and RPM |
| `readest-selfhost-linux-arm64` | ARM64 DEB and RPM |
| `readest-selfhost-android-apk` | Universal APK (ARM64, ARMv7, x86, x64) |

Linux follows upstream's CEF runtime. Desktop packages are unsigned test builds;
macOS Gatekeeper and Windows SmartScreen may display warnings. The app identifier
is `io.github.t0mmax.readest`, product name is `Readest Selfhost`, and OAuth uses
its own URL scheme. Existing official-app data is not imported automatically.
Automatic updating is disabled and updater URLs point to this fork; signed
updates and an update manifest are not published by this workflow.

Without Android signing secrets, the workflow builds a debug-signed APK for
installation testing. The runner's debug key can change between runs, requiring
uninstallation before installing a later test APK. Export local data first.
For a consistent release signature, configure repository Actions secrets:

- `ANDROID_KEYSTORE_BASE64`: base64-encoded JKS keystore
- `ANDROID_KEY_ALIAS`: alias in that keystore
- `ANDROID_KEY_PASSWORD`: password used for both the key and keystore

When a keystore is provided, all three secrets are required; the workflow builds
a release APK and cleans up the decoded keystore. Keep the keystore backed up.

## Maintain the fork

Merge upstream updates into the feature branch, resolve changes in runtime
configuration, authentication and Tauri/Android build settings, then rerun CI.
`prepare-selfhost.mjs` patches only the build checkout; the official Tauri
configuration remains in Git. Do not run the preparation script on a checkout
with unrelated changes. No official publishing credentials are required.
