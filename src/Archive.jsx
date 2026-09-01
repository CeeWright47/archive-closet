import { useState, useEffect, useRef, useCallback } from "react";
import { saveImage, loadImage, deleteImages } from "./imageStore";

// ————————————————————————————————————————————————
// ARCHIVE — a personal wardrobe index + AI stylist
// Palette: espresso base, bone type, tobacco accent
// Signature: pieces rendered as garment tags
// ————————————————————————————————————————————————

const T = {
  bg: "#1B1815",
  card: "#26211C",
  cardUp: "#2E2822",
  line: "#3A332B",
  bone: "#EAE3D6",
  stone: "#9C948A",
  faint: "#6B655C",
  tobacco: "#B08D57",
  olive: "#7A7A52",
  bad: "#A45A48",
};

const CATEGORIES = ["top", "bottom", "shoes", "outerwear", "accessory"];

const DEFAULT_PROFILE = `Tonal earth tones — espresso, olive, cream, stone. Matte finishes over gloss. Quiet-luxury silhouettes with a boom-bap edge: lug soles, chunky loafers, knit polos, relaxed tailoring. No loud logos, no shiny leather. Pieces should layer and photograph well.`;

const fontCss = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap');
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
body { margin: 0; }
::selection { background: ${T.tobacco}; color: ${T.bg}; }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes pulse { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
input:focus, textarea:focus, button:focus-visible { outline: 2px solid ${T.tobacco}; outline-offset: 2px; }
`;

const serif = "'Instrument Serif', Georgia, serif";
const mono = "ui-monospace, 'SF Mono', Menlo, monospace";
const sans = "-apple-system, 'Helvetica Neue', Arial, sans-serif";

// ———— design tokens (iOS HIG) ————
const SPACE = { xs: 4, sm: 8, md: 12, base: 16, lg: 20, xl: 24, xxl: 32, xxxl: 40, xxxxl: 48 };

const RADIUS = { sm: 8, md: 12, card: 16, sheet: 24, pill: 999 };

const TOUCH = { min: 44, gap: 8 };

const SAFE_TOP = "env(safe-area-inset-top, 0px)";
const SAFE_BOTTOM = "env(safe-area-inset-bottom, 0px)";
const NAV_HEIGHT = 49; // pt, excludes safe-area inset — add SAFE_BOTTOM on top when laying out

const LAYOUT = { screenMargin: 16, maxWidth: 600 };

// rem-based off the root so browser text-size/zoom settings scale it (closest web analog to Dynamic Type)
const TYPE = {
  masthead:   { fontSize: "2.75rem",   lineHeight: 1.05 },                  // 44 — brand exception, not an iOS text style
  largeTitle: { fontSize: "2.125rem",  lineHeight: 1.1 },                   // 34
  title1:     { fontSize: "1.75rem",   lineHeight: 1.15 },                  // 28
  title2:     { fontSize: "1.375rem",  lineHeight: 1.2 },                   // 22
  title3:     { fontSize: "1.25rem",   lineHeight: 1.25 },                  // 20
  headline:   { fontSize: "1.0625rem", lineHeight: 1.3, fontWeight: 600 },  // 17 semibold
  body:       { fontSize: "1.0625rem", lineHeight: 1.4 },                  // 17
  callout:    { fontSize: "1rem",      lineHeight: 1.4 },                  // 16
  subhead:    { fontSize: "0.9375rem", lineHeight: 1.4 },                  // 15
  footnote:   { fontSize: "0.8125rem", lineHeight: 1.4 },                  // 13
  caption:    { fontSize: "0.75rem",   lineHeight: 1.35 },                 // 12 — also the cap for tracked mono labels
};

// tracked, uppercase mono micro-labels (section headers, tags) — always capped at caption, never smaller
const labelType = (color, tracking = "0.14em") => ({
  fontFamily: mono, ...TYPE.caption, letterSpacing: tracking, color, textTransform: "uppercase",
});

// visual chip stays ~32pt tall (HIG's recognized exception for compact filter rows);
// pair with chipHitStyle so the *tappable* box still reaches 44pt without inflating the chip
const chipVisualStyle = (active) => ({
  padding: `${SPACE.sm}px ${SPACE.md}px`,
  borderRadius: RADIUS.pill,
  border: `1px solid ${active ? T.tobacco : T.line}`,
  background: active ? T.tobacco : "transparent",
  color: active ? T.bg : T.stone,
  fontFamily: mono, ...TYPE.caption,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
});

const chipHitStyle = {
  minHeight: TOUCH.min,
  display: "inline-flex",
  alignItems: "center",
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  flexShrink: 0,
};

// same hit-slop pattern for the small piece-name toggle chips (PiecePicker)
const toggleVisualStyle = (active) => ({
  padding: `${SPACE.sm}px ${SPACE.md}px`,
  borderRadius: RADIUS.pill,
  border: `1px solid ${active ? T.tobacco : T.line}`,
  background: active ? T.tobacco : "transparent",
  color: active ? T.bg : T.stone,
  fontFamily: mono, ...TYPE.footnote,
});

// ———— image compression ————
function compressImage(file, maxDim = 480) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ———— Claude API ————
async function askClaude(content, maxTokens = 1000) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      messages: [{ role: "user", content }],
    }),
  });
  const data = await res.json();
  const text = (data.content || []).map((b) => b.text || "").join("");
  return JSON.parse(text.replace(/```json|```/g, "").trim());
}

const imgBlock = (dataUrl) => ({
  type: "image",
  source: {
    type: "base64",
    media_type: "image/jpeg",
    data: dataUrl.split(",")[1],
  },
});

const closetSummary = (pieces) =>
  pieces
    .map((p) => `[${p.id}] ${p.name} — ${p.category}, ${p.color}, ${p.material}. ${p.vibe}`)
    .join("\n");

// ———— filter chip helpers ————
const categoryCounts = (list) =>
  CATEGORIES.map((c) => ({ id: c, count: list.filter((p) => p.category === c).length })).filter((c) => c.count > 0);

const todayIso = () => new Date().toISOString().slice(0, 10);
const isoDaysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const isoMonthsAgo = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); };
const fmtShortDate = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

// ————————————————————————————————————————————————

export default function Archive() {
  const [tab, setTab] = useState("closet");
  const [pieces, setPieces] = useState([]);
  const [inspo, setInspo] = useState([]);
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [assessment, setAssessment] = useState(null);
  const [savedFits, setSavedFits] = useState([]);
  const [gaps, setGaps] = useState(null);
  const [wants, setWants] = useState([]);
  const [myOutfits, setMyOutfits] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState(null);
  const [anchor, setAnchor] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);

  // shared top bar: fixed height (incl. safe-area inset), measured so pages can pad correctly
  const topBarRef = useRef(null);
  const [topBarHeight, setTopBarHeight] = useState(0);

  useEffect(() => {
    const el = topBarRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setTopBarHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // shared bottom dock: whichever tab is active registers its own primary action here
  const bottomBarRef = useRef(null);
  const [bottomBarHeight, setBottomBarHeight] = useState(0);
  const [cta, setCta] = useState(null);

  useEffect(() => {
    const el = bottomBarRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setBottomBarHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // load everything once
  useEffect(() => {
    (async () => {
      try {
        const listing = await window.storage.list("piece:");
        const keys = listing?.keys || [];
        const loadedPieces = [];
        for (const k of keys) {
          try {
            const r = await window.storage.get(k);
            if (r?.value) loadedPieces.push(JSON.parse(r.value));
          } catch (e) {}
        }
        loadedPieces.sort((a, b) => a.added - b.added);
        setPieces(loadedPieces);
      } catch (e) {}
      try {
        const listing = await window.storage.list("inspo:");
        const keys = listing?.keys || [];
        const loadedInspo = [];
        for (const k of keys) {
          try {
            const r = await window.storage.get(k);
            if (r?.value) loadedInspo.push(JSON.parse(r.value));
          } catch (e) {}
        }
        loadedInspo.sort((a, b) => a.added - b.added);
        setInspo(loadedInspo);
      } catch (e) {}
      try {
        const p = await window.storage.get("style-profile");
        if (p?.value) setProfile(p.value);
      } catch (e) {}
      try {
        const a = await window.storage.get("style-assessment");
        if (a?.value) setAssessment(JSON.parse(a.value));
      } catch (e) {}
      try {
        const listing = await window.storage.list("fit:");
        const keys = listing?.keys || [];
        const loadedFits = [];
        for (const k of keys) {
          try {
            const r = await window.storage.get(k);
            if (r?.value) loadedFits.push(JSON.parse(r.value));
          } catch (e) {}
        }
        loadedFits.sort((a, b) => b.saved - a.saved); // newest first
        setSavedFits(loadedFits);
      } catch (e) {}
      try {
        const g = await window.storage.get("closet-gaps");
        if (g?.value) setGaps(JSON.parse(g.value));
      } catch (e) {}
      try {
        const listing = await window.storage.list("want:");
        const wantKeys = listing?.keys || [];
        const loadedWants = [];
        for (const k of wantKeys) {
          try {
            const r = await window.storage.get(k);
            if (r?.value) loadedWants.push(JSON.parse(r.value));
          } catch (e) {}
        }
        loadedWants.sort((a, b) => b.added - a.added);
        setWants(loadedWants);
      } catch (e) {}
      try {
        const listing = await window.storage.list("myoutfit:");
        const oKeys = listing?.keys || [];
        const loadedOutfits = [];
        for (const k of oKeys) {
          try {
            const r = await window.storage.get(k);
            if (r?.value) loadedOutfits.push(JSON.parse(r.value));
          } catch (e) {}
        }
        loadedOutfits.sort((a, b) => b.added - a.added);
        setMyOutfits(loadedOutfits);
      } catch (e) {}
      setLoaded(true);
    })();
  }, []);

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const savePiece = async (piece) => {
    setPieces((prev) => [...prev, piece]);
    try {
      await window.storage.set("piece:" + piece.id, JSON.stringify(piece));
    } catch (e) {
      flash("Saved to session only — storage unavailable");
    }
  };

  const removePiece = async (id) => {
    setPieces((prev) => prev.filter((p) => p.id !== id));
    try {
      await window.storage.delete("piece:" + id);
    } catch (e) {}
  };

  const updatePiece = async (updated) => {
    setPieces((prev) => prev.map((p) => p.id === updated.id ? updated : p));
    try {
      await window.storage.set("piece:" + updated.id, JSON.stringify(updated));
    } catch (e) {
      flash("Saved to session only — storage unavailable");
    }
  };

  const saveProfile = async (text) => {
    setProfile(text);
    try {
      await window.storage.set("style-profile", text);
    } catch (e) {}
  };

  const saveInspo = async (item) => {
    setInspo((prev) => [...prev, item]);
    try {
      await window.storage.set("inspo:" + item.id, JSON.stringify(item));
    } catch (e) {
      flash("Saved to session only — storage unavailable");
    }
  };

  const removeInspo = async (id) => {
    setInspo((prev) => prev.filter((i) => i.id !== id));
    try {
      await window.storage.delete("inspo:" + id);
    } catch (e) {}
  };

  const saveAssessment = async (a) => {
    setAssessment(a);
    try {
      await window.storage.set("style-assessment", JSON.stringify(a));
    } catch (e) {
      flash("Saved to session only — storage unavailable");
    }
  };

  const saveFit = async (fit) => {
    const record = { ...fit, id: "f" + Date.now(), saved: Date.now() };
    setSavedFits((prev) => [record, ...prev]);
    try {
      await window.storage.set("fit:" + record.id, JSON.stringify(record));
    } catch (e) {
      flash("Saved to session only — storage unavailable");
    }
  };

  const removeFit = async (id) => {
    setSavedFits((prev) => prev.filter((f) => f.id !== id));
    try {
      await window.storage.delete("fit:" + id);
    } catch (e) {}
  };

  const saveGaps = async (g) => {
    setGaps(g);
    try {
      await window.storage.set("closet-gaps", JSON.stringify(g));
    } catch (e) {
      flash("Saved to session only — storage unavailable");
    }
  };

  const toggleGapOwned = async (idx) => {
    const next = {
      ...gaps,
      items: gaps.items.map((it, i) => (i === idx ? { ...it, owned: !it.owned } : it)),
    };
    setGaps(next);
    try {
      await window.storage.set("closet-gaps", JSON.stringify(next));
    } catch (e) {}
  };

  const saveWant = async (want) => {
    setWants((prev) => [want, ...prev]);
    try {
      await window.storage.set("want:" + want.id, JSON.stringify(want));
    } catch (e) {
      flash("Filed to session only — storage unavailable");
    }
  };

  const removeWant = async (id) => {
    setWants((prev) => prev.filter((w) => w.id !== id));
    try {
      await window.storage.delete("want:" + id);
    } catch (e) {}
  };

  const toggleWantOwned = async (id) => {
    const next = wants.map((w) => w.id === id ? { ...w, owned: !w.owned } : w);
    setWants(next);
    const updated = next.find((w) => w.id === id);
    if (updated) {
      try {
        await window.storage.set("want:" + id, JSON.stringify(updated));
      } catch (e) {}
    }
  };

  const saveMyOutfit = async (outfit) => {
    setMyOutfits((prev) => [outfit, ...prev]);
    try {
      await window.storage.set("myoutfit:" + outfit.id, JSON.stringify(outfit));
    } catch (e) {
      flash("Saved to session only — storage unavailable");
    }
  };

  const removeMyOutfit = async (id) => {
    const outfit = myOutfits.find((o) => o.id === id);
    setMyOutfits((prev) => prev.filter((o) => o.id !== id));
    try {
      await window.storage.delete("myoutfit:" + id);
    } catch (e) {}
    if (outfit?.imageIds?.length) deleteImages(outfit.imageIds).catch(() => {});
  };

  const updateMyOutfit = async (updated) => {
    setMyOutfits((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    try {
      await window.storage.set("myoutfit:" + updated.id, JSON.stringify(updated));
    } catch (e) {
      flash("Saved to session only — storage unavailable");
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.bg,
        color: T.bone,
        fontFamily: sans,
        paddingBottom: bottomBarHeight,
      }}
    >
      <style>{fontCss}</style>

      <TopBar topBarRef={topBarRef} onProfileClick={() => setProfileOpen(true)} />

      <main style={{ maxWidth: LAYOUT.maxWidth, margin: "0 auto", paddingTop: topBarHeight + SPACE.base, paddingBottom: SPACE.lg, paddingLeft: LAYOUT.screenMargin, paddingRight: LAYOUT.screenMargin }}>
        {!loaded ? (
          <div style={{ ...TYPE.caption, fontFamily: mono, color: T.stone, animation: "pulse 1.4s infinite", padding: SPACE.xl }}>
            Opening the archive…
          </div>
        ) : tab === "closet" ? (
          <Closet
            pieces={pieces}
            savePiece={savePiece}
            removePiece={removePiece}
            updatePiece={updatePiece}
            profile={profile}
            flash={flash}
            onBuildFit={(piece) => { setAnchor(piece); setTab("fits"); }}
            setCta={setCta}
            bottomBarHeight={bottomBarHeight}
            topBarHeight={topBarHeight}
          />
        ) : tab === "fits" ? (
          <Fits
            pieces={pieces}
            profile={profile}
            inspo={inspo}
            savedFits={savedFits}
            saveFit={saveFit}
            removeFit={removeFit}
            flash={flash}
            anchor={anchor}
            setAnchor={setAnchor}
            setCta={setCta}
            bottomBarHeight={bottomBarHeight}
          />
        ) : tab === "scan" ? (
          <Scan
            pieces={pieces}
            profile={profile}
            flash={flash}
            saveWant={saveWant}
            setCta={setCta}
            bottomBarHeight={bottomBarHeight}
          />
        ) : tab === "gaps" ? (
          <Gaps
            pieces={pieces}
            profile={profile}
            inspo={inspo}
            gaps={gaps}
            saveGaps={saveGaps}
            toggleGapOwned={toggleGapOwned}
            wants={wants}
            removeWant={removeWant}
            toggleWantOwned={toggleWantOwned}
            flash={flash}
            setCta={setCta}
            bottomBarHeight={bottomBarHeight}
          />
        ) : (
          <Lookbook
            inspo={inspo}
            saveInspo={saveInspo}
            removeInspo={removeInspo}
            assessment={assessment}
            pieces={pieces}
            flash={flash}
            myOutfits={myOutfits}
            saveMyOutfit={saveMyOutfit}
            removeMyOutfit={removeMyOutfit}
            updateMyOutfit={updateMyOutfit}
            setCta={setCta}
            bottomBarHeight={bottomBarHeight}
          />
        )}
      </main>

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 88,
            left: "50%",
            transform: "translateX(-50%)",
            background: T.bone,
            color: T.bg,
            fontFamily: mono,
            ...TYPE.caption,
            padding: `${SPACE.sm + 2}px ${SPACE.md}px`,
            borderRadius: RADIUS.sm - 2,
            zIndex: 60,
            animation: "rise .25s ease",
          }}
        >
          {toast}
        </div>
      )}

      <BottomDock cta={cta} tab={tab} setTab={setTab} dockRef={bottomBarRef} />

      {profileOpen && (
        <ProfileScreen
          onClose={() => setProfileOpen(false)}
          profile={profile}
          saveProfile={saveProfile}
          inspo={inspo}
          pieces={pieces}
          myOutfits={myOutfits}
          assessment={assessment}
          saveAssessment={saveAssessment}
          flash={flash}
        />
      )}
    </div>
  );
}

// ———— shared bits ————

function GarmentTag({ piece, onMenu, dim }) {
  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.line}`,
        borderRadius: RADIUS.card,
        overflow: "hidden",
        opacity: dim ? 0.45 : 1,
        animation: "rise .3s ease",
      }}
    >
      <div style={{ aspectRatio: "1", background: T.cardUp, position: "relative" }}>
        {piece.image ? (
          <img src={piece.image} alt={piece.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: serif,
              ...TYPE.title1,
              color: T.faint,
            }}
          >
            {piece.name?.[0] || "?"}
          </div>
        )}
        {onMenu && (
          <button
            onClick={() => onMenu(piece)}
            aria-label={"Options for " + piece.name}
            style={{
              // 44pt hit target flush to the corner; the visible chip inside stays small — HIG exception for a secondary icon control
              position: "absolute",
              top: 0,
              right: 0,
              width: TOUCH.min,
              height: TOUCH.min,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              background: "none",
              padding: 0,
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: RADIUS.pill,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(27,24,21,.75)",
                backdropFilter: "blur(6px)",
                color: T.stone,
                fontSize: 16,
                lineHeight: 1,
                letterSpacing: "0.05em",
              }}
            >
              ⋯
            </span>
          </button>
        )}
      </div>
      <div style={{ padding: `${SPACE.sm}px ${SPACE.sm}px ${SPACE.md}px` }}>
        <div style={labelType(T.tobacco, "0.18em")}>
          {piece.category}
        </div>
        <div style={{ ...TYPE.footnote, marginTop: SPACE.xs, lineHeight: 1.3 }}>{piece.name}</div>
        <div style={{ ...TYPE.caption, fontFamily: mono, color: T.faint, marginTop: SPACE.xs }}>
          {piece.color}
          {piece.material ? " · " + piece.material : ""}
        </div>
      </div>
    </div>
  );
}

