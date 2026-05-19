import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { supabaseAdmin } from "../src/lib/supabase";

const OUTPUT_DIR = join(__dirname, "..", "data-exports");
const TODAY = new Date().toISOString().slice(0, 10);

async function exportTable(table: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select("*")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to query ${table}: ${error.message}`);

  const rows = data ?? [];
  const filename = join(OUTPUT_DIR, `${table}-${TODAY}.json`);
  writeFileSync(filename, JSON.stringify(rows, null, 2));
  return rows.length;
}

async function run() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`Exporting data — ${TODAY}\n`);

  for (const table of ["comparisons", "accuracy_scores"]) {
    try {
      const count = await exportTable(table);
      console.log(`  ✓ ${table}: ${count} rows → data-exports/${table}-${TODAY}.json`);
    } catch (err) {
      console.error(`  ✗ ${table}: ${(err as Error).message}`);
    }
  }
}

run();
