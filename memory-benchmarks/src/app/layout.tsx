import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { Plus } from "lucide-react";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Memory Benchmarks",
  description:
    "Open-source evaluation suite for memory-augmented LLM systems",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans">
        {/* Top navigation */}
        <header className="glass-nav sticky top-0 z-50 border-b">
          <div className="max-w-6xl mx-auto px-8 h-14 flex items-center justify-between">
            <Link
              href="/"
              className="flex items-center gap-2.5 group"
            >
              <div className="w-7 h-7 rounded-lg bg-neutral-900 flex items-center justify-center group-hover:bg-neutral-800 transition-colors">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2a8 8 0 0 0-8 8c0 3.4 2.1 6.3 5 7.4V20a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2.6c2.9-1.1 5-4 5-7.4a8 8 0 0 0-8-8z" />
                  <path d="M10 22h4" />
                  <path d="M9 14.5a3.5 3.5 0 0 0 6 0" />
                </svg>
              </div>
              <span className="text-sm font-semibold tracking-tight text-neutral-900">
                Memory Benchmarks
              </span>
            </Link>

            <Link
              href="/runs/new"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white text-[13px] font-medium rounded-lg transition-colors"
            >
              <Plus size={14} strokeWidth={2.5} />
              New Run
            </Link>
          </div>
        </header>

        {/* Content */}
        <main className="max-w-6xl mx-auto px-8 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
