const MIN_CLOUD_BYTES = 4096;

/**
 * A file with a size but nothing allocated on disk is a placeholder: OneDrive, iCloud and the
 * like keep it in the cloud until something opens it, and opening it downloads it. Small files
 * are not told apart: NTFS keeps those inside the directory entry, with nothing "allocated".
 */
export function isCloudOnly(size: number, blocks: number | undefined): boolean {
  return blocks === 0 && size >= MIN_CLOUD_BYTES;
}

export function cloudOnlyMessage(path: string): string {
  return (
    `'${path}' is stored only in the cloud (OneDrive, iCloud...) and is not downloaded on this computer; ` +
    "opening it would download it, so it was not opened. Ask the user to make it available on this device and try again."
  );
}
