export function groupBySingle<T, K, V = T>(
  arr: T[],
  keyFunc: (item: T) => K,
  mapper?: (item: T) => V
) {
  return arr.reduce(
    (acc, item) => acc.set(keyFunc(item), (mapper ? mapper(item) : item) as V),
    new Map<K, V>()
  );
}

export function groupByMultiple<T, K, V = T[]>(
  arr: T[],
  keyFunc: (item: T) => K,
  mapper?: (item: T[]) => V
) {
  const map = arr.reduce((acc, item) => {
    const key = keyFunc(item);
    let arr = acc.get(key);
    if (!acc.get(key)) {
      arr = [];
      acc.set(key, arr);
    }
    arr!.push(item);
    return acc;
  }, new Map<K, T[]>());

  if (mapper) {
    return new Map([...map.entries()].map(([k, v]) => [k, mapper(v)]));
  } else {
    return map as unknown as Map<K, V>;
  }
}
