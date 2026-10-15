export type VideoProvider = "youtube" | "vimeo" | "loom" | "drive";

export type ParsedVideoLink = {
  provider: VideoProvider;

  watchUrl: string;

  embedUrl: string | null;
};

export const MAX_VIDEO_LINK_LENGTH = 2048;

const PROVIDER_HOSTS: Record<string, VideoProvider> = {
  "youtube.com": "youtube",
  "www.youtube.com": "youtube",
  "m.youtube.com": "youtube",
  "youtu.be": "youtube",
  "vimeo.com": "vimeo",
  "www.vimeo.com": "vimeo",
  "player.vimeo.com": "vimeo",
  "loom.com": "loom",
  "www.loom.com": "loom",
  "drive.google.com": "drive",
};

function youtubeStart(url: URL): number | null {
  const raw = url.searchParams.get("t") ?? url.searchParams.get("start");
  if (!raw) return null;

  const compound = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (compound && raw !== "" && /[hms]/.test(raw)) {
    const [, h, m, s] = compound;
    const total = Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
    return total > 0 ? total : null;
  }
  const plain = Number.parseInt(raw, 10);
  return Number.isFinite(plain) && plain > 0 ? plain : null;
}

function parseYouTube(url: URL): ParsedVideoLink | null {
  let id: string | null = null;

  if (url.hostname === "youtu.be") {
    id = url.pathname.slice(1).split("/")[0] ?? null;
  } else if (url.pathname === "/watch") {
    id = url.searchParams.get("v");
  } else if (url.pathname.startsWith("/embed/")) {
    id = url.pathname.slice("/embed/".length).split("/")[0] ?? null;
  } else if (url.pathname.startsWith("/shorts/")) {
    id = url.pathname.slice("/shorts/".length).split("/")[0] ?? null;
  } else if (url.pathname.startsWith("/live/")) {
    id = url.pathname.slice("/live/".length).split("/")[0] ?? null;
  }

  if (!id || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null;

  const start = youtubeStart(url);
  const embed = new URL(`https://www.youtube-nocookie.com/embed/${id}`);
  if (start) embed.searchParams.set("start", String(start));

  const watch = new URL(`https://www.youtube.com/watch?v=${id}`);
  if (start) watch.searchParams.set("t", String(start));

  return { provider: "youtube", watchUrl: watch.toString(), embedUrl: embed.toString() };
}

function parseVimeo(url: URL): ParsedVideoLink | null {
  const segments = url.pathname.split("/").filter(Boolean);
  const id = [...segments].reverse().find((s) => /^\d{6,12}$/.test(s));
  if (!id) return null;

  const idIndex = segments.lastIndexOf(id);
  const trailing = segments[idIndex + 1];
  const hash =
    url.searchParams.get("h") ?? (trailing && /^[a-f0-9]{6,20}$/i.test(trailing) ? trailing : null);

  const embed = new URL(`https://player.vimeo.com/video/${id}`);
  if (hash) embed.searchParams.set("h", hash);
  const watch = new URL(`https://vimeo.com/${id}${hash ? `/${hash}` : ""}`);

  return { provider: "vimeo", watchUrl: watch.toString(), embedUrl: embed.toString() };
}

function parseLoom(url: URL): ParsedVideoLink | null {
  const match = /^\/(?:share|embed)\/([a-f0-9]{16,64})/i.exec(url.pathname);
  const id = match?.[1];
  if (!id) return null;

  return {
    provider: "loom",
    watchUrl: `https://www.loom.com/share/${id}`,
    embedUrl: `https://www.loom.com/embed/${id}`,
  };
}

function parseDrive(url: URL): ParsedVideoLink | null {
  const fromPath = /^\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(url.pathname)?.[1];
  const fromQuery = url.searchParams.get("id");
  const id = fromPath ?? (fromQuery && /^[A-Za-z0-9_-]{10,}$/.test(fromQuery) ? fromQuery : null);
  if (!id) return null;

  return {
    provider: "drive",
    watchUrl: `https://drive.google.com/file/d/${id}/view`,

    embedUrl: `https://drive.google.com/file/d/${id}/preview`,
  };
}

export function parseVideoLink(raw: string): ParsedVideoLink | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_VIDEO_LINK_LENGTH) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;

  const provider = PROVIDER_HOSTS[url.hostname.toLowerCase()];
  if (!provider) return null;

  switch (provider) {
    case "youtube":
      return parseYouTube(url);
    case "vimeo":
      return parseVimeo(url);
    case "loom":
      return parseLoom(url);
    case "drive":
      return parseDrive(url);
    default:
      return null;
  }
}

export const PROVIDER_LABELS: Record<VideoProvider, string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  loom: "Loom",
  drive: "Google Drive",
};
