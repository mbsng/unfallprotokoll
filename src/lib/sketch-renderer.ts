import type { StructuredSketch, SketchElement } from "@/lib/sketch-types";
import { vehicleSVG, pedestrianSVG, animalSVG, PARTY_COLORS, type VehicleType, type PartyId } from "@/lib/vehicle-symbols";

// Sketch data can originate from untrusted JSON (shared incident column), so
// every value interpolated into the SVG must be coerced or whitelisted here.
function num(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeParty(value: unknown): PartyId {
  return value === "A" || value === "B" ? value : "neutral";
}

function escapeXml(value: unknown): string {
  return String(value ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c] ?? c));
}

function obstacleIcon(el: SketchElement): string {
  const cx = num(el.x, 0.5) * 100;
  const cy = num(el.y, 0.5) * 100;
  const type = typeof el.type === "string" ? el.type : "hindernis";
  const icons: Record<string, string> = {
    poller: `<circle cx="${cx}" cy="${cy}" r="2" fill="#5F5E5A" />`,
    pfosten: `<rect x="${cx - 0.8}" y="${cy - 3}" width="1.6" height="6" fill="#5F5E5A" />`,
    baum: `<circle cx="${cx}" cy="${cy}" r="3" fill="#2d6a2d" /><rect x="${cx - 0.5}" y="${cy}" width="1" height="3" fill="#5a3a1a" />`,
    wand: `<rect x="${cx - 4}" y="${cy - 1.5}" width="8" height="3" fill="#5F5E5A" />`,
    mauer: `<rect x="${cx - 4}" y="${cy - 1.5}" width="8" height="3" fill="#5F5E5A" />`,
    leitplanke: `<rect x="${cx - 4}" y="${cy - 0.5}" width="8" height="1" fill="#5F5E5A" />`,
    randstein: `<rect x="${cx - 4}" y="${cy}" width="8" height="0.8" fill="#5F5E5A" />`,
    schild: `<rect x="${cx - 2}" y="${cy - 2}" width="4" height="4" fill="#1a4a8a" />`,
    ampel: `<circle cx="${cx}" cy="${cy - 2}" r="1" fill="#d00" /><circle cx="${cx}" cy="${cy}" r="1" fill="#aa0" /><circle cx="${cx}" cy="${cy + 2}" r="1" fill="#0a0" />`,
    garage: `<rect x="${cx - 3}" y="${cy - 2}" width="6" height="4" fill="none" stroke="#5F5E5A" stroke-width="0.5" />`,
    container: `<rect x="${cx - 3}" y="${cy - 1.5}" width="6" height="3" fill="#8a6a3a" />`,
    baustelle: `<polygon points="${cx - 3},${cy} ${cx},${cy - 3} ${cx + 3},${cy}" fill="#da0" />`,
  };
  return Object.prototype.hasOwnProperty.call(icons, type) ? icons[type] : icons.wand;
}

