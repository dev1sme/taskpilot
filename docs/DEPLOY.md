# Running in production

## Run as a service

```bash
cp .env.example .env && chmod 600 .env   # set TASKPILOT_AUTH_*, and HOST / ALLOWED_HOSTS if proxied
make service-install                     # build, write ~/.config/systemd/user/taskpilot.service, start
make service-restart                     # after pulling new code or editing .env
make service-logs                        # or service-status, service-uninstall
```

The unit is a systemd *user* service so `claude` runs with your own `~/.claude`. It uses the `node`
and `claude` on your `PATH` at install time: run `make service-install` again after changing the
Node version. It only runs while you are logged in unless lingering is on
(`loginctl enable-linger $USER`). Restarting stops running sessions; resume them from the UI.

Behind a reverse proxy in Docker, listen on the docker0 address (`TASKPILOT_HOST=172.17.0.1`),
proxy to `http://host.docker.internal:8790` with WebSocket upgrade headers, and list the proxy's
domain in `TASKPILOT_ALLOWED_HOSTS`. Hook callbacks go straight to the listen address, so the proxy
can refuse `/hook/`. Set `TASKPILOT_AUTH_USER` / `TASKPILOT_AUTH_PASSWORD`: anyone who logs in
gets a shell on this machine.

## Security

The embedded terminal is a shell on your machine, so TaskPilot:

- listens on `127.0.0.1` by default and rejects `Host` / `Origin` headers other than loopback, the
  listen address and `TASKPILOT_ALLOWED_HOSTS` (DNS rebinding, cross-site WebSockets);
- requires a login session on every API call, event stream and WebSocket: an `HttpOnly`,
  `SameSite=Strict` cookie (`Secure` over https) lasting 7 days, obtained with the user and
  password or, without them, with the per-start token. Sessions are kept hashed in
  `~/.taskpilot/auth-sessions.json`. Five failed logins lock the client out for 15 minutes;
- authenticates hook callbacks with a token per session process.
