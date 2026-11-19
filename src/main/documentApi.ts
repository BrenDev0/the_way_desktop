import { ApiError } from "../core/api";
import { ToolError } from "../core/tools/contract";
import type { ApiClient } from "./apiClient";

const EXTRACT_TIMEOUT_MS = 120_000;
const UNREADABLE = new Set(["document_unsupported", "document_unreadable", "document_too_large"]);

export class DocumentApi {
  constructor(private readonly api: ApiClient) {}

  async text(name: string, data: Uint8Array): Promise<string> {
    try {
      const response = await this.api.binary(
        `/desktop-tools/extract-text?name=${encodeURIComponent(name)}`,
        data,
        "application/json",
        AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
        "application/octet-stream",
      );
      return ((await response.json()) as { text: string }).text;
    } catch (error) {
      if (error instanceof ApiError && UNREADABLE.has(error.code)) throw new ToolError(error.message);
      throw error;
    }
  }
}
