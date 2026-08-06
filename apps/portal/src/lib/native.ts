import { Capacitor } from '@capacitor/core'

/** True when running inside the Capacitor iOS/Android shell. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

export async function initNativeShell(): Promise<void> {
  if (!isNativeApp()) return

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setStyle({ style: Style.Light })
    await StatusBar.setBackgroundColor({ color: '#ffffff' })
  } catch {
    // Status bar plugin may be unavailable in some embeds.
  }

  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide()
  } catch {
    // ignore
  }
}

export async function getNativePosition(): Promise<{
  coords: { latitude: number; longitude: number; accuracy: number }
}> {
  if (isNativeApp()) {
    const { Geolocation } = await import('@capacitor/geolocation')
    const permission = await Geolocation.requestPermissions()
    if (
      permission.location !== 'granted' &&
      permission.coarseLocation !== 'granted'
    ) {
      throw new Error('Location permission denied')
    }
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 15_000,
    })
    return {
      coords: {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      },
    }
  }

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          coords: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          },
        }),
      reject,
      {
        enableHighAccuracy: true,
        timeout: 15_000,
        maximumAge: 0,
      },
    )
  })
}
