# Load Testing Suite

Script de pruebas de carga para la API de MemTrace. Genera 100 peticiones concurrentes cada 2 minutos durante 10 iteraciones, usando datos mockeados.

## Instalación

```bash
pip install -r requirements.txt
```

## Uso

### Ejecución básica (por defecto: 10 batches, 100 requests/batch, intervalo de 2 minutos)

```bash
python load_test.py
```

### Con parámetros personalizados

```bash
# Cambiar URL
python load_test.py --url http://localhost:3000

# Cambiar número de batches
python load_test.py --batches 5

# Cambiar requests por batch
python load_test.py --requests 50

# Cambiar intervalo entre batches (en segundos)
python load_test.py --interval 60

# Combinar parámetros
python load_test.py --batches 20 --requests 200 --interval 120
```

## Características

- ✅ 100 requests concurrentes por batch
- ✅ 10 batches separados por 2 minutos (configurable)
- ✅ Datos completamente mockeados (sin llamadas reales a LLMs)
- ✅ Endpoints testeados: `/traces`, `/spans`, `/conversations`, `/services`, `/health`
- ✅ Simulación de latencia realista (20-200ms)
- ✅ Reporte detallado: estadísticas por batch y resumen final
- ✅ Soporte para interrumpir con Ctrl+C

## Métricas capturadas

- Requests exitosos/fallidos
- Tiempo de respuesta (min, max, promedio)
- Tasa de éxito general
- Tiempo total de ejecución

## Notas

- Los datos son 100% mockeados, no hay consumo de créditos de LLMs
- Las peticiones se ejecutan concurrentemente (asyncio)
- Puedes interrumpir el test en cualquier momento con Ctrl+C
