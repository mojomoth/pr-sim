import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PR·SIM",
  description: "AI 심사위원 앞에서 실전처럼 연습하는 발표 리허설",
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
      </body>
    </html>
  );
}
