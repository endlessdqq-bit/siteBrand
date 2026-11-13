#!/usr/bin/env bash
# ===================================================================
#  Тӑван.wear — первичная настройка сервера (Ubuntu 24.04 / 26.04).
#  Запуск (под root):
#    curl -fsSL https://raw.githubusercontent.com/endlessdqq-bit/siteBrand/gh-pages/server/setup.sh | bash
#  Что делает:
#    1) ставит nginx, git, Node.js, certbot, файрвол;
#    2) скачивает сайт с GitHub и каждую минуту подтягивает изменения
#       (правки из админки появляются на сервере сами);
#    3) запускает приём заявок (/api/order) как системную службу;
#    4) добавляет команды tavan-domain и tavan-telegram.
#  Скрипт можно запускать повторно — ничего не сломается.
# ===================================================================
set -euo pipefail

REPO="https://github.com/endlessdqq-bit/siteBrand.git"
BRANCH="gh-pages"
SITE="/var/www/tavan"
DATA="/var/lib/tavan"
ENVF="/etc/tavan.env"

say(){ printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" = "0" ] || { echo "Запусти под root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

say "Обновляю систему и ставлю программы (пара минут)…"
APT="apt-get -o DPkg::Lock::Timeout=600 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold -y -q"
export HOME=${HOME:-/root}
$APT update
$APT upgrade
$APT install nginx git curl ufw certbot python3-certbot-nginx nodejs unattended-upgrades
node -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' \
  || { say "Ставлю свежий Node.js"; curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && $APT install nodejs; }

say "Включаю автоматические обновления безопасности"
dpkg-reconfigure -f noninteractive unattended-upgrades || true

say "Пользователь для сервиса заявок"
id tavan >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin tavan
mkdir -p "$DATA" && chown tavan:tavan "$DATA" && chmod 700 "$DATA"

say "Скачиваю сайт с GitHub"
if [ -d "$SITE/.git" ]; then
  git -C "$SITE" fetch -q --depth 1 origin "$BRANCH" && git -C "$SITE" reset -q --hard "origin/$BRANCH"
else
  rm -rf "$SITE"; git clone -q --depth 1 -b "$BRANCH" "$REPO" "$SITE"
fi
chown -R root:root "$SITE"

say "Автообновление сайта раз в минуту"
cat > /usr/local/bin/tavan-pull <<'EOF'
#!/usr/bin/env bash
# подтягивает свежую версию сайта с GitHub; перезапускает заявки, если поменялся их код
cd /var/www/tavan || exit 0
old=$(git rev-parse HEAD:server/orders.js 2>/dev/null || true)
git fetch -q --depth 1 origin gh-pages && git reset -q --hard origin/gh-pages
new=$(git rev-parse HEAD:server/orders.js 2>/dev/null || true)
[ "$old" != "$new" ] && systemctl restart tavan-orders || true
EOF
chmod 755 /usr/local/bin/tavan-pull
echo '* * * * * root /usr/local/bin/tavan-pull >/dev/null 2>&1' > /etc/cron.d/tavan-pull

say "Настройки приёма заявок"
[ -f "$ENVF" ] || printf 'TG_BOT_TOKEN=\nTG_CHAT_ID=\n' > "$ENVF"
chown root:tavan "$ENVF"; chmod 640 "$ENVF"

cat > /etc/systemd/system/tavan-orders.service <<EOF
[Unit]
Description=Tavan.wear — приём заявок
After=network-online.target

[Service]
User=tavan
EnvironmentFile=$ENVF
Environment=SITE_DIR=$SITE DATA_DIR=$DATA PORT=3000
ExecStart=/usr/bin/node $SITE/server/orders.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DATA
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q --now tavan-orders
systemctl restart tavan-orders

say "Настраиваю веб-сервер nginx"
DOMAIN_FILE=/etc/tavan.domain
SERVER_NAMES="_"
[ -s "$DOMAIN_FILE" ] && SERVER_NAMES="$(cat $DOMAIN_FILE) www.$(cat $DOMAIN_FILE)"
cat > /etc/nginx/sites-available/tavan <<EOF
limit_req_zone \$binary_remote_addr zone=tavan_api:10m rate=10r/m;
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $SERVER_NAMES;
    root $SITE;
    index index.html;
    client_max_body_size 64k;
    server_tokens off;

    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header X-Frame-Options SAMEORIGIN always;

    # служебные файлы не показываем
    location ~ /\.            { deny all; return 404; }
    location ^~ /server/      { deny all; return 404; }

    location /api/ {
        limit_req zone=tavan_api burst=5 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header Host \$host;
    }
    location = /products.json { add_header Cache-Control "no-cache"; try_files \$uri =404; }
    location ~* \.(jpg|jpeg|png|webp|mp4)$ { expires 7d; add_header Cache-Control "public"; }
    location / { try_files \$uri \$uri/ =404; }
}
EOF
ln -sf /etc/nginx/sites-available/tavan /etc/nginx/sites-enabled/tavan
rm -f /etc/nginx/sites-enabled/default
nginx -t -q && systemctl reload nginx

