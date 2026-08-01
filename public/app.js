/**
 * Витрина PAULEA для Telegram Mini App.
 * Чистый JavaScript, без сборки и библиотек.
 */

const state = {
  catalog: null,
  cart: [],
  selectedSize: null,
  sending: false,
  error: '',
  sort: 'new',
  sortOpen: false,
}

const app = document.getElementById('app')
const backBtn = document.getElementById('backBtn')
const cartBtn = document.getElementById('cartBtn')
const cartCount = document.getElementById('cartCount')
const shopName = document.getElementById('shopName')

// Фирменное написание названия магазина прописью
function wordmark(name) {
  const raw = String(name || '').trim()
  return raw.toLowerCase() === 'paulea' ? 'pauléa' : raw
}

let lastRoute = null

// -------------------------------------------------------------- Telegram

let tg = null

function waitForTelegram() {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      if (window.Telegram && window.Telegram.WebApp) return resolve(window.Telegram.WebApp)
      if (Date.now() - started > 1500) return resolve(null)
      setTimeout(tick, 50)
    }
    tick()
  })
}

function setupTelegram(webApp) {
  tg = webApp
  if (!tg) return
  tg.ready()
  tg.expand()
  if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes()
  if (typeof tg.setHeaderColor === 'function') {
    try {
      tg.setHeaderColor('#3c0e1b')
      tg.setBackgroundColor('#4a1222')
    } catch {}
  }
}

// ------------------------------------------------------------------ корзина

function loadCart() {
  try {
    state.cart = JSON.parse(localStorage.getItem('cart') || '[]')
  } catch {
    state.cart = []
  }
}

function saveCart() {
  localStorage.setItem('cart', JSON.stringify(state.cart))
  renderCartCount()
}

function addToCart(productId, size) {
  const existing = state.cart.find((i) => i.productId === productId && i.size === size)
  if (existing) existing.qty += 1
  else state.cart.push({ productId, size, qty: 1 })
  saveCart()
}

function removeFromCart(index) {
  state.cart.splice(index, 1)
  saveCart()
  render()
}

function cartTotal() {
  return state.cart.reduce((sum, line) => {
    const product = findProduct(line.productId)
    return product ? sum + product.price * line.qty : sum
  }, 0)
}

function renderCartCount() {
  const count = state.cart.reduce((n, i) => n + i.qty, 0)
  cartCount.textContent = String(count)
  cartCount.hidden = count === 0
}

// ------------------------------------------------------------------- данные

function findProduct(id) {
  return state.catalog.products.find((p) => p.id === id)
}

