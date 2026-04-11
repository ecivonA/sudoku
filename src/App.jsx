import { useState, useCallback, useEffect, useRef } from "react";

// ── persistence helpers ───────────────────────────────────────────────────────

function serializeGrid(grid) {
  return grid.map(row => row.map(cell => ({
    value: cell.value,
    given: cell.given,
    candidates: [...cell.candidates],
    manualExcluded: [...cell.manualExcluded],
  })));
}

function deserializeGrid(data) {
  return data.map(row => row.map(cell => ({
    value: cell.value,
    given: cell.given,
    candidates: new Set(cell.candidates),
    manualExcluded: new Set(cell.manualExcluded),
  })));
}

function saveState(state) {
  try {
    const s = {
      phase: state.phase,
      grid: serializeGrid(state.grid),
      history: state.history.map(serializeGrid),
      bookmarks: state.bookmarks.map(bm => ({
        grid: serializeGrid(bm.grid),
        history: bm.history.map(serializeGrid),
        anchorCell: bm.anchorCell,
      })),
      showHints: state.showHints,
    };
    localStorage.setItem("sudoku_state", JSON.stringify(s));
  } catch(e) { /* quota exceeded etc */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem("sudoku_state");
    if (!raw) return null;
    const s = JSON.parse(raw);
    return {
      phase: s.phase,
      grid: deserializeGrid(s.grid),
      history: s.history.map(deserializeGrid),
      bookmarks: s.bookmarks.map(bm => ({
        grid: deserializeGrid(bm.grid),
        history: bm.history.map(deserializeGrid),
        anchorCell: bm.anchorCell,
      })),
      showHints: s.showHints ?? false,
    };
  } catch(e) { return null; }
}

// ── sudoku helpers ────────────────────────────────────────────────────────────

const allNine = () => new Set([1,2,3,4,5,6,7,8,9]);

function getBox(r, c) { return Math.floor(r/3)*3 + Math.floor(c/3); }

function getPeers(r, c) {
  const peers = new Set();
  for (let i = 0; i < 9; i++) {
    if (i !== c) peers.add(`${r},${i}`);
    if (i !== r) peers.add(`${i},${c}`);
  }
  const br = Math.floor(r/3)*3, bc = Math.floor(c/3)*3;
  for (let rr = br; rr < br+3; rr++)
    for (let cc = bc; cc < bc+3; cc++)
      if (rr !== r || cc !== c) peers.add(`${rr},${cc}`);
  return peers;
}

function recomputeCandidates(grid) {
  const next = grid.map(row => row.map(cell => ({
    ...cell,
    candidates: cell.value ? new Set() : allNine(),
    manualExcluded: new Set(cell.manualExcluded || []),
  })));
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const val = next[r][c].value;
      if (val) getPeers(r, c).forEach(key => {
        const [pr, pc] = key.split(",").map(Number);
        next[pr][pc].candidates.delete(val);
      });
    }
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      next[r][c].manualExcluded.forEach(n => next[r][c].candidates.delete(n));
  return next;
}

function checkErrors(grid) {
  const errs = new Set();
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      const val = grid[r][c].value;
      if (!val) continue;
      getPeers(r, c).forEach(key => {
        const [pr, pc] = key.split(",").map(Number);
        if (grid[pr][pc].value === val) { errs.add(`${r},${c}`); errs.add(key); }
      });
    }
  return errs;
}

function emptyGrid() {
  return Array.from({length:9}, () =>
    Array.from({length:9}, () => ({
      value: null, candidates: allNine(), manualExcluded: new Set(), given: false,
    }))
  );
}

function cloneGrid(grid) {
  return grid.map(row => row.map(cell => ({
    ...cell, candidates: new Set(cell.candidates), manualExcluded: new Set(cell.manualExcluded),
  })));
}

