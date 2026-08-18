// A CI failure this project cannot read is a CI failure it cannot fix.
//
// The run log needs a token, and there isn't one here — so a red build only ever said
// which STEP failed, never which assertion. Two rounds of plausible-sounding guesses were
// pushed and neither was the cause.
//
// The artifact LIST, though, is public. So on failure the suites write the labels of the
// checks that failed to $GP_DIAG, and the workflow uploads an artifact named after them.
// The name comes back from the API, and the name is the diagnosis.
import fs from 'node:fs';

// Slugify for use as an artifact name: those reject / \ : * ? " < > | and are awkward with
// spaces. Hebrew survives, so a Hebrew label still reads on the other side.
const slugify = (parts) => parts
  .map((f) => String(f).replace(/[^a-zA-Z0-9֐-׿]+/g, '-').replace(/^-|-$/g, '').slice(0, 150))
  .join('__AND__')
  .slice(0, 190) || 'unnamed';

// For a script that collects free-text failures rather than named checks.
export function writeDiag(messages) {
  if (!process.env.GP_DIAG || !messages.length) return;
  try { fs.writeFileSync(process.env.GP_DIAG, slugify(messages)); } catch { /* never mask the real failure */ }
}

// A crash is a diagnosis too, and it is the case that otherwise reports as
// "step-failed-before-any-assertion" — true, and useless. Installed on import: every suite
// here imports this module, and none of them has a reason to want the default behaviour.
for (const ev of ['uncaughtException', 'unhandledRejection']) {
  process.on(ev, (e) => {
    const msg = `${ev} ${(e && e.message) || e}`;
    console.log(`\nCRASH ${msg}`);
    if (e && e.stack) console.log(e.stack);
    writeDiag([`CRASH ${msg}`]);
    process.exit(1);
  });
}

export function checker() {
  const failed = [];
  const check = (label, ok, got) => {
    if (ok) { console.log(`  ok   ${label}`); return true; }
    console.log(`  FAIL ${label}${got !== undefined ? ` — ${JSON.stringify(got)}` : ''}`);
    // The observed value goes in too. "no page errors" names the assertion but not the
    // error, and the error is the part that says what to fix.
    failed.push(label + (got === undefined ? '' : ' GOT ' + JSON.stringify(got)));
    return false;
  };
  // Call instead of process.exit(). Returns the exit code so a caller can still decide.
  const finish = () => {
    writeDiag(failed);
    console.log(failed.length ? `\n${failed.length} FAILED` : '\nall green');
    return failed.length ? 1 : 0;
  };
  return { check, finish, failed };
}
