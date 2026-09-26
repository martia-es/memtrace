# Load Testing Examples

## Escenarios de uso

### 1. Test por defecto (10 batches × 100 requests, intervalo 2 minutos)

```bash
./run.sh
# o
python load_test.py
```

Resultado esperado:
- 1000 requests totales
- ~20 minutos de duración total (10 batches × 2 minutos)
- Salida de métricas cada batch y resumen final

### 2. Test rápido (5 batches, 50 requests, intervalo 10 segundos)

```bash
./run.sh --batches 5 --requests 50 --interval 10
```

Ideal para validar que el sistema está funcionando correctamente antes de un test completo.

### 3. Test intenso (20 batches, 200 requests, intervalo 60 segundos)

```bash
./run.sh --batches 20 --requests 200 --interval 60
```

Genera stress más importante en el sistema (4000 requests totales).

### 4. Test con URL personalizada

Si tu API no corre en localhost:3000:

```bash
./run.sh --url http://192.168.1.100:8080
```

### 5. Test de capacidad máxima (1000 requests por batch)

```bash
./run.sh --batches 3 --requests 1000 --interval 30
```

3000 requests totales con 30 segundos entre batches.

## Interpretar resultados

### Salida por batch

```
============================================================
Batch 1: Starting 100 requests
Time: 2024-09-26 15:30:45
============================================================

Batch 1 Results:
  Successful: 100/100
  Failed: 0/100
  Avg Response Time: 58.43ms
  Min Response Time: 22.15ms
  Max Response Time: 198.76ms
```

- **Successful/Failed**: Tasa de éxito
- **Response Time**: Latencia de las peticiones

### Resumen final

```
========================================================== 
📊 FINAL SUMMARY
===========================================================
Total Time: 1243.52s (20+ minutos)
Total Requests: 1000
  ✓ Successful: 1000
  ✗ Failed: 0
Success Rate: 100.0%

Response Times:
  Average: 62.18ms
  Min: 18.92ms
  Max: 199.87ms
===========================================================
```

Qué buscar:
- **Success Rate**: Debería ser 100% (o muy cercano)
- **Response Times**: 
  - Promedio < 100ms es bueno
  - P95 < 200ms es aceptable
  - Máximo no debería superar 500ms en condiciones normales

## Cancelar un test

Presiona **Ctrl+C** en cualquier momento. El script mostrará un mensaje de interrupción y detendrá los batches restantes.

## Troubleshooting

### Error: "Connection refused"
La API no está disponible en la URL especificada. Verifica que:
1. El servidor está corriendo (`npm run dev` en `/api`)
2. El puerto es correcto (por defecto 3000)
3. La URL es accesible

### Error: "httpx module not found"
Instala las dependencias:
```bash
pip install -r requirements.txt
```

### Latencias muy altas (> 500ms)
El sistema está bajo stress. Considera:
- Reducir `--requests` o `--batches`
- Aumentar `--interval`
- Revisar recursos del servidor (CPU, memoria, I/O)
