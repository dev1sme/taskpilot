// M0 spike: spawn interactive claude in a PTY, inject hooks via --settings,
// paste a multi-line prompt with bracketed paste, wait for the Stop hook.
// Throwaway reference. Expects ./demo-repo with .claude/tasks/DEMO-1/spec/req.md and `npm i node-pty`.
// Results are recorded in docs/SPEC.md §7.
const pty = require('node-pty');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SP = __dirname;
const repo = path.join(SP, 'demo-repo');
const hookLog = path.join(SP, 'hooks.log');
const rawLog = path.join(SP, 'pty.log');
fs.rmSync(hookLog, { force: true });
fs.rmSync(rawLog, { force: true });

const sessionId = crypto.randomUUID();
const hook = (label) => ({
  hooks: [{ type: 'command', command: `{ echo "=== ${label}"; cat; echo; } >> '${hookLog}'` }],
});
const settings = { hooks: { Stop: [hook('STOP')], Notification: [hook('NOTIFY')] } };

const prompt = [
  'Read .claude/tasks/DEMO-1/spec/req.md.',
  'Then write a 2-line plan into .claude/tasks/DEMO-1/02-plan.md.',
  'This prompt has three lines to test bracketed paste.',
].join('\n');

const p = pty.spawn('claude', ['--session-id', sessionId, '--settings', JSON.stringify(settings), '--model', 'haiku', '--permission-mode', 'default'], {
  name: 'xterm-256color', cols: 140, rows: 40, cwd: repo, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLAUDE/.test(k))),
});

const strip = (s) => s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
let buf = '';
let idleTimer;
let stage = 'boot';
const events = [];
const note = (e) => { events.push(`${new Date().toISOString()} ${e}`); console.log(e); };

p.onData((d) => {
  fs.appendFileSync(rawLog, d);
  buf += strip(d);
  if (stage === 'boot' && /trust/i.test(buf)) { note('trust dialog -> Down+Enter'); stage = 'trusted'; buf = ''; setTimeout(() => p.write('\x1b[B'), 400); setTimeout(() => p.write('\r'), 800); }
  if (stage === 'sent' && /Do you want to/i.test(buf)) {
    note('PERMISSION PROMPT seen: ' + buf.slice(buf.search(/Do you want to/i), buf.search(/Do you want to/i) + 200).replace(/\s+/g, ' '));
    stage = 'perm'; buf = '';
    setTimeout(() => p.write('\r'), 500);
  }
  if (stage === 'perm' && /Do you want to/i.test(buf)) { note('another permission prompt'); buf = ''; setTimeout(() => p.write('\r'), 500); }
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (stage === 'boot' || stage === 'trusted') {
      note('idle -> paste prompt');
      stage = 'sent'; buf = '';
      p.write('\x1b[200~' + prompt + '\x1b[201~');
      setTimeout(() => p.write('\r'), 300);
    }
  }, 3000);
});

p.onExit((e) => finish('pty exit ' + JSON.stringify(e)));
const poll = setInterval(() => {
  if (fs.existsSync(hookLog) && /=== STOP/.test(fs.readFileSync(hookLog, 'utf8'))) finish('stop hook fired');
}, 1000);
const timeout = setTimeout(() => finish('TIMEOUT'), 240000);

let finished = false;
function finish(why) {
  if (finished) { note('late: ' + why); return; }
  finished = true;
  clearInterval(poll); clearTimeout(timeout); clearTimeout(idleTimer);
  note('finish: ' + why);
  fs.writeFileSync(path.join(SP, 'result.json'), JSON.stringify({ sessionId, events }, null, 2));
  try {
    const ev = JSON.parse(fs.readFileSync(hookLog, 'utf8').split('=== STOP\n')[1].split('\n')[0]);
    note('transcript exists at stop: ' + fs.existsSync(ev.transcript_path) + ' ' + ev.transcript_path);
    globalThis.tp = ev.transcript_path;
  } catch (e) { note('parse fail ' + e.message); }
  p.write('/exit');
  setTimeout(() => p.write('\r'), 300);
  setTimeout(() => { note('after /exit transcript exists: ' + (globalThis.tp && fs.existsSync(globalThis.tp))); try { p.kill(); } catch {} process.exit(0); }, 6000);
}