function money(value) {
  return value.toLocaleString('ru-RU') + ' ' + state.catalog.shop.currency
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

function imageOf(product) {
  return product.images && product.images[0] ? product.images[0] : '/photos/placeholder.svg'
}

function discountOf(product) {
  return product.oldPrice && product.oldPrice > product.price
    ? Math.round((1 - product.price / product.oldPrice) * 100)
    : 0
}

// Едва заметная плашка «Последний размер»: остался ровно один размер в наличии
function lastSizeBadgeHtml(product) {
  const settings = (state.catalog.shop && state.catalog.shop.lastSizeBadge) || {}
  if (settings.enabled === false) return ''

  const variants = product.variants || []
  const available = variants.filter((v) => v.stock > 0)
  if (available.length !== 1) return ''
  // Сумки и аксессуары с единым размером плашку не получают
  if (variants.length === 1 && variants[0].size === 'Один размер') return ''

  const text = settings.text || 'Последний размер'
  return `<div class="card__last"><span>${escapeHtml(text)}</span></div>`
}

// ----------------------------------------------------- общие блоки витрины

function bannersHtml() {
  const banners = state.catalog.banners || []
  if (banners.length === 0) {
    return `
      <div class="banner-empty">
        Место для акций.<br />
        Загрузите PNG в админке — вкладка «Акции».
      </div>`
  }
  return `
    <div class="banners">
      ${banners
        .map(
          (b) => `<div class="banner"><img src="${escapeHtml(b.image)}" alt="Акция" loading="lazy" /></div>`,
        )
        .join('')}
    </div>`
}

/** Три центральные кнопки: Новинки / Каталог / Акции. */
function navHtml(active) {
  const items = [
    { id: 'new', label: 'Новинки', hash: '/' },
    { id: 'catalog', label: 'Каталог', hash: '/catalog' },
    { id: 'sale', label: 'Акции', hash: '/sale' },
  ]
  return `
    <nav class="nav">
      ${items
        .map(
          (i) =>
            `<button class="nav__btn ${active === i.id ? 'nav__btn--active' : ''}" data-nav="${i.hash}">${i.label}</button>`,
        )
        .join('')}
    </nav>`
}

function footerHtml() {
  const { shop } = state.catalog
  return `
    <div class="footer">
      ${escapeHtml(shop.address)}<br />
      ${escapeHtml(shop.workingHours)}
    </div>`
}

function sectionTitle(text) {
  return `<div class="toolbar"><h2 class="toolbar__title">${escapeHtml(text)}</h2></div>`
}

// ------------------------------------------------------------------- экраны

function productCard(product) {
  const discount = discountOf(product)

  return `
    <button class="card" data-open="${product.id}">
      <div class="card__media">
        <img src="${escapeHtml(imageOf(product))}" alt="${escapeHtml(product.name)}" loading="lazy" />
        <div class="badges">
          ${discount ? `<span class="badge">−${discount}%</span>` : ''}
          ${product.isHit ? '<span class="badge badge--hit">🔥 Хит</span>' : ''}
          ${product.isNew ? '<span class="badge badge--new">New</span>' : ''}
          ${!product.inStock ? '<span class="badge badge--out">Раскуплено</span>' : ''}
        </div>
        ${lastSizeBadgeHtml(product)}
      </div>
      <div class="card__name">${escapeHtml(product.name)}</div>
      <div class="card__price">
        ${money(product.price)}
        ${product.oldPrice ? `<span class="card__old">${money(product.oldPrice)}</span>` : ''}
      </div>
    </button>`
}

function gridHtml(list, emptyText) {
  return list.length
    ? `<div class="grid">${list.map(productCard).join('')}</div>`
    : `<div class="empty">${escapeHtml(emptyText)}</div>`
}

/** Главная: только новинки. */
function renderNew() {
  const products = state.catalog.products
  const list = products.filter((p) => p.isNew)

  app.innerHTML = `
    ${bannersHtml()}
    ${navHtml('new')}
    ${sectionTitle('Новинки')}
    ${gridHtml(list.length ? list : products, 'Новинок пока нет')}
    ${footerHtml()}`
}

/** Каталог: список категорий, раскрывающийся сверху вниз. */
function renderCatalogList() {
  const { categories, products } = state.catalog

  app.innerHTML = `
    ${navHtml('catalog')}
    ${sectionTitle('Каталог')}

    <div class="cats">
      ${categories
        .map((c) => {
          const inCategory = products.filter((p) => p.categoryId === c.id)
          const cover = inCategory[0] ? imageOf(inCategory[0]) : '/photos/placeholder.svg'
          return `
            <button class="cat" data-cat="${c.id}">
              <img class="cat__img" src="${escapeHtml(cover)}" alt="" loading="lazy" />
              <span class="cat__name">${escapeHtml(c.name)}</span>
              <span class="cat__count">${inCategory.length}</span>
              <span class="cat__arrow">→</span>
            </button>`
        })
        .join('')}
    </div>

    ${footerHtml()}`
}

// ---------------------------------------------------------------- сортировка

const SORTS = [
  { id: 'new', label: 'Сначала новинки' },
  { id: 'price_asc', label: 'Сначала дешевле' },
  { id: 'price_desc', label: 'Сначала дороже' },
  { id: 'hit', label: 'Сначала хиты' },
]

function currentSort() {
  return SORTS.find((s) => s.id === state.sort) || SORTS[0]
}

/** Возвращает новый отсортированный массив, не трогая исходный. */
function sortProducts(list) {
  const items = list.slice()
  const price = (p) => Number(p.price) || 0

  if (state.sort === 'price_asc') items.sort((a, b) => price(a) - price(b))
  else if (state.sort === 'price_desc') items.sort((a, b) => price(b) - price(a))
  else if (state.sort === 'hit') items.sort((a, b) => Number(!!b.isHit) - Number(!!a.isHit))
  else items.sort((a, b) => Number(!!b.isNew) - Number(!!a.isNew))

  return items
}

/** Кнопка сортировки и её выпадающее меню. */
function sortHtml() {
  return `
    <div class="sort">
      <button class="sort__btn ${state.sortOpen ? 'sort__btn--open' : ''}" data-sort-toggle="1">
        <span class="sort__label">${escapeHtml(currentSort().label)}</span>
        <span class="sort__caret">⌄</span>
      </button>
      ${
        state.sortOpen
          ? `<div class="sort__menu">
              ${SORTS.map(
                (s) =>
                  `<button class="sort__item ${s.id === state.sort ? 'sort__item--active' : ''}" data-sort="${s.id}">${escapeHtml(s.label)}</button>`,
              ).join('')}
            </div>`
          : ''
      }
    </div>`
}

/** Товары одной категории. */
function renderCategory(categoryId) {
  const { categories, products } = state.catalog
  const category = categories.find((c) => c.id === categoryId)
  const list = sortProducts(products.filter((p) => p.categoryId === categoryId))

  app.innerHTML = `
    ${navHtml('catalog')}
    <div class="toolbar toolbar--sort">
      <h2 class="toolbar__title">${escapeHtml(category ? category.name : 'Каталог')}</h2>
      ${sortHtml()}
    </div>
    ${gridHtml(list, 'В этой категории пока пусто')}
    ${footerHtml()}`
}

/** Акции: картинки акций и товары со скидкой. */
function renderSale() {
  const list = state.catalog.products.filter((p) => discountOf(p) > 0)

  app.innerHTML = `
    ${navHtml('sale')}
    ${sectionTitle('Акции и скидки')}
    ${gridHtml(list, 'Сейчас скидок нет — загляните позже')}
    ${footerHtml()}`
}

function sizeButtonsHtml(product) {
  return product.variants
    .map((v) => {
      if (v.stock <= 0) return `<button class="size size--out" disabled>${escapeHtml(v.size)}</button>`
      const active = state.selectedSize === v.size ? 'size--active' : ''
      return `<button class="size ${active}" data-size="${escapeHtml(v.size)}">${escapeHtml(v.size)}</button>`
    })
    .join('')
}

function renderProduct(productId) {
  const product = findProduct(productId)
  if (!product) return renderNew()

  const available = product.variants.filter((v) => v.stock > 0)
  if (state.selectedSize && !available.some((v) => v.size === state.selectedSize)) {
    state.selectedSize = null
  }

  // Сумки и аксессуары: размер один, выбор не показываем.
  const oneSize = product.variants.length === 1 && product.variants[0].size === 'Один размер'
  if (oneSize && available.length) state.selectedSize = product.variants[0].size

  const discount = discountOf(product)

  const images = product.images && product.images.length ? product.images : ['/photos/placeholder.svg']
  state.images = images

  app.innerHTML = `
    <div class="gallery">
      <div class="gallery__track" id="galleryTrack">
        ${images
          .map(
            (src, i) => `
              <div class="gallery__slide">
                <img src="${escapeHtml(src)}" alt="${escapeHtml(product.name)}" data-zoom="${i}" />
              </div>`,
          )
          .join('')}
      </div>
      <div class="badges">
        ${discount ? `<span class="badge">−${discount}%</span>` : ''}
        ${product.isHit ? '<span class="badge badge--hit">🔥 Хит</span>' : ''}
        ${product.isNew ? '<span class="badge badge--new">New</span>' : ''}
      </div>
      ${images.length > 1 ? `<div class="gallery__count" id="galleryCount">1 / ${images.length}</div>` : ''}
    </div>
    ${
      images.length > 1
        ? `<div class="dots" id="galleryDots">${images
            .map((_, i) => `<span class="dot ${i === 0 ? 'dot--active' : ''}"></span>`)
            .join('')}</div>`
        : ''
    }

    <h2 class="product__title">${escapeHtml(product.name)}</h2>
    <div class="product__price">
      ${money(product.price)}
      ${product.oldPrice ? `<span class="product__old">${money(product.oldPrice)}</span>` : ''}
    </div>

    ${
      oneSize
        ? ''
        : `<div class="label">Размер</div>
           <div class="sizes" id="sizes">${sizeButtonsHtml(product)}</div>`
    }

    <div id="addWrap">
      ${
        available.length === 0
          ? '<div class="notice">Все размеры раскуплены. Напишите нам — возможно, привезём под заказ.</div>'
          : addButtonHtml()
      }
    </div>

    ${
      product.description
        ? `<div class="desc">
             <div class="desc__title">Описание</div>
             <p>${escapeHtml(product.description)}</p>
           </div>`
        : ''
    }

    ${
      product.composition
        ? `<div class="compo">
             <span class="compo__label">Состав</span>
             <span class="compo__value">${escapeHtml(product.composition)}</span>
           </div>`
        : ''
    }`

  setupGallery()
}

/** Счётчик и точки под галереей товара. */
/**
 * Жёсткое правило: на последнем фото свайп влево (дальше) не работает,
 * на первом — свайп вправо. Лента физически не сдвигается за край.
 */
function blockEdgeSwipe(track) {
  let startX = null
  let startY = null
  let locked = false

  track.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length > 1) {
        startX = null
        return
      }
      startX = event.touches[0].clientX
      startY = event.touches[0].clientY
      locked = false
    },
    { passive: true },
  )

  track.addEventListener(
    'touchmove',
    (event) => {
      if (startX === null || event.touches.length > 1) return
      const dx = event.touches[0].clientX - startX
      const dy = event.touches[0].clientY - startY
      if (!locked && Math.abs(dx) < Math.abs(dy)) return

      const max = track.scrollWidth - track.clientWidth
      const atEnd = track.scrollLeft >= max - 1
      const atStart = track.scrollLeft <= 1

      if ((dx < 0 && atEnd) || (dx > 0 && atStart)) {
        locked = true
        if (event.cancelable) event.preventDefault()
      }
    },
    { passive: false },
  )

  track.addEventListener(
    'touchend',
    () => {
      startX = null
      locked = false
    },
    { passive: true },
  )
}

