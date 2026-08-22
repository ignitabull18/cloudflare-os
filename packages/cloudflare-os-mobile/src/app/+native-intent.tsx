const HOSTED_ORIGIN = "https://os.ignitabull.org";

function workshopRoute(path: string): string {
  const safePath = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  return `/workshop?path=${encodeURIComponent(safePath)}`;
}

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.startsWith("cloudflareos://open")) {
      const incoming = new URL(path);
      return workshopRoute(incoming.searchParams.get("path") ?? "/");
    }

    if (path.startsWith(HOSTED_ORIGIN)) {
      const incoming = new URL(path);
      return workshopRoute(`${incoming.pathname}${incoming.search}`);
    }
  } catch {
    return "/(tabs)/(work)";
  }

  return path;
}
