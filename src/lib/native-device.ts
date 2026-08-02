import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Geolocation } from "@capacitor/geolocation";

export const isNativeApp = () => Capacitor.isNativePlatform();

export async function captureAccidentPhoto(): Promise<File | null> {
  if (!isNativeApp()) return null;
  const permission = await Camera.requestPermissions({ permissions: ["camera"] });
  if (permission.camera !== "granted") throw new Error("camera_permission_denied");
  const photo = await Camera.getPhoto({
    source: CameraSource.Camera,
    resultType: CameraResultType.Uri,
    quality: 88,
    correctOrientation: true,
    saveToGallery: false,
  });
  if (!photo.webPath) throw new Error("camera_capture_failed");
  const blob = await (await fetch(photo.webPath)).blob();
  return new File([blob], `unfallfoto-${Date.now()}.${photo.format || "jpeg"}`, { type: blob.type || `image/${photo.format || "jpeg"}` });
}

export async function getCurrentCoordinates() {
  if (isNativeApp()) {
    const permission = await Geolocation.requestPermissions();
    if (permission.location !== "granted" && permission.coarseLocation !== "granted") throw new Error("location_permission_denied");
    const result = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 });
    return { latitude: result.coords.latitude, longitude: result.coords.longitude };
  }
  if (!navigator.geolocation) throw new Error("location_unsupported");
  return new Promise<{ latitude: number; longitude: number }>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      reject,
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
    );
  });
}
