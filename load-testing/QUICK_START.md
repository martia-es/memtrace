# Quick Start - 30 segundos

## Paso 1: Instala dependencias (primera vez)

```bash
pip install -r requirements.txt
```

## Paso 2: Ejecuta el test

```bash
./run.sh
```

o directamente:

```bash
python load_test.py
```

## Eso es todo 🎉

El script:
- ✅ Lanzará 100 peticiones concurrentes
- ✅ Esperará 2 minutos
- ✅ Repetirá 10 veces
- ✅ Mostrará estadísticas en tiempo real
- ✅ Generará un resumen final

---

## Opciones avanzadas (si necesitas customizar)

```bash
# 5 batches en lugar de 10
./run.sh --batches 5

# 200 requests por batch en lugar de 100
./run.sh --requests 200

# Intervalo de 1 minuto en lugar de 2
./run.sh --interval 60

# Todo junto
./run.sh --batches 5 --requests 200 --interval 60
```

---

## Cancelar el test

Presiona **Ctrl+C** en cualquier momento.

---

Ver `EXAMPLES.md` para escenarios detallados y `README.md` para documentación completa.
