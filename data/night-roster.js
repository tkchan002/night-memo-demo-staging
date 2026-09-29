function clean(value) {
  return value == null ? '' : String(value).trim();
}

export function formatAppointmentDate(value) {
  const text = clean(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text;
}

export function normalizeNightNurse(raw = {}) {
  return {
    role: clean(raw.role || raw.rank),
    name: clean(raw.name),
    appointmentDate: formatAppointmentDate(raw.appt ?? raw.appointment_date ?? raw.appointmentDate),
    runner: Boolean(raw.runner ?? raw.is_runner),
  };
}

export function normalizeRosterSnapshot(raw = {}) {
  const ward = Array.isArray(raw.wards) ? raw.wards[0] : (raw.ward || raw.wards || {});
  return {
    wardId: raw.ward_id || ward.id || '',
    reportDate: clean(raw.reporting_date || raw.report_date),
    updatedAt: raw.updated_at || null,
    sourceKind: clean(raw.source_kind),
    ward: {
      id: ward.id || raw.ward_id || '',
      code: clean(ward.code),
      displayName: clean(ward.display_name || ward.code),
      displayOrder: Number(ward.display_order) || 0,
    },
    nurses: (Array.isArray(raw.nurses) ? raw.nurses : []).map(normalizeNightNurse).filter(nurse => nurse.name),
  };
}

function wardSort(a, b) {
  const order = (Number(a?.display_order) || 0) - (Number(b?.display_order) || 0);
  if (order) return order;
  return clean(a?.code).localeCompare(clean(b?.code), undefined, { numeric: true, sensitivity: 'base' });
}

export function buildNightOperationsModel({ wards = [], snapshots = [] } = {}) {
  const latestByWard = new Map();
  for (const raw of snapshots || []) {
    const snapshot = normalizeRosterSnapshot(raw);
    if (!snapshot.wardId) continue;
    const previous = latestByWard.get(snapshot.wardId);
    if (!previous || String(snapshot.updatedAt || '') > String(previous.updatedAt || '')) {
      latestByWard.set(snapshot.wardId, snapshot);
    }
  }

  const wardRosters = [...(wards || [])]
    .sort(wardSort)
    .map(ward => {
      const snapshot = latestByWard.get(ward.id);
      return {
        ward: {
          id: ward.id,
          code: clean(ward.code),
          displayName: clean(ward.display_name || ward.code),
          displayOrder: Number(ward.display_order) || 0,
        },
        updatedAt: snapshot?.updatedAt || null,
        reportDate: snapshot?.reportDate || null,
        nurses: snapshot?.nurses || [],
      };
    });

  // Retain any snapshot whose ward is no longer present in the active ward query.
  for (const snapshot of latestByWard.values()) {
    if (wardRosters.some(row => row.ward.id === snapshot.wardId)) continue;
    wardRosters.push({
      ward: snapshot.ward,
      updatedAt: snapshot.updatedAt,
      reportDate: snapshot.reportDate,
      nurses: snapshot.nurses,
    });
  }
  wardRosters.sort((a, b) => wardSort(a.ward, b.ward));

  const runners = wardRosters.flatMap(row => row.nurses
    .filter(nurse => nurse.runner)
    .map(nurse => ({ ...nurse, ward: row.ward, updatedAt: row.updatedAt })));

  return {
    wardRosters,
    runners,
    nurseCount: wardRosters.reduce((sum, row) => sum + row.nurses.length, 0),
    runnerCount: runners.length,
    wardsWithRoster: wardRosters.filter(row => row.updatedAt != null).length,
    wardCount: wardRosters.length,
  };
}
