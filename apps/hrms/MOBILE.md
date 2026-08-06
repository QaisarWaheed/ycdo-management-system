# YCDO HRMS — Capacitor mobile app

HRMS-only iOS/Android shells around [`apps/hrms`](./). Portal has a separate app (`org.ycdo.portal`).

## App identity

| | |
|--|--|
| App ID | `org.ycdo.hrms` |
| Name | YCDO HRMS |
| Live API | `https://hrms-api.ycdo.org.pk` |

## Build & sync

```bash
cd apps/hrms
npm install --no-workspaces --legacy-peer-deps

echo 'VITE_API_URL=https://hrms-api.ycdo.org.pk' > .env.production
npm run build:mobile
```

## Sideload APK (no Play Store)

```bash
export JAVA_HOME="/c/Program Files/Microsoft/jdk-21.0.12.8-hotspot"
export ANDROID_HOME="/c/Users/Zayn/AppData/Local/Android/Sdk"
echo 'sdk.dir=C:/Users/Zayn/AppData/Local/Android/Sdk' > android/local.properties
cd android && ./gradlew assembleDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`  
Copy: `apps/hrms/ycdo-hrms-debug.apk`

Install with **Install unknown apps** enabled.

## Note

Live API CORS must allow Capacitor origins (`https://localhost`, etc.) — already added in `apps/api/src/main.ts`. Redeploy API if mobile login fails with “invalid credentials”.
