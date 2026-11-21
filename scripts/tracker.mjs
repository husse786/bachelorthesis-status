// Erzeugt tracker.json (Format vergabo.tracker/v1) aus status.json.
// Ohne Abhängigkeiten, nur Node 18+.
//
//   node scripts/tracker.mjs           schreibt tracker.json
//   node scripts/tracker.mjs --check   prüft, ob tracker.json gültig und aktuell ist (schreibt nichts)
//
// Die Ausgabe hängt nur von status.json und vom Zeitpunkt des letzten Commits auf status.json ab,
// nicht von der Uhrzeit des Laufs. So ergibt derselbe Stand immer dieselbe Datei.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "status.json");
const OUT = join(ROOT, "tracker.json");
const PAGE = "https://husse786.github.io/bachelorthesis-status/";
const REPO = "https://github.com/husse786/bachelorthesis-status";

// Zeitpunkt, an dem sich die Daten zuletzt geändert haben: letzter Commit auf status.json.
// Ungespeicherte Änderungen (nur lokal) zählen als «jetzt nicht bekannt» und fallen auf das Datum «stand» zurück.
function changedAt(cfg) {
  try {
    const dirty = execFileSync("git", ["status", "--porcelain", "--", "status.json"], { cwd: ROOT }).toString().trim();
    const iso = execFileSync("git", ["log", "-1", "--format=%cI", "--", "status.json"], { cwd: ROOT }).toString().trim();
    if (iso && !dirty) return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
  } catch { /* kein Git verfügbar */ }
  return cfg.stand;
}

// Dieselbe Rechnung wie auf der Statusseite (index.html).
function taskValue(t) {
  if (t.status === "erledigt") return 1;
  if (t.zaehler) return t.zaehler[0] / t.zaehler[1];
  return t.status === "in_arbeit" ? 0.5 : 0;
}
const STEP = { erledigt: "done", in_arbeit: "doing", offen: "open", blockiert: "blocked" };
const taskTitle = (t) => (t.zaehler ? `${t.titel} (${t.zaehler[0]} von ${t.zaehler[1]})` : t.titel);

export function build(cfg, updatedAt) {
  const phases = cfg.phasen.map((p) => {
    const tasks = p.aufgaben || [];
    const prog = p.gesperrt || !tasks.length ? 0 : tasks.reduce((a, t) => a + taskValue(t), 0) / tasks.length;
    return { ...p, tasks, prog };
  });
  const totalW = phases.reduce((a, p) => a + p.gewicht, 0);
  const overall = phases.reduce((a, p) => a + p.gewicht * p.prog, 0) / totalW;
  const curIdx = Math.max(0, phases.findIndex((p) => p.prog < 1));
  const cur = phases[curIdx];
  const curDone = cur.tasks.filter((t) => t.status === "erledigt").length;
  const allDone = phases.every((p) => p.prog >= 1);

  const ms = [...cfg.meilensteine].sort((a, b) => a.datum.localeCompare(b.datum));
  const next = ms.find((m) => !m.erledigt);
  const fmt = (iso) => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };

  const summary =
    `Level ${curIdx + 1} von ${phases.length}: ${cur.name}, ${curDone} von ${cur.tasks.length} Aufgaben erledigt.` +
    (next ? ` Nächster Meilenstein: ${next.titel}, ${fmt(next.datum)}.` : "");

  const done = phases.flatMap((p) => p.tasks.filter((t) => t.status === "erledigt" && t.datum));
  const activity = done
    .sort((a, b) => b.datum.localeCompare(a.datum))
    .slice(0, 10)
    .map((t) => ({ t: t.titel, date: t.datum }));

  const todos = cur.tasks
    .filter((t) => t.status !== "erledigt")
    .map((t) => ({ t: taskTitle(t), why: cur.name, ...(t.faellig ? { due: t.faellig } : {}) }));

  return {
    schema: "vergabo.tracker/v1",
    id: "bachelorthesis",
    name: cfg.titel,
    tagline: cfg.semester,
    updatedAt,
    status: {
      phase: cur.name,
      health: cfg.health || (allDone ? "done" : "on-track"),
      summary,
    },
    progress: { percent: Math.round(overall * 100), label: "gewichtet nach Phasen" },
    deadline: { date: cfg.abgabe, label: "Abgabe" },
    milestones: ms.map((m) => ({ name: m.titel, date: m.datum, status: m.erledigt ? "done" : "open" })),
    phases: phases.map((p, i) => ({
      id: `P${i + 1}`,
      name: p.name,
      weight: p.gewicht,
      tasks: p.tasks.map((t) => ({
        t: taskTitle(t),
        status: STEP[t.status] || "open",
        ...(t.datum ? { date: t.datum } : t.faellig ? { date: t.faellig } : {}),
      })),
    })),
    todos,
    agents: [{
      name: "Tracker-Generator",
      status: "idle",
      kind: "workflow",
      rhythm: "bei jedem Push auf status.json",
      what: "Erzeugt tracker.json aus status.json",
      url: `${REPO}/actions/workflows/tracker.yml`,
    }],
    links: [
      { label: "Statusseite", url: PAGE, note: "Öffentliche Übersicht" },
      { label: "Repository", url: REPO },
    ],
    activity,
    page: { url: PAGE, embed: true },
  };
}

