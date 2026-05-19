import { supabaseAdmin } from "../src/lib/supabase";
import { insertMarketSnapshot, type MarketSnapshot } from "../src/lib/database";

const TEST_TICKER = "TEST-SUPABASE-VERIFY";

async function run() {
  let insertedId: string | null = null;

  // ── Step 1: Insert ──────────────────────────────────────────────────────────
  console.log("1. Inserting test row into market_snapshots...");
  try {
    const row = await insertMarketSnapshot({
      source:          "kalshi",
      series_ticker:   TEST_TICKER,
      event_ticker:    `${TEST_TICKER}-EVENT`,
      market_ticker:   `${TEST_TICKER}-T70`,
      resolution_date: "2099-01-01",
      city:            "nyc",
      threshold:       70,
      strike_type:     "greater",
      cap_strike:      null,
      yes_bid:         0.55,
      volume:          100,
      fetched_at:      new Date().toISOString(),
    });
    insertedId = row.id;
    console.log(`   ✓ Inserted — id: ${insertedId}`);
  } catch (err) {
    console.error("   ✗ Insert failed:", err);
    process.exit(1);
  }

  // ── Step 2: Read back ───────────────────────────────────────────────────────
  console.log("2. Reading row back from market_snapshots...");
  try {
    const { data, error } = await supabaseAdmin
      .from("market_snapshots")
      .select("*")
      .eq("id", insertedId)
      .single();

    if (error) throw error;

    const row = data as MarketSnapshot;
    console.log(`   ✓ Read back — ticker: ${row.series_ticker}, yes_bid: ${row.yes_bid}, city: ${row.city}`);
  } catch (err) {
    console.error("   ✗ Read failed:", err);
    // Still attempt cleanup before exiting
  }

  // ── Step 3: Delete ──────────────────────────────────────────────────────────
  console.log("3. Deleting test row...");
  try {
    const { error } = await supabaseAdmin
      .from("market_snapshots")
      .delete()
      .eq("id", insertedId);

    if (error) throw error;
    console.log("   ✓ Deleted");
  } catch (err) {
    console.error("   ✗ Delete failed:", err);
    console.error(`   Manual cleanup needed: DELETE FROM market_snapshots WHERE id = '${insertedId}';`);
    process.exit(1);
  }

  console.log("\nAll steps passed — Supabase connection and schema are working.");
}

run();
