"use client";

import { ApiClient } from '@twurple/api';
import { AppTokenAuthProvider } from '@twurple/auth';

// ─── Types ───────────────────────────────────────────────────────────────────
export interface TwitchClipInfo {
  id: string;
  url: string;
  embedUrl: string;
  broadcasterId: string;
  broadcasterName: string;
  creatorId: string;
  creatorName: string;
  title: string;
  viewCount: number;
  createdAt: string;
  duration: number;
  thumbnailUrl: string;
}

export interface TwitchStreamInfo {
  id: string;
  userId: string;
  userName: string;
  title: string;
  viewerCount: number;
  startedAt: string;
  thumbnailUrl: string;
}

export interface TwitchUserInfo {
  id: string;
  login: string;
  displayName: string;
  description: string;
  profileImageUrl: string;
  offlineImageUrl: string;
  viewCount: number;
}

// ─── Client Factory ──────────────────────────────────────────────────────────

/**
 * Creates a Twitch Helix API client using an App Access Token.
 * Requires TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in environment.
 *
 * For server-side rendering safety, returns null when env vars are missing
 * or when called outside of client context.
 */
export function createTwitchClient(): ApiClient | null {
  const clientId = process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    if (typeof window !== 'undefined') {
      console.warn(
        'Twitch client not initialized: Set NEXT_PUBLIC_TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in .env.local'
      );
    }
    return null;
  }

  const authProvider = new AppTokenAuthProvider(clientId, clientSecret);
  return new ApiClient({ authProvider });
}

// ─── Clips API ───────────────────────────────────────────────────────────────

/**
 * Get clips for a specific broadcaster.
 * @param broadcasterId Twitch user ID
 * @param limit max results (default 20)
 */
export async function getBroadcasterClips(
  broadcasterId: string,
  limit: number = 20
): Promise<TwitchClipInfo[]> {
  const client = createTwitchClient();
  if (!client) return [];

  try {
    const clips = await client.clips.getClipsForBroadcaster(broadcasterId, {
      limit,
    });
    return clips.data.map((clip) => ({
      id: clip.id,
      url: clip.url,
      embedUrl: clip.embedUrl,
      broadcasterId: clip.broadcasterId,
      broadcasterName: clip.broadcasterDisplayName,
      creatorId: clip.creatorId,
      creatorName: clip.creatorDisplayName,
      title: clip.title,
      viewCount: clip.views,
      createdAt: clip.creationDate.toISOString(),
      duration: clip.duration,
      thumbnailUrl: clip.thumbnailUrl,
    }));
  } catch (err) {
    console.error('Failed to fetch broadcaster clips:', err);
    return [];
  }
}

/**
 * Get clips by game/category.
 * @param gameId Twitch game/category ID
 * @param limit max results (default 20)
 */
export async function getGameClips(
  gameId: string,
  limit: number = 20
): Promise<TwitchClipInfo[]> {
  const client = createTwitchClient();
  if (!client) return [];

  try {
    const clips = await client.clips.getClipsForGame(gameId, { limit });
    return clips.data.map((clip) => ({
      id: clip.id,
      url: clip.url,
      embedUrl: clip.embedUrl,
      broadcasterId: clip.broadcasterId,
      broadcasterName: clip.broadcasterDisplayName,
      creatorId: clip.creatorId,
      creatorName: clip.creatorDisplayName,
      title: clip.title,
      viewCount: clip.views,
      createdAt: clip.creationDate.toISOString(),
      duration: clip.duration,
      thumbnailUrl: clip.thumbnailUrl,
    }));
  } catch (err) {
    console.error('Failed to fetch game clips:', err);
    return [];
  }
}

/**
 * Get a specific clip by its ID.
 */
export async function getClipById(
  clipId: string
): Promise<TwitchClipInfo | null> {
  const client = createTwitchClient();
  if (!client) return null;

  try {
    const clip = await client.clips.getClipById(clipId);
    if (!clip) return null;
    return {
      id: clip.id,
      url: clip.url,
      embedUrl: clip.embedUrl,
      broadcasterId: clip.broadcasterId,
      broadcasterName: clip.broadcasterDisplayName,
      creatorId: clip.creatorId,
      creatorName: clip.creatorDisplayName,
      title: clip.title,
      viewCount: clip.views,
      createdAt: clip.creationDate.toISOString(),
      duration: clip.duration,
      thumbnailUrl: clip.thumbnailUrl,
    };
  } catch (err) {
    console.error('Failed to fetch clip by ID:', err);
    return null;
  }
}

// ─── Streams API ─────────────────────────────────────────────────────────────

/**
 * Get stream info for one or more broadcasters.
 */
export async function getStreams(
  userIds: string[]
): Promise<TwitchStreamInfo[]> {
  const client = createTwitchClient();
  if (!client) return [];

  try {
    const streams = await client.streams.getStreams({ userId: userIds });
    return streams.data.map((stream) => ({
      id: stream.id,
      userId: stream.userId,
      userName: stream.userDisplayName,
      title: stream.title,
      viewerCount: stream.viewers,
      startedAt: stream.startDate.toISOString(),
      thumbnailUrl: stream.getThumbnailUrl(440, 248),
    }));
  } catch (err) {
    console.error('Failed to fetch streams:', err);
    return [];
  }
}

// ─── Users API ───────────────────────────────────────────────────────────────

/**
 * Get user info by login name(s).
 */
export async function getUsersByLogin(
  logins: string[]
): Promise<TwitchUserInfo[]> {
  const client = createTwitchClient();
  if (!client) return [];

  try {
    const users = await client.users.getUsersByNames(logins);
    return users.map((user) => ({
      id: user.id,
      login: user.name,
      displayName: user.displayName,
      description: user.description,
      profileImageUrl: user.profilePictureUrl,
      offlineImageUrl: user.offlinePlaceholderUrl,
      viewCount: 0, // view count not available via Helix users endpoint
    }));
  } catch (err) {
    console.error('Failed to fetch users:', err);
    return [];
  }
}

/**
 * Search for games/categories.
 */
export async function searchCategories(
  query: string
): Promise<Array<{ id: string; name: string; boxArtUrl: string }>> {
  const client = createTwitchClient();
  if (!client) return [];

  try {
    const games = await client.search.searchCategories(query);
    return games.data.map((game) => ({
      id: game.id,
      name: game.name,
      boxArtUrl: game.boxArtUrl,
    }));
  } catch (err) {
    console.error('Failed to search categories:', err);
    return [];
  }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Extract a Twitch clip ID from a clip URL.
 * Supports formats:
 *   https://clips.twitch.tv/<slug>
 *   https://www.twitch.tv/<broadcaster>/clip/<slug>
 */
export function extractClipId(url: string): string | null {
  // Match clips.twitch.tv/<id> or twitch.tv/*/clip/<id>
  const matches =
    url.match(/clips\.twitch\.tv\/([A-Za-z0-9_-]+)/) ||
    url.match(/twitch\.tv\/\w+\/clip\/([A-Za-z0-9_-]+)/);
  return matches ? matches[1] : null;
}

/**
 * Returns the embed HTML for a Twitch clip.
 */
export function getClipEmbedHtml(
  clipSlug: string,
  parent: string = 'localhost'
): string {
  return `<iframe src="https://clips.twitch.tv/embed?clip=${clipSlug}&parent=${parent}" 
    height="360" width="640" allowfullscreen></iframe>`;
}