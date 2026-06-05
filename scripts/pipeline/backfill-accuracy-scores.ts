import { runScoreAccuracy } from "../../src/lib/pipeline/score-accuracy";

async function main() {
  console.log("Running accuracy scoring backfill...\n");
  const start = Date.now();

  const result = await runScoreAccuracy();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Done in ${elapsed}s`);
  console.log(`  Scored:  ${result.scored}`);
  console.log(`  Skipped: ${result.skipped} (already scored)`);

  if (result.errors.length > 0) {
    console.log(`  Errors:  ${result.errors.length}`);
    for (const e of result.errors) console.log(`    - ${e}`);
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
