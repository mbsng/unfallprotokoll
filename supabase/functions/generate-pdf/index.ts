import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFPage, type PDFFont } from "https://esm.sh/pdf-lib@1.17.1";
import { incidentBelongsToOrg } from "../_shared/incident-export.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PW = 841.89; // A4 landscape width
const PH = 595.28; // A4 landscape height
const MARGIN = 18;
const COL_W = (PW - 2 * MARGIN - 6) / 3; // 3 columns with 3px gaps

// WinAnsi-safe clean
const clean = (value: unknown) => {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[–—]/g, "-").replace(/[""]/g, '"').replace(/['']/g, "'").replace(/…/g, "...").replace(/€/g, "EUR").replace(/[^\x20-\xFF\n]/g, "?");
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
  return y - wrapped.length * (size + 1.5);
}

function box(page: PDFPage, x: number, y: number, w: number, h: number, fill = rgb(1, 1, 1), border = rgb(0.6, 0.65, 0.7)) {
  page.drawRectangle({ x, y, width: w, height: h, borderWidth: 0.5, borderColor: border, color: fill });
}

function labeledField(page: PDFPage, regular: PDFFont, bold: PDFFont, num: string, label: string, value: unknown, x: number, y: number, w: number, h: number) {
  box(page, x, y, w, h);
  page.drawText(clean(`${num} ${label}`).toUpperCase(), { x: x + 4, y: y + h - 7, size: 5, font: bold, color: rgb(0.15, 0.3, 0.45) });
  drawWrapped(page, regular, value, x + 4, y + h - 16, w - 8, 7, Math.floor((h - 18) / 8.5));
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
  "parkte / hielt", "verliess einen Parkplatz / oeffnete eine Tuere", "parkte ein",
  "verliess einen Parkplatz / Grundstueck / Weg", "fuhr in Parkplatz / Grundstueck / Weg ein",
  "fuhr in einen Kreisverkehr ein", "fuhr in einem Kreisverkehr",
  "prallte in gleicher Kolonne auf das Heck auf", "fuhr in gleicher Richtung, anderer Kolonne",
  "wechselte die Kolonne", "ueberholte", "bog rechts ab", "bog links ab",
  "setzte zurueck", "wechselte auf Gegenfahrbahn", "kam von rechts (Kreuzung)",
  "missachtete Vorfahrt / rote Ampel",
];

