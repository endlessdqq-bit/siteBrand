/** Админка PAULEA: заявки, товары с редактором размеров, акции. */

const root = document.getElementById('admin')
let password = localStorage.getItem('adminPassword') || ''
let data = null
let tab = 'orders'
let draft = null // редактируемый товар
let formError = ''

const ONE_SIZE = 'Один размер'
const MAX_IMAGES = 8

const STATUS = {
  new: 'Новая',
  contacted: 'Связались',
  confirmed: 'Подтверждена',
  done: 'Выдана',
  cancelled: 'Отмена',
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

function isOneSize(product) {
  return product.variants.length === 1 && product.variants[0].size === ONE_SIZE
}

async function api(path, body) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': password },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (response.status === 401) throw new Error('unauthorized')
  return response.json()
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.readAsDataURL(file)
  })
}

// Золотое правило витрины: любое фото товара приводим к 3:4 (900×1200).
// Кадрируем по центру по ширине и от верха по высоте — голова модели не срезается.
function cropTo34(dataUrl) {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const W = 900
      const H = 1200
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)

      const scale = Math.max(W / image.width, H / image.height)
      const drawWidth = image.width * scale
      const drawHeight = image.height * scale
      const dx = (W - drawWidth) / 2
      const dy = drawHeight > H ? 0 : (H - drawHeight) / 2

      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(image, dx, dy, drawWidth, drawHeight)
      resolve(canvas.toDataURL('image/jpeg', 0.86))
    }
    image.onerror = () => resolve(dataUrl)
    image.src = dataUrl
  })
}

async function readPhotoAs34(file) {
  return cropTo34(await readFileAsDataUrl(file))
}

// --------------------------------------------------------------------- вход

function renderLogin(message) {
  root.innerHTML = `
    <div class="panel" style="max-width:420px;margin:48px auto">
      <h2>Вход в админку</h2>
      ${message ? `<div class="error">${escapeHtml(message)}</div>` : ''}
      <div class="field">
        <label for="pwd">Пароль из файла .env</label>
        <input id="pwd" type="password" placeholder="admin" />
      </div>
      <button class="btn btn--wide" id="loginBtn">Войти</button>
    </div>`

  document.getElementById('loginBtn').onclick = () => {
    password = document.getElementById('pwd').value
    localStorage.setItem('adminPassword', password)
    load()
  }
  document.getElementById('pwd').onkeydown = (e) => {
    if (e.key === 'Enter') document.getElementById('loginBtn').click()
  }
}

// ------------------------------------------------------------------ заявки

function orderCard(order) {
  const tagClass = order.status === 'done' ? 'tag--done' : order.status === 'cancelled' ? 'tag--cancel' : ''
  const when = new Date(order.createdAt).toLocaleString('ru-RU')

  return `
    <div class="panel">
      <div class="row row--between">
        <strong>Заявка ${escapeHtml(order.number)}</strong>
        <span class="tag ${tagClass}">${escapeHtml(STATUS[order.status] || order.status)}</span>
      </div>
      <p class="muted">${escapeHtml(when)}</p>
      <ul style="padding-left:20px;margin:12px 0">
        ${order.items
          .map(
            (i) =>
              `<li>${escapeHtml(i.title)} — ${escapeHtml(i.size)} × ${i.qty} — ${i.price * i.qty} ₽</li>`,
          )
          .join('')}
      </ul>
      <p><b>Итого: ${order.total} ₽</b></p>
      <p>
        ${escapeHtml(order.customer.name)}
        ${order.customer.username ? ' · @' + escapeHtml(order.customer.username) : ''}
        ${order.customer.phone ? ' · ' + escapeHtml(order.customer.phone) : ''}
        ${order.customer.telegram ? ' · ' + escapeHtml(order.customer.telegram) : ''}
      </p>
      ${order.comment ? `<p class="muted">Комментарий: ${escapeHtml(order.comment)}</p>` : ''}
      <div class="row" style="margin-top:12px">
        ${Object.keys(STATUS)
          .map(
            (key) =>
              `<button class="chip ${order.status === key ? 'chip--active' : ''}" data-status="${key}" data-order="${order.id}">${STATUS[key]}</button>`,
          )
          .join('')}
      </div>
    </div>`
}

