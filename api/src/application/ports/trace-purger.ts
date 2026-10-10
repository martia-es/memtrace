/** Borrado de trazas antiguas en el almacén analítico (ADR-084). Lo implementa un adapter con un usuario que solo puede borrar. */
export interface TracePurger {
  /** Borra los spans (y sus temáticas derivadas) del servicio anteriores a `cutoff`. Devuelve cuántos spans había que borrar. */
  purge(serviceName: string, cutoff: Date): Promise<{ spans: number }>;
}
