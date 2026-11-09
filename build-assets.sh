#!/bin/bash
# Sastavlja assets/app.js iz modula assets/mod-*.js (redoslijed = naziv datoteke). Uređujte module, a zatim pokrenite ovu skriptu.
cd "$(dirname "$0")" && cat assets/mod-*.js > assets/app.js && node --check assets/app.js && echo "assets/app.js sastavljen ($(wc -l < assets/app.js) redaka)"
