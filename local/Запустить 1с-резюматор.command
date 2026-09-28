#!/bin/zsh
REZUMATOR_HOME="${0:A:h}"
if [[ ! -f "$REZUMATOR_HOME/server.mjs" ]]; then
  REZUMATOR_HOME="${0:A:h}"
fi
if [[ ! -f "$REZUMATOR_HOME/server.mjs" ]]; then
  print "Не найден локальный сервер 1с-резюматора."
  print "Ожидался файл: $REZUMATOR_HOME/server.mjs"
  read -k 1
  exit 1
fi
cd "$REZUMATOR_HOME"
REZUMATOR_NODE="$(command -v node)"
if [[ ! -x "$REZUMATOR_NODE" ]]; then
  REZUMATOR_NODE="$(command -v node)"
fi
if [[ -z "$REZUMATOR_NODE" ]]; then
  print "Не найден Node.js. Установите Node.js и повторите запуск."
  read -k 1
  exit 1
fi
if curl --silent --fail --max-time 1 'http://127.0.0.1:4317/api/session' > /dev/null 2>&1; then
  open 'http://127.0.0.1:4317'
  exit 0
fi
REZUMATOR_OPEN_BROWSER=1 "$REZUMATOR_NODE" "$REZUMATOR_HOME/server.mjs"
