export const DATA_AND_PRIVACY = `\
This client talks directly to Meraki's Supabase backend (the same database \
the school website reads and writes) over its REST API — it does not open a \
browser or click through their pages. Here's exactly what each tab touches:

READS ONLY
  Overview       -> assignments (due dates, class), announcements (latest)
  Classes        -> classes (name, subject, period, room, teacher)
  Grades         -> grades, joined with assignments (points, due dates)
  Assignments    -> assignments (all, joined class name)
  Attendance     -> attendance (date, status, notes)
  Calendar       -> calendar_events
  Announcements  -> announcements (title, body, timestamp)
  Messages       -> messages (subject, body, sender/recipient, read state)
  Me             -> hero_profiles, portfolio_items, checkins

WRITES (real rows, visible to staff exactly like the website)
  Messages [n]   -> inserts into messages. The recipient sees it the same
                    way they would a message sent from the site.
  Me [n]         -> inserts into checkins. Same table counselors/admins
                    can see through the site.

Transparency goes both ways: staff also keep records about you that the
official site doesn't put front and center. This client surfaces the ones
your own account can read (nothing you couldn't already pull yourself,
just easier to find):

WHAT STAFF RECORD ABOUT YOU (read-only, see the 'My Record' tab)
  behavior_notes -> notes/strikes logged against you, including automated
                    ones (e.g. the bot-detection strike mentioned below)
  detentions     -> reason, strike_count, scheduled date, status
  report_cards   -> per-class term grade, letter, and teacher comment
  attendance     -> already shown on its own tab: daily status + notes

None of this is hidden by design on their end particularly — it's just
buried in a slow, clunky UI. This tab exists so you don't have to dig.

This app does not grant anonymity, extra permissions, or a bypass of school
policy — it only changes the interface sitting on top of the same account
and the same data. Anything sent or logged here is exactly as real as if
it were typed into the official website.

One technical note: because this reads/writes via the API directly instead
of driving the actual web page, it does not trigger the site's client-side
bot/script detection (which watches for scripted clicks and keystrokes in
the browser DOM). That detector already flagged this project's own test
account during development — logged as a behavior_notes 'strike', cleared
only because the school's admins were informed in advance and had signed
off on this being a sanctioned security assessment.

If you don't have that same explicit sign-off, assume none of it transfers
to you: using an unofficial client against a school system can still be a
policy or academic-integrity issue on its own terms, independent of
whether any particular detector happens to notice.

If you're using the self-hosted web version of this client: your email and
password go straight from your browser to Meraki's own Supabase project,
the same place the official site sends them. The server hosting this page
only ever serves the static files you're looking at right now — it never
sees your password, your session token, or anything you type.
`;

function classifyParagraph(firstLine) {
  if (
    firstLine === 'READS ONLY' ||
    firstLine.startsWith('WRITES (') ||
    firstLine.startsWith('WHAT STAFF RECORD ABOUT YOU')
  ) {
    return { cls: 'priv-section', prefix: '▸ ' };
  }
  if (
    firstLine.startsWith('This app does not grant anonymity') ||
    firstLine.startsWith("If you don't have that same explicit sign-off")
  ) {
    return { cls: 'priv-warn', prefix: '⚠ ' };
  }
  if (firstLine.startsWith('One technical note:') || firstLine.startsWith("If you're using the self-hosted")) {
    return { cls: 'priv-note', prefix: 'ℹ ' };
  }
  if (firstLine.startsWith('Transparency goes both ways') || firstLine.startsWith('None of this is hidden')) {
    return { cls: 'priv-accent2', prefix: null };
  }
  return { cls: '', prefix: null };
}

/** Parses DATA_AND_PRIVACY into paragraphs for rendering: { cls, lines: [{label, desc}|{text}] }[] */
export function privacyParagraphs() {
  const rawLines = DATA_AND_PRIVACY.split('\n');
  const paragraphs = [];
  let i = 0;
  while (i < rawLines.length) {
    if (rawLines[i] === '') {
      i += 1;
      continue;
    }
    const start = i;
    while (i < rawLines.length && rawLines[i] !== '') i += 1;
    const { cls, prefix } = classifyParagraph(rawLines[start]);
    const isTable = cls === 'priv-section';
    const lines = rawLines.slice(start, i).map((raw, j) => {
      if (isTable && j > 0) {
        const idx = raw.indexOf('->');
        if (idx !== -1) return { label: raw.slice(0, idx).trim(), desc: raw.slice(idx + 2).trim() };
        return { text: raw };
      }
      if (j === 0 && prefix) return { text: `${prefix}${raw}` };
      return { text: raw };
    });
    paragraphs.push({ cls, lines });
  }
  return paragraphs;
}
