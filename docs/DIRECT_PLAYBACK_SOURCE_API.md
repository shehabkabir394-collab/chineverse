# Direct playback source API adapter

This adapter connects Only Drama to a **licensed** video-source API. TMDB and Watchmode are metadata/availability services and do not provide direct episode video files; this endpoint does not scrape Netflix or other provider websites.

## Cloudflare Pages environment variables

Add these as server-side Pages secrets/variables (never in `js/config.js`):

- `PLAYBACK_SOURCE_API_URL`: HTTPS endpoint for a licensed provider's episode-source search.
- `PLAYBACK_SOURCE_API_KEY`: provider API key (secret).

The provider must accept GET query parameters `title`, `tmdb_id`, `season`, `episode`, and `region`. The function adds `Authorization: Bearer <key>` and `X-API-Key: <key>` when a key is configured.

## Required provider response

Return JSON in this shape:

```json
{
  "sources": [
    {
      "url": "https://licensed-cdn.example/episode/stream.m3u8",
      "quality": "720p",
      "mime_type": "application/vnd.apple.mpegurl",
      "provider": "Licensed Distributor",
      "rights_verified": true
    }
  ]
}
```

Only HTTPS direct media URLs ending in `.m3u8`, `.mp4`, `.webm`, or `.mov` (or carrying a video MIME type) and explicitly marked `rights_verified: true` are passed to the player. Netflix/Watchmode web pages and unverified links are rejected.

## Important

This is an adapter, not a catalog of drama streams. It cannot create direct video URLs or make a provider expose content it is not licensed to distribute. Until a compatible licensed provider API is supplied and configured, the episode player will report that the direct-source API is not configured. Existing episode R2 assets and `series_episodes.video_url` continue to work.
