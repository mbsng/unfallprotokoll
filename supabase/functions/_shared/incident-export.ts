const circumstanceCodes = [
  "PARKED_OR_STOPPED", "LEAVING_PARKING_OR_OPENING_DOOR", "ENTERING_PARKING", "LEAVING_PRIVATE_PROPERTY",
  "ENTERING_PRIVATE_PROPERTY", "ENTERING_ROUNDABOUT", "IN_ROUNDABOUT", "REAR_END_SAME_LANE",
  "SAME_DIRECTION_DIFFERENT_LANE", "CHANGING_LANE", "OVERTAKING", "TURNING_RIGHT", "TURNING_LEFT",
  "REVERSING", "ENTERING_OPPOSING_LANE", "COMING_FROM_RIGHT", "IGNORING_PRIORITY_OR_RED_LIGHT",
] as const;

function canonicalize(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildIncidentExport(service: any, incidentId: string, urlTtlSeconds = 900) {
  const [{ data: incident, error: incidentError }, { data: parties, error: partiesError }, { data: witnesses, error: witnessesError }, { data: media, error: mediaError }, { data: submissions }] = await Promise.all([
    service.from("incidents").select("*").eq("id", incidentId).single(),
    service.from("incident_parties").select("*").eq("incident_id", incidentId).order("party_label"),
    service.from("incident_witnesses").select("id, name, contact").eq("incident_id", incidentId),
    service.from("incident_media").select("id, party_id, storage_path, kind, taken_at, uploaded_at").eq("incident_id", incidentId).order("uploaded_at"),
    service.from("submissions").select("id, status, submitted_at, pdf_storage_path").eq("incident_id", incidentId).order("submitted_at", { ascending: false }),
  ]);
  if (incidentError || partiesError || witnessesError || mediaError || !incident || !parties) throw new Error("incident_not_found");
  if (!["signed", "submitted"].includes(incident.status)) throw new Error("incident_not_exportable");

  const expiresAt = new Date(Date.now() + urlTtlSeconds * 1000).toISOString();
  const exportedMedia = [];
  for (const item of media ?? []) {
    const { data, error } = await service.storage.from("incident-media").createSignedUrl(item.storage_path, urlTtlSeconds);
    if (error) continue;
    exportedMedia.push({
      id: item.id,
      party_id: item.party_id,
      type: item.storage_path.includes("/signature.") ? "SIGNATURE" : item.kind.toUpperCase(),
      taken_at: item.taken_at,
      uploaded_at: item.uploaded_at,
      url: data.signedUrl,
      url_expires_at: expiresAt,
    });
  }

  const occurredAt = incident.occurred_at ? new Date(incident.occurred_at) : null;
  const sharedFields = {
    "01": { code: "ACCIDENT_DATE_TIME", value: incident.occurred_at },
    "02": { code: "ACCIDENT_LOCATION", value: incident.location_text, coordinates: incident.location_lat === null || incident.location_lng === null ? null : { latitude: incident.location_lat, longitude: incident.location_lng } },
    "03": { code: "INJURIES", value: Boolean(incident.circumstances_json?.injured) },
    "04": { code: "OTHER_PROPERTY_DAMAGE", value: Boolean(incident.circumstances_json?.otherDamage) },
    "05": { code: "WITNESSES", value: (witnesses ?? []).map((witness: any) => ({ name: witness.name, contact: witness.contact })) },
  };

  const exportedParties = parties.map((party: any) => {
    const partyMedia = exportedMedia.filter((item) => item.party_id === party.id);
    const signature = partyMedia.find((item) => item.type === "SIGNATURE");
    return {
      id: party.id,
      role: `PARTY_${party.party_label}`,
      profile_id: party.profile_id,
      fields: {
        ...sharedFields,
        "06": { code: "POLICYHOLDER", value: { name: party.driver_json?.fullName ?? null, address: party.driver_json?.address ?? null } },
        "07": { code: "VEHICLE", value: { registration_plate: party.vehicle_json?.plate ?? null, make_model: party.vehicle_json?.makeModel ?? null } },
        "08": { code: "INSURANCE", value: { company: party.insurance_json?.company ?? null, policy_number: party.insurance_json?.policyNumber ?? null } },
        "09": { code: "DRIVER", value: { name: party.driver_json?.fullName ?? null, address: party.driver_json?.address ?? null, phone: party.driver_json?.phone ?? null, license_number: party.driver_json?.licenseNo ?? null } },
        "10": { code: "INITIAL_IMPACT", value: null },
        "11": { code: "VISIBLE_DAMAGE", value: party.damage_description },
        "12": { code: "CIRCUMSTANCES", value: (party.circumstances_checked ?? []).map((index: number) => ({ index: index + 1, code: circumstanceCodes[index] ?? `UNKNOWN_${index + 1}` })) },
        "13": { code: "SKETCH", value: partyMedia.filter((item) => item.type === "SKETCH") },
        "14": { code: "REMARKS", value: party.damage_description },
        "15": { code: "SIGNATURE", value: { signed: Boolean(party.signed_at), signer: { profile_id: party.profile_id, name: party.driver_json?.fullName ?? null }, signed_at: party.signed_at, media: signature ?? null } },
      },
      version: party.version,
      updated_at: party.updated_at,
    };
  });

  const document: Record<string, unknown> = {
    schema_version: "incident.v1",
    event_type: incident.status === "submitted" ? "incident.submitted" : "incident.signed",
    exported_at: new Date().toISOString(),
    incident: {
      id: incident.id,
      share_code: incident.share_code,
      status: incident.status.toUpperCase(),
      occurred_at: incident.occurred_at,
      occurred_date: occurredAt?.toISOString().slice(0, 10) ?? null,
      location: { text: incident.location_text, latitude: incident.location_lat, longitude: incident.location_lng },
      version: incident.version,
      created_at: incident.created_at,
      updated_at: incident.updated_at,
    },
    parties: exportedParties,
    media: exportedMedia,
    submission: submissions?.[0] ?? null,
  };
  document.sha256 = await sha256(canonicalize(document));
  return document;
}

export async function incidentBelongsToOrg(service: any, incidentId: string, orgId: string) {
  const { data } = await service.from("incident_parties").select("profile_id").eq("incident_id", incidentId);
  const profileIds = (data ?? []).map((party: any) => party.profile_id).filter(Boolean);
  if (!profileIds.length) return false;
  const { count } = await service.from("profiles").select("id", { count: "exact", head: true }).eq("org_id", orgId).in("id", profileIds);
  return Boolean(count);
}
