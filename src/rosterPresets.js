export const sharedPresetStorageKey = 'er-team-picker-shared-roster-presets-v1';
const legacyKeys = ['er-team-picker-playable-presets', 'er-team-picker-union-presets'];

function readStored(storage, key) {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function presetRows(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value).flat();
  return [];
}

export function normalizeRosterPresets(value) {
  const rows = presetRows(value).filter(p => typeof p?.name === 'string'
    && p.name.trim() && Array.isArray(p.variants));
  const reserved = new Set(rows.map(p => p.name.trim()));
  const byName = new Map();
  for (const row of rows) {
    const original = row.name.trim();
    const variants = [...new Set(row.variants.filter(id => typeof id === 'string' && id))];
    const signature = JSON.stringify([...variants].sort());
    if ([...byName.values()].some(p => p.original === original && p.signature === signature)) continue;
    let name = original, suffix = 2;
    while (byName.has(name)) {
      do { name = `${original} ${suffix++}`; } while (reserved.has(name) || byName.has(name));
    }
    byName.set(name, { name, variants, original, signature });
  }
  return [...byName.values()].map(({ name, variants }) => ({ name, variants }));
}

export function loadRosterPresets(storage, allVariantIds = []) {
  const shared = readStored(storage, sharedPresetStorageKey);
  // An existing empty list is intentional: never resurrect deleted legacy presets.
  if (Array.isArray(shared)) return normalizeRosterPresets(shared);
  const merged = normalizeRosterPresets(legacyKeys.flatMap(key => presetRows(readStored(storage, key))
    .map(p => key === legacyKeys[0] && Array.isArray(p?.variants) && p.variants.length === 0
      ? { ...p, variants: [...allVariantIds] } : p)));
  storage.setItem(sharedPresetStorageKey, JSON.stringify(merged));
  // Retain the original keys as migration backups.
  return merged;
}

export function saveRosterPresets(storage, presets) {
  storage.setItem(sharedPresetStorageKey, JSON.stringify(presets));
}

export function escapePresetName(name) {
  return name.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
