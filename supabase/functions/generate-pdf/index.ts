import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFPage, type PDFFont } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const A4 = { width: 595.28, height: 841.89 };
const LANDSCAPE = { width: A4.height, height: A4.width };
const circumstances = [
  "parkte / hielt an", "verliess einen Parkplatz / öffnete eine Tür", "parkte ein", "fuhr aus Parkplatz / Grundstück aus",
  "fuhr auf Parkplatz / Grundstück ein", "fuhr in einen Kreisverkehr ein", "fuhr im Kreisverkehr", "fuhr auf das Heck auf",
  "fuhr in gleicher Richtung in anderer Spur", "wechselte die Spur", "überholte", "bog rechts ab", "bog links ab",
  "fuhr rückwärts", "geriet auf die Gegenfahrbahn", "kam von rechts", "missachtete Vorfahrt / Rotlicht",
];

const clean = (value: unknown) => String(value ?? "—").replace(/[–—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\xFF\n]/g, "?");
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

function drawWrapped(page: PDFPage, font: PDFFont, text: unknown, x: number, y: number, maxWidth: number, size = 8, maxLines = 3) {
  const wrapped = lines(font, clean(text), size, maxWidth).slice(0, maxLines);
  wrapped.forEach((line, index) => page.drawText(line, { x, y: y - index * (size + 2), size, font, color: rgb(0.12, 0.18, 0.25) }));
  return y - wrapped.length * (size + 2);
}

function field(page: PDFPage, regular: PDFFont, bold: PDFFont, label: string, value: unknown, x: number, y: number, width: number, height = 34) {
  page.drawRectangle({ x, y: y - height, width, height, borderWidth: 0.6, borderColor: rgb(0.72, 0.77, 0.82), color: rgb(1, 1, 1) });
  page.drawText(clean(label).toUpperCase(), { x: x + 6, y: y - 11, size: 6.5, font: bold, color: rgb(0.18, 0.35, 0.5) });
  drawWrapped(page, regular, value, x + 6, y - 23, width - 12, 8, 2);
}

async function embedImage(pdf: PDFDocument, bytes: Uint8Array, contentType?: string): Promise<PDFImage | null> {
  try {
    if (contentType?.includes("png")) return await pdf.embedPng(bytes);
    if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return await pdf.embedJpg(bytes);
    try { return await pdf.embedPng(bytes); } catch { return await pdf.embedJpg(bytes); }
  } catch { return null; }
}

