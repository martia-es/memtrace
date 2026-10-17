/**
 * Puerto de traducción del dominio: los módulos del dominio producen frases para la pantalla (etiquetas, notas, avisos) sin
 * conocer el idioma ni el framework. La interfaz registra aquí su traductor al arrancar; sin traductor, devuelve la clave.
 */
export type Translator = (key: string, params?: Record<string, string | number>) => string;

let translator: Translator | null = null;

export function setTranslator(fn: Translator): void {
  translator = fn;
}

export function tr(key: string, params?: Record<string, string | number>): string {
  return translator ? translator(key, params) : key;
}
