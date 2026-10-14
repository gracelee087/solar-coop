import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Solar Co-op · Operator Desk",
  description: "Community energy bills, producer payouts and payment investigations in one operator desk (prototype)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
