#!/usr/bin/env bash
# ===================================================================
#  Подключение Telegram-бота для заявок.
#  Запуск на сервере (под root):
#     bash /var/www/tavan/server/telegram.sh ТОКЕН_БОТА
#  Перед запуском напиши боту /start (или добавь бота в группу
#  и напиши в группе /start) — скрипт сам найдёт этот чат.
#  Можно указать чат вручную:  bash telegram.sh ТОКЕН ID_ЧАТА
# ===================================================================
set -euo pipefail
TOKEN="${1:-}"; shift || true
# номер чата: берём из остальных слов только число (на случай «Id: 123456789»)
CHAT="$(printf '%s ' "$@" | grep -oE -- '-?[0-9]{5,}' | head -1 || true)"
[ -n "$TOKEN" ] || { echo "Пример: bash /var/www/tavan/server/telegram.sh 7712345678:AAF..."; exit 1; }

TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]"'"'"'')"
if ! printf '%s' "$TOKEN" | grep -qE '^[0-9]{6,}:[A-Za-z0-9_-]{30,}$'; then
  echo "❌ Это не похоже на токен. Он выглядит так: 1234567890:AAF… (цифры, двоеточие, буквы). Скопируй его из @BotFather целиком."; exit 1
fi
CODE=$(curl -s -m 15 -o /tmp/tg_me.json -w '%{http_code}' "https://api.telegram.org/bot$TOKEN/getMe" || echo 000)
case "$CODE" in
  200) echo "Бот найден: @$(grep -oE '"username":"[^"]+"' /tmp/tg_me.json | cut -d'"' -f4)";;
  401|404) echo "❌ Telegram говорит: токен неверный или устарел. Возьми САМЫЙ ПОСЛЕДНИЙ токен в @BotFather (/mybots → бот → API Token)."; exit 1;;
  000) echo "❌ Сервер не может связаться с Telegram (нет соединения). Напиши Claude: «сервер не видит Telegram»."; exit 1;;
  *) echo "❌ Telegram ответил кодом $CODE. Напиши Claude этот код."; exit 1;;
esac
rm -f /tmp/tg_me.json

if [ -z "$CHAT" ]; then
  RES=$(curl -s "https://api.telegram.org/bot$TOKEN/getUpdates")
  read -r CHAT TITLE < <(printf '%s' "$RES" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const r=(JSON.parse(s).result||[]).map(u=>(u.message||u.my_chat_member||u.channel_post||{}).chat).filter(Boolean);
      const c=r.reverse().find(c=>c.type!=="private")||r[0];
      if(!c){process.exit(0)}
      console.log(c.id+" "+(c.title||[c.first_name,c.last_name].filter(Boolean).join(" ")||"личный чат"));
    })') || true
  [ -n "${CHAT:-}" ] || { echo "❌ Не нашёл чат. Напиши боту /start (или /start в группе с ботом) и запусти команду ещё раз."; exit 1; }
  echo "Нашёл чат: $TITLE"
fi

printf 'TG_BOT_TOKEN=%s\nTG_CHAT_ID=%s\n' "$TOKEN" "$CHAT" > /etc/tavan.env
chown root:tavan /etc/tavan.env; chmod 640 /etc/tavan.env
systemctl restart tavan-orders; sleep 1

if curl -sf "https://api.telegram.org/bot$TOKEN/sendMessage" -d chat_id="$CHAT" \
     --data-urlencode text="✅ Тӑван.wear: заявки с сайта будут приходить сюда" >/dev/null; then
  echo "✅ Готово! Проверь Telegram — там должно появиться тестовое сообщение."
else
  echo "❌ Не получилось отправить сообщение в чат $CHAT. Проверь, что бот добавлен в этот чат."
fi
