import type { Metadata } from "next";
import "./globals.css";
import "./site.css";
import { ThemeProvider } from "../components/theme-provider";
import { ParticleField } from "../components/particle-field";
import { AuthProvider } from "../lib/auth-context";

export const metadata: Metadata = {
  title: "CoworkExpress 平台",
  description:
    "CoworkExpress 平台——统一数据中台与 AI 智能体，让企业知识可问、数据可取、答案带依据。"
};

const noFlash = `(function(){try{var t=localStorage.getItem('ff-theme');if(!t){t='light';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlash }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Hanken+Grotesk:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <ParticleField />
            <div className="grain" aria-hidden />
            <div className="app-shell">{children}</div>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
