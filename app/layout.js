import { AntdRegistry } from '@ant-design/nextjs-registry'
import UmamiAnalytics from '@/components/UmamiAnalytics'
import './globals.css'

export const metadata = {
  title: '校区地址台账',
  description: '城市校区地址导入、检索与地图校验工具',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: '校区地址',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f6f62',
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <UmamiAnalytics />
        <AntdRegistry>{children}</AntdRegistry>
      </body>
    </html>
  )
}
