#!/data/data/com.termux/files/usr/bin/bash
cd ~/whatsapp-bot
while true; do
  echo "Starting bot..."
  node index.js
  echo "Bot stopped. Restarting in 5 seconds..."
  sleep 5
done