// compute hint level: 0=none, 1=singles exist, 2=only pairs
function computeHintCells(grid) {
  const singles = new Set(), pairs = new Set();
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) {
      if (grid[r][c].value) continue;
      const sz = grid[r][c].candidates.size;
      if (sz === 1) singles.add(`${r},${c}`);
      else if (sz === 2) pairs.add(`${r},${c}`);
    }
  return { singles, pairs, hasSingles: singles.size > 0 };
}

// ── colours ───────────────────────────────────────────────────────────────────

const GOLD   = "#c9a84c";
const DARK   = "#0d1b2a";
const MID    = "#1b2838";
const BLUE   = "#7eb8d4";
const GREEN  = "#5dbf8a";
const RED    = "#e06060";
const ORANGE = "#e07830";
const LILAC  = "#a889d4";

function btn(color, bg, extra = {}) {
  return {
    padding: "9px 6px", border: `1px solid ${color}77`,
    background: bg, color, borderRadius: "6px", cursor: "pointer",
    fontFamily: "Georgia,serif", fontSize: "clamp(0.6rem,1.7vw,0.78rem)",
    letterSpacing: "0.02em", transition: "all 0.15s", whiteSpace: "nowrap", ...extra,
  };
}

// ── tag icon SVG ──────────────────────────────────────────────────────────────

function TagIcon({ color = RED, size = 10 }) {
  return (
    <svg width={size} height={size*1.3} viewBox="0 0 10 13" fill="none">
      <path d="M1 1 h7 a1 1 0 0 1 1 1 v6 l-4 4 -4 -4 V2 a1 1 0 0 1 1 -1z"
        fill={color} fillOpacity="0.85" stroke={color} strokeWidth="0.5"/>
      <circle cx="7" cy="3.5" r="1" fill="white" fillOpacity="0.7"/>
    </svg>
  );
}

// ── component ─────────────────────────────────────────────────────────────────

const saved = loadState();