function setupGallery() {
  const track = document.getElementById('galleryTrack')
  if (!track) return
  const count = document.getElementById('galleryCount')
  const dots = document.getElementById('galleryDots')

  blockEdgeSwipe(track)

  // Листание полностью нативное — только обновляем счётчик и точки
  track.addEventListener('scroll', () => {
    const index = Math.round(track.scrollLeft / track.clientWidth)
    if (count) count.textContent = index + 1 + ' / ' + state.images.length
    if (dots) {
      Array.from(dots.children).forEach((dot, i) => {
        dot.classList.toggle('dot--active', i === index)
      })
    }
  })
}

/** Полноэкранный просмотр: листание свайпом, тап — приблизить. */
function openLightbox(startIndex) {
  const images = state.images || []
  if (!images.length) return

  const box = document.createElement('div')
  box.className = 'lb'
  const pad = (n) => String(n).padStart(2, '0')

  box.innerHTML = `
    <div class="lb__bar">
      ${
        images.length > 1
          ? `<div class="lb__count">
               <span class="lb__num">${pad(startIndex + 1)}</span>
               <span class="lb__sep"></span>
               <span class="lb__total">${pad(images.length)}</span>
             </div>`
          : ''
      }
      <button class="lb__close" type="button" aria-label="Закрыть">✕</button>
    </div>
    <div class="lb__track">
      ${images
        .map(
          (src) => `
            <div class="lb__slide">
              <img class="lb__img" src="${escapeHtml(src)}" alt="" />
            </div>`,
        )
        .join('')}
    </div>
    ${
      images.length > 1
        ? '<div class="lb__hint">Листайте влево или вправо</div>'
        : ''
    }`

  document.body.appendChild(box)
  document.body.classList.add('no-scroll')

  const track = box.querySelector('.lb__track')
  const number = box.querySelector('.lb__num')
  track.scrollLeft = startIndex * track.clientWidth

  const currentIndex = () =>
    Math.max(0, Math.min(images.length - 1, Math.round(track.scrollLeft / track.clientWidth)))

  // Доводчик только для краёв: если ленту потянули дальше последнего
  // (или перед первым) фото — возвращаем кадр на место.
  // Обычное листание между кадрами остаётся нативным и легким.
  const settleEdge = () => {
    const max = (images.length - 1) * track.clientWidth
    if (track.scrollLeft > max + 1) {
      track.scrollTo({ left: max, behavior: 'smooth' })
    } else if (track.scrollLeft < -1) {
      track.scrollTo({ left: 0, behavior: 'smooth' })
    }
  }

  blockEdgeSwipe(track)

  track.addEventListener('scroll', () => {
    if (number) number.textContent = pad(currentIndex() + 1)
  })

  const close = () => {
    box.remove()
    document.body.classList.remove('no-scroll')
  }

  box.querySelector('.lb__close').addEventListener('click', close)

  // Запасное листание свайпом: если Telegram перехватывает жесты,
  // сами перелистываем на соседнее фото
  let startX = null
  let startY = null
  let multi = false

  const goTo = (index) => {
    const safe = Math.max(0, Math.min(images.length - 1, index))
    track.scrollTo({ left: safe * track.clientWidth, behavior: 'smooth' })
    if (number) number.textContent = pad(safe + 1)
  }

  track.addEventListener(
    'touchstart',
    (event) => {
      multi = event.touches.length > 1
      startX = event.touches[0].clientX
      startY = event.touches[0].clientY
    },
    { passive: true },
  )

  track.addEventListener(
    'touchcancel',
    () => {
      startX = null
      setTimeout(settleEdge, 80)
    },
    { passive: true },
  )

  track.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length > 1) multi = true
    },
    { passive: true },
  )

  track.addEventListener(
    'touchend',
    (event) => {
      if (multi || startX === null) {
        startX = null
        return setTimeout(settleEdge, 80)
      }
      const touch = event.changedTouches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      startX = null
      const current = currentIndex()
      const atEdge =
        (dx < 0 && current === images.length - 1) || (dx > 0 && current === 0)
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) || atEdge) {
        return setTimeout(settleEdge, 60)
      }
      goTo(dx < 0 ? current + 1 : current - 1)
    },
    { passive: true },
  )
}

