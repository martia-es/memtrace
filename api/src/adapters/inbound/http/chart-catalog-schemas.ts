import { z } from "zod";

/**
 * Cuerpos de las rutas del catálogo de datos de las Custom charts (ADR-077). El tipo, la clave, el nombre y la visibilidad los
 * valida el dominio con mensajes por campo; aquí solo se exige la forma y se acotan los tamaños.
 */

export const saveCatalogEntryBody = z.object({
  kind: z.string().max(20),
  key: z.string().max(400),
  /** null o en blanco = sin nombre propio */
  displayName: z.string().max(400).nullable().optional(),
  visibility: z.string().max(20).optional(),
});

/** Quitar la edición: el tipo y la clave van en la query string (una clave puede llevar puntos o barras). */
export const catalogEntryQuery = z.object({ kind: z.string().max(20), key: z.string().max(400) });