export function renderSketchSVG(sketch: StructuredSketch, opts?: { width?: number; height?: number }): string {
  const w = num(opts?.width, 100);
  const h = num(opts?.height, 65);
  const layout = sketch.layout ?? { type: "strasse_gerade", lanes_per_direction: 1 };
  const lanes = Math.min(4, Math.max(1, num(layout.lanes_per_direction, 1)));

  let bg = "";
  const roadY1 = 42;
  const roadY2 = 58;
  const roadH = roadY2 - roadY1;

  if (layout.type === "strasse_gerade" || layout.type === "kurve" || layout.type === "ein_ausfahrt") {
    bg = `<rect x="0" y="${roadY1}" width="${w}" height="${roadH}" fill="#ccc" />`;
    if (lanes > 1) {
      for (let i = 1; i < lanes * 2; i++) {
        const ly = roadY1 + (roadH / (lanes * 2)) * i;
        bg += `<line x1="0" y1="${ly}" x2="${w}" y2="${ly}" stroke="white" stroke-width="0.3" stroke-dasharray="2,1.5" />`;
      }
    }
    bg += `<line x1="0" y1="50" x2="${w}" y2="50" stroke="white" stroke-width="0.3" stroke-dasharray="3,2" />`;
    bg += `<line x1="0" y1="${roadY1}" x2="${w}" y2="${roadY1}" stroke="#888" stroke-width="0.3" />`;
    bg += `<line x1="0" y1="${roadY2}" x2="${w}" y2="${roadY2}" stroke="#888" stroke-width="0.3" />`;
  } else if (layout.type === "kreuzung" || layout.type === "t_kreuzung") {
    bg = `<rect x="0" y="${roadY1}" width="${w}" height="${roadH}" fill="#ccc" />`;
    bg += `<rect x="${w / 2 - roadH / 2}" y="0" width="${roadH}" height="${h}" fill="#ccc" />`;
  } else if (layout.type === "kreisel") {
    bg = `<rect x="0" y="${roadY1 - 4}" width="${w}" height="${roadH + 8}" fill="#ccc" />`;
    bg += `<circle cx="${w / 2}" cy="50" r="12" fill="#ccc" />`;
    bg += `<circle cx="${w / 2}" cy="50" r="6" fill="white" stroke="#888" stroke-width="0.3" />`;
  } else if (layout.type === "parkplatz") {
    bg = `<rect x="0" y="${roadY1}" width="${w}" height="${roadH}" fill="#ccc" />`;
    for (let i = 0; i < 8; i++) {
      bg += `<rect x="${5 + i * 12}" y="${roadY1 + 2}" width="8" height="${roadH - 4}" fill="none" stroke="#aaa" stroke-width="0.2" stroke-dasharray="1,1" />`;
    }
  }

  let labels = "";
  if (sketch.streets?.main) labels += `<text x="${w / 2}" y="${h - 2}" text-anchor="middle" font-size="3.5" fill="#333" font-family="sans-serif">${escapeXml(sketch.streets.main)}</text>`;
  if (sketch.streets?.cross) labels += `<text x="${w - 4}" y="50" font-size="3.5" fill="#333" font-family="sans-serif" transform="rotate(90, ${w - 4}, 50)">${escapeXml(sketch.streets.cross)}</text>`;

  let elements = "";
  for (const el of sketch.elements ?? []) {
    const cx = num(el.x, 0.5) * 100;
    const cy = num(el.y, 0.5) * 100;
    if (el.kind === "vehicle") {
      // Use the new vehicle symbol library
      const vType: VehicleType = "car"; // Default to car; could be extended with vehicle type data
      const party = sanitizeParty(el.party);
      elements += vehicleSVG({
        type: vType,
        party,
        state: el.state === "fahrend" || el.state === "haltend" || el.state === "parkiert" ? el.state : undefined,
        rotation: num(el.rotation, 0),
        label: party === "neutral" ? undefined : party,
        x: num(el.x, 0.5),
        y: num(el.y, 0.5),
      });
    } else if (el.kind === "obstacle") {
      elements += obstacleIcon(el);
    } else if (el.kind === "arrow") {
      const fromX = num(el.from?.[0], num(el.x, 0.5)) * 100;
      const fromY = num(el.from?.[1], num(el.y, 0.5)) * 100;
      const toX = num(el.to?.[0], num(el.x, 0.5)) * 100;
      const toY = num(el.to?.[1], num(el.y, 0.5)) * 100;
      const party = el.party === "B" ? "B" : "A";
      const color = party === "A" ? PARTY_COLORS.A.front : PARTY_COLORS.B.front;
      elements += `<line x1="${fromX}" y1="${fromY}" x2="${toX}" y2="${toY}" stroke="${color}" stroke-width="1" marker-end="url(#arrow-${party})" />`;
    } else if (el.kind === "impact") {
      elements += `<g transform="translate(${cx},${cy})"><line x1="-3" y1="-3" x2="3" y2="3" stroke="#cc0000" stroke-width="1.5" /><line x1="-3" y1="3" x2="3" y2="-3" stroke="#cc0000" stroke-width="1.5" /></g>`;
    } else if (el.kind === "pedestrian") {
      elements += pedestrianSVG(num(el.x, 0.5), num(el.y, 0.5));
    } else if (el.kind === "animal") {
      elements += animalSVG(num(el.x, 0.5), num(el.y, 0.5));
    } else if (el.kind === "cyclist") {
      elements += vehicleSVG({ type: "bicycle", party: "neutral", x: num(el.x, 0.5), y: num(el.y, 0.5) });
    } else if (el.kind === "motorcycle") {
      elements += vehicleSVG({ type: "motorcycle", party: "neutral", x: num(el.x, 0.5), y: num(el.y, 0.5) });
    } else if (el.kind === "label") {
      elements += `<text x="${cx}" y="${cy}" font-size="4" fill="#333" font-family="sans-serif">${escapeXml(el.text ?? "")}</text>`;
    }
  }

  const markers = `<defs>
    <marker id="arrow-A" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><polygon points="0,0 4,2 0,4" fill="${PARTY_COLORS.A.front}" /></marker>
    <marker id="arrow-B" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><polygon points="0,0 4,2 0,4" fill="${PARTY_COLORS.B.front}" /></marker>
  </defs>`;

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:white;">${markers}${bg}${labels}${elements}</svg>`;
}
