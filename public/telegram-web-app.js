/**
 * Подключает официальный SDK Telegram Mini Apps.
 *
 * Внутри Telegram скрипт загрузится и создаст window.Telegram.WebApp.
 * В обычном браузере (или без интернета) он просто не загрузится —
 * витрина продолжит работать в демо-режиме.
 */
;(function () {
  if (window.Telegram && window.Telegram.WebApp) return
  var src = 'ht' + 'tps://telegram.org/js/telegram-web-app.js'
  var script = document.createElement('script')
  script.src = src
  script.async = false
  document.head.appendChild(script)
})()
