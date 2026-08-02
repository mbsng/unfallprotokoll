# Native platform configuration

Capacitor uses `ch.upsala.app` for both native platforms and `upsala.ch` for verified links.

When the native shells are generated, apply these checked-in platform settings:

- iOS: add `ios/App.entitlements` to the App target's Code Signing Entitlements and merge `ios/Info.plist.permissions.xml` into the target Info.plist.
- Android: merge `android/AndroidManifest.permissions-and-links.xml` into the generated app manifest; the intent filter belongs inside the main activity.

Before store signing, replace the two explicit association credential markers:

- `APPLE_TEAM_ID` in `public/.well-known/apple-app-site-association`
- `ANDROID_SHA256_CERT_FINGERPRINT` in `public/.well-known/assetlinks.json`

The deployed files must remain available without redirects at:

- `https://upsala.ch/.well-known/apple-app-site-association`
- `https://upsala.ch/.well-known/assetlinks.json`

The PWA already handles `/join/{code}` through React Router and the Vercel SPA fallback. Native cold starts and foreground URL opens are handled by `DeepLinkHandler`.
