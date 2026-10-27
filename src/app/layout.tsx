import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif } from "next/font/google";
import "./globals.css";

// Suisse Intl (the original face) is a commercial font, so Inter stands in for it
// under the same CSS variable name. See SITE_SPEC.md §2.2.
const suisse = Inter({
  variable: "--font-suisse",
  subsets: ["latin"],
  display: "swap",
});

const instrument = Instrument_Serif({
  variable: "--font-instrument",
  weight: "400",
  style: "italic",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "reception · Live support for your iOS apps",
  description:
    "Be there when your users need you. Native in-app chat, with every conversation in one simple inbox.",
  openGraph: {
    type: "website",
    siteName: "reception",
    title: "reception · Live support for your iOS apps",
    description:
      "Be there when your users need you. Native in-app chat, with every conversation in one simple inbox.",
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${suisse.variable} ${instrument.variable}`}>
      <body>{children}</body>
    </html>
  );
}
