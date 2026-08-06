# YCDO Portal — Capacitor mobile app

Portal-only iOS/Android shells around the existing Vite/React employee portal.
HRMS is **not** included.

## Prerequisites

- Node.js 20+
- Android Studio (Android builds)
- macOS + Xcode + CocoaPods (iOS builds; required for App Store)
- Apple Developer Program + Google Play Console for store release

## Project layout

| Path | Purpose |
|------|---------|
| `capacitor.config.ts` | App id `org.ycdo.portal`, webDir `dist` |
| `android/` | Android Studio project |
| `ios/` | Xcode project (finish pods on a Mac) |
| `src/lib/native.ts` | Status bar / splash / native geolocation |

## Build & run (dev)

From `apps/portal`:

```bash
# Install (if workspace npm fails on Windows):
npm install --no-workspaces --legacy-peer-deps

# Set API URL for production builds (example):
# create .env.production with:
# VITE_API_URL=https://your-api.example.com

npm run build:mobile   # vite build + cap sync

npm run cap:android    # open Android Studio
npm run cap:ios        # open Xcode (macOS)
```

In Android Studio: run on emulator/device.  
In Xcode (Mac): `pod install` inside `ios/App` if needed, then run on simulator/device.

## Production API URL

The app uses `import.meta.env.VITE_API_URL` (see `src/api/axios.ts`).  
Before store builds, set `.env.production` (or CapRover/CI env) to your live API HTTPS URL. Do not ship `localhost` in release builds.

## Sideload APK (no Play Store)

```bash
cd apps/portal
echo 'VITE_API_URL=https://hrms-api.ycdo.org.pk' > .env.production
npm run build && npx cap sync android

# Needs JDK 21 + Android SDK
export JAVA_HOME="/c/Program Files/Microsoft/jdk-21.0.12.8-hotspot"
export ANDROID_HOME="/c/Users/Zayn/AppData/Local/Android/Sdk"
cd android && ./gradlew assembleDebug
```

Output APK:

- `android/app/build/outputs/apk/debug/app-debug.apk`
- Copied convenience path: `apps/portal/ycdo-portal-debug.apk`

Install on a phone: enable **Install unknown apps**, then open the APK. Not for Play Store publishing.


## Client assets needed

- App icon (1024×1024) and splash
- Screenshots for store listings
- Privacy policy URL (location permission for attendance)
- Store account access

## Notes

- Safe-area insets are applied on header and bottom nav for notched devices.
- Attendance GPS uses `@capacitor/geolocation` inside the native shell and browser geolocation on web.
- Re-run `npm run build:mobile` after every portal web change before shipping a new native build.