// ------------------------------------------------------------------ товары

function productRow(product) {
  const sizes = isOneSize(product)
    ? `Без размера · остаток ${product.variants[0].stock}`
    : product.variants.map((v) => `${escapeHtml(v.size)} — ${v.stock}`).join(' · ')

  return `
    <div class="prod-row">
      <img src="${escapeHtml(product.images[0] || '/photos/placeholder.svg')}" alt="" />
      <div style="flex:1;min-width:0">
        <div><b>${escapeHtml(product.name)}</b></div>
        <div class="muted">
          ${product.price} ₽${product.oldPrice ? ' · было ' + product.oldPrice + ' ₽' : ''}
          ${product.isHit ? ' · 🔥 хит' : ''}${product.isNew ? ' · новинка' : ''}
          ${product.isActive === false ? ' · скрыт' : ''}
        </div>
        <div class="muted">${sizes}</div>
        <div class="row" style="margin-top:10px">
          <button class="chip" data-edit="${product.id}">Редактировать</button>
          <button class="chip" data-del="${product.id}">Удалить</button>
        </div>
      </div>
    </div>`
}

/** Настройка плашки «Последний размер». */
function lastSizePanel() {
  const badge = (data.shop && data.shop.lastSizeBadge) || {}
  const enabled = badge.enabled !== false
  const text = badge.text || 'Последний размер'

  return `
    <div class="panel">
      <h3 style="margin:0 0 6px">Плашка «Последний размер»</h3>
      <p class="muted">Появляется на фото товара в каталоге, когда в наличии остался ровно один размер.
        Считается автоматически по остаткам размеров.</p>

      <label class="check">
        <input id="lsb-on" type="checkbox" ${enabled ? 'checked' : ''} />
        Показывать плашку в витрине
      </label>

      <div class="field" style="margin-top:12px">
        <label for="lsb-text">Текст плашки</label>
        <input id="lsb-text" type="text" maxlength="40" value="${escapeHtml(text)}" placeholder="Последний размер" />
      </div>

      <div class="row" style="margin-top:12px">
        <button class="btn" data-lsb-save="1">Сохранить плашку</button>
        <span id="lsb-status" class="muted"></span>
      </div>
    </div>`
}

function productsPanel() {
  return `
    ${lastSizePanel()}
    <div class="panel">
      <div class="row row--between">
        <h3 style="margin:0">Товары (${data.products.length})</h3>
        <button class="btn" data-new="1">+ Добавить товар</button>
      </div>
      <p class="muted">Нажмите «Редактировать», чтобы изменить цену, фото, описание и размеры.</p>
      ${data.products.map(productRow).join('')}
    </div>`
}

// ------------------------------------------------------- редактор товара

function emptyDraft() {
  return {
    id: '',
    categoryId: data.categories[0] ? data.categories[0].id : '',
    name: '',
    description: '',
    composition: '',
    price: 0,
    oldPrice: null,
    images: [],
    variants: [
      { size: 'S', stock: 1 },
      { size: 'M', stock: 1 },
      { size: 'L', stock: 1 },
    ],
    isActive: true,
    isHit: false,
    isNew: true,
  }
}

function sizeRow(variant, index) {
  const off = variant.stock <= 0
  return `
    <div class="size-row ${off ? 'size-row--off' : ''}">
      <input type="text" value="${escapeHtml(variant.size)}" data-size-name="${index}" placeholder="Размер" />
      <div class="stepper">
        <button type="button" data-step="-1" data-index="${index}">−</button>
        <input type="number" min="0" value="${variant.stock}" data-stock="${index}" />
        <button type="button" data-step="1" data-index="${index}">+</button>
      </div>
      <button type="button" class="size-del" data-size-del="${index}" aria-label="Удалить">×</button>
    </div>`
}

