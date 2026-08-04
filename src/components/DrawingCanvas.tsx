import { useEffect, useRef, useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

interface DrawingCanvasProps {
  label: string;
  height?: number;
  initialDataUrl?: string;
  confirmable?: boolean;
  onChange?: (hasDrawing: boolean, dataUrl?: string) => void;
}

export function DrawingCanvas({ label, height = 260, initialDataUrl, confirmable = false, onChange }: DrawingCanvasProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const strokeChanged = useRef(false);
  const hasDrawingRef = useRef(Boolean(initialDataUrl));
  const [hasDrawing, setHasDrawing] = useState(Boolean(initialDataUrl));
  const [confirmed, setConfirmed] = useState(Boolean(initialDataUrl));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const configure = (dataUrl?: string) => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#153B66";
      if (dataUrl) {
        const image = new Image();
        image.onload = () => ctx.drawImage(image, 0, 0, rect.width, height);
        image.src = dataUrl;
      }
    };

    configure(initialDataUrl);
    const resize = () => configure(hasDrawingRef.current ? canvas.toDataURL("image/png") : undefined);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [height, initialDataUrl]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    strokeChanged.current = false;
    const ctx = event.currentTarget.getContext("2d");
    const current = point(event);
    ctx?.beginPath();
    ctx?.moveTo(current.x, current.y);
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    event.preventDefault();
    const ctx = event.currentTarget.getContext("2d");
    const current = point(event);
    ctx?.lineTo(current.x, current.y);
    ctx?.stroke();
    strokeChanged.current = true;
    hasDrawingRef.current = true;
    setHasDrawing(true);
    setConfirmed(false);
  };

  const finish = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    event.preventDefault();
    drawing.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const canvas = canvasRef.current;
    if (canvas && strokeChanged.current && !confirmable) onChange?.(true, canvas.toDataURL("image/png"));
    strokeChanged.current = false;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    drawing.current = false;
    strokeChanged.current = false;
    hasDrawingRef.current = false;
    setHasDrawing(false);
    setConfirmed(false);
    onChange?.(false);
  };

  const confirm = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawingRef.current) return;
    setConfirmed(true);
    onChange?.(true, canvas.toDataURL("image/png"));
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-slate-700">{label}</span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={clear} className="h-10 gap-2 text-slate-600"><RotateCcw className="h-4 w-4" />{t("sketch.clear")}</Button>
          {confirmable && <Button type="button" size="sm" onClick={confirm} disabled={!hasDrawing || confirmed} className="h-10 gap-2 bg-[#153B66]"><Check className="h-4 w-4" />{t(confirmed ? "signature.accepted" : "signature.accept")}</Button>}
        </div>
      </div>
      <canvas
        ref={canvasRef}
        aria-label={label}
        className="w-full touch-none rounded-2xl border-2 border-dashed border-slate-300 bg-white shadow-inner"
        style={{ height, touchAction: "none" }}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
    </div>
  );
}
