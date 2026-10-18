/**
 * Pure candidate ranking and keyboard state for the graph's continuous node
 * composer.  The view only supplies rows and performs the selected action;
 * this module deliberately has no Obsidian or DOM dependency so it can be
 * exercised with a small unit harness.
 */
export type CandidateKind = "existing" | "relation";

export type Candidate = {
  id: string;
  label: string;
  path: string;
  kind: CandidateKind;
  detail?: string;
};

export type CandidateState = {
  query: string;
  /** null is the explicit “create new” row, matching native BrainOS. */
  selectedIndex: number | null;
};

export type CandidateKeyAction =
  | { type: "move"; delta: number }
  | { type: "confirm"; index: number | null }
  | { type: "close" }
  | { type: "none" };

export function createCandidateState(): CandidateState {
  return { query: "", selectedIndex: null };
}

export function updateCandidateQuery(state: CandidateState, query: string): CandidateState {
  return { query, selectedIndex: null };
}

/** Move through existing rows and the trailing create row, wrapping around. */
export function moveCandidate(state: CandidateState, delta: number, count: number): CandidateState {
  const rowCount = Math.max(0, count) + 1;
  if (rowCount <= 1) return { ...state, selectedIndex: null };
  const current = state.selectedIndex ?? count;
  const next = ((current + delta) % rowCount + rowCount) % rowCount;
  return { ...state, selectedIndex: next === count ? null : next };
}

export function candidateKeyAction(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "isComposing"> & { keyCode?: number },
  state: CandidateState,
  candidateCount: number,
): CandidateKeyAction {
  // WebKit reports keyCode 229 for an IME Enter before compositionend.
  if (event.isComposing || event.keyCode === 229) return { type: "none" };
  if (event.key === "Escape") return { type: "close" };
  const command = event.ctrlKey || event.metaKey;
  if (!event.altKey && !command && event.key === "ArrowDown") return { type: "move", delta: 1 };
  if (!event.altKey && !command && event.key === "ArrowUp") return { type: "move", delta: -1 };
  if (!event.altKey && command && (event.key.toLowerCase() === "n" || event.key === "ArrowDown")) {
    return { type: "move", delta: 1 };
  }
  if (!event.altKey && command && (event.key.toLowerCase() === "p" || event.key === "ArrowUp")) {
    return { type: "move", delta: -1 };
  }
  if (!command && !event.altKey && event.key === "Enter") {
    return { type: "confirm", index: state.selectedIndex === null ? null : Math.min(state.selectedIndex, Math.max(0, candidateCount - 1)) };
  }
  return { type: "none" };
}

/** Resolve the row selected by Enter; undefined means create a new node. */
export function candidateForConfirmation(state: CandidateState, candidates: readonly Candidate[]): Candidate | undefined {
  return state.selectedIndex === null ? undefined : candidates[state.selectedIndex];
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().trim();
}

function score(query: string, candidate: Candidate): number {
  if (!query) return candidate.kind === "relation" ? 4 : 0;
  const title = normalize(candidate.label);
  const path = normalize(candidate.path);
  if (title === query) return 1_000;
  if (title.startsWith(query)) return 800;
  if (title.includes(query)) return 650;
  if (path.includes(query)) return 500;
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.every(token => title.includes(token) || path.includes(token))) return 350;
  return -1;
}

/**
 * Rank relation rows before ordinary Markdown rows when both have the same
 * title.  A stable path tie-breaker keeps the list from jumping while typing.
 */
export function rankCandidates(
  query: string,
  existing: readonly Candidate[],
  relations: readonly Candidate[] = [],
  limit = 8,
): Candidate[] {
  const unique = new Map<string, Candidate>();
  for (const row of [...relations, ...existing]) {
    const previous = unique.get(row.path);
    if (!previous || (row.kind === "relation" && previous.kind !== "relation")) unique.set(row.path, row);
  }
  const normalizedQuery = normalize(query);
  return [...unique.values()]
    .map((candidate, index) => ({ candidate, value: score(normalizedQuery, candidate), index }))
    .filter(item => item.value >= 0)
    .sort((a, b) => b.value - a.value || a.candidate.label.localeCompare(b.candidate.label) || a.candidate.path.localeCompare(b.candidate.path) || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map(item => item.candidate);
}
