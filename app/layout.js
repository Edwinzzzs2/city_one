import { AntdRegistry } from '@ant-design/nextjs-registry'
import AppTheme from '@/components/AppTheme'
import UmamiAnalytics from '@/components/UmamiAnalytics'
import ServiceWorkerRegistration from '@/components/ServiceWorkerRegistration'
import StandaloneViewport from '@/components/StandaloneViewport'
import './globals.css'
import './discovery.css'
import './dialogs.css'

export const metadata = {
  title: '校区地址台账',
  description: '城市校区地址导入、检索与地图校验工具',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/icon-folded-map-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-folded-map-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icon-folded-map-192.png', sizes: '192x192', type: 'image/png' }],
  },
  appleWebApp: true,
  other: {
    'apple-mobile-web-app-title': '校区地址',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f5f5f7',
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <StandaloneViewport />
        <ServiceWorkerRegistration />
        <UmamiAnalytics />
        <AntdRegistry>
          <AppTheme>{children}</AppTheme>
        </AntdRegistry>
      </body>
    </html>
  )
}
