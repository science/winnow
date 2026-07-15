// Stage-by-stage diagnostic of the transcript pipeline against live YouTube,
// running the REAL production module from Node (npx vite-node
// scripts/transcript-diag.ts [videoId...]). History of why the pipeline is
// shaped this way — WEB timedtext pot-gating, get_transcript 400s, the
// moz-extension Origin bot-block — is in the transcripts.ts header comment;
// rerun this when transcripts regress to see which stage broke.
import {
  ANDROID_CLIENT,
  captionTracksFrom,
  fetchTranscriptExcerpt,
  pickCaptionTrack,
} from "../src/services/youtube/transcripts";

const VIDEOS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["dQw4w9WgXcQ", "jNQXAC9IVRw", "9bZkp7q19f0"];

for (const videoId of VIDEOS) {
  console.log(`\n=== ${videoId} ===`);

  // Stage view: player call → tracks → chosen track
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context: { client: { ...ANDROID_CLIENT, hl: "en" } }, videoId }),
  });
  console.log(`player (${ANDROID_CLIENT.clientName} ${ANDROID_CLIENT.clientVersion}): HTTP ${res.status}`);
  if (res.ok) {
    const data = (await res.json()) as { playabilityStatus?: { status?: string } };
    const tracks = captionTracksFrom(data);
    console.log(`playability=${data.playabilityStatus?.status}, captionTracks=${tracks.length}`);
    const track = pickCaptionTrack(tracks);
    if (track?.baseUrl) {
      const tt = await fetch(track.baseUrl);
      const body = await tt.text();
      console.log(
        `timedtext [${track.languageCode}${track.kind === "asr" ? " asr" : ""}]: HTTP ${tt.status}, ${body.length} bytes`,
      );
    }
  }

  // End-to-end through the production entry point
  const outcome = await fetchTranscriptExcerpt(videoId, 160);
  if ("excerpt" in outcome) {
    console.log(`fetchTranscriptExcerpt: OK — ${JSON.stringify(outcome.excerpt.slice(0, 100))}`);
  } else {
    console.log(`fetchTranscriptExcerpt: FAILURE ${outcome.failure}`);
  }
}
