/**
 * Public prize pool display: `GET /api/prize/config` — `PRIZE_AMOUNT` from env.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect } from "vite";

function parseEnvNumber(raw: string | undefined, fallback: number): number {
  const n = Number.parseFloat((raw ?? "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function createPrizeConfigApiMiddleware(env: Record<string, string>): Connect.NextHandleFunction {
  return (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const url = req.url?.split("?")[0] ?? "";
    if (req.method !== "GET" || url !== "/api/prize/config") {
      next();
      return;
    }
    const prizeAmount = parseEnvNumber(env.PRIZE_AMOUNT, 0);
    sendJson(res, 200, { prize_amount: prizeAmount });
  };
}
