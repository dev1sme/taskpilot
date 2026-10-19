.PHONY: install dev build start typecheck test link clean run

install:
	npm install

dev:
	@trap 'kill 0' EXIT INT TERM; \
	npm run dev:server & \
	npm run dev:client & \
	wait

build:
	npm run build

start:
	npm start

typecheck:
	npm run typecheck

test:
	npm test

link:
	npm link

clean:
	rm -rf dist

run:
	taskpilot --open --repo $(REPO)
