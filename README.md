# Bachelorarbeit Fortschritt

Öffentliche Übersicht über den Stand einer Bachelorarbeit (Wirtschaftsinformatik, FS 2027).
Die Seite zeigt nur Phasen, Meilensteine und anonymisierte Aufgaben. Die konkrete Arbeit wird privat geführt.

- `index.html`: die Seite, ohne Build-Schritt
- `status.json`: die Daten; wird bei jedem Checkpoint nachgeführt

## So wird gerechnet
- Jede Phase hat ein Gewicht (Summe 100). Der Fortschritt einer Phase ist der Anteil erledigter Aufgaben (Zähler anteilig, «in Arbeit» halb).
- Gesperrte Phasen haben noch keine Aufgaben und zählen 0, bis sie geplant sind.
- «Dringend» heisst: offen und fällig in höchstens `dringendTage` Tagen, oder von Hand mit `"dringend": true` markiert.
