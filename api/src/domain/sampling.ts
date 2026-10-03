/** Muestreo aleatorio reproducible (ADR-040): misma lista y misma semilla, misma muestra. Lógica pura, sin I/O. */

/** Hash de texto a 32 bits (xmur3): convierte una semilla legible en el estado inicial del generador. */
function seedToInt(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Generador mulberry32: uniforme en [0, 1), suficiente para barajar (no es criptográfico, ni lo necesita). */
function mulberry32(state: number): () => number {
  let a = state;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `size` elementos distintos elegidos al azar (Fisher-Yates parcial). Si `size` ≥ `items.length` devuelve todos,
 * en orden aleatorio. No modifica la entrada.
 */
export function sampleWithSeed<T>(items: readonly T[], size: number, seed: string): T[] {
  const pool = [...items];
  const count = Math.min(Math.max(Math.trunc(size), 0), pool.length);
  const random = mulberry32(seedToInt(seed));
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count);
}
