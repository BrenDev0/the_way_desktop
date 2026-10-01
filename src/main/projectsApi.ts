import type { FileBytes, ServerApiPort } from "../core/api";
import type { ProjectRef, ProjectsApiPort, RemoteFolder, RemoteTree } from "../core/tools/ports";

interface UploadTicket {
  file: { id: string };
  uploadUrl: string;
}

const TRANSFER_TIMEOUT = 10 * 60_000;

/** The user's projects, reached through the desktop API and the bucket's presigned URLs. */
export class ProjectsApi implements ProjectsApiPort {
  constructor(private readonly api: ServerApiPort) {}

  async projects(): Promise<ProjectRef[]> {
    const projects = await this.api.request<{ id: string; name: string }[]>("GET", "/projects");
    return projects.map(({ id, name }) => ({ id, name }));
  }

  tree(projectId: string): Promise<RemoteTree> {
    return this.api.request<RemoteTree>("GET", `/projects/${projectId}/tree`);
  }

  // The files panel's own calls; the agent's tools never create projects or delete in them.

  async createProject(name: string): Promise<ProjectRef> {
    const { id, name: created } = await this.api.request<ProjectRef>("POST", "/projects", { name });
    return { id, name: created };
  }

  async removeEntry(projectId: string, kind: "file" | "folder", id: string): Promise<void> {
    await this.api.request("DELETE", `/projects/${projectId}/${kind === "file" ? "files" : "folders"}/${id}`);
  }

  createFolder(projectId: string, name: string, parentId: string | null): Promise<RemoteFolder> {
    return this.api.request<RemoteFolder>("POST", `/projects/${projectId}/folders`, { name, parentId });
  }

  async upload(projectId: string, folderId: string | null, name: string, data: Uint8Array, contentType: string) {
    const ticket = await this.api.request<UploadTicket>("POST", `/projects/${projectId}/files`, {
      name,
      folderId,
      contentType,
      sizeBytes: data.length,
    });

    // The bucket checks the Content-Type against the one the URL was signed for.
    const put = await fetch(ticket.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: new Uint8Array(data),
      signal: AbortSignal.timeout(TRANSFER_TIMEOUT),
    });
    if (!put.ok) throw new Error(`The file store refused the upload of ${name} (${put.status}).`);

    await this.api.request("POST", `/projects/${projectId}/files/${ticket.file.id}/complete`);
  }

  async download(projectId: string, fileId: string): Promise<Uint8Array> {
    return (await this.content(projectId, fileId)).data;
  }

  /**
   * A file's bytes and type. Through the server where it can: a presigned URL names the
   * bucket as the server sees it, which under Docker is a host this computer cannot reach.
   */
  async content(projectId: string, fileId: string): Promise<FileBytes> {
    if (this.api.bytes) return this.api.bytes(`/projects/${projectId}/files/${fileId}/content`);

    const { downloadUrl } = await this.api.request<{ downloadUrl: string }>(
      "GET",
      `/projects/${projectId}/files/${fileId}/download`,
    );
    const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(TRANSFER_TIMEOUT) });
    if (!response.ok) throw new Error(`The file store refused the download (${response.status}).`);
    return {
      data: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  }
}