function drawImageFit(page: PDFPage, image: PDFImage, x: number, y: number, width: number, height: number) {
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  page.drawImage(image, { x: x + (width - drawWidth) / 2, y: y + (height - drawHeight) / 2, width: drawWidth, height: drawHeight });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
    const token = authHeader.slice(7);
    const { incidentId } = await req.json();
    if (typeof incidentId !== "string" || !/^[0-9a-f-]{36}$/i.test(incidentId)) return json({ error: "invalid_incident" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const authClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "unauthorized" }, 401);

    const [{ data: incident, error: incidentError }, { data: parties, error: partiesError }, { data: witnesses }, { data: media }] = await Promise.all([
      service.from("incidents").select("*").eq("id", incidentId).single(),
      service.from("incident_parties").select("*").eq("incident_id", incidentId).order("party_label"),
      service.from("incident_witnesses").select("name, contact").eq("incident_id", incidentId),
      service.from("incident_media").select("storage_path, kind, taken_at").eq("incident_id", incidentId).order("uploaded_at"),
    ]);
    if (incidentError || partiesError || !incident || !parties) return json({ error: "not_found" }, 404);
    const ownParty = parties.find((party) => party.profile_id === authData.user.id);
    if (!ownParty) return json({ error: "forbidden" }, 403);
    if (!["signed", "submitted"].includes(incident.status) || parties.length < 2 || parties.some((party) => !party.signed_at)) return json({ error: "incident_not_completed" }, 409);

    const downloaded = new Map<string, { bytes: Uint8Array; contentType?: string }>();
    for (const item of media ?? []) {
      const { data, error } = await service.storage.from("incident-media").download(item.storage_path);
      if (!error && data) downloaded.set(item.storage_path, { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type });
    }

    const pdf = await PDFDocument.create();
    pdf.setTitle(`Europäisches Unfallprotokoll ${incident.share_code}`);
    pdf.setAuthor("Unfallprotokoll");
    pdf.setCreationDate(new Date());
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const page = pdf.addPage([LANDSCAPE.width, LANDSCAPE.height]);
    const navy = rgb(0.08, 0.23, 0.4);
    page.drawRectangle({ x: 0, y: LANDSCAPE.height - 54, width: LANDSCAPE.width, height: 54, color: navy });
    page.drawText("EUROPÄISCHES UNFALLPROTOKOLL", { x: 28, y: LANDSCAPE.height - 33, size: 17, font: bold, color: rgb(1, 1, 1) });
    page.drawText(`Fall ${clean(incident.share_code)}  |  ${clean(incident.occurred_at ? new Date(incident.occurred_at).toLocaleString("de-CH") : "")}`, { x: 520, y: LANDSCAPE.height - 31, size: 8, font: regular, color: rgb(0.9, 0.95, 1) });

    field(page, regular, bold, "1 Datum / Zeit", incident.occurred_at ? new Date(incident.occurred_at).toLocaleString("de-CH") : "—", 28, 526, 245, 38);
    field(page, regular, bold, "2 Unfallort", incident.location_text, 279, 526, 335, 38);
    field(page, regular, bold, "5 Zeugen", (witnesses ?? []).map((item) => [item.name, item.contact].filter(Boolean).join(" · ")).join("; ") || "Keine Angaben", 620, 526, 194, 38);

    const columnWidth = 260;
    const leftA = 28;
    const leftB = 554;
    const partyA = parties.find((party) => party.party_label === "A") ?? parties[0];
    const partyB = parties.find((party) => party.party_label === "B") ?? parties[1];
    const drawParty = (party: Record<string, unknown>, x: number, color: { r: number; g: number; b: number }) => {
      page.drawRectangle({ x, y: 446, width: columnWidth, height: 28, color: rgb(color.r, color.g, color.b) });
      page.drawText(`FAHRZEUG ${clean(party.party_label)}`, { x: x + 8, y: 455, size: 12, font: bold, color: rgb(1, 1, 1) });
      const driver = party.driver_json as Record<string, unknown>;
      const vehicle = party.vehicle_json as Record<string, unknown>;
      const insurance = party.insurance_json as Record<string, unknown>;
      field(page, regular, bold, "6 / 9 Fahrer", `${clean(driver?.fullName)}\n${clean(driver?.address)} · ${clean(driver?.phone)}`, x, 446, columnWidth, 48);
      field(page, regular, bold, "7 Fahrzeug", `${clean(vehicle?.plate)} · ${clean(vehicle?.makeModel)}`, x, 398, columnWidth, 38);
      field(page, regular, bold, "8 Versicherung", `${clean(insurance?.company)} · Police ${clean(insurance?.policyNumber)}`, x, 360, columnWidth, 42);
      field(page, regular, bold, "11 Schäden / 14 Bemerkungen", party.damage_description, x, 318, columnWidth, 62);
    };
    drawParty(partyA, leftA, { r: 0.12, g: 0.45, b: 0.72 });
    drawParty(partyB, leftB, { r: 0.94, g: 0.72, b: 0.12 });

    const checkX = 304;
    page.drawText("12 UNFALLHERGANG", { x: checkX + 34, y: 460, size: 10, font: bold, color: navy });
    circumstances.forEach((label, index) => {
      const y = 442 - index * 13.2;
      const checkedA = (partyA.circumstances_checked ?? []).includes(index);
      const checkedB = (partyB.circumstances_checked ?? []).includes(index);
      page.drawRectangle({ x: checkX, y: y - 2, width: 9, height: 9, borderWidth: 0.6, borderColor: navy, color: checkedA ? rgb(0.12, 0.45, 0.72) : rgb(1, 1, 1) });
      page.drawRectangle({ x: checkX + 225, y: y - 2, width: 9, height: 9, borderWidth: 0.6, borderColor: navy, color: checkedB ? rgb(0.94, 0.72, 0.12) : rgb(1, 1, 1) });
      page.drawText(`${index + 1}. ${clean(label)}`, { x: checkX + 15, y, size: 6.5, font: regular, color: rgb(0.15, 0.2, 0.26) });
    });

    const sketchItem = (media ?? []).find((item) => item.kind === "sketch" || item.storage_path.endsWith("/sketch.png"));
    page.drawRectangle({ x: 28, y: 36, width: 526, height: 190, borderWidth: 0.8, borderColor: rgb(0.55, 0.62, 0.68) });
    page.drawText("13 UNFALLSKIZZE", { x: 36, y: 210, size: 8, font: bold, color: navy });
    if (sketchItem && downloaded.has(sketchItem.storage_path)) {
      const stored = downloaded.get(sketchItem.storage_path)!;
      const image = await embedImage(pdf, stored.bytes, stored.contentType);
      if (image) drawImageFit(page, image, 36, 44, 510, 158);
    }

    const drawSignature = async (party: Record<string, unknown>, x: number, width: number) => {
      page.drawRectangle({ x, y: 36, width, height: 190, borderWidth: 0.8, borderColor: rgb(0.55, 0.62, 0.68) });
      page.drawText(`15 UNTERSCHRIFT ${clean(party.party_label)}`, { x: x + 8, y: 210, size: 8, font: bold, color: navy });
      const signatureItem = (media ?? []).find((item) => item.storage_path.includes(`/${party.id}/signature.`));
      if (signatureItem && downloaded.has(signatureItem.storage_path)) {
        const stored = downloaded.get(signatureItem.storage_path)!;
        const image = await embedImage(pdf, stored.bytes, stored.contentType);
        if (image) drawImageFit(page, image, x + 8, 82, width - 16, 112);
      }
      page.drawText(`Signiert: ${clean(party.signed_at ? new Date(party.signed_at as string).toLocaleString("de-CH") : "—")}`, { x: x + 8, y: 53, size: 7, font: regular, color: rgb(0.3, 0.35, 0.4) });
    };
    await drawSignature(partyA, 566, 120);
    await drawSignature(partyB, 694, 120);

    const photos = (media ?? []).filter((item) => item.kind === "photo");
    for (let index = 0; index < photos.length; index += 4) {
      const photoPage = pdf.addPage([A4.width, A4.height]);
      photoPage.drawText(`FOTOANHANG · FALL ${clean(incident.share_code)}`, { x: 28, y: A4.height - 38, size: 14, font: bold, color: navy });
      for (let slot = 0; slot < 4; slot++) {
        const item = photos[index + slot];
        if (!item) break;
        const x = slot % 2 === 0 ? 28 : 304;
        const y = slot < 2 ? 432 : 48;
        photoPage.drawRectangle({ x, y, width: 263, height: 342, borderWidth: 0.7, borderColor: rgb(0.7, 0.75, 0.8) });
        const stored = downloaded.get(item.storage_path);
        if (stored) {
          const image = await embedImage(pdf, stored.bytes, stored.contentType);
          if (image) drawImageFit(photoPage, image, x + 8, y + 28, 247, 304);
          else photoPage.drawText("Bildformat kann nicht eingebettet werden", { x: x + 20, y: y + 170, size: 8, font: regular });
        }
        photoPage.drawText(`Foto ${index + slot + 1}${item.taken_at ? ` · ${clean(new Date(item.taken_at).toLocaleString("de-CH"))}` : ""}`, { x: x + 8, y: y + 11, size: 7, font: regular, color: rgb(0.3, 0.35, 0.4) });
      }
    }

    const pdfBytes = await pdf.save();
    const storagePath = `${incidentId}/unfallprotokoll-${incident.share_code}.pdf`;
    const { error: uploadError } = await service.storage.from("incident-pdfs").upload(storagePath, pdfBytes, { upsert: true, contentType: "application/pdf" });
    if (uploadError) throw uploadError;

    const { data: existing } = await service.from("submissions").select("id, status").eq("incident_id", incidentId).eq("party_id", ownParty.id).maybeSingle();
    let submissionId: string;
    if (existing) {
      const { error } = await service.from("submissions").update({ pdf_storage_path: storagePath }).eq("id", existing.id);
      if (error) throw error;
      submissionId = existing.id;
    } else {
      const { data: submission, error } = await service.from("submissions").insert({ incident_id: incidentId, party_id: ownParty.id, target: "pending", status: "generated", pdf_storage_path: storagePath }).select("id").single();
      if (error) throw error;
      submissionId = submission.id;
    }
    const { data: signed, error: signError } = await service.storage.from("incident-pdfs").createSignedUrl(storagePath, 3600, { download: `Unfallprotokoll-${incident.share_code}.pdf` });
    if (signError) throw signError;
    console.log("[generate-pdf] PDF generated", { incidentId, submissionId, photoCount: photos.length });
    return json({ submissionId, storagePath, downloadUrl: signed.signedUrl });
  } catch (error) {
    console.error("[generate-pdf] generation failed", { error: error instanceof Error ? error.message : String(error) });
    return json({ error: "pdf_generation_failed" }, 500);
  }
});
