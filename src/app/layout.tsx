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

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://forecast-gap-dashboard.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Forecast Gap Dashboard",
    template: "%s · Forecast Gap Dashboard",
  },
  description:
    "NYC prediction markets vs. NWS forecast — tracking how well-calibrated weather prediction markets are against the National Weather Service.",
  keywords: [
    "prediction markets", "Kalshi", "weather forecast", "NWS", "NOAA",
    "market calibration", "NYC temperature", "forecast accuracy",
  ],
  openGraph: {
    title: "Forecast Gap Dashboard",
    description:
      "NYC prediction markets vs. NWS forecast — who calls the daily high temperature better, markets or meteorologists?",
    url: SITE_URL,
    siteName: "Forecast Gap Dashboard",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Forecast Gap Dashboard",
    description:
      "NYC prediction markets vs. NWS forecast — who calls the daily high temperature better, markets or meteorologists?",
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
