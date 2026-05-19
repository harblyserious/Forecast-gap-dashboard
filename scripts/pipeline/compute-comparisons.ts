import { runComputeComparisons } from "../../src/lib/pipeline/compute-comparisons";

async function run() {
  console.log(`compute-comparisons started at ${new Date().toISOString()}\n`);
  const result = await runComputeComparisons();

  if (result.inserted === 0 && result.skipped === 0) {
    console.log("No market_snapshots found in the last 2 hours — nothing to compute.");
  } else {
    console.log(`Summary: inserted=${result.inserted} skipped=${result.skipped}`);
  }
}

run();
