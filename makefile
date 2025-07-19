# Makefile
# Makefile for Malecom Suits

.PHONY: help setup dev prod stop clean logs backup restore test

help: ## Show this help message
	@echo "Malecom Suits - Available Commands:"
	@echo ""
	@awk 'BEGIN {FS = ":.*##"; printf "Usage: make [command]\n\nCommands:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  %-15s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

setup: ## Initial setup and start services
	@chmod +x scripts/*.sh
	@./setup.sh

dev: ## Start development environment
	@./scripts/dev.sh

prod: ## Deploy to production
	@./scripts/prod.sh

stop: ## Stop all services
	@docker-compose down

restart: ## Restart all services
	@docker-compose restart

clean: ## Clean up Docker resources
	@./scripts/clean.sh

logs: ## View all logs (use 'make logs SERVICE=backend' for specific service)
	@./scripts/logs.sh $(SERVICE)

backup: ## Create database backup
	@./scripts/backup.sh

restore: ## Restore database (use 'make restore FILE=backup.sql')
	@./scripts/restore.sh $(FILE)

build: ## Build all Docker images
	@docker-compose build

pull: ## Pull latest base images
	@docker-compose pull

ps: ## Show running containers
	@docker-compose ps

exec-backend: ## Open shell in backend container
	@docker-compose exec backend sh

exec-db: ## Open MySQL shell
	@docker-compose exec database mysql -u root -p

test: ## Run tests
	@docker-compose exec backend npm test

install: ## Install dependencies
	@docker-compose exec backend npm install
	@docker-compose exec frontend npm install

# Default target
all: setup