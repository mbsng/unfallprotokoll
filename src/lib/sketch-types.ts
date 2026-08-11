// Types for the structured sketch builder

export type SketchMode = "builder" | "freehand";

export type ScenarioId =
  | "auffahrunfall" | "spurwechsel" | "ueberholen" | "kreisel"
  | "kreuzung_von_rechts" | "kreuzung_vortritt" | "links_abbiegen"
  | "rechts_abbiegen" | "rueckwaerts" | "ein_ausparken"
  | "parkiert_getroffen" | "gegenfahrbahn" | "tueroeffnen"
  | "hindernis" | "parkiert_ohne_halter" | "ausweichen" | "tier";

export type LayoutType =
  | "strasse_gerade" | "kurve" | "t_kreuzung" | "kreuzung"
  | "kreisel" | "parkplatz" | "ein_ausfahrt";

export type VehicleState = "fahrend" | "haltend" | "parkiert";

export interface SketchElement {
  kind: "vehicle" | "obstacle" | "arrow" | "impact" | "pedestrian" | "cyclist" | "motorcycle" | "animal" | "label";
  party?: "A" | "B";
  x?: number;
  y?: number;
  rotation?: number;
  state?: VehicleState;
  type?: string;
  from?: [number, number];
  to?: [number, number];
  text?: string;
}

export interface StructuredSketch {
  version: number;
  mode: SketchMode;
  scenario?: ScenarioId;
  layout?: { type: LayoutType; lanes_per_direction: number };
  elements: SketchElement[];
  streets: { main: string; cross: string };
  note: string;
}

export const SCENARIO_DEFINITIONS: { id: ScenarioId; circumstances: number[]; category: string; solo?: boolean; noImpact?: boolean }[] = [
  { id: "auffahrunfall", circumstances: [7], category: "two_vehicle" },
  { id: "spurwechsel", circumstances: [8, 9], category: "two_vehicle" },
  { id: "ueberholen", circumstances: [10], category: "two_vehicle" },
  { id: "kreisel", circumstances: [5, 6], category: "two_vehicle" },
  { id: "kreuzung_von_rechts", circumstances: [15], category: "two_vehicle" },
  { id: "kreuzung_vortritt", circumstances: [16], category: "two_vehicle" },
  { id: "links_abbiegen", circumstances: [12], category: "two_vehicle" },
  { id: "rechts_abbiegen", circumstances: [11], category: "two_vehicle" },
  { id: "rueckwaerts", circumstances: [13], category: "two_vehicle" },
  { id: "ein_ausparken", circumstances: [1, 2, 3, 4], category: "two_vehicle" },
  { id: "parkiert_getroffen", circumstances: [0], category: "two_vehicle" },
  { id: "gegenfahrbahn", circumstances: [14], category: "two_vehicle" },
  { id: "tueroeffnen", circumstances: [1], category: "two_vehicle" },
  { id: "hindernis", circumstances: [], category: "one_vehicle", solo: true },
  { id: "parkiert_ohne_halter", circumstances: [], category: "one_vehicle" },
  { id: "ausweichen", circumstances: [], category: "one_vehicle", noImpact: true },
  { id: "tier", circumstances: [], category: "one_vehicle", solo: true },
];

export function suggestScenario(checkedCircumstances: number[]): ScenarioId | null {
  for (const def of SCENARIO_DEFINITIONS) {
    if (def.circumstances.some((c) => checkedCircumstances.includes(c))) return def.id;
  }
  return null;
}

