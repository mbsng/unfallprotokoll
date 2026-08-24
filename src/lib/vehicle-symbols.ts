// Vehicle silhouette SVG library — top-down views matching European Accident Statement field 10
// Front is always marked by a solid filled bar. Party colors follow the form's coding.

export type PartyId = "A" | "B" | "neutral";
export type VehicleType = "car" | "van" | "truck" | "bus" | "motorcycle" | "scooter" | "bicycle" | "trailer";
export type VehicleState = "fahrend" | "haltend" | "parkiert";

interface PartyColors { fill: string; stroke: string; front: string; }

const PARTY_COLORS: Record<PartyId, PartyColors> = {
  A: { fill: "#B5D4F4", stroke: "#0C447C", front: "#0C447C" },
  B: { fill: "#FAC775", stroke: "#633806", front: "#633806" },
  neutral: { fill: "#D5D4D0", stroke: "#5F5E5A", front: "#5F5E5A" },
};

function esc(value: unknown): string {
  return String(value ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c] ?? c));
}

// Inputs may come from untrusted persisted JSON — coerce numerics and
// whitelist enum-like values before they are interpolated into SVG markup.
function num(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// All shapes are drawn pointing UP (front at top). Rotation applied by caller.
function carBody(colors: PartyColors, dashed: boolean, label: string): string {
  const sw = dashed ? "1" : "1.2";
  const sd = dashed ? 'stroke-dasharray="2,1.5"' : "";
  return `<g>
    <rect x="-4" y="-7" width="8" height="14" rx="2.5" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="${sw}" ${sd} />
    <rect x="-2.5" y="-4" width="5" height="5" rx="1" fill="none" stroke="${colors.stroke}" stroke-width="0.4" opacity="0.5" />
    <rect x="-4" y="-7" width="8" height="2.5" rx="2" fill="${colors.front}" />
    ${label ? `<text x="0" y="3" text-anchor="middle" font-size="4.5" font-weight="bold" fill="${colors.stroke}" font-family="sans-serif">${esc(label)}</text>` : ""}
  </g>`;
}

function vanBody(colors: PartyColors, dashed: boolean, label: string): string {
  const sw = dashed ? "1" : "1.2";
  const sd = dashed ? 'stroke-dasharray="2,1.5"' : "";
  return `<g>
    <rect x="-4" y="-7" width="8" height="14" rx="1" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="${sw}" ${sd} />
    <line x1="-4" y1="-3" x2="4" y2="-3" stroke="${colors.stroke}" stroke-width="0.4" />
    <rect x="-4" y="-7" width="8" height="2" fill="${colors.front}" />
    ${label ? `<text x="0" y="3" text-anchor="middle" font-size="4.5" font-weight="bold" fill="${colors.stroke}" font-family="sans-serif">${esc(label)}</text>` : ""}
  </g>`;
}

function truckBody(colors: PartyColors, dashed: boolean, label: string): string {
  const sw = dashed ? "1" : "1.2";
  const sd = dashed ? 'stroke-dasharray="2,1.5"' : "";
  return `<g>
    <rect x="-4" y="-7" width="3" height="5" rx="0.5" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="${sw}" ${sd} />
    <rect x="-4" y="-7" width="3" height="2" fill="${colors.front}" />
    <line x1="-1" y1="-4" x2="-1" y2="7" stroke="${colors.stroke}" stroke-width="0.4" />
    <rect x="-1" y="-4" width="5" height="11" rx="0.5" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="${sw}" ${sd} />
    ${label ? `<text x="1.5" y="3" text-anchor="middle" font-size="4" font-weight="bold" fill="${colors.stroke}" font-family="sans-serif">${esc(label)}</text>` : ""}
  </g>`;
}

function busBody(colors: PartyColors, dashed: boolean, label: string): string {
  const sw = dashed ? "1" : "1.2";
  const sd = dashed ? 'stroke-dasharray="2,1.5"' : "";
  return `<g>
    <rect x="-3.5" y="-8" width="7" height="16" rx="1" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="${sw}" ${sd} />
    <rect x="-3.5" y="-8" width="7" height="2.5" fill="${colors.front}" />
    ${label ? `<text x="0" y="3" text-anchor="middle" font-size="4" font-weight="bold" fill="${colors.stroke}" font-family="sans-serif">${esc(label)}</text>` : ""}
  </g>`;
}

function motorcycleBody(colors: PartyColors, dashed: boolean, label: string): string {
  const sw = dashed ? "1" : "1.2";
  const sd = dashed ? 'stroke-dasharray="1.5,1"' : "";
  return `<g>
    <rect x="-4" y="-6.5" width="8" height="2" rx="1" fill="${colors.front}" />
    <ellipse cx="0" cy="0" rx="2" ry="4" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="${sw}" ${sd} />
    ${label ? `<text x="0" y="2" text-anchor="middle" font-size="3.5" font-weight="bold" fill="${colors.stroke}" font-family="sans-serif">${esc(label)}</text>` : ""}
  </g>`;
}

function scooterBody(colors: PartyColors, dashed: boolean, label: string): string {
  const sw = dashed ? "1" : "1.2";
  return `<g>
    <rect x="-3.5" y="-5.5" width="7" height="2" rx="1" fill="${colors.front}" />
    <ellipse cx="0" cy="1" rx="2.5" ry="3.5" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="${sw}" />
    ${label ? `<text x="0" y="3" text-anchor="middle" font-size="3" font-weight="bold" fill="${colors.stroke}" font-family="sans-serif">${esc(label)}</text>` : ""}
  </g>`;
}

function bicycleBody(colors: PartyColors, dashed: boolean, label: string): string {
  const sw = dashed ? "0.8" : "1";
  const sd = dashed ? 'stroke-dasharray="1.5,1"' : "";
  return `<g>
    <rect x="-2" y="-5" width="4" height="1.5" rx="0.5" fill="${colors.front}" />
    <ellipse cx="0" cy="1" rx="1.5" ry="3" fill="none" stroke="${colors.stroke}" stroke-width="${sw}" ${sd} stroke-dasharray="1,0.5" />
    ${label ? `<text x="0" y="3" text-anchor="middle" font-size="3" fill="${colors.stroke}" font-family="sans-serif">${esc(label)}</text>` : ""}
  </g>`;
}

function trailerBody(colors: PartyColors, dashed: boolean, label: string): string {
  const sw = dashed ? "1" : "1.2";
  return `<g>
    <rect x="-4" y="-5" width="8" height="10" rx="0.5" fill="none" stroke="${colors.stroke}" stroke-width="${sw}" />
    <line x1="0" y1="-5" x2="0" y2="-8" stroke="${colors.stroke}" stroke-width="0.8" />
    ${label ? `<text x="0" y="2" text-anchor="middle" font-size="3.5" fill="${colors.stroke}" font-family="sans-serif">${esc(label)}</text>` : ""}
  </g>`;
}

const BODY_FN: Record<VehicleType, (c: PartyColors, d: boolean, l: string) => string> = {
  car: carBody, van: vanBody, truck: truckBody, bus: busBody,
  motorcycle: motorcycleBody, scooter: scooterBody, bicycle: bicycleBody, trailer: trailerBody,
};

export function vehicleSVG(opts: { type: VehicleType; party?: PartyId; state?: VehicleState; rotation?: number; label?: string; x?: number; y?: number }): string {
  const party: PartyId = opts.party === "A" || opts.party === "B" ? opts.party : "neutral";
  const colors = PARTY_COLORS[party];
  const dashed = opts.state === "parkiert" || opts.state === "haltend";
  const label = opts.label ?? (party !== "neutral" ? party : "");
  const bodyFn = (BODY_FN as Record<string, (c: PartyColors, d: boolean, l: string) => string>)[opts.type ?? "car"] ?? BODY_FN.car;
  const body = bodyFn(colors, dashed, label);
  const rot = num(opts.rotation, 0);
  const cx = num(opts.x, 0.5) * 100;
  const cy = num(opts.y, 0.5) * 100;
  // Counter-rotate the label text to keep it readable
  const counterRot = -rot;
  // The body is drawn with front pointing up; rotate the whole group
  // Then counter-rotate the text inside by wrapping in a nested group
  const bodyWithCounterLabel = body.replace(/<text /, `<text transform="rotate(${counterRot})" `);
  return `<g transform="translate(${cx},${cy}) rotate(${rot})">${bodyWithCounterLabel}</g>`;
}

export function pedestrianSVG(x: number, y: number): string {
  const cx = num(x, 0.5) * 100;
  const cy = num(y, 0.5) * 100;
  return `<g transform="translate(${cx},${cy})">
    <circle cx="0" cy="-3" r="2" fill="none" stroke="#5F5E5A" stroke-width="0.8" />
    <rect x="-1.5" y="-4.5" width="3" height="1" fill="#5F5E5A" />
    <line x1="0" y1="-1" x2="0" y2="3" stroke="#5F5E5A" stroke-width="0.8" />
  </g>`;
}

export function animalSVG(x: number, y: number): string {
  const cx = num(x, 0.5) * 100;
  const cy = num(y, 0.5) * 100;
  return `<g transform="translate(${cx},${cy})">
    <ellipse cx="0" cy="0" rx="3.5" ry="2" fill="none" stroke="#5F5E5A" stroke-width="0.8" />
    <circle cx="3" cy="0" r="1.5" fill="#5F5E5A" />
    <line x1="-3.5" y1="0" x2="-5" y2="-0.5" stroke="#5F5E5A" stroke-width="0.6" />
  </g>`;
}

export { PARTY_COLORS };
