/**
 * Puerto de traducción del dominio: los módulos del dominio producen frases para la pantalla (etiquetas, notas, avisos) sin
 * conocer el idioma ni el framework. La interfaz registra aquí su traductor al arrancar; sin traductor, devuelve la clave.
 */
export type Translator = (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string;

let translator: Translator | null = null;

export function setTranslator(fn: Translator): void {
  translator = fn;
}

/**
 * Tabla de frases cuyo valor se traduce al leerlo: sirve para los diccionarios constantes del dominio (etiquetas por clave) sin
 * congelar el idioma que había al cargar el módulo.
 */
export function lazyMessages<K extends string>(keys: Record<K, string>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const name of Object.keys(keys) as K[]) Object.defineProperty(out, name, { enumerable: true, get: () => tr(keys[name]) });
  return out;
}

export function tr(key: string, params?: Record<string, string | number | boolean | null | undefined>): string {
  return translator ? translator(key, params) : key;
}