export function getDefaultElements(scenario: ScenarioId): { layout: StructuredSketch["layout"]; elements: SketchElement[]; note: string } {
  const layouts: Record<ScenarioId, { layout: StructuredSketch["layout"]; elements: SketchElement[]; note: string }> = {
    auffahrunfall: {
      layout: { type: "strasse_gerade", lanes_per_direction: 1 },
      elements: [
        { kind: "vehicle", party: "B", x: 0.4, y: 0.5, rotation: 0, state: "haltend" },
        { kind: "vehicle", party: "A", x: 0.55, y: 0.5, rotation: 0, state: "fahrend" },
        { kind: "arrow", party: "A", from: [0.65, 0.5], to: [0.58, 0.5] },
        { kind: "impact", x: 0.47, y: 0.5 },
      ],
      note: "",
    },
    spurwechsel: {
      layout: { type: "strasse_gerade", lanes_per_direction: 2 },
      elements: [
        { kind: "vehicle", party: "A", x: 0.3, y: 0.35, rotation: 0, state: "fahrend" },
        { kind: "vehicle", party: "B", x: 0.6, y: 0.65, rotation: 0, state: "fahrend" },
        { kind: "arrow", party: "A", from: [0.25, 0.35], to: [0.4, 0.5] },
        { kind: "impact", x: 0.45, y: 0.5 },
      ],
      note: "",
    },
    ueberholen: {
      layout: { type: "strasse_gerade", lanes_per_direction: 1 },
      elements: [
        { kind: "vehicle", party: "B", x: 0.4, y: 0.5, rotation: 0, state: "fahrend" },
        { kind: "vehicle", party: "A", x: 0.55, y: 0.3, rotation: 0, state: "fahrend" },
        { kind: "arrow", party: "A", from: [0.6, 0.3], to: [0.5, 0.3] },
        { kind: "impact", x: 0.5, y: 0.4 },
      ],
      note: "",
    },
    kreisel: {
      layout: { type: "kreisel", lanes_per_direction: 1 },
      elements: [
        { kind: "vehicle", party: "A", x: 0.5, y: 0.35, rotation: 90, state: "fahrend" },
        { kind: "vehicle", party: "B", x: 0.65, y: 0.5, rotation: 180, state: "fahrend" },
        { kind: "impact", x: 0.55, y: 0.45 },
      ],
      note: "",
    },
    kreuzung_von_rechts: {
      layout: { type: "kreuzung", lanes_per_direction: 1 },
      elements: [
        { kind: "vehicle", party: "A", x: 0.5, y: 0.3, rotation: 180, state: "fahrend" },
        { kind: "vehicle", party: "B", x: 0.7, y: 0.5, rotation: 270, state: "fahrend" },
        { kind: "impact", x: 0.5, y: 0.5 },
      ],
      note: "",
    },
    kreuzung_vortritt: {
      layout: { type: "kreuzung", lanes_per_direction: 1 },
      elements: [
        { kind: "vehicle", party: "A", x: 0.5, y: 0.3, rotation: 180, state: "fahrend" },
        { kind: "vehicle", party: "B", x: 0.3, y: 0.5, rotation: 90, state: "fahrend" },
        { kind: "impact", x: 0.5, y: 0.5 },
      ],
      note: "",
    },
    links_abbiegen: {
      layout: { type: "kreuzung", lanes_per_direction: 1 },
      elements: [
        { kind: "vehicle", party: "A", x: 0.5, y: 0.65, rotation: 0, state: "fahrend" },
        { kind: "vehicle", party: "B", x: 0.5, y: 0.3, rotation: 180, state: "fahrend" },
        { kind: "arrow", party: "A", from: [0.5, 0.7], to: [0.35, 0.5] },
        { kind: "impact", x: 0.45, y: 0.5 },
      ],
      note: "",
    },
    rechts_abbiegen: {
      layout: { type: "kreuzung", lanes_per_direction: 1 },
      elements: [
        { kind: "vehicle", party: "A", x: 0.5, y: 0.65, rotation: 0, state: "fahrend" },
        { kind: "vehicle", party: "B", x: 0.7, y: 0.5, rotation: 90, state: "haltend" },
        { kind: "arrow", party: "A", from: [0.5, 0.7], to: [0.65, 0.5] },
        { kind: "impact", x: 0.6, y: 0.55 },
      ],
      note: "",
    },
    rueckwaerts: {
      layout: { type: "strasse_gerade", lanes_per_direction: 1 },
      elements: [
        { kind: "vehicle", party: "A", x: 0.4, y: 0.5, rotation: 180, state: "fahrend" },
        { kind: "vehicle", party: "B", x: 0.3, y: 0.5, rotation: 0, state: "haltend" },
        { kind: "arrow", party: "A", from: [0.45, 0.5], to: [0.35, 0.5] },
        { kind: "impact", x: 0.35, y: 0.5 },
      ],
      note: "",
    },
    ein_ausparken: {
      layout: { type: "parkplatz", lanes_per_direction: 1 },
      elements: [
        { kind: "vehicle", party: "A", x: 0.35, y: 0.4, rotation: 45, state: "fahrend" },
        { kind: "vehicle", party: "B", x: 0.6, y: 0.5, rotation: 0, state: "fahrend" },
        { kind: "impact", x: 0.5, y: 0.45 },
      ],
      note: "",
    },
    parkiert_getroffen: {
      layout: { type: "strasse_gerade", lanes_per_direction: 1 },
      elements: [
        { kind: "vehicle", party: "B", x: 0.3, y: 0.5, rotation: 0, state: "parkiert" },
        { kind: "vehicle", party: "A", x: 0.45, y: 0.5, rotation: 0, state: "fahrend" },
        { kind: "impact", x: 0.37, y: 0.5 },
      ],
      note: "",
    },
    gegenfahrbahn: {
      layout: { type: "strasse_gerade", lanes_per_direction: 1 },
      elements: [
        { kind: "vehicle", party: "A", x: 0.4, y: 0.5, rotation: 0, state: "fahrend" },
        { kind: "vehicle", party: "B", x: 0.6, y: 0.5, rotation: 180, state: "fahrend" },
        { kind: "impact", x: 0.5, y: 0.5 },
      ],
      note: "",
    },
    tueroeffnen: {
      layout: { type: "strasse_gerade", lanes_per_direction: 1 },
      elements: [
        { kind: "vehicle", party: "B", x: 0.35, y: 0.5, rotation: 0, state: "parkiert" },
        { kind: "vehicle", party: "A", x: 0.55, y: 0.5, rotation: 0, state: "fahrend" },
        { kind: "impact", x: 0.42, y: 0.5 },
      ],
      note: "",
    },
    hindernis: {
      layout: { type: "strasse_gerade", lanes_per_direction: 1 },
      elements: [
        { kind: "vehicle", party: "A", x: 0.4, y: 0.5, rotation: 0, state: "fahrend" },
        { kind: "obstacle", type: "wand", x: 0.6, y: 0.5 },
        { kind: "impact", x: 0.5, y: 0.5 },
      ],
      note: "",
    },
    parkiert_ohne_halter: {
      layout: { type: "strasse_gerade", lanes_per_direction: 1 },
      elements: [
        { kind: "vehicle", party: "B", x: 0.3, y: 0.5, rotation: 0, state: "parkiert" },
        { kind: "vehicle", party: "A", x: 0.45, y: 0.5, rotation: 0, state: "fahrend" },
        { kind: "impact", x: 0.37, y: 0.5 },
      ],
      note: "",
    },
    ausweichen: {
      layout: { type: "strasse_gerade", lanes_per_direction: 1 },
      elements: [
        { kind: "vehicle", party: "A", x: 0.5, y: 0.5, rotation: 0, state: "fahrend" },
        { kind: "obstacle", type: "baum", x: 0.3, y: 0.4 },
        { kind: "arrow", party: "A", from: [0.55, 0.5], to: [0.45, 0.35] },
      ],
      note: "",
    },
    tier: {
      layout: { type: "strasse_gerade", lanes_per_direction: 1 },
      elements: [
        { kind: "vehicle", party: "A", x: 0.4, y: 0.5, rotation: 0, state: "fahrend" },
        { kind: "animal", x: 0.55, y: 0.5 },
        { kind: "impact", x: 0.5, y: 0.5 },
      ],
      note: "",
    },
  };
  return layouts[scenario];
}

export const EMPTY_SKETCH: StructuredSketch = {
  version: 1,
  mode: "builder",
  scenario: undefined,
  layout: { type: "strasse_gerade", lanes_per_direction: 1 },
  elements: [],
  streets: { main: "", cross: "" },
  note: "",
};
