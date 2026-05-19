import { runFetchMarkets } from "../../src/lib/pipeline/fetch-markets";

async function run() {
  console.log(`fetch-markets started at ${new Date().toISOString()}\n`);
  const result = await runFetchMarkets();

  if (result.kalshiError) {
    console.error(`  ✗ Kalshi failed: ${result.kalshiError}`);
  } else {
    console.log(`  ✓ Inserted ${result.kalshiInserted} Kalshi snapshots`);
  }

  if (result.polyError) {
    console.error(`  ✗ Polymarket failed: ${result.polyError}`);
  } else {
    console.log(`  ✓ Inserted ${result.polyInserted} Polymarket snapshots`);
  }

  console.log(`\nSummary: Kalshi=${result.kalshiInserted} Polymarket=${result.polyInserted}`);

  if (result.kalshiError && result.polyError) process.exit(1);
}

run();
