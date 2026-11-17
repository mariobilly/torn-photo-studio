#!/bin/sh
# Builds index.html from src/body.html.
cd "$(dirname "$0")/.." || exit 1
FONTS='https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@400;500;600&family=Archivo+Black&family=Bebas+Neue&family=JetBrains+Mono:wght@400;500&family=Permanent+Marker&family=Special+Elite&display=swap'
HEAD="<title>Torn Photo Studio</title>
<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">
<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>
<link rel=\"stylesheet\" href=\"$FONTS\">
<link rel=\"stylesheet\" href=\"app.css\">"
{
  printf '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<link rel="icon" href="torn-photo.ico">\n'
  printf '%s\n' "$HEAD"
  printf '</head>\n<body>\n'
  cat src/body.html
  printf '</body>\n</html>\n'
} > index.html
echo built
