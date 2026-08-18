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

export function checker() {
  const failed = [];
  const check = (label, ok, got) => {
    if (ok) { console.log(`  ok   ${label}`); return true; }
    console.log(`  FAIL ${label}${got !== undefined ? ` — ${JSON.stringify(got)}` : ''}`);
    failed.push(label);
    return false;
  };
  // Call instead of process.exit(). Returns the exit code so a caller can still decide.
  const finish = () => {
    if (failed.length && process.env.GP_DIAG) {
      // Artifact names reject / \ : * ? " < > | and are awkward with spaces; keep it to a
      // slug that survives the round trip and still reads as the sentence it came from.
      const slug = failed
        .map((f) => f.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60))
        .join('__AND__')
        .slice(0, 180);
      try { fs.writeFileSync(process.env.GP_DIAG, slug); } catch { /* never mask the real failure */ }
    }
    console.log(failed.length ? `\n${failed.length} FAILED` : '\nall green');
    return failed.length ? 1 : 0;
  };
  return { check, finish, failed };
}