// Prüfung gegen vergabo.tracker/v1 (Pflichtfelder, Werte, Daten, Links, Grenzen).
export function validate(t) {
  const errs = [];
  const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
  const isDate = (v) => typeof v === "string" && DATE.test(v) && !Number.isNaN(Date.parse(v));
  const isStr = (v) => typeof v === "string" && v.trim() !== "";
  const oneOf = (v, l) => l.includes(v);
  const STEPS = ["done", "doing", "open", "blocked"];
  const need = (cond, msg) => { if (!cond) errs.push(msg); };

  need(t.schema === "vergabo.tracker/v1", 'schema muss "vergabo.tracker/v1" sein');
  need(t.id === "bachelorthesis", 'id muss "bachelorthesis" sein');
  need(isStr(t.name) && t.name.length <= 60, "name fehlt oder ist länger als 60 Zeichen");
  need(isDate(t.updatedAt), "updatedAt ist kein Datum");
  need(t.status && oneOf(t.status.health, ["on-track", "at-risk", "blocked", "paused", "done"]), "status.health ungültig");
  need(!t.status?.summary || t.status.summary.length <= 280, "status.summary länger als 280 Zeichen");
  need(t.progress && typeof t.progress.percent === "number" && t.progress.percent >= 0 && t.progress.percent <= 100, "progress.percent nicht zwischen 0 und 100");
  if (t.deadline) need(isDate(t.deadline.date), "deadline.date ist kein Datum");

  const limits = { milestones: 30, phases: 20, todos: 40, decisions: 40, metrics: 16, links: 30, activity: 30, agents: 30, stack: 40, tools: 40 };
  for (const [k, max] of Object.entries(limits)) if (t[k] !== undefined) need(Array.isArray(t[k]) && t[k].length <= max, `${k}: mehr als ${max} Einträge`);
  (t.milestones || []).forEach((m, i) => { need(isStr(m.name) && isDate(m.date), `milestones[${i}]: name oder date fehlt`); need(oneOf(m.status, STEPS), `milestones[${i}]: status ungültig`); });
  (t.phases || []).forEach((p, i) => {
    need(isStr(p.name), `phases[${i}]: name fehlt`);
    need(!p.tasks || p.tasks.length <= 60, `phases[${i}]: mehr als 60 Aufgaben`);
    (p.tasks || []).forEach((x, j) => { need(isStr(x.t) && oneOf(x.status, STEPS), `phases[${i}].tasks[${j}] ungültig`); if (x.date) need(isDate(x.date), `phases[${i}].tasks[${j}].date ungültig`); });
  });
  (t.todos || []).forEach((x, i) => { need(isStr(x.t), `todos[${i}]: t fehlt`); if (x.due) need(isDate(x.due), `todos[${i}].due ungültig`); });
  (t.activity || []).forEach((x, i) => { need(isStr(x.t), `activity[${i}]: t fehlt`); if (x.date) need(isDate(x.date), `activity[${i}].date ungültig`); });

  // Alle Links nur https://
  const walk = (v, path) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
      if (k === "url") need(typeof x === "string" && /^https:\/\/[^\s]+$/.test(x), `${path}.${k}: nur https:// erlaubt`);
      else walk(x, `${path}.${k}`);
    }
  };
  walk(t, "tracker");

  // Datenregel: nichts Persönliches in die öffentliche Datei
  const text = JSON.stringify(t);
  need(!/@/.test(text), "enthält ein @ (E-Mail-Adresse?)");
  return errs;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const cfg = JSON.parse(readFileSync(SRC, "utf8"));
  const tracker = build(cfg, changedAt(cfg));
  const errs = validate(tracker);
  if (errs.length) { console.error("tracker.json ungültig:\n- " + errs.join("\n- ")); process.exit(1); }
  const json = JSON.stringify(tracker, null, 2) + "\n";

  if (process.argv.includes("--check")) {
    if (!existsSync(OUT)) { console.log("tracker.json gültig erzeugt (Datei noch nicht vorhanden, wird auf main geschrieben)."); process.exit(0); }
    const current = readFileSync(OUT, "utf8");
    const committed = JSON.parse(current);
    const cErrs = validate(committed);
    if (cErrs.length) { console.error("Vorhandene tracker.json ungültig:\n- " + cErrs.join("\n- ")); process.exit(1); }
    if (current !== json) { console.error("tracker.json ist nicht aktuell. Bitte `node scripts/tracker.mjs` ausführen."); process.exit(1); }
    console.log("tracker.json gültig und aktuell.");
  } else {
    writeFileSync(OUT, json);
    console.log(`tracker.json geschrieben: ${tracker.progress.percent} %, ${tracker.status.phase}, Stand ${tracker.updatedAt}`);
  }
}
