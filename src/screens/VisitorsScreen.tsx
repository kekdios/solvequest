import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useSessionAuth } from "../auth/sessionAuth";
import { uiBtnGhost } from "../ui/appSurface";

type VisitorRow = {
  id: number;
  created_at: number;
  ip: string;
  location: string;
  path: string;
};

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Local time: dd-mmm-yy hh:mm (e.g. 14-Apr-26 15:30). */
function fmtVisitorTs(ms: number): string {
  const d = new Date(ms);
  const day = String(d.getDate()).padStart(2, "0");
  const mon = MON[d.getMonth()]!;
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${day}-${mon}-${yy} ${hh}:${min}`;
}

export default function VisitorsScreen() {
  const { authLoading, user, refreshUser } = useSessionAuth();
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<VisitorRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (p: number) => {
      if (authLoading || !user) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        let r = await fetch(`/api/admin/visitors?page=${p}`, { credentials: "include" });
        if (r.status === 401) {
          await refreshUser();
          r = await fetch(`/api/admin/visitors?page=${p}`, { credentials: "include" });
        }
        if (r.status === 403) {
          setError("You do not have access to this page.");
          setRows([]);
          setTotal(0);
          return;
        }
        if (!r.ok) {
          setError(r.status === 401 ? "Sign in required." : "Could not load visitors.");
          setRows([]);
          setTotal(0);
          return;
        }
        const data = (await r.json()) as {
          rows?: VisitorRow[];
          total?: number;
          page?: number;
          page_size?: number;
        };
        setRows(data.rows ?? []);
        setTotal(Number(data.total) || 0);
        setPage(Number(data.page) || p);
      } catch {
        setError("Network error.");
        setRows([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [authLoading, user, refreshUser],
  );

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="app-page" style={s.wrap}>
      {error ? (
        <p role="alert" style={{ color: "var(--danger)", marginBottom: 12 }}>
          {error}
        </p>
      ) : null}
      {loading && rows.length === 0 ? (
        <p style={{ color: "var(--muted)" }}>Loading…</p>
      ) : (
        <div className="app-table-scroll">
          <table className="data-table" style={{ width: "100%", minWidth: 480, fontSize: 13 }}>
            <thead>
              <tr>
                <th>Date / time</th>
                <th>IP</th>
                <th>Location</th>
                <th>Page</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="mono">{fmtVisitorTs(row.created_at)}</td>
                  <td className="mono">{row.ip}</td>
                  <td style={{ wordBreak: "break-word" }}>{row.location}</td>
                  <td className="mono" style={{ wordBreak: "break-all" }}>
                    {row.path}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length === 0 && !loading && !error ? (
        <p style={{ color: "var(--muted)", marginTop: 12 }}>No visits recorded yet.</p>
      ) : null}

      {total > 0 ? (
        <div style={s.pager}>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>
            Page {page} of {totalPages} · {total} total
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              style={{ ...uiBtnGhost, opacity: page <= 1 ? 0.45 : 1 }}
              disabled={page <= 1 || loading}
              onClick={() => setPage((x) => Math.max(1, x - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              style={{ ...uiBtnGhost, opacity: page >= totalPages ? 0.45 : 1 }}
              disabled={page >= totalPages || loading}
              onClick={() => setPage((x) => x + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const s: Record<string, CSSProperties> = {
  wrap: { maxWidth: 960, margin: "0 auto" },
  pager: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 20,
  },
};