function editorPanel() {
  const oneSize = draft.variants.length === 1 && draft.variants[0].size === ONE_SIZE
  const photos = data.photos || []

  return `
    <div class="panel">
      <h3>${draft.id ? 'Редактирование товара' : 'Новый товар'}</h3>
      ${formError ? `<div class="error">${escapeHtml(formError)}</div>` : ''}

      <div class="field">
        <label for="f-name">Название</label>
        <input id="f-name" type="text" value="${escapeHtml(draft.name)}" placeholder="Например: Сумка кожаная чёрная" />
      </div>

      <div class="field">
        <label for="f-cat">Категория</label>
        <select id="f-cat">
          ${data.categories
            .map(
              (c) =>
                `<option value="${c.id}" ${draft.categoryId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`,
            )
            .join('')}
        </select>
      </div>

      <div class="grid2">
        <div class="field">
          <label for="f-price">Цена, ₽</label>
          <input id="f-price" type="number" min="0" value="${draft.price || ''}" />
        </div>
        <div class="field">
          <label for="f-old">Старая цена (для скидки)</label>
          <input id="f-old" type="number" min="0" value="${draft.oldPrice || ''}" />
        </div>
      </div>

      <div class="field">
        <label for="f-desc">Описание</label>
        <textarea id="f-desc" placeholder="Коротко о модели, посадке, длине">${escapeHtml(draft.description)}</textarea>
      </div>

      <div class="field">
        <label for="f-comp">Состав</label>
        <input id="f-comp" type="text" value="${escapeHtml(draft.composition)}" placeholder="100% хлопок" />
      </div>

      <div class="field">
        <label>Фото товара (${draft.images.length} из ${MAX_IMAGES})</label>
        <p class="muted" style="margin:0 0 10px">Первое фото — главное, именно оно видно в каталоге. Стрелки меняют порядок, × удаляет фото из карточки.</p>
        <div class="shots">
          ${
            draft.images.length
              ? draft.images
                  .map(
                    (src, i) => `
                      <div class="shot">
                        <img src="${escapeHtml(src)}" alt="" />
                        ${i === 0 ? '<span class="shot__main">Главное</span>' : ''}
                        <button type="button" class="shot__del" data-img-del="${i}" title="Удалить">×</button>
                        <div class="shot__move">
                          <button type="button" data-img-left="${i}" ${i === 0 ? 'disabled' : ''}>←</button>
                          <button type="button" data-img-right="${i}" ${i === draft.images.length - 1 ? 'disabled' : ''}>→</button>
                        </div>
                      </div>`,
                  )
                  .join('')
              : '<span class="muted">Фото пока нет</span>'
          }
        </div>
        <input id="photoFile" type="file" accept="image/png,image/jpeg,image/webp" multiple />
        <div id="photoStatus" class="muted"></div>
        ${
          photos.length
            ? `<p class="muted" style="margin:12px 0 6px">Или выберите из уже загруженных:</p>
               <div class="photos">
                 ${photos
                   .map(
                     (src) =>
                       `<button type="button" class="photo photo--pick" data-img-add="${escapeHtml(src)}"><img src="${escapeHtml(src)}" alt="" /></button>`,
                   )
                   .join('')}
               </div>`
            : ''
        }
      </div>

      <div class="field">
        <label>Размеры и остатки</label>
        <div class="row" style="margin-bottom:10px">
          <button type="button" class="chip ${oneSize ? '' : 'chip--active'}" data-mode="sizes">С размерами</button>
          <button type="button" class="chip ${oneSize ? 'chip--active' : ''}" data-mode="one">Без размера (сумки, аксессуары)</button>
        </div>

        ${
          oneSize
            ? `<div class="sizes-editor">
                 <div class="size-row">
                   <div><b>Один размер</b><div class="muted">в витрине выбор размера не показывается</div></div>
                   <div class="stepper">
                     <button type="button" data-step="-1" data-index="0">−</button>
                     <input type="number" min="0" value="${draft.variants[0].stock}" data-stock="0" />
                     <button type="button" data-step="1" data-index="0">+</button>
                   </div>
                   <div></div>
                 </div>
               </div>
               <p class="muted" style="margin-top:8px">Остаток 0 — товар показывается как «Раскуплено».</p>`
            : `<div class="sizes-editor">
                 ${draft.variants.map(sizeRow).join('') || '<div class="size-row"><span class="muted">Размеров пока нет</span><div></div><div></div></div>'}
               </div>
               <p class="muted" style="margin-top:8px">Остаток 0 — размер в витрине зачёркнут и его нельзя выбрать.</p>
               <div class="presets">
                 <button type="button" class="chip" data-add-size="1">+ Размер</button>
                 <button type="button" class="chip" data-preset="letters">XS S M L XL</button>
                 <button type="button" class="chip" data-preset="numbers">42 44 46 48 50</button>
                 <button type="button" class="chip" data-preset="jeans">26 27 28 29 30</button>
               </div>`
        }
      </div>

      <div class="row">
        <label class="check"><input type="checkbox" id="f-hit" ${draft.isHit ? 'checked' : ''} /> 🔥 Хит продаж</label>
        <label class="check"><input type="checkbox" id="f-new" ${draft.isNew ? 'checked' : ''} /> Новинка</label>
        <label class="check"><input type="checkbox" id="f-active" ${draft.isActive !== false ? 'checked' : ''} /> Показывать в витрине</label>
      </div>

      <div class="row" style="margin-top:16px">
        <button class="btn" data-save="1">Сохранить</button>
        <button class="btn btn--ghost" data-cancel="1">Отмена</button>
        ${draft.id ? '<button class="btn btn--danger" data-del="' + draft.id + '">Удалить товар</button>' : ''}
      </div>
    </div>`
}

/** Забирает значения из полей в draft, чтобы ничего не терялось при перерисовке. */
function collectForm() {
  if (!draft) return
  const value = (id) => {
    const el = document.getElementById(id)
    return el ? el.value : ''
  }
  const checked = (id) => {
    const el = document.getElementById(id)
    return el ? el.checked : false
  }

  if (!document.getElementById('f-name')) return

  draft.name = value('f-name')
  draft.categoryId = value('f-cat')
  draft.price = Number(value('f-price')) || 0
  draft.oldPrice = Number(value('f-old')) || null
  draft.description = value('f-desc')
  draft.composition = value('f-comp')
  draft.isHit = checked('f-hit')
  draft.isNew = checked('f-new')
  draft.isActive = checked('f-active')

  for (const input of document.querySelectorAll('[data-size-name]')) {
    const index = Number(input.dataset.sizeName)
    if (draft.variants[index]) draft.variants[index].size = input.value
  }
  for (const input of document.querySelectorAll('[data-stock]')) {
    const index = Number(input.dataset.stock)
    if (draft.variants[index]) draft.variants[index].stock = Math.max(0, Number(input.value) || 0)
  }
}

// ------------------------------------------------------------------ акции

function bannersPanel() {
  const banners = data.banners || []
  return `
    <div class="panel">
      <h3>Картинки акций</h3>
      <p class="muted">Загрузите PNG или JPG — они появятся в самом верху витрины. Лучше горизонтальные, например 1200×600. До 8 МБ.</p>
      <input id="bannerFile" type="file" accept="image/png,image/jpeg,image/webp" />
      <div id="bannerStatus" class="muted" style="margin-top:8px"></div>

      ${
        banners.length
          ? banners
              .map(
                (b) => `
                <div class="prod-row">
                  <img src="${escapeHtml(b.image)}" alt="" style="border-radius:12px" />
                  <div style="flex:1;min-width:0">
                    <div class="muted">${escapeHtml(b.image)}</div>
                    <button class="chip" data-banner-delete="${b.id}" style="margin-top:8px">Удалить</button>
                  </div>
                </div>`,
              )
              .join('')
          : '<p class="muted">Пока нет ни одной акции.</p>'
      }
    </div>`
}

// ------------------------------------------------------------- категории

function categoriesPanel() {
  const list = data.categories
    .slice()
    .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0))

  return `
    <div class="panel">
      <h3>Категории (${list.length})</h3>
      <p class="muted">Название можно менять прямо в строке — после правки нажмите «Сохранить». Стрелки меняют порядок в витрине.</p>

      <div class="field">
        <label for="newCategory">Новая категория</label>
        <input id="newCategory" type="text" placeholder="Например: Сумки" />
      </div>
      <button class="btn btn--wide" data-cat-add="1">+ Добавить категорию</button>

      ${list
        .map((c, i) => {
          const count = data.products.filter((p) => p.categoryId === c.id).length
          const hidden = c.isActive === false
          return `
            <div class="cat-row ${hidden ? 'cat-row--off' : ''}">
              <div class="cat-row__top">
                <input type="text" data-cat-name="${c.id}" value="${escapeHtml(c.name)}" />
                <div class="cat-row__order">
                  <button class="chip" data-cat-up="${c.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
                  <button class="chip" data-cat-down="${c.id}" ${i === list.length - 1 ? 'disabled' : ''}>↓</button>
                </div>
              </div>
              <div class="cat-row__meta">Товаров: ${count}${hidden ? ' · скрыта в витрине' : ''}</div>
              <div class="row">
                <button class="btn" data-cat-save="${c.id}">Сохранить</button>
                <button class="btn btn--ghost" data-cat-hide="${c.id}">${hidden ? 'Показать' : 'Скрыть'}</button>
                <button class="btn btn--danger" data-cat-del="${c.id}">Удалить</button>
              </div>
            </div>`
        })
        .join('')}
    </div>`
}