function addButtonHtml() {
  return `<button class="btn" id="addBtn" ${state.selectedSize ? '' : 'disabled'}>
            ${state.selectedSize ? 'Добавить в корзину' : 'Выберите размер'}
          </button>`
}

/** Обновляет только ряд размеров и кнопку — страница не перерисовывается и не прокручивается. */
function updateSizeSelection(size) {
  state.selectedSize = size

  const sizes = document.getElementById('sizes')
  if (sizes) {
    for (const button of sizes.querySelectorAll('.size')) {
      button.classList.toggle('size--active', button.dataset.size === size)
    }
  }

  const addBtn = document.getElementById('addBtn')
  if (addBtn) {
    addBtn.disabled = false
    addBtn.textContent = 'Добавить в корзину'
  }
}

/** Иконка корзины для кнопки «Убрать». */
function trashIcon() {
  return `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="M4 7h16" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
      <path d="M9.5 4.5h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
      <path d="M6.5 7l.8 11.2A1.8 1.8 0 0 0 9.1 20h5.8a1.8 1.8 0 0 0 1.8-1.8L17.5 7"
        stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M10.4 10.6v6M13.6 10.6v6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
    </svg>`
}

function renderCart() {
  if (state.cart.length === 0) {
    app.innerHTML = `
      <div class="empty">
        Корзина пуста<br /><br />
        <button class="btn btn--ghost" data-go="home" style="max-width:260px">В каталог</button>
      </div>`
    return
  }

  const lines = state.cart
    .map((line, index) => {
      const product = findProduct(line.productId)
      if (!product) return ''
      return `
        <div class="line">
          <div class="line__media"><img src="${escapeHtml(imageOf(product))}" alt="" /></div>
          <div class="line__body">
            <div class="line__name">${escapeHtml(product.name)}</div>
            <div class="line__meta">Размер ${escapeHtml(line.size)} · ${line.qty} шт. · ${money(product.price * line.qty)}</div>
          </div>
          <button class="line__remove" data-remove="${index}" type="button"
            aria-label="Убрать из заявки" title="Убрать из заявки">
            ${trashIcon()}
          </button>
        </div>`
    })
    .join('')

  app.innerHTML = `
    <div class="toolbar"><h2 class="toolbar__title">Ваша заявка</h2></div>
    ${lines}
    <div class="total"><span>Итого</span><b>${money(cartTotal())}</b></div>

    ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ''}

    <div class="notice">
      Оплачивать здесь ничего не нужно. Мы перезвоним, подтвердим наличие и вместе выберем способ доставки.
    </div>

    <div class="field">
      <label for="name">Ваше имя</label>
      <input class="input--name" id="name" type="text" autocomplete="name"
        placeholder="Как к вам обращаться" value="" />
    </div>

    <div class="field">
      <label for="phone">Телефон для связи</label>
      <input class="input--phone" id="phone" type="tel" inputmode="tel" autocomplete="tel"
        placeholder="+7 (900) 000-00-00" value="${escapeHtml(formatPhone(localStorage.getItem('phone') || ''))}" />
    </div>

    <div class="field">
      <label for="telegram">Ваш Telegram для связи</label>
      <input class="input--tag" id="telegram" type="text" autocapitalize="off" autocomplete="off" spellcheck="false"
        placeholder="@username" value="${escapeHtml(localStorage.getItem('telegram') || '')}" />
      <div class="field__hint">Укажите ник — напишем вам в Telegram, если не дозвонимся</div>
    </div>

    <div class="field">
      <label for="comment">Комментарий</label>
      <textarea id="comment" placeholder="Город, удобное время звонка, вопросы по размеру"></textarea>
    </div>

    <button class="btn" id="sendBtn" ${state.sending ? 'disabled' : ''}>
      ${state.sending ? 'Отправляем…' : 'Отправить заявку'}
    </button>
    <button class="btn btn--ghost" data-go="home">Продолжить покупки</button>`

  setupCartForm()
}

