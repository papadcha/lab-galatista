#!/bin/bash
# deploy.sh — αντιγράφει τα αρχεία από το ~/Downloads και κάνει push στο git
# Χρήση: ./deploy.sh "μήνυμα commit"

REPO="$HOME/lab-galatista"        # ← άλλαξε αν το repo είναι αλλού
DOWNLOADS="$HOME/Downloads"
MSG="${1:-update}"

echo "📁 Αντιγραφή αρχείων..."

[ -f "$DOWNLOADS/db_manager.py" ] && cp "$DOWNLOADS/db_manager.py"  "$REPO/database/db_manager.py"  && echo "  ✓ db_manager.py"
[ -f "$DOWNLOADS/main.js"       ] && cp "$DOWNLOADS/main.js"        "$REPO/main.js"                  && echo "  ✓ main.js"
[ -f "$DOWNLOADS/preload.js"    ] && cp "$DOWNLOADS/preload.js"      "$REPO/preload.js"               && echo "  ✓ preload.js"
[ -f "$DOWNLOADS/settings.js"   ] && cp "$DOWNLOADS/settings.js"    "$REPO/src/pages/settings/settings.js" && echo "  ✓ settings.js"
[ -f "$DOWNLOADS/calculations.py" ] && cp "$DOWNLOADS/calculations.py" "$REPO/calculations.py"        && echo "  ✓ calculations.py"
[ -f "$DOWNLOADS/server.py"     ] && cp "$DOWNLOADS/server.py"       "$REPO/backend/server.py"        && echo "  ✓ server.py"
[ -f "$DOWNLOADS/dashboard.js"  ] && cp "$DOWNLOADS/dashboard.js"   "$REPO/src/pages/dashboard/dashboard.js" && echo "  ✓ dashboard.js"
[ -f "$DOWNLOADS/tests.js"      ] && cp "$DOWNLOADS/tests.js"        "$REPO/src/pages/samples/tests.js"      && echo "  ✓ tests.js"
[ -f "$DOWNLOADS/history.js"    ] && cp "$DOWNLOADS/history.js"      "$REPO/src/pages/history/history.js"    && echo "  ✓ history.js"
[ -f "$DOWNLOADS/reports.js"    ] && cp "$DOWNLOADS/reports.js"      "$REPO/src/pages/reports/reports.js"    && echo "  ✓ reports.js"
[ -f "$DOWNLOADS/reports.html" ] && cp "$DOWNLOADS/reports.html" "$REPO/src/pages/reports/reports.html" && echo "  ✓ reports.html"
[ -f "$DOWNLOADS/main-app.js"   ] && cp "$DOWNLOADS/main-app.js"    "$REPO/src/main-app.js"           && echo "  ✓ main-app.js"
# Άνοιξε το deploy.sh και πρόσθεσε:
[ -f "$DOWNLOADS/index.html" ] && cp "$DOWNLOADS/index.html"  "$REPO/src/index.html"        && echo "  ✓ index.html"
echo ""
echo "📝 Git status:"
cd "$REPO" && git status --short

echo ""
read -p "Συνέχεια με commit '$MSG'; (y/n): " confirm
if [ "$confirm" = "y" ]; then
  git add -A
  git commit -m "$MSG"
  git push
  echo "✅ Έγινε push!"
  # Καθαρισμός Downloads μετά από επιτυχημένο push
  echo ""
  echo "🧹 Καθαρισμός Downloads..."
  for f in db_manager.py main.js preload.js settings.js calculations.py server.py \
            dashboard.js tests.js history.js reports.js main-app.js index.html; do
    [ -f "$DOWNLOADS/$f" ] && rm "$DOWNLOADS/$f" && echo "  ✓ $f"
  done
else
  echo "⏸ Ακυρώθηκε — τα αρχεία αντιγράφηκαν αλλά δεν έγινε commit."
fi
