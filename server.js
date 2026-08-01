'use strict'

/**
 * Telegram Mini App — витрина магазина одежды.
 * Заказы без онлайн-оплаты: клиент оставляет заявку, менеджер связывается сам.
 *
 * Зависимостей нет. Нужен только Node.js 18+.
 * Запуск:  node server.js
 */

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = __dirname
const PUBLIC_DIR = path.join(ROOT, 'public')
const DB_PATH = path.join(ROOT, 'data', 'db.json')

// ---------------------------------------------------------------- окружение

function loadEnv() {
  const file = path.join(ROOT, '.env')
  if (!fs.existsSync(file)) return
  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnv()

const PORT = Number(process.env.PORT || 3000)
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const MANAGER_CHAT_ID = process.env.TELEGRAM_MANAGER_CHAT_ID || ''
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin'
const ALLOW_BROWSER = String(process.env.ALLOW_BROWSER || 'true') === 'true'

// ---------------------------------------------------------------- база (JSON)

let db = null

function readDb() {
  if (!db) db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'))
  return db
}

function saveDb() {
  const tmp = DB_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8')
  fs.renameSync(tmp, DB_PATH)
}

function nextId(prefix) {
  return prefix + '_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex')
}

// ------------------------------------------------- проверка подписи Telegram

