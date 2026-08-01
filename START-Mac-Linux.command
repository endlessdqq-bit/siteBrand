#!/bin/sh
cd "$(dirname "$0")" || exit 1
echo ""
echo "  Запускаем витрину магазина..."
echo "  Откройте в браузере адрес:  localhost:3000"
echo "  Остановить сервер: Ctrl + C"
echo ""
node server.js
