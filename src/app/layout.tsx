import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/nav";
import { LogoMark } from "@/components/logo";
import { Toaster } from "@/components/ds/toast";
import { ConfirmHost } from "@/components/ds/confirm-dialog";
import { PageTransition, RouteProgress } from "@/components/ds/route-progress";
import { THEME_SCRIPT } from "@/components/ds/theme-script";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], axes: ["opsz", "SOFT"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  // Pages set full titles ("Discover · LoomLend"), matching the convention other routes use.
  title: "LoomLend · Share idle labs, safely",
  description:
    "A trusted platform for colleges to share underused labs, equipment and spaces, with eligibility checks, fair allocation and an auditable trail.",
  applicationName: "LoomLend",
  openGraph: {
    type: "website",
    siteName: "LoomLend",
    title: "LoomLend · Every borrow, a thread on the loom",
    description: "Share idle campus labs, equipment and spaces with eligibility checks, fair allocation and a tamper-evident history.",
  },
  twitter: { card: "summary_large_image" },
  appleWebApp: { title: "LoomLend", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f2ea" },
    { media: "(prefers-color-scheme: dark)", color: "#13121a" },
  ],
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // An explicit light/dark choice is also kept in a cookie, so the server can render the right
  // theme straight away; "system" is resolved by the inline script before first paint.
  const pref = (await cookies()).get("ll-theme")?.value;
  const theme = pref === "dark" || pref === "light" ? pref : undefined;
  return (
    <html
      lang="en-IN"
      data-theme={theme}
      data-theme-pref={pref ?? "system"}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="btn-primary sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100]"
        >
          Skip to content
        </a>
        <Suspense>
          <RouteProgress />
        </Suspense>
        <Nav />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+2rem)] outline-none sm:px-6 sm:pt-8 md:pb-12">
          <PageTransition>{children}</PageTransition>
        </main>
        <footer className="no-print border-t border-line pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+1rem)] md:pb-0">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="flex items-center gap-2">
              <LogoMark size={18} />
              <span>
                <span className="font-medium text-ink/80">LoomLend</span> · every borrow, a thread on the loom · demo data is fictional
              </span>
            </p>
            <nav aria-label="Footer" className="flex flex-wrap gap-x-4 gap-y-1">
              <Link href="/policy" className="hover:text-ink">
                Fair-use policy
              </Link>
              <Link href="/fairness" className="hover:text-ink">
                Fairness ledger
              </Link>
              <Link href="/design" className="hover:text-ink">
                Design system
              </Link>
            </nav>
          </div>
        </footer>
        <Toaster />
        <ConfirmHost />
      </body>
    </html>
  );
}
