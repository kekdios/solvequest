import { useCallback, useEffect, useState, type CSSProperties } from "react";

const SLOT_COUNT = 6;

type Props = {
  isDemo: boolean;
  /** JWT session present (email account). */
  signedIn: boolean;
  onGoAuth: () => void;
  onGoTrade: () => void;
  onRefreshAccount: () => void;
};

const panel: CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "8px 0 32px",
};

const neonCard: CSSProperties = {
  borderRadius: 16,
  border: "1px solid color-mix(in srgb, var(--accent) 45%, var(--border))",
  background:
    "linear-gradient(165deg, color-mix(in srgb, var(--accent) 8%, var(--panel)) 0%, var(--panel) 100%)",
  padding: "24px 20px",
  boxShadow: "0 0 0 1px color-mix(in srgb, var(--accent) 12%, transparent), 0 20px 48px color-mix(in srgb, #000 35%, transparent)",
};

const slotRow: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(6, 1fr)",
  gap: 8,
  marginBottom: 20,
};

const slotBox = (filled: boolean): CSSProperties => ({
  minHeight: 44,
  borderRadius: 10,
  border: `2px dashed ${filled ? "color-mix(in srgb, var(--accent) 55%, var(--border))" : "var(--border)"}`,
  background: filled ? "color-mix(in srgb, var(--accent) 12%, var(--bg))" : "color-mix(in srgb, var(--bg) 80%, transparent)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 11,
  fontWeight: 650,
  textAlign: "center",
  padding: "6px 4px",
  wordBreak: "break-word",
  color: "var(--text)",
});

const chip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 12px",
  borderRadius: 999,
  border: "1px solid color-mix(in srgb, var(--accent) 40%, var(--border))",
  background: "color-mix(in srgb, var(--accent) 14%, var(--panel))",
  fontSize: 13,
  fontWeight: 650,
  cursor: "grab",
  userSelect: "none",
  touchAction: "none",
};

const bankWrap: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
  marginTop: 12,
  minHeight: 56,
};

const btnPrimary: CSSProperties = {
  appearance: "none",
  border: "none",
  borderRadius: 999,
  padding: "12px 22px",
  fontWeight: 700,
  fontSize: "0.95rem",
  cursor: "pointer",
  background: "linear-gradient(145deg, #34d399 0%, #059669 100%)",
  color: "#052e1f",
};

const btnGhost: CSSProperties = {
  appearance: "none",
  border: "1px solid var(--border)",
  borderRadius: 999,
  padding: "10px 18px",
  fontWeight: 600,
  fontSize: "0.9rem",
  cursor: "pointer",
  background: "transparent",
  color: "var(--text)",
};