/**
 * Telegram передаёт в мини-апп строку initData с HMAC-подписью.
 * Ей нельзя доверять без проверки: иначе кто угодно отправит заявку от чужого имени.
 * Документация: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function verifyInitData(initData) {
  if (!initData) return null
  if (!BOT_TOKEN) return null

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n')

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest()
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  if (computed !== hash) return null

  const authDate = Number(params.get('auth_date') || 0)
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null

  try {
    return JSON.parse(params.get('user') || 'null')
  } catch {
    return null
  }
}

// ------------------------------------------------------------- уведомления

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function sendTelegram(chatId, text) {
  if (!BOT_TOKEN || !chatId) return false
  try {
    const api = 'https' + '://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage'
    const res = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    })
    const json = await res.json()
    if (!json.ok) console.error('Telegram API:', json.description)
    return json.ok === true
  } catch (err) {
    console.error('Не удалось отправить сообщение в Telegram:', err.message)
    return false
  }
}

function formatOrderForManager(order) {
  const lines = []
  lines.push(`<b>🛍 Новая заявка ${escapeHtml(order.number)}</b>`)
  lines.push('')
  for (const item of order.items) {
    lines.push(
      `• ${escapeHtml(item.title)} — размер <b>${escapeHtml(item.size)}</b> × ${item.qty} — ${item.price * item.qty} ₽`,
    )
  }
  lines.push('')
  lines.push(`<b>Итого: ${order.total} ₽</b>`)
  lines.push('')
  lines.push(`Клиент: ${escapeHtml(order.customer.name || '—')}`)
  if (order.customer.username) lines.push(`Telegram: @${escapeHtml(order.customer.username)}`)
  if (order.customer.phone) lines.push(`Телефон: ${escapeHtml(order.customer.phone)}`)
  if (order.customer.telegram) lines.push(`Telegram клиента: ${escapeHtml(order.customer.telegram)}`)
  if (order.comment) lines.push(`Комментарий: ${escapeHtml(order.comment)}`)
  return lines.join('\n')
}

// ------------------------------------------------------------------ хелперы

function json(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 12_000_000) reject(new Error('Слишком большой запрос'))
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new Error('Некорректный JSON'))
      }
    })
    req.on('error', reject)
  })
}

function isAdmin(req) {
  return req.headers['x-admin-password'] === ADMIN_PASSWORD
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname)
  if (rel === '/') rel = '/index.html'
  const filePath = path.join(PUBLIC_DIR, rel)
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden')
    return
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Страница не найдена')
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    })
    fs.createReadStream(filePath).pipe(res)
  })
}

// ------------------------------------------------------------------- каталог

function publicCatalog() {
  const data = readDb()
  const categories = data.categories
    .filter((c) => c.isActive !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  const products = data.products
    .filter((p) => p.isActive !== false)
    .map((p) => ({
      ...p,
      inStock: p.variants.some((v) => v.stock > 0),
    }))

  const banners = (data.banners || []).filter((b) => b.isActive !== false)

  const badge = (data.shop && data.shop.lastSizeBadge) || {}
  const shop = {
    ...data.shop,
    lastSizeBadge: {
      enabled: badge.enabled !== false,
      text: String(badge.text || 'Последний размер').slice(0, 40),
    },
  }

  return { shop, categories, products, banners }
}

// -------------------------------------------------------------------- заявки

async function createOrder(req, res) {
  const body = await readBody(req)
  const data = readDb()

  const tgUser = verifyInitData(body.initData)
  if (!tgUser && !ALLOW_BROWSER) {
    return json(res, 401, { error: 'Откройте приложение внутри Telegram' })
  }

  const items = Array.isArray(body.items) ? body.items : []
  if (items.length === 0) return json(res, 400, { error: 'Корзина пуста' })

  const resolved = []
  for (const line of items) {
    const product = data.products.find((p) => p.id === line.productId)
    if (!product) return json(res, 400, { error: 'Товар не найден' })
    const variant = product.variants.find((v) => v.size === line.size)
    if (!variant) return json(res, 400, { error: 'Размер не найден' })

    const qty = Math.max(1, Math.min(Number(line.qty) || 1, variant.stock || 1))
    if (!variant.stock) {
      return json(res, 409, { error: `«${product.name}» в размере ${variant.size} уже нет в наличии` })
    }

    // Цену всегда берём из базы, а не из корзины клиента.
    resolved.push({
      productId: product.id,
      title: product.name,
      size: variant.size,
      qty,
      price: product.price,
    })
  }

  const total = resolved.reduce((sum, i) => sum + i.price * i.qty, 0)
  const number = '#' + String(data.orderCounter + 1).padStart(4, '0')

  const order = {
    id: nextId('ord'),
    number,
    createdAt: new Date().toISOString(),
    status: 'new',
    customer: {
      tgId: tgUser ? tgUser.id : null,
      name:
        String(body.name || '').trim().slice(0, 80) ||
        (tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') : '') ||
        'Без имени',
      username: tgUser ? tgUser.username || '' : '',
      phone: String(body.phone || '').slice(0, 32),
      telegram: String(body.telegram || '').slice(0, 64),
    },
    comment: String(body.comment || '').slice(0, 500),
    items: resolved,
    total,
  }

  // Списываем остатки: купленный размер сразу уходит с витрины
  for (const item of resolved) {
    const product = data.products.find((p) => p.id === item.productId)
    if (!product) continue
    const variant = product.variants.find((v) => v.size === item.size)
    if (!variant) continue
    variant.stock = Math.max(0, (Number(variant.stock) || 0) - item.qty)
  }
  order.stockApplied = true

  data.orders.unshift(order)
  data.orderCounter += 1
  saveDb()

  const sent = await sendTelegram(MANAGER_CHAT_ID, formatOrderForManager(order))
  if (!sent) {
    console.log('\n--- НОВАЯ ЗАЯВКА (Telegram не настроен, показываю здесь) ---')
    console.log(formatOrderForManager(order).replace(/<[^>]+>/g, ''))
    console.log('------------------------------------------------------------\n')
  }

  // Автоответ клиенту в Telegram не отправляем: подтверждение он
  // видит на самой витрине, а в бот уходит только уведомление менеджеру.

  return json(res, 200, { ok: true, number: order.number, total })
}

// ------------------------------------------------------------------- роутинг

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http' + '://' + req.headers.host)
  const { pathname } = url

  try {
    if (pathname === '/api/catalog' && req.method === 'GET') {
      return json(res, 200, publicCatalog())
    }

    if (pathname === '/api/orders' && req.method === 'POST') {
      return await createOrder(req, res)
    }

    // ------------------------------------------------------------- админка
    if (pathname.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return json(res, 401, { error: 'Неверный пароль' })
      const data = readDb()

      if (pathname === '/api/admin/state' && req.method === 'GET') {
        return json(res, 200, {
          shop: data.shop,
          categories: data.categories,
          products: data.products,
          orders: data.orders,
          banners: data.banners || [],
          photos: fs.existsSync(path.join(PUBLIC_DIR, 'photos'))
            ? fs
                .readdirSync(path.join(PUBLIC_DIR, 'photos'))
                .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
                .map((f) => '/photos/' + f)
            : [],
          telegramConfigured: Boolean(BOT_TOKEN && MANAGER_CHAT_ID),
        })
      }

      // Настройки плашки «Последний размер»
      if (pathname === '/api/admin/last-size-badge' && req.method === 'POST') {
        const body = await readBody(req)
        data.shop = data.shop || {}
        const text = String(body.text || '').slice(0, 40).trim()
        data.shop.lastSizeBadge = {
          enabled: body.enabled !== false,
          text: text || 'Последний размер',
        }
        saveDb()
        return json(res, 200, { ok: true, lastSizeBadge: data.shop.lastSizeBadge })
      }

      if (pathname === '/api/admin/order-status' && req.method === 'POST') {
        const body = await readBody(req)
        const order = data.orders.find((o) => o.id === body.id)
        if (!order) return json(res, 404, { error: 'Заявка не найдена' })
        const wasCancelled = order.status === 'cancelled'
        order.status = body.status

        // Отменили заявку — вещи возвращаются на витрину
        if (!wasCancelled && order.status === 'cancelled' && order.stockApplied) {
          for (const item of order.items) {
            const product = data.products.find((p) => p.id === item.productId)
            if (!product) continue
            const variant = product.variants.find((v) => v.size === item.size)
            if (!variant) continue
            variant.stock = Math.max(0, (Number(variant.stock) || 0) + item.qty)
          }
          order.stockApplied = false
        }

        // Сняли отмену — снова списываем
        if (wasCancelled && order.status !== 'cancelled' && !order.stockApplied) {
          for (const item of order.items) {
            const product = data.products.find((p) => p.id === item.productId)
            if (!product) continue
            const variant = product.variants.find((v) => v.size === item.size)
            if (!variant) continue
            variant.stock = Math.max(0, (Number(variant.stock) || 0) - item.qty)
          }
          order.stockApplied = true
        }

        saveDb()
        return json(res, 200, { ok: true })
      }

      if (pathname === '/api/admin/product' && req.method === 'POST') {
        const body = await readBody(req)
        const p = body.product
        if (!p || !p.name) return json(res, 400, { error: 'Нужно название товара' })

        const clean = {
          id: p.id || nextId('prd'),
          categoryId: p.categoryId,
          name: String(p.name).slice(0, 120),
          description: String(p.description || '').slice(0, 2000),
          composition: String(p.composition || '').slice(0, 200),
          price: Math.max(0, Number(p.price) || 0),
          oldPrice: p.oldPrice ? Number(p.oldPrice) : null,
          images: Array.isArray(p.images) ? p.images.slice(0, 8) : [],
          variants: (Array.isArray(p.variants) ? p.variants : []).map((v) => ({
            size: String(v.size).slice(0, 24),
            stock: Math.max(0, Number(v.stock) || 0),
          })),
          isActive: p.isActive !== false,
          isHit: p.isHit === true,
          isNew: p.isNew === true,
        }

        const index = data.products.findIndex((x) => x.id === clean.id)
        if (index === -1) data.products.push(clean)
        else data.products[index] = clean

        saveDb()
        return json(res, 200, { ok: true, product: clean })
      }

      // Загрузка фото товара: браузер присылает картинку в base64.
      if (pathname === '/api/admin/photo-upload' && req.method === 'POST') {
        const body = await readBody(req)
        const match = String(body.dataUrl || '').match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/)
        if (!match) return json(res, 400, { error: 'Подойдёт файл PNG, JPG или WebP' })

        const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
        const buffer = Buffer.from(match[2], 'base64')
        if (buffer.length > 8 * 1024 * 1024) return json(res, 400, { error: 'Файл больше 8 МБ' })

        const dir = path.join(PUBLIC_DIR, 'photos')
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

        const fileName = nextId('img') + '.' + ext
        fs.writeFileSync(path.join(dir, fileName), buffer)
        return json(res, 200, { ok: true, image: '/photos/' + fileName })
      }

      // Загрузка баннера с акцией: браузер присылает картинку в base64.
      if (pathname === '/api/admin/banner-upload' && req.method === 'POST') {
        const body = await readBody(req)
        const match = String(body.dataUrl || '').match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/)
        if (!match) return json(res, 400, { error: 'Подойдёт файл PNG, JPG или WebP' })

        const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
        const buffer = Buffer.from(match[2], 'base64')
        if (buffer.length > 8 * 1024 * 1024) return json(res, 400, { error: 'Файл больше 8 МБ' })

        const dir = path.join(PUBLIC_DIR, 'banners')
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

        const fileName = nextId('bnr') + '.' + ext
        fs.writeFileSync(path.join(dir, fileName), buffer)

        const banner = {
          id: nextId('ban'),
          image: '/banners/' + fileName,
          link: String(body.link || '').slice(0, 200),
          isActive: true,
        }
        if (!data.banners) data.banners = []
        data.banners.push(banner)
        saveDb()
        return json(res, 200, { ok: true, banner })
      }

      if (pathname === '/api/admin/banner-delete' && req.method === 'POST') {
        const body = await readBody(req)
        const banner = (data.banners || []).find((b) => b.id === body.id)
        if (banner) {
          const file = path.join(PUBLIC_DIR, banner.image.replace(/^\//, ''))
          if (file.startsWith(PUBLIC_DIR) && fs.existsSync(file)) fs.unlinkSync(file)
          data.banners = data.banners.filter((b) => b.id !== body.id)
          saveDb()
        }
        return json(res, 200, { ok: true })
      }

      if (pathname === '/api/admin/product-delete' && req.method === 'POST') {
        const body = await readBody(req)
        data.products = data.products.filter((p) => p.id !== body.id)
        saveDb()
        return json(res, 200, { ok: true })
      }

      // Создание или переименование категории.
      if (pathname === '/api/admin/category' && req.method === 'POST') {
        const body = await readBody(req)
        const c = body.category
        if (!c || !String(c.name || '').trim()) {
          return json(res, 400, { error: 'Нужно название категории' })
        }

        const name = String(c.name).trim().slice(0, 60)
        const existing = data.categories.find((x) => x.id === c.id)

        if (existing) {
          existing.name = name
          if (c.isActive !== undefined) existing.isActive = c.isActive !== false
        } else {
          const maxOrder = data.categories.reduce((m, x) => Math.max(m, Number(x.sortOrder) || 0), 0)
          data.categories.push({
            id: nextId('cat'),
            name,
            sortOrder: maxOrder + 1,
            isActive: c.isActive !== false,
          })
        }

        saveDb()
        return json(res, 200, { ok: true, categories: data.categories })
      }

      // Удаление категории. Если в ней есть товары, нужно сказать, что с ними делать:
      // moveTo = id другой категории, или deleteProducts = true.
      if (pathname === '/api/admin/category-delete' && req.method === 'POST') {
        const body = await readBody(req)
        const category = data.categories.find((c) => c.id === body.id)
        if (!category) return json(res, 404, { error: 'Категория не найдена' })
        if (data.categories.length <= 1) {
          return json(res, 400, { error: 'Нужна хотя бы одна категория' })
        }

        const inside = data.products.filter((p) => p.categoryId === body.id)
        if (inside.length && !body.moveTo && body.deleteProducts !== true) {
          return json(res, 409, {
            error: 'В категории есть товары',
            productCount: inside.length,
          })
        }

        if (inside.length && body.deleteProducts === true) {
          data.products = data.products.filter((p) => p.categoryId !== body.id)
        } else if (inside.length) {
          const target = data.categories.find((c) => c.id === body.moveTo)
          if (!target) return json(res, 400, { error: 'Куда перенести товары?' })
          for (const product of data.products) {
            if (product.categoryId === body.id) product.categoryId = target.id
          }
        }

        data.categories = data.categories.filter((c) => c.id !== body.id)
        saveDb()
        return json(res, 200, { ok: true, categories: data.categories })
      }

      // Порядок категорий в витрине: выше / ниже.
      if (pathname === '/api/admin/category-move' && req.method === 'POST') {
        const body = await readBody(req)
        const sorted = data.categories
          .slice()
          .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0))
        const index = sorted.findIndex((c) => c.id === body.id)
        if (index === -1) return json(res, 404, { error: 'Категория не найдена' })

        const target = body.direction === 'up' ? index - 1 : index + 1
        if (target >= 0 && target < sorted.length) {
          const tmp = sorted[index]
          sorted[index] = sorted[target]
          sorted[target] = tmp
        }
        sorted.forEach((c, i) => {
          c.sortOrder = i + 1
        })
        data.categories = sorted
        saveDb()
        return json(res, 200, { ok: true, categories: data.categories })
      }

      return json(res, 404, { error: 'Неизвестный метод' })
    }

    if (req.method === 'GET') return serveStatic(req, res, pathname)

    res.writeHead(405).end('Method Not Allowed')
  } catch (err) {
    console.error(err)
    json(res, 500, { error: err.message || 'Внутренняя ошибка' })
  }
})

server.listen(PORT, () => {
  console.log('')
  console.log('  ✅  Витрина запущена')
  console.log('')
  console.log(`      Магазин:  http://localhost:${PORT}`)
  console.log(`      Админка:  http://localhost:${PORT}/admin.html`)
  console.log(`      Пароль админки: ${ADMIN_PASSWORD}`)
  console.log('')
  if (!BOT_TOKEN || !MANAGER_CHAT_ID) {
    console.log('  ℹ️   Telegram не настроен — заявки будут печататься здесь, в терминале.')
    console.log('      Чтобы включить уведомления, заполните .env (см. README.md).')
    console.log('')
  }
  console.log('  Остановить: Ctrl + C')
  console.log('')
})