if [ -s "$DOMAIN_FILE" ]; then
  D="$(cat $DOMAIN_FILE)"
  say "Восстанавливаю SSL для $D"
  certbot --nginx -n --agree-tos --register-unsafely-without-email --redirect --keep-until-expiring -d "$D" -d "www.$D" || true
fi

say "Файрвол: открыты только SSH и сайт"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

say "Добавляю команды tavan-domain и tavan-telegram"
cat > /usr/local/bin/tavan-domain <<'EOF'
#!/usr/bin/env bash
# Подключить домен и бесплатный SSL (замочек). Пример: tavan-domain tavanwear.ru
set -e
d="${1:-}"; d="${d#http://}"; d="${d#https://}"; d="${d#www.}"; d="${d%%/*}"
[ -n "$d" ] || { echo "Пример: tavan-domain tavanwear.ru"; exit 1; }
echo "$d" > /etc/tavan.domain
sed -i "s/^\(\s*server_name\).*;/\1 $d www.$d;/" /etc/nginx/sites-available/tavan
nginx -t -q && systemctl reload nginx
certbot --nginx -n --agree-tos --register-unsafely-without-email --redirect -d "$d" -d "www.$d" \
  && echo "Готово! Сайт открывается по https://$d" \
  || echo "Сертификат пока не выдан. Проверь, что домен указывает на этот сервер (подожди до часа после настройки DNS) и запусти команду ещё раз."
EOF
cat > /usr/local/bin/tavan-telegram <<'EOF'
#!/usr/bin/env bash
# Подключить бота для заявок. Пример: tavan-telegram 7712345678:AAF... -1001234567890
set -e
[ $# -eq 2 ] || { echo "Пример: tavan-telegram ТОКЕН_БОТА ID_ЧАТА"; exit 1; }
printf 'TG_BOT_TOKEN=%s\nTG_CHAT_ID=%s\n' "$1" "$2" > /etc/tavan.env
chown root:tavan /etc/tavan.env; chmod 640 /etc/tavan.env
systemctl restart tavan-orders; sleep 1
curl -s "https://api.telegram.org/bot$1/sendMessage" -d chat_id="$2" -d text="✅ Тӑван.wear: заявки с сайта будут приходить сюда" >/dev/null \
  && echo "Готово! Проверь Telegram — там должно появиться тестовое сообщение."
EOF
chmod 755 /usr/local/bin/tavan-domain /usr/local/bin/tavan-telegram

sleep 1
IP=$(curl -s -4 https://ifconfig.me || hostname -I | awk '{print $1}')
if curl -sf http://127.0.0.1/api/health >/dev/null; then
  say "ВСЁ ГОТОВО ✅  Сайт открывается по адресу: http://$IP"
else
  say "Сайт поставлен, но приём заявок не отвечает. Пришли Claude вывод команды: journalctl -u tavan-orders -n 30"
fi
