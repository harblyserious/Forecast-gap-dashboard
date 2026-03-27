import { fetchJson } from "../src/lib/api-client";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const BASE_URL = "https://gamma-api.polymarket.com";

interface Market {
  id: string;
  question: string;
  slug: string;
  groupItemTitle: string;
  outcomePrices: string[];
}

interface Tag {
  id: number;
  label: string;
  slug: string;
}

interface Event {
  id: string;
  title: string;
  slug: string;
  seriesSlug: string;
  endDate: string;
  resolutionSource: string;
  tags: Tag[];
  markets: Market[];
  liquidity: number;
  volume: number;
}

async function main() {
  console.log("Fetching daily temperature events via /events?tag_slug=temperature...");
  const events = await fetchJson<Event[]>(
    `${BASE_URL}/events?closed=false&tag_slug=temperature&limit=100`
  );
  console.log(`Found ${events.length} temperature event(s).\n`);

  const nycEvents = events.filter(
    (e) => e.slug?.includes("nyc") || e.title?.toLowerCase().includes("nyc") || e.tags?.some((t) => t.slug === "new-york-city")
  );

  console.log(`NYC-specific events: ${nycEvents.length}\n`);

  const sampleDir = join(__dirname, "sample-data");
  mkdirSync(sampleDir, { recursive: true });
  writeFileSync(join(sampleDir, "polymarket-markets-sample.json"), JSON.stringify(nycEvents, null, 2));
  console.log("NYC events saved to scripts/sample-data/polymarket-markets-sample.json\n");

  for (const event of nycEvents) {
    const tags = event.tags?.map((t) => t.slug).join(", ") ?? "none";
    console.log(`Event:      ${event.title}`);
    console.log(`Slug:       ${event.slug}`);
    console.log(`Series:     ${event.seriesSlug}`);
    console.log(`End Date:   ${event.endDate}`);
    console.log(`Resolution: ${event.resolutionSource}`);
    console.log(`Volume:     $${Number(event.volume).toFixed(2)}`);
    console.log(`Tags:       ${tags}`);
    console.log(`Markets:`);
    for (const m of event.markets) {
      const yesPrice = m.outcomePrices?.[0];
      console.log(`  [${m.groupItemTitle}] Yes: ${yesPrice}`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
