'use client'

import { ConfigProvider, theme } from 'antd'

const fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'

const sharedTokens = {
  fontFamily,
  colorPrimary: '#0071e3',
  colorPrimaryHover: '#0065cb',
  colorPrimaryActive: '#005bb8',
  borderRadius: 10,
  borderRadiusLG: 18,
  controlHeight: 36,
}

const themes = {
  light: {
    algorithm: theme.defaultAlgorithm,
    token: {
      ...sharedTokens,
      colorBgBase: '#ffffff',
      colorBgLayout: '#f5f5f7',
      colorBgContainer: '#ffffff',
      colorBorder: '#dfe2e8',
      colorText: '#1d1d1f',
      colorTextSecondary: '#51545b',
      colorTextTertiary: '#676b73',
      colorLink: '#0066cc',
    },
  },
  dark: {
    algorithm: theme.darkAlgorithm,
    token: {
      ...sharedTokens,
      colorBgBase: '#15161a',
      colorBgLayout: '#15161a',
      colorBgContainer: '#202126',
      colorBgElevated: '#282a30',
      colorBorder: '#3b3e46',
      colorText: '#f4f4f6',
      colorTextSecondary: '#cbccd1',
      colorTextTertiary: '#a6a9b1',
      colorPrimaryText: '#79b9ff',
      colorLink: '#79b9ff',
      colorLinkHover: '#a5d1ff',
    },
  },
}

export default function AppTheme({ mode = 'light', children }) {
  return <ConfigProvider theme={themes[mode] || themes.light}>{children}</ConfigProvider>
}