export default function SudokuApp() {
  const [phase,          setPhase]          = useState(saved?.phase      ?? "input");
  const [grid,           setGrid]           = useState(saved?.grid       ?? emptyGrid);
  const [selected,       setSelected]       = useState(null);
  const [history,        setHistory]        = useState(saved?.history    ?? []);
  const [bookmarks,      setBookmarks]      = useState(saved?.bookmarks  ?? []);
  const [errors,         setErrors]         = useState(() => saved ? checkErrors(saved.grid) : new Set());
  const [candidateMode,  setCandidateMode]  = useState(false);
  const [showHints,      setShowHints]      = useState(saved?.showHints  ?? false);
  const [resetConfirm,   setResetConfirm]   = useState(false);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const containerRef = useRef(null);

  // ── persist on every relevant change ─────────────────────────────────────

  useEffect(() => {
    saveState({ phase, grid, history, bookmarks, showHints });
  }, [phase, grid, history, bookmarks, showHints]);

  // ── helpers ───────────────────────────────────────────────────────────────

  const commit = useCallback((newGrid, prevGrid) => {
    setHistory(h => [...h, prevGrid]);
    setGrid(newGrid);
    setErrors(checkErrors(newGrid));
  }, []);

  const resetFlags = () => { setResetConfirm(false); setRestoreConfirm(false); };

  // move selection, wrapping within grid
  const moveSelection = useCallback((dr, dc) => {
    setSelected(prev => {
      if (!prev) return [0, 0];
      const nr = Math.max(0, Math.min(8, prev[0] + dr));
      const nc = Math.max(0, Math.min(8, prev[1] + dc));
      return [nr, nc];
    });
  }, []);

  // advance to next empty cell (left→right, top→bottom)
  const advanceToNext = useCallback((fromR, fromC, currentGrid) => {
    for (let step = 1; step < 81; step++) {
      const idx = fromR*9 + fromC + step;
      if (idx >= 81) break;
      const r = Math.floor(idx/9), c = idx%9;
      if (!currentGrid[r][c].given) { setSelected([r, c]); return; }
    }
  }, []);

  // ── paste handler (Ctrl+V with 81-char sudoku string) ────────────────────

  useEffect(() => {
    const handlePaste = (e) => {
      const text = (e.clipboardData || window.clipboardData).getData("text").trim();
      if (!/^[0-9]{81}$/.test(text)) return;
      e.preventDefault();
      const next = emptyGrid();
      for (let i = 0; i < 81; i++) {
        const val = parseInt(text[i]);
        const r = Math.floor(i/9), c = i%9;
        if (val >= 1 && val <= 9) { next[r][c].value = val; next[r][c].given = true; }
      }
      const computed = recomputeCandidates(next);
      setGrid(computed); setPhase("input"); setHistory([]); setBookmarks([]);
      setErrors(new Set()); setSelected([0,0]); setCandidateMode(false);
      setResetConfirm(false); setRestoreConfirm(false);
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  // ── keyboard handler ──────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e) => {
      // don't hijack browser shortcuts
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // arrow keys
      if (e.key === "ArrowUp")    { e.preventDefault(); moveSelection(-1,  0); return; }
      if (e.key === "ArrowDown")  { e.preventDefault(); moveSelection( 1,  0); return; }
      if (e.key === "ArrowLeft")  { e.preventDefault(); moveSelection( 0, -1); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); moveSelection( 0,  1); return; }

      // tab → move right (or to start if no selection)
      if (e.key === "Tab") {
        e.preventDefault();
        moveSelection(0, e.shiftKey ? -1 : 1);
        return;
      }

      // digit keys 1-9
      const digit = parseInt(e.key);
      if (digit >= 1 && digit <= 9) {
        // We need access to current selected — use functional pattern via a ref trick
        // Instead, dispatch a custom event carrying the digit
        window.dispatchEvent(new CustomEvent("sudoku-input", { detail: { num: digit } }));
        return;
      }

      // 0, space, backspace, delete → clear + advance
      if (e.key === "0" || e.key === " " || e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("sudoku-clear", { detail: { advance: e.key === "0" || e.key === " " } }));
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [moveSelection]);

  // listen to custom events (to avoid stale closure issues)
  useEffect(() => {
    const onInput = (e) => {
      const { num } = e.detail;
      setSelected(sel => {
        if (!sel) return sel;
        const [r, c] = sel;
        setGrid(g => {
          const cell = g[r][c];
          if (phase === "input") {
            if (cell.given) return g;
            const next = cloneGrid(g);
            next[r][c].value = cell.value === num ? null : num;
            // advance after input
            advanceToNext(r, c, next);
            return next;
          }
          if (!candidateMode) {
            if (cell.given) return g;
            const next = cloneGrid(g);
            next[r][c].value = cell.value === num ? null : num;
            if (next[r][c].value) next[r][c].manualExcluded = new Set();
            const recomp = recomputeCandidates(next);
            setHistory(h => [...h, g]);
            setErrors(checkErrors(recomp));
            advanceToNext(r, c, recomp);
            return recomp;
          } else {
            if (cell.value || cell.given) return g;
            if (!cell.candidates.has(num) && !cell.manualExcluded.has(num)) return g;
            const next = cloneGrid(g);
            const excl = next[r][c].manualExcluded;
            if (excl.has(num)) excl.delete(num);
            else { if (cell.candidates.size <= 1) return g; excl.add(num); }
            const recomp = recomputeCandidates(next);
            setHistory(h => [...h, g]);
            setErrors(checkErrors(recomp));
            return recomp;
          }
        });
        return sel;
      });
    };
    window.addEventListener("sudoku-input", onInput);
    return () => window.removeEventListener("sudoku-input", onInput);
  }, [phase, candidateMode, advanceToNext]);

  useEffect(() => {
    const onClear = (e) => {
      const { advance } = e.detail;
      setSelected(sel => {
        if (!sel) return sel;
        const [r, c] = sel;
        setGrid(g => {
          const cell = g[r][c];
          if (phase === "input") {
            if (cell.given) return g;
            const next = cloneGrid(g);
            next[r][c].value = null;
            if (advance) advanceToNext(r, c, next);
            return next;
          }
          if (cell.given) return g;
          const next = cloneGrid(g);
          next[r][c].value = null;
          next[r][c].manualExcluded = new Set();
          const recomp = recomputeCandidates(next);
          setHistory(h => [...h, g]);
          setErrors(checkErrors(recomp));
          if (advance) advanceToNext(r, c, recomp);
          return recomp;
        });
        return sel;
      });
    };
    window.addEventListener("sudoku-clear", onClear);
    return () => window.removeEventListener("sudoku-clear", onClear);
  }, [phase, advanceToNext]);

  // ── cell click ────────────────────────────────────────────────────────────

  const handleCellClick = (r, c) => {
    setSelected([r, c]);
    resetFlags();
    if (phase === "solve" && !candidateMode) {
      const cell = grid[r][c];
      if (!cell.value && !cell.given && cell.candidates.size === 1) {
        const only = [...cell.candidates][0];
        const next = cloneGrid(grid);
        next[r][c].value = only;
        commit(recomputeCandidates(next), grid);
      }
    }
  };

  // ── number pad click ──────────────────────────────────────────────────────

  const handleInput = useCallback((num) => {
    if (!selected) return;
    const [r, c] = selected;
    const cell = grid[r][c];
    if (phase === "input") {
      if (cell.given) return;
      const next = cloneGrid(grid);
      next[r][c].value = cell.value === num ? null : num;
      setGrid(next);
      advanceToNext(r, c, next);
      return;
    }
    if (!candidateMode) {
      if (cell.given) return;
      const next = cloneGrid(grid);
      next[r][c].value = cell.value === num ? null : num;
      if (next[r][c].value) next[r][c].manualExcluded = new Set();
      const recomp = recomputeCandidates(next);
      commit(recomp, grid);
      advanceToNext(r, c, recomp);
      return;
    }
    if (cell.value || cell.given) return;
    if (!cell.candidates.has(num) && !cell.manualExcluded.has(num)) return;
    const next = cloneGrid(grid);
    const excl = next[r][c].manualExcluded;
    if (excl.has(num)) excl.delete(num);
    else { if (cell.candidates.size <= 1) return; excl.add(num); }
    commit(recomputeCandidates(next), grid);
  }, [selected, grid, phase, candidateMode, commit, advanceToNext]);

  // ── clear ─────────────────────────────────────────────────────────────────

  const handleClear = () => {
    if (!selected) return;
    const [r, c] = selected;
    const cell = grid[r][c];
    if (phase === "input") {
      if (cell.given) return;
      const next = cloneGrid(grid); next[r][c].value = null; setGrid(next); return;
    }
    if (cell.given) return;
    const next = cloneGrid(grid);
    next[r][c].value = null; next[r][c].manualExcluded = new Set();
    commit(recomputeCandidates(next), grid);
  };

  // ── festsetzen ────────────────────────────────────────────────────────────

  const handleFestsetzen = () => {
    const next = cloneGrid(grid);
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        if (next[r][c].value) next[r][c].given = true;
    const computed = recomputeCandidates(next);
    setGrid(computed); setPhase("solve"); setHistory([]); setBookmarks([]);
    setErrors(new Set()); setSelected(null); setCandidateMode(false); resetFlags();
  };

  // ── zurücksetzen → back to input phase ───────────────────────────────────

  const handleReset = () => {
    if (!resetConfirm) { setResetConfirm(true); setRestoreConfirm(false); return; }
    const next = cloneGrid(grid);
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++) {
        if (!next[r][c].given) { next[r][c].value = null; next[r][c].manualExcluded = new Set(); }
        next[r][c].given = false; next[r][c].candidates = allNine();
      }
    setGrid(next); setPhase("input"); setHistory([]); setBookmarks([]);
    setErrors(new Set()); setSelected(null); setCandidateMode(false); resetFlags();
  };

  // ── neues spiel ───────────────────────────────────────────────────────────

  const handleNeuesSpiel = () => {
    setGrid(emptyGrid()); setPhase("input"); setHistory([]); setBookmarks([]);
    setErrors(new Set()); setSelected(null); setCandidateMode(false); resetFlags();
  };

  // ── undo ──────────────────────────────────────────────────────────────────

  const handleUndo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setGrid(prev); setHistory(h => h.slice(0,-1)); setErrors(checkErrors(prev));
  };

  // ── bookmark ──────────────────────────────────────────────────────────────

  const handleBookmark = () => {
    setBookmarks(bs => [...bs, {
      grid: cloneGrid(grid), history: [...history], anchorCell: null,
    }]);
    setRestoreConfirm(false);
  };

  const handleRestore = () => {
    if (bookmarks.length === 0) return;
    if (!restoreConfirm) { setRestoreConfirm(true); setResetConfirm(false); return; }
    const bm = bookmarks[bookmarks.length - 1];
    setGrid(cloneGrid(bm.grid)); setHistory([...bm.history]);
    setErrors(checkErrors(bm.grid)); setBookmarks(bs => bs.slice(0,-1));
    setRestoreConfirm(false);
  };

  // track first cell changed after a bookmark
  const prevGridRef = useRef(grid);
  useEffect(() => {
    if (bookmarks.length === 0) { prevGridRef.current = grid; return; }
    // check if the top bookmark has no anchor yet
    const topBM = bookmarks[bookmarks.length - 1];
    if (topBM.anchorCell !== null) { prevGridRef.current = grid; return; }
    // find first difference between bookmark grid and current grid
    const bmGrid = topBM.grid;
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        if (!bmGrid[r][c].value && grid[r][c].value) {
          setBookmarks(bs => bs.map((bm, i) =>
            i === bs.length-1 ? { ...bm, anchorCell: `${r},${c}` } : bm
          ));
          return;
        }
  }, [grid]);

  // ── derived ───────────────────────────────────────────────────────────────

  const isSel     = (r, c) => selected && selected[0] === r && selected[1] === c;
  const isGroup   = (r, c) => {
    if (!selected || phase === "input") return false;
    const [sr, sc] = selected;
    return (r === sr || c === sc || getBox(r,c) === getBox(sr,sc)) && !(r === sr && c === sc);
  };
  const isSameVal = (r, c) => {
    if (!selected || phase === "input") return false;
    const sv = grid[selected[0]][selected[1]].value;
    return sv && grid[r][c].value === sv && !(r === selected[0] && c === selected[1]);
  };

  const { singles, pairs, hasSingles } = computeHintCells(grid);
  const anchorCell = bookmarks.length > 0 ? bookmarks[bookmarks.length-1].anchorCell : null;
  const hasBM      = bookmarks.length > 0;
  const isComplete = phase === "solve" && grid.every(row => row.every(c => c.value)) && errors.size === 0;

  const padHighlight = (n) => {
    if (!selected) return "none";
    const cell = grid[selected[0]][selected[1]];
    if (cell.value) return "none";
    if (phase === "input") return "value";
    if (!candidateMode) return "value";
    if (cell.given) return "none";
    if (cell.manualExcluded.has(n)) return "restore";
    if (cell.candidates.has(n)) return "remove";
    return "impossible";
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      style={{
        minHeight: "100vh",
        background: `linear-gradient(160deg, ${DARK} 0%, #1b2838 60%, #0a1628 100%)`,
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", fontFamily: "Georgia,serif",
        padding: "10px", boxSizing: "border-box", outline: "none",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
        <h1 style={{
          color: GOLD, fontSize: "clamp(1.1rem,4vw,1.7rem)", letterSpacing: "0.5em",
          textTransform: "uppercase", margin: 0, fontWeight: "normal",
          textShadow: `0 0 20px ${GOLD}66`,
        }}>Sudoku</h1>
        <div style={{
          background: phase === "input" ? `${LILAC}22` : `${GREEN}18`,
          border: `1px solid ${phase === "input" ? LILAC : GREEN}77`,
          color: phase === "input" ? LILAC : GREEN,
          padding: "2px 10px", borderRadius: "12px", fontSize: "0.65rem", letterSpacing: "0.12em",
        }}>{phase === "input" ? "EINGABE" : "SPIEL"}</div>
        {hasBM && phase === "solve" && (
          <div style={{
            background: `${ORANGE}22`, border: `1px solid ${ORANGE}77`,
            color: ORANGE, padding: "2px 8px", borderRadius: "12px",
            fontSize: "0.65rem", display: "flex", alignItems: "center", gap: "4px",
          }}>
            <TagIcon color={ORANGE} size={9}/> {bookmarks.length}
          </div>
        )}
      </div>

      {phase === "input" && (
        <p style={{ color: `${LILAC}cc`, fontSize: "0.68rem", margin: "0 0 8px", letterSpacing: "0.06em", textAlign: "center" }}>
          Rätsel eingeben, dann „Festsetzen"
        </p>
      )}
      {phase === "solve" && candidateMode && (
        <div style={{
          background: `${BLUE}18`, border: `1px solid ${BLUE}55`, color: BLUE,
          padding: "2px 12px", borderRadius: "12px", fontSize: "0.66rem", marginBottom: "6px",
        }}>✏ Kandidaten-Modus aktiv</div>
      )}
      {isComplete && (
        <div style={{
          background: `${GREEN}22`, border: `1px solid ${GREEN}`, color: GREEN,
          padding: "5px 18px", borderRadius: "4px", marginBottom: "8px",
          letterSpacing: "0.2em", fontSize: "0.85rem",
        }}>✓ GELÖST!</div>
      )}

      {/* ── Grid ── */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(9,1fr)",
        border: `2px solid ${phase === "input" ? LILAC : GOLD}`,
        borderRadius: "4px", width: "min(92vw,430px)", aspectRatio: "1",
        overflow: "hidden", transition: "border-color 0.4s",
      }}>
        {grid.map((row, r) => row.map((cell, c) => {
          const key   = `${r},${c}`;
          const sel   = isSel(r, c);
          const grp   = isGroup(r, c);
          const smv   = isSameVal(r, c);
          const err   = errors.has(key);
          const isAnc = anchorCell === key;

          // hint highlighting
          const isSingle = showHints && phase === "solve" && !cell.value && singles.has(key);
          const isPair   = showHints && phase === "solve" && !cell.value && !hasSingles && pairs.has(key);

          let bg = MID;
          let fg = phase === "input" ? (cell.value ? LILAC : `${LILAC}22`) : (cell.given ? LILAC : BLUE);
          let candFg = "rgba(201,168,76,0.85)";
          let candExclFg = "rgba(201,168,76,0.22)";

          if (sel) {
            bg = phase === "input" ? `${LILAC}44` : GOLD;
            fg = phase === "input" ? "#fff" : DARK;
            candFg = `${DARK}cc`; candExclFg = `${DARK}44`;
          } else if (smv) {
            bg = "#5c3f7a"; fg = "#fff"; candFg = "rgba(255,255,255,0.75)";
          } else if (grp) {
            bg = "#253347"; fg = cell.given ? LILAC : "#9ecde0";
          }
          if (err && !sel) { bg = "#4a1010"; fg = "#ff8888"; }

          const bRight  = (c+1)%3===0 && c!==8;
          const bBottom = (r+1)%3===0 && r!==8;
          const borderColor = phase === "input" ? LILAC : GOLD;

          // hint ring via box-shadow
          let shadow = "none";
          if (isSingle) shadow = `inset 0 0 0 2px ${GREEN}, inset 0 0 6px ${GREEN}55`;
          else if (isPair) shadow = `inset 0 0 0 2px ${BLUE}99`;

          return (
            <div key={key} onClick={() => handleCellClick(r, c)} style={{
              background: bg,
              borderRight:  bRight  ? `2px solid ${borderColor}` : `1px solid ${borderColor}22`,
              borderBottom: bBottom ? `2px solid ${borderColor}` : `1px solid ${borderColor}22`,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", aspectRatio: "1", position: "relative",
              transition: "background 0.1s", boxSizing: "border-box",
              boxShadow: shadow,
            }}>
              {/* Bookmark anchor tag icon */}
              {isAnc && (
                <div style={{ position: "absolute", top: 1, right: 2, zIndex: 2, lineHeight: 0 }}>
                  <TagIcon color={RED} size={8}/>
                </div>
              )}

              {cell.value ? (
                <span style={{
                  fontSize: "clamp(1rem,3.8vw,1.6rem)", fontWeight: "bold",
                  color: fg, userSelect: "none",
                }}>{cell.value}</span>
              ) : phase === "solve" ? (
                <div style={{
                  display: "grid", gridTemplateColumns: "repeat(3,1fr)",
                  gridTemplateRows: "repeat(3,1fr)", width: "90%", height: "90%",
                }}>
                  {[1,2,3,4,5,6,7,8,9].map(n => {
                    const logicHas = cell.candidates.has(n);
                    const excluded = cell.manualExcluded.has(n);
                    const visible  = logicHas || excluded;
                    return (
                      <span key={n} style={{
                        fontSize: "clamp(0.3rem,0.95vw,0.5rem)",
                        color: !visible ? "transparent" : excluded ? candExclFg : candFg,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        userSelect: "none", lineHeight: 1, fontFamily: "monospace",
                        textDecoration: excluded ? "line-through" : "none",
                        fontWeight: logicHas && !excluded ? "bold" : "normal",
                      }}>{n}</span>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        }))}
      </div>

      {/* ── Number pad ── */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(9,1fr)",
        gap: "4px", marginTop: "10px", width: "min(92vw,430px)",
      }}>
        {[1,2,3,4,5,6,7,8,9].map(n => {
          const ph = padHighlight(n);
          let padBg = phase==="input" ? `${LILAC}12` : `${GOLD}10`;
          let padColor = phase==="input" ? LILAC : GOLD;
          if (ph==="remove")     { padBg=`${BLUE}18`;   padColor=BLUE; }
          if (ph==="restore")    { padBg=`${ORANGE}20`; padColor=ORANGE; }
          if (ph==="impossible") { padBg="transparent"; padColor=`${GOLD}22`; }
          return (
            <button key={n} onClick={() => handleInput(n)} style={{
              aspectRatio: "1", borderRadius: "6px", border: `1px solid ${padColor}55`,
              background: padBg, color: padColor,
              fontSize: "clamp(0.9rem,3vw,1.3rem)", fontWeight: "bold",
              cursor: ph==="impossible" ? "default" : "pointer",
              fontFamily: "Georgia,serif", transition: "all 0.12s",
            }}>{n}</button>
          );
        })}
      </div>

      {/* ── Phase 1 buttons ── */}
      {phase === "input" && (
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"6px", marginTop:"8px", width:"min(92vw,430px)" }}>
          <button onClick={handleClear} style={btn(LILAC,`${LILAC}12`)}
            onMouseEnter={e=>e.currentTarget.style.background=`${LILAC}28`}
            onMouseLeave={e=>e.currentTarget.style.background=`${LILAC}12`}>✕ Löschen</button>
          <button onClick={handleFestsetzen} style={btn(GREEN,`${GREEN}18`,{fontWeight:"bold"})}
            onMouseEnter={e=>e.currentTarget.style.background=`${GREEN}35`}
            onMouseLeave={e=>e.currentTarget.style.background=`${GREEN}18`}>✓ Festsetzen</button>
          <button onClick={handleNeuesSpiel} style={btn(RED,"rgba(200,100,100,0.1)")}
            onMouseEnter={e=>e.currentTarget.style.background=`${RED}28`}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(200,100,100,0.1)"}>⊕ Neues Spiel</button>
        </div>
      )}

      {/* ── Phase 2 buttons ── */}
      {phase === "solve" && (<>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"6px", marginTop:"8px", width:"min(92vw,430px)" }}>
          <button onClick={handleClear} style={btn(BLUE,`${BLUE}12`)}
            onMouseEnter={e=>e.currentTarget.style.background=`${BLUE}28`}
            onMouseLeave={e=>e.currentTarget.style.background=`${BLUE}12`}>✕ Löschen</button>
          <button onClick={handleUndo} disabled={history.length===0}
            style={{...btn(GOLD,`${GOLD}12`), opacity:history.length===0?0.3:1, cursor:history.length===0?"not-allowed":"pointer"}}
            onMouseEnter={e=>{if(history.length>0)e.currentTarget.style.background=`${GOLD}28`;}}
            onMouseLeave={e=>e.currentTarget.style.background=`${GOLD}12`}>↩ Rückgängig</button>
          <button onClick={()=>{setCandidateMode(m=>!m);resetFlags();}}
            style={btn(BLUE,candidateMode?`${BLUE}35`:`${BLUE}10`)}
            onMouseEnter={e=>e.currentTarget.style.background=`${BLUE}30`}
            onMouseLeave={e=>e.currentTarget.style.background=candidateMode?`${BLUE}35`:`${BLUE}10`}>
            {candidateMode?"✏ Kand. ✓":"✏ Kand."}</button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:"6px", marginTop:"6px", width:"min(92vw,430px)" }}>
          <button onClick={handleBookmark} style={btn(ORANGE,`${ORANGE}12`)}
            onMouseEnter={e=>e.currentTarget.style.background=`${ORANGE}28`}
            onMouseLeave={e=>e.currentTarget.style.background=`${ORANGE}12`}>🏷 Merker</button>
          <button onClick={handleRestore} disabled={!hasBM}
            style={{...btn(restoreConfirm?RED:ORANGE,restoreConfirm?`${RED}22`:`${ORANGE}12`), opacity:!hasBM?0.3:1, cursor:!hasBM?"not-allowed":"pointer"}}
            onMouseEnter={e=>{if(hasBM)e.currentTarget.style.background=`${RED}28`;}}
            onMouseLeave={e=>e.currentTarget.style.background=restoreConfirm?`${RED}22`:`${ORANGE}12`}>
            {restoreConfirm?"⚠ Sicher?":`⏮ Zurück${bookmarks.length>1?` (${bookmarks.length})`:""}`}</button>
          <button onClick={()=>setShowHints(h=>!h)}
            style={btn(showHints?GREEN:GOLD, showHints?`${GREEN}25`:`${GOLD}10`)}
            onMouseEnter={e=>e.currentTarget.style.background=showHints?`${GREEN}35`:`${GOLD}25`}
            onMouseLeave={e=>e.currentTarget.style.background=showHints?`${GREEN}25`:`${GOLD}10`}>
            {showHints?"💡 Ein":"💡 Aus"}</button>
          <button onClick={handleReset}
            style={btn(resetConfirm?RED:"#d07070", resetConfirm?`${RED}22`:"rgba(200,100,100,0.1)")}
            onMouseEnter={e=>e.currentTarget.style.background=`${RED}28`}
            onMouseLeave={e=>e.currentTarget.style.background=resetConfirm?`${RED}22`:"rgba(200,100,100,0.1)"}>
            {resetConfirm?"⚠ Sicher?":"↺ Reset"}</button>
        </div>
      </>)}

      {/* Legend + hint status */}
      {phase === "solve" && (
        <div style={{ display:"flex", gap:"12px", marginTop:"7px", fontSize:"0.6rem", letterSpacing:"0.05em", flexWrap:"wrap", justifyContent:"center" }}>
          <span style={{color:`${LILAC}99`}}>▪ Vorgabe</span>
          <span style={{color:`${BLUE}99`}}>▪ Lösung</span>
          {showHints && hasSingles && <span style={{color:`${GREEN}bb`}}>▪ Einer</span>}
          {showHints && !hasSingles && pairs.size>0 && <span style={{color:`${BLUE}88`}}>▪ Zweier</span>}
          {showHints && singles.size===0 && pairs.size===0 && <span style={{color:`${GOLD}66`}}>– keine Einer/Zweier</span>}
        </div>
      )}
    </div>
  );
}
