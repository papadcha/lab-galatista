# ΕΡΓΑΣΤΗΡΙΟ ΓΑΛΑΤΙΣΤΑΣ — ΕΚΚΡΕΜΟΤΗΤΕΣ (TO-DO)

Τελευταία ενημέρωση: 2026-07-06
Το ιστορικό εκδόσεων ζει σε ξεχωριστό αρχείο: `VERSIONS.md`
(bundled μέσα στην ίδια την εφαρμογή — βλ. εκεί).
Τρέχουσα έκδοση: v1.1.33

---

## MAINTENANCE-ONLY MODE (από v1.1.33 και μετά)

Η **v1.1.33 είναι η τελευταία feature έκδοση του `master` (v1.x)**. Από
εδώ και πέρα το `master` δέχεται **μόνο security patches και bug
fixes** — καμία νέα λειτουργία. Όλη η ενεργή ανάπτυξη (features,
roadmap) γίνεται αποκλειστικά στο branch `v2-esm-redesign` (worktree
`C:/lab-galatista-v2`, δικό του TODOLIST.md/CHANGELOG-v2.md), που θα
γίνει `master`/`v2.0.0` όταν αποφασιστεί το merge.

## ΜΙΚΡΕΣ / ΓΝΩΣΤΕΣ ΕΚΚΡΕΜΟΤΗΤΕΣ

- [ ] **Αφαίρεση του "Διόρθωση Παλαιών Κοκκομετριών" (panfix)** — one-time
      εργαλείο μετάβασης (checkPanDoublecountFix/modules ή main.js,
      main-app.js modal, tests.js hook, `get_pan_doublecount_affected_samples`)
      που προστέθηκε στο v1.1.33 για να διορθώσει χειροκίνητα τα ιστορικά
      δεδομένα που επηρεάστηκαν από το pan-double-count bug (`b174af5`).
      Μόλις δεν έχει πλέον νόημα (π.χ. όλα τα επηρεαζόμενα δείγματα έχουν
      διορθωθεί σε όλες τις πραγματικές εγκαταστάσεις), να αφαιρεθεί
      εντελώς αντί να μείνει ως dead code για πάντα. Τεχνικό cleanup, όχι
      feature — εντός scope του maintenance-only mode.
