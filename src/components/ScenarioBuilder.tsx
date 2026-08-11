import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Check, RotateCcw, Undo2, Redo2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { renderSketchSVG } from "@/lib/sketch-renderer";
import { SCENARIO_DEFINITIONS, EMPTY_SKETCH, getDefaultElements, suggestScenario, type ScenarioId, type StructuredSketch, type SketchElement, type LayoutType } from "@/lib/sketch-types";

interface ScenarioBuilderProps {
  checkedCircumstances: number[];
  initialSketch?: StructuredSketch | null;
  onSave: (sketch: StructuredSketch) => void;
}

const OBSTACLES = ["poller", "pfosten", "baum", "wand", "leitplanke", "randstein", "schild", "ampel", "container", "baustelle"];

export function ScenarioBuilder({ checkedCircumstances, initialSketch, onSave }: ScenarioBuilderProps) {
  const { t } = useTranslation();
  const [builderStep, setBuilderStep] = useState(0);
  const [sketch, setSketch] = useState<StructuredSketch>(() => initialSketch?.mode === "builder" ? { ...initialSketch } : { ...EMPTY_SKETCH });
  const [undoStack, setUndoStack] = useState<StructuredSketch[]>([]);
  const [redoStack, setRedoStack] = useState<StructuredSketch[]>([]);

  const suggested = suggestScenario(checkedCircumstances);

  const pushUndo = (prev: StructuredSketch) => {
    setUndoStack((s) => [...s.slice(-19), prev]);
    setRedoStack([]);
  };

  const undo = () => {
    setUndoStack((s) => {
      if (!s.length) return s;
      const prev = s[s.length - 1];
      setRedoStack((r) => [...r, sketch]);
      setSketch(prev);
      return s.slice(0, -1);
    });
  };

  const redo = () => {
    setRedoStack((s) => {
      if (!s.length) return s;
      const next = s[s.length - 1];
      setUndoStack((u) => [...u, sketch]);
      setSketch(next);
      return s.slice(0, -1);
    });
  };

  const selectScenario = (id: ScenarioId) => {
    pushUndo(sketch);
    const def = getDefaultElements(id);
    setSketch({ ...sketch, scenario: id, layout: def.layout, elements: def.elements, note: def.note });
    setBuilderStep(1);
  };

  const updateElement = (index: number, patch: Partial<SketchElement>) => {
    pushUndo(sketch);
    setSketch((s) => ({ ...s, elements: s.elements.map((el, i) => i === index ? { ...el, ...patch } : el) }));
  };

  const moveElement = (index: number, x: number, y: number) => {
    setSketch((s) => ({ ...s, elements: s.elements.map((el, i) => i === index ? { ...el, x: Math.max(0.02, Math.min(0.98, x)), y: Math.max(0.02, Math.min(0.98, y)) } : el) }));
  };

  const rotateElement = (index: number, delta: number) => {
    pushUndo(sketch);
    setSketch((s) => ({ ...s, elements: s.elements.map((el, i) => i === index ? { ...el, rotation: ((el.rotation ?? 0) + delta + 360) % 360 } : el) }));
  };

  const addObstacle = (type: string) => {
    pushUndo(sketch);
    setSketch((s) => ({ ...s, elements: [...s.elements, { kind: "obstacle", type, x: 0.5, y: 0.3 }] }));
  };

  const addElement = (kind: SketchElement["kind"]) => {
    pushUndo(sketch);
    setSketch((s) => ({ ...s, elements: [...s.elements, { kind, x: 0.5, y: 0.3 }] }));
  };

  const setImpact = () => {
    pushUndo(sketch);
    setSketch((s) => {
      const without = s.elements.filter((e) => e.kind !== "impact");
      return { ...s, elements: [...without, { kind: "impact", x: 0.5, y: 0.5 }] };
    });
  };

  const removeElement = (index: number) => {
    pushUndo(sketch);
    setSketch((s) => ({ ...s, elements: s.elements.filter((_, i) => i !== index) }));
  };

  const reset = () => {
    pushUndo(sketch);
    setSketch({ ...EMPTY_SKETCH });
  };

  const save = () => {
    onSave(sketch);
    toast.success(t("sketch.builderSaved"));
  };

  const layoutTypes: LayoutType[] = ["strasse_gerade", "kurve", "t_kreuzung", "kreuzung", "kreisel", "parkplatz", "ein_ausfahrt"];

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs font-semibold">
        <span className={builderStep >= 0 ? "text-[#153B66]" : "text-slate-400"}>1. {t("sketch.builderStep1")}</span>
        <span className="text-slate-300">→</span>
        <span className={builderStep >= 1 ? "text-[#153B66]" : "text-slate-400"}>2. {t("sketch.builderStep2")}</span>
        <span className="text-slate-300">→</span>
        <span className={builderStep >= 2 ? "text-[#153B66]" : "text-slate-400"}>3. {t("sketch.builderStep3")}</span>
      </div>

      {/* Step 1: Select scenario */}
      {builderStep === 0 && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SCENARIO_DEFINITIONS.map((def) => (
              <button key={def.id} onClick={() => selectScenario(def.id)} className={`rounded-xl border-2 p-3 text-center transition ${suggested === def.id ? "border-[#39719D] bg-[#EDF4F8]" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                <div className="mb-1 flex justify-center">{def.solo ? "🚗" : "🚗🚙"}</div>
                <span className="text-xs font-medium text-slate-700">{t(`sketch.scenarios.${def.id}`)}</span>
                {suggested === def.id && <span className="mt-1 block text-[10px] font-bold text-[#39719D]">{t("sketch.suggested")}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Customize */}
      {builderStep === 1 && (
        <div className="space-y-3">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={undo} disabled={!undoStack.length} className="h-8 px-2"><Undo2 className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={redo} disabled={!redoStack.length} className="h-8 px-2"><Redo2 className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={reset} className="h-8 px-2"><RotateCcw className="h-4 w-4" /></Button>
            <select value={sketch.layout?.type} onChange={(e) => { pushUndo(sketch); setSketch((s) => ({ ...s, layout: { ...s.layout!, type: e.target.value as LayoutType } })); }} className="rounded-lg border border-slate-200 px-2 py-1 text-xs">
              {layoutTypes.map((lt) => <option key={lt} value={lt}>{t(`sketch.layouts.${lt}`)}</option>)}
            </select>
            <select value={sketch.layout?.lanes_per_direction} onChange={(e) => { pushUndo(sketch); setSketch((s) => ({ ...s, layout: { ...s.layout!, lanes_per_direction: Number(e.target.value) } })); }} className="rounded-lg border border-slate-200 px-2 py-1 text-xs">
              <option value={1}>1 {t("sketch.lane")}</option>
              <option value={2}>2 {t("sketch.lanes")}</option>
              <option value={3}>3 {t("sketch.lanes")}</option>
            </select>
            <Button size="sm" variant="outline" onClick={setImpact} className="h-8 px-2 text-xs">✕ {t("sketch.impactPoint")}</Button>
          </div>

          {/* Canvas */}
          <div className="relative overflow-hidden rounded-xl border border-slate-300 bg-white" style={{ aspectRatio: "3 / 2" }}>
            {builderStep === 1 && sketch.elements.some((e) => e.kind === "vehicle") && (
              <div className="absolute left-2 top-2 z-10 rounded-lg bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-700">{t("sketch.frontHint")}</div>
            )}
            <div className="pointer-events-none absolute inset-0" dangerouslySetInnerHTML={{ __html: renderSketchSVG(sketch, { width: 100, height: 65 }) }} />
            {/* Draggable elements overlay */}
            {sketch.elements.map((el, i) => (
              <div key={i}
                className="absolute flex h-8 w-8 cursor-grab items-center justify-center rounded-full border border-slate-300 bg-white/80 text-xs font-bold active:cursor-grabbing"
                style={{ left: `${el.x * 100}%`, top: `${el.y * 100}%`, transform: "translate(-50%, -50%)" }}
                onPointerDown={(e) => {
                  e.preventDefault();
                  const target = e.currentTarget;
                  const parent = target.parentElement!;
                  const rect = parent.getBoundingClientRect();
                  const onMove = (ev: PointerEvent) => {
                    const x = (ev.clientX - rect.left) / rect.width;
                    const y = (ev.clientY - rect.top) / rect.height;
                    moveElement(i, x, y);
                  };
                  const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); pushUndo(sketch); };
                  window.addEventListener("pointermove", onMove);
                  window.addEventListener("pointerup", onUp);
                }}
                onClick={() => {
                  if (el.kind === "vehicle") rotateElement(i, 15);
                  else removeElement(i);
                }}
              >
                {el.kind === "vehicle" ? el.party : el.kind === "impact" ? "✕" : el.kind === "obstacle" ? "▣" : "•"}
              </div>
            ))}
          </div>

          {/* Controls below canvas */}
          <div className="flex flex-wrap items-center gap-2">
            {sketch.elements.filter((e) => e.kind === "vehicle").map((el, i) => {
              const idx = sketch.elements.indexOf(el);
              return (
                <div key={i} className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1">
                  <span className="text-xs font-bold">{el.party}</span>
                  <select value={el.state} onChange={(e) => updateElement(idx, { state: e.target.value as "fahrend" | "haltend" | "parkiert" })} className="rounded border border-slate-200 px-1 text-xs">
                    <option value="fahrend">{t("sketch.stateDriving")}</option>
                    <option value="haltend">{t("sketch.stateStopped")}</option>
                    <option value="parkiert">{t("sketch.stateParked")}</option>
                  </select>
                  <Button size="sm" variant="ghost" onClick={() => rotateElement(idx, -15)} className="h-6 px-1 text-xs">↺</Button>
                  <Button size="sm" variant="ghost" onClick={() => rotateElement(idx, 15)} className="h-6 px-1 text-xs">↻</Button>
                </div>
              );
            })}
          </div>

          {/* Add elements */}
          <div className="space-y-1">
            <Label className="text-xs text-slate-500">{t("sketch.addElement")}</Label>
            <div className="flex flex-wrap gap-1">
              {OBSTACLES.map((obs) => <Button key={obs} size="sm" variant="outline" onClick={() => addObstacle(obs)} className="h-7 px-2 text-xs">{t(`sketch.obstacles.${obs}`)}</Button>)}
              <Button size="sm" variant="outline" onClick={() => addElement("pedestrian")} className="h-7 px-2 text-xs">{t("sketch.obstacles.pedestrian")}</Button>
              <Button size="sm" variant="outline" onClick={() => addElement("cyclist")} className="h-7 px-2 text-xs">{t("sketch.obstacles.cyclist")}</Button>
              <Button size="sm" variant="outline" onClick={() => addElement("motorcycle")} className="h-7 px-2 text-xs">{t("sketch.obstacles.motorcycle")}</Button>
              <Button size="sm" variant="outline" onClick={() => addElement("animal")} className="h-7 px-2 text-xs">{t("sketch.obstacles.animal")}</Button>
            </div>
          </div>

          {/* Street names */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-slate-500">{t("sketch.streetMain")}</Label>
              <Input value={sketch.streets.main} onChange={(e) => setSketch((s) => ({ ...s, streets: { ...s.streets, main: e.target.value } }))} className="h-9 text-sm" placeholder="Bahnhofstrasse" />
            </div>
            <div>
              <Label className="text-xs text-slate-500">{t("sketch.streetCross")}</Label>
              <Input value={sketch.streets.cross} onChange={(e) => setSketch((s) => ({ ...s, streets: { ...s.streets, cross: e.target.value } }))} className="h-9 text-sm" placeholder="Seestrasse" />
            </div>
          </div>

          {/* Note */}
          <div>
            <Label className="text-xs text-slate-500">{t("sketch.note")}</Label>
            <Input value={sketch.note} onChange={(e) => setSketch((s) => ({ ...s, note: e.target.value }))} className="h-9 text-sm" />
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setBuilderStep(0)} className="h-10"><ArrowLeft className="mr-1 h-4 w-4" />{t("app.back")}</Button>
            <Button onClick={() => setBuilderStep(2)} className="h-10 bg-[#153B66]">{t("sketch.preview")}<ArrowRight className="ml-1 h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {/* Step 3: Preview + confirm */}
      {builderStep === 2 && (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-xl border-2 border-slate-300 bg-white p-2">
            <div dangerouslySetInnerHTML={{ __html: renderSketchSVG(sketch, { width: 100, height: 65 }) }} />
          </div>
          {sketch.note && <p className="text-sm text-slate-600">{sketch.note}</p>}
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setBuilderStep(1)} className="h-10"><ArrowLeft className="mr-1 h-4 w-4" />{t("sketch.adjust")}</Button>
            <Button onClick={save} className="h-10 bg-emerald-700"><Check className="mr-1 h-4 w-4" />{t("sketch.confirm")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