// Цифры номера без кода страны: максимум 10 штук
function phoneDigits(raw) {
  let digits = String(raw || '').replace(/\D/g, '')
  if (digits[0] === '8' || digits[0] === '7') digits = digits.slice(1)
  return digits.slice(0, 10)
}

// Собирает вид +7 (917) 767-92-25; «+7» есть всегда
function formatPhoneDigits(digits) {
  let out = '+7'
  if (digits.length) out += ' (' + digits.slice(0, 3)
  if (digits.length >= 3) out += ')'
  if (digits.length > 3) out += ' ' + digits.slice(3, 6)
  if (digits.length > 6) out += '-' + digits.slice(6, 8)
  if (digits.length > 8) out += '-' + digits.slice(8, 10)
  return out
}

// Для отправки: пусто, если цифр нет
function formatPhone(raw) {
  const digits = phoneDigits(raw)
  return digits ? formatPhoneDigits(digits) : ''
}

// Ник всегда с собачкой в начале
function telegramBody(raw) {
  return String(raw || '')
    .replace(/^https?:\/\//i, '')
    .replace(/^t\.me\//i, '')
    .replace(/[^A-Za-z0-9_]/g, '')
    .slice(0, 32)
}

// Для отправки: пусто, если кроме собачки ничего нет
function formatTelegram(raw) {
  const body = telegramBody(raw)
  return body ? '@' + body : ''
}

function setupCartForm() {
  const phone = document.getElementById('phone')
  if (phone) {
    let previous = phone.value

    const applyPhone = (isDelete) => {
      let digits = phoneDigits(phone.value)
      // Если стёрли скобку или дефис — убираем последнюю цифру
      if (isDelete && formatPhoneDigits(digits) === previous) digits = digits.slice(0, -1)
      phone.value = formatPhoneDigits(digits)
      previous = phone.value
      const end = phone.value.length
      try {
        phone.setSelectionRange(end, end)
      } catch {}
    }

    phone.addEventListener('focus', () => {
      if (!phone.value) {
        phone.value = '+7'
        previous = phone.value
      }
    })

    phone.addEventListener('input', (event) => {
      const isDelete = Boolean(event.inputType) && event.inputType.indexOf('delete') === 0
      applyPhone(isDelete)
    })

    phone.addEventListener('blur', () => {
      if (!phoneDigits(phone.value)) {
        phone.value = ''
        previous = ''
      }
    })
  }

  const telegram = document.getElementById('telegram')
  if (telegram) {
    const applyTag = () => {
      telegram.value = '@' + telegramBody(telegram.value)
      const end = telegram.value.length
      try {
        telegram.setSelectionRange(end, end)
      } catch {}
    }

    telegram.addEventListener('focus', () => {
      if (!telegram.value) telegram.value = '@'
    })

    telegram.addEventListener('input', applyTag)

    telegram.addEventListener('blur', () => {
      if (!telegramBody(telegram.value)) telegram.value = ''
    })
  }
}

function renderDone(number) {
  app.innerHTML = `
    <div class="done">
      <div class="done__mark">✓</div>
      <h2>Заявка ${escapeHtml(number)} отправлена</h2>
      <p>Менеджер свяжется с вами в течение рабочего дня.</p>
    </div>
    <button class="btn btn--ghost" data-go="home">Вернуться в каталог</button>`
}

// ----------------------------------------------------------------- роутинг

function render() {
  const hash = location.hash.slice(1) || '/'
  const [, section, param] = hash.split('/')

  backBtn.hidden = hash === '/'
  if (tg && tg.BackButton) {
    if (hash === '/') tg.BackButton.hide()
    else tg.BackButton.show()
  }

  if (section === 'catalog') renderCatalogList()
  else if (section === 'sale') renderSale()
  else if (section === 'c') renderCategory(param)
  else if (section === 'p') renderProduct(param)
  else if (section === 'cart') renderCart()
  else if (section === 'done') renderDone(decodeURIComponent(param || ''))
  else renderNew()

  // Прокручиваем наверх только при смене экрана.
  if (hash !== lastRoute) {
    window.scrollTo(0, 0)
    lastRoute = hash
  }
}

function go(hash) {
  if (location.hash.slice(1) === hash || (hash === '/' && !location.hash)) render()
  else location.hash = hash
}

// ------------------------------------------------------------- отправка

/** Перезагружает каталог с сервера (актуальные остатки размеров). */
async function refreshCatalog() {
  try {
    const response = await fetch('/api/catalog', { cache: 'no-store' })
    const fresh = await response.json()
    if (fresh && Array.isArray(fresh.products)) state.catalog = fresh
  } catch {}
}

async function sendOrder() {
  const name = String((document.getElementById('name') || {}).value || '')
    .trim()
    .slice(0, 80)
  const phone = formatPhone((document.getElementById('phone') || {}).value || '')
  const telegram = formatTelegram((document.getElementById('telegram') || {}).value || '')
  const comment = (document.getElementById('comment') || {}).value || ''

  if (phoneDigits(phone).length < 10) {
    state.error = 'Укажите, пожалуйста, корректный номер телефона.'
    return render()
  }

  localStorage.setItem('phone', phone)
  localStorage.setItem('telegram', telegram)
  state.error = ''
  state.sending = true
  render()

  try {
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: state.cart,
        name,
        phone,
        telegram,
        comment,
        initData: tg ? tg.initData : '',
      }),
    })
    const result = await response.json()

    if (!response.ok) {
      state.error = result.error || 'Не удалось отправить заявку. Попробуйте ещё раз.'
      state.sending = false
      return render()
    }

    state.cart = []
    saveCart()
    state.sending = false
    // Остатки уже списаны на сервере — подтягиваем свежий каталог
    await refreshCatalog()
    if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success')
    go('/done/' + encodeURIComponent(result.number))
  } catch {
    state.error = 'Сервер недоступен. Проверьте, что запущена команда node server.js'
    state.sending = false
    render()
  }
}

