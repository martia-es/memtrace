CLUSTER ?= memtrace-cluster
NS      ?= memtrace
PYTHON  ?= python3
# Nombre completo: Podman antepone "localhost/" a los nombres cortos y el pod (memtrace/api:dev) no la encontraría
API_IMAGE  ?= docker.io/memtrace/api:dev
DASH_IMAGE ?= docker.io/memtrace/dashboard:dev
DOCS_IMAGE ?= docker.io/memtrace/docs:dev
# Debe coincidir con la imagen del CronJob (k8s/81-model-pricing-sync.yaml)
PRICING_IMAGE ?= localhost/memtrace/model-pricing:dev

.DEFAULT_GOAL := help
.PHONY: help check up images dashboard api status forward logs query migrate migrate-postgres pricing-sync down reset db-reset dev-data docs weather weather-bg weather-stop weather-restart

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
	kubectl rollout status statefulset/postgres -n $(NS) --timeout=300s
	kubectl rollout status deployment/otel-collector -n $(NS) --timeout=300s
	kubectl rollout status deployment/api -n $(NS) --timeout=300s
	kubectl rollout status deployment/dashboard -n $(NS) --timeout=300s
	kubectl rollout status deployment/docs -n $(NS) --timeout=300s
	@$(MAKE) --no-print-directory pricing-sync
	@pkill -f "kubectl port-forward" 2>/dev/null || true
	@nohup kubectl port-forward svc/otel-collector 4317:4317 4318:4318 -n $(NS) >/dev/null 2>&1 &
	@nohup kubectl port-forward svc/clickhouse 8123:8123 -n $(NS) >/dev/null 2>&1 &
	@nohup kubectl port-forward svc/dashboard 8080:8080 -n $(NS) >/dev/null 2>&1 &
	@nohup kubectl port-forward svc/postgres 5432:5432 -n $(NS) >/dev/null 2>&1 &
	@nohup kubectl port-forward svc/docs 8081:8080 -n $(NS) >/dev/null 2>&1 &
	@nohup kubectl port-forward svc/api 3001:3001 -n $(NS) >/dev/null 2>&1 &
	@$(MAKE) --no-print-directory weather-bg
	@echo ""
	@echo "✨ ¡Todo listo en 1 solo comando!"
	@echo "  • Dashboard:         http://localhost:8080"
	@echo "  • Documentación:     http://localhost:8081"
	@echo "  • API (SDK/ejemplos): http://localhost:3001"
	@echo "  • UI de ClickHouse:  http://localhost:8123/play (Usuario: default | Pass: memtrace-dev-only)"
	@echo "  • Asistente del tiempo: http://localhost:8000 (logs: weather_assistant/uvicorn.log)"
	@echo "  • OTel Collector:    localhost:4317 (gRPC) / localhost:4318 (HTTP)"
	@echo "  • Postgres:          localhost:5432 (Usuario: memtrace | DB: memtrace_identity | Pass: memtrace-dev-only)"
	@echo ""

images: ## Construye las imágenes de la API, el dashboard y la documentación y las carga en el clúster (reinicia sus pods)
	docker build -t $(API_IMAGE) api
	docker build -f dashboard/Dockerfile -t $(DASH_IMAGE) .
	docker build -t $(DOCS_IMAGE) docs-site
	docker build -t $(PRICING_IMAGE) analytics/model_pricing
	@tmp=$$(mktemp -t memtrace-image.XXXXXX); \
	for img in $(API_IMAGE) $(DASH_IMAGE) $(DOCS_IMAGE) $(PRICING_IMAGE); do \
		docker save -o $$tmp $$img && kind load image-archive $$tmp --name $(CLUSTER) || { rm -f $$tmp; exit 1; }; \
	done; rm -f $$tmp
	@kubectl rollout restart deployment/api deployment/dashboard deployment/docs -n $(NS) 2>/dev/null || true

# Reconstruye UNA imagen, la carga en el clúster, reinicia su deployment y relanza solo su port-forward
# $(1)=deployment  $(2)=imagen  $(3)=comando docker build  $(4)=puerto local:servicio
define redeploy
	$(3)
	@tmp=$$(mktemp -t memtrace-image.XXXXXX); \
	docker save -o $$tmp $(2) && kind load image-archive $$tmp --name $(CLUSTER) || { rm -f $$tmp; exit 1; }; rm -f $$tmp
	kubectl rollout restart deployment/$(1) -n $(NS)
	kubectl rollout status deployment/$(1) -n $(NS) --timeout=300s
	@pkill -f "kubectl port-forward svc/$(1) " 2>/dev/null || true
	@nohup kubectl port-forward svc/$(1) $(4) -n $(NS) >/dev/null 2>&1 &
endef

dashboard: ## Reconstruye y despliega solo el dashboard (más rápido que make images)
	$(call redeploy,dashboard,$(DASH_IMAGE),docker build -f dashboard/Dockerfile -t $(DASH_IMAGE) .,8080:8080)
	@echo "Dashboard actualizado: http://localhost:8080 (recarga forzada: Ctrl/Cmd+Shift+R)"

api: ## Reconstruye y despliega solo la API (más rápido que make images)
	$(call redeploy,api,$(API_IMAGE),docker build -t $(API_IMAGE) api,3001:3001)
	@echo "API actualizada: http://localhost:3001"

docs: ## Reconstruye y despliega solo la documentación (más rápido que make images)
	$(call redeploy,docs,$(DOCS_IMAGE),docker build -t $(DOCS_IMAGE) docs-site,8081:8080)
	@echo "Documentación actualizada: http://localhost:8081 (recarga forzada: Ctrl/Cmd+Shift+R)"

