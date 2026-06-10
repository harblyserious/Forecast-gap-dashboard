import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://aporetic.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Aporetic — Markets vs. Meteorologists",
    template: "%s · Aporetic",
  },
  description:
    "Markets vs. Meteorologists — tracking how well-calibrated weather prediction markets are against National Weather Service forecasts.",
  keywords: [
    "prediction markets", "Kalshi", "weather forecast", "NWS", "NOAA",
    "market calibration", "temperature markets", "forecast accuracy",
  ],
  openGraph: {
    title: "Aporetic — Markets vs. Meteorologists",
    description:
      "Prediction markets vs. NWS forecasts — who calls the daily high temperature better, markets or meteorologists?",
    url: SITE_URL,
    siteName: "Aporetic",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Aporetic — Markets vs. Meteorologists",
    description:
      "Prediction markets vs. NWS forecasts — who calls the daily high temperature better, markets or meteorologists?",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <Analytics />
      </body>
    </html>
  );
}