// -------------------------------------------------------------- обработчики

app.addEventListener('click', (event) => {
  const target = event.target.closest(
    '[data-open], [data-nav], [data-cat], [data-size], [data-remove], [data-go], [data-zoom], [data-sort], [data-sort-toggle], #addBtn, #sendBtn',
  )
  if (!target) return

  if (target.dataset.sortToggle) {
    state.sortOpen = !state.sortOpen
    return render()
  }
  if (target.dataset.sort) {
    state.sort = target.dataset.sort
    state.sortOpen = false
    try {
      localStorage.setItem('sort', state.sort)
    } catch {}
    return render()
  }

  if (target.dataset.zoom !== undefined && target.dataset.zoom !== '') {
    return openLightbox(Number(target.dataset.zoom))
  }

  if (target.dataset.nav) return go(target.dataset.nav)
  if (target.dataset.cat) return go('/c/' + target.dataset.cat)
  if (target.dataset.open) {
    state.selectedSize = null
    return go('/p/' + target.dataset.open)
  }
  if (target.dataset.go === 'home') return go('/')
  if (target.dataset.remove !== undefined && target.dataset.remove !== '') {
    return removeFromCart(Number(target.dataset.remove))
  }
  if (target.dataset.size) return updateSizeSelection(target.dataset.size)
  if (target.id === 'addBtn') {
    const productId = location.hash.split('/')[2]
    addToCart(productId, state.selectedSize)
    if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light')
    return go('/cart')
  }
  if (target.id === 'sendBtn') return sendOrder()
})

