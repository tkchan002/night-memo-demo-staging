function numericOrder(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
}

export function sortByOrder(items, orderField) {
  return [...(items || [])].sort((a, b) => {
    const diff = numericOrder(a?.[orderField]) - numericOrder(b?.[orderField]);
    if (diff) return diff;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

export function normalizeOrder(items, orderField) {
  return sortByOrder(items, orderField).map((item, index) => ({
    ...item,
    [orderField]: index + 1,
  }));
}

export function moveOrderedItem(items, itemId, delta, orderField) {
  const ordered = sortByOrder(items, orderField);
  const index = ordered.findIndex(item => item?.id === itemId);
  const target = index + Number(delta || 0);
  if (index < 0 || target < 0 || target >= ordered.length || target === index) {
    return { changed: false, items: normalizeOrder(ordered, orderField) };
  }
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  return { changed: true, items: ordered.map((item, position) => ({ ...item, [orderField]: position + 1 })) };
}

export function orderedIds(items, orderField) {
  return normalizeOrder(items, orderField).map(item => item.id).filter(Boolean);
}