// ---------------------------------------------------------------- отрисовка

function render() {
  const newCount = data.orders.filter((o) => o.status === 'new').length

  root.innerHTML = `
    ${
      data.telegramConfigured
        ? ''
        : '<div class="notice" style="margin-top:16px">Telegram не настроен — заявки пока видны только здесь и в терминале. Заполните файл .env, чтобы получать их в чат.</div>'
    }

    <div class="tabs">
      <button class="chip ${tab === 'orders' ? 'chip--active' : ''}" data-tab="orders">Заявки ${newCount ? '(' + newCount + ')' : ''}</button>
      <button class="chip ${tab === 'products' ? 'chip--active' : ''}" data-tab="products">Товары</button>
      <button class="chip ${tab === 'categories' ? 'chip--active' : ''}" data-tab="categories">Категории</button>
      <button class="chip ${tab === 'banners' ? 'chip--active' : ''}" data-tab="banners">Акции</button>
    </div>

    ${
      tab === 'orders'
        ? data.orders.length
          ? data.orders.map(orderCard).join('')
          : '<div class="panel"><p class="muted" style="margin:0">Заявок пока нет.</p></div>'
        : tab === 'products'
          ? draft
            ? editorPanel()
            : productsPanel()
          : tab === 'categories'
            ? categoriesPanel()
            : bannersPanel()
    }`
}

