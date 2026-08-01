// Pure subscribed-channel logic. The authoritative set comes from parsing
// /feed/channels; when that parse fails, proxySubscribedChannels derives a
// degraded set from the subscriptions feed itself (only channels that posted
// recently, so it under-reports — never treat it as complete).

import type { SubscribedChannel, Video } from "./types";

/** Channels inferred from subscriptions-sourced videos. Deliberately narrow:
 * a channel that hasn't posted inside the feed window is invisible here. */
export function proxySubscribedChannels(videos: Video[]): SubscribedChannel[] {
  const seen = new Set<string>();
  const channels: SubscribedChannel[] = [];
  for (const v of videos) {
    if (v.source !== "subscriptions" || !v.channelId || seen.has(v.channelId)) continue;
    seen.add(v.channelId);
    channels.push({ channelId: v.channelId, channelTitle: v.channelTitle });
  }
  return channels;
}

export function subscribedIdSet(channels: SubscribedChannel[]): Set<string> {
  return new Set(channels.map((c) => c.channelId));
}
