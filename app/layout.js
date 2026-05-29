import { AntdRegistry } from '@ant-design/nextjs-registry'
import './globals.css'

export const metadata = {
  title: '城市地址管理系统',
  description: 'AI 驱动的城市地址导入与搜索系统',
  manifest: '/manifest.json',
  themeColor: '#6c63ff',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: '城市地址',
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AntdRegistry>{children}</AntdRegistry>
      </body>
    </html>
  )
}