// -------------------------------------------------------------- обработчики

root.addEventListener('click', async (event) => {
  const target = event.target.closest('button')
  if (!target) return
  const d = target.dataset

  if (d.tab) {
    collectForm()
    tab = d.tab
    return render()
  }

  if (d.status) {
    await api('/api/admin/order-status', { id: d.order, status: d.status })
    return load()
  }

  if (d.lsbSave) {
    const status = document.getElementById('lsb-status')
    const on = document.getElementById('lsb-on')
    const textField = document.getElementById('lsb-text')
    if (status) status.textContent = 'Сохраняем…'
    const result = await api('/api/admin/last-size-badge', {
      enabled: on ? on.checked : true,
      text: textField ? textField.value : '',
    })
    if (result && result.lastSizeBadge) {
      data.shop = data.shop || {}
      data.shop.lastSizeBadge = result.lastSizeBadge
    }
    if (status) status.textContent = 'Сохранено'
    return render()
  }

  if (d.bannerDelete) {
    await api('/api/admin/banner-delete', { id: d.bannerDelete })
    return load()
  }

  if (d.catAdd) {
    const input = document.getElementById('newCategory')
    const name = input ? input.value.trim() : ''
    if (!name) return alert('Введите название категории')
    const result = await api('/api/admin/category', { category: { name } })
    if (result.error) return alert(result.error)
    return load()
  }

  if (d.catSave) {
    const input = document.querySelector('[data-cat-name="' + d.catSave + '"]')
    const name = input ? input.value.trim() : ''
    if (!name) return alert('Название не может быть пустым')
    const result = await api('/api/admin/category', { category: { id: d.catSave, name } })
    if (result.error) return alert(result.error)
    return load()
  }

  if (d.catHide) {
    const category = data.categories.find((c) => c.id === d.catHide)
    const input = document.querySelector('[data-cat-name="' + d.catHide + '"]')
    await api('/api/admin/category', {
      category: {
        id: d.catHide,
        name: input ? input.value.trim() : category.name,
        isActive: category.isActive === false,
      },
    })
    return load()
  }

  if (d.catUp || d.catDown) {
    await api('/api/admin/category-move', {
      id: d.catUp || d.catDown,
      direction: d.catUp ? 'up' : 'down',
    })
    return load()
  }

  if (d.catDel) {
    const category = data.categories.find((c) => c.id === d.catDel)
    if (!confirm('Удалить категорию «' + (category ? category.name : '') + '»?')) return

    let result = await api('/api/admin/category-delete', { id: d.catDel })

    // В категории есть товары — спрашиваем, куда их деть.
    if (result.productCount) {
      const others = data.categories.filter((c) => c.id !== d.catDel)
      const listText = others.map((c, i) => i + 1 + ' — ' + c.name).join('\n')
      const answer = prompt(
        'В категории ' + result.productCount + ' товар(ов).\n' +
          'Введите номер категории, куда их перенести,\nили слово УДАЛИТЬ, чтобы удалить товары вместе с категорией:\n\n' +
          listText,
      )
      if (!answer) return

      if (answer.trim().toUpperCase() === 'УДАЛИТЬ') {
        result = await api('/api/admin/category-delete', { id: d.catDel, deleteProducts: true })
      } else {
        const target = others[Number(answer.trim()) - 1]
        if (!target) return alert('Такого номера нет')
        result = await api('/api/admin/category-delete', { id: d.catDel, moveTo: target.id })
      }
    }

    if (result.error) return alert(result.error)
    return load()
  }

  if (d.new) {
    draft = emptyDraft()
    formError = ''
    render()
    return window.scrollTo(0, 0)
  }

  if (d.edit) {
    const product = data.products.find((p) => p.id === d.edit)
    draft = JSON.parse(JSON.stringify(product))
    formError = ''
    render()
    return window.scrollTo(0, 0)
  }

  if (d.cancel) {
    draft = null
    return render()
  }

  if (d.del) {
    const product = data.products.find((p) => p.id === d.del)
    if (!confirm('Удалить «' + (product ? product.name : 'товар') + '»?')) return
    await api('/api/admin/product-delete', { id: d.del })
    draft = null
    return load()
  }

  if (d.mode) {
    collectForm()
    if (d.mode === 'one') draft.variants = [{ size: ONE_SIZE, stock: draft.variants[0] ? draft.variants[0].stock : 1 }]
    else if (draft.variants.length === 1 && draft.variants[0].size === ONE_SIZE) {
      draft.variants = [
        { size: 'S', stock: 1 },
        { size: 'M', stock: 1 },
        { size: 'L', stock: 1 },
      ]
    }
    return render()
  }

  if (d.addSize) {
    collectForm()
    draft.variants.push({ size: '', stock: 1 })
    return render()
  }

  if (d.preset) {
    collectForm()
    const presets = {
      letters: ['XS', 'S', 'M', 'L', 'XL'],
      numbers: ['42', '44', '46', '48', '50'],
      jeans: ['26', '27', '28', '29', '30'],
    }
    draft.variants = presets[d.preset].map((size) => {
      const existing = draft.variants.find((v) => v.size === size)
      return { size, stock: existing ? existing.stock : 1 }
    })
    return render()
  }

  if (d.sizeDel !== undefined && d.sizeDel !== '') {
    collectForm()
    draft.variants.splice(Number(d.sizeDel), 1)
    return render()
  }

  if (d.step) {
    collectForm()
    const variant = draft.variants[Number(d.index)]
    if (variant) variant.stock = Math.max(0, variant.stock + Number(d.step))
    return render()
  }

  if (d.imgDel !== undefined && d.imgDel !== '') {
    collectForm()
    draft.images.splice(Number(d.imgDel), 1)
    return render()
  }

  if (d.imgLeft !== undefined && d.imgLeft !== '') {
    collectForm()
    const i = Number(d.imgLeft)
    if (i > 0) {
      const moved = draft.images.splice(i, 1)[0]
      draft.images.splice(i - 1, 0, moved)
    }
    return render()
  }

  if (d.imgRight !== undefined && d.imgRight !== '') {
    collectForm()
    const i = Number(d.imgRight)
    if (i < draft.images.length - 1) {
      const moved = draft.images.splice(i, 1)[0]
      draft.images.splice(i + 1, 0, moved)
    }
    return render()
  }

  if (d.imgAdd) {
    collectForm()
    if (draft.images.length >= MAX_IMAGES) {
      return alert('Максимум ' + MAX_IMAGES + ' фото на карточку')
    }
    if (!draft.images.includes(d.imgAdd)) draft.images.push(d.imgAdd)
    return render()
  }

  if (d.save) {
    collectForm()
    if (!draft.name.trim()) {
      formError = 'Укажите название товара'
      return render()
    }
    draft.variants = draft.variants.filter((v) => String(v.size).trim())
    if (draft.variants.length === 0) {
      formError = 'Добавьте хотя бы один размер или выберите «Без размера»'
      return render()
    }

    const result = await api('/api/admin/product', { product: draft })
    if (result.error) {
      formError = result.error
      return render()
    }
    draft = null
    formError = ''
    return load()
  }
})

