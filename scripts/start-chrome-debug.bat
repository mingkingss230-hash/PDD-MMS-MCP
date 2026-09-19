@echo off
rem Launch the debug Chrome for a shop (multi-shop aware).
rem Usage: start-chrome-debug.bat [shopName]   (shopName = key in config/shops.json)
rem   No args = first shop in shops.json (or legacy default profile if shops.json missing).
rem First time: scan QR / use account+password to login once; the session persists in the shop profile.
"C:\Program Files\nodejs\node.exe" "%~dp0start-chrome-debug.js" %*
