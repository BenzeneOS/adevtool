export function setIntersection<Value>(a: Set<Value>, b: Set<Value>) {
  let set = new Set<Value>()
  for (let value of a) {
    if (b.has(value)) {
      set.add(value)
    }
  }
  return set
}

export function setDifference<Value>(a: Set<Value>, b: Set<Value>) {
  let set = new Set<Value>()
  for (let value of a) {
    if (!b.has(value)) {
      set.add(value)
    }
  }
  return set
}

export function updateMultiMap<K, V>(map: Map<K, V[]>, key: K, value: V) {
  let cur = map.get(key)
  if (cur === undefined) {
    map.set(key, [value])
  } else {
    cur.push(value)
  }
}

export function assertDefined<T>(o: T | undefined): T {
  if (o === undefined) {
    throw new Error('value is undefined')
  }
  return o!
}

export function assertNonNull<T>(o: T | null): T {
  if (o === null) {
    throw new Error('value is null')
  }
  return o!
}
