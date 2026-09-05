import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFPage, type PDFFont } from "https://esm.sh/pdf-lib@1.17.1";
import { incidentBelongsToOrg } from "../_shared/incident-export.ts";
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

    const downloaded = new Map<string, { bytes: Uint8Array; contentType?: string }>();
    for (const item of media ?? []) {
      const { data, error } = await service.storage.from("incident-media").download(item.storage_path);
      if (!error && data) downloaded.set(item.storage_path, { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type });
    }

    const pdf = await PDFDocument.create();
    pdf.setTitle(`Verkehrsunfall-Bericht ${incident.share_code}`);
    pdf.setCreationDate(new Date());
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const page = pdf.addPage([PW, PH]);
    const navy = rgb(0.08, 0.23, 0.4);
    const blueA = rgb(0.05, 0.27, 0.49);
    const blueA_light = rgb(0.71, 0.83, 0.96);
    const yellowB = rgb(0.39, 0.22, 0.02);
    const yellowB_light = rgb(0.98, 0.78, 0.46);

    page.drawRectangle({ x: 0, y: PH - 30, width: PW, height: 30, color: navy });
    page.drawText("VERKEHRSUNFALL-BERICHT", { x: MARGIN, y: PH - 20, size: 13, font: bold, color: rgb(1, 1, 1) });
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

    page.drawText(`Fall ${clean(incident.share_code)} - Erstellt ${new Date().toLocaleDateString("de-CH")} - Unterschrift kein Schuldanerkenntnis.`, { x: MARGIN, y: 4, size: 4, font: regular, color: rgb(0.4, 0.45, 0.5) });

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
        if (stored) {
          const img = await embedImage(pdf, stored.bytes, stored.contentType);
          if (img) drawImageFit(pPage, img, px + 6, py + 22, photoW - 12, photoH - 36);
        }
        pPage.drawText(`Foto ${index + slot + 1} - Partei ${clean(ownerParty?.party_label)}`, { x: px + 6, y: py + 8, size: 5.5, font: regular, color: rgb(0.3, 0.35, 0.4) });
      }
    }

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