root.addEventListener('change', async (event) => {
  const banner = event.target.closest('#bannerFile')
  if (banner) {
    const chosen = banner.files && banner.files[0]
    if (!chosen) return
    document.getElementById('bannerStatus').textContent = 'Загружаем…'
    const result = await api('/api/admin/banner-upload', { dataUrl: await readFileAsDataUrl(chosen) })
    if (result.error) {
      document.getElementById('bannerStatus').textContent = result.error
      return
    }
    return load()
  }

  const photo = event.target.closest('#photoFile')
  if (photo) {
    const chosen = Array.from(photo.files || [])
    if (!chosen.length) return
    collectForm()

    const status = document.getElementById('photoStatus')
    if (!data.photos) data.photos = []

    for (let i = 0; i < chosen.length; i++) {
      if (draft.images.length >= MAX_IMAGES) {
        status.textContent = 'Максимум ' + MAX_IMAGES + ' фото на карточку — остальные не добавил.'
        break
      }
      status.textContent = 'Готовим фото ' + (i + 1) + ' из ' + chosen.length + ' в формате 3:4…'
      const result = await api('/api/admin/photo-upload', { dataUrl: await readPhotoAs34(chosen[i]) })
      if (result.error) {
        status.textContent = result.error
        return
      }
      draft.images.push(result.image)
      data.photos.push(result.image)
    }

    return render()
  }
})

async function load() {
  if (!password) return renderLogin()
  try {
    data = await api('/api/admin/state')
    render()
  } catch (err) {
    localStorage.removeItem('adminPassword')
    password = ''
    renderLogin(err.message === 'unauthorized' ? 'Неверный пароль' : 'Сервер недоступен')
  }
}

load()
