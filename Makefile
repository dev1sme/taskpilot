.PHONY: install dev build start typecheck test lint format e2e link clean run \
	service-install service-uninstall service-restart service-status service-logs

UNIT_DIR := $(HOME)/.config/systemd/user
UNIT     := $(UNIT_DIR)/taskpilot.service

install:
	npm install

dev:
	@trap 'kill 0' EXIT INT TERM; \
	npm run dev:server & \
	npm run dev:web & \
	wait

build:
	npm run build

start:
	npm start

typecheck:
	npm run typecheck

test:
	npm test

lint:
	npm run lint

format:
	npm run format

e2e:
	npm run e2e

link:
	npm link

clean:
	rm -rf apps/*/dist packages/*/dist apps/server/types

run:
	taskpilot --open --repo $(REPO)

# Runs TaskPilot as a systemd user service with the node and claude found on the current PATH,
# and copilot too when it is installed.
service-install: build
	@test -f .env || { echo "missing .env: cp .env.example .env and fill it in"; exit 1; }
	@node=$$(command -v node) && claude=$$(command -v claude) || { echo "node and claude must be on PATH"; exit 1; }; \
	copilot=$$(command -v copilot); \
	mkdir -p $(UNIT_DIR); \
	sed -e "s|@NODE@|$$node|" -e "s|@APP_DIR@|$(CURDIR)|" \
	    -e "s|@PATH@|$$(dirname $$node):$$(dirname $$claude)$${copilot:+:$$(dirname $$copilot)}:/usr/local/bin:/usr/bin:/bin|" \
	    deploy/taskpilot.service.in > $(UNIT); \
	echo "wrote $(UNIT)"
	systemctl --user daemon-reload
	systemctl --user enable --now taskpilot
	systemctl --user restart taskpilot

service-uninstall:
	-systemctl --user disable --now taskpilot
	rm -f $(UNIT)
	systemctl --user daemon-reload

# Picks up new code and .env changes. Sessions stop; resume them from the UI.
service-restart: build
	systemctl --user restart taskpilot

service-status:
	systemctl --user status taskpilot --no-pager

service-logs:
	journalctl --user -u taskpilot -f
