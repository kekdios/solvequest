import { useState, type CSSProperties } from "react";
import { useSessionAuth } from "../auth/sessionAuth";
import { uiBtnGhost, uiBtnPrimary, uiInput, uiOrderCard, uiPageH2 } from "../ui/appSurface";

type Props = {
  onSuccess: () => void;
  onContinueDemo: () => void;
};

export default function AuthScreen({ onSuccess, onContinueDemo }: Props) {
  const { sendOtp, verifyOtp } = useSessionAuth();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [step, setStep] = useState<"email" | "otp">("email");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleSendOtp = async () => {
    if (!email.includes("@")) {
      setLocalError("Enter a valid email address.");
      return;
    }
    setLocalError(null);
    setInfo(null);
    setSending(true);
    try {
      await sendOtp(email.trim().toLowerCase());
      setStep("otp");
      setInfo("Verification code sent. Check your inbox.");
    } catch (e: unknown) {
      setLocalError(e instanceof Error ? e.message : "Could not send code");
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async () => {
    if (otp.length !== 6 || !/^\d+$/.test(otp)) {
      setLocalError("Enter the 6-digit code.");
      return;
    }
    setLocalError(null);
    setInfo(null);
    setVerifying(true);
    try {
      await verifyOtp(email.trim().toLowerCase(), otp, rememberMe);
      onSuccess();
    } catch (e: unknown) {
      setLocalError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = () => {
    setOtp("");
    setStep("email");
    setInfo(null);
    setLocalError(null);
  };

  return (
    <div className="app-page" style={s.wrap}>
      <section style={s.card} aria-labelledby="auth-title">
        <h2 id="auth-title" style={s.h2}>
          {step === "email" ? "Sign in or register" : "Enter verification code"}
        </h2>
        <p style={s.lead}>
          {step === "email"
            ? "We’ll email you a one-time code. New and returning users use the same flow."
            : `We sent a code to ${email}`}
        </p>

        {info ? <p style={s.info}>{info}</p> : null}
        {localError ? (
          <p style={s.err} role="alert">
            {localError}
          </p>
        ) : null}

        {step === "email" ? (
          <>
            <label style={s.label}>
              Email
              <input
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value.toLowerCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && email.includes("@") && !sending) void handleSendOtp();
                }}
                style={s.input}
                disabled={sending}
              />
            </label>
            <button
              type="button"
              style={s.btnPrimary}
              disabled={!email.includes("@") || sending}
              onClick={() => void handleSendOtp()}
            >
              {sending ? "Sending…" : "Send code"}
            </button>
          </>
        ) : (
          <>
            <label style={s.label}>
              6-digit code
              <input
                type="text"
                name="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && otp.length === 6 && !verifying) void handleVerify();
                }}
                style={{ ...s.input, letterSpacing: "0.2em", fontSize: 18 }}
                className="mono"
                disabled={verifying}
              />
            </label>

            <label style={s.checkRow}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              <span>Remember me for 7 days</span>
            </label>

            <div style={s.row}>
              <button
                type="button"
                style={s.btnPrimary}
                disabled={otp.length !== 6 || verifying}
                onClick={() => void handleVerify()}
              >
                {verifying ? "Verifying…" : "Verify & sign in"}
              </button>
              <button type="button" style={s.btnGhost} disabled={verifying} onClick={handleResend}>
                Change email
              </button>
            </div>
          </>
        )}

        <p style={s.hint}>
          Codes expire in 10 minutes. By continuing you agree we contact you at this email for sign-in only.
        </p>
        <button type="button" style={s.linkBtn} onClick={onContinueDemo}>
          Continue without signing in (demo)
        </button>
      </section>
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: { maxWidth: 480 },
  card: {
    ...uiOrderCard,
    padding: "24px 22px",
  },
  h2: { ...uiPageH2, margin: "0 0 8px" },
  lead: { margin: "0 0 16px", fontSize: 14, lineHeight: 1.55, color: "var(--muted)" },
  info: { margin: "0 0 12px", fontSize: 13, color: "var(--ok)" },
  err: { margin: "0 0 12px", fontSize: 14, color: "#f87171" },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    marginBottom: 16,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    color: "var(--muted)",
  },
  input: {
    ...uiInput,
    textTransform: "none",
    letterSpacing: "normal",
    fontWeight: 400,
    fontSize: 15,
  },
  btnPrimary: {
    ...uiBtnPrimary,
    width: "100%",
    marginBottom: 12,
    padding: "12px 16px",
    fontSize: 15,
  },
  btnGhost: {
    ...uiBtnGhost,
    padding: "10px 14px",
  },
  checkRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    fontSize: 13,
    lineHeight: 1.45,
    color: "var(--muted)",
    marginBottom: 16,
    cursor: "pointer",
  },
  row: {
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
    alignItems: "center",
  },
  hint: { margin: "16px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 },
  linkBtn: {
    display: "block",
    marginTop: 16,
    width: "100%",
    background: "transparent",
    border: "none",
    color: "var(--accent)",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: "underline",
    textUnderlineOffset: 3,
  },
};
