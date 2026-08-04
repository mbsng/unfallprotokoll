import { useEffect, useId, useRef, useState } from "react";
import { Camera, Loader2, ScanLine, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { isNativeApp } from "@/lib/native-device";

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new(options: { formats: string[] }): BarcodeDetectorInstance;
  getSupportedFormats?(): Promise<string[]>;
}

interface QrScannerProps {
  onResult: (value: string) => void;
}

export const isQrScannerAvailable = () => isNativeApp() || (typeof window !== "undefined" && window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia));

export function QrScanner({ onResult }: QrScannerProps) {
  const { t } = useTranslation();
  const scannerId = `qr-scanner-${useId().replace(/:/g, "")}`;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const htmlScannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const frameRef = useRef<number | null>(null);
  const activeRef = useRef(false);
  const [active, setActive] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const native = isNativeApp();
  const available = isQrScannerAvailable();

  const stop = async () => {
    activeRef.current = false;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (htmlScannerRef.current) {
      try { await htmlScannerRef.current.stop(); } catch { /* already stopped */ }
      htmlScannerRef.current.clear();
      htmlScannerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const videoStream = videoRef.current?.srcObject;
    if (videoStream instanceof MediaStream) videoStream.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    if (native) {
      try { const { BarcodeScanner } = await import("@capacitor-mlkit/barcode-scanning"); await BarcodeScanner.stopScan(); } catch { /* no active native scan */ }
    }
    setActive(false);
    setUsingFallback(false);
  };

  useEffect(() => () => { void stop(); }, []);

  const finish = async (value: string) => {
    await stop();
    onResult(value);
  };

  const startNative = async () => {
    const { BarcodeFormat, BarcodeScanner } = await import("@capacitor-mlkit/barcode-scanning");
    const support = await BarcodeScanner.isSupported();
    if (!support.supported) throw new Error("unsupported");
    const currentPermission = await BarcodeScanner.checkPermissions();
    const permission = currentPermission.camera === "granted" ? currentPermission : await BarcodeScanner.requestPermissions();
    if (permission.camera !== "granted" && permission.camera !== "limited") throw new DOMException("Camera permission denied", "NotAllowedError");
    const result = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode], autoZoom: true });
    const value = result.barcodes[0]?.rawValue || result.barcodes[0]?.displayValue;
    if (value) await finish(value);
    else await stop();
  };

  const startBarcodeDetector = async (Detector: BarcodeDetectorConstructor) => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    if (!activeRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) throw new Error("scanner_unavailable");
    video.srcObject = stream;
    await video.play();
    const detector = new Detector({ formats: ["qr_code"] });
    const scanFrame = async () => {
      if (!activeRef.current) return;
      try {
        const results = await detector.detect(video);
        if (results[0]?.rawValue) {
          await finish(results[0].rawValue);
          return;
        }
      } catch { /* continue scanning the next frame */ }
      if (activeRef.current) frameRef.current = requestAnimationFrame(() => void scanFrame());
    };
    frameRef.current = requestAnimationFrame(() => void scanFrame());
  };

  const startHtml5Scanner = async () => {
    const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
    const scanner = new Html5Qrcode(scannerId, { formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE], useBarCodeDetectorIfSupported: false, verbose: false });
    htmlScannerRef.current = scanner;
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: (width, height) => ({ width: Math.min(width, height, 260), height: Math.min(width, height, 260) }) },
      (decodedText) => void finish(decodedText),
      () => undefined,
    );
  };

  const start = async () => {
    setError(null);
    setStarting(true);
    setActive(true);
    activeRef.current = true;
    try {
      if (native) {
        await startNative();
      } else {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
        if (Detector) {
          await startBarcodeDetector(Detector);
        } else {
          setUsingFallback(true);
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          await startHtml5Scanner();
        }
      }
    } catch (caught) {
      await stop();
      const errorName = caught instanceof Error ? caught.name : "";
      const errorMessage = caught instanceof Error ? caught.message : String(caught);
      const denied = ["NotAllowedError", "PermissionDeniedError"].includes(errorName) || /notallowed|permission denied/i.test(errorMessage);
      setError(t(denied ? "scanner.permissionDenied" : "scanner.startError"));
    } finally {
      setStarting(false);
    }
  };

  if (!available) return null;

  return (
    <section className="rounded-2xl border border-[#C9D9E5] bg-[#F4F8FB] p-5">
      <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-[#153B66]"><Camera className="h-5 w-5" /></span><div><h2 className="font-bold text-[#153B66]">{t("scanner.title")}</h2><p className="mt-1 text-sm leading-relaxed text-slate-600">{t("scanner.explanation")}</p></div></div>
      {error && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{error} {t("scanner.manualFallback")}</p>}
      {active && !native && <div className="relative mt-4 overflow-hidden rounded-2xl bg-slate-950">
        {!usingFallback && <video ref={videoRef} muted playsInline className="aspect-square w-full object-cover" />}
        {usingFallback && <div id={scannerId} className="w-full [&_video]:w-full" />}
        <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-white/80"><ScanLine className="absolute -top-3 left-1/2 h-6 w-6 -translate-x-1/2 text-white" /></div>
      </div>}
      <Button type="button" variant={active ? "outline" : "default"} onClick={() => active ? void stop() : void start()} disabled={starting} className={`mt-4 h-12 w-full rounded-xl ${active ? "border-slate-300" : "bg-[#153B66]"}`}>
        {starting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : active ? <X className="mr-2 h-4 w-4" /> : <ScanLine className="mr-2 h-4 w-4" />}{t(starting ? "scanner.starting" : active ? "scanner.stop" : "scanner.start")}
      </Button>
    </section>
  );
}
