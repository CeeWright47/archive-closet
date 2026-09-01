// One-time, idempotent data migrations for the local storage layer.
// Gated by "schema-version" so this only ever runs once per install.
import storage from "./storage.js";

const SCHEMA_VERSION = "1";

const genId = (prefix) => prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const defaultUser = () => ({
  id: "u_local",
  userId: null, // reserved for a future authenticated owner, not this record's own id
  name: "",
  email: "",
  mobile: "",
  bodyInfo: { height: null, weight: null, age: null, build: "" },
  sizes: { top: "", bottom: { waist: "", inseam: "" }, shoe: "", outerwear: "" },
  updatedAt: null,
});

export const defaultPreferences = (style = "") => ({
  id: "pref_local",
  userId: null,
  style,
  fit: { top: "", outerwear: "", bottom: "", cuffing: "", length: "" },
  colorsToAvoid: [],
  colorsWornMost: [],
  occasions: [],
  stores: [],
  budget: {
    top: { min: null, max: null },
    bottom: { min: null, max: null },
    shoes: { min: null, max: null },
    outerwear: { min: null, max: null },
    accessory: { min: null, max: null },
  },
  appSettings: { units: "imperial", autoTagOutfits: true, autoRunAssessment: false },
  climate: "",
  updatedAt: null,
});

export async function runMigrations() {
  try {
    const version = await storage.get("schema-version");
    if (version?.value === SCHEMA_VERSION) return;

    // 1. free-text style description moves into the new preferences record
    let styleText = "";
    try {
      const p = await storage.get("style-profile");
      if (p?.value) styleText = p.value;
    } catch (e) {}

    // 2. load existing outfits (userId + profile-tag remap happen below)
    let outfits = [];
    try {
      const listing = await storage.list("myoutfit:");
      for (const k of listing?.keys || []) {
        try {
          const r = await storage.get(k);
          if (r?.value) outfits.push({ key: k, data: JSON.parse(r.value) });
        } catch (e) {}
      }
    } catch (e) {}

    // 3. give every assessment profile a stable id, independent of its (re-orderable) rank
    let assessment = null;
    try {
      const a = await storage.get("style-assessment");
      if (a?.value) assessment = JSON.parse(a.value);
    } catch (e) {}

    const rankToId = {};
    if (assessment?.profiles?.length) {
      let changed = false;
      assessment.profiles = assessment.profiles.map((prof) => {
        let next = prof;
        if (!next.id) {
          next = { ...next, id: genId("prof") };
          changed = true;
        }
        rankToId[next.rank] = next.id;
        return next;
      });
      if (changed) await storage.set("style-assessment", JSON.stringify(assessment));
    }

    // 4. outfits: add userId, remap profileTag from rank -> stable profile id
    for (const { key, data } of outfits) {
      let changed = false;
      if (!("userId" in data)) {
        data.userId = null;
        changed = true;
      }
      if (data.profileTag && rankToId[data.profileTag]) {
        data.profileTag = rankToId[data.profileTag];
        changed = true;
      }
      if (changed) await storage.set(key, JSON.stringify(data));
    }

    // 5. seed the user/preferences records if they don't exist yet
    try {
      const existingUser = await storage.get("local:user");
      if (!existingUser?.value) await storage.set("local:user", JSON.stringify(defaultUser()));
    } catch (e) {}

    try {
      const existingPrefs = await storage.get("local:preferences");
      if (!existingPrefs?.value) await storage.set("local:preferences", JSON.stringify(defaultPreferences(styleText)));
    } catch (e) {}

    // 6. drop the now-redundant free-text key, but only once its value is safely copied
    if (styleText) {
      try {
        await storage.delete("style-profile");
      } catch (e) {}
    }

    await storage.set("schema-version", SCHEMA_VERSION);
  } catch (e) {
    // never block app load on a migration failure — worst case it retries next load
  }
}

// backfills fields added after a record was first created, without needing another schema-version bump
export function normalizeUser(stored) {
  const d = defaultUser();
  if (!stored) return d;
  return {
    ...d,
    ...stored,
    bodyInfo: { ...d.bodyInfo, ...(stored.bodyInfo || {}) },
    sizes: {
      ...d.sizes,
      ...(stored.sizes || {}),
      bottom:
        typeof stored?.sizes?.bottom === "object" && stored.sizes.bottom !== null
          ? { ...d.sizes.bottom, ...stored.sizes.bottom }
          : d.sizes.bottom,
    },
  };
}

export function normalizePreferences(stored) {
  const d = defaultPreferences();
  if (!stored) return d;
  return {
    ...d,
    ...stored,
    fit: { ...d.fit, ...(stored.fit || {}) },
    budget: stored.budget && typeof stored.budget.top === "object" ? { ...d.budget, ...stored.budget } : d.budget,
    appSettings: { ...d.appSettings, ...(stored.appSettings || {}) },
    colorsToAvoid: stored.colorsToAvoid || d.colorsToAvoid,
    colorsWornMost: stored.colorsWornMost || d.colorsWornMost,
    occasions: stored.occasions || d.occasions,
    stores: stored.stores || d.stores,
  };
}
