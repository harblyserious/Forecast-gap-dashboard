import { runFetchForecasts } from "../../src/lib/pipeline/fetch-forecasts";

async function run() {
  console.log(`fetch-forecasts started at ${new Date().toISOString()}\n`);
  const result = await runFetchForecasts();

  if (result.inserted === 0 && result.skipped === 0) {
    console.log("No market_snapshots found in the last 2 hours — nothing to forecast.");
  } else {
    console.log(`Summary: inserted=${result.inserted} skipped=${result.skipped}`);
  }
}

run();
