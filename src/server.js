import express from "express";
import cors from "cors";
import { pool } from "./db.js";

export function createServer() {
  const app = express();
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? "*" }));
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ ok: true }));

  // Everything the token grid (RoniteFunTradePage) needs, precomputed —
  // no more crawling getAllTokens() + per-token RPC calls on every load.
  app.get("/tokens", async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        `select address, curve_address as "curveAddress", creator, name, symbol,
                image_uri as "imageUri", description, twitter, telegram, website,
                created_at as "createdAt", migrated, dex_pool as "dexPool"
         from tokens
         order by created_at desc`
      );
      res.json(rows);
    } catch (err) { next(err); }
  });

  app.get("/tokens/:address", async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        `select address, curve_address as "curveAddress", creator, name, symbol,
                image_uri as "imageUri", description, twitter, telegram, website,
                created_at as "createdAt", migrated, dex_pool as "dexPool"
         from tokens where address = lower($1)`,
        [req.params.address]
      );
      if (rows.length === 0) return res.status(404).json({ error: "not found" });
      res.json(rows[0]);
    } catch (err) { next(err); }
  });

  // Off-chain metadata (description/socials) — the contract only stores
  // name/symbol/imageUri on-chain, so this is how the socials the creator
  // types into RoniteFunCreateModal get attached to the token for everyone,
  // not just persisted in the creator's own browser localStorage.
  //
  // NOTE: there's no signature/ownership check here yet — anyone can call
  // this for any address. Fine to ship while ronite.fun is small, but add
  // a "sign a message with your wallet" check before this matters.
  app.patch("/tokens/:address/metadata", async (req, res, next) => {
    try {
      const { description = "", twitter = "", telegram = "", website = "" } = req.body ?? {};
      const { rowCount } = await pool.query(
        `update tokens set description=$2, twitter=$3, telegram=$4, website=$5, updated_at=now()
         where address = lower($1)`,
        [req.params.address, description, twitter, telegram, website]
      );
      if (rowCount === 0) return res.status(404).json({ error: "not found" });
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  // Trade history for a curve — this is the endpoint that replaces the
  // expensive on-chain block-scan usetokentrades.ts used to do. Shaped to
  // match CurveTrade exactly so the frontend hook barely has to change.
  // ?since=<unixSeconds> lets the frontend poll for just what's new.
  app.get("/curves/:curveAddress/trades", async (req, res, next) => {
    try {
      const since = req.query.since ? Number(req.query.since) : 0;
      const limit = Math.min(Number(req.query.limit) || 1000, 5000);
      const { rows } = await pool.query(
        `select trader, is_buy as "isBuy", ron_amount as "ronAmount", token_amount as "tokenAmount",
                price_ron as "priceRon", timestamp, tx_hash as "txHash"
         from trades
         where curve_address = lower($1) and timestamp > $2
         order by timestamp asc
         limit $3`,
        [req.params.curveAddress, since, limit]
      );
      res.json(rows);
    } catch (err) { next(err); }
  });

  app.use((err, _req, res, _next) => {
    console.error("[server]", err);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
