export function bundleOf(executablePath: string): string | null {
  return /^(.*\.app)\/Contents\/MacOS\//.exec(executablePath.replaceAll("\\", "/"))?.[1] ?? null;
}

export function versionFromPlist(xml: string): string | null {
  return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(xml)?.[1]?.trim() ?? null;
}