// ———— BOTTOM SHEET ————

function BottomSheet({ piece, pieces, profile, onClose, onRemove, onUpdate, onBuildFit, flash }) {
  const [view, setView] = useState("menu");
  const [pairResult, setPairResult] = useState(null);
  const [pairBusy, setPairBusy] = useState(false);
  const [editName, setEditName] = useState(piece.name || "");
  const [editCategory, setEditCategory] = useState(piece.category || "");
  const [editColor, setEditColor] = useState(piece.color || "");
  const [editMaterial, setEditMaterial] = useState(piece.material || "");

  const getPairs = async () => {
    setPairBusy(true);
    try {
      const others = pieces.filter((p) => p.id !== piece.id);
      const result = await askClaude([{
        type: "text",
        text: `You are a stylist. Anchor piece: "${piece.name}" — ${piece.category}, ${piece.color}${piece.material ? ", " + piece.material : ""}. ${piece.vibe || ""}\n\nCloset:\n${closetSummary(others)}\n\nIn one sentence, what does this piece want to be worn with? Then pick up to 6 piece IDs from the closet that pair best.\n\nRespond ONLY with JSON, no markdown: {"sentence": "one styling sentence", "pair_ids": ["id1", "id2"]}`,
      }]);
      setPairResult(result);
    } catch (e) {
      flash("Couldn't get pairs — try again");
    }
    setPairBusy(false);
  };

  const saveEdit = async () => {
    await onUpdate({
      ...piece,
      name: editName.trim() || piece.name,
      category: editCategory,
      color: editColor.trim() || piece.color,
      material: editMaterial.trim(),
    });
    flash("Piece updated");
    onClose();
  };

  const pairPieces = pairResult ? pieces.filter((p) => pairResult.pair_ids?.includes(p.id)) : [];

  const fieldLabel = (label) => (
    <div style={{ ...labelType(T.faint), marginBottom: SPACE.xs }}>{label}</div>
  );
  const fieldInput = (value, onChange) => (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%", minHeight: TOUCH.min, padding: `0 ${SPACE.md + 2}px`, borderRadius: RADIUS.sm,
        border: `1px solid ${T.line}`, background: T.cardUp,
        color: T.bone, ...TYPE.subhead, fontFamily: sans, marginBottom: SPACE.md,
      }}
    />
  );

  const menuActions = [
    { title: "Build a fit around this", desc: "Generates an outfit with this piece as the mandatory centerpiece.", onClick: () => onBuildFit(piece) },
    { title: "What it pairs with", desc: "AI reads your closet and finds its natural styling partners.", onClick: () => { setView("pairs"); if (!pairResult) getPairs(); } },
    { title: "Edit details", desc: "Fix the name, category, color, or material.", onClick: () => setView("edit") },
    { title: "Remove from closet", desc: "Permanently delete this piece from your archive.", onClick: () => setView("confirm"), danger: true },
  ];

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200 }} />
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, maxHeight: "82vh",
        background: T.card, borderRadius: "16px 16px 0 0", zIndex: 201,
        display: "flex", flexDirection: "column",
        animation: "slideUp .28s ease",
        border: `1px solid ${T.line}`, borderBottom: "none",
      }}>
        {/* drag handle */}
        <div onClick={onClose} style={{ display: "flex", justifyContent: "center", padding: `${SPACE.md}px 0 ${SPACE.sm}px`, cursor: "pointer", flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: T.line }} />
        </div>

        {/* header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: SPACE.md, padding: `0 ${LAYOUT.screenMargin}px ${SPACE.md + 2}px`, flexShrink: 0, borderBottom: `1px solid ${T.line}` }}>
          <div style={{ width: 56, height: 56, borderRadius: RADIUS.sm, overflow: "hidden", flexShrink: 0, background: T.cardUp, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {piece.image
              ? <img src={piece.image} alt={piece.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <span style={{ fontFamily: serif, ...TYPE.title2, color: T.faint }}>{piece.name?.[0] || "?"}</span>}
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div style={labelType(T.tobacco, "0.18em")}>{piece.category}</div>
            <div style={{ fontFamily: serif, ...TYPE.title3, lineHeight: 1.2, marginTop: 2 }}>{piece.name}</div>
            <div style={{ ...TYPE.caption, fontFamily: mono, color: T.faint, marginTop: SPACE.xs }}>
              {piece.color}{piece.material ? " · " + piece.material : ""}
            </div>
          </div>
          <button
            onClick={view === "menu" ? onClose : () => setView("menu")}
            aria-label={view === "menu" ? "Close" : "Back"}
            style={{ minWidth: TOUCH.min, minHeight: TOUCH.min, border: "none", background: "none", color: T.faint, ...TYPE.title3, cursor: "pointer", padding: 4, lineHeight: 1, flexShrink: 0 }}
          >
            {view === "menu" ? "×" : "←"}
          </button>
        </div>

        {/* scrollable body */}
        <div style={{ overflowY: "auto", flex: 1, padding: `0 ${LAYOUT.screenMargin}px ${SPACE.xxxxl}px` }}>

          {/* — menu — */}
          {view === "menu" && (
            <div>
              {menuActions.map(({ title, desc, onClick, danger }) => (
                <button key={title} onClick={onClick} style={{
                  width: "100%", textAlign: "left", minHeight: TOUCH.min, padding: `${SPACE.md - 1}px 0`,
                  border: "none", borderBottom: `1px solid ${T.line}`,
                  background: "none", cursor: "pointer", fontFamily: sans,
                }}>
                  <div style={{ ...TYPE.subhead, color: danger ? T.bad : T.bone }}>{title}</div>
                  <div style={{ ...TYPE.caption, color: T.faint, marginTop: 3, lineHeight: 1.4 }}>{desc}</div>
                </button>
              ))}
            </div>
          )}

          {/* — pairs — */}
          {view === "pairs" && (
            <div style={{ paddingTop: SPACE.md }}>
              {pairBusy && <Thinking label="Finding its partners…" />}
              {!pairBusy && pairResult && (
                <>
                  <p style={{ ...TYPE.subhead, lineHeight: 1.65, color: T.stone, margin: `0 0 ${SPACE.md}px` }}>{pairResult.sentence}</p>
                  {pairPieces.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: SPACE.sm, marginBottom: SPACE.md }}>
                      {pairPieces.map((p) => <GarmentTag key={p.id} piece={p} />)}
                    </div>
                  )}
                  <Btn onClick={() => onBuildFit(piece)}>Build a full fit from this</Btn>
                </>
              )}
              {!pairBusy && !pairResult && (
                <div style={{ padding: `${SPACE.xl}px 0` }}><Btn onClick={getPairs}>Find pairs</Btn></div>
              )}
            </div>
          )}

          {/* — edit — */}
          {view === "edit" && (
            <div style={{ paddingTop: SPACE.md }}>
              {fieldLabel("NAME")}{fieldInput(editName, setEditName)}
              {fieldLabel("CATEGORY")}
              <div style={{ display: "flex", flexWrap: "wrap", gap: TOUCH.gap, marginBottom: SPACE.md }}>
                {CATEGORIES.map((c) => (
                  <button key={c} onClick={() => setEditCategory(c)} style={chipHitStyle}>
                    <span style={chipVisualStyle(editCategory === c)}>{c}</span>
                  </button>
                ))}
              </div>
              {fieldLabel("COLOR")}{fieldInput(editColor, setEditColor)}
              {fieldLabel("MATERIAL")}{fieldInput(editMaterial, setEditMaterial)}
              <Btn onClick={saveEdit}>Save changes</Btn>
            </div>
          )}

          {/* — confirm delete — */}
          {view === "confirm" && (
            <div style={{ paddingTop: SPACE.xl, textAlign: "center" }}>
              <div style={{ fontFamily: serif, ...TYPE.title2, marginBottom: SPACE.sm }}>Remove this piece?</div>
              <p style={{ ...TYPE.subhead, color: T.stone, lineHeight: 1.6, margin: `0 0 ${SPACE.xl}px` }}>
                This permanently deletes <strong style={{ color: T.bone }}>{piece.name}</strong> from your archive. It can't be undone.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: SPACE.sm }}>
                <button onClick={() => { onRemove(piece.id); onClose(); }} style={{
                  width: "100%", minHeight: TOUCH.min, padding: `0 ${LAYOUT.screenMargin}px`, borderRadius: RADIUS.sm,
                  border: "none", background: T.bad, color: T.bone,
                  fontFamily: mono, ...TYPE.caption, letterSpacing: "0.12em",
                  textTransform: "uppercase", cursor: "pointer",
                }}>Yes, remove it</button>
                <Btn ghost onClick={() => setView("menu")}>Keep it</Btn>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Btn({ children, onClick, disabled, ghost }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        minHeight: TOUCH.min,
        padding: `${SPACE.md - 2}px ${LAYOUT.screenMargin}px`,
        borderRadius: RADIUS.sm,
        border: ghost ? `1px solid ${T.line}` : "none",
        background: ghost ? "transparent" : disabled ? T.faint : T.tobacco,
        color: ghost ? T.stone : T.bg,
        fontFamily: mono,
        ...TYPE.caption,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Thinking({ label }) {
  return (
    <div style={{ fontFamily: mono, ...TYPE.caption, color: T.tobacco, padding: `${SPACE.lg}px ${SPACE.xs}px`, animation: "pulse 1.4s infinite" }}>
      {label}
    </div>
  );
}

// keeps a click handler stable across renders while always calling the latest closure — avoids re-registering a CTA on every keystroke
function useStableCallback(fn) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args) => ref.current(...args), []);
}