status: ## Estado de pods, volúmenes y migraciones
	kubectl get pods,pvc,job -n $(NS)

forward: ## Re-ejecuta la redirección de puertos en primer plano (Ctrl+C para parar)
	@echo "Exponiendo OTel Collector (4317, 4318), ClickHouse UI (8123), Postgres (5432), la API (3001) el dashboard (http://localhost:8080) y la documentación (http://localhost:8081)..."
	@trap 'kill 0' EXIT; \
	kubectl port-forward svc/otel-collector 4317:4317 4318:4318 -n $(NS) & \
	kubectl port-forward svc/clickhouse 8123:8123 -n $(NS) & \
	kubectl port-forward svc/dashboard 8080:8080 -n $(NS) & \
	kubectl port-forward svc/postgres 5432:5432 -n $(NS) & \
	kubectl port-forward svc/docs 8081:8080 -n $(NS) & \
	kubectl port-forward svc/api 3001:3001 -n $(NS) & \
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

migrate-postgres: ## Relanza las migraciones de Postgres (necesario tras añadir un archivo en migrations/postgres/)
	kubectl delete job postgres-migrate -n $(NS) --ignore-not-found
	kubectl apply -k .
	kubectl wait --for=condition=complete job/postgres-migrate -n $(NS) --timeout=300s

pricing-sync: ## Puebla la tabla de costes (model_pricing) ahora, sin esperar al CronJob diario (no falla si no hay red)
	@kubectl delete job model-pricing-sync-manual -n $(NS) --ignore-not-found >/dev/null
	@kubectl create job model-pricing-sync-manual --from=cronjob/model-pricing-sync -n $(NS) >/dev/null
	@kubectl wait --for=condition=complete job/model-pricing-sync-manual -n $(NS) --timeout=180s \
		&& echo "Tabla de costes poblada" \
		|| echo "Aviso: la sincronización de precios falló (¿sin red?). Reintenta con 'make pricing-sync'"

down: weather-stop ## Para el clúster conservando los datos (reanuda con 'make up')
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

db-reset: ## BORRA las tablas de Postgres y ClickHouse (conserva el clúster) y relanza las migraciones (pide confirmación)
	@read -p "Esto borra TODAS las tablas de Postgres y ClickHouse (trazas, datasets, usuarios...). ¿Seguro? [y/N] " ans; \
	if [ "$$ans" = "y" ] || [ "$$ans" = "Y" ]; then \
		kubectl exec statefulset/postgres -n $(NS) -- sh -c 'psql -U memtrace -d memtrace_identity -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"' && \
		kubectl exec statefulset/clickhouse -n $(NS) -- sh -c 'clickhouse-client --password "$$CLICKHOUSE_PASSWORD" --query "DROP DATABASE IF EXISTS memtrace SYNC"' && \
		$(MAKE) --no-print-directory migrate migrate-postgres && \
		kubectl rollout restart deployment/api deployment/otel-collector -n $(NS) && \
		echo "Bases de datos reseteadas y migraciones aplicadas"; \
	else \
		echo "Cancelado"; \
	fi

dev-data: ## Genera trazas de ejemplo (agente simulado) para probar el dashboard
	@$(PYTHON) -c "import opentelemetry.sdk" 2>/dev/null || { echo "Falta el SDK de Python: pip install -e sdk/python"; exit 1; }
	MEMTRACE_CAPTURE_CONTENT=true MEMTRACE_BATCH_SCHEDULE_DELAY_MS=500 $(PYTHON) examples/02_multi_step_agent.py

weather: ## Arranca el asistente del tiempo (API + UI en http://localhost:8000). Ctrl+C para parar
	@command -v uv >/dev/null 2>&1 || { echo "Falta 'uv': instálalo antes de continuar"; exit 1; }
	cd weather_assistant && uv sync --all-groups && uv run uvicorn app.main:app --reload --port 8000

weather-stop: ## Para el asistente del tiempo lanzado en segundo plano
	@pkill -f "uvicorn app.main:app --reload --port 8000" 2>/dev/null || true

# Relanza el asistente en segundo plano: el proceso nuevo relee el .env (la API key de MemTrace se lee solo al arrancar)
weather-bg: weather-stop ## Arranca el asistente del tiempo en segundo plano (lo usa make up)
	@command -v uv >/dev/null 2>&1 || { echo "Falta 'uv': omito el asistente del tiempo"; exit 0; }
	@cd weather_assistant && uv sync --all-groups >/dev/null && \
		(nohup uv run uvicorn app.main:app --reload --port 8000 >uvicorn.log 2>&1 &)

weather-restart: weather-bg ## Reinicia el asistente del tiempo (relee el .env: API key, id del experimento y prompt solo se leen al arrancar)
	@sleep 4
	@echo "Asistente reiniciado: http://localhost:8000 (logs: weather_assistant/uvicorn.log)"
	@curl -s -m 5 http://localhost:8000/api/prompt && echo || echo "Aún arrancando: revisa weather_assistant/uvicorn.log"

diagrams:
	cd docs/architecture && env -u GEMINI_API_KEY npx likec4@1.59.2 serve

NGROK_DOMAIN ?= data-unsealed-resigned.ngrok-free.dev

tunel: ## Expone la API (puerto 3001) en un dominio público fijo de ngrok: lo necesita el webhook de la GitHub App (ADR-064)
	@command -v ngrok >/dev/null 2>&1 || { echo "Falta 'ngrok': brew install ngrok"; exit 1; }
	@echo "Webhook URL de la GitHub App: https://$(NGROK_DOMAIN)/api/v1/webhooks/github"
	ngrok http --url=$(NGROK_DOMAIN) 3001
