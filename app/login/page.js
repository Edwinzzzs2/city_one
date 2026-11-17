'use client'

import { useState } from 'react'
import { EyeInvisibleOutlined, EyeOutlined, LockOutlined, UserOutlined } from '@ant-design/icons'
import styles from './login.module.css'

async function submitJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.ok) throw new Error(data.error || '操作失败')
  return data
}

export default function LoginPage() {
  const [mode, setMode] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    if (!username.trim() || !password) return
    setLoading(true)
    setError('')
    try {
      await submitJson(`/api/auth/${mode}`, { username, password })
      const next = new URLSearchParams(window.location.search).get('next')
      window.location.href = next?.startsWith('/') ? next : '/'
    } catch (cause) {
      setError(cause.message)
    } finally {
      setLoading(false)
    }
  }

  function switchMode() {
    setMode(current => current === 'login' ? 'register' : 'login')
    setError('')
    setPassword('')
    setShowPassword(false)
  }

  const isLogin = mode === 'login'

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="auth-title">
        <header className={styles.cardHead}>
          <div className={styles.brand}>
            <img src="/icon-192.png" alt="" width={56} height={56} />
            <span>校区地址台账</span>
          </div>
          <h1 id="auth-title">{isLogin ? '登录' : '创建账号'}</h1>
          {!isLogin && <p>注册前需由管理员将用户名加入白名单。</p>}
        </header>

        <form onSubmit={handleSubmit} className={styles.form} aria-busy={loading}>
          <div>
            <label htmlFor="auth-username">用户名</label>
            <div className={styles.field}>
              <UserOutlined aria-hidden="true" />
              <input
                id="auth-username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={event => setUsername(event.target.value)}
                placeholder="输入用户名"
                minLength={2}
                maxLength={32}
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="auth-password">密码</label>
            <div className={styles.field}>
              <LockOutlined aria-hidden="true" />
              <input
                id="auth-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder={isLogin ? '输入密码' : '至少 8 位密码'}
                minLength={isLogin ? 1 : 8}
                maxLength={128}
                required
              />
              <button
                type="button"
                className={styles.eye}
                onClick={() => setShowPassword(value => !value)}
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                aria-controls="auth-password"
              >
                {showPassword ? <EyeInvisibleOutlined aria-hidden="true" /> : <EyeOutlined aria-hidden="true" />}
              </button>
            </div>
          </div>

          <div className={styles.error} role="alert">{error}</div>
          <button className={styles.submit} type="submit" disabled={loading}>
            {loading ? '处理中…' : isLogin ? '登录' : '完成注册'}
          </button>
        </form>

        <div className={styles.switcher}>
          <span>{isLogin ? '已获得注册许可？' : '已有账号？'}</span>
          <button type="button" onClick={switchMode} disabled={loading}>{isLogin ? '创建账号' : '返回登录'}</button>
        </div>
      </section>
    </main>
  )
}
