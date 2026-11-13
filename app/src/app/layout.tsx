import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

/** Google Analytics 4 (property "dansang", web stream https://dansang.io). Public ID, safe to ship. */
const GA_MEASUREMENT_ID = "G-GRX680TYZS";

const SITE_DESCRIPTION = "AI 심사위원 앞에서 실전처럼 연습하는 발표 리허설";

/** Link previews: the image comes from opengraph-image.png / twitter-image.png (built by assets/bi/build-og.py). */
export const metadata: Metadata = {
  metadataBase: new URL("https://dansang.io"),
  title: "DANSANG",
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    url: "/",
    siteName: "DANSANG",
    title: "DANSANG",
    description: SITE_DESCRIPTION,
    locale: "ko_KR",
  },
  twitter: { card: "summary_large_image", title: "DANSANG", description: SITE_DESCRIPTION },
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "48x48" }, { url: "/icon.png", type: "image/png", sizes: "192x192" }],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

/**
 * Device shell (see the header of globals.css): desktop draws the app inside the iPhone mockup,
 * phones get it full screen. #app-scroll is the page scroller; #app-screen hosts fixed bars and portals.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>
        <div className="device">
          <div id="app-screen" className="app-screen">
            <div id="app-scroll" className="app-scroll">
              {children}
            </div>
          </div>
        </div>
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="ga-init" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_MEASUREMENT_ID}');`}
        </Script>
      </body>
    </html>
  );
}
