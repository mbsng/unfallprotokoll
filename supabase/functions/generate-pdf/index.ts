import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFPage, type PDFFont } from "https://esm.sh/pdf-lib@1.17.1";
import { incidentBelongsToOrg } from "../_shared/incident-export.ts";
import { UPSALA_LOGO_PNG_BASE64 } from "../_shared/upsala-logo.ts";
import { corsHeaders, corsPreflightResponse } from "../_shared/cors.ts";
import { errorBody, normalizeLocale, type AppLocale } from "../_shared/error-response.ts";

const json = (req: Request, body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), "Content-Type": "application/json" } });
const fail = (req: Request, code: string, status: number, locale: AppLocale) => json(req, errorBody(code, locale), status);

const PW = 595.28;
const PH = 841.89;
const MARGIN = 28;
const CONTENT_W = PW - 2 * MARGIN;

const clean = (value: unknown) => {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\u2013\u2014]/g, "-").replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/\u2026/g, "...").replace(/\u20ac/g, "EUR").replace(/[^\x20-\xFF\n]/g, "?");
};

const lines = (font: PDFFont, text: string, size: number, maxWidth: number) => {
  const result: string[] = [];
  for (const paragraph of clean(text).split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
      else { if (current) result.push(current); current = word; }
    }
    result.push(current || " ");
  }
  return result;
};

function drawWrapped(page: PDFPage, font: PDFFont, text: unknown, x: number, y: number, maxWidth: number, size: number, maxLines: number, color = rgb(0.1, 0.1, 0.15)) {
  const wrapped = lines(font, clean(text), size, maxWidth).slice(0, maxLines);
  wrapped.forEach((line, index) => page.drawText(line, { x, y: y - index * (size + 1.5), size, font, color }));
}

function box(page: PDFPage, x: number, y: number, w: number, h: number, fill = rgb(1, 1, 1), border = rgb(0.6, 0.65, 0.7)) {
  page.drawRectangle({ x, y, width: w, height: h, borderWidth: 0.5, borderColor: border, color: fill });
}

function labeledField(page: PDFPage, regular: PDFFont, bold: PDFFont, num: string, label: string, value: unknown, x: number, y: number, w: number, h: number) {
  box(page, x, y, w, h);
  page.drawText(clean(`${num} ${label}`).toUpperCase(), { x: x + 3, y: y + h - 6, size: 4.5, font: bold, color: rgb(0.15, 0.3, 0.45) });
  drawWrapped(page, regular, value, x + 3, y + h - 13, w - 6, 6, Math.floor((h - 15) / 7.5));
}

async function embedImage(pdf: PDFDocument, bytes: Uint8Array, contentType?: string): Promise<PDFImage | null> {
  try {
    if (contentType?.includes("png")) return await pdf.embedPng(bytes);
    if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return await pdf.embedJpg(bytes);
    try { return await pdf.embedPng(bytes); } catch { return await pdf.embedJpg(bytes); }
  } catch { return null; }
}

