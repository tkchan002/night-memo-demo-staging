export function createRequestSequencer() {
  let current = 0;
  return {
    begin() { current += 1; return current; },
    isCurrent(id) { return id === current; },
    get current() { return current; },
  };
}
