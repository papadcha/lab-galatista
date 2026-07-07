// Κοινή, mutable κατάσταση της εφαρμογής μεταξύ modules — ένα ενιαίο
// αντικείμενο αντί για διάσπαρτες global μεταβλητές σε όλο το main.js.
// Μέρος του ESM redesign (Φάση 2 modularization + Φάση 3 state management,
// γίνονται μαζί όπως είχε προβλεφθεί — βλ. TODOLIST.md).
//
// Άλλα modules κάνουν `import { state } from './state.js'` και διαβάζουν/
// γράφουν ιδιότητες του ίδιου αντικειμένου (π.χ. state.mainWindow) — δεν
// χρειάζεται καμία άλλη συμφωνία, αφού το `state` είναι μία κοινή αναφορά.
export const state = {
  mainWindow:  null,
  guideWindow: null,

  // Python backend (child process bridge)
  pyProcess:      null,
  pyReqId:        0,
  pyPending:      new Map(),  // id → resolve
  pythonReady:    false,
  pyReadyWaiters: [],

  // Archive Mode / επιλεκτική επαναφορά δείγματος
  archiveMode:       false,
  archivePeriodId:   null,
  archiveDataFolder: null,
};
