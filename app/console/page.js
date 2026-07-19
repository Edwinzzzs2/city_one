'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { App as AntdApp } from 'antd'
import {
  ArrowLeftOutlined, CheckCircleOutlined, CloseOutlined, ControlOutlined, CrownOutlined, LogoutOutlined,
  DatabaseOutlined, EyeInvisibleOutlined, EyeOutlined, FileExcelOutlined, KeyOutlined, LockOutlined, PlusOutlined, ReloadOutlined,
  RobotOutlined, SafetyCertificateOutlined, SettingOutlined, TeamOutlined, UploadOutlined, UserOutlined,
} from '@ant-design/icons'
import AiParseModal from '@/components/AiParseModal'
import useDataStore from '@/store/useDataStore'
import { parseExcelFile } from '@/utils/excelParser'
import styles from './console.module.css'
import dataStyles from './data.module.css'

async function api(url, options) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.ok) throw new Error(data.error || '请求失败')
  return data
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function Toggle({ checked, onChange, disabled, label }) {
  return (
    <button type="button" className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`} onClick={() => onChange(!checked)} disabled={disabled} aria-label={label} aria-pressed={checked}>
      <span />
    </button>
  )
}

function Field({ label, hint, children, wide }) {
  return <label className={wide ? styles.fieldWide : styles.field}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

function ConsolePageContent() {
  const { rawRows, setRawRows, initSettings } = useDataStore()
  const [viewer, setViewer] = useState(null)
  const [tab, setTab] = useState('users')
  const [users, setUsers] = useState([])
  const [whitelist, setWhitelist] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState(null)
  const [invite, setInvite] = useState({ username: '', grantAdmin: false })
  const [resetTarget, setResetTarget] = useState(null)
  const [newPassword, setNewPassword] = useState('')
  const [importing, setImporting] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [visiblePasswords, setVisiblePasswords] = useState({})
  const fileRef = useRef(null)

  const stats = useMemo(() => ({
    users: users.length,
    admins: users.filter(user => user.is_admin).length,
    pending: whitelist.filter(item => !item.used_at).length,
  }), [users, whitelist])

  async function loadAll({ quiet = false } = {}) {
    if (!quiet) setLoading(true)
    try {
      const [me, usersData, whitelistData, settingsData] = await Promise.all([
        api('/api/auth/me'), api('/api/admin/users'), api('/api/admin/whitelist'), api('/api/admin/settings'),
      ])
      if (!me.user.isAdmin) throw new Error('需要管理员权限')
      setViewer(me.user)
      setUsers(usersData.users)
      setWhitelist(whitelistData.whitelist)
      setSettings(settingsData.settings)
    } catch (error) {
      if (error.message.includes('管理员')) window.location.href = '/'
      else setNotice({ type: 'error', text: error.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    initSettings()
  }, [initSettings])

  function flash(text, type = 'success') {
    setNotice({ text, type })
    window.setTimeout(() => setNotice(null), 2600)
  }

  async function handleImportFile(file) {
    setImporting(true)
    try {
      const rows = await parseExcelFile(file)
      if (!rows.length) throw new Error('未识别到有效数据，请检查表格格式')
      setRawRows(rows)
      flash(`已读取 ${rows.length} 条数据，准备进入 AI 解析`)
      setAiOpen(true)
    } catch (error) {
      flash(error.message || '文件读取失败', 'error')
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function updateUser(user, patch) {
    try {
      await api('/api/admin/users', { method: 'PATCH', body: JSON.stringify({ userId: user.id, ...patch }) })
      await loadAll({ quiet: true })
      flash('用户权限已更新')
    } catch (error) { flash(error.message, 'error') }
  }

  async function addWhitelist(event) {
    event.preventDefault()
    if (!invite.username.trim()) return
    setSaving(true)
    try {
      await api('/api/admin/whitelist', { method: 'POST', body: JSON.stringify(invite) })
      setInvite({ username: '', grantAdmin: false })
      await loadAll({ quiet: true })
      flash('注册名额已加入白名单')
    } catch (error) { flash(error.message, 'error') }
    finally { setSaving(false) }
  }

  async function removeWhitelist(id) {
    try {
      await api('/api/admin/whitelist', { method: 'DELETE', body: JSON.stringify({ id }) })
      await loadAll({ quiet: true })
      flash('白名单名额已撤回')
    } catch (error) { flash(error.message, 'error') }
  }

  async function resetPassword(event) {
    event.preventDefault()
    setSaving(true)
    try {
      await api('/api/admin/users/reset-password', { method: 'POST', body: JSON.stringify({ userId: resetTarget.id, newPassword }) })
      setResetTarget(null)
      setNewPassword('')
      flash('密码已重置')
    } catch (error) { flash(error.message, 'error') }
    finally { setSaving(false) }
  }

  async function saveSettings(event) {
    event.preventDefault()
    setSaving(true)
    try {
      const data = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(settings) })
      setSettings(data.settings)
      flash('系统配置已保存，新页面加载时生效')
    } catch (error) { flash(error.message, 'error') }
    finally { setSaving(false) }
  }

  function changeSetting(key, value) {
    setSettings(current => ({ ...current, [key]: value }))
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login?next=/console'
  }

  if (loading) return <div className={styles.loading}><span /><p>正在验证管理权限</p></div>

  return (
    <div className={styles.shell} style={{ position: 'relative', zIndex: 1 }}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="/"><img src="/icon.svg" alt="" /><div><strong>CITY ONE</strong><span>CONTROL DESK</span></div></a>
        <nav>
          <button className={tab === 'users' ? styles.active : ''} onClick={() => setTab('users')}><TeamOutlined /><span>用户权限</span><i>{stats.users}</i></button>
          <button className={tab === 'whitelist' ? styles.active : ''} onClick={() => setTab('whitelist')}><SafetyCertificateOutlined /><span>注册白名单</span><i>{stats.pending}</i></button>
          <button className={tab === 'data' ? styles.active : ''} onClick={() => setTab('data')}><DatabaseOutlined /><span>数据导入</span>{rawRows.length > 0 && <i>{rawRows.length}</i>}</button>
          <button className={tab === 'settings' ? styles.active : ''} onClick={() => setTab('settings')}><SettingOutlined /><span>系统配置</span></button>
        </nav>
        <div className={styles.operator}><div><UserOutlined /></div><span><small>当前管理员</small><strong>{viewer?.username}</strong></span></div>
        <a className={styles.back} href="/"><ArrowLeftOutlined /> 返回地址台账</a>
        <button type="button" className={styles.logout} onClick={logout} aria-label="退出登录" title="退出登录"><LogoutOutlined /><span>退出</span></button>
      </aside>

      <main className={styles.main}>
        <header className={styles.topbar}>
          <div><span>ADMIN CONSOLE / {tab.toUpperCase()}</span><h1>{tab === 'users' ? '用户与权限' : tab === 'whitelist' ? '注册白名单' : tab === 'data' ? '数据导入' : '系统配置'}</h1></div>
          <button className={styles.refresh} onClick={() => loadAll()}><ReloadOutlined /> 刷新</button>
        </header>

        {notice && <div className={`${styles.notice} ${notice.type === 'error' ? styles.noticeError : ''}`}>{notice.type === 'error' ? <CloseOutlined /> : <CheckCircleOutlined />}{notice.text}</div>}

        {tab === 'users' && <section>
          <div className={styles.stats}>
            <article><span>已创建账号</span><strong>{stats.users}</strong><small>包含停用账号</small></article>
            <article><span>管理员</span><strong>{stats.admins}</strong><small>可进入此控制台</small></article>
            <article><span>正常使用</span><strong>{users.filter(user => user.is_active).length}</strong><small>当前启用状态</small></article>
          </div>
          <div className={styles.tableCard}>
            <div className={styles.sectionHead}><div><span>ACCESS DIRECTORY</span><h2>账号目录</h2></div><p>管理员权限变更会在用户的下一次服务端请求生效。</p></div>
            <div>
              <div className={styles.userHeader}><span>用户</span><span>最近登录</span><span>管理员</span><span>账号状态</span><span>操作</span></div>
              {users.map(user => <div className={styles.userRow} key={user.id}>
                <div className={styles.userIdentity}><b>{user.username.slice(0, 1).toUpperCase()}</b><span><strong>{user.username}</strong><small>创建于 {formatDate(user.created_at)}</small></span>{user.id === viewer?.id && <em>你</em>}</div>
                <span className={styles.date}>{formatDate(user.last_login_at)}</span>
                <div className={styles.switchCell}><Toggle checked={user.is_admin} disabled={user.id === viewer?.id} onChange={value => updateUser(user, { isAdmin: value })} label="管理员权限" /><span>{user.is_admin ? '管理员' : '成员'}</span></div>
                <div className={styles.switchCell}><Toggle checked={user.is_active} disabled={user.id === viewer?.id} onChange={value => updateUser(user, { isActive: value })} label="账号启用状态" /><span>{user.is_active ? '启用' : '停用'}</span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                  <button className={styles.textButton} onClick={() => { setResetTarget(user); setNewPassword('') }}><KeyOutlined /> 重置密码</button>
                  {user.password_plain ? (
                    <button className={styles.textButton} onClick={() => setVisiblePasswords(prev => ({ ...prev, [user.id]: !prev[user.id] }))}>
                      {visiblePasswords[user.id] ? <EyeInvisibleOutlined /> : <EyeOutlined />} {visiblePasswords[user.id] ? user.password_plain : '查看密码'}
                    </button>
                  ) : (
                    <span style={{ fontSize: '10px', color: '#8b958f', paddingLeft: '4px' }}>无明文记录</span>
                  )}
                </div>
              </div>)}
            </div>
          </div>
        </section>}

        {tab === 'whitelist' && <section className={styles.split}>
          <form className={styles.inviteCard} onSubmit={addWhitelist}>
            <div className={styles.bigIcon}><PlusOutlined /></div><span className={styles.kicker}>NEW INVITATION</span><h2>添加注册名额</h2><p>用户注册时输入的名称必须与这里完全一致，每个名额只能使用一次。</p>
            <Field label="允许注册的用户名"><input value={invite.username} onChange={event => setInvite({ ...invite, username: event.target.value })} placeholder="例如：zhangsan" minLength={2} maxLength={32} required /></Field>
            <label className={styles.checkLine}><input type="checkbox" checked={invite.grantAdmin} onChange={event => setInvite({ ...invite, grantAdmin: event.target.checked })} /><span><strong>注册后授予管理员</strong><small>该用户将能管理账号、白名单与系统配置</small></span></label>
            <button className={styles.primary} disabled={saving}><PlusOutlined /> {saving ? '正在添加…' : '加入白名单'}</button>
          </form>
          <div className={styles.tableCard}>
            <div className={styles.sectionHead}><div><span>REGISTRATION GATE</span><h2>注册名额</h2></div><p>{stats.pending} 个待使用名额</p></div>
            <div className={styles.inviteList}>{whitelist.length === 0 && <div className={styles.empty}>还没有添加白名单</div>}{whitelist.map(item => <article key={item.id}>
              <div className={`${styles.statusDot} ${item.used_at ? styles.used : ''}`} /><div><strong>{item.username}</strong><span>{item.grant_admin && <em><CrownOutlined /> 管理员</em>}{item.used_at ? `已由 ${item.used_by_username || item.username} 使用` : '等待注册'}</span></div><time>{formatDate(item.used_at || item.created_at)}</time>{!item.used_at && <button onClick={() => removeWhitelist(item.id)}><CloseOutlined /></button>}
            </article>)}</div>
          </div>
        </section>}

        {tab === 'data' && <section className={dataStyles.workspace}>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            hidden
            onChange={event => {
              const file = event.target.files?.[0]
              if (file) handleImportFile(file)
            }}
          />
          <div className={dataStyles.importCard}>
            <div className={dataStyles.importMark}><FileExcelOutlined /></div>
            <span className={dataStyles.kicker}>DATA INTAKE</span>
            <h2>导入校区地址数据</h2>
            <p>上传 Excel 或 CSV 文件后，先由 AI 识别字段并预览，再选择追加或覆盖写入地址台账。</p>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={importing}>
              <UploadOutlined /> {importing ? '正在读取文件…' : '选择 Excel / CSV'}
            </button>
            <small>支持 .xlsx、.xls、.csv</small>
          </div>

          <div className={dataStyles.sidePanel}>
            <div className={dataStyles.flowHead}>
              <span>IMPORT WORKFLOW</span>
              <h3>三步完成导入</h3>
            </div>
            <ol className={dataStyles.steps}>
              <li><b>01</b><div><strong>读取原始表格</strong><span>自动识别工作表与有效数据行</span></div></li>
              <li><b>02</b><div><strong>AI 解析字段</strong><span>统一省市区、地址、联系人等字段</span></div></li>
              <li><b>03</b><div><strong>确认写入方式</strong><span>预览结果后选择追加或覆盖数据</span></div></li>
            </ol>

            {rawRows.length > 0 ? (
              <div className={dataStyles.ready}>
                <RobotOutlined />
                <div><strong>{rawRows.length} 条数据等待解析</strong><span>文件已保存在当前浏览器会话中</span></div>
                <button type="button" onClick={() => setAiOpen(true)}>继续解析</button>
              </div>
            ) : (
              <div className={dataStyles.emptyState}><DatabaseOutlined /><span>选择文件后，解析任务会显示在这里</span></div>
            )}
          </div>
        </section>}

        {tab === 'settings' && settings && <form className={styles.configForm} onSubmit={saveSettings}>
          <div className={styles.configIntro}><ControlOutlined /><div><span>SYSTEM RUNTIME</span><h2>数据库配置优先于环境变量</h2><p>保存后无需重新部署；留空时仍可回退到服务器环境变量。</p></div><button className={styles.primary} disabled={saving}>{saving ? '保存中…' : '保存全部配置'}</button></div>
          <div className={styles.configSection}><div className={styles.configTitle}><b>AI</b><div><h3>智能解析服务</h3><p>OpenAI 兼容接口与批量处理参数</p></div></div><div className={styles.fieldGrid}>
            <Field label="API 接入地址" wide><input value={settings.apiBaseUrl} onChange={e => changeSetting('apiBaseUrl', e.target.value)} placeholder="https://example.com/v1" /></Field>
            <Field label="API 密钥" hint="已配置的密钥显示为 ********"><input type="password" value={settings.apiKey} onChange={e => changeSetting('apiKey', e.target.value)} placeholder="sk-..." /></Field>
            <Field label="模型"><input value={settings.model} onChange={e => changeSetting('model', e.target.value)} placeholder="gpt-5.5" /></Field>
            <Field label="单批条数"><input type="number" min="10" max="100" value={settings.batchSize} onChange={e => changeSetting('batchSize', e.target.value)} /></Field>
          </div></div>
          <div className={styles.configSection}><div className={styles.configTitle}><b>MAP</b><div><h3>高德地图</h3><p>浏览器地图与服务端地理编码凭证</p></div></div><div className={styles.fieldGrid}>
            <Field label="Web JS Key"><input value={settings.amapJsKey} onChange={e => changeSetting('amapJsKey', e.target.value)} /></Field>
            <Field label="JS 安全密钥"><input type="password" value={settings.amapSecurityCode} onChange={e => changeSetting('amapSecurityCode', e.target.value)} /></Field>
            <Field label="Web 服务 Key" hint="仅在服务端用于地理编码" wide><input type="password" value={settings.amapWebServiceKey} onChange={e => changeSetting('amapWebServiceKey', e.target.value)} /></Field>
          </div></div>
          <div className={styles.configSection}><div className={styles.configTitle}><b>UI</b><div><h3>界面默认值</h3><p>新设备首次打开时采用的显示偏好</p></div></div><div className={styles.fieldGrid}>
            <Field label="默认主题"><select value={settings.themeMode} onChange={e => changeSetting('themeMode', e.target.value)}><option value="light">浅色</option><option value="dark">深色</option></select></Field>
            <Field label="保护半径（公里）"><input type="number" min="1" max="5" value={settings.protectionRadiusKm} onChange={e => changeSetting('protectionRadiusKm', e.target.value)} /></Field>
            <div className={styles.toggleGrid}><label><Toggle checked={Boolean(settings.showProtection)} onChange={value => changeSetting('showProtection', value)} label="默认显示保护范围" /><span>默认显示保护范围</span></label></div>
          </div></div>
          <div className={styles.configSection}><div className={styles.configTitle}><b>DATA</b><div><h3>Umami 埋点</h3><p>动态加载统计脚本，无需重新构建</p></div></div><div className={styles.fieldGrid}>
            <Field label="Website ID"><input value={settings.umamiWebsiteId} onChange={e => changeSetting('umamiWebsiteId', e.target.value)} placeholder="xxxxxxxx-xxxx-..." /></Field>
            <Field label="埋点脚本 URL"><input value={settings.umamiScriptUrl} onChange={e => changeSetting('umamiScriptUrl', e.target.value)} placeholder="https://cloud.umami.is/script.js" /></Field>
            <Field label="Host URL"><input value={settings.umamiHostUrl} onChange={e => changeSetting('umamiHostUrl', e.target.value)} placeholder="自托管时填写" /></Field>
            <Field label="限定域名"><input value={settings.umamiDomains} onChange={e => changeSetting('umamiDomains', e.target.value)} placeholder="a.com,b.com" /></Field>
            <Field label="数据标签"><input value={settings.umamiTag} onChange={e => changeSetting('umamiTag', e.target.value)} /></Field>
            <div className={styles.toggleGrid}>{[['umamiAutoTrack','自动记录页面访问'],['umamiDoNotTrack','尊重 Do Not Track'],['umamiExcludeSearch','排除 URL 查询参数'],['umamiExcludeHash','排除 URL Hash']].map(([key,label]) => <label key={key}><Toggle checked={Boolean(settings[key])} onChange={value => changeSetting(key, value)} label={label} /><span>{label}</span></label>)}</div>
          </div></div>
        </form>}
      </main>

      <AiParseModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onImported={() => flash('地址数据已导入')}
      />

      {resetTarget && <div className={styles.modalBackdrop} onMouseDown={event => event.target === event.currentTarget && setResetTarget(null)}><form className={styles.modal} onSubmit={resetPassword}><button type="button" className={styles.modalClose} onClick={() => setResetTarget(null)}><CloseOutlined /></button><div className={styles.bigIcon}><LockOutlined /></div><span className={styles.kicker}>PASSWORD RESET</span><h2>重置 {resetTarget.username} 的密码</h2><p>新密码保存后立即生效，用户需使用新密码重新登录。</p><Field label="新密码"><input autoFocus type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} minLength={8} maxLength={128} placeholder="至少 8 位" required /></Field><button className={styles.primary} disabled={saving}>{saving ? '正在重置…' : '确认重置'}</button></form></div>}
    </div>
  )
}

export default function ConsolePage() {
  return <AntdApp><ConsolePageContent /></AntdApp>
}
