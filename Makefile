CLUSTER ?= memtrace-cluster
NS      ?= memtrace

.DEFAULT_GOAL := help
.PHONY: help check up status forward logs query migrate down reset

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
	kubectl apply -k .
	kubectl wait --for=condition=complete job/clickhouse-migrate -n $(NS) --timeout=300s
	kubectl rollout status statefulset/clickhouse -n $(NS) --timeout=300s
	kubectl rollout status deployment/otel-collector -n $(NS) --timeout=300s
	@pkill -f "kubectl port-forward" 2>/dev/null || true
	@nohup kubectl port-forward svc/otel-collector 4317:4317 4318:4318 -n $(NS) >/dev/null 2>&1 &
	@nohup kubectl port-forward svc/clickhouse 8123:8123 -n $(NS) >/dev/null 2>&1 &
	@echo ""
	@echo "✨ ¡Todo listo en 1 solo comando!"
	@echo "  • UI de ClickHouse:  http://localhost:8123/play (Usuario: default | Pass: memtrace-dev-only)"
	@echo "  • OTel Collector:    localhost:4317 (gRPC) / localhost:4318 (HTTP)"
	@echo ""

status: ## Estado de pods, volúmenes y migraciones
	kubectl get pods,pvc,job -n $(NS)

forward: ## Re-ejecuta la redirección de puertos en primer plano (Ctrl+C para parar)
	@echo "Exponiendo OTel Collector (4317, 4318) y ClickHouse UI (8123 en http://localhost:8123/play)..."
	@trap 'kill 0' EXIT; \
	kubectl port-forward svc/otel-collector 4317:4317 4318:4318 -n $(NS) & \
	kubectl port-forward svc/clickhouse 8123:8123 -n $(NS) & \
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
