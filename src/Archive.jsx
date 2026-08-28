import { useState, useEffect, useRef } from "react";

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

// ————————————————————————————————————————————————

export default function Archive() {
  const [tab, setTab] = useState("closet");
  const [pieces, setPieces] = useState([]);
  const [inspo, setInspo] = useState([]);
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [assessment, setAssessment] = useState(null);
  const [savedFits, setSavedFits] = useState([]);
  const [gaps, setGaps] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState(null);

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
          <Closet pieces={pieces} savePiece={savePiece} removePiece={removePiece} flash={flash} />
        ) : tab === "fits" ? (
          <Fits
            pieces={pieces}
            profile={profile}
            inspo={inspo}
            savedFits={savedFits}
            saveFit={saveFit}
            removeFit={removeFit}
            flash={flash}
          />
        ) : tab === "scan" ? (
          <Scan pieces={pieces} profile={profile} flash={flash} />
        ) : tab === "gaps" ? (
          <Gaps
            pieces={pieces}
            profile={profile}
            inspo={inspo}
            gaps={gaps}
            saveGaps={saveGaps}
            toggleGapOwned={toggleGapOwned}
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

function GarmentTag({ piece, onRemove, dim }) {
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
        {onRemove && (
          <button
            onClick={() => onRemove(piece.id)}
            aria-label={"Remove " + piece.name}
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              width: 24,
              height: 24,
              borderRadius: 12,
              border: "none",
              background: "rgba(27,24,21,.8)",
              color: T.stone,
              fontSize: 13,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
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

function Closet({ pieces, savePiece, removePiece, flash }) {
  const fileRef = useRef();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // {done, total}
  const [filter, setFilter] = useState("all");

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

  return (
    <div>
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={handleFiles} />
      <Btn onClick={() => fileRef.current.click()} disabled={busy}>
        {busy ? "Cataloguing…" : "+ Add pieces from photos"}
      </Btn>
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
          {shown.map((p) => (
            <GarmentTag key={p.id} piece={p} onRemove={removePiece} />
          ))}
        </div>
      )}
    </div>
  );
}

// ———— FITS ————

function Fits({ pieces, profile, inspo, savedFits, saveFit, removeFit, flash }) {
  const [occasion, setOccasion] = useState("");
  const [busy, setBusy] = useState(false);
  const [fit, setFit] = useState(null);
  const [stashed, setStashed] = useState(false);

  const generate = async () => {
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
            text: `You are a personal stylist with sharp editorial instincts. Style profile: ${profile}${inspoNotes}\n\n— CLOTHING (build the fit exclusively from these) —\n${clothingSummary}\n\n— ACCESSORIES: hats, caps, bags, jewelry (do NOT put these in piece_ids; only suggest one in optional_piece_ids if it truly completes this specific look — default is an empty array) —\n${accessorySummary}\n\nBuild one outfit for: "${occasion || "an everyday fit"}".\n\n1. Pick 3-5 clothing pieces that work together for the occasion, style profile, and color story. Rotate the closet — avoid defaulting to the same pieces every time.\n2. Only after the core fit is done: decide if any single accessory genuinely elevates it. If uncertain, leave optional_piece_ids empty.\n\nRespond ONLY with JSON, no markdown: {"title": "evocative 3-5 word fit name", "piece_ids": ["clothing ids only — absolutely no accessories here"], "optional_piece_ids": ["one accessory id if it genuinely elevates this look, otherwise []"], "why": "2-3 sentences on why this core combination works", "missing": "one piece not in the closet that would elevate this fit, or null"}`,
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

function Scan({ pieces, profile, flash }) {
  const fileRef = useRef();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [scanImg, setScanImg] = useState(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setResult(null);
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
            }\n\nJudge the item in the photo against their style and closet. Be honest — skip means skip. Respond ONLY with JSON, no markdown: {"verdict": "cop" | "skip" | "maybe", "score": 1-10 fit with their wardrobe, "take": "2-3 blunt sentences — does it match the profile, does it duplicate anything, what gap does it fill", "pairs_with": ["ids of up to 3 closet pieces it works with"]}`,
          },
        ],
        1200
      );
      setResult(r);
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
          <p style={{ fontSize: 14, lineHeight: 1.65, color: T.stone, marginTop: 8 }}>{result.take}</p>
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

function Gaps({ pieces, profile, inspo, gaps, saveGaps, toggleGapOwned, flash }) {
  const [busy, setBusy] = useState(false);

  const fp = pieces.length + "|" + inspo.map((i) => i.id).join(",");
  const stale = gaps && gaps.fp !== fp;

  const analyze = async () => {
    if (pieces.length < 5) return flash("Catalogue at least 5 pieces first");
    setBusy(true);
    try {
      const inspoNotes = inspo.length
        ? `\n\nInspo board — the aesthetic they're building toward:\n${inspo.map((i) => "- " + i.vibe).join("\n")}`
        : "";
      const result = await askClaude(
        [
          {
            type: "text",
            text: `You are a wardrobe consultant. Style profile: ${profile}${inspoNotes}\n\nTheir full closet:\n${closetSummary(
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

      {gaps && (
        <div style={{ animation: "rise .3s ease" }}>
          <p style={{ fontSize: 14, lineHeight: 1.65, color: T.stone, margin: "0 0 18px" }}>{gaps.verdict}</p>

          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
            <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", color: T.tobacco }}>THE LIST</div>
            <div style={{ fontFamily: mono, fontSize: 10, color: T.faint }}>
              {bought}/{gaps.items.length} acquired
            </div>
          </div>

          {gaps.items.map((it, i) => (
            <button
              key={i}
              onClick={() => toggleGapOwned(i)}
              style={{
                width: "100%",
                textAlign: "left",
                display: "flex",
                gap: 12,
                background: T.card,
                border: `1px solid ${it.owned ? T.olive : T.line}`,
                borderRadius: 10,
                padding: "14px 14px",
                marginBottom: 8,
                cursor: "pointer",
                opacity: it.owned ? 0.55 : 1,
                fontFamily: sans,
              }}
            >
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 4,
                  flexShrink: 0,
                  marginTop: 2,
                  border: `1px solid ${it.owned ? T.olive : T.faint}`,
                  background: it.owned ? T.olive : "transparent",
                  color: T.bg,
                  fontSize: 13,
                  lineHeight: "19px",
                  textAlign: "center",
                }}
              >
                {it.owned ? "✓" : ""}
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 15,
                    color: T.bone,
                    textDecoration: it.owned ? "line-through" : "none",
                    lineHeight: 1.3,
                  }}
                >
                  {it.item}
                </div>
                <div style={{ fontSize: 13, color: T.stone, marginTop: 5, lineHeight: 1.5 }}>{it.why}</div>
                {it.price && (
                  <div style={{ fontFamily: mono, fontSize: 11, color: T.tobacco, marginTop: 6 }}>{it.price}</div>
                )}
              </div>
            </button>
          ))}

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

function Profile({ profile, saveProfile, inspo, saveInspo, removeInspo, assessment, saveAssessment, pieces, flash }) {
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

  const fp = draft.trim() + "|" + inspo.map((i) => i.id).join(",");
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
      const result = await askClaude(
        [
          {
            type: "text",
            text: `You are a sharp menswear stylist doing a style assessment. The client describes their style as: "${draft}"${inspoNotes}${closetNotes}\n\nSynthesize everything into an honest assessment. Where the inspo board and their self-description diverge, say so. Respond ONLY with JSON, no markdown: {"headline": "a 2-4 word name for their style identity", "read": "3-4 sentences: what their style actually is, what's consistent, what's tension or drift between stated style, inspo, and closet", "pillars": ["4 short phrases — the core codes of their style"], "blind_spot": "one sentence on a gap or risk in their current direction"}`,
          },
        ],
        1400
      );
      await saveAssessment({ ...result, fp, at: Date.now() });
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
            A synthesis of your written profile, inspo board, and closet — including where they disagree.
          </p>
          {stale && !assessBusy && (
            <div style={{ fontFamily: mono, fontSize: 11, color: T.tobacco, marginBottom: 10, animation: "rise .3s ease" }}>
              Your profile or inspo changed since this assessment.
            </div>
          )}
          <Btn onClick={runAssessment} disabled={assessBusy}>
            {assessBusy ? "Assessing…" : assessment ? "Update assessment" : "Run assessment"}
          </Btn>
          {assessBusy && <Thinking label="Reading between your pieces…" />}
          {assessment ? (
            <div
              style={{
                background: T.card,
                border: `1px solid ${stale ? T.tobacco : T.line}`,
                borderRadius: 10,
                padding: "18px 16px",
                marginTop: 16,
                animation: "rise .3s ease",
              }}
            >
              <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.2em", color: T.tobacco }}>THE READ</div>
              <div style={{ fontFamily: serif, fontSize: 30, margin: "4px 0 10px" }}>{assessment.headline}</div>
              <p style={{ fontSize: 14, lineHeight: 1.65, color: T.stone, margin: "0 0 14px" }}>{assessment.read}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
                {(assessment.pillars || []).map((p, i) => (
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
              {assessment.blind_spot && (
                <div style={{ fontSize: 13, lineHeight: 1.55, color: T.stone, borderLeft: `2px solid ${T.olive}`, paddingLeft: 10 }}>
                  <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: "0.15em", color: T.olive }}>BLIND SPOT: </span>
                  {assessment.blind_spot}
                </div>
              )}
            </div>
          ) : !assessBusy ? (
            <div style={{ padding: "48px 12px", textAlign: "center" }}>
              <div style={{ fontFamily: serif, fontSize: 22, color: T.stone }}>No assessment yet.</div>
              <div style={{ fontSize: 13, color: T.faint, marginTop: 8, lineHeight: 1.6 }}>
                Fill in your style profile and run the assessment to get your style identity.
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
        </div>
      )}
    </div>
  );
}
