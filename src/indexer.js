import { pool } from "./db.js";
import { provider, factoryContract, curveContract } from "./chain.js";

const CHUNK_BLOCKS = Number(process.env.LOG_CHUNK_BLOCKS || 5000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 6000);
const DEPLOY_BLOCK = Number(process.env.RONITEFUN_FACTORY_DEPLOY_BLOCK || 0);

async function getLastBlock() {
  const { rows } = await pool.query("select last_block from indexer_state where id = 1");
  const stored = rows[0] ? Number(rows[0].last_block) : 0;
  return Math.max(stored, DEPLOY_BLOCK - 1);
}

async function setLastBlock(n) {
  await pool.query("update indexer_state set last_block = $1 where id = 1", [n]);
}

async function upsertToken(row) {
  await pool.query(
    `insert into tokens (address, curve_address, creator, name, symbol, image_uri, created_at)
     values (lower($1), lower($2), lower($3), $4, $5, $6, $7)
     on conflict (address) do nothing`,
    [row.address, row.curveAddress, row.creator, row.name, row.symbol, row.imageUri, row.createdAt]
  );
}

async function markMigrated(curveAddress, dexPool) {
  await pool.query(
    `update tokens set migrated = true, dex_pool = lower($2), updated_at = now() where curve_address = lower($1)`,
    [curveAddress, dexPool]
  );
}

async function insertTrade(t) {
  await pool.query(
    `insert into trades
       (curve_address, trader, is_buy, ron_amount, token_amount, price_ron, timestamp, tx_hash, log_index, block_number)
     values (lower($1), lower($2), $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (tx_hash, log_index) do nothing`,
    [t.curveAddress, t.trader, t.isBuy, t.ronAmount, t.tokenAmount, t.priceRon, t.timestamp, t.txHash, t.logIndex, t.blockNumber]
  );
}

async function getKnownCurveAddresses() {
  const { rows } = await pool.query("select curve_address from tokens");
  return rows.map(r => r.curve_address);
}

async function scanRange(fromBlock, toBlock) {
  const factory = factoryContract();

  // 1. Any tokens launched in this block range.
  const createdEvents = await factory.queryFilter(factory.filters.TokenCreated(), fromBlock, toBlock);
  for (const ev of createdEvents) {
    const [token, curve, creator, name, symbol, imageUri, timestamp] = ev.args;
    await upsertToken({
      address: token, curveAddress: curve, creator, name, symbol, imageUri,
      createdAt: Number(timestamp),
    });
    console.log(`[indexer] new token ${symbol} (${token}) curve=${curve}`);
  }

  // 2. Trade + Migrated events for every curve we know about (including the
  // ones just discovered above, since they can trade in the same range).
  const curves = await getKnownCurveAddresses();
  for (const curveAddress of curves) {
    const curve = curveContract(curveAddress);

    const trades = await curve.queryFilter(curve.filters.Trade(), fromBlock, toBlock);
    for (const ev of trades) {
      const [trader, isBuy, ronAmount, tokenAmount, newPriceRon, timestamp] = ev.args;
      await insertTrade({
        curveAddress, trader, isBuy,
        ronAmount: ronAmount.toString(),
        tokenAmount: tokenAmount.toString(),
        priceRon: Number(newPriceRon) / 1e18,
        timestamp: Number(timestamp),
        txHash: ev.transactionHash,
        logIndex: ev.index ?? ev.logIndex ?? 0,
        blockNumber: ev.blockNumber,
      });
    }

    const migrations = await curve.queryFilter(curve.filters.Migrated(), fromBlock, toBlock);
    for (const ev of migrations) {
      const [dexPool] = ev.args;
      await markMigrated(curveAddress, dexPool);
      console.log(`[indexer] curve ${curveAddress} migrated -> ${dexPool}`);
    }
  }
}

async function tick() {
  const latest = await provider.getBlockNumber();
  let from = (await getLastBlock()) + 1;
  if (from > latest) return;

  const totalBlocks = latest - from + 1;
  console.log(`[indexer] catching up: ${from} -> ${latest} (${totalBlocks} blocks)`);

  let scanned = 0;
  while (from <= latest) {
    const to = Math.min(from + CHUNK_BLOCKS - 1, latest);
    try {
      await scanRange(from, to);
      await setLastBlock(to);
      scanned += to - from + 1;
      console.log(`[indexer] progress: block ${to} (${((scanned / totalBlocks) * 100).toFixed(1)}%)`);
    } catch (err) {
      console.error(`[indexer] scan [${from},${to}] failed:`, err.message);
      break; // leave last_block where it was — retry this same range next tick
    }
    from = to + 1;
  }
}

export function startIndexer() {
  console.log("[indexer] starting…");
  tick().catch(err => console.error("[indexer] initial tick failed:", err));
  setInterval(() => {
    tick().catch(err => console.error("[indexer] tick failed:", err));
  }, POLL_INTERVAL_MS);
}
