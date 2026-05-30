import * as XLSX from 'xlsx'

const COL_ALIASES = {
  province: ['省', '省份', 'province', '所在省'],
  city:     ['市', '城市', 'city', '所在市', '所在城市'],
  district: ['区', '区县', 'district', '所在区'],
  address:  ['地址', '详细地址', 'address', '校区地址', '门店地址'],
  industry: ['所属行业', '行业', 'industry'],
  source:   ['客户来源', '来源', 'source'],
  status:   ['流进状态', '状态', 'status'],
  name:     ['客户名称', '姓名', '名称', '校区名称', 'name'],
  company:  ['公司名称', '公司', '机构名称', 'company'],
  phone:    ['电话', '手机', '联系电话', 'phone', 'tel'],
}

function mapHeaders(headers) {
  const map = {}
  headers.forEach((h, i) => {
    const norm = String(h || '').trim()
    for (const [key, aliases] of Object.entries(COL_ALIASES)) {
      if (!(key in map) && aliases.some(a => norm.includes(a))) {
        map[key] = i
      }
    }
  })
  return map
}

function headerScore(colMap) {
  return Object.keys(colMap).length
}

function findHeaderRow(sheetData) {
  let bestIndex = 0
  let bestScore = 0
  // 找包含已知列名的行（比"3个非空"更精确）
  for (let i = 0; i < Math.min(sheetData.length, 40); i++) {
    const row = sheetData[i]
    if (!row) continue
    const headers = row.map(c => String(c || '').trim())
    const testMap = mapHeaders(headers)
    const score = headerScore(testMap)
    // 至少能识别出 city 或 address 才算有效表头
    if (score >= 2 && ('city' in testMap || 'address' in testMap) && score >= bestScore) {
      bestIndex = i
      bestScore = score
    }
  }
  return bestIndex
}

function isTemplateText(text) {
  return [
    '提示',
    '导入模板示例',
    '请勿修改',
    '请从下面表格开始填写',
    '从已有数据中选择',
    '覆盖导入时必填',
    '切勿改动表头',
    '开始填写要导入的信息',
  ].some(keyword => text.includes(keyword))
}

function isTemplateRow(row) {
  const cells = row.map(c => String(c || '').trim()).filter(Boolean)
  if (cells.length === 0) return true
  const joined = cells.join(' ')
  if (isTemplateText(joined)) return true

  const headerLikeCount = cells.reduce((count, cell) => {
    const norm = cell.replace(/[（(].*?[）)]/g, '').trim().toLowerCase()
    const isHeader = Object.values(COL_ALIASES).some(aliases =>
      aliases.some(alias => norm === String(alias).toLowerCase())
    )
    return count + (isHeader ? 1 : 0)
  }, 0)

  return headerLikeCount >= 2
}

export async function parseExcelFile(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const allRaw = []

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const sheetData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    if (!sheetData || sheetData.length < 2) continue

    const headerIdx = findHeaderRow(sheetData)
    const headers = sheetData[headerIdx].map(h => String(h || '').trim())
    const colMap = mapHeaders(headers)

    if (!('address' in colMap) && !('city' in colMap)) continue

    const get = (row, key) => {
      if (!(key in colMap)) return ''
      const v = row[colMap[key]]
      return v !== null && v !== undefined ? String(v).trim() : ''
    }

    for (let i = headerIdx + 1; i < sheetData.length; i++) {
      const row = sheetData[i]
      if (!row || !row.some(c => c)) continue
      if (isTemplateRow(row)) continue
      const address = get(row, 'address')
      const city = get(row, 'city')
      if (!address && !city) continue

      allRaw.push({
        _sheet:   sheetName,
        province: get(row, 'province'),
        city,
        district: get(row, 'district'),
        address,
        industry: get(row, 'industry'),
        source:   get(row, 'source'),
        status:   get(row, 'status'),
        name:     get(row, 'name'),
        company:  get(row, 'company'),
        phone:    get(row, 'phone'),
      })
    }
  }

  return allRaw
}
