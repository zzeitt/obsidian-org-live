export interface TodoKeywordSets {
  active: string[];
  done: string[];
}

export const BUILTIN_TODO_ACTIVE = [
  "TODO",
  "NEXT",
  "STARTED",
  "WAITING",
  "HOLD",
  "HOLDING",
  "BLOCKED",
  "IN-PROGRESS",
  "INPROGRESS",
];

export const BUILTIN_TODO_DONE = ["DONE", "CANCELED", "CANCELLED", "FINISHED"];

let extras: TodoKeywordSets = { active: [], done: [] };
let version = 0;

/**
 * Strip Org fast-access/state-logging suffixes from a keyword declaration:
 * `TODO(t)`, `WAIT(w@/!)`, `DONE(d!)` → `TODO`, `WAIT`, `DONE`.
 */
export function normalizeTodoKeyword(word: string): string {
  return word.replace(/\([^)]*\)$/, "").replace(/[!@]+$/, "").trim();
}

function words(part: string): string[] {
  return part
    .trim()
    .split(/\s+/)
    .map(normalizeTodoKeyword)
    .filter(Boolean);
}

/** Parse an Org-style `TODO NEXT | DONE` keyword specification. */
export function parseTodoKeywordSpec(spec: string): TodoKeywordSets {
  const [activePart, donePart = ""] = spec.split("|");
  return { active: words(activePart), done: words(donePart) };
}

/**
 * Set user-defined keywords from plugin settings. These are additive to the
 * built-in keywords and to any file-level `#+TODO:` declaration.
 */
export function configureTodoKeywordExtras(spec: string): void {
  extras = parseTodoKeywordSpec(spec ?? "");
  version += 1;
}

export function getTodoKeywordExtras(): TodoKeywordSets {
  return extras;
}

/** Changes when the configured keyword set changes; used to invalidate caches. */
export function getTodoKeywordVersion(): number {
  return version;
}

export function createTodoKeywordSets(fileSpecs: string[] = []): TodoKeywordSets {
  const active = new Set(BUILTIN_TODO_ACTIVE);
  const done = new Set(BUILTIN_TODO_DONE);
  for (const word of extras.active) active.add(word);
  for (const word of extras.done) done.add(word);
  for (const spec of fileSpecs) {
    const file = parseTodoKeywordSpec(spec);
    for (const word of file.active) active.add(word);
    for (const word of file.done) done.add(word);
  }
  return { active: [...active], done: [...done] };
}