const lang = (req: Request): string => {
  const accept = req.headers.get("Accept-Language") ?? "de";
  if (accept.startsWith("fr")) return "fr";
  if (accept.startsWith("it")) return "it";
  if (accept.startsWith("en")) return "en";
  return "de";
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const token = authHeader.slice(7);
    const body = await req.json();
    const incidentId = body.incidentId as string;
    const locale = body.locale as string || lang(req);
    if (!incidentId || !/^[0-9a-f-]{36}$/i.test(incidentId)) return json({ error: "invalid_incident" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "unauthorized" }, 401);

    const [{ data: incident, error: incidentError }, { data: parties, error: partiesError }, { data: witnesses }, { data: media }] = await Promise.all([
      service.from("incidents").select("*").eq("id", incidentId).single(),
      service.from("incident_parties").select("*").eq("incident_id", incidentId).order("party_label"),
      service.from("incident_witnesses").select("name, contact").eq("incident_id", incidentId),
      service.from("incident_media").select("storage_path, kind, taken_at, party_id").eq("incident_id", incidentId).order("uploaded_at"),
    ]);
    if (incidentError || partiesError || !incident || !parties) {
      console.error("[generate-pdf] Data fetch failed", { incidentError: incidentError?.message, partiesError: partiesError?.message });
      return json({ error: "not_found" }, 404);
    }

    let submissionParty = parties.find((p) => p.profile_id === authData.user.id);
    if (!submissionParty) {
      const { data: requester } = await service.from("profiles").select("org_id, role").eq("id", authData.user.id).maybeSingle();
      if (requester?.org_id && ["fleet_manager", "admin"].includes(requester.role) && await incidentBelongsToOrg(service, incidentId, requester.org_id)) {
        const partyProfileIds = parties.map((p) => p.profile_id).filter(Boolean);
        const { data: orgProfile } = await service.from("profiles").select("id").eq("org_id", requester.org_id).in("id", partyProfileIds).limit(1).maybeSingle();
        submissionParty = parties.find((p) => p.profile_id === orgProfile?.id);
      }
    }
    if (!submissionParty) return json({ error: "forbidden" }, 403);

    const realParties = parties.filter((p) => p.profile_id);
    const unsignedParties = realParties.filter((p) => !p.signed_at);
    const allSigned = realParties.length > 0 && unsignedParties.length === 0;
    if (!["signed", "submitted"].includes(incident.status)) {
      if (allSigned) {
        await service.from("incidents").update({ status: "signed", version: incident.version + 1, updated_at: new Date().toISOString() }).eq("id", incidentId).eq("version", incident.version);
      } else {
        return json({ error: "incident_not_completed", detail: `Unsigned: ${unsignedParties.map((p) => p.party_label).join(", ")}` }, 409);
      }
    }

    // Download all media
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
    const blue = rgb(0.12, 0.45, 0.72);
    const yellow = rgb(0.92, 0.75, 0.1);

    // --- HEADER ---
    page.drawRectangle({ x: 0, y: PH - 38, width: PW, height: 38, color: navy });
    page.drawText("VERKEHRSUNFALL-BERICHT", { x: MARGIN + 2, y: PH - 25, size: 16, font: bold, color: rgb(1, 1, 1) });
    page.drawText(`Fall ${clean(incident.share_code)}`, { x: PW - 160, y: PH - 18, size: 7, font: regular, color: rgb(0.85, 0.9, 1) });

    const hy = PH - 40;
    const headH = 32;
    const fieldW = (PW - 2 * MARGIN - 8) / 5;
    labeledField(page, regular, bold, "1", "Datum / Zeit", incident.occurred_at ? new Date(incident.occurred_at).toLocaleString(locale === "de" ? "de-CH" : locale) : "", MARGIN, hy - headH, fieldW, headH);
    labeledField(page, regular, bold, "2", "Ort", incident.location_text, MARGIN + fieldW + 2, hy - headH, fieldW, headH);
    labeledField(page, regular, bold, "3", "Verletzte", incident.circumstances_json?.injured ? "Ja" : "Nein", MARGIN + 2 * (fieldW + 2), hy - headH, fieldW * 0.6, headH);
    labeledField(page, regular, bold, "4", "Sachschaden", incident.circumstances_json?.otherDamage ? "Ja" : "Nein", MARGIN + 2 * (fieldW + 2) + fieldW * 0.6 + 2, hy - headH, fieldW * 0.6, headH);
    labeledField(page, regular, bold, "5", "Zeugen", (witnesses ?? []).map((w) => [w.name, w.contact].filter(Boolean).join(" ")).join("; "), MARGIN + 3 * (fieldW + 2) + fieldW * 0.2 + 2, hy - headH, fieldW * 1.2, headH);

    // --- COLUMNS ---
    const colTop = hy - headH - 4;
    const partyA = parties.find((p) => p.party_label === "A") ?? parties[0];
    const partyB = parties.find((p) => p.party_label === "B");
    const colLeft = MARGIN;
    const colMid = MARGIN + COL_W + 3;
    const colRight = MARGIN + 2 * (COL_W + 3);

    const drawPartyColumn = (party: Record<string, unknown> | undefined, x: number, headColor: typeof blue) => {
      if (!party) return;
      const w = COL_W;
      let y = colTop;
      const hBar = 14;
      page.drawRectangle({ x, y: y - hBar, width: w, height: hBar, color: headColor });
      page.drawText(`FAHRZEUG ${clean(party.party_label)}`, { x: x + 4, y: y - 10, size: 8, font: bold, color: rgb(1, 1, 1) });
      y -= hBar;

      const d = party.driver_json as Record<string, unknown> ?? {};
      const v = party.vehicle_json as Record<string, unknown> ?? {};
      const ins = party.insurance_json as Record<string, unknown> ?? {};

      labeledField(page, regular, bold, "6", "Versicherungsnehmer", [d.fullName, d.address, d.phone].filter(Boolean).join("\n"), x, y - 44, w, 44); y -= 46;
      labeledField(page, regular, bold, "7", "Fahrzeug / Kennzeichen", [v.makeModel, v.plate].filter(Boolean).join(" · "), x, y - 30, w, 30); y -= 32;
      labeledField(page, regular, bold, "8", "Versicherung", [ins.company, ins.policyNumber].filter(Boolean).join(" · "), x, y - 30, w, 30); y -= 32;
      labeledField(page, regular, bold, "9", "Fahrer", [d.fullName, d.address, d.phone].filter(Boolean).join("\n"), x, y - 40, w, 40); y -= 42;
      // field 10 = point of impact (arrow) - small
      labeledField(page, regular, bold, "10", "Aufprallpunkt", "(siehe Skizze)", x, y - 18, w, 18); y -= 20;
      labeledField(page, regular, bold, "11", "Sichtbare Schaeden", party.damage_description, x, y - 50, w, 50); y -= 52;
      labeledField(page, regular, bold, "14", "Bemerkungen", "", x, y - 30, w, 30); y -= 32;
    };

    drawPartyColumn(partyA, colLeft, blue);
    drawPartyColumn(partyB, colRight, yellow);

    // --- MIDDLE COLUMN: circumstances ---
    const mx = colMid;
    const mw = COL_W;
    let my = colTop;
    page.drawRectangle({ x: mx, y: my - 14, width: mw, height: 14, color: rgb(0.9, 0.92, 0.95) });
    page.drawText("12 UNFALLUMSTAENDE", { x: mx + 4, y: my - 10, size: 8, font: bold, color: navy });
    my -= 16;

    CIRCUMSTANCES.forEach((label, index) => {
      const checkedA = (partyA?.circumstances_checked ?? []).includes(index);
      const checkedB = partyB ? (partyB.circumstances_checked ?? []).includes(index) : false;
      const rowY = my - index * 14;
      // A checkbox
      page.drawRectangle({ x: mx + 2, y: rowY - 3, width: 7, height: 7, borderWidth: 0.4, borderColor: navy, color: checkedA ? blue : rgb(1, 1, 1) });
      // B checkbox
      page.drawRectangle({ x: mx + mw - 10, y: rowY - 3, width: 7, height: 7, borderWidth: 0.4, borderColor: navy, color: checkedB ? yellow : rgb(1, 1, 1) });
      page.drawText(`${index + 1}. ${clean(label)}`, { x: mx + 13, y: rowY, size: 5, font: regular, color: rgb(0.15, 0.18, 0.22) });
    });
    my -= CIRCUMSTANCES.length * 14 + 4;

    // Count of checked boxes
    const countA = (partyA?.circumstances_checked ?? []).length;
    const countB = partyB ? (partyB?.circumstances_checked ?? []).length : 0;
    page.drawText("Anzahl:", { x: mx + 2, y: my, size: 5.5, font: bold, color: rgb(0.2, 0.25, 0.3) });
    page.drawRectangle({ x: mx + 30, y: my - 3, width: 14, height: 10, borderWidth: 0.4, borderColor: navy });
    page.drawText(String(countA), { x: mx + 34, y: my, size: 6, font: bold, color: blue });
    page.drawRectangle({ x: mx + mw - 44, y: my - 3, width: 14, height: 10, borderWidth: 0.4, borderColor: navy });
    page.drawText(String(countB), { x: mx + mw - 40, y: my, size: 6, font: bold, color: yellow });
    my -= 16;

    // --- SKETCH AREA (13) — bottom area, full width of columns ---
    const sketchY = MARGIN + 140;
    const sketchH = 125;
    const sketchW = PW - 2 * MARGIN;
    box(page, MARGIN, sketchY, sketchW, sketchH);
    page.drawText("13 SKIZZE DES UNFALLS", { x: MARGIN + 6, y: sketchY + sketchH - 8, size: 7, font: bold, color: navy });
    page.drawText("Verlauf der Fahrspuren, Fahrtrichtung (Pfeile), Position beim Aufprall, Verkehrszeichen, Strassennamen", { x: MARGIN + 6, y: sketchY + sketchH - 18, size: 5, font: regular, color: rgb(0.4, 0.45, 0.5) });

    // Shared sketch from incidents.sketch_data_url (base64) or incident_media sketch
    let sketchDrawn = false;
    if (incident.sketch_data_url) {
      try {
        const base64 = incident.sketch_data_url.split(",")[1] ?? incident.sketch_data_url;
        const sketchBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const img = await embedImage(pdf, sketchBytes, "image/png");
        if (img) { drawImageFit(page, img, MARGIN + 6, sketchY + 6, sketchW - 12, sketchH - 30); sketchDrawn = true; }
      } catch { /* fall through to media */ }
    }
    if (!sketchDrawn) {
      const sketchItem = (media ?? []).find((item) => item.kind === "sketch" || item.storage_path.endsWith("/sketch.png"));
      if (sketchItem && downloaded.has(sketchItem.storage_path)) {
        const stored = downloaded.get(sketchItem.storage_path)!;
        const img = await embedImage(pdf, stored.bytes, stored.contentType);
        if (img) drawImageFit(page, img, MARGIN + 6, sketchY + 6, sketchW - 12, sketchH - 30);
      }
    }

    // --- SIGNATURES (15) — below sketch, two fields side by side ---
    const sigY = MARGIN + 8;
    const sigH = 120;
    const sigW = (sketchW - 6) / 2;
    const drawSignature = async (party: Record<string, unknown> | undefined, x: number) => {
      box(page, x, sigY, sigW, sigH);
      page.drawText(`15 UNTERSCHRIFT ${clean(party?.party_label)}`, { x: x + 6, y: sigY + sigH - 8, size: 6, font: bold, color: navy });
      page.drawText("Unbedingt von BEIDEN Fahrern zu unterzeichnen", { x: x + 6, y: sigY + sigH - 16, size: 4.5, font: regular, color: rgb(0.4, 0.45, 0.5) });
      if (party) {
        const sigItem = (media ?? []).find((item) => item.storage_path.includes(`/${party.id}/signature.`));
        if (sigItem && downloaded.has(sigItem.storage_path)) {
          const stored = downloaded.get(sigItem.storage_path)!;
          const img = await embedImage(pdf, stored.bytes, stored.contentType);
          if (img) drawImageFit(page, img, x + 8, sigY + 12, sigW - 16, sigH - 32);
        }
        page.drawText(`Signiert: ${clean(party.signed_at ? new Date(party.signed_at as string).toLocaleString("de-CH") : "")}`, { x: x + 6, y: sigY + 4, size: 5, font: regular, color: rgb(0.35, 0.4, 0.45) });
      }
    };
    await drawSignature(partyA, MARGIN);
    await drawSignature(partyB, MARGIN + sigW + 6);

    // --- FOOTER ---
    page.drawText(`Fall ${clean(incident.share_code)} · Erstellt ${new Date().toLocaleDateString("de-CH")} · Die Unterschrift stellt kein Schuldanerkenntnis dar.`, { x: MARGIN, y: 4, size: 5, font: regular, color: rgb(0.4, 0.45, 0.5) });

    // --- PHOTO APPENDIX ---
    const photos = (media ?? []).filter((item) => item.kind === "photo");
    for (let index = 0; index < photos.length; index += 4) {
      const pPage = pdf.addPage([595.28, 841.89]);
      pPage.drawText(`FOTOANHANG · FALL ${clean(incident.share_code)}`, { x: 28, y: 810, size: 14, font: bold, color: navy });
      for (let slot = 0; slot < 4; slot++) {
        const item = photos[index + slot];
        if (!item) break;
        const px = slot % 2 === 0 ? 28 : 304;
        const py = slot < 2 ? 432 : 48;
        const ownerParty = parties.find((p) => p.id === item.party_id);
        box(pPage, px, py, 263, 342);
        const stored = downloaded.get(item.storage_path);
        if (stored) {
          const img = await embedImage(pdf, stored.bytes, stored.contentType);
          if (img) drawImageFit(pPage, img, px + 8, py + 28, 247, 304);
        }
        pPage.drawText(`Foto ${index + slot + 1} · Partei ${clean(ownerParty?.party_label)}`, { x: px + 8, y: py + 11, size: 7, font: regular, color: rgb(0.3, 0.35, 0.4) });
      }
    }

    const pdfBytes = await pdf.save();
    const storagePath = `${incidentId}/unfallprotokoll-${incident.share_code}.pdf`;
    const { error: uploadError } = await service.storage.from("incident-pdfs").upload(storagePath, pdfBytes, { upsert: true, contentType: "application/pdf" });
    if (uploadError) { console.error("[generate-pdf] Upload failed", { error: uploadError.message }); throw uploadError; }

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
    console.log("[generate-pdf] PDF generated", { incidentId, submissionId, photoCount: photos.length });
    return json({ submissionId, storagePath, downloadUrl: signed.signedUrl });
  } catch (error) {
    console.error("[generate-pdf] generation failed", { error: error instanceof Error ? error.message : String(error) });
    return json({ error: "pdf_generation_failed" }, 500);
  }
});
