import type { StructuredSketch, SketchElement } from "@/lib/sketch-types";

const VEHICLE_W = 0.06;
const VEHICLE_H = 0.035;

function vehicleRect(el: SketchElement, color: string): string {
  const cx = el.x * 100;
  const cy = el.y * 100;
  const w = VEHICLE_W * 100;
  const h = VEHICLE_H * 100;
  const rot = el.rotation ?? 0;
  const label = el.party ?? "?";
  const stateMark = el.state === "haltend" ? " ⏸" : el.state === "parkiert" ? " P" : "";
  return `<g transform="translate(${cx},${cy}) rotate(${rot})">
    <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="2" fill="${color}" stroke="#1a1a1a" stroke-width="0.4" />
    <text x="0" y="2" text-anchor="middle" font-size="5" font-weight="bold" fill="white" font-family="sans-serif">${label}${stateMark}</text>
  </g>`;
}

function obstacleIcon(el: SketchElement): string {
  const cx = el.x * 100;
  const cy = el.y * 100;
  const type = el.type ?? "hindernis";
  const icons: Record<string, string> = {
    poller: `<circle cx="${cx}" cy="${cy}" r="2" fill="#333" />`,
    pfosten: `<rect x="${cx - 0.8}" y="${cy - 3}" width="1.6" height="6" fill="#333" />`,
    baum: `<circle cx="${cx}" cy="${cy}" r="3" fill="#2d6a2d" /><rect x="${cx - 0.5}" y="${cy}" width="1" height="3" fill="#5a3a1a" />`,
    wand: `<rect x="${cx - 4}" y="${cy - 1.5}" width="8" height="3" fill="#666" />`,
    mauer: `<rect x="${cx - 4}" y="${cy - 1.5}" width="8" height="3" fill="#666" />`,
    leitplanke: `<rect x="${cx - 4}" y="${cy - 0.5}" width="8" height="1" fill="#888" />`,
    randstein: `<rect x="${cx - 4}" y="${cy}" width="8" height="0.8" fill="#999" />`,
    schild: `<rect x="${cx - 2}" y="${cy - 2}" width="4" height="4" fill="#1a4a8a" />`,
    ampel: `<circle cx="${cx}" cy="${cy - 2}" r="1" fill="#d00" /><circle cx="${cx}" cy="${cy}" r="1" fill="#aa0" /><circle cx="${cx}" cy="${cy + 2}" r="1" fill="#0a0" />`,
    garage: `<rect x="${cx - 3}" y="${cy - 2}" width="6" height="4" fill="none" stroke="#333" stroke-width="0.5" />`,
    container: `<rect x="${cx - 3}" y="${cy - 1.5}" width="6" height="3" fill="#8a6a3a" />`,
    baustelle: `<polygon points="${cx - 3},${cy} ${cx},${cy - 3} ${cx + 3},${cy}" fill="#da0" />`,
  };
  return icons[type] ?? icons.wand;
}

function otherIcon(el: SketchElement): string {
  const cx = el.x * 100;
  const cy = el.y * 100;
  switch (el.kind) {
    case "pedestrian": return `<circle cx="${cx}" cy="${cy}" r="1.5" fill="#1a1a1a /><line x1="${cx}" y1="${cy + 1.5}" x2="${cx}" y2="${cy + 4}" stroke="#1a1a1a" stroke-width="0.6" />`;
    case "cyclist": return `<circle cx="${cx}" cy="${cy}" r="2.5" fill="none" stroke="#1a4a8a" stroke-width="0.8" />`;
    case "motorcycle": return `<ellipse cx="${cx}" cy="${cy}" rx="3" ry="1.2" fill="#333" />`;
    case "animal": return `<ellipse cx="${cx}" cy="${cy}" rx="2.5" ry="1.5" fill="#6a4a2a" />`;
    case "label": return `<text x="${cx}" y="${cy}" font-size="4" fill="#333" font-family="sans-serif">${escapeXml(el.text ?? "")}</text>`;
    default: return "";
  }
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c] ?? c));
}

export function renderSketchSVG(sketch: StructuredSketch, opts?: { width?: number; height?: number }): string {
  const w = opts?.width ?? 100;
  const h = opts?.height ?? 65;
  const layout = sketch.layout ?? { type: "strasse_gerade", lanes_per_direction: 1 };
  const lanes = layout.lanes_per_direction ?? 1;

  let bg = "";
  const roadY1 = 42;
  const roadY2 = 58;
  const roadH = roadY2 - roadY1;

  // Draw road based on layout type
  if (layout.type === "strasse_gerade" || layout.type === "kurve" || layout.type === "ein_ausfahrt") {
    bg = `<rect x="0" y="${roadY1}" width="${w}" height="${roadH}" fill="#ccc" />`;
    // Lane markings
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
    bg += `<rect x="${w / 2 - 1}" y="${roadY1}" width="2" height="${roadH}" fill="#999" opacity="0.3" />`;
    bg += `<rect x="${w / 2 - roadH / 2}" y="${50 - 1}" width="${roadH}" height="2" fill="#999" opacity="0.3" />`;
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

  // Street names
  let labels = "";
  if (sketch.streets?.main) labels += `<text x="${w / 2}" y="${h - 2}" text-anchor="middle" font-size="3.5" fill="#333" font-family="sans-serif">${escapeXml(sketch.streets.main)}</text>`;
  if (sketch.streets?.cross) labels += `<text x="${w - 4}" y="50" font-size="3.5" fill="#333" font-family="sans-serif" transform="rotate(90, ${w - 4}, 50)">${escapeXml(sketch.streets.cross)}</text>`;

  // Elements
  let elements = "";
  for (const el of sketch.elements) {
    const cx = el.x * 100;
    const cy = el.y * 100;
    if (el.kind === "vehicle") {
      const color = el.party === "A" ? "#1c72b8" : "#ebb714";
      elements += vehicleRect(el, color);
    } else if (el.kind === "obstacle") {
      elements += obstacleIcon(el);
    } else if (el.kind === "arrow") {
      const fromX = (el.from?.[0] ?? cx / 100) * 100;
      const fromY = (el.from?.[1] ?? cy / 100) * 100;
      const toX = (el.to?.[0] ?? el.x) * 100;
      const toY = (el.to?.[1] ?? el.y) * 100;
      const party = el.party ?? "A";
      const color = party === "A" ? "#1c72b8" : "#ebb714";
      elements += `<line x1="${fromX}" y1="${fromY}" x2="${toX}" y2="${toY}" stroke="${color}" stroke-width="1" marker-end="url(#arrow-${party})" />`;
    } else if (el.kind === "impact") {
      elements += `<g transform="translate(${cx},${cy})"><line x1="-3" y1="-3" x2="3" y2="3" stroke="#cc0000" stroke-width="1.5" /><line x1="-3" y1="3" x2="3" y2="-3" stroke="#cc0000" stroke-width="1.5" /></g>`;
    } else {
      elements += otherIcon(el);
    }
  }

  // Arrow markers
  const markers = `<defs>
    <marker id="arrow-A" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><polygon points="0,0 4,2 0,4" fill="#1c72b8" /></marker>
    <marker id="arrow-B" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><polygon points="0,0 4,2 0,4" fill="#ebb714" /></marker>
  </defs>`;

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;background:white;">${markers}${bg}${labels}${elements}</svg>`;
}
