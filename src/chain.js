import { JsonRpcProvider, Contract } from "ethers";

export const provider = new JsonRpcProvider(
  process.env.RONIN_RPC_URL || "https://ronin.drpc.org",
  undefined,
  { staticNetwork: true }
);

// Only what the indexer actually reads/listens for — kept separate from the
// frontend's fuller lib/abi.ts so this service has no dependency on the
// frontend project at all.
export const FACTORY_ABI = [
  "function getAllTokens() view returns (address[])",
  "event TokenCreated(address indexed token, address indexed curve, address indexed creator, string name, string symbol, string imageUri, uint256 timestamp)",
];

export const CURVE_ABI = [
  "event Trade(address indexed trader, bool isBuy, uint256 ronAmount, uint256 tokenAmount, uint256 newPriceRon, uint256 timestamp)",
  "event Migrated(address indexed dexPool, uint256 ronLiquidity, uint256 tokenLiquidity, uint256 timestamp)",
];

export function factoryContract() {
  return new Contract(process.env.RONITEFUN_FACTORY_ADDRESS, FACTORY_ABI, provider);
}

export function curveContract(address) {
  return new Contract(address, CURVE_ABI, provider);
}