function drawImageFit(page: PDFPage, image: PDFImage, x: number, y: number, w: number, h: number) {
  const scale = Math.min(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  page.drawImage(image, { x: x + (w - dw) / 2, y: y + (h - dh) / 2, width: dw, height: dh });
}

const CIRCUMSTANCES = [
  "parkte / hielt", "verliess Parkplatz / Tuere", "parkte ein",
  "verliess Parkplatz / Grundstueck", "fuhr in Parkplatz / Grundstueck",
  "Kreisverkehr: fuhr ein", "Kreisverkehr: fuhr darin",
  "Auffahrunfall gleiche Kolonne", "gleiche Richtung, andere Kolonne",
  "wechselte Kolonne", "ueberholte", "bog rechts ab", "bog links ab",
  "setzte zurueck", "Gegenfahrbahn", "kam von rechts (Kreuzung)",
  "Vorfahrt / rote Ampel",
];

const NATURE_EVENT_LABELS: Record<string, string> = {
  hail: "Hagel", storm: "Sturm", flood: "Hochwasser", snow_pressure: "Schneedruck",
  rockfall: "Steinschlag", wildlife: "Wildunfall", marten: "Marderschaden", other: "Sonstiges",
};

const NATURE_PART_LABELS: Record<string, string> = {
  roof: "Dach", hood: "Motorhaube", trunk_lid: "Kofferraumdeckel", windshield: "Frontscheibe",
  rear_window: "Heckscheibe", side_windows: "Seitenscheiben", fender_left: "Kotfluegel links",
  fender_right: "Kotfluegel rechts", doors_left: "Tueren links", doors_right: "Tueren rechts",
  mirrors: "Spiegel", lights: "Beleuchtung", underbody: "Unterboden", other_part: "Sonstiges",
};

const NATURE_HAIL_DENSITY_LABELS: Record<string, string> = { few: "wenige", moderate: "mittel", many: "viele" };
const NATURE_HAIL_SIZE_LABELS: Record<string, string> = { small: "klein", medium: "mittel", large: "gross" };

// --- Document furniture (logo + provenance footer) -------------------------
// The upsala.ch logo is embedded as a base64 constant (shared module) so the
// PDF contains the image bytes directly and never references a URL.
const UPSALA_WORDMARK = "upsala.ch";
const UPSALA_PRIMARY = rgb(0.08, 0.23, 0.4); // app primary #153B66
const UPSALA_ON_DARK = rgb(0.78, 0.86, 0.95);

let upsalaLogoCache: Uint8Array | null = null;
function upsalaLogoBytes(): Uint8Array {
  if (!upsalaLogoCache) {
    upsalaLogoCache = Uint8Array.from(atob(UPSALA_LOGO_PNG_BASE64.replace(/\s+/g, "")), (char) => char.charCodeAt(0));
  }
  return upsalaLogoCache;
}

const LEGAL_NOTE_REPORT = "Dieses Protokoll wurde digital erstellt. Die Unterschrift stellt kein Schuldanerkenntnis dar.";
const LEGAL_NOTE_NATURE = "Diese Schadenmeldung wurde digital erstellt. Die Unterschrift stellt kein Schuldanerkenntnis dar.";

const MAX_LOGO_BYTES = 2_000_000;

// Organization logos are admin-controlled URLs; they are fetched server-side
// once and embedded as bytes into the PDF (the PDF never references a URL).
async function fetchLogoBytes(url: string): Promise<{ bytes: Uint8Array; contentType?: string } | null> {
  try {
    if (!/^https:\/\//i.test(url)) return null;
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.startsWith("image/")) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_LOGO_BYTES) return null;
    return { bytes: new Uint8Array(buffer), contentType: contentType || undefined };
  } catch (error) {
    console.warn("[generate-pdf] Organization logo could not be loaded", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

interface DocumentBranding {
  orgLogo: PDFImage | null;
  orgName: string | null;
  upsalaLogo: PDFImage | null;
}

// Small mark next to the document title. It must never replace the title or
// overlay form fields — it is brand provenance, not a form element.
function drawHeaderMark(page: PDFPage, bold: PDFFont, title: string, branding: DocumentBranding) {
  const titleWidth = bold.widthOfTextAtSize(clean(title), 13);
  const x = MARGIN + titleWidth + 10;
  const logo = branding.orgLogo ?? branding.upsalaLogo;
  if (logo) {
    const height = 14;
    const width = Math.min(logo.width * (height / logo.height), 60);
    page.drawImage(logo, { x, y: PH - 22, width, height });
    return;
  }
  page.drawText(UPSALA_WORDMARK, { x, y: PH - 19, size: 8, font: bold, color: UPSALA_ON_DARK });
}

// Slim provenance footer on EVERY page, clearly separated from the form body:
// left logo/wordmark, centered provenance, right case meta + page numbers,
// plus a small legal line. Muted colour, ~7pt, so it never competes with the
// standardised form.
function drawProvenanceFooters(
  pdf: PDFDocument,
  style: { regular: PDFFont; bold: PDFFont; shareCode: string; createdLabel: string; descriptor: string; legalNote: string },
  branding: DocumentBranding,
) {
  const pages = pdf.getPages();
  const muted = rgb(0.42, 0.47, 0.52);
  const hairline = rgb(0.83, 0.87, 0.91);
  pages.forEach((page, index) => {
    page.drawLine({ start: { x: MARGIN, y: 27 }, end: { x: PW - MARGIN, y: 27 }, thickness: 0.5, color: hairline });

    const baseLine = 15;
    let left = MARGIN;
    if (branding.orgLogo) {
      const height = 15;
      const width = Math.min(branding.orgLogo.width * (height / branding.orgLogo.height), 90);
      page.drawImage(branding.orgLogo, { x: left, y: baseLine - 4.5, width, height });
      left += width + 5;
      if (branding.orgName) {
        const name = clean(branding.orgName);
        page.drawText(name, { x: left, y: baseLine, size: 6.5, font: style.regular, color: muted });
        left += style.regular.widthOfTextAtSize(name, 6.5) + 5;
      }
    } else {
      if (branding.upsalaLogo) {
        const height = 16; // ~6 mm
        const width = Math.min(branding.upsalaLogo.width * (height / branding.upsalaLogo.height), 70);
        page.drawImage(branding.upsalaLogo, { x: left, y: baseLine - 5, width, height });
        left += width + 4;
      }
      page.drawText(UPSALA_WORDMARK, { x: left, y: baseLine, size: 9, font: style.bold, color: UPSALA_PRIMARY });
      left += style.bold.widthOfTextAtSize(UPSALA_WORDMARK, 9) + 5;
    }

    // White-labelled documents keep upsala.ch as a smaller tool reference only.
    const centerSize = branding.orgLogo ? 6 : 7;
    const centerText = branding.orgLogo ? "Erstellt mit upsala.ch" : `Erstellt mit upsala.ch · ${style.descriptor}`;
    page.drawText(centerText, { x: PW / 2 - style.regular.widthOfTextAtSize(centerText, centerSize) / 2, y: baseLine, size: centerSize, font: style.regular, color: muted });

    const rightText = `Fall ${clean(style.shareCode)} · ${style.createdLabel} · Seite ${index + 1} von ${pages.length}`;
    page.drawText(rightText, { x: PW - MARGIN - style.regular.widthOfTextAtSize(rightText, 6.5), y: baseLine, size: 6.5, font: style.regular, color: muted });

    page.drawText(style.legalNote, { x: PW / 2 - style.regular.widthOfTextAtSize(style.legalNote, 5.5) / 2, y: 5, size: 5.5, font: style.regular, color: muted });
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse(req);
  let locale = normalizeLocale(req.headers.get("accept-language"));
  if (req.method !== "POST") return fail(req, "method_not_allowed", 405, locale);
  try {
    const body = await req.json();
    locale = normalizeLocale(body.locale ?? locale);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return fail(req, "unauthorized", 401, locale);
    const token = authHeader.slice(7);
    const incidentId = body.incidentId as string;
    if (!incidentId || !/^[0-9a-f-]{36}$/i.test(incidentId)) return fail(req, "invalid_incident", 400, locale);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return fail(req, "unauthorized", 401, locale);

    const [{ data: incident, error: incidentError }, { data: parties, error: partiesError }, { data: witnesses }, { data: media }] = await Promise.all([
      service.from("incidents").select("*").eq("id", incidentId).single(),
      service.from("incident_parties").select("*").eq("incident_id", incidentId).order("party_label"),
      service.from("incident_witnesses").select("name, contact").eq("incident_id", incidentId),
      service.from("incident_media").select("storage_path, kind, taken_at, party_id").eq("incident_id", incidentId).order("uploaded_at"),
    ]);
    if (incidentError || partiesError || !incident || !parties) return fail(req, "not_found", 404, locale);

    let submissionParty = parties.find((p) => p.profile_id === authData.user.id);
    if (!submissionParty) {
      const { data: requester } = await service.from("profiles").select("org_id, role").eq("id", authData.user.id).maybeSingle();
      if (requester?.org_id && ["fleet_manager", "admin"].includes(requester.role) && await incidentBelongsToOrg(service, incidentId, requester.org_id)) {
        const partyProfileIds = parties.map((p) => p.profile_id).filter(Boolean);
        const { data: orgProfile } = await service.from("profiles").select("id").eq("org_id", requester.org_id).in("id", partyProfileIds).limit(1).maybeSingle();
        submissionParty = parties.find((p) => p.profile_id === orgProfile?.id);
      }
    }
    if (!submissionParty) return fail(req, "forbidden", 403, locale);

    // The only document gate: the requesting party's own signed_at.
    // Counterpart signatures, incident status, Realtime and Outbox state are
    // deliberately irrelevant to PDF generation.
    if (!submissionParty.signed_at) {
      return fail(req, "own_signature_required", 409, locale);
    }

    // Determine completeness — the derived incident status is maintained
    // exclusively by the sync_incident_status_from_parties DB trigger.
    const realParties = parties.filter((p) => p.profile_id);
    const unsignedParties = realParties.filter((p) => !p.signed_at);
    const completeness = unsignedParties.length === 0 ? "vollstaendig" : "einseitig";

    // White-label branding: if the requesting user belongs to an organization
    // with its own logo, that logo leads and upsala.ch appears only as the
    // creating tool — never as a party of the accident or an insurer.
    const { data: requesterProfile } = await service.from("profiles").select("org_id").eq("id", authData.user.id).maybeSingle();
    let orgLogoBytes: { bytes: Uint8Array; contentType?: string } | null = null;
    let orgName: string | null = null;
    if (requesterProfile?.org_id) {
      const { data: organization } = await service.from("organizations").select("name, branding_json").eq("id", requesterProfile.org_id).maybeSingle();
      const logoUrl = typeof organization?.branding_json?.logo_url === "string" ? organization.branding_json.logo_url.trim() : "";
      orgName = organization?.name ?? null;
      orgLogoBytes = logoUrl ? await fetchLogoBytes(logoUrl) : null;
    }
    const createdLabel = new Date().toLocaleDateString("de-CH");

    const downloaded = new Map<string, { bytes: Uint8Array; contentType?: string }>();
    for (const item of media ?? []) {
      const { data, error } = await service.storage.from("incident-media").download(item.storage_path);
      if (!error && data) downloaded.set(item.storage_path, { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type });
    }

    // Nature reports ("Wetter, Natur und Tier") get their own lean A4 damage
    // report instead of the European accident protocol. It deliberately shares
    // the head bar, footer, photo appendix and vehicle/insurance blocks with
    // the collision format so both documents read as one family.
    if (incident.report_type === "nature") {
      const details = (incident.type_details ?? {}) as Record<string, unknown>;
      const eventType = String(details.eventType ?? "other");
      const selectedParts = Array.isArray(details.parts) ? (details.parts as string[]) : [];
      const isWeatherPeriod = ["hail", "storm", "flood", "snow_pressure", "rockfall"].includes(eventType);
      const periodFrom = String(details.periodFrom ?? "");
      const periodTo = String(details.periodTo ?? "");
      const timeValue = isWeatherPeriod
        ? [periodFrom, periodTo].filter(Boolean).join(" - ")
        : incident.occurred_at ? new Date(incident.occurred_at).toLocaleString("de-CH") : "";

      const pdf = await PDFDocument.create();
      pdf.setTitle(`Schadenmeldung ${incident.share_code}`);
      pdf.setCreationDate(new Date());
      const regular = await pdf.embedFont(StandardFonts.Helvetica);
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const branding: DocumentBranding = {
        orgLogo: orgLogoBytes ? await embedImage(pdf, orgLogoBytes.bytes, orgLogoBytes.contentType) : null,
        upsalaLogo: await embedImage(pdf, upsalaLogoBytes(), "image/png"),
        orgName,
      };
      const page = pdf.addPage([PW, PH]);
      const navy = rgb(0.08, 0.23, 0.4);
      const blueA = rgb(0.05, 0.27, 0.49);

      page.drawRectangle({ x: 0, y: PH - 30, width: PW, height: 30, color: navy });
      page.drawText("SCHADENMELDUNG", { x: MARGIN, y: PH - 20, size: 13, font: bold, color: rgb(1, 1, 1) });
      drawHeaderMark(page, bold, "SCHADENMELDUNG", branding);
      page.drawText(`Fall ${clean(incident.share_code)}`, { x: PW - 110, y: PH - 14, size: 6, font: regular, color: rgb(0.85, 0.9, 1) });

      let y = PH - 34;
      const gap = 3;
      const headH = 30;
      const wHalf = (CONTENT_W - gap) / 2;
      const w1 = CONTENT_W * 0.34;
      const w2 = CONTENT_W * 0.38;
      const w3 = CONTENT_W - w1 - w2 - 2 * gap;
      labeledField(page, regular, bold, "1", "Ereignisart", NATURE_EVENT_LABELS[eventType] ?? eventType, MARGIN, y - headH, w1, headH);
      labeledField(page, regular, bold, "2", isWeatherPeriod ? "Zeitraum (von - bis)" : "Zeitpunkt", timeValue, MARGIN + w1 + gap, y - headH, w2, headH);
      labeledField(page, regular, bold, "3", "Schaden entdeckt am", details.discoveredOn ?? "", MARGIN + w1 + w2 + 2 * gap, y - headH, w3, headH);
      y -= headH + gap;
      labeledField(page, regular, bold, "4", "Ort / GPS", incident.location_text ?? "", MARGIN, y - headH, wHalf, headH);
      labeledField(page, regular, bold, "5", "Abstellort", details.parking ?? "", MARGIN + wHalf + gap, y - headH, wHalf, headH);
      y -= headH + gap + 2;

      const partKeys = Object.keys(NATURE_PART_LABELS);
      const rows = Math.ceil(partKeys.length / 2);
      const partRowH = 11;
      const hailExtra = eventType === "hail" ? 26 : 0;
      const partsH = 16 + rows * partRowH + 6 + hailExtra;
      box(page, MARGIN, y - partsH, CONTENT_W, partsH);
      page.drawText("BETROFFENE FAHRZEUGTEILE", { x: MARGIN + 4, y: y - 10, size: 6, font: bold, color: navy });
      partKeys.forEach((key, index) => {
        const column = index < rows ? 0 : 1;
        const rowIndex = index < rows ? index : index - rows;
        const px = MARGIN + 6 + column * (CONTENT_W / 2 - 4);
        const py = y - 22 - rowIndex * partRowH;
        const checked = selectedParts.includes(key);
        page.drawRectangle({ x: px, y: py - 2, width: 5, height: 5, borderWidth: 0.4, borderColor: navy, color: checked ? blueA : rgb(1, 1, 1) });
        page.drawText(`${checked ? "X" : "-"} ${NATURE_PART_LABELS[key]}`, { x: px + 8, y: py, size: 5.5, font: checked ? bold : regular, color: rgb(0.12, 0.14, 0.18) });
      });
      if (eventType === "hail") {
        const density = String(details.hailDensity ?? "");
        const hailSize = String(details.hailSize ?? "");
        page.drawText(`Hagel: Einschlagstellen: ${NATURE_HAIL_DENSITY_LABELS[density] ?? "-"} | Groesse der Hagelkoerner: ${NATURE_HAIL_SIZE_LABELS[hailSize] ?? "-"}`, { x: MARGIN + 6, y: y - partsH + 6, size: 5.5, font: bold, color: blueA });
      }
      y -= partsH + gap;

      const descH = 52;
      box(page, MARGIN, y - descH, CONTENT_W, descH);
      page.drawText("SCHADENBESCHREIBUNG", { x: MARGIN + 4, y: y - 10, size: 6, font: bold, color: navy });
      drawWrapped(page, regular, submissionParty.damage_description ?? "", MARGIN + 4, y - 19, CONTENT_W - 8, 6, 4);
      const naturePhotoCount = (media ?? []).filter((item: { kind: string }) => item.kind === "photo").length;
      page.drawText(clean(`Siehe Fotoanhang, ${naturePhotoCount} Aufnahmen`), { x: MARGIN + 4, y: y - descH + 4, size: 4.5, font: bold, color: navy });
      y -= descH + gap;

      page.drawRectangle({ x: MARGIN, y: y - 12, width: CONTENT_W, height: 12, color: blueA });
      page.drawText(`FAHRZEUG ${clean(submissionParty.party_label)}`, { x: MARGIN + 3, y: y - 9, size: 6.5, font: bold, color: rgb(1, 1, 1) });
      y -= 14;
      const natureDriver = (submissionParty.driver_json ?? {}) as Record<string, unknown>;
      const natureVehicle = (submissionParty.vehicle_json ?? {}) as Record<string, unknown>;
      const natureInsurance = (submissionParty.insurance_json ?? {}) as Record<string, unknown>;
      labeledField(page, regular, bold, "6", "Versicherungsnehmer", [natureDriver.fullName, natureDriver.address, natureDriver.phone].filter(Boolean).join("\n"), MARGIN, y - 40, wHalf, 40);
      labeledField(page, regular, bold, "7", "Fahrzeug / Kennzeichen", [natureVehicle.makeModel, natureVehicle.plate].filter(Boolean).join(" - "), MARGIN + wHalf + gap, y - 40, wHalf, 40);
      y -= 42;
      labeledField(page, regular, bold, "8", "Versicherung", [natureInsurance.company, natureInsurance.policyNumber].filter(Boolean).join(" - "), MARGIN, y - 26, wHalf, 26);
      labeledField(page, regular, bold, "9", "Fahrer", [natureDriver.fullName, natureDriver.address, natureDriver.phone].filter(Boolean).join("\n"), MARGIN + wHalf + gap, y - 26, wHalf, 26);
      y -= 28;

      const sigH = 78;
      box(page, MARGIN, y - sigH, CONTENT_W, sigH);
      page.drawText(`15 UNTERSCHRIFT ${clean(submissionParty.party_label)}`, { x: MARGIN + 4, y: y - 6, size: 5, font: bold, color: navy });
      const natureSigItem = (media ?? []).find((item: { storage_path: string }) => item.storage_path.includes(`/${submissionParty.id}/signature.`));
      if (natureSigItem && downloaded.has(natureSigItem.storage_path)) {
        const stored = downloaded.get(natureSigItem.storage_path)!;
        const img = await embedImage(pdf, stored.bytes, stored.contentType);
        if (img) drawImageFit(page, img, MARGIN + 8, y - sigH + 10, CONTENT_W - 16, sigH - 26);
      }
      page.drawText(`Signiert: ${submissionParty.signed_at ? new Date(submissionParty.signed_at).toLocaleString("de-CH") : ""}`, { x: MARGIN + 4, y: y - sigH + 4, size: 4, font: regular, color: rgb(0.35, 0.4, 0.45) });

      const photos = (media ?? []).filter((item: { kind: string }) => item.kind === "photo");
      for (let index = 0; index < photos.length; index += 4) {
        const pPage = pdf.addPage([PW, PH]);
        pPage.drawText(`FOTOANHANG - FALL ${clean(incident.share_code)}`, { x: MARGIN, y: PH - 28, size: 12, font: bold, color: navy });
        for (let slot = 0; slot < 4; slot++) {
          const item = photos[index + slot];
          if (!item) break;
          const px = slot % 2 === 0 ? MARGIN : MARGIN + (CONTENT_W / 2) + 2;
          const py = slot < 2 ? PH - MARGIN - 320 : PH - MARGIN - 640;
          const photoW = CONTENT_W / 2 - 2;
          const photoH = 310;
          box(pPage, px, py, photoW, photoH);
          const stored = downloaded.get(item.storage_path);
          const photoImage = stored ? await embedImage(pdf, stored.bytes, stored.contentType) : null;
          if (photoImage) drawImageFit(pPage, photoImage, px + 6, py + 22, photoW - 12, photoH - 36);
          else pPage.drawText("BILD NICHT VERFUEGBAR", { x: px + photoW / 2 - 32, y: py + photoH / 2, size: 7, font: bold, color: rgb(0.7, 0.3, 0.3) });
          const takenLabel = item.taken_at ? ` - ${new Date(item.taken_at).toLocaleString("de-CH")}` : "";
          pPage.drawText(`Foto ${index + slot + 1} - Partei ${clean(submissionParty.party_label)}${takenLabel}`, { x: px + 6, y: py + 8, size: 5.5, font: regular, color: rgb(0.3, 0.35, 0.4) });
        }
      }

      drawProvenanceFooters(pdf, { regular, bold, shareCode: incident.share_code, createdLabel, descriptor: "Digitale Schadenmeldung", legalNote: LEGAL_NOTE_NATURE }, branding);

      const pdfBytes = await pdf.save();
      const storagePath = `${incidentId}/schadenmeldung-${incident.share_code}.pdf`;
      const { error: uploadError } = await service.storage.from("incident-pdfs").upload(storagePath, pdfBytes, { upsert: true, contentType: "application/pdf" });
      if (uploadError) throw uploadError;

      const { data: existing } = await service.from("submissions").select("id, status").eq("incident_id", incidentId).eq("party_id", submissionParty.id).maybeSingle();
      let submissionId: string;
      if (existing) {
        const { data: updatedSubmission, error: submissionUpdateError } = await service.from("submissions").update({ pdf_storage_path: storagePath }).eq("id", existing.id).select("id").maybeSingle();
        if (submissionUpdateError) throw submissionUpdateError;
        if (!updatedSubmission) throw new Error("submission_update_zero_rows");
        submissionId = updatedSubmission.id;
      } else {
        const { data: sub, error: subErr } = await service.from("submissions").insert({ incident_id: incidentId, party_id: submissionParty.id, target: "pending", status: "generated", pdf_storage_path: storagePath }).select("id").single();
        if (subErr) throw subErr;
        submissionId = sub.id;
      }

      const { data: signed, error: signError } = await service.storage.from("incident-pdfs").createSignedUrl(storagePath, 3600, { download: `Schadenmeldung-${incident.share_code}.pdf` });
      if (signError) throw signError;
      console.log("[generate-pdf] Nature damage report generated", { incidentId, submissionId, photoCount: photos.length, format: "A4-portrait" });
      return json(req, { submissionId, storagePath, downloadUrl: signed.signedUrl, completeness: "vollstaendig" });
    }

    const pdf = await PDFDocument.create();
    pdf.setTitle(`Verkehrsunfall-Bericht ${incident.share_code}`);
    pdf.setCreationDate(new Date());
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const branding: DocumentBranding = {
      orgLogo: orgLogoBytes ? await embedImage(pdf, orgLogoBytes.bytes, orgLogoBytes.contentType) : null,
      upsalaLogo: await embedImage(pdf, upsalaLogoBytes(), "image/png"),
      orgName,
    };
    const page = pdf.addPage([PW, PH]);
    const navy = rgb(0.08, 0.23, 0.4);
    const blueA = rgb(0.05, 0.27, 0.49);
    const blueA_light = rgb(0.71, 0.83, 0.96);
    const yellowB = rgb(0.39, 0.22, 0.02);
    const yellowB_light = rgb(0.98, 0.78, 0.46);

    page.drawRectangle({ x: 0, y: PH - 30, width: PW, height: 30, color: navy });
    page.drawText("VERKEHRSUNFALL-BERICHT", { x: MARGIN, y: PH - 20, size: 13, font: bold, color: rgb(1, 1, 1) });
    drawHeaderMark(page, bold, "VERKEHRSUNFALL-BERICHT", branding);
    // Unilateral notice banner
    if (completeness === "einseitig") {
      const unsignedLabels = unsignedParties.map((p) => p.party_label).join(", ");
      page.drawRectangle({ x: MARGIN, y: PH - 38, width: CONTENT_W, height: 10, color: rgb(0.95, 0.85, 0.3) });
      page.drawText(`EINSEITIG ERFASST - Partei ${unsignedLabels} hat dieses Protokoll nicht bestaetigt`, { x: MARGIN + 4, y: PH - 35, size: 6, font: bold, color: rgb(0.4, 0.3, 0) });
    }
    page.drawText(`Fall ${clean(incident.share_code)}`, { x: PW - 110, y: PH - 14, size: 6, font: regular, color: rgb(0.85, 0.9, 1) });

    let y = PH - 34;
    const headH = 28;
    const fieldGap = 2;
    const fw = (CONTENT_W - 4 * fieldGap) / 5;
    labeledField(page, regular, bold, "1", "Datum / Zeit", incident.occurred_at ? new Date(incident.occurred_at).toLocaleString("de-CH") : "", MARGIN, y - headH, fw, headH);
    labeledField(page, regular, bold, "2", "Ort", incident.location_text, MARGIN + fw + fieldGap, y - headH, fw, headH);
    labeledField(page, regular, bold, "3", "Verletzte", incident.circumstances_json?.injured ? "Ja" : "Nein", MARGIN + 2 * (fw + fieldGap), y - headH, fw * 0.7, headH);
    labeledField(page, regular, bold, "4", "Sachschaden", incident.circumstances_json?.otherDamage ? "Ja" : "Nein", MARGIN + 2 * (fw + fieldGap) + fw * 0.7 + fieldGap, y - headH, fw * 0.7, headH);
    labeledField(page, regular, bold, "5", "Zeugen", (witnesses ?? []).map((w) => [w.name, w.contact].filter(Boolean).join(" ")).join("; "), MARGIN + 2 * (fw + fieldGap) + 2 * (fw * 0.7 + fieldGap), y - headH, fw * 1.1, headH);
    y -= headH + 3;

    const colGap = 3;
    const colW = (CONTENT_W - 2 * colGap) / 3;
    const colLeft = MARGIN;
    const colMid = MARGIN + colW + colGap;
    const colRight = MARGIN + 2 * (colW + colGap);
    const partyA = parties.find((p) => p.party_label === "A") ?? parties[0];
    const partyB = parties.find((p) => p.party_label === "B");

    const drawPartyColumn = (party: Record<string, unknown> | undefined, x: number, headColor: typeof blueA) => {
      if (!party) return;
      const isUnsigned = !party.signed_at;
      let cy = y;
      const hBar = 12;
      page.drawRectangle({ x, y: cy - hBar, width: colW, height: hBar, color: headColor });
      page.drawText(`FAHRZEUG ${clean(party.party_label)}${isUnsigned ? " (NICHT BESTAETIGT)" : ""}`, { x: x + 3, y: cy - 9, size: isUnsigned ? 5 : 6.5, font: bold, color: rgb(1, 1, 1) });
      cy -= hBar;
      if (isUnsigned) {
        page.drawText(`Angaben erfasst von Partei ${clean(party.party_label)} - nicht bestaetigt`, { x: x + 2, y: cy - 3, size: 3.5, font: regular, color: rgb(0.6, 0.5, 0) });
        cy -= 6;
      }
      const d = party.driver_json as Record<string, unknown> ?? {};
      const v = party.vehicle_json as Record<string, unknown> ?? {};
      const ins = party.insurance_json as Record<string, unknown> ?? {};
      labeledField(page, regular, bold, "6", "Versicherungsnehmer", [d.fullName, d.address, d.phone].filter(Boolean).join("\n"), x, cy - 40, colW, 40); cy -= 42;
      labeledField(page, regular, bold, "7", "Fahrzeug / Kennzeichen", [v.makeModel, v.plate].filter(Boolean).join(" - "), x, cy - 26, colW, 26); cy -= 28;
      labeledField(page, regular, bold, "8", "Versicherung", [ins.company, ins.policyNumber].filter(Boolean).join(" - "), x, cy - 26, colW, 26); cy -= 28;
      labeledField(page, regular, bold, "9", "Fahrer", [d.fullName, d.address, d.phone].filter(Boolean).join("\n"), x, cy - 36, colW, 36); cy -= 38;
      labeledField(page, regular, bold, "10", "Aufprallpunkt", "(siehe Skizze)", x, cy - 14, colW, 14); cy -= 16;
      labeledField(page, regular, bold, "11", "Sichtbare Schaeden", party.damage_description, x, cy - 42, colW, 42); cy -= 44;
      labeledField(page, regular, bold, "14", "Bemerkungen", "", x, cy - 24, colW, 24);
      const partyPhotoCount = (media ?? []).filter((item: { kind: string; party_id: string }) => item.kind === "photo" && item.party_id === party.id).length;
      page.drawText(clean(`Siehe Fotoanhang, ${partyPhotoCount} Aufnahmen`), { x: x + 2, y: cy - 28, size: 4, font: bold, color: navy });
    };

    drawPartyColumn(partyA, colLeft, blueA);
    drawPartyColumn(partyB, colRight, yellowB);

    const mx = colMid;
    let my = y;
    page.drawRectangle({ x: mx, y: my - 12, width: colW, height: 12, color: rgb(0.9, 0.92, 0.95) });
    page.drawText("12 UNFALLUMSTAENDE", { x: mx + 3, y: my - 9, size: 6.5, font: bold, color: navy });
    my -= 14;
    const rowH = 10.5;
    CIRCUMSTANCES.forEach((label, index) => {
      const checkedA = (partyA?.circumstances_checked ?? []).includes(index);
      const checkedB = partyB ? (partyB.circumstances_checked ?? []).includes(index) : false;
      const rowY = my - index * rowH;
      page.drawRectangle({ x: mx + 2, y: rowY - 2.5, width: 5, height: 5, borderWidth: 0.3, borderColor: navy, color: checkedA ? blueA : rgb(1, 1, 1) });
      page.drawRectangle({ x: mx + colW - 7, y: rowY - 2.5, width: 5, height: 5, borderWidth: 0.3, borderColor: navy, color: checkedB ? yellowB : rgb(1, 1, 1) });
      page.drawText(`${index + 1}. ${clean(label)}`, { x: mx + 10, y: rowY, size: 4, font: regular, color: rgb(0.12, 0.14, 0.18) });
    });
    my -= CIRCUMSTANCES.length * rowH + 3;
    const countA = (partyA?.circumstances_checked ?? []).length;
    const countB = partyB ? (partyB?.circumstances_checked ?? []).length : 0;
    page.drawText("Anzahl:", { x: mx + 2, y: my, size: 4.5, font: bold, color: rgb(0.15, 0.18, 0.22) });
    page.drawRectangle({ x: mx + 24, y: my - 2.5, width: 10, height: 7, borderWidth: 0.3, borderColor: navy });
    page.drawText(String(countA), { x: mx + 27, y: my, size: 5, font: bold, color: blueA });
    page.drawRectangle({ x: mx + colW - 34, y: my - 2.5, width: 10, height: 7, borderWidth: 0.3, borderColor: navy });
    page.drawText(String(countB), { x: mx + colW - 31, y: my, size: 5, font: bold, color: yellowB });

    y = MARGIN + 230;
    const sketchH = 140;
    box(page, MARGIN, y, CONTENT_W, sketchH);
    page.drawText("13 SKIZZE DES UNFALLS", { x: MARGIN + 4, y: y + sketchH - 7, size: 6, font: bold, color: navy });
    page.drawText("Fahrspuren, Fahrtrichtung, Aufprallposition, Strassennamen", { x: MARGIN + 4, y: y + sketchH - 15, size: 4, font: regular, color: rgb(0.4, 0.45, 0.5) });

    let sketchDrawn = false;
    if (incident.sketch_data_url) {
      const sketchVal = incident.sketch_data_url;
      if (sketchVal.startsWith("{")) {
        try {
          const structured = JSON.parse(sketchVal);
          const sx = MARGIN + 4;
          const sy = y + 4;
          const sw = CONTENT_W - 8;
          const sh = sketchH - 24;
          page.drawRectangle({ x: sx, y: sy + sh * 0.3, width: sw, height: sh * 0.4, color: rgb(0.82, 0.82, 0.82) });
          for (const el of (structured.elements ?? [])) {
            const ex = sx + (el.x ?? 0.5) * sw;
            const ey = sy + (1 - (el.y ?? 0.5)) * sh;
            if (el.kind === "vehicle") {
              const isA = el.party === "A";
              const dark = isA ? blueA : yellowB;
              const light = isA ? blueA_light : yellowB_light;
              page.drawRectangle({ x: ex - 4, y: ey - 2.5, width: 8, height: 5, color: light, borderColor: dark, borderWidth: 0.4 });
              page.drawRectangle({ x: ex - 4, y: ey - 2.5, width: 8, height: 1.5, color: dark });
              page.drawText(el.party ?? "?", { x: ex - 1.2, y: ey - 0.8, size: 3.5, font: bold, color: dark });
            } else if (el.kind === "impact") {
              page.drawLine({ start: { x: ex - 2, y: ey + 2 }, end: { x: ex + 2, y: ey - 2 }, thickness: 0.8, color: rgb(0.8, 0, 0) });
              page.drawLine({ start: { x: ex - 2, y: ey - 2 }, end: { x: ex + 2, y: ey + 2 }, thickness: 0.8, color: rgb(0.8, 0, 0) });
            } else if (el.kind === "arrow") {
              const fx = sx + (el.from?.[0] ?? 0.5) * sw;
              const fy = sy + (1 - (el.from?.[1] ?? 0.5)) * sh;
              const tx = sx + (el.to?.[0] ?? el.x ?? 0.5) * sw;
              const ty = sy + (1 - (el.to?.[1] ?? el.y ?? 0.5)) * sh;
              page.drawLine({ start: { x: fx, y: fy }, end: { x: tx, y: ty }, thickness: 0.6, color: el.party === "A" ? blueA : yellowB });
            }
          }
          if (structured.streets?.main) page.drawText(clean(structured.streets.main), { x: sx + sw / 2, y: sy + 2, size: 3.5, font: regular, color: rgb(0.2, 0.2, 0.2) });
          sketchDrawn = true;
        } catch { /* fall through */ }
      }
      if (!sketchDrawn) {
        try {
          const base64 = sketchVal.split(",")[1] ?? sketchVal;
          const sketchBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          const img = await embedImage(pdf, sketchBytes, "image/png");
          if (img) { drawImageFit(page, img, MARGIN + 4, y + 4, CONTENT_W - 8, sketchH - 24); sketchDrawn = true; }
        } catch { /* fall through */ }
      }
    }
    if (!sketchDrawn) {
      const sketchItem = (media ?? []).find((item) => item.kind === "sketch" || item.storage_path.endsWith("/sketch.png"));
      if (sketchItem && downloaded.has(sketchItem.storage_path)) {
        const stored = downloaded.get(sketchItem.storage_path)!;
        const img = await embedImage(pdf, stored.bytes, stored.contentType);
        if (img) drawImageFit(page, img, MARGIN + 4, y + 4, CONTENT_W - 8, sketchH - 24);
      }
    }

    y = MARGIN + 5;
    const sigH = 85;
    const sigW = (CONTENT_W - 4) / 2;
    const drawSig = async (party: Record<string, unknown> | undefined, x: number) => {
      box(page, x, y, sigW, sigH);
      page.drawText(`15 UNTERSCHRIFT ${clean(party?.party_label)}`, { x: x + 4, y: y + sigH - 6, size: 5, font: bold, color: navy });
      page.drawText("Von BEIDEN Fahrern zu unterzeichnen", { x: x + 4, y: y + sigH - 13, size: 3.5, font: regular, color: rgb(0.4, 0.45, 0.5) });
      if (party) {
        if (party.signed_at) {
          const sigItem = (media ?? []).find((item) => item.storage_path.includes(`/${party.id}/signature.`));
          if (sigItem && downloaded.has(sigItem.storage_path)) {
            const stored = downloaded.get(sigItem.storage_path)!;
            const img = await embedImage(pdf, stored.bytes, stored.contentType);
            if (img) drawImageFit(page, img, x + 6, y + 8, sigW - 12, sigH - 24);
          }
          page.drawText(`Signiert: ${clean(party.signed_at ? new Date(party.signed_at as string).toLocaleString("de-CH") : "")}`, { x: x + 4, y: y + 3, size: 4, font: regular, color: rgb(0.35, 0.4, 0.45) });
        } else {
          page.drawText("KEINE UNTERSCHRIFT", { x: x + sigW / 2 - 20, y: y + sigH / 2, size: 7, font: bold, color: rgb(0.7, 0.3, 0.3) });
          page.drawText(`Partei ${clean(party.party_label)} hat nicht unterschrieben`, { x: x + 4, y: y + 3, size: 3.5, font: regular, color: rgb(0.7, 0.3, 0.3) });
        }
      }
    };
    await drawSig(partyA, MARGIN);
    await drawSig(partyB, MARGIN + sigW + 4);

    const photos = (media ?? []).filter((item) => item.kind === "photo");
    for (let index = 0; index < photos.length; index += 4) {
      const pPage = pdf.addPage([PW, PH]);
      pPage.drawText(`FOTOANHANG - FALL ${clean(incident.share_code)}`, { x: MARGIN, y: PH - 28, size: 12, font: bold, color: navy });
      for (let slot = 0; slot < 4; slot++) {
        const item = photos[index + slot];
        if (!item) break;
        const px = slot % 2 === 0 ? MARGIN : MARGIN + (CONTENT_W / 2) + 2;
        const py = slot < 2 ? PH - MARGIN - 320 : PH - MARGIN - 640;
        const photoW = CONTENT_W / 2 - 2;
        const photoH = 310;
        const ownerParty = parties.find((p) => p.id === item.party_id);
        box(pPage, px, py, photoW, photoH);
        const stored = downloaded.get(item.storage_path);
        const photoImage = stored ? await embedImage(pdf, stored.bytes, stored.contentType) : null;
        if (photoImage) drawImageFit(pPage, photoImage, px + 6, py + 22, photoW - 12, photoH - 36);
        else pPage.drawText("BILD NICHT VERFUEGBAR", { x: px + photoW / 2 - 32, y: py + photoH / 2, size: 7, font: bold, color: rgb(0.7, 0.3, 0.3) });
        const takenLabel = item.taken_at ? ` - ${new Date(item.taken_at).toLocaleString("de-CH")}` : "";
        pPage.drawText(`Foto ${index + slot + 1} - Partei ${clean(ownerParty?.party_label)}${takenLabel}`, { x: px + 6, y: py + 8, size: 5.5, font: regular, color: rgb(0.3, 0.35, 0.4) });
      }
    }

    drawProvenanceFooters(pdf, { regular, bold, shareCode: incident.share_code, createdLabel, descriptor: "Digitales Unfallprotokoll", legalNote: LEGAL_NOTE_REPORT }, branding);

    const pdfBytes = await pdf.save();
    const storagePath = `${incidentId}/unfallprotokoll-${incident.share_code}-${completeness}.pdf`;
    const { error: uploadError } = await service.storage.from("incident-pdfs").upload(storagePath, pdfBytes, { upsert: true, contentType: "application/pdf" });
    if (uploadError) throw uploadError;

    const { data: existing } = await service.from("submissions").select("id, status").eq("incident_id", incidentId).eq("party_id", submissionParty.id).maybeSingle();
    let submissionId: string;
    if (existing) {
      await service.from("submissions").update({ pdf_storage_path: storagePath }).eq("id", existing.id);
      submissionId = existing.id;
    } else {
      const { data: sub, error: subErr } = await service.from("submissions").insert({ incident_id: incidentId, party_id: submissionParty.id, target: "pending", status: "generated", pdf_storage_path: storagePath }).select("id").single();
      if (subErr) throw subErr;
      submissionId = sub.id;
    }

    const { data: signed, error: signError } = await service.storage.from("incident-pdfs").createSignedUrl(storagePath, 3600, { download: `Verkehrsunfall-Bericht-${incident.share_code}.pdf` });
    if (signError) throw signError;
    console.log("[generate-pdf] PDF generated", { incidentId, submissionId, photoCount: photos.length, format: "A4-portrait" });
    return json(req, { submissionId, storagePath, downloadUrl: signed.signedUrl, completeness });
  } catch (error) {
    console.error("[generate-pdf] generation failed", { error: error instanceof Error ? error.message : String(error) });
    return fail(req, "pdf_generation_failed", 500, locale);
  }
});
