// The verbatim user profile behind the 2026-07 gotham reports (dropped
// subjects, Tyler1/Faker mis-tier) — the shared default for diag scripts.
import type { Profile } from "../src/lib/types";

export const DIAG_DEFAULT_PROFILE: Profile = {
  moreOf:
    process.env["DIAG_MORE"] ??
    "Chess videos featuring top tier play or top computer engine games of note.  Science and civil/mechanical/real-world engineering that is practical, professional or serious. Art, film, history, anthropology. Cinematic and film studies. Previews of good quality movies.",
  lessOf:
    process.env["DIAG_LESS"] ??
    "Computer science content, video games, sports, politics. Low tier comic chess games. Drama narratives on any subject. Click-bait subjects or attention grabbing material. Standup comedy. Science provocateurs, overclaiming hype. Overhyped or sensational movies or trailers.",
  updatedAt: 0,
};
