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
    default: "Aporetic · Measuring the prediction market gap",
    template: "%s · Aporetic",
  },
  description:
    "Markets vs. Meteorologists — measuring the gap between prediction markets and National Weather Service forecasts on daily temperatures.",
  keywords: [
    "prediction markets", "Kalshi", "weather forecast", "NWS", "NOAA",
    "market calibration", "temperature markets", "forecast accuracy",
  ],
  openGraph: {
    title: "Aporetic · Measuring the prediction market gap",
    description:
      "Markets vs. Meteorologists — measuring the gap between prediction markets and NWS forecasts on daily temperatures.",
    url: SITE_URL,
    siteName: "Aporetic",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Aporetic · Measuring the prediction market gap",
    description:
      "Markets vs. Meteorologists — measuring the gap between prediction markets and NWS forecasts on daily temperatures.",
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
