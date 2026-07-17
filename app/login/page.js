'use client'

import { useState } from 'react'
import { EyeInvisibleOutlined, EyeOutlined, LockOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons'
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
  }

  const isLogin = mode === 'login'

  return (
    <main className={styles.page} style={{ height: '100dvh' }}>
      <div className={styles.grid} aria-hidden="true" />
      <section className={styles.story}>
        <span className={styles.eyebrow}>CITY ADDRESS LEDGER</span>
        <div className={styles.mark}><img src="/icon-192.png" alt="" /></div>
        <h1>让每一处校区<br />都有准确坐标。</h1>
        <p>地址台账、地图校验与智能解析集中在一个安全的内部工作台。</p>
        <div className={styles.permissionNote}>
          <SafetyCertificateOutlined />
          <span><strong>受控访问</strong>注册账号需由管理员提前加入白名单。</span>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <span>{isLogin ? 'ACCOUNT ACCESS' : 'INVITED MEMBER'}</span>
            <strong>{isLogin ? '登录工作台' : '创建账号'}</strong>
            <p>{isLogin ? '使用你的内部账号继续' : '用户名必须与管理员配置的白名单一致'}</p>
          </div>

          <form onSubmit={handleSubmit} className={styles.form}>
            <label>
              <span>用户名</span>
              <div className={styles.field}>
                <UserOutlined />
                <input
                  autoComplete="username"
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  placeholder="输入用户名"
                  minLength={2}
                  maxLength={32}
                  required
                />
              </div>
            </label>

            <label>
              <span>密码</span>
              <div className={styles.field}>
                <LockOutlined />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  placeholder={isLogin ? '输入密码' : '至少 8 位密码'}
                  minLength={isLogin ? 1 : 8}
                  maxLength={128}
                  required
                />
                <button type="button" className={styles.eye} onClick={() => setShowPassword(value => !value)} aria-label="显示或隐藏密码">
                  {showPassword ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                </button>
              </div>
            </label>

            <div className={styles.error} role="alert">{error}</div>
            <button className={styles.submit} type="submit" disabled={loading}>
              <span>{loading ? '处理中…' : isLogin ? '进入地址台账' : '完成注册'}</span>
              <i>→</i>
            </button>
          </form>

          <div className={styles.switcher}>
            <span>{isLogin ? '已获得注册许可？' : '已经有账号？'}</span>
            <button type="button" onClick={switchMode}>{isLogin ? '创建账号' : '返回登录'}</button>
          </div>
        </div>
        <p className={styles.footer}>CITY ONE · INTERNAL SYSTEM</p>
      </section>
    </main>
  )
}
