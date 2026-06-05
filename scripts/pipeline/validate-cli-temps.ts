import { getCliMaxTemp } from "../../src/lib/pipeline/fetch-cli-temp";

const DATES: { date: string; expectedMax: number }[] = [
  { date: "2026-05-30", expectedMax: 69 },
  { date: "2026-05-31", expectedMax: 75 },
  { date: "2026-06-03", expectedMax: 83 },
];

async function main() {
  console.log("Validating CLI max temps against expected values from manual CLI check...\n");
  console.log("Date         CLI Max   Expected  Match");
  console.log("─────────────────────────────────────");

  let allPass = true;

  for (const { date, expectedMax } of DATES) {
    try {
      const maxTemp = await getCliMaxTemp(date);
      const match = maxTemp === expectedMax ? "✓" : "✗ MISMATCH";
      if (maxTemp !== expectedMax) allPass = false;
      console.log(`${date}   ${String(maxTemp).padEnd(9)} ${String(expectedMax).padEnd(9)} ${match}`);
    } catch (err) {
      allPass = false;
      console.log(`${date}   ERROR: ${(err as Error).message}`);
    }
  }

  console.log("─────────────────────────────────────");
  console.log(allPass ? "\nAll dates match. CLI fetcher validated." : "\nValidation FAILED — check mismatches above.");
  process.exit(allPass ? 0 : 1);
}

main();
