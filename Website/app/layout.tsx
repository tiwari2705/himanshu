import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'IMS - Inventory & Billing System',
  description: 'Manufacturing ERP, Inventory Management & Billing System',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
  themeColor: '#006EC4',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased selection:bg-[#006EC4]/20 selection:text-[#006EC4]">{children}</body>
    </html>
  )
}

