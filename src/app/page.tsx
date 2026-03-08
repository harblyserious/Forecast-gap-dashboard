export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Forecast Gap Dashboard
        </h1>
        <p className="text-lg text-gray-600">
          Comparing prediction market odds against real-world forecasts.
        </p>
        <p className="text-sm text-gray-400 mt-8">
          Coming soon.
        </p>
      </div>
    <footer className="absolute bottom-0 w-full pb-4 text-center">
      <p className="text-xs text-gray-400">Built by Harbly &bull; Data from Polymarket, Kalshi, and NOAA</p>
    </footer>
    </div>
  );
}
