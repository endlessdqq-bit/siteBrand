/* ===================================================================
   Тӑван.wear — приём заявок на сервере.
   Без сторонних пакетов: только встроенные модули Node.js 18+.
   • POST /api/order  — принять заявку, сохранить на сервере (в РФ),
                        отправить менеджеру в Telegram.
   • GET  /api/health — проверка, что сервис жив.
   Цены и наличие берутся из products.json на сервере, а не из запроса.
   Настройки — в /etc/tavan.env (TG_BOT_TOKEN, TG_CHAT_ID).
=================================================================== */
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT      = +process.env.PORT || 3000;
const SITE_DIR  = process.env.SITE_DIR || "/var/www/tavan";
const DATA_DIR  = process.env.DATA_DIR || "/var/lib/tavan";
const BOT_TOKEN = process.env.TG_BOT_TOKEN || "";
const CHAT_ID   = process.env.TG_CHAT_ID || "";

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const ORDERS  = path.join(DATA_DIR, "orders.jsonl");
const COUNTER = path.join(DATA_DIR, "counter.txt");

const STOCK = { in: "в наличии", order: "под заказ" };
const RUB = n => n.toLocaleString("ru-RU") + " ₽";
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

/* защита от спама: не больше 5 заявок в минуту с одного адреса */
const hits = new Map();
function tooMany(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 60000);
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 5;
}

function nextNumber() {
  let n = 1000;
  try { n = parseInt(fs.readFileSync(COUNTER, "utf8"), 10) || 1000; } catch (e) {}
  n += 1;
  fs.writeFileSync(COUNTER, String(n), { mode: 0o600 });
  return n;
}

function loadCatalog() {
  const d = JSON.parse(fs.readFileSync(path.join(SITE_DIR, "products.json"), "utf8"));
  return new Map((d.products || []).filter(p => !p.hidden).map(p => [p.id, p]));
}

async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) { console.error("Бот не настроен: нет токена или чата в /etc/tavan.env"); return false; }
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text }),
      signal: AbortSignal.timeout(10000)
    });
    if (!r.ok) console.error("Telegram не принял сообщение:", r.status, (await r.text()).slice(0, 200));
    return r.ok;
  } catch (e) { console.error("Нет связи с Telegram:", e.cause?.code || e.message); return false; }
}

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

async function handleOrder(req, res) {
  const ip = req.headers["x-real-ip"] || req.socket.remoteAddress || "";
  if (tooMany(ip)) return send(res, 429, { ok: false, error: "Слишком много заявок, попробуйте через минуту" });

  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 20000) return send(res, 413, { ok: false, error: "Слишком большая заявка" }); }
  let b; try { b = JSON.parse(raw); } catch (e) { return send(res, 400, { ok: false, error: "Неверные данные" }); }

  const name = clean(b.name, 80), phone = clean(b.phone, 30);
  const city = clean(b.city, 80), delivery = clean(b.delivery, 60), comment = clean(b.comment, 500);
  if (!name) return send(res, 400, { ok: false, error: "Укажите имя" });
  if ((phone.match(/\d/g) || []).length < 10) return send(res, 400, { ok: false, error: "Проверьте номер телефона" });
  if (b.consent !== true) return send(res, 400, { ok: false, error: "Нужно согласие на обработку данных" });
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 30) return send(res, 400, { ok: false, error: "Корзина пуста" });

  let catalog;
  try { catalog = loadCatalog(); } catch (e) { return send(res, 500, { ok: false, error: "Каталог недоступен" }); }

  const items = []; let total = 0;
  for (const it of b.items) {
    const p = catalog.get(String(it.id));
    if (!p) return send(res, 400, { ok: false, error: "Товар больше не продаётся — обновите страницу" });
    const size = (p.sizes || []).find(z => z.s === String(it.size));
    if (!size) return send(res, 400, { ok: false, error: `Размер ${clean(it.size, 10)} недоступен для «${p.name}»` });
    const colors = (p.colors && p.colors.length) ? p.colors : ["Чёрный"];
    const color = colors.includes(String(it.color)) ? String(it.color) : colors[0];
    const qty = Math.max(1, Math.min(20, parseInt(it.qty, 10) || 1));
    const price = +p.price || 0;
    total += price * qty;
    items.push({ id: p.id, name: p.name, size: size.s, stock: STOCK[size.st] || "", color, qty, price });
  }

  const number = nextNumber();
  const order = { number, date: new Date().toISOString(), name, phone, city, delivery, comment, items, total, consent: true, status: "new" };
  fs.appendFileSync(ORDERS, JSON.stringify(order) + "\n", { mode: 0o600 });

  let t = `🧾 Заказ №${number} — Тӑван.wear\n\nКлиент: ${name}\nТелефон: ${phone}\n`;
  if (city) t += `Город: ${city}\n`;
  if (delivery) t += `Доставка: ${delivery}\n`;
  if (comment) t += `Комментарий: ${comment}\n`;
  t += "\n—— Состав ——\n";
  items.forEach(i => { t += `• ${i.name}, размер ${i.size}${i.stock ? ` (${i.stock})` : ""}, ${i.color} ×${i.qty} — ${RUB(i.price * i.qty)}\n`; });
  t += `\nИтого: ${RUB(total)}`;

  const sent = await sendTelegram(t);
  console.log(`Заказ №${number}: сохранён, Telegram: ${sent ? "отправлен" : "НЕ отправлен"}`);
  send(res, 200, { ok: true, number, total, sent });
}

http.createServer((req, res) => {
  const url = (req.url || "").split("?")[0];
  if (req.method === "GET" && url === "/api/health") return send(res, 200, { ok: true, telegram: !!(BOT_TOKEN && CHAT_ID) });
  if (req.method === "POST" && url === "/api/order") return handleOrder(req, res).catch(() => send(res, 500, { ok: false, error: "Ошибка сервера" }));
  send(res, 404, { ok: false });
}).listen(PORT, "127.0.0.1", () => console.log("Тӑван: приём заявок на порту " + PORT));
