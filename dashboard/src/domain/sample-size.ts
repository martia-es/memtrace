/** Por debajo de este número de ejecuciones, un porcentaje o una tendencia dicen poco: la pantalla avisa en vez de dramatizar. */
export const MIN_RELIABLE_RUNS = 20;

/** Hay datos, pero pocos: 0 ejecuciones es «sin datos», no «muestra pequeña». */
export const isSmallSample = (runs: number): boolean => runs > 0 && runs < MIN_RELIABLE_RUNS;