// Название магазина всегда ведёт на главную.
shopName.addEventListener('click', () => {
  if (location.hash && location.hash !== '#/') location.hash = '/'
  else {
    render()
    window.scrollTo(0, 0)
  }
})

// Клик мимо меню сортировки его закрывает.
document.addEventListener('click', (event) => {
  if (!state.sortOpen) return
  if (event.target.closest('.sort')) return
  state.sortOpen = false
  render()
})

backBtn.addEventListener('click', () => history.back())
cartBtn.addEventListener('click', () => go('/cart'))
window.addEventListener('hashchange', render)

// ------------------------------------------------------------------- старт

async function init() {
  setupTelegram(await waitForTelegram())
  if (tg && tg.BackButton) tg.BackButton.onClick(() => history.back())

  try {
    const savedSort = localStorage.getItem('sort')
    if (savedSort && SORTS.some((s) => s.id === savedSort)) state.sort = savedSort
  } catch {}

  loadCart()
  renderCartCount()

  try {
    const response = await fetch('/api/catalog')
    state.catalog = await response.json()
  } catch {
    app.innerHTML = '<div class="empty">Не удалось загрузить каталог.<br />Запущена ли команда node server.js?</div>'
    return
  }

  shopName.textContent = wordmark(state.catalog.shop.name)
  document.title = state.catalog.shop.name
  render()
}

init()
