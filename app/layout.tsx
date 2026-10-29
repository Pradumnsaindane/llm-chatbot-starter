import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Dev News Chat",
  description: "A focused chat for the latest developer news and technology briefings.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>
}
