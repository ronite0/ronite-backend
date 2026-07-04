import "dotenv/config";
import { initSchema } from "./db.js";
import { startIndexer } from "./indexer.js";
import { createServer } from "./server.js";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!process.env.RONITEFUN_FACTORY_ADDRESS) throw new Error("RONITEFUN_FACTORY_ADDRESS is not set");

  await initSchema();
  startIndexer();

  const app = createServer();
  const port = process.env.PORT || 8080;
  app.listen(port, () => console.log(`[server] listening on :${port}`));
}

main().catch(err => {
  console.error("fatal:", err);
  process.exit(1);
});
