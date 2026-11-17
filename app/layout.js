import { AntdRegistry } from '@ant-design/nextjs-registry'
import AppTheme from '@/components/AppTheme'
import UmamiAnalytics from '@/components/UmamiAnalytics'
import './globals.css'
import './discovery.css'
import './dialogs.css'

export const metadata = {
  title: '校区地址台账',
  description: '城市校区地址导入、检索与地图校验工具',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon-512.png',
    apple: '/icon-192.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '校区地址',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f5f5f7',
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <UmamiAnalytics />
        <AntdRegistry>
          <AppTheme>{children}</AppTheme>
        </AntdRegistry>
      </body>
    </html>
  )
}
