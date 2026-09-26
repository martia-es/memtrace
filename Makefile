CLUSTER ?= memtrace-cluster
NS      ?= memtrace
PYTHON  ?= python3
# Nombre completo: Podman antepone "localhost/" a los nombres cortos y el pod (memtrace/api:dev) no la encontraría
API_IMAGE  ?= docker.io/memtrace/api:dev
DASH_IMAGE ?= docker.io/memtrace/dashboard:dev

.DEFAULT_GOAL := help
.PHONY: help check up images status forward logs query migrate down reset dev dev-data

help: ## Muestra esta ayuda
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

check: ## Comprueba que docker, kind y kubectl están instalados
	@for tool in docker kind kubectl; do \
		command -v $$tool >/dev/null 2>&1 || { echo "Falta '$$tool': instálalo antes de continuar"; exit 1; }; \
	done
	@docker info >/dev/null 2>&1 || { echo "Docker no está en ejecución"; exit 1; }
	@echo "OK: docker, kind y kubectl disponibles"

up: check ## Levanta todo en 1 solo comando (clúster, despliegue, migraciones y puertos)
	@if kind get clusters 2>/dev/null | grep -q "^$(CLUSTER)$$"; then \
		echo "El clúster '$(CLUSTER)' ya existe."; \
		docker start $(CLUSTER)-control-plane >/dev/null 2>&1 || true; \
	else \
		kind create cluster --name $(CLUSTER); \
	fi
	kubectl config use-context kind-$(CLUSTER)
	@$(MAKE) --no-print-directory images
	kubectl apply -k .
	kubectl wait --for=condition=complete job/clickhouse-migrate -n $(NS) --timeout=300s
	kubectl rollout status statefulset/clickhouse -n $(NS) --timeout=300s
	kubectl rollout status deployment/otel-collector -n $(NS) --timeout=300s
	kubectl rollout status deployment/api -n $(NS) --timeout=300s
	kubectl rollout status deployment/dashboard -n $(NS) --timeout=300s
	@pkill -f "kubectl port-forward" 2>/dev/null || true
	@nohup kubectl port-forward svc/otel-collector 4317:4317 4318:4318 -n $(NS) >/dev/null 2>&1 &
	@nohup kubectl port-forward svc/clickhouse 8123:8123 -n $(NS) >/dev/null 2>&1 &
	@nohup kubectl port-forward svc/dashboard 8080:8080 -n $(NS) >/dev/null 2>&1 &
	@echo ""
	@echo "✨ ¡Todo listo en 1 solo comando!"
	@echo "  • Dashboard:         http://localhost:8080"
	@echo "  • UI de ClickHouse:  http://localhost:8123/play (Usuario: default | Pass: memtrace-dev-only)"
	@echo "  • OTel Collector:    localhost:4317 (gRPC) / localhost:4318 (HTTP)"
	@echo ""

images: ## Construye las imágenes de la API y el dashboard y las carga en el clúster (reinicia sus pods)
	docker build -t $(API_IMAGE) api
	docker build -f dashboard/Dockerfile -t $(DASH_IMAGE) .
	@tmp=$$(mktemp -t memtrace-image.XXXXXX); \
	for img in $(API_IMAGE) $(DASH_IMAGE); do \
		docker save -o $$tmp $$img && kind load image-archive $$tmp --name $(CLUSTER) || { rm -f $$tmp; exit 1; }; \
	done; rm -f $$tmp
	@kubectl rollout restart deployment/api deployment/dashboard -n $(NS) 2>/dev/null || true

status: ## Estado de pods, volúmenes y migraciones
	kubectl get pods,pvc,job -n $(NS)

forward: ## Re-ejecuta la redirección de puertos en primer plano (Ctrl+C para parar)
	@echo "Exponiendo OTel Collector (4317, 4318), ClickHouse UI (8123) y el dashboard (http://localhost:8080)..."
	@trap 'kill 0' EXIT; \
	kubectl port-forward svc/otel-collector 4317:4317 4318:4318 -n $(NS) & \
	kubectl port-forward svc/clickhouse 8123:8123 -n $(NS) & \
	kubectl port-forward svc/dashboard 8080:8080 -n $(NS) & \
	wait

logs: ## Logs del Collector (útil para ver errores de inserción)
	kubectl logs deploy/otel-collector -n $(NS) --tail=100 -f

query: ## Spans y trazas por servicio guardadas en ClickHouse
	kubectl exec statefulset/clickhouse -n $(NS) -- sh -c \
		'clickhouse-client --password "$$CLICKHOUSE_PASSWORD" --query "SELECT ServiceName, count() AS spans, uniqExact(TraceId) AS traces FROM memtrace.otel_traces GROUP BY ServiceName FORMAT PrettyCompact"'

migrate: ## Relanza las migraciones de ClickHouse
	kubectl delete job clickhouse-migrate -n $(NS) --ignore-not-found
	kubectl apply -k .
	kubectl wait --for=condition=complete job/clickhouse-migrate -n $(NS) --timeout=300s

down: ## Para el clúster conservando los datos (reanuda con 'make up')
	@pkill -f "kubectl port-forward" 2>/dev/null || true
	docker stop $(CLUSTER)-control-plane 2>/dev/null || true

reset: ## BORRA el clúster y TODOS los datos (pide confirmación)
	@read -p "Esto elimina el clúster '$(CLUSTER)' y todas las trazas. ¿Seguro? [y/N] " ans; \
	if [ "$$ans" = "y" ] || [ "$$ans" = "Y" ]; then \
		pkill -f "kubectl port-forward" 2>/dev/null || true; \
		kind delete cluster --name $(CLUSTER); \
	else \
		echo "Cancelado"; \
	fi

dev: ## Levanta la API (:3001) y el dashboard (:5173) a la vez (Ctrl+C para parar; requiere 'make up')
	@command -v node >/dev/null 2>&1 || { echo "Falta 'node': instálalo antes de continuar"; exit 1; }
	@[ -d api/node_modules ] || (cd api && npm install)
	@[ -d dashboard/node_modules ] || (cd dashboard && npm install)
	@curl -s -o /dev/null --max-time 2 http://localhost:8123/ping || echo "⚠️  ClickHouse no responde en localhost:8123: ejecuta 'make up' (o 'make forward') primero"
	@echo "API → http://localhost:3001  |  Dashboard → http://localhost:5173  (Ctrl+C para parar)"
	@trap 'kill 0' EXIT; \
	(cd api && CLICKHOUSE_PASSWORD=$${CLICKHOUSE_PASSWORD:-memtrace-dev-only} npm run dev) & \
	(cd dashboard && npm run dev) & \
	wait

dev-data: ## Genera trazas de ejemplo (agente simulado) para probar el dashboard
	@$(PYTHON) -c "import opentelemetry.sdk" 2>/dev/null || { echo "Falta el SDK de Python: pip install -e sdk/python"; exit 1; }
	MEMTRACE_CAPTURE_CONTENT=true MEMTRACE_BATCH_SCHEDULE_DELAY_MS=500 $(PYTHON) examples/02_multi_step_agent.py
