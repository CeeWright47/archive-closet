import { useState, useEffect, useRef } from "react";
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

const pillStyle = (active) => ({
  padding: "4px 10px", borderRadius: 20, whiteSpace: "nowrap",
  border: `1px solid ${active ? T.tobacco : T.line}`,
  background: active ? T.tobacco : "transparent",
  color: active ? T.bg : T.stone,
  fontFamily: mono, fontSize: 9, letterSpacing: "0.08em",
  textTransform: "uppercase", cursor: "pointer",
});

const toggleStyle = (active) => ({
  padding: "5px 10px", borderRadius: 20, fontSize: 11, fontFamily: mono,
  border: `1px solid ${active ? T.tobacco : T.line}`,
  background: active ? T.tobacco : "transparent",
  color: active ? T.bg : T.stone, cursor: "pointer",
});

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
        paddingBottom: 96,
      }}
    >
      <style>{fontCss}</style>

      {/* masthead */}
      <header style={{ padding: "28px 20px 18px", borderBottom: `1px solid ${T.line}` }}>
        <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.22em", color: T.tobacco }}>
          PERSONAL WARDROBE INDEX
        </div>
        <h1 style={{ fontFamily: serif, fontSize: 44, fontWeight: 400, margin: "6px 0 0", letterSpacing: "-0.01em" }}>
          Archive<span style={{ color: T.tobacco }}>.</span>
        </h1>
        <div style={{ fontFamily: mono, fontSize: 11, color: T.faint, marginTop: 6 }}>
          {pieces.length} pieces catalogued
        </div>
      </header>

      <main style={{ maxWidth: 560, margin: "0 auto", padding: "20px 16px" }}>
        {!loaded ? (
          <div style={{ fontFamily: mono, fontSize: 12, color: T.stone, animation: "pulse 1.4s infinite", padding: 24 }}>
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
          />
        ) : tab === "scan" ? (
          <Scan pieces={pieces} profile={profile} flash={flash} saveWant={saveWant} />
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
          />
        ) : (
          <Profile
            profile={profile}
            saveProfile={saveProfile}
            inspo={inspo}
            saveInspo={saveInspo}
            removeInspo={removeInspo}
            assessment={assessment}
            saveAssessment={saveAssessment}
            pieces={pieces}
            flash={flash}
            myOutfits={myOutfits}
            saveMyOutfit={saveMyOutfit}
            removeMyOutfit={removeMyOutfit}
            updateMyOutfit={updateMyOutfit}
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
            fontSize: 12,
            padding: "10px 16px",
            borderRadius: 6,
            zIndex: 60,
            animation: "rise .25s ease",
          }}
        >
          {toast}
        </div>
      )}

      {/* bottom tabs */}
      <nav
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: T.card,
          borderTop: `1px solid ${T.line}`,
          display: "flex",
          zIndex: 50,
        }}
      >
        {[
          ["closet", "Closet"],
          ["fits", "Fits"],
          ["scan", "Scan"],
          ["gaps", "Gaps"],
          ["style", "Style"],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              flex: 1,
              padding: "16px 0 20px",
              background: "none",
              border: "none",
              borderTop: tab === id ? `2px solid ${T.tobacco}` : "2px solid transparent",
              color: tab === id ? T.bone : T.faint,
              fontFamily: mono,
              fontSize: 10,
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

// ———— shared bits ————

function GarmentTag({ piece, onMenu, dim }) {
  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.line}`,
        borderRadius: 8,
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
              fontSize: 28,
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
              position: "absolute",
              top: 6,
              right: 6,
              width: 28,
              height: 28,
              borderRadius: 14,
              border: "none",
              background: "rgba(27,24,21,.75)",
              backdropFilter: "blur(6px)",
              color: T.stone,
              fontSize: 16,
              cursor: "pointer",
              lineHeight: 1,
              letterSpacing: "0.05em",
            }}
          >
            ⋯
          </button>
        )}
      </div>
      <div style={{ padding: "10px 10px 12px" }}>
        <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.18em", color: T.tobacco, textTransform: "uppercase" }}>
          {piece.category}
        </div>
        <div style={{ fontSize: 13, marginTop: 3, lineHeight: 1.3 }}>{piece.name}</div>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, marginTop: 3 }}>
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
    <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.14em", color: T.faint, marginBottom: 6 }}>{label}</div>
  );
  const fieldInput = (value, onChange) => (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%", padding: "12px 14px", borderRadius: 8,
        border: `1px solid ${T.line}`, background: T.cardUp,
        color: T.bone, fontSize: 14, fontFamily: sans, marginBottom: 12,
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
        <div onClick={onClose} style={{ display: "flex", justifyContent: "center", padding: "12px 0 8px", cursor: "pointer", flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: T.line }} />
        </div>

        {/* header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "0 16px 14px", flexShrink: 0, borderBottom: `1px solid ${T.line}` }}>
          <div style={{ width: 56, height: 56, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: T.cardUp, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {piece.image
              ? <img src={piece.image} alt={piece.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <span style={{ fontFamily: serif, fontSize: 22, color: T.faint }}>{piece.name?.[0] || "?"}</span>}
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.18em", color: T.tobacco, textTransform: "uppercase" }}>{piece.category}</div>
            <div style={{ fontFamily: serif, fontSize: 20, lineHeight: 1.2, marginTop: 2 }}>{piece.name}</div>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, marginTop: 3 }}>
              {piece.color}{piece.material ? " · " + piece.material : ""}
            </div>
          </div>
          <button
            onClick={view === "menu" ? onClose : () => setView("menu")}
            aria-label={view === "menu" ? "Close" : "Back"}
            style={{ border: "none", background: "none", color: T.faint, fontSize: 20, cursor: "pointer", padding: 4, lineHeight: 1, flexShrink: 0 }}
          >
            {view === "menu" ? "×" : "←"}
          </button>
        </div>

        {/* scrollable body */}
        <div style={{ overflowY: "auto", flex: 1, padding: "0 16px 40px" }}>

          {/* — menu — */}
          {view === "menu" && (
            <div>
              {menuActions.map(({ title, desc, onClick, danger }) => (
                <button key={title} onClick={onClick} style={{
                  width: "100%", textAlign: "left", padding: "15px 0",
                  border: "none", borderBottom: `1px solid ${T.line}`,
                  background: "none", cursor: "pointer", fontFamily: sans,
                }}>
                  <div style={{ fontSize: 15, color: danger ? T.bad : T.bone }}>{title}</div>
                  <div style={{ fontSize: 12, color: T.faint, marginTop: 3, lineHeight: 1.4 }}>{desc}</div>
                </button>
              ))}
            </div>
          )}

          {/* — pairs — */}
          {view === "pairs" && (
            <div style={{ paddingTop: 16 }}>
              {pairBusy && <Thinking label="Finding its partners…" />}
              {!pairBusy && pairResult && (
                <>
                  <p style={{ fontSize: 14, lineHeight: 1.65, color: T.stone, margin: "0 0 16px" }}>{pairResult.sentence}</p>
                  {pairPieces.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16 }}>
                      {pairPieces.map((p) => <GarmentTag key={p.id} piece={p} />)}
                    </div>
                  )}
                  <Btn onClick={() => onBuildFit(piece)}>Build a full fit from this</Btn>
                </>
              )}
              {!pairBusy && !pairResult && (
                <div style={{ padding: "24px 0" }}><Btn onClick={getPairs}>Find pairs</Btn></div>
              )}
            </div>
          )}

          {/* — edit — */}
          {view === "edit" && (
            <div style={{ paddingTop: 16 }}>
              {fieldLabel("NAME")}{fieldInput(editName, setEditName)}
              {fieldLabel("CATEGORY")}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                {CATEGORIES.map((c) => (
                  <button key={c} onClick={() => setEditCategory(c)} style={{
                    padding: "6px 12px", borderRadius: 20,
                    border: `1px solid ${editCategory === c ? T.tobacco : T.line}`,
                    background: editCategory === c ? T.tobacco : "transparent",
                    color: editCategory === c ? T.bg : T.stone,
                    fontFamily: mono, fontSize: 10, letterSpacing: "0.1em",
                    textTransform: "uppercase", cursor: "pointer",
                  }}>{c}</button>
                ))}
              </div>
              {fieldLabel("COLOR")}{fieldInput(editColor, setEditColor)}
              {fieldLabel("MATERIAL")}{fieldInput(editMaterial, setEditMaterial)}
              <Btn onClick={saveEdit}>Save changes</Btn>
            </div>
          )}

          {/* — confirm delete — */}
          {view === "confirm" && (
            <div style={{ paddingTop: 24, textAlign: "center" }}>
              <div style={{ fontFamily: serif, fontSize: 22, marginBottom: 10 }}>Remove this piece?</div>
              <p style={{ fontSize: 14, color: T.stone, lineHeight: 1.6, margin: "0 0 24px" }}>
                This permanently deletes <strong style={{ color: T.bone }}>{piece.name}</strong> from your archive. It can't be undone.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button onClick={() => { onRemove(piece.id); onClose(); }} style={{
                  width: "100%", padding: "14px 16px", borderRadius: 8,
                  border: "none", background: T.bad, color: T.bone,
                  fontFamily: mono, fontSize: 12, letterSpacing: "0.12em",
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
        padding: "14px 16px",
        borderRadius: 8,
        border: ghost ? `1px solid ${T.line}` : "none",
        background: ghost ? "transparent" : disabled ? T.faint : T.tobacco,
        color: ghost ? T.stone : T.bg,
        fontFamily: mono,
        fontSize: 12,
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
    <div style={{ fontFamily: mono, fontSize: 12, color: T.tobacco, padding: "18px 4px", animation: "pulse 1.4s infinite" }}>
      {label}
    </div>
  );
}

// ———— CLOSET ————

function Closet({ pieces, savePiece, removePiece, updatePiece, profile, flash, onBuildFit }) {
  const fileRef = useRef();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // {done, total}
  const [filter, setFilter] = useState("all");
  const [sheetPiece, setSheetPiece] = useState(null);

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

  const shown = filter === "all" ? pieces : pieces.filter((p) => p.category === filter);

  // approximate rendered heights of the fixed nav and the docked button (incl. its own padding)
  const NAV_HEIGHT = 88;
  const DOCK_HEIGHT = 68;

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

      {pieces.length > 0 && (
        <div style={{ display: "flex", gap: 6, margin: "16px 0 4px", overflowX: "auto", paddingBottom: 4 }}>
          {["all", ...CATEGORIES].map((c) => (
            <button
              key={c}
              onClick={() => setFilter(c)}
              style={{
                padding: "6px 12px",
                borderRadius: 20,
                border: `1px solid ${filter === c ? T.tobacco : T.line}`,
                background: filter === c ? T.tobacco : "transparent",
                color: filter === c ? T.bg : T.stone,
                fontFamily: mono,
                fontSize: 10,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                whiteSpace: "nowrap",
                cursor: "pointer",
              }}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {pieces.length === 0 && !busy ? (
        <div style={{ padding: "48px 12px", textAlign: "center" }}>
          <div style={{ fontFamily: serif, fontSize: 26, color: T.stone }}>The rack is empty.</div>
          <div style={{ fontSize: 13, color: T.faint, marginTop: 8, lineHeight: 1.6 }}>
            Photograph a piece to start the index. Flat-lay or on-hanger shots work best.
          </div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
            marginTop: 12,
            paddingBottom: `calc(${NAV_HEIGHT + DOCK_HEIGHT}px + env(safe-area-inset-bottom, 0px))`,
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

      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: `calc(${NAV_HEIGHT}px + env(safe-area-inset-bottom, 0px))`,
          zIndex: 40,
          background: "rgba(27,24,21,0.92)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          borderTop: `1px solid ${T.line}`,
        }}
      >
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "12px 16px" }}>
          <Btn onClick={() => fileRef.current.click()} disabled={busy}>
            {busy ? "Cataloguing…" : "+ Add pieces from photos"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ———— FITS ————

function Fits({ pieces, profile, inspo, savedFits, saveFit, removeFit, flash, anchor, setAnchor }) {
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

  return (
    <div>
      <div style={{ fontFamily: serif, fontSize: 26, marginBottom: 12 }}>Build a fit</div>
      {anchor && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          background: T.cardUp, border: `1px solid ${T.tobacco}`,
          borderRadius: 8, padding: "8px 10px", marginBottom: 10,
          animation: "rise .3s ease",
        }}>
          {anchor.image && (
            <img src={anchor.image} alt={anchor.name} style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
          )}
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div style={{ fontFamily: mono, fontSize: 8, letterSpacing: "0.2em", color: T.tobacco, textTransform: "uppercase" }}>Built around</div>
            <div style={{ fontSize: 13, color: T.bone, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{anchor.name}</div>
          </div>
          <button onClick={() => setAnchor(null)} style={{ border: "none", background: "none", color: T.faint, fontSize: 18, cursor: "pointer", padding: 4, lineHeight: 1 }}>×</button>
        </div>
      )}
      <input
        value={occasion}
        onChange={(e) => setOccasion(e.target.value)}
        placeholder="Occasion — date night, gym-to-brunch, content shoot…"
        style={{
          width: "100%",
          padding: "14px",
          borderRadius: 8,
          border: `1px solid ${T.line}`,
          background: T.card,
          color: T.bone,
          fontSize: 14,
          marginBottom: 10,
          fontFamily: sans,
        }}
      />
      <Btn onClick={generate} disabled={busy}>
        {busy ? "Styling…" : "Generate fit"}
      </Btn>
      {busy && <Thinking label="Pulling from the rack…" />}

      {fit && (
        <div style={{ marginTop: 20, animation: "rise .3s ease" }}>
          <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", color: T.tobacco }}>THE FIT</div>
          <div style={{ fontFamily: serif, fontSize: 30, margin: "4px 0 14px" }}>{fit.title}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {fitPieces.map((p) => (
              <GarmentTag key={p.id} piece={p} />
            ))}
          </div>
          {fitOptional.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.18em", color: T.faint, marginBottom: 8 }}>
                OPTIONAL FINISH
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {fitOptional.map((p) => (
                  <GarmentTag key={p.id} piece={p} dim />
                ))}
              </div>
              <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, marginTop: 6 }}>
                Add if it fits the vibe — not essential.
              </div>
            </div>
          )}
          <p style={{ fontSize: 14, lineHeight: 1.65, color: T.stone, marginTop: 16 }}>{fit.why}</p>
          {fit.missing && (
            <div
              style={{
                marginTop: 12,
                padding: "12px 14px",
                border: `1px dashed ${T.olive}`,
                borderRadius: 8,
                fontSize: 13,
                color: T.stone,
                lineHeight: 1.5,
              }}
            >
              <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.15em", color: T.olive }}>
                WORTH HUNTING:{" "}
              </span>
              {fit.missing}
            </div>
          )}

          <div style={{ marginTop: 14 }}>
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
          <div style={{ height: 1, background: T.line, margin: "28px 0 20px" }} />
          <div style={{ fontFamily: serif, fontSize: 26, marginBottom: 4 }}>Lookbook</div>
          <p style={{ fontSize: 13, color: T.faint, margin: "0 0 14px", lineHeight: 1.6 }}>
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
                  borderRadius: 10,
                  padding: "14px 14px 16px",
                  marginBottom: 10,
                  animation: "rise .3s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ fontFamily: serif, fontSize: 21, lineHeight: 1.2 }}>{f.title}</div>
                    <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.14em", color: T.tobacco, marginTop: 4, textTransform: "uppercase" }}>
                      {f.occasion}
                    </div>
                  </div>
                  <button
                    onClick={() => removeFit(f.id)}
                    aria-label={"Remove " + f.title}
                    style={{
                      border: "none",
                      background: "none",
                      color: T.faint,
                      fontSize: 16,
                      cursor: "pointer",
                      lineHeight: 1,
                      padding: 2,
                    }}
                  >
                    ×
                  </button>
                </div>
                {fp.length > 0 && (
                  <div style={{ display: "flex", gap: 6, marginTop: 12, overflowX: "auto", paddingBottom: 2 }}>
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
                          borderRadius: 6,
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
                          borderRadius: 6,
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

function Scan({ pieces, profile, flash, saveWant }) {
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

  return (
    <div>
      <div style={{ fontFamily: serif, fontSize: 26, marginBottom: 6 }}>Cop or skip?</div>
      <p style={{ fontSize: 13, color: T.faint, margin: "0 0 14px", lineHeight: 1.6 }}>
        See something in a store or online? Snap it and get a verdict against your actual closet.
      </p>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
      <Btn onClick={() => fileRef.current.click()} disabled={busy}>
        {busy ? "Judging…" : "Scan an item"}
      </Btn>
      {busy && <Thinking label="Checking it against the archive…" />}

      {result && (
        <div style={{ marginTop: 20, animation: "rise .3s ease" }}>
          {scanImg && (
            <img
              src={scanImg}
              alt="Scanned item"
              style={{ width: "100%", borderRadius: 10, border: `1px solid ${T.line}`, marginBottom: 14 }}
            />
          )}
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <div style={{ fontFamily: serif, fontSize: 40, color: verdictColor, textTransform: "capitalize" }}>
              {result.verdict}
            </div>
            <div style={{ fontFamily: mono, fontSize: 12, color: T.faint }}>{result.score}/10 closet fit</div>
          </div>
          {result.item && (
            <div style={{ fontFamily: serif, fontSize: 18, color: T.bone, marginTop: 4, lineHeight: 1.3 }}>
              {result.item}
              {result.price && (
                <span style={{ fontFamily: mono, fontSize: 12, color: T.faint, marginLeft: 10 }}>{result.price}</span>
              )}
            </div>
          )}
          <p style={{ fontSize: 14, lineHeight: 1.65, color: T.stone, marginTop: 8 }}>{result.take}</p>
          {logged && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "10px 12px", borderRadius: 8,
              border: `1px solid ${T.olive}`, background: "rgba(122,122,82,0.12)",
              marginTop: 8, animation: "rise .3s ease",
            }}>
              <span style={{ color: T.olive, fontSize: 15 }}>✓</span>
              <span style={{ fontFamily: mono, fontSize: 11, color: T.olive, letterSpacing: "0.05em" }}>
                Filed in What’s missing with the photo.
              </span>
            </div>
          )}
          {pairs.length > 0 && (
            <>
              <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", color: T.tobacco, margin: "16px 0 8px" }}>
                PAIRS WITH
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
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

function Gaps({ pieces, profile, inspo, gaps, saveGaps, toggleGapOwned, wants, removeWant, toggleWantOwned, flash }) {
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

  return (
    <div>
      <div style={{ fontFamily: serif, fontSize: 26, marginBottom: 6 }}>What's missing</div>
      <p style={{ fontSize: 13, color: T.faint, margin: "0 0 16px", lineHeight: 1.6 }}>
        The distance between the closet you have and the one your inspo board describes — ranked by what unlocks the most
        outfits.
      </p>

      {/* ——— SPOTTED IN THE WILD ——— */}
      {wants.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
            <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", color: T.tobacco }}>SPOTTED IN THE WILD</div>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.faint }}>
              {wants.filter((w) => w.owned).length}/{wants.length} bought
            </div>
          </div>
          <p style={{ fontSize: 12, color: T.faint, margin: "0 0 12px", lineHeight: 1.5 }}>
            Everything you scanned and got a cop on. Tap to mark as bought.
          </p>
          {wants.map((w) => (
            <div
              key={w.id}
              onClick={() => toggleWantOwned(w.id)}
              style={{
                position: "relative",
                display: "flex",
                gap: 12,
                background: T.card,
                border: `1px solid ${w.owned ? T.olive : T.line}`,
                borderRadius: 10,
                padding: "10px 12px",
                marginBottom: 8,
                opacity: w.owned ? 0.6 : 1,
                cursor: "pointer",
              }}
            >
              <div style={{ position: "relative", width: 66, height: 66, flexShrink: 0, borderRadius: 6, overflow: "hidden", background: T.cardUp }}>
                {w.image && <img src={w.image} alt={w.item} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                {w.owned && (
                  <div style={{
                    position: "absolute", inset: 0,
                    background: "rgba(122,122,82,0.65)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 28, color: "#fff",
                  }}>✓</div>
                )}
              </div>
              <div style={{ flex: 1, overflow: "hidden", paddingRight: 18 }}>
                <div style={{
                  fontSize: 15, color: T.bone, marginBottom: 3, lineHeight: 1.3,
                  textDecoration: w.owned ? "line-through" : "none",
                }}>{w.item}</div>
                <div style={{
                  fontSize: 12, color: T.stone, lineHeight: 1.5,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}>{w.reason}</div>
                <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, marginTop: 5 }}>
                  {w.score}/10{w.price ? " · " + w.price : ""}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeWant(w.id); }}
                style={{
                  position: "absolute", top: 8, right: 8,
                  width: 22, height: 22, borderRadius: 11,
                  border: "none", background: "rgba(27,24,21,.7)",
                  color: T.faint, fontSize: 13, cursor: "pointer",
                  lineHeight: 1, padding: 0,
                }}
              >×</button>
            </div>
          ))}
        </div>
      )}

      {gaps && (
        <div style={{ animation: "rise .3s ease" }}>
          <p style={{ fontSize: 14, lineHeight: 1.65, color: T.stone, margin: "0 0 18px" }}>{gaps.verdict}</p>

          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
            <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", color: T.tobacco }}>GAPS IN THE ARCHIVE</div>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.faint }}>
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
                  borderRadius: 10,
                  marginBottom: 8,
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
                    gap: 12,
                    padding: "13px 14px",
                    cursor: "pointer",
                    fontFamily: sans,
                  }}
                >
                  <div
                    onClick={(e) => { e.stopPropagation(); toggleGapOwned(i); }}
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 4,
                      flexShrink: 0,
                      border: `1px solid ${it.owned ? T.olive : T.faint}`,
                      background: it.owned ? T.olive : "transparent",
                      color: T.bg,
                      fontSize: 13,
                      lineHeight: "19px",
                      textAlign: "center",
                      cursor: "pointer",
                    }}
                  >
                    {it.owned ? "✓" : ""}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      fontSize: 15,
                      color: T.bone,
                      textDecoration: it.owned ? "line-through" : "none",
                      lineHeight: 1.3,
                    }}
                  >
                    {it.item}
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 14, color: T.faint, lineHeight: 1 }}>
                    {open ? "−" : "+"}
                  </div>
                </div>

                {/* expanded content */}
                {open && (
                  <div
                    style={{
                      padding: "0 14px 14px",
                      paddingLeft: 14 + 20 + 12,
                      borderTop: `1px solid ${T.line}`,
                      paddingTop: 12,
                      animation: "rise .2s ease",
                    }}
                  >
                    <div style={{ fontSize: 13, color: T.stone, lineHeight: 1.55 }}>{it.why}</div>
                    {it.price && (
                      <div style={{ fontFamily: mono, fontSize: 11, color: T.tobacco, marginTop: 8 }}>
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
                marginTop: 14,
                padding: "12px 14px",
                border: `1px dashed ${T.bad}`,
                borderRadius: 8,
                fontSize: 13,
                color: T.stone,
                lineHeight: 1.5,
              }}
            >
              <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.15em", color: T.bad }}>ENOUGH OF: </span>
              {gaps.stop_buying}
            </div>
          )}
        </div>
      )}

      {stale && !busy && (
        <div style={{ fontFamily: mono, fontSize: 11, color: T.tobacco, margin: "16px 0 10px", animation: "rise .3s ease" }}>
          Your closet or inspo changed since this analysis.
        </div>
      )}

      <div style={{ marginTop: gaps ? 16 : 0 }}>
        <Btn onClick={analyze} disabled={busy}>
          {busy ? "Analysing…" : gaps ? "Re-run analysis" : "Find my gaps"}
        </Btn>
      </div>
      {busy && <Thinking label="Measuring closet against inspo…" />}
    </div>
  );
}

// ———— STYLE PROFILE ————

function Profile({ profile, saveProfile, inspo, saveInspo, removeInspo, assessment, saveAssessment, pieces, flash, myOutfits, saveMyOutfit, removeMyOutfit, updateMyOutfit }) {
  const [subTab, setSubTab] = useState("assessment");
  const [draft, setDraft] = useState(profile);
  const [selectedInspo, setSelectedInspo] = useState(null);
  const inspoRef = useRef();
  const [inspoBusy, setInspoBusy] = useState(false);
  const [inspoProgress, setInspoProgress] = useState(null);
  const [assessBusy, setAssessBusy] = useState(false);

  useEffect(() => setDraft(profile), [profile]);

  // deselect if the chosen image was removed
  useEffect(() => {
    if (selectedInspo && !inspo.some((i) => i.id === selectedInspo.id)) setSelectedInspo(null);
  }, [inspo, selectedInspo]);

  const fp = draft.trim() + "|" + inspo.map((i) => i.id).join(",") + "|" + myOutfits.map((o) => o.id).join(",");
  const stale = assessment && assessment.fp !== fp;
  const unsaved = draft !== profile;

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
    ["assessment", "Style Assessment"],
    ["inspo", inspo.length ? `Add inspiration  ${inspo.length}` : "Add inspiration"],
    ["profile", "My Style"],
  ];

  return (
    <div>
      {/* ── Segmented control ── */}
      <div
        style={{
          display: "flex",
          background: T.card,
          borderRadius: 8,
          border: `1px solid ${T.line}`,
          marginBottom: 20,
          overflow: "hidden",
        }}
      >
        {TABS.map(([id, label], idx) => (
          <button
            key={id}
            onClick={() => setSubTab(id)}
            style={{
              flex: 1,
              padding: "10px 3px",
              border: "none",
              borderRight: idx < TABS.length - 1 ? `1px solid ${T.line}` : "none",
              background: subTab === id ? T.cardUp : "transparent",
              color: subTab === id ? T.bone : T.faint,
              fontFamily: mono,
              fontSize: 9,
              letterSpacing: "0.03em",
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

      {/* ── Style Assessment ── */}
      {subTab === "assessment" && (
        <div>
          <p style={{ fontSize: 13, color: T.faint, margin: "0 0 14px", lineHeight: 1.6 }}>
            A synthesis of your written profile, inspo board, closet, and outfit photos — broken into the distinct style lanes actually running through your closet.
          </p>
          {stale && !assessBusy && (
            <div style={{ fontFamily: mono, fontSize: 11, color: T.tobacco, marginBottom: 10, animation: "rise .3s ease" }}>
              Your profile, inspo, or outfits changed since this assessment.
            </div>
          )}
          <Btn onClick={runAssessment} disabled={assessBusy}>
            {assessBusy ? "Assessing…" : assessment ? "Update assessment" : "Run assessment"}
          </Btn>
          {assessBusy && <Thinking label="Reading between your pieces…" />}
          {assessment ? (
            <div style={{ marginTop: 16, animation: "rise .3s ease" }}>
              {(assessment.profiles || []).map((prof, idx) => (
                <div
                  key={idx}
                  style={{
                    background: T.card,
                    border: `1px solid ${stale ? T.tobacco : T.line}`,
                    borderRadius: 10,
                    padding: "18px 16px",
                    marginBottom: 14,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", color: T.tobacco }}>
                      {(prof.rank || "").toUpperCase()}
                    </div>
                    {prof.activity && (
                      <div
                        style={{
                          fontFamily: mono,
                          fontSize: 9,
                          letterSpacing: "0.1em",
                          padding: "3px 8px",
                          borderRadius: 20,
                          border: `1px solid ${prof.activity === "active" ? T.olive : T.line}`,
                          color: prof.activity === "active" ? T.olive : T.faint,
                          textTransform: "uppercase",
                        }}
                      >
                        {prof.activity}
                      </div>
                    )}
                  </div>
                  <div style={{ fontFamily: serif, fontSize: 30, margin: "4px 0 10px" }}>{prof.headline}</div>
                  <p style={{ fontSize: 14, lineHeight: 1.65, color: T.stone, margin: "0 0 14px" }}>{prof.read}</p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: prof.direction ? 14 : 0 }}>
                    {(prof.pillars || []).map((p, i) => (
                      <span
                        key={i}
                        style={{
                          padding: "5px 11px",
                          borderRadius: 20,
                          border: `1px solid ${T.line}`,
                          background: T.cardUp,
                          fontFamily: mono,
                          fontSize: 10,
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
                    <div style={{ fontSize: 13, lineHeight: 1.55, color: T.stone, borderLeft: `2px solid ${T.olive}`, paddingLeft: 10 }}>
                      <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.15em", color: T.olive }}>DIRECTION: </span>
                      {prof.direction}
                    </div>
                  )}
                </div>
              ))}
              {assessment.shared_pieces?.length > 0 && (
                <div>
                  <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", color: T.tobacco, marginBottom: 8 }}>
                    SHARED PIECES
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {assessment.shared_pieces.map((sp, i) => (
                      <div
                        key={i}
                        style={{
                          fontSize: 13,
                          lineHeight: 1.5,
                          color: T.stone,
                          background: T.card,
                          border: `1px solid ${T.line}`,
                          borderRadius: 8,
                          padding: "10px 12px",
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
            <div style={{ padding: "48px 12px", textAlign: "center" }}>
              <div style={{ fontFamily: serif, fontSize: 22, color: T.stone }}>No assessment yet.</div>
              <div style={{ fontSize: 13, color: T.faint, marginTop: 8, lineHeight: 1.6 }}>
                Fill in your style profile and run the assessment to see the style lanes running through your closet.
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* ── Add Inspiration ── */}
      {subTab === "inspo" && (
        <div>
          <p style={{ fontSize: 13, color: T.faint, margin: "0 0 14px", lineHeight: 1.6 }}>
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
          <Btn onClick={() => inspoRef.current.click()} disabled={inspoBusy}>
            {inspoBusy ? "Reading the vibe…" : "+ Add inspo images"}
          </Btn>
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
                borderRadius: 10,
                overflow: "hidden",
                marginTop: 14,
                animation: "rise .3s ease",
              }}
            >
              <img
                src={selectedInspo.image}
                alt={selectedInspo.vibe}
                style={{ width: "100%", maxHeight: 280, objectFit: "cover", display: "block" }}
              />
              <div style={{ padding: "14px 14px 16px" }}>
                <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.18em", color: T.tobacco, marginBottom: 6 }}>
                  THE VIBE
                </div>
                <p style={{ fontSize: 13, lineHeight: 1.6, color: T.stone, margin: "0 0 14px" }}>
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
                gap: 6,
                marginTop: 14,
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
                    borderRadius: 6,
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
            <div style={{ padding: "48px 12px", textAlign: "center" }}>
              <div style={{ fontFamily: serif, fontSize: 22, color: T.stone }}>Board is empty.</div>
              <div style={{ fontSize: 13, color: T.faint, marginTop: 8, lineHeight: 1.6 }}>
                Add Pinterest saves, editorial shots, or fit pics that represent the aesthetic you're building.
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* ── My Style ── */}
      {subTab === "profile" && (
        <div>
          <p style={{ fontSize: 13, color: T.faint, margin: "0 0 14px", lineHeight: 1.6 }}>
            The AI judges every fit and scan against this. Keep it honest — colors, cuts, what you never wear.
          </p>
          {unsaved && (
            <div style={{ fontFamily: mono, fontSize: 11, color: T.tobacco, marginBottom: 10, animation: "rise .3s ease" }}>
              Unsaved changes
            </div>
          )}
          <Btn onClick={() => { saveProfile(draft); flash("Profile saved"); }}>
            Save my style
          </Btn>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={8}
            style={{
              width: "100%",
              padding: 14,
              borderRadius: 8,
              border: `1px solid ${T.line}`,
              background: T.card,
              color: T.bone,
              fontSize: 14,
              lineHeight: 1.6,
              fontFamily: sans,
              resize: "vertical",
              marginTop: 12,
            }}
          />
          {!draft.trim() && (
            <div style={{ padding: "32px 12px 0", textAlign: "center" }}>
              <div style={{ fontSize: 13, color: T.faint, lineHeight: 1.6 }}>
                Describe your aesthetic — preferred colors, silhouettes, what you'd never wear. The more specific, the sharper the AI's suggestions.
              </div>
            </div>
          )}
          <MyOutfitsSection
            outfits={myOutfits}
            pieces={pieces}
            saveMyOutfit={saveMyOutfit}
            removeMyOutfit={removeMyOutfit}
            updateMyOutfit={updateMyOutfit}
            saveInspo={saveInspo}
            flash={flash}
          />
        </div>
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
        padding: 0, border: `1px solid ${T.line}`, borderRadius: 8,
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
            borderRadius: 10, padding: "2px 6px",
            fontFamily: mono, fontSize: 9, color: T.stone,
          }}>+{outfit.imageIds.length - 1}</div>
        )}
        {outfit.inInspo && (
          <div style={{
            position: "absolute", top: 5, left: 5,
            background: "rgba(176,141,87,.85)", borderRadius: 10,
            padding: "2px 6px", fontFamily: mono, fontSize: 8,
            color: T.bg, letterSpacing: "0.08em",
          }}>INSPO</div>
        )}
      </div>
      <div style={{ padding: "7px 8px 9px" }}>
        <div style={{ fontFamily: mono, fontSize: 10, color: T.tobacco }}>{date}</div>
        {outfit.occasion && (
          <div style={{
            fontSize: 11, color: T.stone, marginTop: 2, lineHeight: 1.3,
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
    <div style={{ marginBottom: 14 }}>
      {label && (
        <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.14em", color: T.faint, marginBottom: 6 }}>
          {label}
        </div>
      )}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search pieces…"
        style={{
          width: "100%", padding: "8px 10px", borderRadius: 6,
          border: `1px solid ${T.line}`, background: T.cardUp,
          color: T.bone, fontSize: 12, fontFamily: sans, marginBottom: 8,
        }}
      />
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 8 }}>
        <button onClick={() => setCategory("all")} style={pillStyle(category === "all")}>All {pieces.length}</button>
        {cats.map((c) => (
          <button key={c.id} onClick={() => setCategory(c.id)} style={pillStyle(category === c.id)}>
            {c.id} {c.count}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {selectedPieces.length > 0 && (
          <>
            <div style={{ width: "100%", fontFamily: mono, fontSize: 9, letterSpacing: "0.14em", color: T.tobacco }}>
              SELECTED
            </div>
            {selectedPieces.map((p) => (
              <button key={p.id} onClick={() => handleToggle(p.id)} style={toggleStyle(true)}>{p.name}</button>
            ))}
            {unselected.length > 0 && <div style={{ width: "100%", height: 1, background: T.line, margin: "2px 0" }} />}
          </>
        )}
        {unselected.length > 0 ? (
          unselected.map((p) => (
            <button key={p.id} onClick={() => handleToggle(p.id)} style={toggleStyle(false)}>{p.name}</button>
          ))
        ) : selectedPieces.length === 0 ? (
          <div style={{ fontFamily: mono, fontSize: 11, color: T.faint, padding: "8px 0" }}>No pieces match.</div>
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
      <button onClick={() => setOpen((o) => !o)} style={pillStyle(active)}>{label}</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 90 }} />
          <div style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 91,
            width: 220, background: T.cardUp, border: `1px solid ${T.line}`,
            borderRadius: 10, padding: 12, boxShadow: "0 12px 28px rgba(0,0,0,.45)",
          }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 10 }}>
              {presets.map((p) => (
                <button key={p.label} onClick={() => applyPreset(p)} style={{
                  textAlign: "left", padding: "7px 8px", borderRadius: 6,
                  border: "none", background: "none", color: T.stone,
                  fontFamily: mono, fontSize: 11, cursor: "pointer",
                }}>{p.label}</button>
              ))}
            </div>
            <div style={{ height: 1, background: T.line, margin: "4px 0 10px" }} />
            <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.12em", color: T.faint, marginBottom: 4 }}>FROM</div>
            <input type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} style={{
              width: "100%", padding: "7px 8px", borderRadius: 6, border: `1px solid ${T.line}`,
              background: T.card, color: T.bone, fontSize: 12, fontFamily: sans, marginBottom: 8, colorScheme: "dark",
            }} />
            <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.12em", color: T.faint, marginBottom: 4 }}>TO</div>
            <input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} style={{
              width: "100%", padding: "7px 8px", borderRadius: 6, border: `1px solid ${T.line}`,
              background: T.card, color: T.bone, fontSize: 12, fontFamily: sans, marginBottom: 10, colorScheme: "dark",
            }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => { onApply("", ""); setOpen(false); }} style={{
                flex: 1, padding: "8px 0", borderRadius: 6, border: `1px solid ${T.line}`,
                background: "none", color: T.faint, fontFamily: mono, fontSize: 10,
                letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer",
              }}>Clear</button>
              <button onClick={() => { onApply(draftFrom, draftTo); setOpen(false); }} style={{
                flex: 1, padding: "8px 0", borderRadius: 6, border: "none",
                background: T.tobacco, color: T.bg, fontFamily: mono, fontSize: 10,
                letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer",
              }}>Apply</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function OutfitAddFlow({ pieces, onSave, onClose, flash }) {
  const cameraRef = useRef();
  const libRef = useRef();
  const [view, setView] = useState("pick");
  const [staged, setStaged] = useState([]);
  const [dateWorn, setDateWorn] = useState(() => new Date().toISOString().slice(0, 10));
  const [pieceIds, setPieceIds] = useState([]);
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
    <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.14em", color: T.faint, marginBottom: 6 }}>{txt}</div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200 }} />
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, maxHeight: "90vh",
        background: T.card, borderRadius: "16px 16px 0 0", zIndex: 201,
        display: "flex", flexDirection: "column",
        animation: "slideUp .28s ease", border: `1px solid ${T.line}`, borderBottom: "none",
      }}>
        <div onClick={onClose} style={{ display: "flex", justifyContent: "center", padding: "12px 0 8px", cursor: "pointer", flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: T.line }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px 12px", flexShrink: 0, borderBottom: `1px solid ${T.line}` }}>
          <div style={{ fontFamily: serif, fontSize: 20 }}>{view === "pick" ? "Add outfit" : "Review"}</div>
          <button
            onClick={view === "pick" ? onClose : () => setView("pick")}
            style={{ border: "none", background: "none", color: T.faint, fontSize: 20, cursor: "pointer", lineHeight: 1 }}
          >{view === "pick" ? "×" : "←"}</button>
        </div>
        <div style={{ overflowY: "auto", flex: 1, padding: "16px 16px 40px" }}>
          {view === "pick" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 8 }}>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple style={{ display: "none" }}
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              <input ref={libRef} type="file" accept="image/*" multiple style={{ display: "none" }}
                onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
              <Btn onClick={() => cameraRef.current.click()}>Take photo</Btn>
              <Btn ghost onClick={() => libRef.current.click()}>Choose from library</Btn>
              <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, textAlign: "center", marginTop: 4 }}>
                Up to 3 photos per outfit
              </div>
            </div>
          )}
          {view === "review" && (
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 16, overflowX: "auto", paddingBottom: 4 }}>
                {staged.map((img) => (
                  <div key={img.id} style={{
                    position: "relative", flexShrink: 0, width: 100, height: 133,
                    borderRadius: 8, overflow: "hidden", border: `1px solid ${T.line}`,
                  }}>
                    <img src={img.dataUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <button onClick={() => removeStaged(img.id)} style={{
                      position: "absolute", top: 4, right: 4, width: 22, height: 22,
                      borderRadius: 11, border: "none", background: "rgba(27,24,21,.8)",
                      color: T.stone, fontSize: 13, lineHeight: 1, cursor: "pointer", padding: 0,
                    }}>×</button>
                  </div>
                ))}
                {staged.length < 3 && (
                  <button onClick={() => libRef.current.click()} style={{
                    flexShrink: 0, width: 100, height: 133, borderRadius: 8,
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
                  width: "100%", padding: "12px 14px", borderRadius: 8,
                  border: `1px solid ${T.line}`, background: T.cardUp,
                  color: T.bone, fontSize: 14, fontFamily: sans,
                  marginBottom: 12, colorScheme: "dark",
                }}
              />

              {pieces.length > 0 && (
                <PiecePicker pieces={pieces} selectedIds={pieceIds} onToggle={togglePiece} label="PIECES WORN — tap to link" />
              )}

              {fieldLabel("OCCASION (optional)")}
              <input
                value={occasion}
                onChange={(e) => setOccasion(e.target.value)}
                placeholder="e.g. dinner out, work, weekend"
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 8,
                  border: `1px solid ${T.line}`, background: T.cardUp,
                  color: T.bone, fontSize: 14, fontFamily: sans, marginBottom: 12,
                }}
              />

              {fieldLabel("NOTE (optional)")}
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="How it felt, what you'd change…"
                rows={3}
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 8,
                  border: `1px solid ${T.line}`, background: T.cardUp, color: T.bone,
                  fontSize: 14, fontFamily: sans, resize: "vertical",
                  marginBottom: 16, lineHeight: 1.5,
                }}
              />

              {pieceIds.length > 0 && (
                <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, marginBottom: 8 }}>
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

function OutfitDetail({ outfit, pieces, onClose, onDelete, onUpdate, onAddToInspo }) {
  const [view, setView] = useState("detail");
  const [images, setImages] = useState([]);
  const [editDate, setEditDate] = useState(outfit.dateWorn || "");
  const [editPieceIds, setEditPieceIds] = useState(outfit.pieceIds || []);
  const [editOccasion, setEditOccasion] = useState(outfit.occasion || "");
  const [editNote, setEditNote] = useState(outfit.note || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all((outfit.imageIds || []).map((id) => loadImage(id)))
      .then((imgs) => setImages(imgs.filter(Boolean)));
  }, [outfit.id]);

  const linkedPieces = pieces.filter((p) => outfit.pieceIds?.includes(p.id));

  const handleSave = async () => {
    setSaving(true);
    await onUpdate({
      ...outfit,
      dateWorn: editDate,
      pieceIds: editPieceIds,
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
    <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.14em", color: T.faint, marginBottom: 6 }}>{txt}</div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200 }} />
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, maxHeight: "90vh",
        background: T.card, borderRadius: "16px 16px 0 0", zIndex: 201,
        display: "flex", flexDirection: "column",
        animation: "slideUp .28s ease", border: `1px solid ${T.line}`, borderBottom: "none",
      }}>
        <div onClick={onClose} style={{ display: "flex", justifyContent: "center", padding: "12px 0 8px", cursor: "pointer", flexShrink: 0 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: T.line }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px 12px", flexShrink: 0, borderBottom: `1px solid ${T.line}` }}>
          <div style={{ fontFamily: serif, fontSize: 20 }}>
            {view === "detail" ? date : view === "edit" ? "Edit outfit" : "Delete outfit?"}
          </div>
          <button
            onClick={view === "detail" ? onClose : () => setView("detail")}
            style={{ border: "none", background: "none", color: T.faint, fontSize: 20, cursor: "pointer", lineHeight: 1 }}
          >{view === "detail" ? "×" : "←"}</button>
        </div>
        <div style={{ overflowY: "auto", flex: 1, padding: "0 16px 40px" }}>

          {view === "detail" && (
            <div>
              {images.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginTop: 14, overflowX: "auto", paddingBottom: 4 }}>
                  {images.map((src, i) => (
                    <img key={i} src={src} alt="" style={{
                      flexShrink: 0,
                      width: images.length === 1 ? "100%" : 180,
                      height: images.length === 1 ? "auto" : 240,
                      maxHeight: 340,
                      objectFit: "cover", borderRadius: 8, border: `1px solid ${T.line}`,
                    }} />
                  ))}
                </div>
              )}
              {outfit.occasion && (
                <div style={{ fontSize: 15, color: T.bone, marginTop: 14, lineHeight: 1.4 }}>{outfit.occasion}</div>
              )}
              {outfit.note && (
                <p style={{ fontSize: 13, color: T.stone, lineHeight: 1.6, marginTop: 8, marginBottom: 0 }}>{outfit.note}</p>
              )}
              {linkedPieces.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.18em", color: T.faint, marginBottom: 8 }}>PIECES</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {linkedPieces.map((p) => (
                      <span key={p.id} style={{
                        padding: "4px 10px", borderRadius: 20, fontFamily: mono, fontSize: 10,
                        border: `1px solid ${T.line}`, color: T.stone,
                      }}>{p.name}</span>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                {!outfit.inInspo ? (
                  <Btn ghost onClick={() => onAddToInspo(outfit)}>Add to inspo board</Btn>
                ) : (
                  <div style={{ fontFamily: mono, fontSize: 10, color: T.tobacco, textAlign: "center", padding: "8px 0" }}>
                    ✓ On your inspo board
                  </div>
                )}
                <Btn ghost onClick={() => setView("edit")}>Edit</Btn>
                <button onClick={() => setView("confirm")} style={{
                  width: "100%", padding: "14px 16px", borderRadius: 8,
                  border: `1px solid ${T.line}`, background: "none",
                  color: T.bad, fontFamily: mono, fontSize: 12,
                  letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer",
                }}>Delete</button>
              </div>
            </div>
          )}

          {view === "edit" && (
            <div style={{ paddingTop: 16 }}>
              {fieldLabel("DATE WORN")}
              <input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 8,
                  border: `1px solid ${T.line}`, background: T.cardUp,
                  color: T.bone, fontSize: 14, fontFamily: sans,
                  marginBottom: 12, colorScheme: "dark",
                }}
              />
              {pieces.length > 0 && (
                <PiecePicker pieces={pieces} selectedIds={editPieceIds} onToggle={toggleEditPiece} label="PIECES WORN" />
              )}
              {fieldLabel("OCCASION")}
              <input
                value={editOccasion}
                onChange={(e) => setEditOccasion(e.target.value)}
                placeholder="optional"
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 8,
                  border: `1px solid ${T.line}`, background: T.cardUp,
                  color: T.bone, fontSize: 14, fontFamily: sans, marginBottom: 12,
                }}
              />
              {fieldLabel("NOTE")}
              <textarea
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                placeholder="optional"
                rows={3}
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 8,
                  border: `1px solid ${T.line}`, background: T.cardUp, color: T.bone,
                  fontSize: 14, fontFamily: sans, resize: "vertical",
                  marginBottom: 16, lineHeight: 1.5,
                }}
              />
              {editPieceIds.length > 0 && (
                <div style={{ fontFamily: mono, fontSize: 10, color: T.faint, marginBottom: 8 }}>
                  {editPieceIds.length} piece{editPieceIds.length === 1 ? "" : "s"} selected
                </div>
              )}
              <Btn onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Btn>
            </div>
          )}

          {view === "confirm" && (
            <div style={{ paddingTop: 24, textAlign: "center" }}>
              <div style={{ fontFamily: serif, fontSize: 22, marginBottom: 10 }}>Delete this outfit?</div>
              <p style={{ fontSize: 14, color: T.stone, lineHeight: 1.6, margin: "0 0 24px" }}>
                This permanently removes the outfit and its photos. Can't be undone.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button
                  onClick={async () => { await onDelete(outfit.id); onClose(); }}
                  style={{
                    width: "100%", padding: "14px 16px", borderRadius: 8,
                    border: "none", background: T.bad, color: T.bone,
                    fontFamily: mono, fontSize: 12, letterSpacing: "0.12em",
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

function MyOutfitsSection({ outfits, pieces, saveMyOutfit, removeMyOutfit, updateMyOutfit, saveInspo, flash }) {
  const [expanded, setExpanded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [detail, setDetail] = useState(null);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterPieceId, setFilterPieceId] = useState(null);

  const filtered = outfits.filter((o) => {
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
    <div style={{ marginTop: 28, borderTop: `1px solid ${T.line}`, paddingTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button
          onClick={() => setExpanded((e) => !e)}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}
        >
          <div style={{ fontFamily: serif, fontSize: 22, color: T.bone }}>My Outfits</div>
          <div style={{ fontFamily: mono, fontSize: 10, color: T.faint }}>
            {outfits.length > 0 ? `${outfits.length} · ` : ""}{expanded ? "−" : "+"}
          </div>
        </button>
        {expanded && (
          <button onClick={() => setShowAdd(true)} style={{
            padding: "7px 12px", borderRadius: 20,
            border: `1px solid ${T.tobacco}`, background: "none", color: T.tobacco,
            fontFamily: mono, fontSize: 10, letterSpacing: "0.1em",
            textTransform: "uppercase", cursor: "pointer",
          }}>+ Add</button>
        )}
      </div>

      {expanded && (
        <div style={{ marginTop: 14, animation: "rise .25s ease" }}>
          {outfits.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              {usedCats.length > 0 && (
                <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 8 }}>
                  <button onClick={() => setCategoryFilter("all")} style={pillStyle(filterCategory === "all")}>
                    All {usedPieces.length}
                  </button>
                  {usedCats.map((c) => (
                    <button key={c.id} onClick={() => setCategoryFilter(c.id)} style={pillStyle(filterCategory === c.id)}>
                      {c.id} {c.count}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
                <DateRangeChip from={filterFrom} to={filterTo} onApply={(f, t) => { setFilterFrom(f); setFilterTo(t); }} />
                <button onClick={() => setFilterPieceId(null)} style={pillStyle(filterPieceId === null)}>All</button>
                {visiblePieces.map((p) => (
                  <button key={p.id} onClick={() => setFilterPieceId((prev) => prev === p.id ? null : p.id)} style={pillStyle(filterPieceId === p.id)}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {filtered.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {filtered.map((o) => (
                <OutfitCard key={o.id} outfit={o} onClick={() => setDetail(o)} />
              ))}
            </div>
          ) : outfits.length > 0 ? (
            <div style={{ padding: "24px 0", textAlign: "center", fontFamily: mono, fontSize: 12, color: T.faint }}>
              No outfits match those filters.
            </div>
          ) : (
            <div style={{ padding: "32px 12px", textAlign: "center" }}>
              <div style={{ fontFamily: serif, fontSize: 20, color: T.stone }}>Nothing logged yet.</div>
              <div style={{ fontSize: 13, color: T.faint, marginTop: 8, lineHeight: 1.6 }}>
                Add your first outfit above.
              </div>
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <OutfitAddFlow pieces={pieces} onSave={saveMyOutfit} onClose={() => setShowAdd(false)} flash={flash} />
      )}
      {detail && (
        <OutfitDetail
          outfit={detail}
          pieces={pieces}
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