export default function AgentPuzzleScreen({ isDemo, signedIn, onGoAuth, onGoTrade, onRefreshAccount }: Props) {
  const [status, setStatus] = useState<{ earned: number; remaining: number; cap: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [puzzleId, setPuzzleId] = useState<string | null>(null);
  const [bank, setBank] = useState<string[]>([]);
  const [slots, setSlots] = useState<(string | null)[]>(() => Array(SLOT_COUNT).fill(null));
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [dragEvents, setDragEvents] = useState(0);
  const [success, setSuccess] = useState<{ qusd: number } | null>(null);
  const [celebrate, setCelebrate] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/puzzle/status", { credentials: "include" });
      if (!r.ok) return;
      const j = (await r.json()) as { earned_today: number; remaining_today: number; daily_cap: number };
      setStatus({ earned: j.earned_today, remaining: j.remaining_today, cap: j.daily_cap });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const bumpDrag = () => setDragEvents((n) => n + 1);

  const startPuzzle = async () => {
    setErr(null);
    setSuccess(null);
    setCelebrate(false);
    setLoading(true);
    try {
      const r = await fetch("/api/puzzle/start", { method: "POST", credentials: "include" });
      const j = (await r.json()) as { puzzle_id?: string; words?: string[]; error?: string; message?: string };
      if (!r.ok) {
        setErr(j.message ?? j.error ?? "Could not start puzzle.");
        return;
      }
      setPuzzleId(j.puzzle_id ?? null);
      setBank([...(j.words ?? [])]);
      setSlots(Array(SLOT_COUNT).fill(null));
      setStartedAt(Date.now());
      setDragEvents(0);
    } catch {
      setErr("Network error.");
    } finally {
      setLoading(false);
    }
  };

  const placeInFirstEmpty = (word: string) => {
    const i = slots.findIndex((s) => s == null);
    if (i < 0) return;
    setSlots((s) => {
      const next = [...s];
      next[i] = word;
      return next;
    });
    setBank((b) => b.filter((w) => w !== word));
    bumpDrag();
  };

  const dropOnSlot = (slotIndex: number, word: string) => {
    const prev = slots[slotIndex];
    setSlots((s) => {
      const next = [...s];
      next[slotIndex] = word;
      return next;
    });
    setBank((b) => {
      let nb = b.filter((w) => w !== word);
      if (prev && prev !== word) nb = [...nb, prev];
      return nb;
    });
    bumpDrag();
  };

  const clearSlot = (slotIndex: number) => {
    const w = slots[slotIndex];
    if (!w) return;
    setSlots((s) => {
      const next = [...s];
      next[slotIndex] = null;
      return next;
    });
    setBank((b) => [...b, w]);
    bumpDrag();
  };

  const onSubmit = async () => {
    if (!puzzleId || !startedAt) return;
    if (slots.some((s) => s == null)) {
      setErr("Place all 6 words in order (left → right).");
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const elapsed_ms = Date.now() - startedAt;
      const r = await fetch("/api/puzzle/submit", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          puzzle_id: puzzleId,
          ordered_words: slots as string[],
          elapsed_ms,
          drag_events: dragEvents,
        }),
      });
      const j = (await r.json()) as {
        ok?: boolean;
        qusd_credited?: number;
        error?: string;
        message?: string;
      };
      if (!r.ok) {
        if (j.error === "wrong_order") setErr("Not quite — reorder the phrase and try again.");
        else if (j.error === "daily_cap") setErr("You’ve reached today’s puzzle QUSD cap. Come back tomorrow.");
        else if (j.error === "expired") setErr("Session expired. Start a new puzzle.");
        else setErr(j.message ?? j.error ?? "Submit failed.");
        return;
      }
      setSuccess({ qusd: Number(j.qusd_credited) || 0 });
      setCelebrate(true);
      setPuzzleId(null);
      setBank([]);
      setSlots(Array(SLOT_COUNT).fill(null));
      setStartedAt(null);
      void loadStatus();
      void onRefreshAccount();
      window.setTimeout(() => setCelebrate(false), 3200);
    } catch {
      setErr("Network error.");
    } finally {
      setLoading(false);
    }
  };

  if (isDemo) {
    return (
      <div style={panel}>
        <div style={neonCard}>
          <h2 style={{ margin: "0 0 12px", fontSize: "1.35rem" }}>Agent Activation Protocol</h2>
          <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.6 }}>
            The puzzle reward credits real QUSD on your server account. Exit Demo and{" "}
            <button
              type="button"
              style={{
                background: "none",
                border: "none",
                color: "var(--accent)",
                cursor: "pointer",
                textDecoration: "underline",
                padding: 0,
                font: "inherit",
              }}
              onClick={onGoAuth}
            >
              sign in with email
            </button>{" "}
            to play.
          </p>
        </div>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div style={panel}>
        <div style={neonCard}>
          <h2 style={{ margin: "0 0 12px", fontSize: "1.35rem" }}>Agent Activation Protocol</h2>
          <p style={{ margin: "0 0 14px", color: "var(--muted)", lineHeight: 1.6 }}>
            Sign in to solve the daily BIP39 order puzzle and earn bonus QUSD (subject to a daily cap).
          </p>
          <button type="button" style={btnPrimary} onClick={onGoAuth}>
            Login / Register
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={panel}>
      {celebrate ? (
        <div
          aria-hidden
          style={{
            pointerEvents: "none",
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background:
              "radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--accent) 25%, transparent), transparent 55%)",
            animation: "puzzleGlow 2.8s ease-out forwards",
          }}
        />
      ) : null}
      <style>{`
        @keyframes puzzleGlow {
          0% { opacity: 0; }
          20% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>

      <div style={neonCard}>
        <p style={{ margin: "0 0 6px", fontSize: 12, letterSpacing: "0.12em", color: "var(--accent)", fontWeight: 700 }}>
          AGENT ACTIVATION PROTOCOL
        </p>
        <h2 style={{ margin: "0 0 10px", fontSize: "1.5rem", lineHeight: 1.2 }}>Restore the phrase</h2>
        <p style={{ margin: "0 0 18px", fontSize: 14, color: "var(--muted)", lineHeight: 1.55 }}>
          Drag six BIP39 words into the correct order (left to right). This is a memory puzzle — not your real wallet
          seed. Fast, clean solves earn a time bonus. Daily puzzle QUSD cap applies.
        </p>

        {status ? (
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--muted)" }}>
            Today: <strong style={{ color: "var(--text)" }}>{status.earned.toFixed(0)}</strong> / {status.cap} QUSD from
            puzzles · <strong style={{ color: "var(--text)" }}>{status.remaining.toFixed(0)}</strong> QUSD remaining
          </p>
        ) : null}

        {success ? (
          <div
            role="status"
            style={{
              marginBottom: 16,
              padding: 14,
              borderRadius: 12,
              border: "1px solid color-mix(in srgb, var(--accent) 40%, var(--border))",
              background: "color-mix(in srgb, var(--accent) 10%, var(--bg))",
            }}
          >
            <strong>Activated.</strong> +{success.qusd.toFixed(0)} QUSD credited to your ledger.
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10 }}>
              <button type="button" style={btnPrimary} onClick={onGoTrade}>
                Go to Trade
              </button>
              <button type="button" style={btnGhost} onClick={() => setSuccess(null)}>
                Solve another
              </button>
            </div>
          </div>
        ) : null}

        {err ? (
          <p role="alert" style={{ color: "var(--warn)", margin: "0 0 12px", fontSize: 14 }}>
            {err}
          </p>
        ) : null}

        {!puzzleId ? (
          <button type="button" style={btnPrimary} disabled={loading} onClick={() => void startPuzzle()}>
            {loading ? "Starting…" : "Begin sequence"}
          </button>
        ) : (
          <>
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--muted)" }}>
              Build the phrase — slot 1 is leftmost. Tap a chip twice to auto-place, or drag.
            </p>
            <div style={slotRow}>
              {slots.map((w, i) => (
                <div
                  key={`slot-${i}`}
                  role="button"
                  tabIndex={0}
                  style={slotBox(Boolean(w))}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const text = e.dataTransfer.getData("text/plain");
                    if (text) dropOnSlot(i, text);
                  }}
                  onClick={() => (w ? clearSlot(i) : undefined)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") w && clearSlot(i);
                  }}
                  title={w ? "Click to return word to bank" : "Drop a word here"}
                >
                  {w ?? i + 1}
                </div>
              ))}
            </div>

            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>Word bank</div>
            <div style={bankWrap}>
              {bank.map((w) => (
                <div
                  key={w}
                  draggable
                  style={chip}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", w);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDoubleClick={() => placeInFirstEmpty(w)}
                >
                  {w}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 22 }}>
              <button type="button" style={btnPrimary} disabled={loading} onClick={() => void onSubmit()}>
                {loading ? "Verifying…" : "Submit phrase"}
              </button>
              <button
                type="button"
                style={btnGhost}
                disabled={loading}
                onClick={() => {
                  setPuzzleId(null);
                  setBank([]);
                  setSlots(Array(SLOT_COUNT).fill(null));
                  setStartedAt(null);
                  setErr(null);
                }}
              >
                Abort
              </button>
            </div>
          </>
        )}
      </div>

      <p style={{ marginTop: 20, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
        Tip: wrong order doesn’t burn your daily cap — only successful solves credit QUSD. Abuse may affect eligibility for
        leaderboard prizes per Terms.
      </p>
    </div>
  );
}