function ProfileGlyph({ color = T.stone, size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-7 8-7s8 3 8 7" />
    </svg>
  );
}

function TopBar({ topBarRef, onProfileClick }) {
  return (
    <div
      ref={topBarRef}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        background: T.bg,
        borderBottom: `1px solid ${T.line}`,
        paddingTop: SAFE_TOP,
      }}
    >
      <div
        style={{
          maxWidth: LAYOUT.maxWidth,
          margin: "0 auto",
          padding: `0 ${LAYOUT.screenMargin}px`,
          height: TOUCH.min,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ fontFamily: serif, ...TYPE.title3 }}>
          Archive<span style={{ color: T.tobacco }}>.</span>
        </div>
        <button
          onClick={onProfileClick}
          aria-label="Profile and preferences"
          style={{
            width: TOUCH.min,
            height: TOUCH.min,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            background: "none",
            padding: 0,
            cursor: "pointer",
          }}
        >
          <ProfileGlyph />
        </button>
      </div>
    </div>
  );
}

function ProfileScreen({ onClose, profile, saveProfile, inspo, pieces, myOutfits, assessment, saveAssessment, flash }) {
  const [draft, setDraft] = useState(profile);
  const [assessBusy, setAssessBusy] = useState(false);

  useEffect(() => setDraft(profile), [profile]);

  const unsaved = draft !== profile;
  const fp = draft.trim() + "|" + inspo.map((i) => i.id).join(",") + "|" + myOutfits.map((o) => o.id).join(",");
  const stale = assessment && assessment.fp !== fp;

  const runAssessment = async () => {
    setAssessBusy(true);
    try {
      saveProfile(draft);
      const inspoNotes = inspo.length
        ? `\n\nInspo board vibes:\n${inspo.map((i) => "- " + i.vibe).join("\n")}`
        : "\n\n(No inspo images yet.)";
      const closetNotes = pieces.length
        ? `\n\nCurrent closet:\n${closetSummary(pieces)}`
        : "";
      // cap sample so the payload stays reasonable
      const outfitSample = myOutfits.slice(0, 8);
      const outfitImageBlocks = [];
      const outfitLines = [];
      for (const o of outfitSample) {
        const firstId = o.imageIds?.[0];
        if (firstId) {
          try {
            const dataUrl = await loadImage(firstId);
            if (dataUrl) outfitImageBlocks.push(imgBlock(dataUrl));
          } catch (e) {}
        }
        const wornNames = (o.pieceIds || [])
          .map((id) => pieces.find((p) => p.id === id)?.name)
          .filter(Boolean);
        outfitLines.push(
          `- ${o.dateWorn}${o.occasion ? " · " + o.occasion : ""}${wornNames.length ? " · " + wornNames.join(", ") : ""}${o.note ? " · " + o.note : ""}`
        );
      }
      const outfitNotes = myOutfits.length
        ? `\n\nSelf-outfit photos logged (${myOutfits.length} total):\n${outfitLines.join("\n")}`
        : "\n\n(No self-outfit photos logged yet.)";
      const result = await askClaude(
        [
          ...outfitImageBlocks,
          {
            type: "text",
            text: `You are a sharp menswear stylist doing a style assessment. The client describes their style as: "${draft}"${inspoNotes}${closetNotes}${outfitNotes}${outfitImageBlocks.length ? "\n\n(Photos above are outfits they've actually worn.)" : ""}\n\nThey likely run more than one style lane at once — don't force everything into a single identity. Identify 2 to 4 DISTINCT style profiles across their stated style, inspo, closet, and outfit photos, ranked primary through quaternary by dominance. If they genuinely only run one coherent lane, return just that 1 profile rather than padding to reach a minimum. Judge every profile only against its own internal logic. Hard rules: never describe a profile as undermining, interrupting, or in tension with another; never use the phrase "blind spot"; never collapse multiple lanes into a single hybrid label to make the read tidier.\n\nFor each profile, give a 2-4 word headline, a 3-4 sentence read of what that lane actually looks like on its own terms (fit, palette, texture, occasion), 4 short pillar phrases, a "direction" (a short phrase for where the inspo board suggests this lane is heading, or "stable" if there's no signal), and an "activity" status — "active" if this lane shows up in the outfit photos, "dormant" if the closet supports it but it hasn't been worn. Then list shared_pieces: closet items that serve more than one profile, each tagged with which profile ranks they serve — frame these as the connective tissue holding the closet together, not as evidence of confusion.\n\nRespond ONLY with JSON, no markdown: {"profiles": [{"rank": "primary" | "secondary" | "tertiary" | "quaternary", "headline": "...", "read": "...", "pillars": ["...", "...", "...", "..."], "direction": "...", "activity": "active" | "dormant"}], "shared_pieces": [{"item": "short piece name", "profiles": ["primary", "secondary"]}]}`,
          },
        ],
        2000
      );
      await saveAssessment({ profiles: result.profiles, shared_pieces: result.shared_pieces || [], fp, at: Date.now() });
      flash("Assessment updated");
    } catch (e) {
      flash("Assessment failed — try again");
    }
    setAssessBusy(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: T.bg, display: "flex", flexDirection: "column" }}>
      <div style={{ paddingTop: SAFE_TOP, borderBottom: `1px solid ${T.line}`, flexShrink: 0 }}>
        <div
          style={{
            maxWidth: LAYOUT.maxWidth,
            margin: "0 auto",
            padding: `0 ${LAYOUT.screenMargin}px`,
            height: TOUCH.min,
            display: "flex",
            alignItems: "center",
            gap: SPACE.sm,
          }}
        >
          <button
            onClick={onClose}
            aria-label="Back"
            style={{
              width: TOUCH.min,
              height: TOUCH.min,
              marginLeft: -SPACE.md,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "none",
              background: "none",
              color: T.faint,
              ...TYPE.title3,
              cursor: "pointer",
            }}
          >
            ←
          </button>
          <div style={{ fontFamily: serif, ...TYPE.title3 }}>Profile</div>
        </div>
      </div>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          maxWidth: LAYOUT.maxWidth,
          margin: "0 auto",
          width: "100%",
          padding: `${SPACE.xl}px ${LAYOUT.screenMargin}px`,
          paddingBottom: `calc(${SPACE.xxxxl}px + ${SAFE_BOTTOM})`,
        }}
      >
        {/* ── My Style (free text) ── */}
        <div style={labelType(T.tobacco, "0.2em")}>MY STYLE</div>
        <p style={{ ...TYPE.footnote, color: T.faint, margin: `${SPACE.xs}px 0 ${SPACE.md}px`, lineHeight: 1.6 }}>
          The AI judges every fit and scan against this. Keep it honest — colors, cuts, what you never wear.
        </p>
        {unsaved && (
          <div style={{ ...TYPE.caption, fontFamily: mono, color: T.tobacco, marginBottom: SPACE.sm, animation: "rise .3s ease" }}>
            Unsaved changes
          </div>
        )}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          style={{
            width: "100%",
            padding: SPACE.md + 2,
            borderRadius: RADIUS.sm,
            border: `1px solid ${T.line}`,
            background: T.card,
            color: T.bone,
            ...TYPE.subhead,
            lineHeight: 1.6,
            fontFamily: sans,
            resize: "vertical",
          }}
        />
        {!draft.trim() && (
          <div style={{ padding: `${SPACE.md}px 0 0`, textAlign: "center" }}>
            <div style={{ ...TYPE.footnote, color: T.faint, lineHeight: 1.6 }}>
              Describe your aesthetic — preferred colors, silhouettes, what you'd never wear. The more specific, the sharper the AI's suggestions.
            </div>
          </div>
        )}
        <div style={{ marginTop: SPACE.md }}>
          <Btn onClick={() => { saveProfile(draft); flash("Profile saved"); }}>Save my style</Btn>
        </div>

        {/* ── Preferences (structured — coming soon) ── */}
        <div style={{ height: 1, background: T.line, margin: `${SPACE.xxl}px 0 ${SPACE.lg}px` }} />
        <div style={labelType(T.tobacco, "0.2em")}>PREFERENCES</div>
        <p style={{ ...TYPE.footnote, color: T.faint, margin: `${SPACE.xs}px 0 0`, lineHeight: 1.6 }}>
          Fit by category, colors to avoid, occasions dressed for, and sizes — coming soon. Account settings will live here too.
        </p>

        {/* ── Style Assessment ── */}
        <div style={{ height: 1, background: T.line, margin: `${SPACE.xxl}px 0 ${SPACE.lg}px` }} />
        <div style={labelType(T.tobacco, "0.2em")}>STYLE ASSESSMENT</div>
        <p style={{ ...TYPE.footnote, color: T.faint, margin: `${SPACE.xs}px 0 ${SPACE.md}px`, lineHeight: 1.6 }}>
          A synthesis of your written profile, inspo board, closet, and outfit photos — broken into the distinct style lanes actually running through your closet.
        </p>
        {stale && !assessBusy && (
          <div style={{ ...TYPE.caption, fontFamily: mono, color: T.tobacco, marginBottom: SPACE.sm, animation: "rise .3s ease" }}>
            Your profile, inspo, or outfits changed since this assessment.
          </div>
        )}
        <Btn onClick={runAssessment} disabled={assessBusy}>
          {assessBusy ? "Assessing…" : assessment ? "Update assessment" : "Run assessment"}
        </Btn>
        {assessBusy && <Thinking label="Reading between your pieces…" />}
        {assessment ? (
          <div style={{ marginTop: SPACE.md, animation: "rise .3s ease" }}>
            {(assessment.profiles || []).map((prof, idx) => (
              <div
                key={idx}
                style={{
                  background: T.card,
                  border: `1px solid ${stale ? T.tobacco : T.line}`,
                  borderRadius: RADIUS.md,
                  padding: `${SPACE.lg - 2}px ${SPACE.md + 4}px`,
                  marginBottom: SPACE.md,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={labelType(T.tobacco, "0.2em")}>
                    {(prof.rank || "").toUpperCase()}
                  </div>
                  {prof.activity && (
                    <div
                      style={{
                        ...labelType(prof.activity === "active" ? T.olive : T.faint, "0.1em"),
                        padding: "3px 8px",
                        borderRadius: RADIUS.pill,
                        border: `1px solid ${prof.activity === "active" ? T.olive : T.line}`,
                      }}
                    >
                      {prof.activity}
                    </div>
                  )}
                </div>
                <div style={{ fontFamily: serif, ...TYPE.title1, margin: `${SPACE.xs}px 0 ${SPACE.sm + 2}px` }}>{prof.headline}</div>
                <p style={{ ...TYPE.subhead, lineHeight: 1.65, color: T.stone, margin: `0 0 ${SPACE.md}px` }}>{prof.read}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: TOUCH.gap, marginBottom: prof.direction ? SPACE.md : 0 }}>
                  {(prof.pillars || []).map((p, i) => (
                    <span
                      key={i}
                      style={{
                        padding: "5px 11px",
                        borderRadius: RADIUS.pill,
                        border: `1px solid ${T.line}`,
                        background: T.cardUp,
                        fontFamily: mono,
                        ...TYPE.caption,
                        letterSpacing: "0.08em",
                        color: T.bone,
                        textTransform: "uppercase",
                      }}
                    >
                      {p}
                    </span>
                  ))}
                </div>
                {prof.direction && (
                  <div style={{ ...TYPE.footnote, lineHeight: 1.55, color: T.stone, borderLeft: `2px solid ${T.olive}`, paddingLeft: SPACE.sm + 2 }}>
                    <span style={labelType(T.olive, "0.15em")}>DIRECTION: </span>
                    {prof.direction}
                  </div>
                )}
              </div>
            ))}
            {assessment.shared_pieces?.length > 0 && (
              <div>
                <div style={{ ...labelType(T.tobacco, "0.2em"), marginBottom: SPACE.sm }}>
                  SHARED PIECES
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: TOUCH.gap }}>
                  {assessment.shared_pieces.map((sp, i) => (
                    <div
                      key={i}
                      style={{
                        ...TYPE.footnote,
                        lineHeight: 1.5,
                        color: T.stone,
                        background: T.card,
                        border: `1px solid ${T.line}`,
                        borderRadius: RADIUS.sm,
                        padding: `${SPACE.sm + 2}px ${SPACE.md}px`,
                      }}
                    >
                      <span style={{ color: T.bone }}>{sp.item}</span>
                      <span style={{ color: T.faint }}> — holds together {(sp.profiles || []).join(" + ")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : !assessBusy ? (
          <div style={{ padding: `${SPACE.xl}px ${SPACE.md}px`, textAlign: "center" }}>
            <div style={{ fontFamily: serif, ...TYPE.title2, color: T.stone }}>No assessment yet.</div>
            <div style={{ ...TYPE.footnote, color: T.faint, marginTop: SPACE.sm, lineHeight: 1.6 }}>
              Fill in your style profile and run the assessment to see the style lanes running through your closet.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BottomDock({ cta, tab, setTab, dockRef }) {
  return (
    <div
      ref={dockRef}
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: T.bg,
        zIndex: 50,
      }}
    >
      {cta && (
        <div style={{ maxWidth: LAYOUT.maxWidth, margin: "0 auto", padding: `${SPACE.md}px ${LAYOUT.screenMargin}px` }}>
          <Btn onClick={cta.onClick} disabled={cta.disabled}>
            {cta.label}
          </Btn>
        </div>
      )}
      <nav
        style={{
          background: T.card,
          borderTop: `1px solid ${T.line}`,
          display: "flex",
          height: NAV_HEIGHT,
          paddingBottom: SAFE_BOTTOM,
        }}
      >
        {[
          ["closet", "Closet"],
          ["fits", "Fits"],
          ["scan", "Scan"],
          ["gaps", "Gaps"],
          ["style", "Lookbook"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              flex: 1,
              minHeight: TOUCH.min,
              background: "none",
              border: "none",
              borderTop: tab === id ? `2px solid ${T.tobacco}` : "2px solid transparent",
              color: tab === id ? T.bone : T.faint,
              fontFamily: mono,
              ...TYPE.caption,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// ———— CLOSET ————

function Closet({ pieces, savePiece, removePiece, updatePiece, profile, flash, onBuildFit, setCta, bottomBarHeight, topBarHeight }) {
  const fileRef = useRef();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // {done, total}
  const [filter, setFilter] = useState("all");
  const [sheetPiece, setSheetPiece] = useState(null);
  const [chipVisible, setChipVisible] = useState(true);

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    let added = 0;
    for (let i = 0; i < files.length; i++) {
      setProgress({ done: i, total: files.length });
      try {
        const image = await compressImage(files[i]);
        const tags = await askClaude([
          imgBlock(image),
          {
            type: "text",
            text: `Catalog this clothing item. Respond ONLY with JSON, no markdown: {"name": "short specific name e.g. 'Espresso lug-sole loafer'", "category": one of ${JSON.stringify(CATEGORIES)}, "color": "primary color", "material": "best guess material", "vibe": "one short phrase on the aesthetic", "seasons": ["applicable seasons"]}`,
          },
        ]);
        await savePiece({
          id: "p" + Date.now() + "_" + i,
          added: Date.now() + i,
          image,
          ...tags,
        });
        added++;
      } catch (err) {}
    }
    setProgress(null);
    setBusy(false);
    flash(
      added === files.length
        ? `Added ${added} piece${added === 1 ? "" : "s"}`
        : `Added ${added} of ${files.length} — retry the rest`
    );
  };

  useEffect(() => {
    setCta({
      label: busy ? "Cataloguing…" : "+ Add pieces from photos",
      onClick: () => fileRef.current?.click(),
      disabled: busy,
    });
    return () => setCta(null);
  }, [busy, setCta]);

  // reveal the chip row on any upward scroll, hide it past a small downward threshold — the threshold keeps scroll jitter from flickering it
  useEffect(() => {
    let lastY = window.scrollY;
    const THRESHOLD = 8;
    const onScroll = () => {
      const y = Math.max(0, window.scrollY);
      if (y <= 0) {
        setChipVisible(true);
        lastY = y;
        return;
      }
      const delta = y - lastY;
      if (delta > THRESHOLD) {
        setChipVisible(false);
        lastY = y;
      } else if (delta < -THRESHOLD) {
        setChipVisible(true);
        lastY = y;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const shown = filter === "all" ? pieces : pieces.filter((p) => p.category === filter);

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleFiles} />
      {busy && (
        <Thinking
          label={
            progress && progress.total > 1
              ? `Cataloguing ${progress.done + 1} of ${progress.total}…`
              : "Reading fabric, color, silhouette…"
          }
        />
      )}

      <div style={{ ...TYPE.caption, fontFamily: mono, color: T.faint, margin: `${SPACE.xs}px 0` }}>
        {pieces.length} piece{pieces.length === 1 ? "" : "s"} catalogued
      </div>

      {pieces.length > 0 && (
        <div
          style={{
            position: "fixed",
            top: topBarHeight,
            left: 0,
            right: 0,
            zIndex: 45,
            background: T.bg,
            borderBottom: `1px solid ${T.line}`,
            transform: `translateY(${chipVisible ? "0" : "-100%"})`,
            transition: "transform 200ms ease",
          }}
        >
          <div
            style={{
              maxWidth: LAYOUT.maxWidth,
              margin: "0 auto",
              padding: `${SPACE.xs}px ${LAYOUT.screenMargin}px`,
              display: "flex",
              gap: TOUCH.gap,
              overflowX: "auto",
            }}
          >
            {["all", ...CATEGORIES].map((c) => (
              <button key={c} onClick={() => setFilter(c)} style={chipHitStyle}>
                <span style={chipVisualStyle(filter === c)}>{c}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {pieces.length === 0 && !busy ? (
        <div style={{ padding: `${SPACE.xxxxl}px ${SPACE.md}px`, textAlign: "center" }}>
          <div style={{ fontFamily: serif, ...TYPE.title1, color: T.stone }}>The rack is empty.</div>
          <div style={{ ...TYPE.subhead, color: T.faint, marginTop: SPACE.sm, lineHeight: 1.6 }}>
            Photograph a piece to start the index. Flat-lay or on-hanger shots work best.
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: SPACE.sm,
            marginTop: SPACE.sm,
            paddingBottom: `${bottomBarHeight}px`,
          }}
        >
          {shown.map((p) => (
            <GarmentTag key={p.id} piece={p} onMenu={() => setSheetPiece(p)} />
          ))}
        </div>
      )}

      {sheetPiece && (
        <BottomSheet
          piece={sheetPiece}
          pieces={pieces}
          profile={profile}
          flash={flash}
          onClose={() => setSheetPiece(null)}
          onRemove={(id) => { removePiece(id); setSheetPiece(null); }}
          onUpdate={updatePiece}
          onBuildFit={(p) => { setSheetPiece(null); onBuildFit(p); }}
        />
      )}
    </div>
  );
}

// ———— FITS ————

function Fits({ pieces, profile, inspo, savedFits, saveFit, removeFit, flash, anchor, setAnchor, setCta, bottomBarHeight }) {
  const [occasion, setOccasion] = useState("");
  const [busy, setBusy] = useState(false);
  const [fit, setFit] = useState(null);
  const [stashed, setStashed] = useState(false);

  const anchorConsumed = useRef(false);
  useEffect(() => {
    if (!anchor) { anchorConsumed.current = false; return; }
    if (anchorConsumed.current) return;
    anchorConsumed.current = true;
    generate(anchor);
  }, [anchor?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async (anchorPiece = anchor) => {
    if (pieces.length < 3) return flash("Add at least 3 pieces first");
    setBusy(true);
    setFit(null);
    setStashed(false);
    try {
      const inspoNotes = inspo.length
        ? `\n\nInspo board (aesthetics they're drawn to — let these steer silhouette and styling):\n${inspo
            .map((i) => "- " + i.vibe)
            .join("\n")}`
        : "";
      const clothing = pieces.filter((p) => p.category !== "accessory");
      const accessories = pieces.filter((p) => p.category === "accessory");
      const clothingSummary = clothing
        .map((p) => `[${p.id}] ${p.name} — ${p.category}, ${p.color}, ${p.material}. ${p.vibe}`)
        .join("\n");
      const accessorySummary = accessories.length
        ? accessories.map((p) => `[${p.id}] ${p.name} — ${p.color}. ${p.vibe}`).join("\n")
        : "(none)";

      const result = await askClaude(
        [
          {
            type: "text",
            text: `You are a personal stylist with sharp editorial instincts. Style profile: ${profile}${inspoNotes}${anchorPiece ? `\n\n— MANDATORY ANCHOR —\nThis outfit MUST be built around [${anchorPiece.id}] "${anchorPiece.name}" (${anchorPiece.category}). It MUST appear in piece_ids. Let its color palette and silhouette drive every other selection.` : ""}\n\n— CLOTHING (build the fit exclusively from these) —\n${clothingSummary}\n\n— ACCESSORIES: hats, caps, bags, jewelry (do NOT put these in piece_ids; only suggest one in optional_piece_ids if it truly completes this specific look — default is an empty array) —\n${accessorySummary}\n\nBuild one outfit for: "${occasion || "an everyday fit"}".\n\n1. Pick 3-5 clothing pieces that work together for the occasion, style profile, and color story. Rotate the closet — avoid defaulting to the same pieces every time.\n2. Only after the core fit is done: decide if any single accessory genuinely elevates it. If uncertain, leave optional_piece_ids empty.\n\nRespond ONLY with JSON, no markdown: {"title": "evocative 3-5 word fit name", "piece_ids": ["clothing ids only — absolutely no accessories here"], "optional_piece_ids": ["one accessory id if it genuinely elevates this look, otherwise []"], "why": "2-3 sentences on why this core combination works", "missing": "one piece not in the closet that would elevate this fit, or null"}`,
          },
        ],
        1200
      );
      setFit(result);
    } catch (e) {
      flash("Styling failed — try again");
    }
    setBusy(false);
  };

  const fitPieces = fit ? pieces.filter((p) => fit.piece_ids?.includes(p.id)) : [];
  const fitOptional = fit ? pieces.filter((p) => fit.optional_piece_ids?.includes(p.id)) : [];

  const stableGenerate = useStableCallback(() => generate());
  useEffect(() => {
    setCta({
      label: busy ? "Styling…" : "Generate fit",
      onClick: stableGenerate,
      disabled: busy,
    });
    return () => setCta(null);
  }, [busy, stableGenerate, setCta]);

  return (
    <div style={{ paddingBottom: bottomBarHeight }}>
      <div style={{ fontFamily: serif, ...TYPE.title1, marginBottom: SPACE.md }}>Build a fit</div>
      {anchor && (
        <div style={{
          display: "flex", alignItems: "center", gap: SPACE.sm,
          background: T.cardUp, border: `1px solid ${T.tobacco}`,
          borderRadius: RADIUS.sm, padding: `${SPACE.sm}px ${SPACE.md - 2}px`, marginBottom: SPACE.sm,
          animation: "rise .3s ease",
        }}>
          {anchor.image && (
            <img src={anchor.image} alt={anchor.name} style={{ width: 36, height: 36, objectFit: "cover", borderRadius: RADIUS.sm / 2, flexShrink: 0 }} />
          )}
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div style={labelType(T.tobacco, "0.2em")}>Built around</div>
            <div style={{ ...TYPE.footnote, color: T.bone, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{anchor.name}</div>
          </div>
          <button onClick={() => setAnchor(null)} aria-label="Remove anchor" style={{ minWidth: TOUCH.min, minHeight: TOUCH.min, border: "none", background: "none", color: T.faint, ...TYPE.title3, cursor: "pointer", padding: 4, lineHeight: 1 }}>×</button>
        </div>
      )}
      <input
        value={occasion}
        onChange={(e) => setOccasion(e.target.value)}
        placeholder="Occasion — date night, gym-to-brunch, content shoot…"
        style={{
          width: "100%",
          minHeight: TOUCH.min,
          padding: `0 ${SPACE.md + 2}px`,
          borderRadius: RADIUS.sm,
          border: `1px solid ${T.line}`,
          background: T.card,
          color: T.bone,
          ...TYPE.subhead,
          marginBottom: SPACE.sm,
          fontFamily: sans,
        }}
      />
      {busy && <Thinking label="Pulling from the rack…" />}

      {fit && (
        <div style={{ marginTop: SPACE.lg, animation: "rise .3s ease" }}>
          <div style={labelType(T.tobacco, "0.2em")}>THE FIT</div>
          <div style={{ fontFamily: serif, ...TYPE.title1, margin: `${SPACE.xs}px 0 ${SPACE.md}px` }}>{fit.title}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SPACE.sm }}>
            {fitPieces.map((p) => (
              <GarmentTag key={p.id} piece={p} />
            ))}
          </div>
          {fitOptional.length > 0 && (
            <div style={{ marginTop: SPACE.md }}>
              <div style={{ ...labelType(T.faint, "0.18em"), marginBottom: SPACE.sm }}>
                OPTIONAL FINISH
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SPACE.sm }}>
                {fitOptional.map((p) => (
                  <GarmentTag key={p.id} piece={p} dim />
                ))}
              </div>
              <div style={{ ...TYPE.caption, fontFamily: mono, color: T.faint, marginTop: SPACE.xs }}>
                Add if it fits the vibe — not essential.
              </div>
            </div>
          )}
          <p style={{ ...TYPE.subhead, lineHeight: 1.65, color: T.stone, marginTop: SPACE.md }}>{fit.why}</p>
          {fit.missing && (
            <div
              style={{
                marginTop: SPACE.md,
                padding: `${SPACE.md}px ${SPACE.md + 2}px`,
                border: `1px dashed ${T.olive}`,
                borderRadius: RADIUS.sm,
                ...TYPE.footnote,
                color: T.stone,
                lineHeight: 1.5,
              }}
            >
              <span style={labelType(T.olive, "0.15em")}>
                WORTH HUNTING:{" "}
              </span>
              {fit.missing}
            </div>
          )}

          <div style={{ marginTop: SPACE.md }}>
            <Btn
              ghost
              disabled={stashed}
              onClick={() => {
                saveFit({ ...fit, occasion: occasion || "Everyday" });
                setStashed(true);
                flash("Saved to lookbook");
              }}
            >
              {stashed ? "In your lookbook" : "Save to lookbook"}
            </Btn>
          </div>
        </div>
      )}

      {savedFits.length > 0 && (
        <>
          <div style={{ height: 1, background: T.line, margin: `${SPACE.xxl}px 0 ${SPACE.lg}px` }} />
          <div style={{ fontFamily: serif, ...TYPE.title1, marginBottom: SPACE.xs }}>Lookbook</div>
          <p style={{ ...TYPE.footnote, color: T.faint, margin: `0 0 ${SPACE.md}px`, lineHeight: 1.6 }}>
            {savedFits.length} fit{savedFits.length === 1 ? "" : "s"} on file. Tap a piece row to see what's in it.
          </p>
          {savedFits.map((f) => {
            const fp = pieces.filter((p) => f.piece_ids?.includes(p.id));
            const fo = pieces.filter((p) => f.optional_piece_ids?.includes(p.id));
            return (
              <div
                key={f.id}
                style={{
                  background: T.card,
                  border: `1px solid ${T.line}`,
                  borderRadius: RADIUS.md,
                  padding: `${SPACE.md}px ${SPACE.md}px ${SPACE.md + 2}px`,
                  marginBottom: SPACE.sm,
                  animation: "rise .3s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: SPACE.sm }}>
                  <div>
                    <div style={{ fontFamily: serif, ...TYPE.title2, lineHeight: 1.2 }}>{f.title}</div>
                    <div style={{ ...labelType(T.tobacco, "0.14em"), marginTop: SPACE.xs }}>
                      {f.occasion}
                    </div>
                  </div>
                  <button
                    onClick={() => removeFit(f.id)}
                    aria-label={"Remove " + f.title}
                    style={{
                      minWidth: TOUCH.min,
                      minHeight: TOUCH.min,
                      border: "none",
                      background: "none",
                      color: T.faint,
                      fontSize: 16,
                      cursor: "pointer",
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
                {fp.length > 0 && (
                  <div style={{ display: "flex", gap: TOUCH.gap, marginTop: SPACE.md, overflowX: "auto", paddingBottom: 2 }}>
                    {fp.map((p) => (
                      <img
                        key={p.id}
                        src={p.image}
                        alt={p.name}
                        title={p.name}
                        style={{
                          width: 60,
                          height: 60,
                          objectFit: "cover",
                          borderRadius: RADIUS.sm - 2,
                          border: `1px solid ${T.line}`,
                          flexShrink: 0,
                        }}
                      />
                    ))}
                    {fo.map((p) => (
                      <img
                        key={p.id}
                        src={p.image}
                        alt={p.name}
                        title={p.name + " (optional)"}
                        style={{
                          width: 60,
                          height: 60,
                          objectFit: "cover",
                          borderRadius: RADIUS.sm - 2,
                          border: `1px dashed ${T.faint}`,
                          flexShrink: 0,
                          opacity: 0.55,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ———— SCAN ————

function Scan({ pieces, profile, flash, saveWant, setCta, bottomBarHeight }) {
  const fileRef = useRef();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [scanImg, setScanImg] = useState(null);
  const [logged, setLogged] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setResult(null);
    setLogged(false);
    try {
      const image = await compressImage(file);
      setScanImg(image);
      const r = await askClaude(
        [
          imgBlock(image),
          {
            type: "text",
            text: `You're advising a shopper in a store. Their style profile: ${profile}\n\nTheir closet:\n${
              closetSummary(pieces) || "(empty)"
            }\n\nJudge the item in the photo against their style and closet. Be honest — skip means skip. Respond ONLY with JSON, no markdown: {"verdict": "cop" | "skip" | "maybe", "score": 1-10 fit with their wardrobe, "take": "2-3 blunt sentences — does it match the profile, does it duplicate anything, what gap does it fill", "pairs_with": ["ids of up to 3 closet pieces it works with"], "item": "short specific name for this piece e.g. 'Black lug-sole penny loafer'", "price": "rough price range like '$180-240' if inferable from the photo, else null"}`,
          },
        ],
        1200
      );
      setResult(r);
      if (r.verdict === "cop") {
        const want = {
          id: "w" + Date.now(),
          item: r.item || "Scanned item",
          reason: r.take,
          price: r.price || null,
          score: r.score,
          image,
          owned: false,
          added: Date.now(),
        };
        await saveWant(want);
        setLogged(true);
      }
    } catch (e) {
      flash("Scan failed — try another angle");
    }
    setBusy(false);
  };

  const verdictColor = result?.verdict === "cop" ? T.olive : result?.verdict === "skip" ? T.bad : T.tobacco;
  const pairs = result ? pieces.filter((p) => result.pairs_with?.includes(p.id)) : [];

  useEffect(() => {
    setCta({
      label: busy ? "Judging…" : "Scan an item",
      onClick: () => fileRef.current?.click(),
      disabled: busy,
    });
    return () => setCta(null);
  }, [busy, setCta]);

  return (
    <div style={{ paddingBottom: bottomBarHeight }}>
      <div style={{ fontFamily: serif, ...TYPE.title1, marginBottom: SPACE.sm }}>Cop or skip?</div>
      <p style={{ ...TYPE.footnote, color: T.faint, margin: `0 0 ${SPACE.md}px`, lineHeight: 1.6 }}>
        See something in a store or online? Snap it and get a verdict against your actual closet.
      </p>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
      {busy && <Thinking label="Checking it against the archive…" />}

      {result && (
        <div style={{ marginTop: SPACE.lg, animation: "rise .3s ease" }}>
          {scanImg && (
            <img
              src={scanImg}
              alt="Scanned item"
              style={{ width: "100%", borderRadius: RADIUS.md, border: `1px solid ${T.line}`, marginBottom: SPACE.md }}
            />
          )}
          <div style={{ display: "flex", alignItems: "baseline", gap: SPACE.sm }}>
            <div style={{ fontFamily: serif, ...TYPE.largeTitle, color: verdictColor, textTransform: "capitalize" }}>
              {result.verdict}
            </div>
            <div style={{ ...TYPE.caption, fontFamily: mono, color: T.faint }}>{result.score}/10 closet fit</div>
          </div>
          {result.item && (
            <div style={{ fontFamily: serif, ...TYPE.headline, color: T.bone, marginTop: SPACE.xs, lineHeight: 1.3 }}>
              {result.item}
              {result.price && (
                <span style={{ ...TYPE.caption, fontFamily: mono, color: T.faint, marginLeft: SPACE.sm }}>{result.price}</span>
              )}
            </div>
          )}
          <p style={{ ...TYPE.subhead, lineHeight: 1.65, color: T.stone, marginTop: SPACE.sm }}>{result.take}</p>
          {logged && (
            <div style={{
              display: "flex", alignItems: "center", gap: TOUCH.gap,
              padding: `${SPACE.sm + 2}px ${SPACE.md}px`, borderRadius: RADIUS.sm,
              border: `1px solid ${T.olive}`, background: "rgba(122,122,82,0.12)",
              marginTop: SPACE.sm, animation: "rise .3s ease",
            }}>
              <span style={{ color: T.olive, ...TYPE.subhead }}>✓</span>
              <span style={{ ...TYPE.caption, fontFamily: mono, color: T.olive, letterSpacing: "0.05em" }}>
                Filed in What’s missing with the photo.
              </span>
            </div>
          )}
          {pairs.length > 0 && (
            <>
              <div style={{ ...labelType(T.tobacco, "0.2em"), margin: `${SPACE.md}px 0 ${SPACE.sm}px` }}>
                PAIRS WITH
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: TOUCH.gap }}>
                {pairs.map((p) => (
                  <GarmentTag key={p.id} piece={p} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ———— GAPS ————

function Gaps({ pieces, profile, inspo, gaps, saveGaps, toggleGapOwned, wants, removeWant, toggleWantOwned, flash, setCta, bottomBarHeight }) {
  const [busy, setBusy] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState(null);

  const fp = pieces.length + "|" + inspo.map((i) => i.id).join(",");
  const stale = gaps && gaps.fp !== fp;

  const analyze = async () => {
    if (pieces.length < 5) return flash("Catalogue at least 5 pieces first");
    setBusy(true);
    try {
      const inspoNotes = inspo.length
        ? `\n\nInspo board — the aesthetic they're building toward:\n${inspo.map((i) => "- " + i.vibe).join("\n")}`
        : "";
      const unownedWants = wants.filter((w) => !w.owned);
      const wantsNote = unownedWants.length
        ? `\n\nAlready shortlisted from scanning (do NOT repeat these — they are already on the user's radar):\n${unownedWants.map((w) => `- ${w.item}`).join("\n")}`
        : "";
      const result = await askClaude(
        [
          {
            type: "text",
            text: `You are a wardrobe consultant. Style profile: ${profile}${inspoNotes}${wantsNote}\n\nTheir full closet:\n${closetSummary(
              pieces
            )}\n\nFind the gaps between the closet they have and the aesthetic they're building toward. Be ruthless about priority — name only pieces that would unlock multiple new outfits from what they ALREADY own, not a generic wardrobe checklist. Respond ONLY with JSON, no markdown: {"verdict": "one sentence on how complete this wardrobe already is", "items": [{"item": "specific piece e.g. 'black lug-sole penny loafer'", "why": "one sentence — what it unlocks with pieces they own", "price": "rough price range like '$90-150'", "priority": 1-5 where 1 is buy first}], "stop_buying": "one category they already have enough of"}`,
          },
        ],
        1600
      );
      const items = (result.items || [])
        .sort((a, b) => (a.priority || 9) - (b.priority || 9))
        .map((i) => ({ ...i, owned: false }));
      await saveGaps({ ...result, items, fp, at: Date.now() });
      flash("Gap analysis updated");
    } catch (e) {
      flash("Analysis failed — try again");
    }
    setBusy(false);
  };

  const bought = gaps ? gaps.items.filter((i) => i.owned).length : 0;

  const stableAnalyze = useStableCallback(analyze);
  useEffect(() => {
    setCta({
      label: busy ? "Analysing…" : gaps ? "Re-run analysis" : "Find my gaps",
      onClick: stableAnalyze,
      disabled: busy,
    });
    return () => setCta(null);
  }, [busy, gaps, stableAnalyze, setCta]);

  return (
    <div style={{ paddingBottom: bottomBarHeight }}>
      <div style={{ fontFamily: serif, ...TYPE.title1, marginBottom: SPACE.sm }}>What's missing</div>
      <p style={{ ...TYPE.footnote, color: T.faint, margin: `0 0 ${SPACE.lg}px`, lineHeight: 1.6 }}>
        The distance between the closet you have and the one your inspo board describes — ranked by what unlocks the most
        outfits.
      </p>

      {/* ——— SPOTTED IN THE WILD ——— */}
      {wants.length > 0 && (
        <div style={{ marginBottom: SPACE.xxl }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: SPACE.sm, marginBottom: SPACE.sm }}>
            <div style={labelType(T.tobacco, "0.2em")}>SPOTTED IN THE WILD</div>
            <div style={{ ...TYPE.caption, fontFamily: mono, color: T.faint }}>
              {wants.filter((w) => w.owned).length}/{wants.length} bought
            </div>
          </div>
          <p style={{ ...TYPE.caption, color: T.faint, margin: `0 0 ${SPACE.md}px`, lineHeight: 1.5 }}>
            Everything you scanned and got a cop on. Tap to mark as bought.
          </p>
          {wants.map((w) => (
            <div
              key={w.id}
              onClick={() => toggleWantOwned(w.id)}
              style={{
                position: "relative",
                display: "flex",
                gap: SPACE.md,
                background: T.card,
                border: `1px solid ${w.owned ? T.olive : T.line}`,
                borderRadius: RADIUS.md,
                padding: `${SPACE.sm + 2}px ${SPACE.md}px`,
                marginBottom: SPACE.sm,
                opacity: w.owned ? 0.6 : 1,
                cursor: "pointer",
              }}
            >
              <div style={{ position: "relative", width: 66, height: 66, flexShrink: 0, borderRadius: RADIUS.sm - 2, overflow: "hidden", background: T.cardUp }}>
                {w.image && <img src={w.image} alt={w.item} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                {w.owned && (
                  <div style={{
                    position: "absolute", inset: 0,
                    background: "rgba(122,122,82,0.65)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    ...TYPE.title1, color: "#fff",
                  }}>✓</div>
                )}
              </div>
              <div style={{ flex: 1, overflow: "hidden", paddingRight: 18 }}>
                <div style={{
                  ...TYPE.subhead, color: T.bone, marginBottom: 3, lineHeight: 1.3,
                  textDecoration: w.owned ? "line-through" : "none",
                }}>{w.item}</div>
                <div style={{
                  ...TYPE.caption, color: T.stone, lineHeight: 1.5,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}>{w.reason}</div>
                <div style={{ ...TYPE.caption, fontFamily: mono, color: T.faint, marginTop: 5 }}>
                  {w.score}/10{w.price ? " · " + w.price : ""}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeWant(w.id); }}
                aria-label={"Remove " + w.item}
                style={{
                  position: "absolute", top: 0, right: 0,
                  width: TOUCH.min, height: TOUCH.min,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  border: "none", background: "none",
                  color: T.faint, cursor: "pointer", padding: 0,
                }}
              >
                <span style={{
                  width: 22, height: 22, borderRadius: RADIUS.pill,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "rgba(27,24,21,.7)", fontSize: 13, lineHeight: 1,
                }}>×</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {gaps && (
        <div style={{ animation: "rise .3s ease" }}>
          <p style={{ ...TYPE.subhead, lineHeight: 1.65, color: T.stone, margin: `0 0 ${SPACE.lg + 2}px` }}>{gaps.verdict}</p>

          <div style={{ display: "flex", alignItems: "baseline", gap: SPACE.sm, marginBottom: SPACE.sm }}>
            <div style={labelType(T.tobacco, "0.2em")}>GAPS IN THE ARCHIVE</div>
            <div style={{ ...TYPE.caption, fontFamily: mono, color: T.faint }}>
              {bought}/{gaps.items.length} acquired
            </div>
          </div>

          {gaps.items.map((it, i) => {
            const open = expandedIdx === i;
            return (
              <div
                key={i}
                style={{
                  background: T.card,
                  border: `1px solid ${it.owned ? T.olive : T.line}`,
                  borderRadius: RADIUS.md,
                  marginBottom: SPACE.sm,
                  opacity: it.owned ? 0.6 : 1,
                  overflow: "hidden",
                }}
              >
                {/* collapsed row — always visible */}
                <div
                  onClick={() => setExpandedIdx(open ? null : i)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: SPACE.md,
                    minHeight: TOUCH.min,
                    padding: `0 ${SPACE.md + 2}px`,
                    cursor: "pointer",
                    fontFamily: sans,
                  }}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleGapOwned(i); }}
                    aria-label={it.owned ? "Mark as not acquired" : "Mark as acquired"}
                    style={{
                      width: TOUCH.min,
                      height: TOUCH.min,
                      marginLeft: -SPACE.md,
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "none",
                      background: "none",
                      padding: 0,
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: RADIUS.sm / 2,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: `1px solid ${it.owned ? T.olive : T.faint}`,
                        background: it.owned ? T.olive : "transparent",
                        color: T.bg,
                        fontSize: 13,
                        lineHeight: 1,
                      }}
                    >
                      {it.owned ? "✓" : ""}
                    </span>
                  </button>
                  <div
                    style={{
                      flex: 1,
                      ...TYPE.subhead,
                      color: T.bone,
                      textDecoration: it.owned ? "line-through" : "none",
                      lineHeight: 1.3,
                    }}
                  >
                    {it.item}
                  </div>
                  <div style={{ ...TYPE.subhead, fontFamily: mono, color: T.faint, lineHeight: 1 }}>
                    {open ? "−" : "+"}
                  </div>
                </div>

                {/* expanded content */}
                {open && (
                  <div
                    style={{
                      padding: `0 ${SPACE.md + 2}px ${SPACE.md + 2}px`,
                      paddingLeft: SPACE.md + 2 + TOUCH.min,
                      borderTop: `1px solid ${T.line}`,
                      paddingTop: SPACE.md,
                      animation: "rise .2s ease",
                    }}
                  >
                    <div style={{ ...TYPE.footnote, color: T.stone, lineHeight: 1.55 }}>{it.why}</div>
                    {it.price && (
                      <div style={{ ...labelType(T.tobacco, "0.05em"), textTransform: "none", marginTop: SPACE.sm }}>
                        {it.price}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {gaps.stop_buying && (
            <div
              style={{
                marginTop: SPACE.md,
                padding: `${SPACE.md}px ${SPACE.md + 2}px`,
                border: `1px dashed ${T.bad}`,
                borderRadius: RADIUS.sm,
                ...TYPE.footnote,
                color: T.stone,
                lineHeight: 1.5,
              }}
            >
              <span style={labelType(T.bad, "0.15em")}>ENOUGH OF: </span>
              {gaps.stop_buying}
            </div>
          )}
        </div>
      )}

      {stale && !busy && (
        <div style={{ ...TYPE.caption, fontFamily: mono, color: T.tobacco, margin: `${SPACE.md}px 0 ${SPACE.sm + 2}px`, animation: "rise .3s ease" }}>
          Your closet or inspo changed since this analysis.
        </div>
      )}

      {busy && <Thinking label="Measuring closet against inspo…" />}
    </div>
  );
}

// ———— STYLE PROFILE ————

function Lookbook({ inspo, saveInspo, removeInspo, assessment, pieces, flash, myOutfits, saveMyOutfit, removeMyOutfit, updateMyOutfit, setCta, bottomBarHeight }) {
  const [subTab, setSubTab] = useState("inspo");
  const [selectedInspo, setSelectedInspo] = useState(null);
  const inspoRef = useRef();
  const [inspoBusy, setInspoBusy] = useState(false);
  const [inspoProgress, setInspoProgress] = useState(null);
  const [showAddOutfit, setShowAddOutfit] = useState(false);

  // deselect if the chosen image was removed
  useEffect(() => {
    if (selectedInspo && !inspo.some((i) => i.id === selectedInspo.id)) setSelectedInspo(null);
  }, [inspo, selectedInspo]);

  const handleInspoFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    setInspoBusy(true);
    let added = 0;
    for (let i = 0; i < files.length; i++) {
      setInspoProgress({ done: i, total: files.length });
      try {
        const image = await compressImage(files[i]);
        const tags = await askClaude([
          imgBlock(image),
          {
            type: "text",
            text: `This is a style inspiration image (e.g. a Pinterest save or an outfit photo). Distill its aesthetic. Respond ONLY with JSON, no markdown: {"vibe": "one dense sentence capturing the silhouette, palette, textures, and overall aesthetic direction"}`,
          },
        ]);
        await saveInspo({
          id: "i" + Date.now() + "_" + i,
          added: Date.now() + i,
          image,
          vibe: tags.vibe,
        });
        added++;
      } catch (err) {}
    }
    setInspoProgress(null);
    setInspoBusy(false);
    flash(added ? `Added ${added} inspo image${added === 1 ? "" : "s"}` : "Couldn't read those — try again");
  };

  const TABS = [
    ["inspo", inspo.length ? `Add inspiration  ${inspo.length}` : "Add inspiration"],
    ["myoutfits", "My Style"],
  ];

  // one effect (not one per sub-tab) so switching sub-tabs always clears the previous descriptor before setting the next
  useEffect(() => {
    if (subTab === "inspo") {
      setCta({
        label: inspoBusy ? "Reading the vibe…" : "+ Add inspo images",
        onClick: () => inspoRef.current?.click(),
        disabled: inspoBusy,
      });
    } else {
      setCta({
        label: "+ Add outfit",
        onClick: () => setShowAddOutfit(true),
        disabled: false,
      });
    }
    return () => setCta(null);
  }, [subTab, inspoBusy, setCta]);

  return (
    <div style={{ paddingBottom: bottomBarHeight }}>
      {/* ── Sub-tabs: full-bleed, lighter than the primary bottom nav (no fill, hairline instead of a panel) ── */}
      <div
        style={{
          display: "flex",
          width: "100vw",
          position: "relative",
          left: "50%",
          marginLeft: "-50vw",
          borderBottom: `1px solid ${T.line}`,
          marginBottom: SPACE.xl,
        }}
      >
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setSubTab(id)}
            style={{
              flex: 1,
              minHeight: TOUCH.min,
              marginBottom: -1,
              padding: `0 ${SPACE.xs}px`,
              border: "none",
              borderBottom: subTab === id ? `2px solid ${T.tobacco}` : "2px solid transparent",
              background: "none",
              color: subTab === id ? T.bone : T.faint,
              fontFamily: mono,
              ...TYPE.caption,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              cursor: "pointer",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Add Inspiration ── */}
      {subTab === "inspo" && (
        <div>
          <p style={{ ...TYPE.footnote, color: T.faint, margin: `0 0 ${SPACE.md}px`, lineHeight: 1.6 }}>
            Upload Pinterest saves or fit pics you're drawn to. The AI reads the vibe and steers your generated fits.
          </p>
          <input
            ref={inspoRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={handleInspoFiles}
          />
          {inspoBusy && (
            <Thinking
              label={
                inspoProgress && inspoProgress.total > 1
                  ? `Reading ${inspoProgress.done + 1} of ${inspoProgress.total}…`
                  : "Distilling the aesthetic…"
              }
            />
          )}

          {/* Detail panel — sits below CTA, above grid */}
          {selectedInspo && (
            <div
              style={{
                background: T.card,
                border: `1px solid ${T.line}`,
                borderRadius: RADIUS.md,
                overflow: "hidden",
                marginTop: SPACE.md,
                animation: "rise .3s ease",
              }}
            >
              <img
                src={selectedInspo.image}
                alt={selectedInspo.vibe}
                style={{ width: "100%", maxHeight: 280, objectFit: "cover", display: "block" }}
              />
              <div style={{ padding: `${SPACE.md}px ${SPACE.md}px ${SPACE.md + 2}px` }}>
                <div style={{ ...labelType(T.tobacco, "0.18em"), marginBottom: SPACE.xs + 2 }}>
                  THE VIBE
                </div>
                <p style={{ ...TYPE.footnote, lineHeight: 1.6, color: T.stone, margin: `0 0 ${SPACE.md}px` }}>
                  {selectedInspo.vibe}
                </p>
                <Btn
                  ghost
                  onClick={() => {
                    removeInspo(selectedInspo.id);
                    setSelectedInspo(null);
                  }}
                >
                  Remove from board
                </Btn>
              </div>
            </div>
          )}

          {inspo.length > 0 ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr 1fr",
                gap: TOUCH.gap,
                marginTop: SPACE.md,
              }}
            >
              {inspo.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedInspo(selectedInspo?.id === item.id ? null : item)}
                  aria-label={item.vibe}
                  style={{
                    padding: 0,
                    border: `2px solid ${selectedInspo?.id === item.id ? T.tobacco : "transparent"}`,
                    borderRadius: RADIUS.sm - 2,
                    overflow: "hidden",
                    cursor: "pointer",
                    background: "none",
                    display: "block",
                    animation: "rise .3s ease",
                  }}
                >
                  <img
                    src={item.image}
                    alt=""
                    style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", display: "block" }}
                  />
                </button>
              ))}
            </div>
          ) : !inspoBusy ? (
            <div style={{ padding: `${SPACE.xxxxl}px ${SPACE.md}px`, textAlign: "center" }}>
              <div style={{ fontFamily: serif, ...TYPE.title2, color: T.stone }}>Board is empty.</div>
              <div style={{ ...TYPE.footnote, color: T.faint, marginTop: SPACE.sm, lineHeight: 1.6 }}>
                Add Pinterest saves, editorial shots, or fit pics that represent the aesthetic you're building.
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* ── My Style ── */}
      {subTab === "myoutfits" && (
        <MyOutfitsSection
          outfits={myOutfits}
          pieces={pieces}
          saveMyOutfit={saveMyOutfit}
          removeMyOutfit={removeMyOutfit}
          updateMyOutfit={updateMyOutfit}
          saveInspo={saveInspo}
          flash={flash}
          assessment={assessment}
          showAdd={showAddOutfit}
          setShowAdd={setShowAddOutfit}
        />
      )}
    </div>
  );
}

// ———— MY OUTFITS ————

function useImageSrc(imageId) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (!imageId) return;
    loadImage(imageId).then(setSrc).catch(() => {});
  }, [imageId]);
  return src;
}

function OutfitCard({ outfit, onClick }) {
  const src = useImageSrc(outfit.imageIds?.[0]);
  const date = outfit.dateWorn
    ? new Date(outfit.dateWorn + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "";
  return (
    <button
      onClick={onClick}
      style={{
        padding: 0, border: `1px solid ${T.line}`, borderRadius: RADIUS.card,
        overflow: "hidden", background: T.card, cursor: "pointer",
        display: "block", textAlign: "left", width: "100%",
        animation: "rise .3s ease",
      }}
    >
      <div style={{ aspectRatio: "3/4", background: T.cardUp, position: "relative" }}>
        {src && (
          <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        )}
        {outfit.imageIds?.length > 1 && (
          <div style={{
            position: "absolute", top: 5, right: 5,
            background: "rgba(27,24,21,.75)", backdropFilter: "blur(4px)",
            borderRadius: RADIUS.pill, padding: "2px 6px",
            fontFamily: mono, ...TYPE.caption, color: T.stone,
          }}>+{outfit.imageIds.length - 1}</div>
        )}
        {outfit.inInspo && (
          <div style={{
            position: "absolute", top: 5, left: 5,
            background: "rgba(176,141,87,.85)", borderRadius: RADIUS.pill,
            padding: "2px 6px", fontFamily: mono, ...TYPE.caption,
            color: T.bg, letterSpacing: "0.08em",
          }}>INSPO</div>
        )}
      </div>
      <div style={{ padding: `${SPACE.xs + 3}px ${SPACE.sm}px ${SPACE.xs + 5}px` }}>
        <div style={{ ...TYPE.caption, fontFamily: mono, color: T.tobacco }}>{date}</div>
        {outfit.occasion && (
          <div style={{
            ...TYPE.caption, color: T.stone, marginTop: 2, lineHeight: 1.3,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{outfit.occasion}</div>
        )}
      </div>
    </button>
  );
}

function PiecePicker({ pieces, selectedIds, onToggle, label }) {
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");

  const cats = categoryCounts(pieces);
  const selectedSet = new Set(selectedIds);
  const selectedPieces = pieces.filter((p) => selectedSet.has(p.id));
  const q = search.trim().toLowerCase();
  const unselected = pieces.filter((p) => {
    if (selectedSet.has(p.id)) return false;
    if (category !== "all" && p.category !== category) return false;
    if (q && !p.name.toLowerCase().includes(q)) return false;
    return true;
  });

  // reset the filter so the next pick starts from a clean list
  const handleToggle = (id) => {
    const wasSelected = selectedSet.has(id);
    onToggle(id);
    if (!wasSelected) {
      setCategory("all");
      setSearch("");
    }
  };

  return (
    <div style={{ marginBottom: SPACE.md }}>
      {label && (
        <div style={{ ...labelType(T.faint), marginBottom: SPACE.xs }}>
          {label}
        </div>
      )}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search pieces…"
        style={{
          width: "100%", padding: `${SPACE.sm}px ${SPACE.md - 2}px`, borderRadius: RADIUS.sm,
          border: `1px solid ${T.line}`, background: T.cardUp,
          color: T.bone, ...TYPE.callout, fontFamily: sans, marginBottom: SPACE.sm,
        }}
      />
      <div style={{ display: "flex", gap: TOUCH.gap, overflowX: "auto", paddingBottom: SPACE.xs, marginBottom: SPACE.sm }}>
        <button onClick={() => setCategory("all")} style={chipHitStyle}>
          <span style={chipVisualStyle(category === "all")}>All {pieces.length}</span>
        </button>
        {cats.map((c) => (
          <button key={c.id} onClick={() => setCategory(c.id)} style={chipHitStyle}>
            <span style={chipVisualStyle(category === c.id)}>{c.id} {c.count}</span>
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: TOUCH.gap }}>
        {selectedPieces.length > 0 && (
          <>
            <div style={{ width: "100%", ...labelType(T.tobacco) }}>
              SELECTED
            </div>
            {selectedPieces.map((p) => (
              <button key={p.id} onClick={() => handleToggle(p.id)} style={chipHitStyle}>
                <span style={toggleVisualStyle(true)}>{p.name}</span>
              </button>
            ))}
            {unselected.length > 0 && <div style={{ width: "100%", height: 1, background: T.line, margin: `${SPACE.xs / 2}px 0` }} />}
          </>
        )}
        {unselected.length > 0 ? (
          unselected.map((p) => (
            <button key={p.id} onClick={() => handleToggle(p.id)} style={chipHitStyle}>
              <span style={toggleVisualStyle(false)}>{p.name}</span>
            </button>
          ))
        ) : selectedPieces.length === 0 ? (
          <div style={{ ...TYPE.footnote, fontFamily: mono, color: T.faint, padding: `${SPACE.sm}px 0` }}>No pieces match.</div>
        ) : null}
      </div>
    </div>
  );
}

function DateRangeChip({ from, to, onApply }) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  useEffect(() => { setDraftFrom(from); setDraftTo(to); }, [from, to, open]);

  const active = !!(from || to);
  const label = !from && !to
    ? "All dates"
    : from && to
    ? `${fmtShortDate(from)} – ${fmtShortDate(to)}`
    : from
    ? `Since ${fmtShortDate(from)}`
    : `Until ${fmtShortDate(to)}`;

  const presets = [
    { label: "Last 30 days", range: () => [isoDaysAgo(30), todayIso()] },
    { label: "Last 3 months", range: () => [isoMonthsAgo(3), todayIso()] },
    { label: "This year", range: () => [`${new Date().getFullYear()}-01-01`, todayIso()] },
    { label: "All time", range: () => ["", ""] },
  ];

  const applyPreset = (preset) => {
    const [f, t] = preset.range();
    onApply(f, t);
    setOpen(false);
  };

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button onClick={() => setOpen((o) => !o)} style={chipHitStyle}>
        <span style={chipVisualStyle(active)}>{label}</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 90 }} />
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 91,
            width: 220, background: T.cardUp, border: `1px solid ${T.line}`,
            borderRadius: RADIUS.md, padding: SPACE.md, boxShadow: "0 12px 28px rgba(0,0,0,.45)",
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: SPACE.xs, marginBottom: SPACE.sm }}>
              {presets.map((p) => (
                <button key={p.label} onClick={() => applyPreset(p)} style={{
                  textAlign: "left", minHeight: TOUCH.min, padding: `0 ${SPACE.sm}px`, borderRadius: RADIUS.sm,
                  border: "none", background: "none", color: T.stone,
                  fontFamily: mono, ...TYPE.footnote, cursor: "pointer",
                }}>{p.label}</button>
              ))}
            </div>
            <div style={{ height: 1, background: T.line, margin: `${SPACE.xs}px 0 ${SPACE.sm}px` }} />
            <div style={{ ...labelType(T.faint, "0.12em"), marginBottom: SPACE.xs }}>FROM</div>
            <input type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} style={{
              width: "100%", minHeight: TOUCH.min, padding: `0 ${SPACE.sm}px`, borderRadius: RADIUS.sm, border: `1px solid ${T.line}`,
              background: T.card, color: T.bone, ...TYPE.callout, fontFamily: sans, marginBottom: SPACE.sm, colorScheme: "dark",
            }} />
            <div style={{ ...labelType(T.faint, "0.12em"), marginBottom: SPACE.xs }}>TO</div>
            <input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} style={{
              width: "100%", minHeight: TOUCH.min, padding: `0 ${SPACE.sm}px`, borderRadius: RADIUS.sm, border: `1px solid ${T.line}`,
              background: T.card, color: T.bone, ...TYPE.callout, fontFamily: sans, marginBottom: SPACE.sm, colorScheme: "dark",
            }} />
            <div style={{ display: "flex", gap: TOUCH.gap }}>
              <button onClick={() => { onApply("", ""); setOpen(false); }} style={{
                flex: 1, minHeight: TOUCH.min, borderRadius: RADIUS.sm, border: `1px solid ${T.line}`,
                background: "none", color: T.faint, fontFamily: mono, ...TYPE.caption,
                letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer",
              }}>Clear</button>
              <button onClick={() => { onApply(draftFrom, draftTo); setOpen(false); }} style={{
                flex: 1, minHeight: TOUCH.min, borderRadius: RADIUS.sm, border: "none",
                background: T.tobacco, color: T.bg, fontFamily: mono, ...TYPE.caption,
                letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer",
              }}>Apply</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function OutfitAddFlow({ pieces, profiles, onSave, onClose, flash }) {
  const cameraRef = useRef();
  const libRef = useRef();
  const [view, setView] = useState("pick");
  const [staged, setStaged] = useState([]);
  const [dateWorn, setDateWorn] = useState(() => new Date().toISOString().slice(0, 10));
  const [pieceIds, setPieceIds] = useState([]);
  const [profileTag, setProfileTag] = useState(null);
  const [occasion, setOccasion] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const addFiles = async (files) => {
    const slots = 3 - staged.length;
    if (slots <= 0) return;
    const batch = Array.from(files).slice(0, slots);
    const compressed = [];
    for (let i = 0; i < batch.length; i++) {
      try {
        const dataUrl = await compressImage(batch[i]);
        compressed.push({ id: "img_" + Date.now() + "_" + i, dataUrl });
      } catch (e) {}
    }
    if (compressed.length) {
      setStaged((prev) => [...prev, ...compressed]);
      setView("review");
    }
  };

  const removeStaged = (id) => setStaged((prev) => prev.filter((s) => s.id !== id));

  const handleSave = async () => {
    if (!staged.length) return;
    setSaving(true);
    const savedIds = [];
    for (const img of staged) {
      try {
        await saveImage(img.id, img.dataUrl);
        savedIds.push(img.id);
      } catch (e) {
        if (e.name === "QuotaExceededError" || String(e.message).toLowerCase().includes("quota")) {
          flash("Photo storage full — delete older outfit photos to free up space");
          break;
        }
      }
    }
    if (!savedIds.length) {
      flash("Couldn't save photos — storage may be full");
      setSaving(false);
      return;
    }
    const outfit = {
      id: "o" + Date.now(),
      sourceType: "self-photo",
      imageIds: savedIds,
      dateWorn,
      pieceIds,
      profileTag,
      occasion: occasion.trim(),
      note: note.trim(),
      inInspo: false,
      added: Date.now(),
    };
    await onSave(outfit);
    setSaving(false);
    onClose();
  };

  const togglePiece = (id) =>
    setPieceIds((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]);

  const fieldLabel = (txt) => (
    <div style={{ ...labelType(T.faint), marginBottom: SPACE.xs }}>{txt}</div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200 }} />
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, maxHeight: "90vh",
        background: T.card, borderRadius: `${RADIUS.sheet}px ${RADIUS.sheet}px 0 0`, zIndex: 201,
        display: "flex", flexDirection: "column",
        animation: "slideUp .28s ease", border: `1px solid ${T.line}`, borderBottom: "none",
      }}>
        <div onClick={onClose} style={{ display: "flex", justifyContent: "center", padding: `${SPACE.md}px 0 ${SPACE.sm}px`, cursor: "pointer", flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: T.line }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: `0 ${LAYOUT.screenMargin}px ${SPACE.md}px`, flexShrink: 0, borderBottom: `1px solid ${T.line}` }}>
          <div style={{ fontFamily: serif, ...TYPE.title3 }}>{view === "pick" ? "Add outfit" : "Review"}</div>
          <button
            onClick={view === "pick" ? onClose : () => setView("pick")}
            style={{ minWidth: TOUCH.min, minHeight: TOUCH.min, border: "none", background: "none", color: T.faint, ...TYPE.title3, cursor: "pointer", lineHeight: 1 }}
          >{view === "pick" ? "×" : "←"}</button>
        </div>
        <div style={{ overflowY: "auto", flex: 1, padding: `${SPACE.md}px ${LAYOUT.screenMargin}px ${SPACE.xxxxl}px` }}>
          {view === "pick" && (
            <div style={{ display: "flex", flexDirection: "column", gap: SPACE.sm, paddingTop: SPACE.xs }}>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple style={{ display: "none" }}
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              <input ref={libRef} type="file" accept="image/*" multiple style={{ display: "none" }}
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              <Btn onClick={() => cameraRef.current.click()}>Take photo</Btn>
              <Btn ghost onClick={() => libRef.current.click()}>Choose from library</Btn>
              <div style={{ ...TYPE.caption, fontFamily: mono, color: T.faint, textAlign: "center", marginTop: SPACE.xs }}>
                Up to 3 photos per outfit
              </div>
            </div>
          )}
          {view === "review" && (
            <div>
              <div style={{ display: "flex", gap: TOUCH.gap, marginBottom: SPACE.md, overflowX: "auto", paddingBottom: SPACE.xs }}>
                {staged.map((img) => (
                  <div key={img.id} style={{
                    position: "relative", flexShrink: 0, width: 100, height: 133,
                    borderRadius: RADIUS.sm, overflow: "hidden", border: `1px solid ${T.line}`,
                  }}>
                    <img src={img.dataUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <button
                      onClick={() => removeStaged(img.id)}
                      aria-label="Remove photo"
                      style={{
                        position: "absolute", top: 0, right: 0, width: TOUCH.min, height: TOUCH.min,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        border: "none", background: "none", padding: 0, cursor: "pointer",
                      }}
                    >
                      <span style={{
                        width: 22, height: 22, borderRadius: RADIUS.pill,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: "rgba(27,24,21,.8)", color: T.stone, fontSize: 13, lineHeight: 1,
                      }}>×</span>
                    </button>
                  </div>
                ))}
                {staged.length < 3 && (
                  <button onClick={() => libRef.current.click()} style={{
                    flexShrink: 0, width: 100, height: 133, borderRadius: RADIUS.sm,
                    border: `1px dashed ${T.line}`, background: "none", color: T.faint,
                    fontSize: 24, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>+</button>
                )}
              </div>

              {fieldLabel("DATE WORN")}
              <input
                type="date"
                value={dateWorn}
                onChange={(e) => setDateWorn(e.target.value)}
                style={{
                  width: "100%", minHeight: TOUCH.min, padding: `0 ${SPACE.md + 2}px`, borderRadius: RADIUS.sm,
                  border: `1px solid ${T.line}`, background: T.cardUp,
                  color: T.bone, ...TYPE.subhead, fontFamily: sans,
                  marginBottom: SPACE.md, colorScheme: "dark",
                }}
              />

              {pieces.length > 0 && (
                <PiecePicker pieces={pieces} selectedIds={pieceIds} onToggle={togglePiece} label="PIECES WORN — tap to link" />
              )}

              {profiles.length > 0 && (
                <>
                  {fieldLabel("STYLE PROFILE (optional)")}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: TOUCH.gap, marginBottom: SPACE.md }}>
                    {profiles.map((p) => (
                      <button key={p.rank} onClick={() => setProfileTag((prev) => prev === p.rank ? null : p.rank)} style={chipHitStyle}>
                        <span style={chipVisualStyle(profileTag === p.rank)}>{p.headline}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {fieldLabel("OCCASION (optional)")}
              <input
                value={occasion}
                onChange={(e) => setOccasion(e.target.value)}
                placeholder="e.g. dinner out, work, weekend"
                style={{
                  width: "100%", minHeight: TOUCH.min, padding: `0 ${SPACE.md + 2}px`, borderRadius: RADIUS.sm,
                  border: `1px solid ${T.line}`, background: T.cardUp,
                  color: T.bone, ...TYPE.subhead, fontFamily: sans, marginBottom: SPACE.md,
                }}
              />

              {fieldLabel("NOTE (optional)")}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="How it felt, what you'd change…"
                rows={3}
                style={{
                  width: "100%", padding: `${SPACE.md - 2}px ${SPACE.md + 2}px`, borderRadius: RADIUS.sm,
                  border: `1px solid ${T.line}`, background: T.cardUp, color: T.bone,
                  ...TYPE.subhead, fontFamily: sans, resize: "vertical",
                  marginBottom: SPACE.md + 4, lineHeight: 1.5,
                }}
              />

              {pieceIds.length > 0 && (
                <div style={{ ...TYPE.caption, fontFamily: mono, color: T.faint, marginBottom: SPACE.sm }}>
                  {pieceIds.length} piece{pieceIds.length === 1 ? "" : "s"} selected
                </div>
              )}
              <Btn onClick={handleSave} disabled={saving || !staged.length}>
                {saving ? "Saving…" : "Save outfit"}
              </Btn>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function OutfitDetail({ outfit, pieces, profiles, onClose, onDelete, onUpdate, onAddToInspo }) {
  const [view, setView] = useState("detail");
  const [images, setImages] = useState([]);
  const [editDate, setEditDate] = useState(outfit.dateWorn || "");
  const [editPieceIds, setEditPieceIds] = useState(outfit.pieceIds || []);
  const [editProfileTag, setEditProfileTag] = useState(outfit.profileTag || null);
  const [editOccasion, setEditOccasion] = useState(outfit.occasion || "");
  const [editNote, setEditNote] = useState(outfit.note || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all((outfit.imageIds || []).map((id) => loadImage(id)))
      .then((imgs) => setImages(imgs.filter(Boolean)));
  }, [outfit.id]);

  const linkedPieces = pieces.filter((p) => outfit.pieceIds?.includes(p.id));
  const taggedProfile = (profiles || []).find((p) => p.rank === outfit.profileTag);

  const handleSave = async () => {
    setSaving(true);
    await onUpdate({
      ...outfit,
      dateWorn: editDate,
      pieceIds: editPieceIds,
      profileTag: editProfileTag,
      occasion: editOccasion.trim(),
      note: editNote.trim(),
    });
    setSaving(false);
    onClose();
  };

  const toggleEditPiece = (id) =>
    setEditPieceIds((prev) => prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]);

  const date = outfit.dateWorn
    ? new Date(outfit.dateWorn + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "";

  const fieldLabel = (txt) => (
    <div style={{ ...labelType(T.faint), marginBottom: SPACE.xs }}>{txt}</div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200 }} />
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, maxHeight: "90vh",
        background: T.card, borderRadius: `${RADIUS.sheet}px ${RADIUS.sheet}px 0 0`, zIndex: 201,
        display: "flex", flexDirection: "column",
        animation: "slideUp .28s ease", border: `1px solid ${T.line}`, borderBottom: "none",
      }}>
        <div onClick={onClose} style={{ display: "flex", justifyContent: "center", padding: `${SPACE.md}px 0 ${SPACE.sm}px`, cursor: "pointer", flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: T.line }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: `0 ${LAYOUT.screenMargin}px ${SPACE.md}px`, flexShrink: 0, borderBottom: `1px solid ${T.line}` }}>
          <div style={{ fontFamily: serif, ...TYPE.title3 }}>
            {view === "detail" ? date : view === "edit" ? "Edit outfit" : "Delete outfit?"}
          </div>
          <button
            onClick={view === "detail" ? onClose : () => setView("detail")}
            style={{ minWidth: TOUCH.min, minHeight: TOUCH.min, border: "none", background: "none", color: T.faint, ...TYPE.title3, cursor: "pointer", lineHeight: 1 }}
          >{view === "detail" ? "×" : "←"}</button>
        </div>
        <div style={{ overflowY: "auto", flex: 1, padding: `0 ${LAYOUT.screenMargin}px ${SPACE.xxxxl}px` }}>

          {view === "detail" && (
            <div>
              {images.length > 0 && (
                <div style={{ display: "flex", gap: TOUCH.gap, marginTop: SPACE.md, overflowX: "auto", paddingBottom: SPACE.xs }}>
                  {images.map((src, i) => (
                    <img key={i} src={src} alt="" style={{
                      flexShrink: 0,
                      width: images.length === 1 ? "100%" : 180,
                      height: images.length === 1 ? "auto" : 240,
                      maxHeight: 340,
                      objectFit: "cover", borderRadius: RADIUS.sm, border: `1px solid ${T.line}`,
                    }} />
                  ))}
                </div>
              )}
              {outfit.occasion && (
                <div style={{ ...TYPE.subhead, color: T.bone, marginTop: SPACE.md, lineHeight: 1.4 }}>{outfit.occasion}</div>
              )}
              {outfit.note && (
                <p style={{ ...TYPE.footnote, color: T.stone, lineHeight: 1.6, marginTop: SPACE.sm, marginBottom: 0 }}>{outfit.note}</p>
              )}
              {linkedPieces.length > 0 && (
                <div style={{ marginTop: SPACE.md }}>
                  <div style={{ ...labelType(T.faint, "0.18em"), marginBottom: SPACE.sm }}>PIECES</div>
                  <div style={{ display: "flex", gap: TOUCH.gap, flexWrap: "wrap" }}>
                    {linkedPieces.map((p) => (
                      <span key={p.id} style={{
                        padding: "4px 10px", borderRadius: RADIUS.pill, fontFamily: mono, ...TYPE.caption,
                        border: `1px solid ${T.line}`, color: T.stone,
                      }}>{p.name}</span>
                    ))}
                  </div>
                </div>
              )}
              {taggedProfile && (
                <div style={{ marginTop: SPACE.md }}>
                  <div style={{ ...labelType(T.faint, "0.18em"), marginBottom: SPACE.sm }}>STYLE PROFILE</div>
                  <span style={{
                    padding: "4px 10px", borderRadius: RADIUS.pill, fontFamily: mono, ...TYPE.caption,
                    border: `1px solid ${T.tobacco}`, color: T.tobacco,
                  }}>{taggedProfile.headline}</span>
                </div>
              )}
              <div style={{ marginTop: SPACE.lg, display: "flex", flexDirection: "column", gap: SPACE.sm }}>
                {!outfit.inInspo ? (
                  <Btn ghost onClick={() => onAddToInspo(outfit)}>Add to inspo board</Btn>
                ) : (
                  <div style={{ ...TYPE.caption, fontFamily: mono, color: T.tobacco, textAlign: "center", padding: `${SPACE.sm}px 0` }}>
                    ✓ On your inspo board
                  </div>
                )}
                <Btn ghost onClick={() => setView("edit")}>Edit</Btn>
                <button onClick={() => setView("confirm")} style={{
                  width: "100%", minHeight: TOUCH.min, padding: `0 ${LAYOUT.screenMargin}px`, borderRadius: RADIUS.sm,
                  border: `1px solid ${T.line}`, background: "none",
                  color: T.bad, fontFamily: mono, ...TYPE.caption,
                  letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer",
                }}>Delete</button>
              </div>
            </div>
          )}

          {view === "edit" && (
            <div style={{ paddingTop: SPACE.md }}>
              {fieldLabel("DATE WORN")}
              <input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                style={{
                  width: "100%", minHeight: TOUCH.min, padding: `0 ${SPACE.md + 2}px`, borderRadius: RADIUS.sm,
                  border: `1px solid ${T.line}`, background: T.cardUp,
                  color: T.bone, ...TYPE.subhead, fontFamily: sans,
                  marginBottom: SPACE.md, colorScheme: "dark",
                }}
              />
              {pieces.length > 0 && (
                <PiecePicker pieces={pieces} selectedIds={editPieceIds} onToggle={toggleEditPiece} label="PIECES WORN" />
              )}
              {(profiles || []).length > 0 && (
                <>
                  {fieldLabel("STYLE PROFILE")}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: TOUCH.gap, marginBottom: SPACE.md }}>
                    {profiles.map((p) => (
                      <button key={p.rank} onClick={() => setEditProfileTag((prev) => prev === p.rank ? null : p.rank)} style={chipHitStyle}>
                        <span style={chipVisualStyle(editProfileTag === p.rank)}>{p.headline}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {fieldLabel("OCCASION")}
              <input
                value={editOccasion}
                onChange={(e) => setEditOccasion(e.target.value)}
                placeholder="optional"
                style={{
                  width: "100%", minHeight: TOUCH.min, padding: `0 ${SPACE.md + 2}px`, borderRadius: RADIUS.sm,
                  border: `1px solid ${T.line}`, background: T.cardUp,
                  color: T.bone, ...TYPE.subhead, fontFamily: sans, marginBottom: SPACE.md,
                }}
              />
              {fieldLabel("NOTE")}
              <textarea
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder="optional"
                rows={3}
                style={{
                  width: "100%", padding: `${SPACE.md - 2}px ${SPACE.md + 2}px`, borderRadius: RADIUS.sm,
                  border: `1px solid ${T.line}`, background: T.cardUp, color: T.bone,
                  ...TYPE.subhead, fontFamily: sans, resize: "vertical",
                  marginBottom: SPACE.md + 4, lineHeight: 1.5,
                }}
              />
              {editPieceIds.length > 0 && (
                <div style={{ ...TYPE.caption, fontFamily: mono, color: T.faint, marginBottom: SPACE.sm }}>
                  {editPieceIds.length} piece{editPieceIds.length === 1 ? "" : "s"} selected
                </div>
              )}
              <Btn onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Btn>
            </div>
          )}

          {view === "confirm" && (
            <div style={{ paddingTop: SPACE.xl, textAlign: "center" }}>
              <div style={{ fontFamily: serif, ...TYPE.title2, marginBottom: SPACE.sm }}>Delete this outfit?</div>
              <p style={{ ...TYPE.subhead, color: T.stone, lineHeight: 1.6, margin: `0 0 ${SPACE.xl}px` }}>
                This permanently removes the outfit and its photos. Can't be undone.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: SPACE.sm }}>
                <button
                  onClick={async () => { await onDelete(outfit.id); onClose(); }}
                  style={{
                    width: "100%", minHeight: TOUCH.min, padding: `0 ${LAYOUT.screenMargin}px`, borderRadius: RADIUS.sm,
                    border: "none", background: T.bad, color: T.bone,
                    fontFamily: mono, ...TYPE.caption, letterSpacing: "0.12em",
                    textTransform: "uppercase", cursor: "pointer",
                  }}
                >Yes, delete it</button>
                <Btn ghost onClick={() => setView("detail")}>Keep it</Btn>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function MyOutfitsSection({ outfits, pieces, saveMyOutfit, removeMyOutfit, updateMyOutfit, saveInspo, flash, assessment, showAdd, setShowAdd }) {
  const [detail, setDetail] = useState(null);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterPieceId, setFilterPieceId] = useState(null);
  const [filterProfileTag, setFilterProfileTag] = useState(null);

  const profiles = assessment?.profiles || [];

  const filtered = outfits.filter((o) => {
    if (filterProfileTag && o.profileTag !== filterProfileTag) return false;
    if (filterFrom && o.dateWorn < filterFrom) return false;
    if (filterTo && o.dateWorn > filterTo) return false;
    if (filterPieceId && !o.pieceIds?.includes(filterPieceId)) return false;
    return true;
  });

  // only show pieces that appear in at least one outfit
  const usedPieces = pieces.filter((p) => outfits.some((o) => o.pieceIds?.includes(p.id)));
  const usedCats = categoryCounts(usedPieces);
  const visiblePieces = usedPieces.filter((p) => filterCategory === "all" || p.category === filterCategory);
  // the selected piece chip may not be visible after switching categories
  const setCategoryFilter = (c) => { setFilterCategory(c); setFilterPieceId(null); };

  const handleAddToInspo = async (outfit) => {
    try {
      const imgData = outfit.imageIds?.[0] ? await loadImage(outfit.imageIds[0]) : null;
      const inspoItem = {
        id: "i" + Date.now(),
        added: Date.now(),
        image: imgData || "",
        vibe: outfit.occasion || `My outfit · ${outfit.dateWorn}`,
        sourceType: "my-outfit",
        sourceId: outfit.id,
      };
      await saveInspo(inspoItem);
      await updateMyOutfit({ ...outfit, inInspo: true });
      flash("Added to inspo board");
      setDetail((d) => (d?.id === outfit.id ? { ...d, inInspo: true } : d));
    } catch (e) {
      flash("Couldn't add to inspo — try again");
    }
  };

  return (
    <div>
      <p style={{ ...TYPE.footnote, color: T.faint, margin: `0 0 ${SPACE.md}px`, lineHeight: 1.6 }}>
        A photographic record of what you've actually worn.
      </p>

      {profiles.length > 0 && (
        <div style={{ display: "flex", gap: TOUCH.gap, overflowX: "auto", paddingBottom: SPACE.xs, marginBottom: SPACE.sm }}>
          <button onClick={() => setFilterProfileTag(null)} style={chipHitStyle}>
            <span style={chipVisualStyle(filterProfileTag === null)}>All</span>
          </button>
          {profiles.map((p) => (
            <button key={p.rank} onClick={() => setFilterProfileTag(p.rank)} style={chipHitStyle}>
              <span style={chipVisualStyle(filterProfileTag === p.rank)}>{p.headline}</span>
            </button>
          ))}
        </div>
      )}

      {outfits.length > 0 && (
        <div style={{ marginBottom: SPACE.md }}>
          {usedCats.length > 0 && (
            <div style={{ display: "flex", gap: TOUCH.gap, overflowX: "auto", paddingBottom: SPACE.xs, marginBottom: SPACE.sm }}>
              <button onClick={() => setCategoryFilter("all")} style={chipHitStyle}>
                <span style={chipVisualStyle(filterCategory === "all")}>All {usedPieces.length}</span>
              </button>
              {usedCats.map((c) => (
                <button key={c.id} onClick={() => setCategoryFilter(c.id)} style={chipHitStyle}>
                  <span style={chipVisualStyle(filterCategory === c.id)}>{c.id} {c.count}</span>
                </button>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: TOUCH.gap, overflowX: "auto", paddingBottom: SPACE.xs }}>
            <DateRangeChip from={filterFrom} to={filterTo} onApply={(f, t) => { setFilterFrom(f); setFilterTo(t); }} />
            <button onClick={() => setFilterPieceId(null)} style={chipHitStyle}>
              <span style={chipVisualStyle(filterPieceId === null)}>All</span>
            </button>
            {visiblePieces.map((p) => (
              <button key={p.id} onClick={() => setFilterPieceId((prev) => prev === p.id ? null : p.id)} style={chipHitStyle}>
                <span style={chipVisualStyle(filterPieceId === p.id)}>{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {filtered.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: SPACE.sm }}>
          {filtered.map((o) => (
            <OutfitCard key={o.id} outfit={o} onClick={() => setDetail(o)} />
          ))}
        </div>
      ) : outfits.length > 0 ? (
        <div style={{ padding: `${SPACE.xl}px 0`, textAlign: "center", fontFamily: mono, ...TYPE.caption, color: T.faint }}>
          No outfits match those filters.
        </div>
      ) : (
        <div style={{ padding: `${SPACE.xl}px ${SPACE.md}px`, textAlign: "center" }}>
          <div style={{ fontFamily: serif, ...TYPE.title3, color: T.stone }}>Nothing logged yet.</div>
          <div style={{ ...TYPE.footnote, color: T.faint, marginTop: SPACE.sm, lineHeight: 1.6 }}>
            Add your first outfit to get started.
          </div>
        </div>
      )}

      {showAdd && (
        <OutfitAddFlow pieces={pieces} profiles={profiles} onSave={saveMyOutfit} onClose={() => setShowAdd(false)} flash={flash} />
      )}
      {detail && (
        <OutfitDetail
          outfit={detail}
          pieces={pieces}
          profiles={profiles}
          onClose={() => setDetail(null)}
          onDelete={removeMyOutfit}
          onUpdate={updateMyOutfit}
          onAddToInspo={handleAddToInspo}
          flash={flash}
        />
      )}
    </div>
  );
}
